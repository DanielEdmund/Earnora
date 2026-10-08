-- Proof screenshots stored in the database (bytea) instead of the local disk.
-- Serverless platforms (Vercel) mount a read-only, ephemeral filesystem: a
-- writeFileSync would fail and files would not survive between invocations.
-- Content-addressed by SHA-256, so identical screenshots share one row.
CREATE TABLE IF NOT EXISTS proof_files (
  sha256     TEXT PRIMARY KEY,
  ext        TEXT NOT NULL,
  bytes      BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
