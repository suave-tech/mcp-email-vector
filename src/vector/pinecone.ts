import { Pinecone } from "@pinecone-database/pinecone";
import { env } from "../config/env.js";
import { namespaceFor } from "../config/constants.js";

const pc = new Pinecone({ apiKey: env.PINECONE_API_KEY });
const index = pc.index(env.PINECONE_INDEX);

export interface EmailVectorMetadata {
  user_id: string;
  account_id: string;
  message_id: string;
  thread_id: string | null;
  sender_email: string;
  sender_name: string | null;
  recipients: string[];
  subject: string;
  date: string;
  provider: string;
  has_attachments: boolean;
  labels: string[];
}

export interface UpsertItem {
  id: string;
  values: number[];
  metadata: EmailVectorMetadata;
}

export async function upsertEmailVectors(userId: string, items: UpsertItem[]): Promise<void> {
  if (items.length === 0) return;
  await index.namespace(namespaceFor(userId)).upsert(
    items.map((i) => ({
      id: i.id,
      values: i.values,
      // Pinecone metadata must be a flat record of primitives / string arrays.
      metadata: i.metadata as unknown as Record<string, string | number | boolean | string[]>,
    })),
  );
}

export interface QueryOptions {
  userId: string;
  vector: number[];
  topK: number;
  accountIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  messageIds?: string[];
  senderEmail?: string;
}

export async function queryEmailVectors(opts: QueryOptions) {
  const filter: Record<string, unknown> = {};
  if (opts.accountIds?.length) filter.account_id = { $in: opts.accountIds };
  if (opts.messageIds?.length) filter.message_id = { $in: opts.messageIds };
  if (opts.senderEmail) filter.sender_email = { $eq: opts.senderEmail };
  if (opts.dateFrom || opts.dateTo) {
    const range: Record<string, string> = {};
    if (opts.dateFrom) range.$gte = opts.dateFrom;
    if (opts.dateTo) range.$lte = opts.dateTo;
    filter.date = range;
  }

  return index.namespace(namespaceFor(opts.userId)).query({
    vector: opts.vector,
    topK: opts.topK,
    includeMetadata: true,
    filter: Object.keys(filter).length ? filter : undefined,
  });
}

export async function deleteByAccount(userId: string, accountId: string): Promise<void> {
  await index.namespace(namespaceFor(userId)).deleteMany({ account_id: { $eq: accountId } });
}

export async function deleteNamespace(userId: string): Promise<void> {
  await index.namespace(namespaceFor(userId)).deleteAll();
}
