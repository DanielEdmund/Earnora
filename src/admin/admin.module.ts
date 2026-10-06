import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { SupportModule } from '../support/support.module';
import { AdminController } from './admin.controller';

/** Read-model + approval endpoints that power the admin operations dashboard. */
@Module({ imports: [PaymentsModule, SupportModule], controllers: [AdminController] })
export class AdminModule {}
