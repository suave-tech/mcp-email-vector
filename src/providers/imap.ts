import { Buffer } from "node:buffer";
import { htmlToText } from "html-to-text";
import { ImapFlow, type ListResponse } from "imapflow";
import { simpleParser } from "mailparser";
import { env } from "../config/env.js";
import { logger } from "../logger.js";
import type { ImapPreset } from "./presets.js";
import type { EmailProvider, FetchOptions, FetchPage, NormalizedEmail } from "./types.js";

// --- state shape persisted in accounts.provider_state -----------------------

interface FolderState {
  // UIDVALIDITY from the server; if it changes, every UID in this mailbox has
  // been reassigned and we must re-scan from 1. Dedup catches the duplicates.
  uidValidity: string;
  // Highest UID we've successfully fetched + handed to sync.ts. Next fetch
  // starts at lastUid + 1.
  lastUid: number;
}

export interface ImapProviderState {
  folders: Record<string, FolderState>;
  // Mid-page resume cursor: when fetchPage hits the batch limit mid-folder,
  // we stash where we were so the next call picks up without re-scanning.
  cursor?: { folder: string; nextUid: number };
}

function parseState(raw: unknown): ImapProviderState {
  if (!raw || typeof raw !== "object") return { folders: {} };
  const s = raw as Partial<ImapProviderState>;
  return {
    folders: s.folders ?? {},
    cursor: s.cursor,
  };
}

// --- helpers ---------------------------------------------------------------

function eligibleFolder(mbx: ListResponse, preset: ImapPreset): boolean {
  const sp = mbx.specialUse ?? "";
  if ((preset.excludedSpecialUse as readonly string[]).includes(sp)) return false;
  // Non-selectable containers (\Noselect) are directories, not mailboxes.
  if (mbx.flags?.has("\\Noselect")) return false;
  return true;
}

function bodyText(html: string | false | undefined, text: string | false | undefined): string {
  if (text) return text;
  if (html) return htmlToText(html, { wordwrap: false });
  return "";
}

// Yahoo's envelope.date comes through as a Date object from imapflow; the
// INTERNALDATE fallback handles the rare case where a message lacks a Date
// header entirely (which mailparser would return as undefined).
function pickDate(parsed: { date?: Date }, internalDate: Date | string | undefined): string {
  const raw = parsed.date ?? internalDate ?? new Date();
  return raw instanceof Date ? raw.toISOString() : new Date(raw).toISOString();
}

// --- adapter ---------------------------------------------------------------

export function makeImapProvider(preset: ImapPreset): EmailProvider {
  return {
    provider: preset.id === "yahoo" ? "yahoo" : "imap",

    async fetchPage(accessToken: string, opts: FetchOptions): Promise<FetchPage> {
      const state = parseState(opts.providerState);
      if (!opts.emailAddress) throw new Error("imap_email_address_required");
      const emailAddress = opts.emailAddress;
      const limit = opts.limit ?? 100;
      const emails: NormalizedEmail[] = [];

      const client = new ImapFlow({
        host: preset.host,
        port: preset.port,
        secure: preset.secure,
        auth: { user: emailAddress, accessToken },
        logger: false,
      });

      await client.connect();
      try {
        // Enumerate mailboxes once, filter, sort so pagination is deterministic.
        const listed = await client.list({ statusQuery: { uidValidity: true } });
        const all: ListResponse[] = listed
          .filter((m) => eligibleFolder(m, preset))
          .sort((a, b) => a.path.localeCompare(b.path));

        // Start from the mid-page cursor if present, else the first folder.
        const startIdx = state.cursor
          ? Math.max(
              0,
              all.findIndex((m) => m.path === state.cursor!.folder),
            )
          : 0;

        let nextCursor: ImapProviderState["cursor"] | undefined;

        for (let i = startIdx; i < all.length && emails.length < limit; i++) {
          const folder = all[i]!.path;
          const lock = await client.getMailboxLock(folder);
          try {
            // `mailbox` is only populated after lock acquisition.
            const mbxInfo = client.mailbox;
            if (typeof mbxInfo === "boolean") continue;
            const uidValidity = String(mbxInfo.uidValidity);
            const prior = state.folders[folder];

            // UIDVALIDITY rollover → server reassigned UIDs; restart folder.
            let lastUid = prior && prior.uidValidity === uidValidity ? prior.lastUid : 0;
            if (prior && prior.uidValidity !== uidValidity) {
              logger.warn(
                { folder, priorUidValidity: prior.uidValidity, newUidValidity: uidValidity },
                "imap uidvalidity rollover — re-scanning folder",
              );
              lastUid = 0;
            }
            // If we're resuming this folder mid-page, pick up where we left off.
            if (state.cursor && state.cursor.folder === folder) {
              lastUid = Math.max(lastUid, state.cursor.nextUid - 1);
            }

            if (mbxInfo.exists === 0) {
              state.folders[folder] = { uidValidity, lastUid };
              continue;
            }

            // Fetch only UIDs newer than lastUid. imapflow rejects `${n}:*`
            // when the mailbox is empty; the exists guard above handles that.
            const range = `${lastUid + 1}:*`;
            let highestUidThisPass = lastUid;

            for await (const msg of client.fetch(
              range,
              { uid: true, source: true, internalDate: true, flags: true },
              { uid: true },
            )) {
              if (!msg.source) continue;
              const internalDate =
                msg.internalDate instanceof Date
                  ? msg.internalDate
                  : msg.internalDate
                    ? new Date(msg.internalDate)
                    : undefined;
              if (opts.since && internalDate && internalDate < opts.since) {
                // Older than the sync boundary — still advance lastUid so we
                // don't re-see it, but don't hand it to the indexer.
                highestUidThisPass = Math.max(highestUidThisPass, msg.uid);
                continue;
              }

              const parsed = await simpleParser(msg.source as Buffer);
              const to = Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : [];
              const recipients = to
                .flatMap((a) => (a.value ?? []).map((v) => v.address ?? ""))
                .filter(Boolean);
              const fromValue = parsed.from?.value?.[0];
              const messageId =
                parsed.messageId ?? `<${uidValidity}.${msg.uid}@${folder.replace(/\s+/g, "_")}>`;

              emails.push({
                messageId,
                threadId: null, // IMAP doesn't expose a Gmail-style threadId universally.
                senderEmail: fromValue?.address ?? "",
                senderName: fromValue?.name?.trim() || null,
                recipients,
                subject: parsed.subject ?? "",
                bodyText: bodyText(parsed.html || undefined, parsed.text || undefined),
                date: pickDate(parsed, internalDate),
                labels: [folder],
                hasAttachments: (parsed.attachments?.length ?? 0) > 0,
              });

              highestUidThisPass = Math.max(highestUidThisPass, msg.uid);

              if (emails.length >= limit) {
                // Stash resume cursor so the next page starts at this UID+1.
                nextCursor = { folder, nextUid: msg.uid + 1 };
                break;
              }
            }

            state.folders[folder] = { uidValidity, lastUid: highestUidThisPass };
          } finally {
            lock.release();
          }

          if (nextCursor) break;
        }

        state.cursor = nextCursor;

        const hasMore = nextCursor !== undefined;
        return {
          emails,
          // We don't use pageToken as a separate channel — providerState already
          // carries everything needed to resume. But sync.ts loops on pageToken,
          // so set a sentinel when there's more work for this run.
          nextPageToken: hasMore ? "resume" : undefined,
          providerState: state,
        };
      } finally {
        await client.logout().catch(() => {
          // Best-effort; connection may already be closed.
        });
      }
    },

    async refreshAccessToken(refreshToken: string) {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
      const { clientId, clientSecret, redirectUri } = oauthCredsFor(preset);
      // Yahoo requires redirect_uri even on refresh.
      body.set("redirect_uri", redirectUri);

      const res = await fetch(preset.oauth.tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
        body: body.toString(),
      });
      if (!res.ok) {
        throw new Error(`${preset.id}_refresh_failed:${res.status}`);
      }
      const json = (await res.json()) as { access_token: string; expires_in: number };
      return {
        accessToken: json.access_token,
        expiresAt: new Date(Date.now() + json.expires_in * 1000),
      };
    },
  };
}

function oauthCredsFor(preset: ImapPreset): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  if (preset.id === "yahoo") {
    if (!env.YAHOO_CLIENT_ID || !env.YAHOO_CLIENT_SECRET || !env.YAHOO_REDIRECT_URI) {
      throw new Error("yahoo_oauth_not_configured");
    }
    return {
      clientId: env.YAHOO_CLIENT_ID,
      clientSecret: env.YAHOO_CLIENT_SECRET,
      redirectUri: env.YAHOO_REDIRECT_URI,
    };
  }
  throw new Error(`no_oauth_config_for_preset:${preset.id}`);
}
