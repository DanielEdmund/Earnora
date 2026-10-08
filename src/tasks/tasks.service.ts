import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { config } from '../config';
import { CacheService } from '../common/cache';
import { DB, Db, QueryFn } from '../common/db';
import { TOPICS, OutboxService } from '../common/events';
import { assertClaimVelocity, trustOf } from '../fraud/fraud';
import { PowService } from '../common/pow';
import { COUNTED_CLAIM_STATES, LAGOS_DAY_START_SQL, planDef } from '../plans/plans';
import { detectImage, ImageKind, MAX_PROOF_BYTES, PROOF_MIME, screenshotOf, structuralFailure } from './proof';
import { postTransaction } from '../wallet/ledger';

const ACTIVE_CLAIM_STATES = `('claimed','submitted','queued_review','approved')`;

@Injectable()
export class TasksService {
  private readonly log = new Logger('Tasks');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CacheService) private readonly cache: CacheService,
    private readonly outbox: OutboxService,
    private readonly pow: PowService,
  ) {}

  async listAvailable(userId: string, category?: string) {
    // tasks are plan-gated: no plan → no feed (purchase unlocks the task page)
    const owner = await this.db.query<{ plan: string | null }>(`SELECT plan FROM users WHERE id = $1`, [userId]);
    const plan = planDef(owner.rows[0]?.plan);
    if (!plan) throw new ForbiddenException('Purchase a plan to access tasks');

    const params: unknown[] = [userId, plan.taskRewardKobo];
    let categoryFilter = '';
    if (category) {
      params.push(category);
      categoryFilter = `AND t.category = $${params.length}`;
    }
    const r = await this.db.query(
      `SELECT t.id, t.title, t.description, t.link, t.category,
              $2::bigint AS reward_kobo,           -- payout is the CLAIMER'S PLAN rate
              t.quota,
              (t.quota - t.claimed_count) AS slots_left, t.requires_admin, t.validation_rules, t.created_at
         FROM tasks t
         LEFT JOIN task_claims c
                ON c.task_id = t.id AND c.user_id = $1 AND c.status IN ${ACTIVE_CLAIM_STATES}
        WHERE t.status = 'open' AND c.id IS NULL
          AND (t.closes_at IS NULL OR t.closes_at > now())
          AND t.claimed_count < t.quota
          ${categoryFilter}
        ORDER BY t.created_at DESC
        LIMIT 100`,
      params,
    );
    return r.rows;
  }

  async myClaims(userId: string) {
    const r = await this.db.query(
      `SELECT c.id, c.task_id, c.status, c.claimed_at, c.expires_at, c.submitted_at,
              c.rejection_reason, c.reward_kobo, t.title, t.category, t.link, t.validation_rules
         FROM task_claims c JOIN tasks t ON t.id = c.task_id
        WHERE c.user_id = $1
        ORDER BY c.claimed_at DESC
        LIMIT 100`,
      [userId],
    );
    return r.rows;
  }

  async issueChallenge(userId: string) {
    return this.pow.issue(userId);
  }

  /**
   * Claim = proof-of-work + velocity gate + quota-gated insert, all in one tx.
   * The partial unique index (task_id, user_id) is the real duplicate shield.
   */
  async claim(userId: string, taskId: string, pow: { challenge?: string; nonce?: string }) {
    await this.pow.verify(userId, pow.challenge ?? '', pow.nonce ?? '');
    await assertClaimVelocity(this.cache, userId);

    try {
      return await this.db.transaction(async (q) => {
        const task = await q<{ reward_kobo: string | number; claim_ttl_min: number }>(
          `SELECT reward_kobo, 30 AS claim_ttl_min FROM tasks
            WHERE id = $1 AND status = 'open'
              AND (closes_at IS NULL OR closes_at > now())
            FOR UPDATE`,
          [taskId],
        );
        if (task.rows.length === 0) throw new NotFoundException('Task not available');

        // plan gate + daily quota (both checked inside the tx → race-proof)
        const owner = await q<{ plan: string | null }>(`SELECT plan FROM users WHERE id = $1`, [userId]);
        const plan = planDef(owner.rows[0]?.plan);
        if (!plan) throw new ForbiddenException('Purchase a plan to access tasks');

        const usedToday = await q<{ n: number }>(
          `SELECT count(*)::int AS n FROM task_claims
            WHERE user_id = $1 AND status IN ${COUNTED_CLAIM_STATES}
              AND claimed_at >= ${LAGOS_DAY_START_SQL}`,
          [userId],
        );
        const tasksToday = usedToday.rows[0].n;
        if (tasksToday >= plan.dailyTaskLimit) {
          throw new ConflictException(
            `Daily limit reached — your ${plan.name} plan includes ${plan.dailyTaskLimit} task(s) per day. Come back tomorrow.`,
          );
        }

        const inserted = await q<{ id: number }>(
          `INSERT INTO task_claims (task_id, user_id, expires_at, reward_kobo)
           VALUES ($1, $2, now() + ($3 || ' minutes')::interval, $4)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [taskId, userId, String(task.rows[0].claim_ttl_min), plan.taskRewardKobo],
        );
        if (inserted.rows.length === 0) throw new ConflictException('Already claimed this task');

        // quota gate: row-level compare makes concurrent over-claim impossible
        const quota = await q(
          `UPDATE tasks SET claimed_count = claimed_count + 1
            WHERE id = $1 AND claimed_count < quota
            RETURNING id`,
          [taskId],
        );
        if (quota.rows.length === 0) throw new ConflictException('Task quota exhausted');

        const claimId = inserted.rows[0].id;
        await this.outbox.publish(q, TOPICS.TASK_CLAIMED, { claimId, taskId, userId });
        return {
          claimId,
          status: 'claimed',
          expiresInSeconds: task.rows[0].claim_ttl_min * 60,
          tasksToday: tasksToday + 1,
          dailyTaskLimit: plan.dailyTaskLimit,
        };
      });
    } catch (err) {
      throw this.translate(err);
    }
  }

  /**
   * Screenshot upload for an active claim. Identified by the SHA-256 of its
   * bytes (content-addressed) so identical screenshots share one URL - that
   * keeps duplicate-proof detection working for images. Magic bytes decide the
   * type; the client's content-type is never trusted.
   */
  async saveProof(
    userId: string,
    taskId: string,
    file?: { originalname?: string; buffer?: Buffer; size?: number },
  ): Promise<{ url: string; name: string; size: number; sha256: string }> {
    if (!file?.buffer?.length) throw new BadRequestException('Attach a screenshot image (png, jpg, webp or gif)');
    if (file.buffer.length > MAX_PROOF_BYTES) throw new BadRequestException('Screenshot is too large (max 8 MB)');
    const kind = detectImage(file.buffer);
    if (!kind) throw new BadRequestException('That file is not a valid image (png, jpg, webp or gif)');

    const claim = await this.db.query<{ id: number }>(
      `SELECT id FROM task_claims WHERE task_id = $1 AND user_id = $2 AND status = 'claimed'`,
      [taskId, userId],
    );
    if (claim.rows.length === 0) throw new NotFoundException('No active claim for this task');

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const filename = `${sha256}.${kind}`;
    // Primary store: the database — survives read-only/ephemeral serverless
    // filesystems and is visible from every function instance.
    await this.db.query(
      `INSERT INTO proof_files (sha256, ext, bytes) VALUES ($1, $2, $3)
       ON CONFLICT (sha256) DO NOTHING`,
      [sha256, kind, file.buffer],
    );
    // Best-effort local disk copy (static serving / older installs); silently
    // skipped where the filesystem is read-only, the DB row is authoritative.
    try {
      const dir = join(process.cwd(), 'uploads', 'proofs');
      mkdirSync(dir, { recursive: true });
      const dest = join(dir, filename);
      if (!existsSync(dest)) writeFileSync(dest, file.buffer);
    } catch {
      /* serverless read-only fs */
    }
    return {
      url: `/uploads/proofs/${filename}`,
      name: (file.originalname || filename).slice(0, 120),
      size: file.buffer.length,
      sha256,
    };
  }

  /**
   * Content-addressed screenshot bytes for GET /uploads/proofs/<sha256>.<ext>.
   * Strict filename check (no traversal), DB first, legacy disk copy as fallback.
   */
  async getProof(file: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    const m = /^([a-f0-9]{64})\.(png|jpg|webp|gif)$/.exec(file);
    if (!m) return null;
    const contentType = PROOF_MIME[m[2] as ImageKind];
    const r = await this.db.query<{ bytes: Buffer | Uint8Array }>(
      `SELECT bytes FROM proof_files WHERE sha256 = $1 AND ext = $2`,
      [m[1], m[2]],
    );
    if (r.rows.length > 0) {
      const bytes = r.rows[0].bytes;
      return { buffer: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), contentType };
    }
    try {
      const p = join(process.cwd(), 'uploads', 'proofs', file);
      if (existsSync(p)) return { buffer: readFileSync(p), contentType };
    } catch {
      /* unreadable dir */
    }
    return null;
  }

  /**
   * Submission: dwell-time gate (kills instant bot submits), single-use proof
   * hash (kills copy-paste proof reuse), then auto or admin validation.
   */
  async submit(userId: string, taskId: string, payload: Record<string, unknown>) {
    if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
      throw new BadRequestException('Empty proof payload');
    }
    if (payload.screenshot !== undefined && payload.screenshot !== null && !screenshotOf(payload)) {
      throw new BadRequestException('Invalid screenshot upload - attach the image again');
    }

    const claim = await this.db.query<{
      id: number;
      claimed_at: string;
      status: string;
    }>(
      `SELECT id, claimed_at, status FROM task_claims
        WHERE task_id = $1 AND user_id = $2 AND status = 'claimed'`,
      [taskId, userId],
    );
    if (claim.rows.length === 0) throw new NotFoundException('No active claim for this task');
    const row = claim.rows[0];

    const dwellMs = Date.now() - new Date(row.claimed_at).getTime();
    if (dwellMs < config.fraud.minDwellSeconds * 1000) {
      throw new BadRequestException(
        `Submitted too fast (minimum ${config.fraud.minDwellSeconds}s on task) — automation rejected`,
      );
    }

    // Screenshots are content-addressed (<sha256>.<ext>), so hashing the file's
    // content hash keeps duplicate-proof detection working across users and
    // file names. Text payloads hash the JSON as before.
    const shot = screenshotOf(payload);
    const material = shot ? shot.slice('/uploads/proofs/'.length).split('.')[0] : JSON.stringify(payload);
    const proofHash = createHash('sha256').update(material).digest('hex');
    const fresh = await this.cache.setNx(`proof:${taskId}:${proofHash}`, userId, 30 * 24 * 3600);
    if (!fresh) throw new ConflictException('Duplicate proof detected (this evidence was already submitted)');

    try {
      await this.db.transaction(async (q) => {
        const upd = await q(
          `UPDATE task_claims
              SET status = 'submitted', submitted_at = now(),
                  proof_payload = $2::jsonb, proof_hash = $3
            WHERE id = $1 AND status = 'claimed'
            RETURNING id`,
          [row.id, JSON.stringify(payload), proofHash],
        );
        if (upd.rows.length === 0) throw new ConflictException('Claim is not in a submittable state');
        await this.outbox.publish(q, TOPICS.TASK_SUBMITTED, { claimId: row.id, taskId, userId });
      });
    } catch (err) {
      throw this.translate(err);
    }

    // fire auto-validation for snappy UX; the worker retries anything missed
    setImmediate(() => this.validateClaim(row.id).catch((e) => this.log.error(`validate: ${e.message}`)));
    return { claimId: row.id, status: 'submitted', validation: 'queued' };
  }

  /** Automated validation; drops to manual review when rules or trust say so. */
  async validateClaim(claimId: number): Promise<{ outcome: string }> {
    const data = await this.db.query<{ trust: number; requires_admin: boolean; rules: any; status: string }>(
      `SELECT u.trust_score AS trust, t.requires_admin, t.validation_rules AS rules, c.status
         FROM task_claims c
         JOIN tasks t ON t.id = c.task_id
         JOIN users u ON u.id = c.user_id
        WHERE c.id = $1`,
      [claimId],
    );
    if (data.rows.length === 0) return { outcome: 'missing' };
    const { trust, requires_admin, rules, status } = data.rows[0];
    if (status !== 'submitted') return { outcome: `skipped:${status}` };

    if (requires_admin) return this.queueForReview(claimId, 'task requires admin validation');
    if (trust < config.fraud.autoMinTrust) return this.queueForReview(claimId, `low trust score (${trust})`);

    const payloadR = await this.db.query<{ proof_payload: any }>(
      `SELECT proof_payload FROM task_claims WHERE id = $1`,
      [claimId],
    );
    const payload: Record<string, unknown> = payloadR.rows[0]?.proof_payload ?? {};

    // Screenshot proof: the image itself is the evidence (write-ups are gone).
    const shot = screenshotOf(payload);
    if (shot && !existsSync(join(process.cwd(), shot.slice(1)))) {
      return this.queueForReview(claimId, 'screenshot file missing on disk');
    }
    const failure = structuralFailure(rules, payload);
    if (failure) return this.queueForReview(claimId, failure);

    const approved = await this.approveSubmission(claimId, null);
    return { outcome: approved ? 'approved' : 'already_processed' };
  }

  async queueForReview(claimId: number, reason: string): Promise<{ outcome: string }> {
    await this.db.query(
      `UPDATE task_claims SET status = 'queued_review', rejection_reason = NULL
        WHERE id = $1 AND status = 'submitted'`,
      [claimId],
    );
    this.log.log(`claim ${claimId} queued for review: ${reason}`);
    return { outcome: `queued_review: ${reason}` };
  }

  /** Pays the reward. Idempotent: envelope key = reward:${claimId}. */
  async approveSubmission(claimId: number, validatorId: string | null): Promise<boolean> {
    return this.db.transaction(async (q) => {
      const claim = await q<{
        id: number;
        task_id: string;
        user_id: string;
        reward_kobo: string | number;
        status: string;
      }>(
        `SELECT id, task_id, user_id, COALESCE(reward_kobo, 0) AS reward_kobo, status
           FROM task_claims WHERE id = $1 FOR UPDATE`,
        [claimId],
      );
      if (claim.rows.length === 0) throw new NotFoundException('Claim not found');
      const c = claim.rows[0];
      if (!['submitted', 'queued_review'].includes(c.status)) return false; // replay/no-op
      const reward = Number(c.reward_kobo);

      // budget guard before money moves
      const budget = await q<{ ok: boolean }>(
        `SELECT (spent_kobo + $2 <= budget_kobo) AS ok FROM tasks WHERE id = $1 FOR UPDATE`,
        [c.task_id, reward],
      );
      if (!budget.rows[0]?.ok) {
        await this.rejectSubmission(claimId, 'Advertiser budget exhausted', validatorId, q);
        return false;
      }

      const upd = await q(
        `UPDATE task_claims SET status = 'approved', validator_id = $2, rejection_reason = NULL
          WHERE id = $1 AND status IN ('submitted','queued_review')
          RETURNING id`,
        [claimId, validatorId],
      );
      if (upd.rows.length === 0) return false;

      await q(
        `UPDATE tasks SET spent_kobo = spent_kobo + $2, approved_count = approved_count + 1 WHERE id = $1`,
        [c.task_id, reward],
      );

      await postTransaction(q, {
        idempotencyKey: `reward:${claimId}`,
        type: 'reward',
        userId: c.user_id,
        totalKobo: reward,
        metadata: { claimId, taskId: c.task_id },
        moves: [
          {
            walletId: c.user_id,
            deltaKobo: reward,
            entryType: 'task_reward',
            moveKey: 'wallet',
            refType: 'task_claim',
            refId: String(claimId),
            memo: 'Micro-task reward',
          },
        ],
      });

      await this.outbox.publish(q, TOPICS.TASK_APPROVED, { claimId, taskId: c.task_id, userId: c.user_id, rewardKobo: reward });
      await this.outbox.publish(q, TOPICS.WALLET_CREDITED, {
        userId: c.user_id,
        amountKobo: reward,
        reason: 'task_reward',
        claimId,
      });
      return true;
    });
  }

  /** Rejects and frees the quota slot so another user can attempt the task. */
  async rejectSubmission(
    claimId: number,
    reason: string,
    validatorId: string | null,
    scoped?: QueryFn,
  ): Promise<boolean> {
    const run = async (q: QueryFn) => {
      const upd = await q<{ task_id: string }>(
        `UPDATE task_claims
            SET status = 'rejected', validator_id = $2, rejection_reason = $3
          WHERE id = $1 AND status IN ('submitted','queued_review','claimed')
          RETURNING task_id`,
        [claimId, validatorId, reason],
      );
      if (upd.rows.length === 0) return false;
      await q(`UPDATE tasks SET claimed_count = GREATEST(claimed_count - 1, 0) WHERE id = $1`, [upd.rows[0].task_id]);
      await this.outbox.publish(q, TOPICS.TASK_REJECTED, { claimId, reason });
      return true;
    };
    return scoped ? run(scoped) : this.db.transaction(run);
  }

  /** Expire stale claims (abandoned by users) and release their quota. */
  async expireStaleClaims(): Promise<number> {
    const r = await this.db.query(
      `WITH expired AS (
         UPDATE task_claims SET status = 'expired'
          WHERE status = 'claimed' AND expires_at < now()
          RETURNING task_id
       )
       UPDATE tasks t SET claimed_count = GREATEST(t.claimed_count - 1, 0)
         FROM expired e WHERE t.id = e.task_id`,
    );
    return r.rowCount;
  }

  /** Backstop: auto-validate any submitted claim the fire-and-forget call missed. */
  async revalidateStuck(): Promise<void> {
    const stuck = await this.db.query<{ id: number }>(
      `SELECT c.id FROM task_claims c JOIN tasks t ON t.id = c.task_id
        WHERE c.status = 'submitted' AND NOT t.requires_admin
          AND c.submitted_at < now() - interval '15 seconds'
        LIMIT 20`,
    );
    for (const row of stuck.rows) {
      await this.validateClaim(row.id).catch((e) => this.log.error(`revalidate ${row.id}: ${e.message}`));
    }
  }

  private translate(err: unknown): unknown {
    if (
      err instanceof BadRequestException ||
      err instanceof ConflictException ||
      err instanceof NotFoundException ||
      err instanceof ForbiddenException
    ) {
      return err;
    }
    const code = (err as any)?.code;
    if (code === '23505') return new ConflictException('Duplicate claim or proof');
    return err;
  }
}
