export type Provider = "gmail" | "outlook" | "imap";

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
}

export interface FetchPage {
  emails: NormalizedEmail[];
  nextPageToken?: string;
}

export interface EmailProvider {
  provider: Provider;
  fetchPage(accessToken: string, opts: FetchOptions): Promise<FetchPage>;
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }>;
}
