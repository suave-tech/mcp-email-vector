import { ensureFreshToken } from "../auth/token.js";
import { query } from "../db/client.js";
import {
  type CleanupCandidate,
  describeMessages,
  listMatchingIds,
  trashMessages,
} from "../providers/gmail.js";
import { previewCleanupImap, runCleanupImap } from "./imap-runner.js";
import { type CleanupRules, rulesToGmailQuery } from "./rules.js";

const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const YAHOO_WRITE_SCOPE = "mail-w";
const PREVIEW_SAMPLE_SIZE = 20;

interface AccountRow {
  id: string;
  user_id: string;
  provider: "gmail" | "outlook" | "imap" | "yahoo";
  email_address: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string | null;
  scopes_granted: string[] | null;
}

async function loadAccount(userId: string, accountId: string): Promise<AccountRow> {
  const [acct] = await query<AccountRow>(
    `SELECT id, user_id, provider, email_address, access_token, refresh_token, token_expires_at, scopes_granted
     FROM accounts WHERE id = $1 AND user_id = $2 AND is_active = true`,
    [accountId, userId],
  );
  if (!acct) throw new CleanupError("account_not_found", 404);
  assertCleanupAuthorized(acct);
  return acct;
}

function assertCleanupAuthorized(acct: AccountRow): void {
  const scopes = acct.scopes_granted ?? [];
  switch (acct.provider) {
    case "gmail":
      if (!scopes.includes(GMAIL_MODIFY_SCOPE)) throw new CleanupError("cleanup_not_authorized", 403);
      return;
    case "yahoo":
      if (!scopes.includes(YAHOO_WRITE_SCOPE)) throw new CleanupError("cleanup_not_authorized", 403);
      return;
    default:
      throw new CleanupError("provider_not_supported", 400);
  }
}

export class CleanupError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

export interface PreviewResult {
  query: string;
  matched: number;
  cap: number;
  sample: CleanupCandidate[];
}

export async function previewCleanup(
  userId: string,
  accountId: string,
  rules: CleanupRules,
): Promise<PreviewResult> {
  const acct = await loadAccount(userId, accountId);
  const accessToken = await ensureFreshToken(acct);

  if (acct.provider === "gmail") {
    const q = rulesToGmailQuery(rules);
    const ids = await listMatchingIds(accessToken, q, rules.maxMessages);
    const sample = await describeMessages(accessToken, ids.slice(0, PREVIEW_SAMPLE_SIZE));
    return { query: q, matched: ids.length, cap: rules.maxMessages, sample };
  }

  // Yahoo (and future IMAP presets) — dispatch to the IMAP-aware runner.
  return previewCleanupImap(
    { provider: acct.provider, emailAddress: acct.email_address, accessToken },
    rules,
  );
}

export interface RunResult {
  query: string;
  trashed: number;
}

export async function runCleanup(userId: string, accountId: string, rules: CleanupRules): Promise<RunResult> {
  const acct = await loadAccount(userId, accountId);
  const accessToken = await ensureFreshToken(acct);

  if (acct.provider === "gmail") {
    const q = rulesToGmailQuery(rules);
    const ids = await listMatchingIds(accessToken, q, rules.maxMessages);
    await trashMessages(accessToken, ids);
    return { query: q, trashed: ids.length };
  }

  return runCleanupImap({ provider: acct.provider, emailAddress: acct.email_address, accessToken }, rules);
}
