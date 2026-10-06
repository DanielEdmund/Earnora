import { createHash } from 'node:crypto';
import { HttpException, HttpStatus } from '@nestjs/common';
import { config } from '../config';
import { QueryFn } from '../common/db';

/**
 * Fraud guardrails — pure SQL + query-fn so they run inside the caller's
 * transaction (registration) or standalone (velocity checks).
 *
 * Policy: score & flag rather than silently ban. Hard-stop only the
 * clearest abuse (device fingerprint over the multi-account limit).
 */

export function fingerprintHash(raw: string | undefined | null): string | null {
  if (!raw) return null;
  return createHash('sha256').update(String(raw)).digest('hex');
}

export async function fraudRegisterAccount(
  q: QueryFn,
  args: { userId: string; fingerprint?: string; ip: string; userAgent?: string },
): Promise<void> {
  const fp = fingerprintHash(args.fingerprint);
  if (fp) {
    await q(
      `INSERT INTO user_devices (user_id, fingerprint_hash, ip_last_seen, user_agent)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, fingerprint_hash) DO UPDATE SET last_seen_at = now(), ip_last_seen = EXCLUDED.ip_last_seen`,
      [args.userId, fp, args.ip, args.userAgent ?? null],
    );

    const dupes = await q<{ n: string }>(
      `SELECT count(DISTINCT user_id)::text AS n FROM user_devices WHERE fingerprint_hash = $1`,
      [fp],
    );
    const distinctAccounts = Number(dupes.rows[0].n);
    if (distinctAccounts > config.fraud.maxAccountsPerDevice) {
      await q(
        `INSERT INTO fraud_flags (user_id, reason, severity, details)
         VALUES ($1, 'device_dup', 'block', $2::jsonb)`,
        [args.userId, JSON.stringify({ fingerprint: fp.slice(0, 12), distinctAccounts })],
      );
      const err: any = new Error('Device fingerprint linked to too many accounts');
      err.code = '23505'; // surface as conflict → 409, rolls back registration
      err.response = 'Registration blocked: this device is linked to too many accounts';
      throw err;
    }
  }

  // IP /24 farm detection — soft flag (review queue), never auto-blocks.
  const ip24 = toCidr24(args.ip);
  if (ip24) {
    const recent = await q<{ n: string }>(
      `SELECT count(DISTINCT d.user_id)::text AS n
         FROM user_devices d
        WHERE split_part(d.ip_last_seen, '.', 1) || '.' ||
              split_part(d.ip_last_seen, '.', 2) || '.' ||
              split_part(d.ip_last_seen, '.', 3) || '.0/24' = $1
          AND d.first_seen_at > now() - interval '24 hours'`,
      [ip24],
    );
    const n = Number(recent.rows[0].n);
    if (n > config.fraud.maxAccountsPerIp24) {
      await q(
        `INSERT INTO fraud_flags (user_id, reason, severity, details)
         VALUES ($1, 'ip_farm', 'review', $2::jsonb)`,
        [args.userId, JSON.stringify({ ip24, accounts24h: n })],
      );
      await q(`UPDATE users SET trust_score = GREATEST(trust_score - 25, 10) WHERE id = $1`, [args.userId]);
    }
  }
}

export async function fraudRecordLogin(
  q: QueryFn,
  args: { userId: string; ip: string; fingerprint?: string; userAgent?: string },
): Promise<void> {
  await q(`UPDATE users SET last_login_at = now() WHERE id = $1`, [args.userId]);
  const fp = fingerprintHash(args.fingerprint);
  if (fp) {
    await q(
      `INSERT INTO user_devices (user_id, fingerprint_hash, ip_last_seen, user_agent)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, fingerprint_hash)
       DO UPDATE SET last_seen_at = now(), ip_last_seen = EXCLUDED.ip_last_seen`,
      [args.userId, fp, args.ip, args.userAgent ?? null],
    );
  }
}

/** Sliding-window velocity check, backed by the coordination cache (Redis in prod). */
export async function assertClaimVelocity(cache: {
  incr(k: string, ttl: number): Promise<number>;
}, userId: string): Promise<void> {
  const n = await cache.incr(`velocity:claim:${userId}`, 60);
  if (n > config.fraud.claimVelocityPerMin) {
    throw new HttpException('Too many claim attempts — slow down', HttpStatus.TOO_MANY_REQUESTS);
  }
}

export async function trustOf(q: QueryFn, userId: string): Promise<number> {
  const r = await q<{ trust_score: number }>(`SELECT trust_score FROM users WHERE id = $1`, [userId]);
  return r.rows[0]?.trust_score ?? 0;
}

export async function flagRisk(
  q: QueryFn,
  args: { userId: string; reason: string; severity?: 'flag' | 'review' | 'block'; details?: Record<string, unknown> },
): Promise<void> {
  await q(
    `INSERT INTO fraud_flags (user_id, reason, severity, details) VALUES ($1, $2, $3, $4::jsonb)`,
    [args.userId, args.reason, args.severity ?? 'flag', JSON.stringify(args.details ?? {})],
  );
}

function toCidr24(ip: string): string | null {
  const m = /^(\d+\.\d+\.\d+)\.\d+$/.exec(ip);
  return m ? `${m[1]}.0/24` : null;
}
