import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { config } from '../config';
import { DB, Db } from './db';

/**
 * Server-issued proof-of-work challenges defeat dumb claim scripts:
 * the client must burn CPU to echo a nonce whose SHA-256 has N leading zeros.
 *
 * Challenges live in the database (not the per-process cache) because the API
 * can run on several serverless instances at once: the instance that issued the
 * challenge may not be the one that verifies the claim. Single-use is enforced
 * with an atomic `DELETE … RETURNING`, so a replay loses the race and fails.
 */
@Injectable()
export class PowService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async issue(userId: string): Promise<{ challenge: string; bits: number; ttlSec: number }> {
    const challenge = randomBytes(16).toString('hex');
    const ttlSec = 60;
    // sweep expired rows on the way past (tiny table: only the last 60s live here)
    await this.db.query(`DELETE FROM pow_challenges WHERE expires_at < now()`);
    await this.db.query(
      `INSERT INTO pow_challenges (id, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))`,
      [challenge, userId, ttlSec],
    );
    return { challenge, bits: config.fraud.powDifficultyBits, ttlSec };
  }

  async verify(userId: string, challenge: string, nonce: string): Promise<void> {
    if (!challenge || !nonce) throw new BadRequestException('Missing proof-of-work (x-pow-challenge / x-pow-nonce)');
    const r = await this.db.query<{ id: string }>(
      `DELETE FROM pow_challenges WHERE id = $1 AND user_id = $2 AND expires_at > now() RETURNING id`,
      [challenge, userId],
    );
    if (r.rows.length === 0) throw new BadRequestException('Proof-of-work challenge expired or unknown');

    const digest = createHash('sha256').update(`${challenge}:${nonce}`).digest();
    if (!hasLeadingZeroBits(digest, config.fraud.powDifficultyBits)) {
      throw new BadRequestException('Proof-of-work verification failed');
    }
  }
}

export function hasLeadingZeroBits(buf: Buffer, bits: number): boolean {
  let fullBytes = Math.floor(bits / 8);
  for (let i = 0; i < fullBytes; i++) if (buf[i] !== 0) return false;
  const rem = bits % 8;
  if (rem === 0) return true;
  return (buf[fullBytes] >> (8 - rem)) === 0;
}
