-- ============================================================================
-- 002: Earning PLANS replace the old flat activation fee.
--   beginner      ₦3,000  →  5 tasks/day   ₦200 per task   ₦200 per referral
--   intermediate  ₦6,500  → 10 tasks/day   ₦300 per task   ₦400 per referral
--   extreme      ₦10,500  → 12 tasks/day   ₦400 per task   ₦600 per referral
-- Plans are one-time (no expiry) and gate BOTH task access and withdrawals.
-- The flat referral bonus is paid when a referred user buys a plan, at the
-- REFERRER's plan rate (referrer without a plan earns nothing).
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT;               -- beginner | intermediate | extreme | NULL
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_purchased_at TIMESTAMPTZ;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS plan_key TEXT;        -- which plan a 'plan' payment buys

-- Advertiser budgets must cover the highest plan payout (₦400) per approval.
UPDATE tasks SET budget_kobo = quota * 40000
 WHERE advertiser_id IS NULL AND budget_kobo < quota * 40000;
