import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../config/env.js";

export const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

export interface SyncJobPayload {
  accountId: string;
  kind: "initial" | "incremental";
}

export const syncQueue = new Queue<SyncJobPayload>("email-sync", { connection });
