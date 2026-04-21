export type Provider = "gmail" | "outlook" | "imap" | "yahoo";

export interface NormalizedEmail {
  messageId: string;
  threadId: string | null;
  senderEmail: string;
  senderName: string | null;
  recipients: string[];
  subject: string;
  bodyText: string; // plain text, HTML already stripped
  date: string; // ISO 8601
  labels: string[];
  hasAttachments: boolean;
}

export interface FetchOptions {
  since?: Date;
  limit?: number;
  pageToken?: string;
  // Opaque JSON-serializable state the provider persists across sync runs —
  // Gmail ignores it; the IMAP adapter uses it to track per-folder
  // UIDVALIDITY + lastUid so incremental syncs resume correctly after a
  // UIDVALIDITY rollover. Written back via FetchPage.providerState.
  providerState?: unknown;
  // The account's email address. Gmail ignores it (userinfo endpoint is
  // implicit in the OAuth token); the IMAP adapter needs it for XOAUTH2
  // SASL, which takes both the username and the access token.
  emailAddress?: string;
}

export interface FetchPage {
  emails: NormalizedEmail[];
  nextPageToken?: string;
  providerState?: unknown;
}

export interface EmailProvider {
  provider: Provider;
  fetchPage(accessToken: string, opts: FetchOptions): Promise<FetchPage>;
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }>;
}
