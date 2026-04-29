import { getConfig } from "./storage";

export interface SearchHitMetadata {
  subject: string;
  sender_email: string;
  sender_name?: string;
  date: string;
  message_id: string;
  provider: string;
  account_id: string;
  thread_id?: string;
  labels?: string[];
  has_attachments?: boolean;
  recipients?: string[];
}

export interface SearchHit {
  score: number;
  metadata: SearchHitMetadata;
}

export interface SearchResponse {
  hits: SearchHit[];
  answer?: string;
}

export interface WhoAmI {
  userId: string;
  email?: string;
}

export interface Account {
  id: string;
  provider: string;
  email_address: string;
  last_synced: string | null;
  initial_sync_complete: boolean;
  is_active: boolean;
}

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { apiUrl, token } = await getConfig();
  return fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
}

export async function search(
  query: string,
  opts: { accountIds?: string[]; dateFrom?: string; dateTo?: string; topK?: number } = {},
): Promise<SearchResponse> {
  const res = await authedFetch("/api/search", {
    method: "POST",
    body: JSON.stringify({
      query,
      account_ids: opts.accountIds,
      date_from: opts.dateFrom,
      date_to: opts.dateTo,
      top_k: opts.topK ?? 10,
      answer: true,
    }),
  });
  if (!res.ok) throw new Error(`search failed: ${res.status}`);
  return res.json() as Promise<SearchResponse>;
}

export async function whoAmI(apiUrl: string, token: string): Promise<WhoAmI> {
  const res = await fetch(`${apiUrl}/api/whoami`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<WhoAmI>;
}

export async function listAccounts(): Promise<Account[]> {
  const res = await authedFetch("/api/accounts");
  if (!res.ok) throw new Error(`accounts failed: ${res.status}`);
  const data = (await res.json()) as { accounts: Account[] };
  return data.accounts;
}
