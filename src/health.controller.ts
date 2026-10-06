import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from './auth/decorators';
import { CacheService } from './common/cache';
import { DB, Db } from './common/db';

@Controller()
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CacheService) private readonly cache: CacheService,
  ) {}

  @Public()
  @Get('health')
  async health() {
    const checks: Record<string, string> = {};
    try {
      await this.db.query('SELECT 1');
      checks.database = `ok (${this.db.kind})`;
    } catch (e) {
      checks.database = `error: ${(e as Error).message}`;
    }
    try {
      await this.cache.set('health:probe', '1', 10);
      checks.cache = 'ok';
    } catch (e) {
      checks.cache = `error: ${(e as Error).message}`;
    }
    const ok = Object.values(checks).every((v) => v.startsWith('ok'));
    return { status: ok ? 'healthy' : 'degraded', checks, uptimeSec: Math.round(process.uptime()) };
  }
}
