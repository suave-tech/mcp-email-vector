import { htmlToText } from "html-to-text";
import { env } from "../config/env.js";
import { EXCLUDED_OUTLOOK_FOLDERS } from "../config/constants.js";
import type { EmailProvider, FetchOptions, FetchPage, NormalizedEmail } from "./types.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export const OutlookProvider: EmailProvider = {
  provider: "outlook",

  async fetchPage(accessToken, opts): Promise<FetchPage> {
    const params = new URLSearchParams({
      $top: String(opts.limit ?? 100),
      $select: "id,internetMessageId,conversationId,from,toRecipients,subject,body,receivedDateTime,hasAttachments,parentFolderId",
    });
    if (opts.since) params.set("$filter", `receivedDateTime ge ${opts.since.toISOString()}`);
    const url = opts.pageToken ?? `${GRAPH_BASE}/me/messages?${params}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`graph_fetch_failed:${res.status}`);
    const data = (await res.json()) as { value: any[]; "@odata.nextLink"?: string };

    const excluded = await excludedFolderIds(accessToken);
    const emails: NormalizedEmail[] = [];
    for (const m of data.value) {
      if (excluded.has(m.parentFolderId)) continue;
      emails.push(normalize(m));
    }
    return { emails, nextPageToken: data["@odata.nextLink"] };
  },

  async refreshAccessToken(refreshToken) {
    const body = new URLSearchParams({
      client_id: env.MS_CLIENT_ID,
      client_secret: env.MS_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "offline_access Mail.Read",
    });
    const res = await fetch(`https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error("ms_refresh_failed");
    const j = (await res.json()) as { access_token: string; expires_in: number };
    return { accessToken: j.access_token, expiresAt: new Date(Date.now() + j.expires_in * 1000) };
  },
};

async function excludedFolderIds(token: string): Promise<Set<string>> {
  const res = await fetch(`${GRAPH_BASE}/me/mailFolders?$select=id,displayName`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return new Set();
  const data = (await res.json()) as { value: { id: string; displayName: string }[] };
  return new Set(
    data.value
      .filter((f) => (EXCLUDED_OUTLOOK_FOLDERS as readonly string[]).includes(f.displayName))
      .map((f) => f.id),
  );
}

function normalize(m: any): NormalizedEmail {
  const html = m.body?.contentType === "html" ? m.body?.content : undefined;
  const text = m.body?.contentType === "text" ? m.body?.content : undefined;
  return {
    messageId: m.internetMessageId ?? m.id,
    threadId: m.conversationId ?? null,
    senderEmail: m.from?.emailAddress?.address ?? "",
    senderName: m.from?.emailAddress?.name ?? null,
    recipients: (m.toRecipients ?? []).map((r: any) => r.emailAddress?.address).filter(Boolean),
    subject: m.subject ?? "",
    bodyText: text ?? (html ? htmlToText(html, { wordwrap: false }) : ""),
    date: m.receivedDateTime,
    labels: [],
    hasAttachments: !!m.hasAttachments,
  };
}
