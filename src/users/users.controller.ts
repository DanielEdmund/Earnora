import { Controller, Get, Inject, Req } from '@nestjs/common';
import { Public, Roles } from '../auth/decorators';
import { DB, Db } from '../common/db';
import { config } from '../config';
import { COUNTED_CLAIM_STATES, LAGOS_DAY_START_SQL } from '../plans/plans';

@Controller()
export class UserController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Public()
  @Get('public/stats')
  async publicStats() {
    const r = await this.db.query(
      `SELECT
         (SELECT count(*) FROM users WHERE plan IS NOT NULL)::int                             AS active_users,
         (SELECT COALESCE(sum(amount_kobo), 0) FROM withdrawals WHERE status = 'paid')::bigint AS paid_out_kobo,
         (SELECT count(*) FROM task_claims WHERE status = 'approved')::int                     AS tasks_completed`,
    );
    return r.rows[0];
  }

  @Get('me')
  async me(@Req() req: any) {
    const userId: string = req.user.sub;
    const [user, wallet, stats] = await Promise.all([
      this.db.query(
        `SELECT id, email, phone, role, status, plan, plan_purchased_at, referral_code, referred_by,
                kyc_tier, trust_score, created_at, last_login_at
           FROM users WHERE id = $1`,
        [userId],
      ),
      this.db.query(
        `SELECT available_kobo, reserved_kobo, lifetime_kobo, task_kobo, affiliate_kobo, currency FROM wallets WHERE user_id = $1`,
        [userId],
      ),
      this.db.query(
        `SELECT
           (SELECT count(*) FROM users WHERE referred_by = $1)::int                AS direct_referrals,
           (SELECT COALESCE(sum(amount_kobo),0) FROM referral_credits WHERE beneficiary_id = $1)::bigint AS referral_earned_kobo,
           (SELECT count(*) FROM task_claims WHERE user_id = $1 AND status = 'approved')::int          AS tasks_approved,
           (SELECT count(*) FROM task_claims WHERE user_id = $1)::int                                AS tasks_total,
           (SELECT count(*) FROM task_claims
             WHERE user_id = $1 AND status IN ${COUNTED_CLAIM_STATES}
               AND claimed_at >= ${LAGOS_DAY_START_SQL})::int                                      AS tasks_today`,
        [userId],
      ),
    ]);
    return {
      user: user.rows[0],
      wallet: wallet.rows[0],
      stats: stats.rows[0],
      settings: {
        minWithdrawalKobo: config.withdrawal.minKobo,
        withdrawalWindow: config.withdrawal.window,
        timezone: config.withdrawal.tz,
      },
    };
  }

  @Get('me/devices')
  async devices(@Req() req: any) {
    const r = await this.db.query(
      `SELECT fingerprint_hash, ip_last_seen, first_seen_at, last_seen_at
         FROM user_devices WHERE user_id = $1 ORDER BY last_seen_at DESC`,
      [req.user.sub],
    );
    return r.rows;
  }

  @Get('me/fraud-flags')
  async flags(@Req() req: any) {
    const r = await this.db.query(
      `SELECT reason, severity, details, created_at FROM fraud_flags
        WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.sub],
    );
    return r.rows;
  }

  @Roles('admin')
  @Get('admin/fraud-flags')
  async allFlags() {
    const r = await this.db.query(
      `SELECT f.id, f.user_id, f.reason, f.severity, f.details, f.created_at, u.email, u.trust_score, u.status,
              f.status AS flag_status, f.resolved_at
         FROM fraud_flags f LEFT JOIN users u ON u.id = f.user_id
        ORDER BY f.created_at DESC LIMIT 200`,
    );
    return r.rows;
  }
}
