-- ===========================================================================
-- 006: Split the spendable balance into its two earning sources.
--   task_kobo      — unspent earnings from APPROVED tasks
--                    (credited at the earner's plan rate: 200/300/400)
--   affiliate_kobo — unspent earnings from REFERRALS
--                    (credited at the referrer's plan rate: 200/400/600)
-- Invariant maintained from now on by src/wallet/ledger.ts:
--   task_kobo + affiliate_kobo = available_kobo
-- (credits land in their source bucket; withdrawals draw affiliate first,
--  and a failed payout refunds each bucket exactly what it took.)
-- ===========================================================================

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS task_kobo      BIGINT NOT NULL DEFAULT 0 CHECK (task_kobo >= 0);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS affiliate_kobo BIGINT NOT NULL DEFAULT 0 CHECK (affiliate_kobo >= 0);

-- ── backfill: gross earnings per source from the append-only ledger ────────
UPDATE wallets w
   SET task_kobo      = COALESCE(g.tsk, 0),
       affiliate_kobo = COALESCE(g.aff, 0)
  FROM (
    SELECT wallet_id,
           SUM(amount_kobo) FILTER (WHERE entry_type <> 'referral_commission') AS tsk,
           SUM(amount_kobo) FILTER (WHERE entry_type = 'referral_commission') AS aff
      FROM ledger_entries
     WHERE direction = 'credit'
     GROUP BY wallet_id
  ) g
 WHERE g.wallet_id = w.user_id;

-- ── clamp down to available (withdrawals/reservations already taken) —
--    affiliate first, exactly like runtime draws do ────────────────────────
UPDATE wallets
   SET affiliate_kobo = GREATEST(affiliate_kobo - GREATEST(task_kobo + affiliate_kobo - available_kobo, 0), 0)
 WHERE task_kobo + affiliate_kobo > available_kobo;

UPDATE wallets
   SET task_kobo = task_kobo - GREATEST(task_kobo + affiliate_kobo - available_kobo, 0)
 WHERE task_kobo + affiliate_kobo > available_kobo;

-- ── clamp up (a wallet credited without a ledger row should never happen,
--    but never leave the sum short either) ─────────────────────────────────
UPDATE wallets
   SET task_kobo = task_kobo + (available_kobo - task_kobo - affiliate_kobo)
 WHERE task_kobo + affiliate_kobo < available_kobo;
