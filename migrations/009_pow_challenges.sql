-- Proof-of-work challenges issued for task claims.
-- Previously kept only in the (per-process) cache; on serverless the challenge
-- may be issued on one function instance and verified on another, so single-use
-- challenges now live in the database (atomic DELETE .. RETURNING keeps them
-- single-use across instances).
CREATE TABLE IF NOT EXISTS pow_challenges (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS pow_challenges_expires_idx ON pow_challenges (expires_at);
