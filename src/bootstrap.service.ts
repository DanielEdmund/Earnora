import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AuthService } from './auth/auth.service';
import { config } from './config';
import { DB, Db } from './common/db';

/** Runs once at boot: admin account + demo task inventory. */
@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly log = new Logger('Bootstrap');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly auth: AuthService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureAdmin();
    if (config.seedDemo) await this.ensureDemoTasks();
  }

  private async ensureAdmin(): Promise<void> {
    const existing = await this.db.query<{ id: string; password_hash: string }>(
      `SELECT id, password_hash FROM users WHERE lower(email) = $1`,
      [config.adminEmail.toLowerCase()],
    );
    if (existing.rows.length > 0) {
      // B2: ADMIN_PASSWORD in the environment is the source of truth for the
      // owner login — setting it (e.g. rotating away from the published default)
      // re-hashes the stored password on the next boot.
      if (
        process.env.ADMIN_PASSWORD &&
        !(await this.auth.verifyPassword(config.adminPassword, existing.rows[0].password_hash))
      ) {
        await this.db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
          existing.rows[0].id,
          await this.auth.hashPassword(config.adminPassword),
        ]);
        this.log.log(`admin password refreshed from ADMIN_PASSWORD for ${config.adminEmail}`);
      }
      return;
    }
    const passwordHash = await this.auth.hashPassword(config.adminPassword);
    await this.db.query(
      `INSERT INTO users (email, password_hash, role, status, referral_code, trust_score)
       VALUES ($1, $2, 'admin', 'active', $3, 100)`,
      [config.adminEmail.toLowerCase(), passwordHash, `ADM${randomBytes(4).toString('hex').toUpperCase()}`],
    );
    this.log.log(`admin account ready: ${config.adminEmail}`);
  }

  private async ensureDemoTasks(): Promise<void> {
    const existing = await this.db.query(`SELECT count(*)::int AS n FROM tasks`);
    if (Number(existing.rows[0].n) > 0) return;

    // budgets must cover the top plan payout (₦400 = 40_000 kobo) × quota,
    // because approved tasks pay the CLAIMER'S PLAN rate, not the listed reward.
    const demo: Array<[string, string, string, number, number, number, boolean, string]> = [
      // title, category, description, reward, budget, quota, requires_admin, rules
      ['3-minute consumer survey', 'survey', 'Answer 6 questions about your shopping habits.', 30_000, 4_000_000, 100, false, '{"requiredFields":["q1","q2","age"],"minChars":40}'],
      ['Click & verify sponsored link', 'ad_click', 'Open the sponsor link and confirm the landing page headline.', 15_000, 8_000_000, 200, false, '{"requiredFields":["clickToken","headline"],"minChars":10}'],
      ['Proofread Nigerian product copy', 'text_validation', 'Correct spelling/grammar in the supplied paragraph.', 50_000, 2_000_000, 50, true, '{"requiredFields":["corrected"],"minChars":80}'],
      ['Test new fintech app onboarding', 'app_test', 'Install the beta build, finish onboarding, report friction points.', 150_000, 6_000_000, 40, true, '{"requiredFields":["device","screenshotsNote","friction"],"minChars":60}'],
      ['Label 20 product images', 'text_validation', 'Assign the correct category to each image shown.', 80_000, 4_000_000, 30, true, '{"requiredFields":["labels"],"minChars":50}'],
    ];
    for (const [title, category, description, reward, budget, quota, reqAdmin, rules] of demo) {
      await this.db.query(
        `INSERT INTO tasks (advertiser_id, title, description, category, reward_kobo, budget_kobo, quota, requires_admin, validation_rules)
         VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [title, description, category, reward, budget, quota, reqAdmin, rules],
      );
    }
    this.log.log(`seeded ${demo.length} demo tasks`);
  }
}
