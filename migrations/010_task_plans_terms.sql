-- ============================================================================
-- 010: per-plan task scoping + Terms & Policy consent.
--
--   tasks.plan_key        NULL  -> visible to every plan (legacy tasks)
--                         value -> only users on that plan see/claim it
--   users.terms_consent_at     -> when the user ticked the Terms & Policy box
--                                  at registration (NULL = never, e.g. old
--                                  accounts created before the checkbox).
-- ============================================================================

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS plan_key TEXT
  CHECK (plan_key IS NULL OR plan_key IN ('beginner', 'intermediate', 'extreme'));

CREATE INDEX IF NOT EXISTS ix_tasks_plan ON tasks (plan_key);

ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_consent_at TIMESTAMPTZ;
