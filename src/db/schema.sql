-- Vector email app schema.
-- Raw email text is never persisted; only metadata + sync state lives here.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('gmail', 'outlook', 'imap')),
  email_address TEXT NOT NULL,
  access_token  TEXT NOT NULL,       -- AES-256 encrypted
  refresh_token TEXT NOT NULL,       -- AES-256 encrypted
  token_expires_at TIMESTAMPTZ,
  scopes_granted TEXT[],
  last_synced   TIMESTAMPTZ,
  initial_sync_complete BOOLEAN NOT NULL DEFAULT false,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  needs_reauth  BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, email_address)
);

CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts (user_id);
CREATE INDEX IF NOT EXISTS accounts_last_synced_idx ON accounts (last_synced);

CREATE TABLE IF NOT EXISTS sync_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'running', 'complete', 'failed')),
  emails_synced INT NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  error         TEXT
);

CREATE INDEX IF NOT EXISTS sync_jobs_account_idx ON sync_jobs (account_id, started_at DESC);

-- Dedup + change tracking. One row per (account, message_id).
CREATE TABLE IF NOT EXISTS sync_log (
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  message_id     TEXT NOT NULL,
  vector_id      TEXT NOT NULL,
  content_hash   TEXT NOT NULL,      -- hash of subject+body to detect edits
  embedded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, message_id)
);

-- Per-user email count (enforces EMAIL_LIMIT_PER_USER cheaply without scanning Pinecone).
CREATE TABLE IF NOT EXISTS user_quota (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  emails_indexed INT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
