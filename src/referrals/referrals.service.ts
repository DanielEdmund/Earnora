import { Inject, Injectable } from '@nestjs/common';
import { config } from '../config';
import { QueryFn } from '../common/db';
import { TOPICS, OutboxService } from '../common/events';
import { DB, Db } from '../common/db';
import { planDef } from '../plans/plans';
import { postTransaction } from '../wallet/ledger';

export interface CommissionCredit {
  beneficiaryId: string;
  tierLevel: number;
  amountKobo: number;
}

/**
 * Flat referral bonuses. When a referred user buys a plan, their DIRECT
 * referrer is credited a flat amount matching the REFERRER's own plan
 * (Beginner ₦200 / Intermediate ₦400 / Extreme ₦600). A referrer without
 * a plan earns nothing. Idempotent on (beneficiary, source, reference, tier).
 */
@Injectable()
export class ReferralsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly outbox: OutboxService,
  ) {}

  /** Must run inside the plan-purchase transaction. Returns the credits issued. */
  async creditOnPlanPurchase(
    q: QueryFn,
    args: { purchasedUserId: string; purchaseRef: string },
  ): Promise<CommissionCredit[]> {
    const up = await q<{ referred_by: string | null }>(`SELECT referred_by FROM users WHERE id = $1`, [
      args.purchasedUserId,
    ]);
    const referrerId: string | null = up.rows[0]?.referred_by ?? null;
    if (!referrerId) return [];

    const referrerRow = await q<{ plan: string | null }>(`SELECT plan FROM users WHERE id = $1`, [referrerId]);
    const plan = planDef(referrerRow.rows[0]?.plan);
    if (!plan) return []; // no plan → no bonus (they can buy one and earn from the next referral)
    const amount = plan.referralBonusKobo;

    // one credit row per (referrer, purchase) — replay collapses here first
    const inserted = await q<{ id: number }>(
      `INSERT INTO referral_credits (beneficiary_id, source_user_id, activation_ref, tier_level, amount_kobo)
       VALUES ($1, $2, $3, 1, $4)
       ON CONFLICT (beneficiary_id, source_user_id, activation_ref, tier_level) DO NOTHING
       RETURNING id`,
      [referrerId, args.purchasedUserId, args.purchaseRef, amount],
    );
    if (inserted.rows.length === 0) return [];

    const credit: CommissionCredit = { beneficiaryId: referrerId, tierLevel: 1, amountKobo: amount };

    // Single idempotent envelope: bonus funded from the platform clearing
    // account that collected the plan fee (double-entry style).
    await postTransaction(q, {
      idempotencyKey: `commission:${args.purchaseRef}`,
      type: 'commission',
      totalKobo: amount,
      metadata: { purchaseRef: args.purchaseRef, purchasedUserId: args.purchasedUserId, plan: plan.key },
      moves: [
        {
          walletId: referrerId,
          deltaKobo: amount,
          entryType: 'referral_commission',
          moveKey: 'referrer',
          refType: 'plan_purchase',
          refId: args.purchaseRef,
          memo: `Referral bonus — ${plan.name} plan rate`,
        },
        {
          walletId: config.platformWalletId,
          deltaKobo: -amount,
          entryType: 'referral_commission',
          moveKey: 'platform',
          refType: 'plan_purchase',
          refId: args.purchaseRef,
          memo: 'Referral bonus paid from plan fee',
        },
      ],
    });

    // link the ledger entry for auditability + emit events for realtime push
    const entry = await q<{ id: number }>(
      `SELECT id FROM ledger_entries
        WHERE idempotency_key = $1 AND wallet_id = $2 AND direction = 'credit'`,
      [`commission:${args.purchaseRef}:referrer`, referrerId],
    );
    if (entry.rows[0]) {
      await q(
        `UPDATE referral_credits SET ledger_entry_id = $2
          WHERE beneficiary_id = $1 AND activation_ref = $3 AND tier_level = 1`,
        [referrerId, entry.rows[0].id, args.purchaseRef],
      );
    }
    await this.outbox.publish(q, TOPICS.REFERRAL_CREDITED, credit);
    await this.outbox.publish(q, TOPICS.WALLET_CREDITED, {
      userId: referrerId,
      amountKobo: amount,
      reason: 'referral_commission',
      tier: 1,
    });
    return [credit];
  }
}
