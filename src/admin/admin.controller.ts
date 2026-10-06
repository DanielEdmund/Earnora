import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { Roles } from '../auth/decorators';
import { DB, Db } from '../common/db';
import { PaymentsService } from '../payments/payments.service';
import { SupportReplyDto } from '../support/support.controller';
import { SupportService } from '../support/support.service';

class UserStatusDto {
  @IsIn(['pending_activation', 'active', 'suspended', 'banned'])
  status!: 'pending_activation' | 'active' | 'suspended' | 'banned';
}

class RejectPaymentDto {
  @IsOptional() @IsString() reason?: string;
}

/**
 * Admin read models for the operations dashboard.
 *
 * Every number here is derived from the same tables the rest of the app writes
 * (users, task_claims, ledger_entries, withdrawals, fraud_flags) — no new write
 * paths, no separate reporting store. Money is cast to float8 so it serialises
 * as a JSON number (safe: well under 2^53 kobo).
 */
@Roles('admin')
@Controller()
export class AdminController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly payments: PaymentsService,
    private readonly support: SupportService,
  ) {}

  // ── Overview: KPIs + time series + category/task breakdowns ───────────────

  @Get('admin/overview')
  async overview(@Query('days') days?: string) {
    const n = Math.min(90, Math.max(7, Number(days) || 14));

    const [kpis, series, categories, topTasks] = await Promise.all([
      this.db.query(`
        SELECT
          (SELECT count(*) FROM users WHERE role = 'user')::int                                        AS users_total,
          (SELECT count(*) FROM users WHERE role = 'user' AND created_at >= date_trunc('day', now()))::int AS users_today,
          (SELECT count(*) FROM users WHERE role = 'user' AND created_at >= now() - interval '7 days')::int AS users_7d,
          (SELECT count(*) FROM users WHERE role = 'user' AND status = 'active')::int                   AS users_active,
          (SELECT count(*) FROM users WHERE role = 'user' AND plan IS NOT NULL)::int                    AS plans_active,
          (SELECT count(*) FROM users WHERE role = 'user' AND last_login_at >= now() - interval '24 hours')::int AS dau,
          (SELECT count(*) FROM users WHERE role = 'user' AND referred_by IS NOT NULL)::int             AS via_referral,
          (SELECT count(*) FROM task_claims WHERE claimed_at >= date_trunc('day', now()))::int          AS claims_today,
          (SELECT count(*) FROM task_claims WHERE status IN ('submitted', 'queued_review'))::int        AS review_pending,
          (SELECT count(*) FROM task_claims WHERE status = 'approved')::int                             AS approvals_total,
          (SELECT count(*) FROM ledger_entries
             WHERE entry_type = 'task_reward' AND created_at >= date_trunc('day', now()))::int          AS approvals_today,
          (SELECT COALESCE(sum(amount_kobo), 0) FROM ledger_entries
             WHERE entry_type = 'task_reward' AND created_at >= date_trunc('day', now()))::float8       AS rewards_today_kobo,
          (SELECT COALESCE(sum(amount_kobo), 0) FROM ledger_entries
             WHERE entry_type = 'task_reward')::float8                                                  AS rewards_total_kobo,
          (SELECT count(*) FROM withdrawals WHERE status IN ('queued', 'disbursing'))::int              AS wd_pending,
          (SELECT COALESCE(sum(amount_kobo), 0) FROM withdrawals
             WHERE status IN ('queued', 'disbursing'))::float8                                          AS wd_pending_kobo,
          (SELECT count(*) FROM withdrawals WHERE status = 'paid'
             AND settled_at >= date_trunc('day', now()))::int                                           AS wd_paid_today,
          (SELECT COALESCE(sum(amount_kobo), 0) FROM withdrawals WHERE status = 'paid')::float8          AS paid_out_kobo,
          (SELECT COALESCE(sum(available_kobo), 0) FROM wallets)::float8                                AS held_kobo,
          (SELECT COALESCE(sum(lifetime_kobo), 0) FROM wallets)::float8                                 AS earned_kobo,
          (SELECT count(*) FROM fraud_flags WHERE status = 'open')::int                                 AS flags_open,
          (SELECT count(*) FROM support_messages WHERE status = 'open')::int                             AS support_open,
          (SELECT count(*) FROM fraud_flags WHERE created_at >= date_trunc('day', now()))::int          AS flags_today,
          (SELECT count(*) FROM users WHERE role = 'user' AND trust_score < 60)::int                    AS low_trust,
          (SELECT count(*) FROM users WHERE role = 'user' AND status IN ('suspended', 'banned'))::int   AS suspended,
          (SELECT count(*) FROM tasks WHERE status = 'open')::int                                       AS tasks_open,
          (SELECT count(*) FROM tasks)::int                                                             AS tasks_total
      `),
      this.db.query(
        `WITH days AS (
           SELECT generate_series(
                    (date_trunc('day', now()) - ($1::int - 1) * interval '1 day')::date,
                    (date_trunc('day', now()))::date,
                    interval '1 day')::date AS day
         )
         SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
                (SELECT count(*) FROM users u WHERE u.role = 'user' AND u.created_at::date = d.day)::int AS signups,
                (SELECT count(*) FROM task_claims c WHERE c.submitted_at::date = d.day)::int             AS submissions,
                (SELECT count(*) FROM ledger_entries l
                   WHERE l.entry_type = 'task_reward' AND l.created_at::date = d.day)::int               AS approvals,
                (SELECT COALESCE(sum(l.amount_kobo), 0) FROM ledger_entries l
                   WHERE l.entry_type = 'task_reward' AND l.created_at::date = d.day)::float8            AS reward_kobo,
                (SELECT count(*) FROM withdrawals w
                   WHERE w.status = 'paid' AND w.settled_at::date = d.day)::int                          AS payouts,
                (SELECT COALESCE(sum(w.amount_kobo), 0) FROM withdrawals w
                   WHERE w.status = 'paid' AND w.settled_at::date = d.day)::float8                       AS payout_kobo
           FROM days d
          ORDER BY d.day`,
        [n],
      ),
      this.db.query(`
        SELECT t.category,
               count(DISTINCT t.id)::int                                          AS tasks,
               count(c.id)::int                                                   AS claims,
               count(c.id) FILTER (WHERE c.status = 'approved')::int              AS approved,
               count(c.id) FILTER (WHERE c.status IN ('submitted', 'queued_review'))::int AS pending,
               COALESCE(sum(c.reward_kobo) FILTER (WHERE c.status = 'approved'), 0)::float8 AS paid_kobo
          FROM tasks t
          LEFT JOIN task_claims c ON c.task_id = t.id
         GROUP BY t.category
         ORDER BY claims DESC, tasks DESC, t.category ASC
      `),
      this.db.query(`
        SELECT id, title, category, status, quota, claimed_count, approved_count, requires_admin, created_at,
               spent_kobo::float8   AS spent_kobo,
               budget_kobo::float8  AS budget_kobo,
               reward_kobo::float8  AS reward_kobo
          FROM tasks
         ORDER BY claimed_count DESC, created_at DESC
         LIMIT 6
      `),
    ]);

    return { days: n, kpis: kpis.rows[0], series: series.rows, categories: categories.rows, topTasks: topTasks.rows };
  }

  // ── Live activity feed: what users are doing, right now ────────────────────

  @Get('admin/activity')
  async activity(@Query('limit') limit = '40', @Query('kind') kind?: string) {
    const n = Math.min(200, Math.max(5, Number(limit) || 40));
    const allowed = ['signup', 'submit', 'reward', 'referral', 'withdrawal', 'payout', 'flag'];
    const filter = kind && allowed.includes(kind) ? kind : null;

    const r = await this.db.query(
      `WITH feed AS (
         SELECT 'signup'::text AS kind, u.created_at AS at, u.id::text AS user_id, u.email,
                u.status::text AS label, 0::float8 AS amount_kobo
           FROM users u WHERE u.role = 'user'
         UNION ALL
         SELECT 'submit', c.submitted_at, c.user_id::text, u.email, t.title, COALESCE(c.reward_kobo, 0)::float8
           FROM task_claims c JOIN users u ON u.id = c.user_id JOIN tasks t ON t.id = c.task_id
          WHERE c.submitted_at IS NOT NULL
         UNION ALL
         SELECT 'reward', l.created_at, l.wallet_id::text, u.email, COALESCE(l.memo, 'task reward'), l.amount_kobo::float8
           FROM ledger_entries l JOIN users u ON u.id = l.wallet_id
          WHERE l.entry_type = 'task_reward'
         UNION ALL
         SELECT 'referral', r.created_at, r.beneficiary_id::text, u.email, 'commission', r.amount_kobo::float8
           FROM referral_credits r JOIN users u ON u.id = r.beneficiary_id
         UNION ALL
         SELECT 'withdrawal', w.requested_at, w.user_id::text, u.email, w.status, w.amount_kobo::float8
           FROM withdrawals w JOIN users u ON u.id = w.user_id
         UNION ALL
         SELECT 'payout', w.settled_at, w.user_id::text, u.email, 'paid', w.amount_kobo::float8
           FROM withdrawals w JOIN users u ON u.id = w.user_id
          WHERE w.status = 'paid' AND w.settled_at IS NOT NULL
         UNION ALL
         SELECT 'flag', f.created_at, f.user_id::text, u.email, f.reason, 0::float8
           FROM fraud_flags f LEFT JOIN users u ON u.id = f.user_id
       )
       SELECT kind, at, user_id, email, label, amount_kobo
         FROM feed
        WHERE at IS NOT NULL ${filter ? 'AND kind = $2' : ''}
        ORDER BY at DESC
        LIMIT $1::int`,
      filter ? [n, filter] : [n],
    );
    return r.rows;
  }

  // ── Users: who is on the platform and what they're doing ──────────────────

  @Get('admin/users')
  async users(
    @Query('search') search = '',
    @Query('status') status = '',
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    const q = (search || '').trim();
    const st = status || '';
    const lim = Math.min(200, Math.max(1, Number(limit) || 50));
    const off = Math.max(0, Number(offset) || 0);
    const where = `u.role = 'user'
        AND ($1 = '' OR u.email ILIKE '%' || $1 || '%' OR coalesce(u.phone, '') ILIKE '%' || $1 || '%')
        AND ($2 = '' OR u.status = $2)`;

    const [rows, total] = await Promise.all([
      this.db.query(
        `SELECT u.id, u.email, u.phone, u.status, u.plan, u.trust_score, u.created_at, u.last_login_at,
                (u.referred_by IS NOT NULL) AS referred,
                COALESCE(w.available_kobo, 0)::float8 AS available_kobo,
                COALESCE(w.lifetime_kobo, 0)::float8  AS lifetime_kobo,
                (SELECT count(*) FROM task_claims c WHERE c.user_id = u.id AND c.status = 'approved')::int AS tasks_done,
                (SELECT count(*) FROM task_claims c WHERE c.user_id = u.id AND c.status IN ('submitted', 'queued_review'))::int AS in_review,
                (SELECT count(*) FROM users r WHERE r.referred_by = u.id)::int AS referrals,
                (SELECT count(*) FROM fraud_flags f WHERE f.user_id = u.id)::int AS flags
           FROM users u
           LEFT JOIN wallets w ON w.user_id = u.id
          WHERE ${where}
          ORDER BY u.created_at DESC
          LIMIT $3 OFFSET $4`,
        [q, st, lim, off],
      ),
      this.db.query(`SELECT count(*)::int AS total FROM users u WHERE ${where}`, [q, st]),
    ]);

    return { rows: rows.rows, total: total.rows[0].total, limit: lim, offset: off };
  }

  @Post('admin/users/:id/status')
  async setUserStatus(@Param('id') id: string, @Body() dto: UserStatusDto, @Req() req: any) {
    if (id === req.user.sub) throw new BadRequestException('You cannot change your own status here');
    const r = await this.db.query(
      `UPDATE users SET status = $2 WHERE id = $1 AND role = 'user' RETURNING id, status`,
      [id, dto.status],
    );
    if (r.rows.length === 0) throw new NotFoundException('User not found');
    return r.rows[0];
  }

  // ── Tasks: performance board (claims vs quota vs budget) ──────────────────

  @Get('admin/tasks')
  async tasks() {
    const r = await this.db.query(`
      SELECT t.id, t.title, t.link, t.category, t.status, t.quota, t.claimed_count, t.approved_count,
             t.requires_admin, t.created_at,
             t.spent_kobo::float8  AS spent_kobo,
             t.budget_kobo::float8 AS budget_kobo,
             t.reward_kobo::float8 AS reward_kobo,
             (SELECT count(*) FROM task_claims c WHERE c.task_id = t.id)::int                             AS claims,
             (SELECT count(*) FROM task_claims c WHERE c.task_id = t.id
                AND c.status IN ('submitted', 'queued_review'))::int                                      AS pending_review,
             (SELECT count(*) FROM task_claims c WHERE c.task_id = t.id AND c.status = 'claimed')::int     AS in_progress
        FROM tasks t
       ORDER BY t.created_at DESC
       LIMIT 100
    `);
    return r.rows;
  }

  // ── Risk: resolve a fraud flag from the triage queue ──────────────────────

  @Post('admin/fraud-flags/:id/resolve')
  async resolveFlag(@Param('id') id: string, @Req() req: any) {
    const r = await this.db.query(
      `UPDATE fraud_flags SET status = 'resolved', resolved_at = now(), resolved_by = $2
        WHERE id = $1 AND status = 'open'
        RETURNING id, status`,
      [Number(id), req.user.sub],
    );
    if (r.rows.length === 0) throw new NotFoundException('Flag not found or already resolved');
    return r.rows[0];
  }

  // ── Payments: owner approves each confirmed purchase before it unlocks ─────

  @Get('admin/payments')
  async listPayments(@Query('approval') approval?: string) {
    const filter = approval ?? 'all';
    if (!['all', 'pending', 'approved', 'rejected'].includes(filter)) {
      throw new BadRequestException('approval must be one of: all, pending, approved, rejected');
    }
    const r = await this.db.query(
      `SELECT p.psp_reference, p.plan_key, p.amount_kobo::float8 AS amount_kobo, p.psp, p.status,
              p.approval, p.reject_reason, p.created_at, p.confirmed_at, p.approved_at, u.email
         FROM payments p
         JOIN users u ON u.id = p.user_id
        WHERE ($1 = 'all' OR p.approval = $1)
        ORDER BY p.created_at DESC
        LIMIT 200`,
      [filter],
    );
    return r.rows;
  }

  @Post('admin/payments/:reference/approve')
  approvePayment(@Param('reference') reference: string, @Req() req: any) {
    return this.payments.approvePayment(reference, req.user.sub);
  }

  @Post('admin/payments/:reference/reject')
  rejectPayment(@Param('reference') reference: string, @Body() dto: RejectPaymentDto, @Req() req: any) {
    return this.payments.rejectPayment(reference, req.user.sub, dto.reason);
  }

  // ── Support: questions the chatbot could not answer, and the answers ──────

  @Get('admin/support')
  async listSupport(@Query('status') status = 'all') {
    const filter = status ?? 'all';
    if (!['all', 'open', 'replied'].includes(filter)) {
      throw new BadRequestException('status must be one of: all, open, replied');
    }
    return this.support.adminList(filter as 'all' | 'open' | 'replied');
  }

  @Post('admin/support/:id/reply')
  replySupport(@Param('id') id: string, @Body() dto: SupportReplyDto, @Req() req: any) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) throw new BadRequestException('Invalid message id');
    return this.support.reply(n, req.user.sub, dto.reply);
  }
}
