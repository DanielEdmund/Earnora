import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { config } from '../config';
import { DB, Db, QueryFn } from './db';

export const TOPICS = {
  TASK_CLAIMED: 'task.claimed',
  TASK_SUBMITTED: 'task.submitted',
  TASK_APPROVED: 'task.approved',
  TASK_REJECTED: 'task.rejected',
  USER_ACTIVATED: 'user.activated',
  REFERRAL_CREDITED: 'referral.credited',
  WALLET_CREDITED: 'wallet.credited',
  WITHDRAWAL_REQUESTED: 'withdrawal.requested',
  WITHDRAWAL_PAID: 'withdrawal.paid',
  WITHDRAWAL_REVERSED: 'withdrawal.reversed',
  RISK_FLAGGED: 'risk.flagged',
} as const;

export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

/** Typed in-process event hub fed by the outbox relay (swap for Kafka consumers at scale). */
@Injectable()
export class EventBus {
  private emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(100);
  }
  emit(topic: string, payload: unknown): void {
    this.emitter.emit(topic, payload);
  }
  on(topic: string, handler: (payload: any) => void): void {
    this.emitter.on(topic, handler);
  }
  raw(): EventEmitter {
    return this.emitter;
  }
}

/**
 * Transactional outbox writer. Call INSIDE the same DB transaction as the state
 * change so events can never be lost or emitted for work that rolled back.
 */
@Injectable()
export class OutboxService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async publish(q: QueryFn, topic: Topic, payload: unknown): Promise<void> {
    await q(`INSERT INTO outbox_events (topic, payload) VALUES ($1, $2::jsonb)`, [topic, JSON.stringify(payload)]);
  }

  /** Convenience for fire-and-forget publishes outside a transaction. */
  async publishNow(topic: Topic, payload: unknown): Promise<void> {
    await this.db.transaction((q) => this.publish(q, topic, payload));
  }
}

/**
 * Drains outbox_events to the EventBus. At scale this relay publishes to Kafka
 * instead; the contract (topic + payload) stays identical.
 */
@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('OutboxRelay');
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.drain(), config.outboxPollMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      await this.db.transaction(async (q) => {
        const batch = await q(
          `SELECT id, topic, payload FROM outbox_events
            WHERE published_at IS NULL
            ORDER BY id
            LIMIT 50
            FOR UPDATE SKIP LOCKED`,
        );
        for (const row of batch.rows) {
          try {
            this.bus.emit(row.topic, typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload);
          } catch (err) {
            this.log.error(`handler for ${row.topic} failed: ${(err as Error).message}`);
          }
          await q(`UPDATE outbox_events SET published_at = now() WHERE id = $1`, [row.id]);
        }
      });
    } catch (err) {
      this.log.error(`drain failed: ${(err as Error).message}`);
    } finally {
      this.draining = false;
    }
  }
}
