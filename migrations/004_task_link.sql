-- ============================================================================
-- 004: Task link — where users must go (follow this account, open this ad…).
-- Free text so t.me / wa.me / instagram URLs all work; the app normalises
-- missing protocols to https:// on write.
-- ============================================================================

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS link TEXT;
