import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { IsInt, IsString, Matches, Min } from 'class-validator';
import { Public, Roles } from '../auth/decorators';
import { DB, Db } from '../common/db';
import { WithdrawalsService } from './withdrawals.service';

class WithdrawDto {
  @IsInt() @Min(1) amountKobo!: number;
  @IsString() bankCode!: string;
  @IsString() @Matches(/^\d{10}$/, { message: 'accountNumber must be 10 digits' }) accountNumber!: string;
}

@Controller('withdrawals')
export class WithdrawalsController {
  constructor(
    private readonly withdrawals: WithdrawalsService,
    @Inject(DB) private readonly db: Db,
  ) {}

  /** Public: workers poll this to know when the window opens. */
  @Public()
  @Get('window')
  window() {
    return this.withdrawals.window();
  }

  @Post()
  @HttpCode(202)
  request(@Body() dto: WithdrawDto, @Req() req: any) {
    return this.withdrawals.request(req.user.sub, dto);
  }

  @Get()
  history(@Req() req: any) {
    return this.withdrawals.history(req.user.sub);
  }

  @Roles('admin')
  @Get('admin/queue')
  async queue() {
    const r = await this.db.query(
      `SELECT w.id, w.user_id, w.amount_kobo, w.status, w.requested_at, w.window_date, w.attempts, w.last_error,
              u.email
         FROM withdrawals w JOIN users u ON u.id = w.user_id
        ORDER BY w.requested_at DESC
        LIMIT 200`,
    );
    return r.rows;
  }
}
