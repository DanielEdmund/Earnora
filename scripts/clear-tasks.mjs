/**
 * One-off utility: wipe the task tables so fresh tasks can be created.
 * (Owner request — "clear all the tasks so I can create new ones".)
 *
 * Deletes, in FK-safe order: task_claims → tasks. Money already paid out stays
 * untouched (transactions / ledger_entries are append-only and have no FK to
 * tasks). proof_files are content-addressed and shared, so they are kept.
 *
 * Usage:
 *   node scripts/clear-tasks.mjs        # local PGlite (API must be stopped)
 *   DATABASE_URL=postgres://... node scripts/clear-tasks.mjs   # remote Postgres
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const url = process.env.DATABASE_URL;

let db;
if (url) {
  const { Client } = await import('pg');
  db = {
    query: (sql) => {
      const c = new Client({ connectionString: url });
      return c.connect().then(() => c.query(sql).then((r) => (c.end(), r)));
    },
    close: () => {},
  };
  console.log(`remote database: ${url.replace(/:[^:@/]+@/, ':***@').slice(0, 60)}...`);
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite(path.join(root, '.pglite'));
  console.log('local PGlite database (.pglite)');
}

const before = await db.query('SELECT (SELECT count(*) FROM tasks) AS tasks, (SELECT count(*) FROM task_claims) AS claims');
console.log(`before: ${before.rows[0].tasks} tasks, ${before.rows[0].claims} claims`);
await db.query('DELETE FROM task_claims');
await db.query('DELETE FROM tasks');
const after = await db.query('SELECT (SELECT count(*) FROM tasks) AS tasks, (SELECT count(*) FROM task_claims) AS claims');
console.log(`after:  ${after.rows[0].tasks} tasks, ${after.rows[0].claims} claims — done`);
await db.close?.();
