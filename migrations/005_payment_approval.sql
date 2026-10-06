-- ============================================================================
-- 0005: Manual payment approval.
--   A confirmed PSP charge no longer unlocks a plan by itself: the payment
--   sits in approval='pending' until an admin approves it (approvePayment
--   assigns the plan + credits everyone) or rejects it. Existing confirmed
--   payments were already delivered → grandfathered as 'approved'.
-- ============================================================================

ALTER TABLE payments ADD COLUMN IF NOT EXISTS approval     TEXT NOT NULL DEFAULT 'pending';  -- pending | approved | rejected
ALTER TABLE payments ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS approved_by  UUID REFERENCES users(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reject_reason TEXT;

UPDATE payments SET approval = 'approved', approved_at = confirmed_at WHERE status = 'success';

CREATE INDEX IF NOT EXISTS ix_payments_approval ON payments (approval, created_at DESC);
