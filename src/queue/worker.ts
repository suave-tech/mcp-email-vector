import { Worker } from "bullmq";
import { connection, type SyncJobPayload } from "./queue.js";
import { syncAccount } from "../ingestion/sync.js";
import { query } from "../db/client.js";

export const worker = new Worker<SyncJobPayload>(
  "email-sync",
  async (job) => {
    const [syncJob] = await query<{ id: string }>(
      `INSERT INTO sync_jobs (account_id, status, started_at) VALUES ($1, 'running', now()) RETURNING id`,
      [job.data.accountId],
    );

    try {
      const { synced } = await syncAccount(job.data.accountId);
      await query(
        `UPDATE sync_jobs SET status = 'complete', completed_at = now(), emails_synced = $1 WHERE id = $2`,
        [synced, syncJob!.id],
      );
      return { synced };
    } catch (err) {
      await query(
        `UPDATE sync_jobs SET status = 'failed', completed_at = now(), error = $1 WHERE id = $2`,
        [String((err as Error).message), syncJob!.id],
      );
      throw err;
    }
  },
  { connection, concurrency: 4 },
);

worker.on("failed", (job, err) => {
  console.error(`[sync] job ${job?.id} failed: ${err.message}`);
});

console.log("[sync] worker listening on queue 'email-sync'");
