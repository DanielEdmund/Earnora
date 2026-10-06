import { Controller, Get, Inject, Req } from '@nestjs/common';
import { DB, Db } from '../common/db';
import { PLAN_LIST, planDef } from '../plans/plans';

@Controller('referrals')
export class ReferralsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async summary(@Req() req: any) {
    const userId: string = req.user.sub;
    const [me, direct, earnings] = await Promise.all([
      this.db.query(`SELECT referral_code, plan FROM users WHERE id = $1`, [userId]),
      this.db.query(
        `SELECT u.id, u.email, u.status, u.plan, u.created_at,
                (SELECT count(*) FROM users u2 WHERE u2.referred_by = u.id)::int AS downstream_count
           FROM users u WHERE u.referred_by = $1
          ORDER BY u.created_at DESC LIMIT 100`,
        [userId],
      ),
      this.db.query(
        `SELECT tier_level, count(*)::int AS credits, COALESCE(sum(amount_kobo),0)::bigint AS amount_kobo
           FROM referral_credits WHERE beneficiary_id = $1 GROUP BY tier_level ORDER BY tier_level`,
        [userId],
      ),
    ]);

    const myPlan = planDef(me.rows[0]?.plan);
    const totalEarnedKobo = earnings.rows.reduce((s: number, r: any) => s + Number(r.amount_kobo), 0);
    const creditCount = earnings.rows.reduce((s: number, r: any) => s + Number(r.credits), 0);

    return {
      referralCode: me.rows[0]?.referral_code,
      myPlan: myPlan?.key ?? null,
      myPlanName: myPlan?.name ?? null,
      /** flat bonus YOU earn per referral — the rate comes from the plan YOU are on */
      yourRateKobo: myPlan?.referralBonusKobo ?? 0,
      planRates: PLAN_LIST.map((p) => ({
        key: p.key,
        name: p.name,
        priceKobo: p.priceKobo,
        bonusKobo: p.referralBonusKobo,
      })),
      directReferrals: direct.rows,
      totalEarnedKobo,
      creditCount,
    };
  }
}
