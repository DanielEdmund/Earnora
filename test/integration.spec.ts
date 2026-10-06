import { randomBytes } from 'node:crypto';
import { DB, Db, createDb, runMigrations } from '../src/common/db';
import { OutboxService } from '../src/common/events';
import { postTransaction, reserveFunds, refundReserve, settleReserve } from '../src/wallet/ledger';
import { ReferralsService } from '../src/referrals/referrals.service';
import { SupportService } from '../src/support/support.service';

/**
 * Integration tests against an in-memory embedded Postgres — the real schema,
 * real transactions, real constraints. No mocks.
 */

let db: Db;
let seq = 0;

async function makeUser(opts: { referrer?: string; plan?: string } = {}): Promise<string> {
  const id = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, referred_by, referral_code, status, plan)
       VALUES ($1, 'x', $2, $3, 'active', $4)
       RETURNING id`,
      [`u${seq++}_${randomBytes(4).toString('hex')}@test.local`, opts.referrer ?? null, randomRefCode(), opts.plan ?? null],
    )
  ).rows[0].id;
  await db.query(`INSERT INTO wallets (user_id) VALUES ($1)`, [id]);
  return id;
}

function randomRefCode(): string {
  return randomBytes(5).toString('hex').toUpperCase();
}

beforeAll(async () => {
  db = await createDb({ memory: true }); // in-memory embedded Postgres
  await runMigrations(db);
});

describe('ledger (wallet/ledger.ts)', () => {
  test('credit posts once; replaying the same idempotency key is a no-op', async () => {
    const user = await makeUser();

    const first = await db.transaction((q) =>
      postTransaction(q, {
        idempotencyKey: 'test:reward:1',
        type: 'reward',
        userId: user,
        totalKobo: 5_000,
        moves: [{ walletId: user, deltaKobo: 5_000, entryType: 'task_reward', moveKey: 'wallet' }],
      }),
    );
    expect(first.applied).toBe(true);

    const replay = await db.transaction((q) =>
      postTransaction(q, {
        idempotencyKey: 'test:reward:1',
        type: 'reward',
        userId: user,
        totalKobo: 5_000,
        moves: [{ walletId: user, deltaKobo: 5_000, entryType: 'task_reward', moveKey: 'wallet' }],
      }),
    );
    expect(replay.applied).toBe(false);
    expect(replay.txnId).toBe(first.txnId);

    const wallet = await db.query<{ available_kobo: string }>(`SELECT available_kobo FROM wallets WHERE user_id = $1`, [user]);
    expect(Number(wallet.rows[0].available_kobo)).toBe(5_000);

    const entries = await db.query(`SELECT id FROM ledger_entries WHERE wallet_id = $1`, [user]);
    expect(entries.rows.length).toBe(1);
  });

  test('debit below zero is rejected by the CHECK constraint (whole txn rolls back)', async () => {
    const user = await makeUser();
    await expect(
      db.transaction((q) =>
        postTransaction(q, {
          idempotencyKey: 'test:overdraw',
          type: 'withdrawal',
          userId: user,
          totalKobo: 100,
          moves: [{ walletId: user, deltaKobo: -100, entryType: 'withdrawal', moveKey: 'wallet' }],
        }),
      ),
    ).rejects.toThrow();

    const wallet = await db.query<{ available_kobo: string }>(`SELECT available_kobo FROM wallets WHERE user_id = $1`, [user]);
    expect(Number(wallet.rows[0].available_kobo)).toBe(0);
    const txns = await db.query(`SELECT id FROM transactions WHERE idempotency_key = 'test:overdraw'`);
    expect(txns.rows.length).toBe(0); // envelope rolled back too
  });

  test('reserve → settle lifecycle keeps available/reserved consistent', async () => {
    const user = await makeUser();
    await db.transaction((q) =>
      postTransaction(q, {
        idempotencyKey: 'test:seed:1',
        type: 'reward',
        userId: user,
        totalKobo: 100_000,
        moves: [{ walletId: user, deltaKobo: 100_000, entryType: 'task_reward', moveKey: 'wallet' }],
      }),
    );

    const { txnId } = await db.transaction((q) =>
      reserveFunds(q, { userId: user, amountKobo: 60_000, idempotencyKey: 'wd:abc', txnType: 'withdrawal' }),
    );

    let w = await db.query<{ available_kobo: string; reserved_kobo: string }>(
      `SELECT available_kobo, reserved_kobo FROM wallets WHERE user_id = $1`,
      [user],
    );
    expect(Number(w.rows[0].available_kobo)).toBe(40_000);
    expect(Number(w.rows[0].reserved_kobo)).toBe(60_000);

    // double-settle must fail loudly
    await db.transaction((q) => settleReserve(q, { userId: user, amountKobo: 60_000, txnId }));
    await expect(db.transaction((q) => settleReserve(q, { userId: user, amountKobo: 60_000, txnId }))).rejects.toThrow();

    w = await db.query(`SELECT available_kobo, reserved_kobo FROM wallets WHERE user_id = $1`, [user]);
    expect(Number(w.rows[0].reserved_kobo)).toBe(0);
  });

  test('refund returns reserved funds and writes a reversing entry', async () => {
    const user = await makeUser();
    await db.transaction((q) =>
      postTransaction(q, {
        idempotencyKey: 'test:seed:2',
        type: 'reward',
        userId: user,
        totalKobo: 50_000,
        moves: [{ walletId: user, deltaKobo: 50_000, entryType: 'task_reward', moveKey: 'wallet' }],
      }),
    );
    const { txnId } = await db.transaction((q) =>
      reserveFunds(q, { userId: user, amountKobo: 50_000, idempotencyKey: 'wd:xyz', txnType: 'withdrawal' }),
    );
    await db.transaction((q) => refundReserve(q, { userId: user, amountKobo: 50_000, txnId, idempotencyKey: 'wd:xyz' }));

    const w = await db.query<{ available_kobo: string; reserved_kobo: string }>(
      `SELECT available_kobo, reserved_kobo FROM wallets WHERE user_id = $1`,
      [user],
    );
    expect(Number(w.rows[0].available_kobo)).toBe(50_000);
    expect(Number(w.rows[0].reserved_kobo)).toBe(0);

    const reversal = await db.query(
      `SELECT id FROM ledger_entries WHERE wallet_id = $1 AND entry_type = 'withdrawal_reversal'`,
      [user],
    );
    expect(reversal.rows.length).toBe(1);
  });

  test('task/affiliate split: credits land in their source, draws take affiliate first, sum always = available', async () => {
    const user = await makeUser();

    const bucket = async () => {
      const r = await db.query<{ available_kobo: string; task_kobo: string; affiliate_kobo: string }>(
        `SELECT available_kobo, task_kobo, affiliate_kobo FROM wallets WHERE user_id = $1`,
        [user],
      );
      const row = r.rows[0];
      const v = {
        available: Number(row.available_kobo),
        task: Number(row.task_kobo),
        affiliate: Number(row.affiliate_kobo),
      };
      expect(v.task + v.affiliate).toBe(v.available); // the invariant the feature rests on
      return v;
    };

    // approved-task reward → task bucket
    await db.transaction((q) =>
      postTransaction(q, {
        idempotencyKey: 'test:split:task',
        type: 'reward',
        userId: user,
        totalKobo: 5_000,
        moves: [{ walletId: user, deltaKobo: 5_000, entryType: 'task_reward', moveKey: 'wallet' }],
      }),
    );
    expect(await bucket()).toEqual({ available: 5_000, task: 5_000, affiliate: 0 });

    // referral commission → affiliate bucket
    await db.transaction((q) =>
      postTransaction(q, {
        idempotencyKey: 'test:split:ref',
        type: 'referral_bonus',
        userId: user,
        totalKobo: 3_000,
        moves: [{ walletId: user, deltaKobo: 3_000, entryType: 'referral_commission', moveKey: 'wallet' }],
      }),
    );
    expect(await bucket()).toEqual({ available: 8_000, task: 5_000, affiliate: 3_000 });

    // a direct debit draws affiliate first, remainder task
    await db.transaction((q) =>
      postTransaction(q, {
        idempotencyKey: 'test:split:debit',
        type: 'adjust',
        userId: user,
        totalKobo: 1_000,
        moves: [{ walletId: user, deltaKobo: -1_000, entryType: 'adjustment', moveKey: 'wallet' }],
      }),
    );
    expect(await bucket()).toEqual({ available: 7_000, task: 5_000, affiliate: 2_000 });

    // a withdrawal reserves the same way (affiliate first) …
    const { txnId } = await db.transaction((q) =>
      reserveFunds(q, { userId: user, amountKobo: 4_000, idempotencyKey: 'wd:split', txnType: 'withdrawal' }),
    );
    expect(await bucket()).toEqual({ available: 3_000, task: 3_000, affiliate: 0 });

    // … and a failed payout refunds each bucket EXACTLY what it took
    await db.transaction((q) => refundReserve(q, { userId: user, amountKobo: 4_000, txnId, idempotencyKey: 'wd:split' }));
    expect(await bucket()).toEqual({ available: 7_000, task: 5_000, affiliate: 2_000 });
  });
});

describe('flat referral bonus on plan purchase', () => {
  const balanceOf = async (id: string): Promise<number> => {
    const r = await db.query<{ available_kobo: string }>(`SELECT available_kobo FROM wallets WHERE user_id = $1`, [id]);
    return Number(r.rows[0].available_kobo);
  };

  test('direct referrer with a plan is credited exactly once at their plan rate', async () => {
    const referrer = await makeUser({ plan: 'extreme' });
    const newbie = await makeUser({ referrer });
    const svc = new ReferralsService(db, new OutboxService(db));

    // platform collected the ₦10,500 Extreme fee
    await db.transaction((q) =>
      postTransaction(q, {
        idempotencyKey: 'pay:REFX1',
        type: 'plan_purchase',
        totalKobo: 1_050_000,
        moves: [
          { walletId: '00000000-0000-0000-0000-000000000001', deltaKobo: 1_050_000, entryType: 'plan_fee', moveKey: 'platform' },
        ],
      }),
    );

    const credits = await db.transaction((q) =>
      svc.creditOnPlanPurchase(q, { purchasedUserId: newbie, purchaseRef: 'REFX1' }),
    );

    expect(credits).toHaveLength(1);
    expect(credits[0].beneficiaryId).toBe(referrer);
    expect(credits[0].amountKobo).toBe(60_000); // Extreme referrer rate = ₦600
    expect(await balanceOf(referrer)).toBe(60_000);

    // replay: unique referral_credits row + commission:REFX1 envelope → no second credit
    const again = await db.transaction((q) =>
      svc.creditOnPlanPurchase(q, { purchasedUserId: newbie, purchaseRef: 'REFX1' }),
    );
    expect(again).toHaveLength(0);
    expect(await balanceOf(referrer)).toBe(60_000);
  });

  test('referrer without a plan earns nothing', async () => {
    const referrer = await makeUser(); // plan = NULL
    const newbie = await makeUser({ referrer });
    const svc = new ReferralsService(db, new OutboxService(db));

    const credits = await db.transaction((q) =>
      svc.creditOnPlanPurchase(q, { purchasedUserId: newbie, purchaseRef: 'REFX_NOPLAN' }),
    );
    expect(credits).toHaveLength(0);
    expect(await balanceOf(referrer)).toBe(0);
  });

  test('referrer earns THEIR plan rate even when the invitee buys a bigger plan', async () => {
    const referrer = await makeUser({ plan: 'beginner' });
    const newbie = await makeUser({ referrer });
    const svc = new ReferralsService(db, new OutboxService(db));

    await db.transaction((q) =>
      postTransaction(q, {
        idempotencyKey: 'pay:REFX3',
        type: 'plan_purchase',
        totalKobo: 1_050_000,
        moves: [
          { walletId: '00000000-0000-0000-0000-000000000001', deltaKobo: 1_050_000, entryType: 'plan_fee', moveKey: 'platform' },
        ],
      }),
    );

    const credits = await db.transaction((q) =>
      svc.creditOnPlanPurchase(q, { purchasedUserId: newbie, purchaseRef: 'REFX3' }),
    );
    expect(credits).toHaveLength(1);
    expect(credits[0].amountKobo).toBe(20_000); // referrer's Beginner rate = ₦200
    expect(await balanceOf(referrer)).toBe(20_000);
  });
});

describe('outbox relay', () => {
  test('publishes events written inside a transaction and marks them', async () => {
    const { EventBus, OutboxRelay } = await import('../src/common/events');
    const bus = new EventBus();
    const relay = new OutboxRelay(db, bus);
    const seen: any[] = [];
    bus.on('task.approved', (p) => seen.push(p));

    await db.transaction((q) => new OutboxService(db).publish(q, 'task.approved' as any, { claimId: 42 }));
    await relay.drain();

    expect(seen).toHaveLength(1);
    expect(seen[0].claimId).toBe(42);
    const remaining = await db.query(`SELECT id FROM outbox_events WHERE published_at IS NULL`);
    expect(remaining.rows.length).toBe(0);
  });

  test('events from rolled-back transactions never appear', async () => {
    const { EventBus, OutboxRelay, OutboxService: OS } = await import('../src/common/events');
    const bus = new EventBus();
    const relay = new OutboxRelay(db, bus);
    const seen: any[] = [];
    bus.on('task.claimed', (p) => seen.push(p));

    await expect(
      db.transaction(async (q) => {
        await new OS(db).publish(q, 'task.claimed' as any, { doomed: true });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    await relay.drain();
    expect(seen).toHaveLength(0);
  });
});

describe('support inbox (support/support.service.ts)', () => {
  test('escalate → owner sees it with the asker email → reply flips status', async () => {
    const svc = new SupportService(db);
    const user = await makeUser();

    const created = await svc.create(user, '  will you launch a mobile app?  ');
    expect(created.status).toBe('open');
    expect(created.message).toBe('will you launch a mobile app?'); // trimmed on the way in

    const mine = await svc.listForUser(user);
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(created.id);

    const adminUser = await makeUser();
    const replied = await svc.reply(created.id, adminUser, '  Yes — it is on the roadmap.  ');
    expect(replied.status).toBe('replied');
    expect(replied.reply).toBe('Yes — it is on the roadmap.');
    expect(replied.replied_at).toBeTruthy();

    const open = await svc.adminList('open');
    expect(open.find((r) => r.id === created.id)).toBeUndefined();

    const all = await svc.adminList('all');
    const row = all.find((r) => r.id === created.id);
    expect(row).toBeDefined();
    expect(row!.email).toContain('@'); // the owner sees WHO asked
    expect(row!.reply).toBe('Yes — it is on the roadmap.');
  });

  test('empty / oversized messages and replies are rejected; unknown id 404s', async () => {
    const svc = new SupportService(db);
    const user = await makeUser();
    const adminUser = await makeUser();

    await expect(svc.create(user, '   ')).rejects.toThrow(/empty/i);
    await expect(svc.create(user, 'x'.repeat(1001))).rejects.toThrow(/too long/i);

    const ok = await svc.create(user, 'real question');
    await expect(svc.reply(ok.id, adminUser, '   ')).rejects.toThrow(/empty/i);
    await expect(svc.reply(999999999, adminUser, 'fine')).rejects.toThrow(/not found/i);
  });

  test('rate limit: 10 escalations per user per hour, others unaffected', async () => {
    const svc = new SupportService(db);
    const user = await makeUser();
    for (let i = 0; i < 10; i++) await svc.create(user, `question ${i}`);
    await expect(svc.create(user, 'one too many')).rejects.toThrow(/quickly/i);

    const other = await makeUser();
    await expect(svc.create(other, 'hello?')).resolves.toMatchObject({ status: 'open' });
  });
});
