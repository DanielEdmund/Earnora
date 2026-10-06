import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { config } from '../config';
import { CacheService } from './cache';

/**
 * Server-issued proof-of-work challenges defeat dumb claim scripts:
 * the client must burn CPU to echo a nonce whose SHA-256 has N leading zeros.
 */
@Injectable()
export class PowService {
  constructor(@Inject(CacheService) private readonly cache: CacheService) {}

  async issue(userId: string): Promise<{ challenge: string; bits: number; ttlSec: number }> {
    const challenge = randomBytes(16).toString('hex');
    const ttlSec = 60;
    await this.cache.set(`pow:${userId}:${challenge}`, '1', ttlSec);
    return { challenge, bits: config.fraud.powDifficultyBits, ttlSec };
  }

  async verify(userId: string, challenge: string, nonce: string): Promise<void> {
    if (!challenge || !nonce) throw new BadRequestException('Missing proof-of-work (x-pow-challenge / x-pow-nonce)');
    const key = `pow:${userId}:${challenge}`;
    const ok = await this.cache.get(key);
    if (!ok) throw new BadRequestException('Proof-of-work challenge expired or unknown');
    await this.cache.del(key); // single-use

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
