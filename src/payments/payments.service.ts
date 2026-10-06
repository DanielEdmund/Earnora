import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { config } from '../config';
import { DB, Db, QueryFn } from '../common/db';
import { TOPICS, OutboxService } from '../common/events';
import { ReferralsService } from '../referrals/referrals.service';
import { planDef, PlanKey } from '../plans/plans';
import { postTransaction } from '../wallet/ledger';

export interface InitializeResult {
  reference: string;
  planKey: PlanKey;
  amountKobo: number;
  /** null in manual mode — there is no external checkout page to open. */
  authorizationUrl: string | null;
  mode: string;
}

@Injectable()
export class PaymentsService {
  private readonly log = new Logger('Payments');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly referrals: ReferralsService,
    private readonly outbox: OutboxService,
  ) {}

  /** Step 1: create a plan payment. One plan per account.
   *  Manual mode (PSP_MODE=simulated): recorded as confirmed + approval='pending'
   *  immediately — the admin verifies the real transfer before anything unlocks.
   *  Paystack mode: status='pending' until the PSP webhook confirms it. */
  async initialize(userId: string, planKey: PlanKey): Promise<InitializeResult> {
    const plan = planDef(planKey);
    if (!plan) throw new BadRequestException('Unknown plan');

    const existing = await this.db.query<{ plan: string | null }>(`SELECT plan FROM users WHERE id = $1`, [userId]);
    const current = planDef(existing.rows[0]?.plan);
    if (current) {
      throw new ConflictException(`You already have the ${current.name} plan — one plan per account`);
    }

    // a confirmed payment already waiting on admin approval → don't stack another
    const inflight = await this.db.query(
      `SELECT psp_reference FROM payments
        WHERE user_id = $1 AND purpose = 'plan' AND status = 'success' AND approval = 'pending'
        LIMIT 1`,
      [userId],
    );
    if (inflight.rows.length > 0) {
      throw new ConflictException('You already have a payment waiting for admin approval');
    }

    const ref = `EARN_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

    if (config.psp.mode === 'simulated') {
      // Manual mode: the user attests "I have completed the transfer" — the
      // payment is recorded as confirmed and waits in approval='pending'.
      // Nothing is granted until an admin verifies the money actually landed
      // (approvePayment), so this self-attestation carries no privileges.
      await this.db.query(
        `INSERT INTO payments (user_id, purpose, plan_key, amount_kobo, psp, psp_reference, status, confirmed_at, raw_callback)
         VALUES ($1, 'plan', $2, $3, 'simulated', $4, 'success', now(), $5::jsonb)`,
        [userId, plan.key, plan.priceKobo, ref, JSON.stringify({ mode: 'manual_attestation', confirmed_by: 'payer' })],
      );
      this.log.log(`manual payment recorded — awaiting admin approval: user=${userId} ref=${ref}`);
      return { reference: ref, planKey: plan.key, amountKobo: plan.priceKobo, authorizationUrl: null, mode: config.psp.mode };
    }

    await this.db.query(
      `INSERT INTO payments (user_id, purpose, plan_key, amount_kobo, psp, psp_reference)
       VALUES ($1, 'plan', $2, $3, $4, $5)`,
      [userId, plan.key, plan.priceKobo, config.psp.mode === 'simulated' ? 'simulated' : 'paystack', ref],
    );

    return {
      reference: ref,
      planKey: plan.key,
      amountKobo: plan.priceKobo,
      authorizationUrl: `https://checkout.paystack.com/${ref}`,
      mode: config.psp.mode,
    };
  }

  /** HMAC-SHA512 over the RAW body — the exact scheme Paystack uses. */
  verifySignature(rawBody: Buffer | string, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = createHmac('sha512', config.psp.webhookSecret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Step 2: PSP callback. Idempotent at three layers:
   *   1) signature must verify, 2) webhook_events (psp, event_id) dedupes replays,
   *   3) transactions.idempotency_key collapses money effects to one.
   */
  async handleWebhook(
    rawBody: Buffer | string,
    signature: string | undefined,
  ): Promise<{ received: true; duplicate?: boolean }> {
    const signatureOk = this.verifySignature(rawBody, signature);
    if (!signatureOk) throw new BadRequestException('Invalid webhook signature');

    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Malformed webhook JSON');
    }

    const eventId: string = payload?.id ?? payload?.event ?? `evt_${payload?.data?.reference}`;
    const reference: string | undefined = payload?.data?.reference;
    const event: string = payload?.event ?? '';

    const inserted = await this.db.query(
      `INSERT INTO webhook_events (psp, event_id, payload, signature_ok)
       VALUES ($1, $2, $3::jsonb, true)
       ON CONFLICT (psp, event_id) DO NOTHING
       RETURNING id`,
      ['paystack', eventId, JSON.stringify(payload)],
    );
    if (inserted.rows.length === 0) {
      this.log.warn(`duplicate webhook ignored: ${eventId}`);
      return { received: true, duplicate: true };
    }

    try {
      if (event === 'charge.success' && reference) {
        await this.confirmPayment(reference, payload);
        await this.db.query(`UPDATE webhook_events SET processed_at = now() WHERE event_id = $1`, [eventId]);
      } else if (event && reference) {
        await this.db.query(`UPDATE webhook_events SET processed_at = now(), error = $2 WHERE event_id = $1`, [
          eventId,
          `unhandled event type: ${event}`,
        ]);
      } else {
        await this.db.query(`UPDATE webhook_events SET processed_at = now() WHERE event_id = $1`, [eventId]);
      }
    } catch (err) {
      await this.db.query(`UPDATE webhook_events SET processed_at = now(), error = $2 WHERE event_id = $1`, [
        eventId,
        (err as Error).message,
      ]);
      throw err;
    }

    return { received: true };
  }

  /**
   * Step 2b: the PSP says the money landed. Confirms the payment only —
   * the plan is NOT granted here. It waits in approval='pending' until an
   * admin releases it via approvePayment (owner requirement: manual vetting
   * before task access). Idempotent: status pending → success guards replays.
   */
  async confirmPayment(reference: string, payload: unknown): Promise<{ alreadyProcessed: boolean }> {
    return this.db.transaction(async (q) => {
      const pay = await q<{ id: number; user_id: string }>(
        `SELECT id, user_id FROM payments WHERE psp_reference = $1 FOR UPDATE`,
        [reference],
      );
      if (pay.rows.length === 0) throw new NotFoundException(`Unknown payment reference ${reference}`);

      const marked = await q(
        `UPDATE payments SET status = 'success', confirmed_at = now(), approval = 'pending', raw_callback = $2::jsonb
          WHERE psp_reference = $1 AND status = 'pending'
          RETURNING id`,
        [reference, JSON.stringify(payload ?? {})],
      );
      if (marked.rows.length === 0) return { alreadyProcessed: true }; // replay → no-op

      this.log.log(`payment confirmed — awaiting admin approval: user=${pay.rows[0].user_id} ref=${reference}`);
      return { alreadyProcessed: false };
    });
  }

  /**
   * Step 3 (admin): release a confirmed payment. All effects of the purchase
   * in ONE transaction:
   *   1) the plan fee lands in the platform clearing account,
   *   2) the plan is assigned (one-time, no expiry) and the account goes live,
   *   3) the direct referrer earns the flat bonus at THEIR plan's rate,
   *   4) the payment is marked approved (who/when stamped for the audit trail).
   */
  async approvePayment(reference: string, adminId: string): Promise<{ ok: true; plan: string; userId: string }> {
    return this.db.transaction(async (q) => {
      const pay = await q<{
        user_id: string;
        purpose: string;
        plan_key: string | null;
        amount_kobo: string | number;
        status: string;
        approval: string;
      }>(
        `SELECT user_id, purpose, plan_key, amount_kobo, status, approval
           FROM payments WHERE psp_reference = $1 FOR UPDATE`,
        [reference],
      );
      if (pay.rows.length === 0) throw new NotFoundException(`Unknown payment reference ${reference}`);
      const payment = pay.rows[0];

      if (payment.status !== 'success') throw new BadRequestException('Payment not confirmed by the PSP yet');
      if (payment.approval === 'approved') throw new ConflictException('This payment is already approved');
      if (payment.approval === 'rejected') {
        throw new ConflictException('This payment was rejected — ask the user to pay again');
      }

      const plan = planDef(payment.plan_key);
      if (!plan) throw new BadRequestException(`Payment ${reference} has no valid plan attached`);

      // one plan per account — the user may already hold a plan from another payment
      const owner = await q<{ plan: string | null }>(`SELECT plan FROM users WHERE id = $1 FOR UPDATE`, [
        payment.user_id,
      ]);
      if (owner.rows.length === 0) throw new NotFoundException('Account missing during plan settlement');
      if (owner.rows[0].plan) throw new ConflictException('User already has a plan — reject the duplicate payment');

      // 1) plan fee lands in the platform clearing account
      await postTransaction(q, {
        idempotencyKey: `pay:${reference}`,
        type: 'plan_purchase',
        userId: payment.user_id,
        totalKobo: Number(payment.amount_kobo),
        metadata: { reference, purpose: payment.purpose, plan: plan.key },
        moves: [
          {
            walletId: config.platformWalletId,
            deltaKobo: Number(payment.amount_kobo),
            entryType: 'plan_fee',
            moveKey: 'platform',
            refType: 'payment',
            refId: reference,
            memo: `${plan.name} plan fee collected`,
          },
        ],
      });

      // 2) assign the plan (one-time, no expiry) + flip the account live
      await q(`UPDATE users SET plan = $2, plan_purchased_at = now(), status = 'active' WHERE id = $1`, [
        payment.user_id,
        plan.key,
      ]);

      // 3) flat referral bonus — paid to the direct referrer at THEIR plan's rate
      //    (a referrer who has no plan yet earns nothing for this purchase)
      await this.referrals.creditOnPlanPurchase(q, { purchasedUserId: payment.user_id, purchaseRef: reference });

      // 4) stamp the approval
      await q(`UPDATE payments SET approval = 'approved', approved_at = now(), approved_by = $2 WHERE psp_reference = $1`, [
        reference,
        adminId,
      ]);

      await this.outbox.publish(q, TOPICS.USER_ACTIVATED, { userId: payment.user_id, reference, plan: plan.key });

      this.log.log(`payment approved: user=${payment.user_id} plan=${plan.key} ref=${reference} by=${adminId}`);
      return { ok: true as const, plan: plan.key, userId: payment.user_id };
    });
  }

  /** Step 3 (admin): refuse a confirmed payment — no plan, no ledger effects. */
  async rejectPayment(reference: string, adminId: string, reason?: string): Promise<{ ok: true }> {
    return this.db.transaction(async (q) => {
      const pay = await q<{ user_id: string; status: string; approval: string }>(
        `SELECT user_id, status, approval FROM payments WHERE psp_reference = $1 FOR UPDATE`,
        [reference],
      );
      if (pay.rows.length === 0) throw new NotFoundException(`Unknown payment reference ${reference}`);
      const payment = pay.rows[0];

      if (payment.status !== 'success') throw new BadRequestException('Payment not confirmed by the PSP yet');
      if (payment.approval === 'approved') throw new ConflictException('This payment is already approved');
      if (payment.approval === 'rejected') throw new ConflictException('This payment is already rejected');

      await q(`UPDATE payments SET approval = 'rejected', reject_reason = $2, approved_by = $3 WHERE psp_reference = $1`, [
        reference,
        reason?.trim() || null,
        adminId,
      ]);
      this.log.log(`payment rejected: user=${payment.user_id} ref=${reference} by=${adminId} reason=${reason ?? '—'}`);
      return { ok: true as const };
    });
  }

  async getUsersPendingDecision(userId: string) {
    const r = await this.db.query(
      `SELECT psp_reference, approval, plan_key, amount_kobo, reject_reason, confirmed_at
         FROM payments
        WHERE user_id = $1 AND status = 'success' AND approval IN ('pending', 'rejected')
        ORDER BY confirmed_at DESC NULLS LAST
        LIMIT 1`,
      [userId],
    );
    return r.rows[0] ?? null;
  }

  async getPayment(reference: string) {
    const r = await this.db.query(
      `SELECT psp_reference, user_id, purpose, plan_key, amount_kobo, status, approval, reject_reason,
              created_at, confirmed_at, approved_at
         FROM payments WHERE psp_reference = $1`,
      [reference],
    );
    return r.rows[0] ?? null;
  }
}

export type { QueryFn };
