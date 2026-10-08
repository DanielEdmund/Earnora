/**
 * Applies migrations/*.sql to DATABASE_URL exactly once (tracked in
 * schema_migrations) — the same runner the API uses at boot, but runnable
 * from a workstation against a remote database (e.g. before the first deploy
 * to Vercel, where the migrations folder is not part of the function bundle).
 *
 * Usage:  DATABASE_URL=postgres://... npm run migrate   (after `npm run build`)
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

if (!existsSync(path.join(root, 'dist', 'common', 'db.js'))) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL (postgres://user:pass@host/db?sslmode=require).');
  process.exit(1);
}

const { createDb, runMigrations } = require(path.join(root, 'dist', 'common', 'db.js'));
const db = await createDb({ databaseUrl: url });
const applied = await runMigrations(db);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'schema already up to date');
