import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { QRes, QueryFn, isUniqueViolation } from '../common/db';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ONLY CODE THAT WRITES MONEY. Free functions (not a service) so every
 * module passes its own transaction-scoped query function — impossible to
 * post entries outside the caller's transaction.
 *
 * Rules enforced here:
 *  • every movement is wrapped in a `transactions` envelope keyed by a unique
 *    idempotency key — replaying any event collapses to ONE effect;
 *  • wallet deltas are a single atomic UPDATE guarded by CHECK constraints
 *    (insufficient funds → 23514 → whole transaction rolls back);
 *  • ledger_entries is append-only with balance_after snapshots for statements.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface LedgerMove {
  walletId: string;
  /** signed kobo: positive = credit, negative = debit */
  deltaKobo: number;
  entryType: string;
  /** unique per (wallet, direction) inside one envelope; e.g. 'wallet' or 'tier:1' */
  moveKey: string;
  refType?: string;
  refId?: string;
  memo?: string;
}

export interface PostTransactionArgs {
  idempotencyKey: string;
  type: string;
  status?: 'pending' | 'held' | 'settled' | 'failed' | 'reversed';
  totalKobo: number;
  userId?: string | null;
  metadata?: Record<string, unknown>;
  moves: LedgerMove[];
}

export interface PostTransactionResult {
  applied: boolean;
  txnId: string;
}

export async function postTransaction(q: QueryFn, args: PostTransactionArgs): Promise<PostTransactionResult> {
  const txnId = randomUUID();
  const status = args.status ?? 'settled';

  const env = await q<{ txn_id: string }>(
    `INSERT INTO transactions (txn_id, user_id, type, status, total_kobo, idempotency_key, metadata, settled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, CASE WHEN $4 = 'settled' THEN now() END)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING txn_id`,
    [
      txnId,
      args.userId ?? null,
      args.type,
      status,
      args.totalKobo,
      args.idempotencyKey,
      JSON.stringify(args.metadata ?? {}),
    ],
  );

  // Replay detected: the envelope already exists → apply NOTHING further.
  if (env.rows.length === 0) {
    const existing = await q<{ txn_id: string }>(`SELECT txn_id FROM transactions WHERE idempotency_key = $1`, [
      args.idempotencyKey,
    ]);
    return { applied: false, txnId: existing.rows[0]?.txn_id ?? txnId };
  }

  for (const move of args.moves) {
    if (move.deltaKobo === 0) continue;
    const direction = move.deltaKobo > 0 ? 'credit' : 'debit';
    const amount = Math.abs(move.deltaKobo);

    // Source-bucket bookkeeping: task_kobo + affiliate_kobo always mirrors
    // available_kobo. Credits land in their source (referrals → affiliate,
    // everything else → task); debits draw affiliate first, remainder task.
    const bucket = move.deltaKobo > 0 ? (move.entryType === 'referral_commission' ? 'affiliate_kobo' : 'task_kobo') : null;

    // Atomic conditional update: the CHECK on wallets.available_kobo >= 0 is the
    // backstop — insufficient funds raises 23514 and rolls back the whole txn.
    const upd = await q<{ available_kobo: string | number }>(
      move.deltaKobo > 0
        ? `UPDATE wallets
              SET available_kobo = available_kobo + $2,
                  lifetime_kobo  = lifetime_kobo + $2,
                  ${bucket}       = ${bucket} + $2,
                  version        = version + 1,
                  updated_at     = now()
            WHERE user_id = $1
            RETURNING available_kobo`
        : `UPDATE wallets
              SET available_kobo = available_kobo + $2,
                  affiliate_kobo = GREATEST(affiliate_kobo + $2, 0),
                  task_kobo      = task_kobo + $2 + (affiliate_kobo - GREATEST(affiliate_kobo + $2, 0)),
                  version        = version + 1,
                  updated_at     = now()
            WHERE user_id = $1
            RETURNING available_kobo`,
      [move.walletId, move.deltaKobo],
    );
    if (upd.rows.length === 0) throw new ConflictException(`Wallet ${move.walletId} not found`);

    const balanceAfter = Number(upd.rows[0].available_kobo);
    await q(
      `INSERT INTO ledger_entries
         (txn_id, wallet_id, direction, amount_kobo, balance_after, entry_type, ref_type, ref_id, idempotency_key, memo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        txnId,
        move.walletId,
        direction,
        amount,
        balanceAfter,
        move.entryType,
        move.refType ?? null,
        move.refId ?? null,
        `${args.idempotencyKey}:${move.moveKey}`,
        move.memo ?? null,
      ],
    );
  }

  return { applied: true, txnId };
}

/**
 * Moves funds available → reserved for a pending withdrawal.
 * This is a wallet reallocation: available is debited AND a ledger entry is
 * written (users see the withdrawal on their statement at request time);
 * reserved is invisible to the ledger because it is still the user's money.
 */
export async function reserveFunds(
  q: QueryFn,
  args: { userId: string; amountKobo: number; idempotencyKey: string; txnType: string; metadata?: Record<string, unknown> },
): Promise<{ reserved: boolean; txnId: string }> {
  const txnId = randomUUID();
  const env = await q(
    `INSERT INTO transactions (txn_id, user_id, type, status, total_kobo, idempotency_key, metadata)
     VALUES ($1, $2, $3, 'held', $4, $5, $6::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING txn_id`,
    [txnId, args.userId, args.txnType, args.amountKobo, args.idempotencyKey, JSON.stringify(args.metadata ?? {})],
  );
  if (env.rows.length === 0) {
    const existing = await q<{ txn_id: string }>(`SELECT txn_id FROM transactions WHERE idempotency_key = $1`, [
      args.idempotencyKey,
    ]);
    return { reserved: false, txnId: existing.rows[0]?.txn_id ?? txnId };
  }

  // Split the draw across the two source buckets (affiliate first) so the
  // dashboard's Task/Affiliate balances stay honest — and remember the split
  // in the envelope so a failed payout refunds each bucket exactly.
  const pre = await q<{ affiliate_kobo: string | number }>(
    `SELECT affiliate_kobo FROM wallets WHERE user_id = $1 AND available_kobo >= $2 FOR UPDATE`,
    [args.userId, args.amountKobo],
  );
  if (pre.rows.length === 0) throw new ConflictException('Insufficient available balance');
  const affTaken = Math.min(Number(pre.rows[0].affiliate_kobo), args.amountKobo);
  const taskTaken = args.amountKobo - affTaken;

  const upd = await q<{ available_kobo: string | number }>(
    `UPDATE wallets
        SET available_kobo = available_kobo - $2,
            reserved_kobo  = reserved_kobo  + $2,
            affiliate_kobo = affiliate_kobo - $3,
            task_kobo      = task_kobo - $4,
            version        = version + 1,
            updated_at     = now()
      WHERE user_id = $1 AND available_kobo >= $2
      RETURNING available_kobo`,
    [args.userId, args.amountKobo, affTaken, taskTaken],
  );
  if (upd.rows.length === 0) throw new ConflictException('Insufficient available balance');

  await q(`UPDATE transactions SET metadata = metadata || $2::jsonb WHERE txn_id = $1`, [
    txnId,
    JSON.stringify({ bucketSplit: { affiliate: affTaken, task: taskTaken } }),
  ]);

  const balanceAfter = Number(upd.rows[0].available_kobo);
  await q(
    `INSERT INTO ledger_entries
       (txn_id, wallet_id, direction, amount_kobo, balance_after, entry_type, ref_type, ref_id, idempotency_key, memo)
     VALUES ($1, $2, 'debit', $3, $4, 'withdrawal', 'withdrawal', $5, $6, $7)`,
    [
      txnId,
      args.userId,
      args.amountKobo,
      balanceAfter,
      args.idempotencyKey,
      `${args.idempotencyKey}:reserve`,
      'Withdrawal requested',
    ],
  );
  return { reserved: true, txnId };
}

/** Settlement: money already left `available` at reserve time; release `reserved` to the rails. */
export async function settleReserve(q: QueryFn, args: { userId: string; amountKobo: number; txnId: string }): Promise<void> {
  const upd = await q(
    `UPDATE wallets
        SET reserved_kobo = reserved_kobo - $2, version = version + 1, updated_at = now()
      WHERE user_id = $1 AND reserved_kobo >= $2`,
    [args.userId, args.amountKobo],
  );
  if (upd.rowCount === 0) throw new ConflictException('Reserved balance underflow (double settle?)');
  await q(`UPDATE transactions SET status = 'settled', settled_at = now() WHERE txn_id = $1`, [args.txnId]);
}

/** Failed disbursement: refund reserved → available and write the reversing ledger entry. */
export async function refundReserve(
  q: QueryFn,
  args: { userId: string; amountKobo: number; txnId: string; idempotencyKey: string; memo?: string },
): Promise<void> {
  // Restore the exact split reserveFunds took (legacy envelopes without a
  // recorded split dump back into affiliate — the SUM stays exact regardless).
  const meta = await q<{ bucketSplit: { affiliate?: number; task?: number } | null }>(
    `SELECT metadata->'bucketSplit' AS "bucketSplit" FROM transactions WHERE txn_id = $1`,
    [args.txnId],
  );
  const split = meta.rows[0]?.bucketSplit;
  const affBack =
    split && typeof split.affiliate === 'number' && split.affiliate <= args.amountKobo
      ? split.affiliate
      : args.amountKobo;
  const taskBack = args.amountKobo - affBack;

  const upd = await q<{ available_kobo: string | number }>(
    `UPDATE wallets
        SET reserved_kobo  = reserved_kobo - $2,
            available_kobo = available_kobo + $2,
            affiliate_kobo = affiliate_kobo + $3,
            task_kobo      = task_kobo + $4,
            version        = version + 1, updated_at = now()
      WHERE user_id = $1 AND reserved_kobo >= $2
      RETURNING available_kobo`,
    [args.userId, args.amountKobo, affBack, taskBack],
  );
  if (upd.rows.length === 0) throw new ConflictException('Reserved balance underflow (double refund?)');

  await q(
    `INSERT INTO ledger_entries
       (txn_id, wallet_id, direction, amount_kobo, balance_after, entry_type, idempotency_key, memo)
     VALUES ($1, $2, 'credit', $3, $4, 'withdrawal_reversal', $5, $6)
     ON CONFLICT (idempotency_key, wallet_id, direction) DO NOTHING`,
    [
      args.txnId,
      args.userId,
      args.amountKobo,
      Number(upd.rows[0].available_kobo),
      `${args.idempotencyKey}:refund`,
      args.memo ?? 'Withdrawal reversed',
    ],
  );
  await q(`UPDATE transactions SET status = 'reversed' WHERE txn_id = $1`, [args.txnId]);
}

export function rethrowAsConflict(err: unknown): never {
  if (isUniqueViolation(err)) throw new ConflictException('Duplicate operation (idempotency conflict)');
  throw err;
}
