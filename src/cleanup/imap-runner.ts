import { ImapFlow, type ListResponse } from "imapflow";
import { logger } from "../logger.js";
import type { CleanupCandidate } from "../providers/gmail.js";
import { YAHOO_PRESET } from "../providers/presets.js";
import type { ImapPreset } from "../providers/presets.js";
import { passesVetoes, rulesToImapPlan } from "./imap-query.js";
import type { CleanupRules } from "./rules.js";
import { CleanupError } from "./runner.js";
import type { PreviewResult, RunResult } from "./runner.js";

// IMAP cleanup. Mirrors the Gmail runner shape:
//   - previewCleanupImap returns a matched count + first-N sample
//   - runCleanupImap moves messages to the account's Trash folder
//
// "Trash, not purge" is intentional — same safety posture as Gmail. We use
// `UID MOVE` (RFC 6851), which Yahoo supports. Users restore from the web UI.

const PREVIEW_SAMPLE_SIZE = 20;

interface ImapAccountCtx {
  emailAddress: string;
  accessToken: string;
  preset: ImapPreset;
}

function presetFor(provider: string): ImapPreset {
  if (provider === "yahoo") return YAHOO_PRESET;
  throw new CleanupError("imap_preset_unknown", 400);
}

export async function previewCleanupImap(
  ctx: { provider: string; emailAddress: string; accessToken: string },
  rules: CleanupRules,
): Promise<PreviewResult> {
  const preset = presetFor(ctx.provider);
  const plan = rulesToImapPlan(rules);
  const client = await connect({ ...ctx, preset });

  try {
    const folders = await eligibleFolders(client, preset);
    const matches: Array<{ folder: string; uid: number }> = [];
    const sample: CleanupCandidate[] = [];

    for (const folder of folders) {
      if (plan.vetoLabels.includes(folder)) continue;
      const lock = await client.getMailboxLock(folder);
      try {
        const uids = (await client.search(plan.search, { uid: true })) || [];
        if (uids.length === 0) continue;

        // Collect previews for the first few hits in the first folder that
        // produces hits. Enough to render a sample; no need for a global K.
        if (sample.length < PREVIEW_SAMPLE_SIZE) {
          const want = Math.min(PREVIEW_SAMPLE_SIZE - sample.length, uids.length);
          const previewUids = uids.slice(0, want);
          for await (const msg of client.fetch(
            previewUids.join(","),
            { uid: true, envelope: true },
            { uid: true },
          )) {
            const envelope = msg.envelope;
            if (!envelope) continue;
            const from = envelope.from?.[0];
            const candidate: CleanupCandidate = {
              id: `${folder}:${msg.uid}`,
              from: from ? `${from.name ?? ""} <${from.address ?? ""}>`.trim() : "",
              subject: envelope.subject ?? "",
              date: envelope.date ? new Date(envelope.date).toISOString() : "",
            };
            // Apply client-side vetoes now so the preview count is honest.
            if (!passesVetoes(plan, { from: candidate.from, subject: candidate.subject, folder })) {
              continue;
            }
            sample.push(candidate);
          }
        }

        for (const uid of uids) matches.push({ folder, uid });
        if (matches.length >= rules.maxMessages) break;
      } finally {
        lock.release();
      }
    }

    return {
      query: describeImapPlan(plan, folders),
      matched: Math.min(matches.length, rules.maxMessages),
      cap: rules.maxMessages,
      sample,
    };
  } finally {
    await client.logout().catch(() => {});
  }
}

export async function runCleanupImap(
  ctx: { provider: string; emailAddress: string; accessToken: string },
  rules: CleanupRules,
): Promise<RunResult> {
  const preset = presetFor(ctx.provider);
  const plan = rulesToImapPlan(rules);
  const client = await connect({ ...ctx, preset });

  try {
    const folders = await eligibleFolders(client, preset);
    const trash = await discoverTrash(client);
    if (!trash) throw new CleanupError("imap_trash_folder_not_found", 500);

    let moved = 0;
    for (const folder of folders) {
      if (plan.vetoLabels.includes(folder)) continue;
      if (folder === trash) continue; // never move from Trash back into Trash
      const lock = await client.getMailboxLock(folder);
      try {
        const uids = (await client.search(plan.search, { uid: true })) || [];
        if (uids.length === 0) continue;
        // Client-side vetoes: need envelopes to apply them.
        const toMove: number[] = [];
        for await (const msg of client.fetch(uids.join(","), { uid: true, envelope: true }, { uid: true })) {
          const envelope = msg.envelope;
          const from = envelope?.from?.[0];
          const fromStr = from ? `${from.name ?? ""} <${from.address ?? ""}>` : "";
          const subject = envelope?.subject ?? "";
          if (passesVetoes(plan, { from: fromStr, subject, folder })) {
            toMove.push(msg.uid);
            if (moved + toMove.length >= rules.maxMessages) break;
          }
        }
        if (toMove.length === 0) continue;
        await client.messageMove(toMove.join(","), trash, { uid: true });
        moved += toMove.length;
        logger.info({ folder, count: toMove.length, trash }, "imap cleanup moved batch");
        if (moved >= rules.maxMessages) break;
      } finally {
        lock.release();
      }
    }

    return { query: describeImapPlan(plan, folders), trashed: moved };
  } finally {
    await client.logout().catch(() => {});
  }
}

// --- internals -------------------------------------------------------------

async function connect(opts: ImapAccountCtx): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: opts.preset.host,
    port: opts.preset.port,
    secure: opts.preset.secure,
    auth: { user: opts.emailAddress, accessToken: opts.accessToken },
    logger: false,
  });
  await client.connect();
  return client;
}

async function eligibleFolders(client: ImapFlow, preset: ImapPreset): Promise<string[]> {
  const listed = await client.list();
  return listed
    .filter((m) => {
      const sp = m.specialUse ?? "";
      if ((preset.excludedSpecialUse as readonly string[]).includes(sp)) return false;
      if (m.flags?.has("\\Noselect")) return false;
      return true;
    })
    .map((m) => m.path)
    .sort();
}

async function discoverTrash(client: ImapFlow): Promise<string | null> {
  const listed = await client.list();
  const bySpecial = listed.find((m: ListResponse) => m.specialUse === "\\Trash");
  if (bySpecial) return bySpecial.path;
  // Fallback for servers that don't expose SPECIAL-USE cleanly.
  const byName = listed.find((m: ListResponse) => /^trash$/i.test(m.path));
  return byName?.path ?? null;
}

function describeImapPlan(plan: { search: unknown }, folders: string[]): string {
  return `imap-search across ${folders.length} folder(s): ${JSON.stringify(plan.search)}`;
}
