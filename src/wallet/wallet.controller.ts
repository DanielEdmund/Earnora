import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { DB, Db } from '../common/db';

@Controller('wallet')
export class WalletController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async balance(@Req() req: any) {
    const r = await this.db.query(
      `SELECT user_id, available_kobo, reserved_kobo, lifetime_kobo, currency, updated_at
         FROM wallets WHERE user_id = $1`,
      [req.user.sub],
    );
    if (r.rows.length === 0) return null;
    const w = r.rows[0];
    return {
      ...w,
      available_kobo: Number(w.available_kobo),
      reserved_kobo: Number(w.reserved_kobo),
      lifetime_kobo: Number(w.lifetime_kobo),
      total_kobo: Number(w.available_kobo) + Number(w.reserved_kobo),
    };
  }

  @Get('transactions')
  async statements(
    @Req() req: any,
    @Query('limit') limit = '50',
    @Query('before_id') beforeId?: string,
  ) {
    const params: unknown[] = [req.user.sub];
    let where = `wallet_id = $1`;
    if (beforeId) {
      params.push(Number(beforeId));
      where += ` AND id < $2`;
    }
    const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const r = await this.db.query(
      `SELECT id, direction, amount_kobo, balance_after, entry_type, ref_type, ref_id, memo, created_at
         FROM ledger_entries
        WHERE ${where}
        ORDER BY id DESC
        LIMIT ${n}`,
      params,
    );
    return r.rows;
  }
}
