import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TasksService } from './tasks.service';

/** Periodic janitor: expires abandoned claims, re-runs missed auto-validations. */
@Injectable()
export class TasksWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('TasksWorker');
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly tasks: TasksService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), 10_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    try {
      const expired = await this.tasks.expireStaleClaims();
      if (expired > 0) this.log.log(`expired ${expired} stale claim(s), quota released`);
      await this.tasks.revalidateStuck();
    } catch (err) {
      this.log.error(`tick failed: ${(err as Error).message}`);
    }
  }
}
