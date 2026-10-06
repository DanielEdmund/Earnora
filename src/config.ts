import 'dotenv/config';

function num(name: string, def: number): number {
  const v = process.env[name];
  return v !== undefined && v !== '' ? Number(v) : def;
}

function bool(name: string, def: boolean): boolean {
  const v = process.env[name];
  return v !== undefined && v !== '' ? v === 'true' || v === '1' : def;
}

const isProd = process.env.NODE_ENV === 'production';

/** Defaults shipped in this repo — fine for local dev, never acceptable in production. */
const DEV_DEFAULTS = {
  jwtSecret: 'dev-secret-change-me',
  adminPassword: 'Admin123!',
  webhookSecret: 'whsec_change_me',
} as const;

/**
 * B1/B2: refuse to boot production on development secrets. Called from main.ts
 * BEFORE NestFactory.create so a misconfigured deploy dies loudly instead of
 * running with forgeable JWTs and a published admin password.
 */
export function assertSecureConfig(): void {
  if (!isProd) {
    if (config.jwtSecret === DEV_DEFAULTS.jwtSecret || config.adminPassword === DEV_DEFAULTS.adminPassword) {
      console.warn(
        '[config] development secrets in use (JWT_SECRET/ADMIN_PASSWORD) — local only; production refuses to boot without real values.',
      );
    }
    return;
  }

  const problems: string[] = [];
  if (!process.env.JWT_SECRET || config.jwtSecret === DEV_DEFAULTS.jwtSecret) {
    problems.push('JWT_SECRET is unset or still "dev-secret-change-me" (generate 32+ random bytes)');
  } else if (config.jwtSecret.length < 32) {
    problems.push(`JWT_SECRET is only ${config.jwtSecret.length} chars — use at least 32`);
  }
  if (!process.env.ADMIN_PASSWORD || config.adminPassword === DEV_DEFAULTS.adminPassword) {
    problems.push('ADMIN_PASSWORD is unset or still the published default "Admin123!"');
  }
  if (config.psp.mode !== 'simulated' && config.psp.webhookSecret === DEV_DEFAULTS.webhookSecret) {
    problems.push('WEBHOOK_SECRET is still "whsec_change_me" but PSP_MODE=' + config.psp.mode + ' accepts webhooks');
  }

  if (problems.length > 0) {
    console.error('\n[fatal] Refusing to start in production mode:\n' + problems.map((p) => `  - ${p}`).join('\n') + '\n');
    process.exit(1);
  }
}

export const config = {
  port: num('PORT', 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd,

  databaseUrl: process.env.DATABASE_URL || '', // '' -> embedded PGlite
  pgliteDir: process.env.PGLITE_DIR || './.pglite',
  redisUrl: process.env.REDIS_URL || '', // '' -> in-process cache

  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  accessTokenTtlSec: num('ACCESS_TOKEN_TTL_SEC', 7200),

  // money / business rules (plan definitions live in plans/plans.ts)
  platformWalletId: '00000000-0000-0000-0000-000000000001',

  withdrawal: {
    window: process.env.WITHDRAWAL_WINDOW || '17:00-19:00',
    tz: process.env.WITHDRAWAL_TZ || 'Africa/Lagos',
    allowQueue: bool('ALLOW_WITHDRAWAL_QUEUE', true),
    minKobo: num('MIN_WITHDRAWAL_KOBO', 1_500_000), // ₦15,000
    maxPerWindow: num('MAX_WITHDRAWALS_PER_WINDOW', 1),
    maxAttempts: num('WITHDRAWAL_MAX_ATTEMPTS', 3),
  },

  fraud: {
    maxAccountsPerDevice: num('MAX_ACCOUNTS_PER_DEVICE', 3),
    maxAccountsPerIp24: num('MAX_ACCOUNTS_PER_IP24', 10),
    claimVelocityPerMin: num('CLAIM_VELOCITY_PER_MIN', 10),
    minDwellSeconds: num('MIN_DWELL_SECONDS', 5),
    powDifficultyBits: num('POW_DIFFICULTY_BITS', 14),
    autoMinTrust: num('AUTO_MIN_TRUST', 60),
  },

  psp: {
    mode: process.env.PSP_MODE || 'simulated', // simulated | paystack | flutterwave
    paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
    paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || '',
    webhookSecret: process.env.WEBHOOK_SECRET || 'whsec_change_me',
  },

  /** Batcher drains payouts outside the window too (dev convenience; keep false in prod). */
  payoutOutsideWindow: bool('PAYOUT_OUTSIDE_WINDOW', process.env.NODE_ENV !== 'production'),

  seedDemo: bool('SEED_DEMO', true),
  adminEmail: process.env.ADMIN_EMAIL || 'admin@earnora.local',
  adminPassword: process.env.ADMIN_PASSWORD || 'Admin123!',

  outboxPollMs: num('OUTBOX_POLL_MS', 1000),
  payoutBatchMs: num('PAYOUT_BATCH_MS', 2000),

  /**
   * Outbound SMTP (password-reset OTP emails). When `host` is empty the code
   * is only written to the API log, so the flow still works with no setup.
   */
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: num('SMTP_PORT', 587),
    secure: bool('SMTP_SECURE', false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Earnora <no-reply@earnora.local>',
  },
};
