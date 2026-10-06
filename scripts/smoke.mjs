/* End-to-end smoke test (plan flow):
 * health -> register referrer -> plan gating (tasks/withdrawals locked) ->
 * referrer transfer recorded + admin approves -> referred user transfer +
 * approval -> flat referral bonus -> plan-priced task feed -> PoW claim ->
 * dwell -> submit -> auto-approve -> wallet -> withdrawal payout.
 *
 * Also asserts the manual-payment security posture: the payment grants
 * nothing before admin approval, /payments/simulate is gone (404) and the
 * PSP webhook is shut (404) while PSP_MODE=simulated.
 *
 * Run: node scripts/smoke.mjs   (server must be up on :3000,
 *      started with MIN_WITHDRAWAL_KOBO=10000 so the payout check fits) */
import { createHash, randomBytes } from 'node:crypto';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const results = [];
let failures = 0;

function check(name, cond, detail = '') {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

let skips = 0;
function skip(name, detail = '') {
  skips++;
  results.push(`SKIP  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-json */
  }
  return { status: res.status, body };
}

function minePow(challenge, bits) {
  const hasZeros = (buf) => {
    const full = Math.floor(bits / 8);
    for (let i = 0; i < full; i++) if (buf[i] !== 0) return false;
    const rem = bits % 8;
    return rem === 0 || buf[full] >> (8 - rem) === 0;
  };
  for (let nonce = 0; nonce < 5_000_000; nonce++) {
    const d = createHash('sha256').update(`${challenge}:${nonce}`).digest();
    if (hasZeros(d)) return String(nonce);
  }
  throw new Error('PoW mining failed');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await api('/health');
      if (r.status === 200) return r.body;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('server did not become healthy');
}

async function register(email, referralCode) {
  return api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password: 'password123',
      referralCode: referralCode || undefined,
    }),
    auth: false,
  });
}

async function get(path, token) {
  return api(path, { headers: { authorization: `Bearer ${token}` } });
}

async function post(path, token, body) {
  return api(path, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body ?? {}) });
}

/** initialize → the payment is recorded confirmed but grants NOTHING until the
 *  admin approves (manual bank-transfer flow). Returns { ref, init, approve }. */
async function initializePlan(token, planKey) {
  const init = await post('/payments/initialize', token, { planKey });
  if (init.status !== 200 || !init.body?.reference) {
    throw new Error(`initialize ${planKey}: ${init.status} ${JSON.stringify(init.body)}`);
  }
  return init;
}

async function approvePlan(adminTok, ref) {
  return post(`/admin/payments/${ref}/approve`, adminTok, {});
}

async function main() {
  // ── health ──────────────────────────────────────────────────────────────
  const health = await waitForHealth();
  check('health endpoint', health.status === 'healthy', JSON.stringify(health.checks));

  // ── admin session (manual flow: every payment needs the owner's approval) ─
  const adminLogin = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL || 'admin@earnora.local',
      password: process.env.ADMIN_PASSWORD || 'Admin123!',
    }),
    auth: false,
  });
  const adminTok = adminLogin.body?.tokens?.accessToken;
  check('admin login (payment approver)', Boolean(adminTok), `status=${adminLogin.status}`);

  // ── plan catalog (public) ───────────────────────────────────────────────
  const catalog = await api('/plans', { auth: false });
  const plans = catalog.body?.plans ?? [];
  check('plan catalog: 3 plans', catalog.status === 200 && plans.length === 3, `count=${plans.length}`);
  check(
    'plan prices: ₦3,000 / ₦6,500 / ₦10,500',
    plans[0]?.priceKobo === 300_000 && plans[1]?.priceKobo === 650_000 && plans[2]?.priceKobo === 1_050_000,
    plans.map((p) => p.priceKobo).join('/'),
  );
  check(
    'quotas: 3 / 6 / 10 tasks per day',
    plans[0]?.dailyTaskLimit === 3 && plans[1]?.dailyTaskLimit === 6 && plans[2]?.dailyTaskLimit === 10,
    plans.map((p) => p.dailyTaskLimit).join('/'),
  );
  check(
    'per-task rewards: ₦200 / ₦300 / ₦400',
    plans[0]?.taskRewardKobo === 20_000 && plans[1]?.taskRewardKobo === 30_000 && plans[2]?.taskRewardKobo === 40_000,
    plans.map((p) => p.taskRewardKobo).join('/'),
  );
  check(
    'referral bonuses: ₦200 / ₦400 / ₦600',
    plans[0]?.referralBonusKobo === 20_000 && plans[1]?.referralBonusKobo === 40_000 && plans[2]?.referralBonusKobo === 60_000,
    plans.map((p) => p.referralBonusKobo).join('/'),
  );

  // ── registration ────────────────────────────────────────────────────────
  const stamp = Date.now();
  const alice = await register(`alice_${stamp}@smoke.local`);
  const aliceTok = alice.body?.tokens?.accessToken;
  check('register returns tokens', Boolean(aliceTok));

  const ref = await get('/referrals', aliceTok);
  const code = ref.body?.referralCode;
  check('referral code issued', Boolean(code), code);

  const bob = await register(`bob_${stamp}@smoke.local`, code);
  const bobTok = bob.body?.tokens?.accessToken;
  check('register with referral code', Boolean(bobTok));

  // ── gating: no plan → no tasks, no withdrawals ──────────────────────────
  const locked = await get('/tasks', bobTok);
  check('tasks locked without a plan (403)', locked.status === 403, `status=${locked.status}`);

  const wdLocked = await post('/withdrawals', bobTok, {
    amountKobo: 2_000_000,
    bankCode: '058',
    accountNumber: '0123456789',
  });
  check('withdrawals locked without a plan (403)', wdLocked.status === 403, `status=${wdLocked.status}`);

  const badPlan = await post('/payments/initialize', aliceTok, { planKey: 'platinum' });
  check('unknown plan rejected (400)', badPlan.status === 400, `status=${badPlan.status}`);

  // ── plan purchase: alice (the referrer) buys first ──────────────────────
  const aliceInit = await initializePlan(aliceTok, 'beginner');
  const aliceRef = aliceInit.body.reference;
  check(
    'initialize: confirmed but awaiting approval, no checkout URL',
    aliceInit.body?.authorizationUrl === null && aliceInit.body?.mode === 'simulated',
    JSON.stringify(aliceInit.body),
  );

  // the self-attested payment grants nothing yet — and the forgeable paths are shut
  const pendingRow = await get(`/payments/${aliceRef}`, aliceTok);
  check(
    'payment waits in approval=pending',
    pendingRow.body?.status === 'success' && pendingRow.body?.approval === 'pending',
    `${pendingRow.body?.status}/${pendingRow.body?.approval}`,
  );
  check('tasks still locked before admin approval', (await get('/tasks', aliceTok)).status === 403);

  const simulateGone = await api(`/payments/simulate/${aliceRef}`, { method: 'POST', body: JSON.stringify({ outcome: 'success' }) });
  check('simulate endpoint removed (404)', simulateGone.status === 404, `status=${simulateGone.status}`);

  const forgedHook = await api('/webhooks/paystack', {
    method: 'POST',
    headers: { 'x-paystack-signature': 'deadbeef'.repeat(16) },
    body: JSON.stringify({ event: 'charge.success', data: { reference: aliceRef, amount: 300_000 } }),
  });
  check('webhook disabled in manual mode (404)', forgedHook.status === 404, `status=${forgedHook.status}`);

  const aliceApprove = await approvePlan(adminTok, aliceRef);
  check(
    'admin approval grants the plan',
    (aliceApprove.status === 200 || aliceApprove.status === 201) && aliceApprove.body?.ok === true,
    `${aliceApprove.status} ${JSON.stringify(aliceApprove.body)}`,
  );

  const aliceMe = await get('/me', aliceTok);
  check(
    'plan assigned + account active',
    aliceMe.body?.user?.plan === 'beginner' && aliceMe.body?.user?.status === 'active',
    `${aliceMe.body?.user?.plan}/${aliceMe.body?.user?.status}`,
  );
  check('one-time plan purchase (second buy blocked)', (await post('/payments/initialize', aliceTok, { planKey: 'intermediate' })).status === 409);

  // alice's plan fee went to the platform, NOT her wallet
  const aliceWallet0 = await get('/wallet', aliceTok);
  check('plan fee not credited to wallet', Number(aliceWallet0.body?.available_kobo) === 0, `balance=${aliceWallet0.body?.available_kobo}`);

  // ── bob buys his plan → flat bonus to alice at ALICE's plan rate ────────
  const bobInit = await initializePlan(bobTok, 'beginner');
  const bobApprove = await approvePlan(adminTok, bobInit.body.reference);
  check(
    'bob plan approval settles',
    (bobApprove.status === 200 || bobApprove.status === 201) && bobApprove.body?.ok === true,
    `${bobApprove.status} ${JSON.stringify(bobApprove.body)}`,
  );

  const aliceWallet1 = await get('/wallet', aliceTok);
  check(
    'flat referral bonus = ₦200 (referrer plan rate)',
    Number(aliceWallet1.body?.available_kobo) === 20_000,
    `balance=${aliceWallet1.body?.available_kobo}`,
  );

  const refSummary = await get('/referrals', aliceTok);
  check('referral summary shows plan rates', refSummary.body?.myPlan === 'beginner' && refSummary.body?.yourRateKobo === 20_000);
  check('referred user listed', Array.isArray(refSummary.body?.directReferrals) && refSummary.body.directReferrals.length >= 1);

  const bobMe = await get('/me', bobTok);
  check('bob plan + active', bobMe.body?.user?.plan === 'beginner' && bobMe.body?.user?.status === 'active');
  check('settings expose min withdrawal', Number(bobMe.body?.settings?.minWithdrawalKobo) > 0, `min=${bobMe.body?.settings?.minWithdrawalKobo}`);

  // ── task feed is now open; rewards come from the PLAN ───────────────────
  const tasks = await get('/tasks', bobTok);
  check('task feed lists demo tasks', tasks.status === 200 && Array.isArray(tasks.body) && tasks.body.length > 0, `count=${tasks.body?.length}`);
  const task = (tasks.body ?? []).find((t) => t.category === 'survey') ?? tasks.body?.[0];
  check('task reward = plan rate (₦200 for Beginner)', Number(task?.reward_kobo) === 20_000, `reward=${task?.reward_kobo}`);

  const mine0 = await get('/tasks/mine', bobTok);
  check('my claims starts empty', Array.isArray(mine0.body) && mine0.body.length === 0, `count=${mine0.body?.length}`);

  // ── anti-bot challenge ──────────────────────────────────────────────────
  const ch = await get('/tasks/challenge', bobTok);
  check('PoW challenge issued', ch.status === 200 && Boolean(ch.body?.challenge) && typeof ch.body?.bits === 'number');
  const nonce = minePow(ch.body.challenge, ch.body.bits);
  check('PoW solution found', typeof nonce === 'string', `nonce=${nonce}`);

  const headers = {
    authorization: `Bearer ${bobTok}`,
    'x-anon-id': 'anon_smoke',
    'x-client-ts': String(Date.now()),
    'x-fp': `fp_${randomBytes(6).toString('hex')}`,
    'x-pow-nonce': nonce,
    'x-pow-challenge': ch.body.challenge,
  };

  // ── claim (daily counter comes back with the claim) ─────────────────────
  const claim = await api(`/tasks/${task.id}/claim`, { method: 'POST', headers, body: JSON.stringify({}) });
  check('claim accepted', claim.status === 201 || claim.status === 200, `status=${claim.status} ${JSON.stringify(claim.body)}`);
  check(
    'daily usage counter in claim response',
    claim.body?.tasksToday === 1 && claim.body?.dailyTaskLimit === 3,
    `${claim.body?.tasksToday}/${claim.body?.dailyTaskLimit}`,
  );
  const claimId = claim.body?.claimId;

  const again = await api(`/tasks/${task.id}/claim`, { method: 'POST', headers, body: JSON.stringify({}) });
  // 400 = single-use PoW challenge consumed first; 409 = already-claimed conflict — both are rejections
  check('double claim rejected', again.status === 409 || again.status === 400, `status=${again.status}`);

  // ── dwell time: an immediate submit (backdated client clock) must fail ───
  const tooFast = await api(`/tasks/${task.id}/submit`, {
    method: 'POST',
    headers: { ...headers, 'x-client-ts': String(Date.now() - 30_000) },
    body: JSON.stringify({ payload: { q1: 'a', q2: 'b', age: '25' } }),
  });
  check('dwell-time enforced', tooFast.status === 400, `status=${tooFast.status}`);

  await sleep(5_500);

  // unique per run: the proof-hash dedupe cache is global for 30 days,
  // so a fixed payload would collide with previous smoke runs
  const runTag = randomBytes(8).toString('hex');
  const payload = {
    q1: 'Groceries online',
    q2: 'Weekly',
    age: '26',
    note: `smoke test submission ${runTag}`.padEnd(60, 'x'),
  };
  const submit = await api(`/tasks/${task.id}/submit`, {
    method: 'POST',
    headers: { ...headers, 'x-client-ts': String(Date.now()) },
    body: JSON.stringify({ payload }),
  });
  check('submit accepted', submit.status === 201 || submit.status === 200, `status=${submit.status} ${JSON.stringify(submit.body)}`);

  // duplicate proof rejected for a second user on the same task
  const carol = await register(`carol_${stamp}@smoke.local`);
  const carolTok = carol.body?.tokens?.accessToken;
  const carolInit = await initializePlan(carolTok, 'extreme'); // also exercises a second plan
  const carolApprove = await approvePlan(adminTok, carolInit.body.reference);
  check(
    'extreme plan approval settles',
    (carolApprove.status === 200 || carolApprove.status === 201) && carolApprove.body?.ok === true,
    `${carolApprove.status} ${JSON.stringify(carolApprove.body)}`,
  );
  const ch2 = await get('/tasks/challenge', carolTok);
  const nonce2 = minePow(ch2.body.challenge, ch2.body.bits);
  const carolHeaders = {
    authorization: `Bearer ${carolTok}`,
    'x-anon-id': 'anon_smoke2',
    'x-client-ts': String(Date.now()),
    'x-fp': `fp_${randomBytes(6).toString('hex')}`,
    'x-pow-nonce': nonce2,
    'x-pow-challenge': ch2.body.challenge,
  };
  const carolClaim = await api(`/tasks/${task.id}/claim`, { method: 'POST', headers: carolHeaders, body: JSON.stringify({}) });
  check('second user can claim same task', carolClaim.status < 300, `status=${carolClaim.status}`);
  await sleep(5_500);
  const dup = await api(`/tasks/${task.id}/submit`, {
    method: 'POST',
    headers: { ...carolHeaders, 'x-client-ts': String(Date.now()) },
    body: JSON.stringify({ payload }),
  });
  check('duplicate proof rejected (409)', dup.status === 409, `status=${dup.status}`);

  // ── auto-approval pays the PLAN rate ────────────────────────────────────
  await sleep(2_500);
  const wallet = await get('/wallet', bobTok);
  check('reward credited = ₦200 (plan rate)', Number(wallet.body?.available_kobo) === 20_000, `balance=${wallet.body?.available_kobo}`);

  const claims = await get('/tasks/mine', bobTok);
  const approved = claims.body?.find((c) => c.id === claimId && c.status === 'approved');
  check('claim auto-approved', Boolean(approved), JSON.stringify(approved && { status: approved.status, reward: approved.reward_kobo }));

  const statement = await get('/wallet/transactions', bobTok);
  check('append-only statement has entries', Array.isArray(statement.body) && statement.body.length >= 1, `entries=${statement.body?.length}`);

  const flags = await get('/me/fraud-flags', bobTok);
  check('no fraud flags raised for honest run', Array.isArray(flags.body) && flags.body.length === 0, `flags=${flags.body?.length}`);

  // ── withdrawal (needs a plan — bob has one) ─────────────────────────────
  const win = await get('/withdrawals/window', bobTok);
  check('window status reported', typeof win.body?.open === 'boolean', JSON.stringify(win.body));

  const balanceKobo = Number(wallet.body?.available_kobo);
  const minKobo = Number(bobMe.body?.settings?.minWithdrawalKobo) || 1_500_000;

  if (balanceKobo >= minKobo) {
    // session earnings cover the live minimum → exercise the full payout chain
    // (run the suite with MIN_WITHDRAWAL_KOBO=10000 to reach this path)
    const wdAmount = Math.min(minKobo, balanceKobo);
    check('balance covers test withdrawal', balanceKobo >= wdAmount && wdAmount > 0, `amount=${wdAmount}`);

    const wd = await post('/withdrawals', bobTok, { amountKobo: wdAmount, bankCode: '058', accountNumber: '0123456789' });
    check('withdrawal admitted', wd.status === 202, `status=${wd.status} ${JSON.stringify(wd.body)}`);

    const wd2 = await post('/withdrawals', bobTok, { amountKobo: wdAmount, bankCode: '058', accountNumber: '0123456789' });
    check('second withdrawal in window blocked', wd2.status === 409, `status=${wd2.status}`);

    const queue = await get('/withdrawals', bobTok);
    check('withdrawal history lists request', Array.isArray(queue.body) && queue.body.length >= 1, `count=${queue.body?.length}`);

    // payout batcher settles the queue
    const deadline = Date.now() + 20_000;
    let paid = false;
    while (Date.now() < deadline) {
      const h = await get('/withdrawals', bobTok);
      if (h.body?.[0]?.status === 'paid') { paid = true; break; }
      await sleep(1_000);
    }
    check('payout batcher settles withdrawal', paid);

    if (paid) {
      const w2 = await get('/wallet', bobTok);
      const expected = balanceKobo - wdAmount;
      check(
        'funds reserved→paid correctly',
        Number(w2.body?.available_kobo) === expected,
        `balance=${w2.body?.available_kobo} expected=${expected}`,
      );
    }
  } else {
    // live minimum (₦15,000) exceeds what a single session can earn →
    // verify the policy itself rejects under-minimum requests
    const tooSmall = await post('/withdrawals', bobTok, {
      amountKobo: balanceKobo || 1,
      bankCode: '058',
      accountNumber: '0123456789',
    });
    check(
      'below-minimum withdrawal rejected (400)',
      tooSmall.status === 400,
      `status=${tooSmall.status} amount=${balanceKobo} min=${minKobo}`,
    );
    skip(
      'withdrawal admit/payout chain',
      `session balance ₦${balanceKobo / 100} < live min ₦${minKobo / 100} — re-run with MIN_WITHDRAWAL_KOBO=10000 to exercise payouts`,
    );
  }

  // ── public stats include plan holders ───────────────────────────────────
  const stats = await api('/public/stats', { auth: false });
  check('public stats live', stats.status === 200 && Number(stats.body?.active_users) >= 3, JSON.stringify(stats.body));

  // ── report ──────────────────────────────────────────────────────────────
  console.log('\n' + results.join('\n'));
  const passed = results.length - failures - skips;
  console.log(`\n${passed}/${passed + failures} checks passed${skips ? `, ${skips} skipped` : ''}`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\nSMOKE ABORTED:', err.message);
  console.log('\n' + results.join('\n'));
  process.exit(1);
});
