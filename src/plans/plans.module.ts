import { Module } from '@nestjs/common';
import { PlansController } from './plans.controller';

/** Static plan catalog — definitions live in ./plans.ts (shared by payments, tasks & referrals). */
@Module({ controllers: [PlansController] })
export class PlansModule {}
