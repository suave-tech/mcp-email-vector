import { google } from "googleapis";
import { htmlToText } from "html-to-text";
import { env } from "../config/env.js";
import { EXCLUDED_LABELS } from "../config/constants.js";
import type { EmailProvider, FetchOptions, FetchPage, NormalizedEmail } from "./types.js";

export const oauthClient = () =>
  new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);

export const GmailProvider: EmailProvider = {
  provider: "gmail",

  async fetchPage(accessToken, opts): Promise<FetchPage> {
    const auth = oauthClient();
    auth.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: "v1", auth });

    // Build query: exclude Spam/Promotions, optional time bound.
    const qParts = EXCLUDED_LABELS.map((l) => `-label:${labelToQuery(l)}`);
    if (opts.since) qParts.push(`after:${Math.floor(opts.since.getTime() / 1000)}`);
    const q = qParts.join(" ");

    const list = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults: opts.limit ?? 100,
      pageToken: opts.pageToken,
    });

    const ids = list.data.messages ?? [];
    const emails: NormalizedEmail[] = [];
    for (const { id } of ids) {
      if (!id) continue;
      const { data } = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const norm = normalize(data);
      if (norm) emails.push(norm);
    }

    return { emails, nextPageToken: list.data.nextPageToken ?? undefined };
  },

  async refreshAccessToken(refreshToken) {
    const auth = oauthClient();
    auth.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await auth.refreshAccessToken();
    return {
      accessToken: credentials.access_token!,
      expiresAt: new Date(credentials.expiry_date ?? Date.now() + 3600_000),
    };
  },
};

function labelToQuery(label: string): string {
  // Gmail queries lowercase category labels differently from SYSTEM labels.
  if (label.startsWith("CATEGORY_")) return `category:${label.slice("CATEGORY_".length).toLowerCase()}`;
  return label.toLowerCase();
}

function normalize(msg: Awaited<ReturnType<typeof google.gmail>>["users"]["messages"] extends unknown ? any : never): NormalizedEmail | null {
  const headers = new Map<string, string>();
  for (const h of msg.payload?.headers ?? []) if (h.name && h.value) headers.set(h.name.toLowerCase(), h.value);

  const messageId = headers.get("message-id") ?? msg.id;
  if (!messageId) return null;

  const labels: string[] = msg.labelIds ?? [];
  // Defensive second filter — list query should already exclude these.
  if (labels.some((l) => (EXCLUDED_LABELS as readonly string[]).includes(l))) return null;

  const { html, text } = extractBody(msg.payload);
  const bodyText = text ?? (html ? htmlToText(html, { wordwrap: false }) : "");

  const from = parseAddress(headers.get("from") ?? "");
  const to = (headers.get("to") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const date = headers.get("date");

  return {
    messageId,
    threadId: msg.threadId ?? null,
    senderEmail: from.email,
    senderName: from.name,
    recipients: to,
    subject: headers.get("subject") ?? "",
    bodyText,
    date: date ? new Date(date).toISOString() : new Date().toISOString(),
    labels,
    hasAttachments: hasAttachments(msg.payload),
  };
}

function extractBody(part: any): { html?: string; text?: string } {
  if (!part) return {};
  if (part.mimeType === "text/plain" && part.body?.data) {
    return { text: Buffer.from(part.body.data, "base64").toString("utf8") };
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return { html: Buffer.from(part.body.data, "base64").toString("utf8") };
  }
  const out: { html?: string; text?: string } = {};
  for (const p of part.parts ?? []) {
    const sub = extractBody(p);
    out.text ??= sub.text;
    out.html ??= sub.html;
  }
  return out;
}

function hasAttachments(part: any): boolean {
  if (!part) return false;
  if (part.filename && part.body?.attachmentId) return true;
  return (part.parts ?? []).some(hasAttachments);
}

function parseAddress(raw: string): { name: string | null; email: string } {
  const m = raw.match(/^(.*?)<(.+?)>\s*$/);
  if (m) return { name: m[1]!.trim().replace(/^"|"$/g, "") || null, email: m[2]!.trim() };
  return { name: null, email: raw.trim() };
}
