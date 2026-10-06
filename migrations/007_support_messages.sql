-- ===========================================================================
-- 007: Support inbox — questions the chatbot could not answer.
--   The chat widget POSTs an unmatched message here (as the signed-in user,
--   so the account email rides along via the users join). The owner replies
--   from the admin dashboard, and the reply is delivered back into the
--   user's chat thread on their next open / poll.
--     open    → nobody has answered yet (admin badge counts these)
--     replied → replied_at/replied_by set; the widget injects it as a bubble
-- ===========================================================================

CREATE TABLE IF NOT EXISTS support_messages (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 1000),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'replied')),
  reply       TEXT CHECK (reply IS NULL OR char_length(btrim(reply)) BETWEEN 1 AND 2000),
  replied_at  TIMESTAMPTZ,
  replied_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_support_user ON support_messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_support_open ON support_messages (created_at DESC) WHERE status = 'open';
