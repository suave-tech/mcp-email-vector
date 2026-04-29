import { Router } from "express";
import { getUserId, requireAuth } from "../auth/jwt.js";
import { env } from "../config/env.js";
import { query } from "../db/client.js";
import { YAHOO_PRESET } from "../providers/presets.js";
import { syncQueue } from "../queue/queue.js";
import { deleteByAccount } from "../vector/pinecone.js";
import { GMAIL_MODIFY_SCOPE, buildGoogleAuthUrl, buildYahooAuthUrl } from "./oauth.js";

export const accountsRouter: Router = Router();

accountsRouter.use(requireAuth);

accountsRouter.get("/", async (req, res) => {
  const userId = getUserId(req);
  const rows = await query(
    `SELECT id, provider, email_address, last_synced, initial_sync_complete, is_active, needs_reauth,
       ($1 = ANY(COALESCE(scopes_granted, '{}'::text[])) OR $2 = ANY(COALESCE(scopes_granted, '{}'::text[]))) AS cleanup_enabled
     FROM accounts WHERE user_id = $3 ORDER BY created_at ASC`,
    [GMAIL_MODIFY_SCOPE, YAHOO_PRESET.oauth.writeScope, userId],
  );
  res.json({ accounts: rows });
});

accountsRouter.delete("/:accountId", async (req, res) => {
  const userId = getUserId(req);
  const { accountId } = req.params;
  const rows = await query<{ id: string }>("SELECT id FROM accounts WHERE id = $1 AND user_id = $2", [
    accountId,
    userId,
  ]);
  if (rows.length === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await deleteByAccount(userId, accountId!);
  await query("DELETE FROM accounts WHERE id = $1", [accountId]);
  res.json({ deleted: true });
});

accountsRouter.get("/:accountId/sync", async (req, res) => {
  const userId = getUserId(req);
  const rows = await query(
    `SELECT id, status, emails_synced, started_at, completed_at, error
     FROM sync_jobs WHERE account_id IN
       (SELECT id FROM accounts WHERE id = $1 AND user_id = $2)
     ORDER BY started_at DESC NULLS LAST LIMIT 10`,
    [req.params.accountId, userId],
  );
  res.json({ jobs: rows });
});

accountsRouter.post("/:accountId/sync", async (req, res) => {
  const userId = getUserId(req);
  const rows = await query<{ id: string }>("SELECT id FROM accounts WHERE id = $1 AND user_id = $2", [
    req.params.accountId,
    userId,
  ]);
  if (rows.length === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const job = await syncQueue.add("manual", { accountId: rows[0]!.id, kind: "incremental" });
  res.json({ queued: true, jobId: job.id });
});

// Returns a {redirectUrl} the client should navigate to in order to re-consent
// for the write scope needed by inbox cleanup.
accountsRouter.get("/:accountId/cleanup/upgrade", async (req, res) => {
  if (!env.ENABLE_INBOX_CLEANUP) {
    res.status(403).json({ error: "cleanup_disabled_by_deployment" });
    return;
  }
  const userId = getUserId(req);
  const rows = await query<{ provider: string }>(
    "SELECT provider FROM accounts WHERE id = $1 AND user_id = $2",
    [req.params.accountId, userId],
  );
  if (rows.length === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const { provider } = rows[0]!;
  if (provider === "gmail") {
    res.json({ redirectUrl: buildGoogleAuthUrl(userId, true) });
  } else if (provider === "yahoo") {
    if (!env.YAHOO_CLIENT_ID || !env.YAHOO_CLIENT_SECRET || !env.YAHOO_REDIRECT_URI) {
      res.status(501).json({ error: "yahoo_not_configured" });
      return;
    }
    res.json({ redirectUrl: buildYahooAuthUrl(userId, true) });
  } else {
    res.status(400).json({ error: "provider_not_supported" });
  }
});

// Strips the write scope from the DB so cleanup endpoints return 403 for this
// account. Does not revoke the underlying provider token (revoking would also
// break readonly sync since providers issue a single token per grant).
accountsRouter.delete("/:accountId/cleanup", async (req, res) => {
  const userId = getUserId(req);
  const rows = await query<{ provider: string }>(
    "SELECT provider FROM accounts WHERE id = $1 AND user_id = $2",
    [req.params.accountId, userId],
  );
  if (rows.length === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const scopeToRemove = rows[0]!.provider === "gmail" ? GMAIL_MODIFY_SCOPE : YAHOO_PRESET.oauth.writeScope;
  await query("UPDATE accounts SET scopes_granted = array_remove(scopes_granted, $1) WHERE id = $2", [
    scopeToRemove,
    req.params.accountId,
  ]);
  res.json({ cleanupEnabled: false });
});
