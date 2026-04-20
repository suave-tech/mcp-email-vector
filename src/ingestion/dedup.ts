import { query } from "../db/client.js";

export interface SyncLogEntry {
  message_id: string;
  content_hash: string;
  vector_id: string;
}

export async function getExistingLog(accountId: string, messageIds: string[]): Promise<Map<string, SyncLogEntry>> {
  if (messageIds.length === 0) return new Map();
  const rows = await query<SyncLogEntry>(
    "SELECT message_id, content_hash, vector_id FROM sync_log WHERE account_id = $1 AND message_id = ANY($2)",
    [accountId, messageIds],
  );
  return new Map(rows.map((r) => [r.message_id, r]));
}

export async function recordLog(accountId: string, entries: SyncLogEntry[]): Promise<void> {
  for (const e of entries) {
    await query(
      `INSERT INTO sync_log (account_id, message_id, vector_id, content_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, message_id) DO UPDATE
         SET content_hash = EXCLUDED.content_hash,
             vector_id = EXCLUDED.vector_id,
             embedded_at = now()`,
      [accountId, e.message_id, e.vector_id, e.content_hash],
    );
  }
}
