import { Module } from '@nestjs/common';
import { PayoutBatcher } from './payout.batcher';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';

@Module({
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService, PayoutBatcher],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
