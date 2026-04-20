import { DEFAULT_TOP_K } from "../config/constants.js";
import { embed } from "../ingestion/embedder.js";
import { type EmailVectorMetadata, queryEmailVectors } from "../vector/pinecone.js";

export interface SearchRequest {
  userId: string;
  query: string;
  accountIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  topK?: number;
}

export interface SearchHit {
  score: number;
  metadata: EmailVectorMetadata;
}

// Quick-and-reliable hybrid fallback: detect exact-match targets (message-id, email addr)
// and route them through metadata filters rather than relying on cosine similarity.
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const MSGID_RE = /<[^>\s]+@[^>\s]+>/g;

export interface ExactMatchHints {
  messageIds: string[];
  addresses: string[];
}

export function parseExactMatchHints(query: string): ExactMatchHints {
  const messageIds = [...query.matchAll(MSGID_RE)].map((m) => m[0]);
  const stripped = query.replace(MSGID_RE, " ");
  const addresses = [...stripped.matchAll(EMAIL_RE)].map((m) => m[0]);
  return { messageIds, addresses };
}

export async function search(req: SearchRequest): Promise<SearchHit[]> {
  const { messageIds, addresses } = parseExactMatchHints(req.query);

  const vector = await embed(req.query);
  const results = await queryEmailVectors({
    userId: req.userId,
    vector,
    topK: req.topK ?? DEFAULT_TOP_K,
    accountIds: req.accountIds,
    dateFrom: req.dateFrom,
    dateTo: req.dateTo,
    messageIds: messageIds.length ? messageIds : undefined,
    senderEmail: addresses.length === 1 ? addresses[0] : undefined,
  });

  return (results.matches ?? []).map((m) => ({
    score: m.score ?? 0,
    metadata: m.metadata as unknown as EmailVectorMetadata,
  }));
}
