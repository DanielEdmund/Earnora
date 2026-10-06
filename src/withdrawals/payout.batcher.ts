import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { config } from '../config';
import { isWindowOpen } from '../common/time';
import { WithdrawalsService } from './withdrawals.service';

/**
 * Drains the withdrawal queue during the controlled window using
 * SELECT … FOR UPDATE SKIP LOCKED semantics (claim-on-update), so multiple
 * batcher instances can run without ever double-paying a row.
 *
 * The user request path never talks to the bank — this worker does, at a
 * pace the rails can sustain (the queue absorbs the 17:00 spike).
 */
@Injectable()
export class PayoutBatcher implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('PayoutBatcher');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly withdrawals: WithdrawalsService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), config.payoutBatchMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    // hard gate: rails only run inside the window unless explicitly overridden
    if (!isWindowOpen(config.withdrawal.window, config.withdrawal.tz) && !config.payoutOutsideWindow) {
      return;
    }
    this.running = true;
    try {
      const batch = await this.withdrawals.claimQueuedBatch(20);
      for (const w of batch) {
        try {
          const result = await this.withdrawals.disburse(w);
          if (result.ok) await this.withdrawals.settlePaid(w, result.ref);
          else await this.withdrawals.settleFailed(w, result.error ?? 'transfer failed');
        } catch (err) {
          this.log.error(`withdrawal ${w.id} pipeline error: ${(err as Error).message}`);
          await this.withdrawals.settleFailed(w, (err as Error).message).catch(() => undefined);
        }
      }
    } catch (err) {
      this.log.error(`batch tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
