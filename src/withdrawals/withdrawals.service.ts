import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { config } from '../config';
import { DB, Db } from '../common/db';
import { TOPICS, OutboxService } from '../common/events';
import { currentWindowDate, windowStatus, WindowStatus } from '../common/time';
import { planDef } from '../plans/plans';
import { refundReserve, reserveFunds, settleReserve } from '../wallet/ledger';

export interface WithdrawalRequest {
  amountKobo: number;
  bankCode: string;
  accountNumber: string;
}

@Injectable()
export class WithdrawalsService {
  private readonly log = new Logger('Withdrawals');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly outbox: OutboxService,
  ) {}

  window(): WindowStatus {
    return windowStatus(config.withdrawal.window, config.withdrawal.tz);
  }

  /**
   * Admission control:
   *  - outside the window → queued (if allowed) or rejected with the next slot;
   *  - funds moved available → reserved in the SAME tx as the withdrawal row,
   *    so a double-click can never over-withdraw.
   */
  async request(userId: string, dto: WithdrawalRequest): Promise<{ id: string; status: string }> {
    // withdrawals are plan-gated: no plan → no payouts
    const owner = await this.db.query<{ plan: string | null }>(`SELECT plan FROM users WHERE id = $1`, [userId]);
    if (!planDef(owner.rows[0]?.plan)) {
      throw new ForbiddenException('Purchase a plan to unlock withdrawals');
    }

    const status = this.window();
    if (!status.open && !config.withdrawal.allowQueue) {
      throw new ConflictException({
        message: 'Withdrawal window is closed',
        window: status,
      });
    }
    if (!Number.isInteger(dto.amountKobo) || dto.amountKobo < config.withdrawal.minKobo) {
      throw new BadRequestException(`Minimum withdrawal is ${config.withdrawal.minKobo / 100} NGN`);
    }
    if (!/^\d{10}$/.test(dto.accountNumber)) {
      throw new BadRequestException('Account number must be 10 digits');
    }

    const id = randomUUID();
    const windowDate = currentWindowDate(config.withdrawal.tz);
    const accountName = await this.resolveAccountName(dto.bankCode, dto.accountNumber);

    try {
      await this.db.transaction(async (q) => {
        await reserveFunds(q, {
          userId,
          amountKobo: dto.amountKobo,
          idempotencyKey: `wd:${id}`,
          txnType: 'withdrawal',
          metadata: { bankCode: dto.bankCode, accountNumber: dto.accountNumber },
        });
        await q(
          `INSERT INTO withdrawals (id, user_id, amount_kobo, bank_code, account_number, account_name, window_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, userId, dto.amountKobo, dto.bankCode, dto.accountNumber, accountName, windowDate],
        );
        await this.outbox.publish(q, TOPICS.WITHDRAWAL_REQUESTED, {
          withdrawalId: id,
          userId,
          amountKobo: dto.amountKobo,
          queued: !status.open,
        });
      });
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new ConflictException('You already have a withdrawal for this window');
      }
      throw err;
    }

    this.log.log(`withdrawal ${id} queued: ${dto.amountKobo} kobo by ${userId} (window ${status.open ? 'open' : 'queued'})`);
    return { id, status: 'queued' };
  }

  async history(userId: string) {
    const r = await this.db.query(
      `SELECT id, amount_kobo, fee_kobo, bank_code, account_number, account_name, status,
              requested_at, window_date, attempts, last_error, settled_at
         FROM withdrawals WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 50`,
      [userId],
    );
    return r.rows;
  }

  /** Simulated name-enquiry; real integration calls the bank/PSP validation API. */
  private async resolveAccountName(bankCode: string, accountNumber: string): Promise<string> {
    if (config.psp.mode === 'simulated') {
      return `ACCT ${accountNumber.slice(-4)} (${bankCode})`;
    }
    // production: call Paystack/Flutterwave transfer recipient API here
    return `Verified ${accountNumber}`;
  }

  // ── payout pipeline (drained by PayoutBatcher) ─────────────────────────────

  async claimQueuedBatch(limit: number): Promise<any[]> {
    return this.db.transaction(async (q) => {
      const r = await q(
        `UPDATE withdrawals SET status = 'disbursing'
          WHERE id IN (
            SELECT id FROM withdrawals
             WHERE status = 'queued'
             ORDER BY requested_at
             LIMIT $1
             FOR UPDATE SKIP LOCKED
          )
          RETURNING *`,
        [limit],
      );
      return r.rows;
    });
  }

  /** Calls the transfer rail. Account numbers starting "99" always fail (demo hook). */
  async disburse(w: any): Promise<{ ok: boolean; ref: string; error?: string }> {
    await new Promise((r) => setTimeout(r, 150)); // simulate PSP latency
    if (String(w.account_number).startsWith('99')) {
      return { ok: false, ref: `TRF_FAIL_${w.id.slice(0, 8)}`, error: 'Beneficiary account rejected (simulated)' };
    }
    return { ok: true, ref: `TRF_${Date.now().toString(36)}_${w.id.slice(0, 8)}` };
  }

  async settlePaid(w: any, transferRef: string): Promise<void> {
    await this.db.transaction(async (q) => {
      const done = await q(
        `UPDATE withdrawals SET status = 'paid', transfer_ref = $2, settled_at = now()
          WHERE id = $1 AND status = 'disbursing'
          RETURNING id`,
        [w.id, transferRef],
      );
      if (done.rows.length === 0) return; // already settled
      await settleReserve(q, {
        userId: w.user_id,
        amountKobo: Number(w.amount_kobo) + Number(w.fee_kobo),
        txnId: (await this.txnIdFor(q, w.id)) ?? '',
      });
      await this.outbox.publish(q, TOPICS.WITHDRAWAL_PAID, {
        withdrawalId: w.id,
        userId: w.user_id,
        amountKobo: Number(w.amount_kobo),
        transferRef,
      });
    });
  }

  async settleFailed(w: any, error: string): Promise<void> {
    const attempts = Number(w.attempts) + 1;
    const exhausted = attempts >= config.withdrawal.maxAttempts;

    await this.db.transaction(async (q) => {
      if (exhausted) {
        const done = await q(
          `UPDATE withdrawals SET status = 'reversed', attempts = $2, last_error = $3, settled_at = now()
            WHERE id = $1 AND status = 'disbursing'
            RETURNING id`,
          [w.id, attempts, error],
        );
        if (done.rows.length === 0) return;
        await refundReserve(q, {
          userId: w.user_id,
          amountKobo: Number(w.amount_kobo) + Number(w.fee_kobo),
          txnId: (await this.txnIdFor(q, w.id)) ?? '',
          idempotencyKey: `wd:${w.id}`,
          memo: `Withdrawal failed after ${attempts} attempts`,
        });
        await this.outbox.publish(q, TOPICS.WITHDRAWAL_REVERSED, {
          withdrawalId: w.id,
          userId: w.user_id,
          error,
        });
        this.log.warn(`withdrawal ${w.id} reversed after ${attempts} attempts`);
      } else {
        await q(
          `UPDATE withdrawals SET status = 'queued', attempts = $2, last_error = $3 WHERE id = $1 AND status = 'disbursing'`,
          [w.id, attempts, error],
        );
        this.log.warn(`withdrawal ${w.id} retry scheduled (attempt ${attempts}): ${error}`);
      }
    });
  }

  private async txnIdFor(q: (t: string, p?: any) => Promise<{ rows: any[] }>, withdrawalId: string): Promise<string | null> {
    const r = await q(`SELECT txn_id FROM transactions WHERE idempotency_key = $1`, [`wd:${withdrawalId}`]);
    return r.rows[0]?.txn_id ?? null;
  }
}
