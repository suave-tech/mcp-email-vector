-- Yahoo (IMAP + XOAUTH2) provider support.
-- The DEFAULT constraint name in Postgres for a table-level CHECK is
-- <table>_<column>_check — matching that so the DROP is deterministic.

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_provider_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_provider_check
  CHECK (provider IN ('gmail', 'outlook', 'imap', 'yahoo'));

-- Per-account provider-specific sync state. IMAP adapters use this to track
-- per-folder UIDVALIDITY + lastUid so a restart or UIDVALIDITY rollover
-- resumes correctly. Gmail writes NULL (provider returns undefined), so the
-- column stays empty for existing rows and costs nothing in storage.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS provider_state JSONB;
