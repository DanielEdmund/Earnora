import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type Params = readonly unknown[];

export interface QRes<T = any> {
  rows: T[];
  rowCount: number;
}

/** Minimal query signature shared by pg Pool and PGlite (incl. tx-scoped clients). */
export type QueryFn = <T = any>(text: string, params?: Params) => Promise<QRes<T>>;

export interface Db {
  kind: 'pg' | 'pglite';
  query: QueryFn;
  /** Runs fn inside a transaction; commits on resolve, rolls back on throw. Never nest. */
  transaction<T>(fn: (q: QueryFn) => Promise<T>): Promise<T>;
}

export const DB = Symbol('DB');

function wrapPgQuery(r: { rows: any[]; rowCount: number | null }): QRes {
  return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
}

export async function createDb(
  opts: { databaseUrl?: string; pgliteDir?: string; memory?: boolean } = {},
): Promise<Db> {
  if (opts.databaseUrl) {
    const pool = new Pool({ connectionString: opts.databaseUrl, max: 10 });
    return {
      kind: 'pg',
      query: async (text, params) => wrapPgQuery(await pool.query(text, params as any[])),
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn(async (text, params) => wrapPgQuery(await client.query(text, params as any[])));
          await client.query('COMMIT');
          return out;
        } catch (err) {
          try {
            await client.query('ROLLBACK');
          } catch {
            /* connection already dead */
          }
          throw err;
        } finally {
          client.release();
        }
      },
    };
  }

  const pglite = new PGlite(opts.memory ? undefined : (opts.pgliteDir ?? './.pglite'));
  await pglite.waitReady;
  return {
    kind: 'pglite',
    query: async (text, params) => {
      const r: any = await pglite.query(text, params as any);
      return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length };
    },
    transaction: async (fn) =>
      pglite.transaction((tx: any) =>
        fn(async (text, params) => {
          const r: any = await tx.query(text, params as any);
          return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length };
        }),
      ) as Promise<any>,
  };
}

/** Applies all .sql files in migrations/ exactly once (tracked in schema_migrations). */
export async function runMigrations(db: Db): Promise<string[]> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  );
  const dir = path.join(process.cwd(), 'migrations');
  if (!fs.existsSync(dir)) return [];
  const applied: string[] = [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const done = await db.query('SELECT 1 FROM schema_migrations WHERE id = $1', [file]);
    if (done.rows.length > 0) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const stmt of splitStatements(sql)) await db.query(stmt);
    await db.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
    applied.push(file);
  }
  return applied;
}

/**
 * Splits a SQL script into statements. Tracks single-quoted strings and `--`
 * line comments so semicolons inside them never break a statement.
 */
function splitStatements(sql: string): string[] {
  const stmts: string[] = [];
  let current = '';
  let inQuote = false;
  let inLineComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (!inQuote && ch === '-' && next === '-') {
      inLineComment = true;
      current += ch;
      continue;
    }
    if (ch === "'") {
      inQuote = !inQuote; // '' escape toggles twice → net correct
      current += ch;
      continue;
    }
    if (!inQuote && ch === ';') {
      stmts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) stmts.push(current);

  return stmts
    .map((s) => s.trim())
    .filter((s) => {
      if (s.length === 0) return false;
      // drop chunks that are only comments (e.g. trailing file headers)
      const meaningful = s.split('\n').filter((l) => l.trim().length > 0 && !l.trim().startsWith('--'));
      return meaningful.length > 0;
    });
}

/** True when the error is a unique-constraint violation (SQLSTATE 23505). */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as any).code === '23505';
}
