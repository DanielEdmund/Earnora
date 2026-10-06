// One-off data purge: remove ALL test users (keep admin/system + owner's real
// accounts) and ALL test tasks, preserving tasks the owner published for real.
// Run with the API DOWN (PGlite is single-process). Reversible via the
// .pglite-backup-* copy.
import { PGlite } from '@electric-sql/pglite';

// role <> 'user' additionally keeps admin@earnora.local / platform@earnora.local.
const KEEP_EMAILS = ['danieledmund42@gmail.com', 'edmumddaniel@gmail.com', 'ukedmund33@gmail.com'];

// Real tasks published by the owner - everything else (E2E / fake titles) goes.
const KEEP_TASK_TITLES = ['Join the Whatsapp group'];

const db = new PGlite('./.pglite');
const q = (sql, params) => db.query(sql, params);
const n = async (sql) => Number((await q(sql)).rows[0].n);
const log = (s) => console.log(s);
// Inline SQL list (NOT a bind param): PGlite's param path silently mis-parses
// the array literal here, which once wiped an owner task - keep it deterministic.
const keepTaskList = KEEP_TASK_TITLES.map((t) => `'${t.replace(/'/g, "''")}'`).join(', ');

try {
  const before = {
    users: await n('SELECT count(*)::int AS n FROM users'),
    tasks: await n('SELECT count(*)::int AS n FROM tasks'),
    claims: await n('SELECT count(*)::int AS n FROM task_claims'),
    wallets: await n('SELECT count(*)::int AS n FROM wallets'),
    ledger: await n('SELECT count(*)::int AS n FROM ledger_entries'),
    fraud: await n('SELECT count(*)::int AS n FROM fraud_flags'),
  };
  log('BEFORE ' + JSON.stringify(before));

  // Rows to remove: every user except admin/system roles and the kept emails.
  await q(`
    CREATE TEMP TABLE keep_users AS
      SELECT id, email FROM users
       WHERE role <> 'user'
          OR lower(email) = ANY($1)`,
    [`{${KEEP_EMAILS.join(',')}}`],
  );
  await q(`CREATE TEMP TABLE del_users AS
             SELECT id FROM users WHERE id NOT IN (SELECT id FROM keep_users)`);

  const keptRows = (await q('SELECT email FROM keep_users ORDER BY email')).rows;
  const delCount = await n('SELECT count(*)::int AS n FROM del_users');
  log('KEEP  ' + keptRows.map((r) => r.email).join(', '));
  log('DELETE ' + delCount + ' users');

  // FK-safe order (self-references first, dependents before users).
  await q(`UPDATE users SET referred_by = NULL WHERE referred_by IN (SELECT id FROM del_users)`);
  await q(`DELETE FROM referral_credits
            WHERE beneficiary_id IN (SELECT id FROM del_users)
               OR source_user_id IN (SELECT id FROM del_users)`);
  await q(`DELETE FROM payments     WHERE user_id IN (SELECT id FROM del_users)`);
  await q(`DELETE FROM withdrawals  WHERE user_id IN (SELECT id FROM del_users)`);
  await q(`DELETE FROM fraud_flags  WHERE user_id IN (SELECT id FROM del_users)`);
  await q(`DELETE FROM transactions WHERE user_id IN (SELECT id FROM del_users)`);
  await q(`DELETE FROM ledger_entries WHERE wallet_id IN (SELECT id FROM del_users)`);
  await q(`DELETE FROM wallets      WHERE user_id IN (SELECT id FROM del_users)`);
  // claims: dropped with their task, or with a removed user; claims on the
  // owner's kept tasks (by kept users) survive
  if (keepTaskList) {
    await q(
      `DELETE FROM task_claims
        WHERE user_id IN (SELECT id FROM del_users)
           OR task_id NOT IN (SELECT id FROM tasks WHERE title IN (${keepTaskList}))`,
    );
    await q(`DELETE FROM tasks WHERE title NOT IN (${keepTaskList})`); // test tasks only
  } else {
    await q(`DELETE FROM task_claims`);
    await q(`DELETE FROM tasks`);
  }
  const keptTasks = (await q('SELECT title FROM tasks ORDER BY title')).rows;
  log('KEPT tasks ' + JSON.stringify(keptTasks.map((r) => r.title)));
  const deleted = await q(`DELETE FROM users WHERE id IN (SELECT id FROM del_users)`);
  log('users deleted: ' + deleted.affectedRows ?? deleted.rowCount ?? '?');

  // Migration bookkeeping: 0005_payment_approval.sql was renamed to
  // 005_payment_approval.sql (runMigrations sorts filenames lexicographically,
  // so 0005 would have run BEFORE 001 on a fresh database). Keep the tracker
  // in sync so boot never re-applies the grandfather UPDATE (which would mark
  // every confirmed payment as approved without a plan).
  await q(`DELETE FROM schema_migrations WHERE id = '0005_payment_approval.sql'`);
  await q(`INSERT INTO schema_migrations (id) VALUES ('005_payment_approval.sql')
             ON CONFLICT (id) DO NOTHING`);
  log('schema_migrations synced for 005_payment_approval.sql');

  const after = {
    users: await n('SELECT count(*)::int AS n FROM users'),
    tasks: await n('SELECT count(*)::int AS n FROM tasks'),
    claims: await n('SELECT count(*)::int AS n FROM task_claims'),
    wallets: await n('SELECT count(*)::int AS n FROM wallets'),
    ledger: await n('SELECT count(*)::int AS n FROM ledger_entries'),
    fraud: await n('SELECT count(*)::int AS n FROM fraud_flags'),
    devices: await n('SELECT count(*)::int AS n FROM user_devices'),
    referrals: await n('SELECT count(*)::int AS n FROM referral_credits'),
    payments: await n('SELECT count(*)::int AS n FROM payments'),
  };
  log('AFTER  ' + JSON.stringify(after));
  const remaining = (await q('SELECT email, role, status FROM users ORDER BY role, email')).rows;
  log('REMAINING: ' + JSON.stringify(remaining));
  log('PURGE OK');
} finally {
  await db.close();
}
