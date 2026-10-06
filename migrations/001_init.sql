-- ============================================================================
-- Earnora initial schema
-- Money amounts are integer kobo (₦1 = 100 kobo). Ledger is append-only.
-- ============================================================================

-- ── Identity ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT NOT NULL,
  phone              TEXT,
  password_hash      TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'user',      -- user | admin | system
  status             TEXT NOT NULL DEFAULT 'pending_activation',
                     -- pending_activation | active | suspended | banned
  referred_by        UUID REFERENCES users(id),
  referral_code      TEXT NOT NULL,
  kyc_tier           SMALLINT NOT NULL DEFAULT 0,
  trust_score        SMALLINT NOT NULL DEFAULT 100,     -- 0..100, fraud service writes
  refresh_token_hash TEXT,
  refresh_expires_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email  ON users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone  ON users (phone);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_refcod ON users (referral_code);
CREATE INDEX IF NOT EXISTS ix_users_referred_by   ON users (referred_by);

CREATE TABLE IF NOT EXISTS user_devices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint_hash CHAR(64) NOT NULL,               -- sha256(device fingerprint)
  ip_last_seen     TEXT NOT NULL,
  user_agent       TEXT,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, fingerprint_hash)
);
CREATE INDEX IF NOT EXISTS ix_device_fp ON user_devices (fingerprint_hash);
CREATE INDEX IF NOT EXISTS ix_device_ip ON user_devices (ip_last_seen);

-- ── Referrals ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS referral_tiers (
  tier_level   SMALLINT PRIMARY KEY,               -- 1 = direct referrer, ...
  percent_bps  INT NOT NULL,                       -- bps of activation fee (1500 = 15%)
  max_depth    SMALLINT NOT NULL DEFAULT 3,
  active       BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO referral_tiers (tier_level, percent_bps, max_depth) VALUES
  (1, 1500, 3),
  (2,  500, 3),
  (3,  250, 3)
ON CONFLICT (tier_level) DO NOTHING;

CREATE TABLE IF NOT EXISTS referral_credits (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  beneficiary_id  UUID NOT NULL REFERENCES users(id),
  source_user_id  UUID NOT NULL REFERENCES users(id),
  activation_ref  TEXT NOT NULL,                   -- PSP reference of activation
  tier_level      SMALLINT NOT NULL,
  amount_kobo     BIGINT NOT NULL CHECK (amount_kobo > 0),
  ledger_entry_id BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (beneficiary_id, source_user_id, activation_ref, tier_level)  -- idempotent credit
);
CREATE INDEX IF NOT EXISTS ix_refcredits_ben ON referral_credits (beneficiary_id, created_at DESC);

-- ── Wallet & ledger (single writer: wallet/ledger.ts) ──────────────────────

CREATE TABLE IF NOT EXISTS wallets (
  user_id        UUID PRIMARY KEY REFERENCES users(id),
  available_kobo BIGINT NOT NULL DEFAULT 0 CHECK (available_kobo >= 0),
  reserved_kobo  BIGINT NOT NULL DEFAULT 0 CHECK (reserved_kobo  >= 0),
  lifetime_kobo  BIGINT NOT NULL DEFAULT 0,
  currency       CHAR(3) NOT NULL DEFAULT 'NGN',
  version        BIGINT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  txn_id          UUID NOT NULL UNIQUE,
  user_id         UUID REFERENCES users(id),        -- nullable: platform-scope txn
  type            TEXT NOT NULL,
                  -- deposit | activation | reward | commission
                  -- | withdrawal | reversal | adjustment
  status          TEXT NOT NULL DEFAULT 'settled',  -- pending | held | settled | failed | reversed
  total_kobo      BIGINT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,             -- replay collapses to one effect
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ledger_entries (          -- append-only; never UPDATE/DELETE
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  txn_id        UUID NOT NULL,
  wallet_id     UUID NOT NULL REFERENCES wallets(user_id),
  direction     TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount_kobo   BIGINT NOT NULL CHECK (amount_kobo > 0),
  balance_after BIGINT NOT NULL,
  entry_type    TEXT NOT NULL,
                -- task_reward | activation_fee | referral_commission
                -- | withdrawal | withdrawal_reversal | adjustment
  ref_type      TEXT,
  ref_id        TEXT,
  idempotency_key TEXT NOT NULL,
  memo          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key, wallet_id, direction)
);
CREATE INDEX IF NOT EXISTS ix_ledger_wallet ON ledger_entries (wallet_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_ledger_txn    ON ledger_entries (txn_id);

-- System / platform clearing account (collects activation fees, pays commissions)
INSERT INTO users (id, email, password_hash, role, status, referral_code)
VALUES ('00000000-0000-0000-0000-000000000001', 'platform@earnora.local', 'system', 'system', 'system', 'PLATFORM')
ON CONFLICT (id) DO NOTHING;
INSERT INTO wallets (user_id) VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (user_id) DO NOTHING;

-- ── Payments & webhooks ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES users(id),
  purpose        TEXT NOT NULL DEFAULT 'activation',   -- activation | topup
  amount_kobo    BIGINT NOT NULL CHECK (amount_kobo > 0),
  psp            TEXT NOT NULL DEFAULT 'paystack',     -- paystack | flutterwave | simulated
  psp_reference  TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'pending',      -- pending | success | failed | refunded
  raw_callback   JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_payments_user ON payments (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  psp          TEXT NOT NULL,
  event_id     TEXT NOT NULL,                          -- PSP event id (dedupe key)
  payload      JSONB NOT NULL,
  signature_ok BOOLEAN NOT NULL,
  processed_at TIMESTAMPTZ,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (psp, event_id)
);

-- ── Withdrawals ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS withdrawals (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id),
  amount_kobo     BIGINT NOT NULL CHECK (amount_kobo > 0),
  fee_kobo        BIGINT NOT NULL DEFAULT 0,
  bank_code       TEXT NOT NULL,
  account_number  TEXT NOT NULL,
  account_name    TEXT,
  status          TEXT NOT NULL DEFAULT 'queued',
                  -- queued | disbursing | paid | failed | reversed
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_date     DATE NOT NULL,
  transfer_ref    TEXT UNIQUE,                          -- bank/PSP idempotency ref
  attempts        SMALLINT NOT NULL DEFAULT 0,
  last_error      TEXT,
  settled_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wd_user_window ON withdrawals (user_id, window_date);
CREATE INDEX IF NOT EXISTS ix_wd_queue ON withdrawals (window_date, status, requested_at);

-- ── Tasks ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tasks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advertiser_id  UUID REFERENCES users(id),
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  category       TEXT NOT NULL,                        -- survey | ad_click | text_validation | app_test
  reward_kobo    BIGINT NOT NULL CHECK (reward_kobo > 0),
  budget_kobo    BIGINT NOT NULL,
  spent_kobo     BIGINT NOT NULL DEFAULT 0,
  quota          INT NOT NULL,
  claimed_count  INT NOT NULL DEFAULT 0,
  approved_count INT NOT NULL DEFAULT 0,
  requires_admin BOOLEAN NOT NULL DEFAULT false,
  validation_rules JSONB NOT NULL DEFAULT '{}'::jsonb, -- {requiredFields:[], minChars:n}
  status         TEXT NOT NULL DEFAULT 'open',         -- draft | open | closed
  opens_at       TIMESTAMPTZ,
  closes_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (spent_kobo <= budget_kobo)
);
CREATE INDEX IF NOT EXISTS ix_tasks_feed ON tasks (status, category, closes_at);

CREATE TABLE IF NOT EXISTS task_claims (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id          UUID NOT NULL REFERENCES tasks(id),
  user_id          UUID NOT NULL REFERENCES users(id),
  status           TEXT NOT NULL DEFAULT 'claimed',
                   -- claimed | submitted | queued_review | approved | rejected | expired
  claimed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  submitted_at     TIMESTAMPTZ,
  proof_s3_keys    TEXT[] NOT NULL DEFAULT '{}',
  proof_payload    JSONB,
  proof_hash       CHAR(64),
  validator_id     UUID,
  rejection_reason TEXT,
  reward_kobo      BIGINT                              -- snapshot at claim time
);
-- one *active* claim per user per task; rejected/expired allow retry
CREATE UNIQUE INDEX IF NOT EXISTS uq_claim_active
  ON task_claims (task_id, user_id)
  WHERE status IN ('claimed','submitted','queued_review','approved');
CREATE INDEX IF NOT EXISTS ix_claims_user  ON task_claims (user_id, status, claimed_at DESC);
CREATE INDEX IF NOT EXISTS ix_claims_review ON task_claims (status, submitted_at)
  WHERE status IN ('submitted','queued_review');
CREATE INDEX IF NOT EXISTS ix_claims_expiry ON task_claims (expires_at)
  WHERE status = 'claimed';

-- ── Fraud ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fraud_flags (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID REFERENCES users(id),
  reason      TEXT NOT NULL,        -- device_dup | ip_farm | velocity | bot | proof_dup
  severity    TEXT NOT NULL DEFAULT 'flag',   -- flag | review | block
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_fraudflags_user ON fraud_flags (user_id, created_at DESC);

-- ── Outbox (transactional event relay) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS outbox_events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic        TEXT NOT NULL,
  payload      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_outbox_unpublished ON outbox_events (id)
  WHERE published_at IS NULL;
