import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { BootstrapService } from './bootstrap.service';
import { CommonModule } from './common/common.module';
import { HealthController } from './health.controller';
import { PaymentsModule } from './payments/payments.module';
import { PlansModule } from './plans/plans.module';
import { ReferralsModule } from './referrals/referrals.module';
import { SupportModule } from './support/support.module';
import { TasksModule } from './tasks/tasks.module';
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';

@Module({
  imports: [
    CommonModule, // db + cache + event bus/outbox (global)
    AuthModule, // jwt guard (global) + register/login/refresh
    UsersModule,
    WalletModule,
    ReferralsModule,
    PaymentsModule,
    PlansModule,
    TasksModule,
    WithdrawalsModule,
    AdminModule, // ops dashboard read models (admin only)
    SupportModule, // chat escalation inbox (bot → admin → back to the chat)
  ],
  controllers: [HealthController],
  providers: [BootstrapService],
})
export class AppModule {}
