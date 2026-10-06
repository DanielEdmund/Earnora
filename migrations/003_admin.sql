-- ============================================================================
-- 003: Admin dashboard — fraud flag triage.
-- Flags arrive open; an admin resolves them from the Risk tab so the
-- overview "open risks" KPI reflects what still needs a human.
-- ============================================================================

ALTER TABLE fraud_flags ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'open';
ALTER TABLE fraud_flags ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE fraud_flags ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS ix_fraudflags_open ON fraud_flags (status, created_at DESC);
