import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '../config';

/**
 * Coordination cache: claim locks, rate limits, idempotency shields, window flags.
 * NEVER the source of truth for money. Two implementations behind one interface:
 * Redis (production) and an in-process TTL map (zero-dependency local dev).
 */
@Injectable()
export abstract class CacheService {
  abstract get(key: string): Promise<string | null>;
  abstract set(key: string, value: string, ttlSec?: number): Promise<void>;
  /** Atomic set-if-absent. Returns true when the caller won the lock. */
  abstract setNx(key: string, value: string, ttlSec: number): Promise<boolean>;
  /** Atomic increment with TTL applied on first increment. */
  abstract incr(key: string, ttlSec: number): Promise<number>;
  abstract del(key: string): Promise<void>;
  abstract incrementBy(key: string, amount: number, ttlSec?: number): Promise<number>;
}

class MemoryCache extends CacheService {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  private purge(key: string): void {
    const e = this.store.get(key);
    if (e && e.expiresAt !== null && e.expiresAt <= Date.now()) this.store.delete(key);
  }

  async get(key: string): Promise<string | null> {
    this.purge(key);
    return this.store.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    this.store.set(key, { value, expiresAt: ttlSec ? Date.now() + ttlSec * 1000 : null });
  }

  async setNx(key: string, value: string, ttlSec: number): Promise<boolean> {
    this.purge(key);
    if (this.store.has(key)) return false;
    this.store.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
    return true;
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    return this.incrementBy(key, 1, ttlSec);
  }

  async incrementBy(key: string, amount: number, ttlSec?: number): Promise<number> {
    this.purge(key);
    const cur = Number(this.store.get(key)?.value ?? '0') + amount;
    const existing = this.store.get(key);
    this.store.set(key, {
      value: String(cur),
      expiresAt: existing?.expiresAt ?? (ttlSec ? Date.now() + ttlSec * 1000 : null),
    });
    return cur;
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

class RedisCache extends CacheService {
  constructor(private redis: Redis) {
    super();
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    if (ttlSec) await this.redis.set(key, value, 'EX', ttlSec);
    else await this.redis.set(key, value);
  }

  async setNx(key: string, value: string, ttlSec: number): Promise<boolean> {
    const res = await this.redis.set(key, value, 'EX', ttlSec, 'NX');
    return res === 'OK';
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, ttlSec);
    return n;
  }

  async incrementBy(key: string, amount: number, ttlSec?: number): Promise<number> {
    const n = await this.redis.incrby(key, amount);
    if (ttlSec && n === amount) await this.redis.expire(key, ttlSec);
    return n;
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

export function createCache(): CacheService {
  if (config.redisUrl) {
    const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
    void redis.connect().catch((e) => console.error('[cache] redis connect failed, falling back:', e.message));
    return new RedisCache(redis);
  }
  return new MemoryCache();
}
