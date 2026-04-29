// Per-user email ingestion cap (see TECH-SPEC.md open questions).
export const EMAIL_LIMIT_PER_USER = 50_000;

// Labels / folders that must never be indexed.
export const EXCLUDED_LABELS = ["SPAM", "CATEGORY_PROMOTIONS"] as const;
export const EXCLUDED_OUTLOOK_FOLDERS = ["Junk Email"] as const;

// Embedding model dimensionality (text-embedding-3-small).
export const EMBEDDING_DIMENSIONS = 1536;

// Max tokens per embedded email (truncate if exceeded).
// Set below the model hard-limit (8192) to absorb heuristic rounding error.
export const MAX_EMAIL_TOKENS = 7500;

// Poll cadence per account.
export const POLL_INTERVAL_MS = 60 * 60 * 1000;

// Refresh OAuth tokens this far before expiry.
export const TOKEN_REFRESH_SKEW_MS = 10 * 60 * 1000;

// Initial sync batch size.
export const INITIAL_SYNC_BATCH = 100;

// Default top-K for search queries.
export const DEFAULT_TOP_K = 10;

export const namespaceFor = (userId: string) => `user_${userId}`;
