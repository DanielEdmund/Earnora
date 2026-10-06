import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { config } from '../config';
import { PLAN_LIST } from './plans';

@Controller('plans')
export class PlansController {
  /** Public catalog: what each plan costs and gives (used by the landing page + app). */
  @Public()
  @Get()
  catalog() {
    return {
      plans: PLAN_LIST,
      minWithdrawalKobo: config.withdrawal.minKobo,
      withdrawalWindow: config.withdrawal.window,
      timezone: config.withdrawal.tz,
    };
  }
}
