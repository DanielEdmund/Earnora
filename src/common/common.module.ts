import { Global, Module } from '@nestjs/common';
import { config } from '../config';
import { CacheService, createCache } from './cache';
import { DB, Db, createDb, runMigrations } from './db';
import { EventBus, OutboxRelay, OutboxService } from './events';
import { PowService } from './pow';

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: async (): Promise<Db> => {
        const db = await createDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
        const applied = await runMigrations(db);
        if (applied.length) console.log(`[db] applied migrations: ${applied.join(', ')}`);
        console.log(`[db] connected (${db.kind}${config.databaseUrl ? '' : ', embedded'})`);
        return db;
      },
    },
    { provide: CacheService, useFactory: createCache },
    EventBus,
    OutboxService,
    OutboxRelay,
    PowService,
  ],
  exports: [DB, CacheService, EventBus, OutboxService, PowService],
})
export class CommonModule {}
