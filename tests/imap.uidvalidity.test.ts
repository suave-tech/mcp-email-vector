import { beforeEach, describe, expect, it, vi } from "vitest";

// UIDVALIDITY rollover — the IMAP spec says when UIDVALIDITY changes, every
// UID in the mailbox has been reassigned and clients must discard cached
// UID→message mappings. The adapter's correct behavior: re-scan the folder
// from UID 1, producing all messages again, and update the stored
// uidValidity. Dedup (on RFC822 Message-ID, not UID) prevents duplicate
// embeddings downstream. This test asserts the re-scan happens, not the
// dedup (that lives in sync.ts).

interface FakeMbxInfo {
  path: string;
  uidValidity: string;
  exists: number;
  messages: Array<{ uid: number; source: Buffer }>;
}

let fakeMailboxes: FakeMbxInfo[] = [];
let currentMbx: FakeMbxInfo | undefined;
let fetchCalls: string[] = [];

class FakeImapFlow {
  mailbox: { uidValidity: string; exists: number } | false = false;
  constructor(public opts: unknown) {}
  async connect(): Promise<void> {}
  async logout(): Promise<void> {}
  async list(): Promise<Array<{ path: string; specialUse: string | null; flags: Set<string> }>> {
    return fakeMailboxes.map((m) => ({ path: m.path, specialUse: null, flags: new Set<string>() }));
  }
  async getMailboxLock(path: string): Promise<{ release: () => void }> {
    currentMbx = fakeMailboxes.find((m) => m.path === path);
    this.mailbox = currentMbx ? { uidValidity: currentMbx.uidValidity, exists: currentMbx.exists } : false;
    return { release: () => {} };
  }
  async *fetch(range: string): AsyncGenerator<{ uid: number; source: Buffer }> {
    fetchCalls.push(range);
    if (!currentMbx) return;
    const low = Number.parseInt(range.split(":")[0] ?? "1", 10);
    for (const msg of currentMbx.messages) if (msg.uid >= low) yield msg;
  }
  async search(): Promise<number[]> {
    return [];
  }
  async messageMove(): Promise<void> {}
}

vi.mock("imapflow", () => ({ ImapFlow: FakeImapFlow }));

function rfc822(uid: number): Buffer {
  return Buffer.from(
    [
      "From: a@y.com",
      "To: me@y.com",
      `Subject: msg ${uid}`,
      "Date: Thu, 18 Apr 2024 12:00:00 +0000",
      `Message-ID: <m${uid}@y.com>`,
      "Content-Type: text/plain",
      "",
      `body ${uid}`,
    ].join("\r\n"),
  );
}

process.env.YAHOO_CLIENT_ID = "x";
process.env.YAHOO_CLIENT_SECRET = "x";
process.env.YAHOO_REDIRECT_URI = "http://localhost:3000/api/oauth/yahoo/callback";

const { makeImapProvider } = await import("../src/providers/imap.js");
const { YAHOO_PRESET } = await import("../src/providers/presets.js");

beforeEach(() => {
  fakeMailboxes = [];
  currentMbx = undefined;
  fetchCalls = [];
});

describe("imap UIDVALIDITY handling", () => {
  it("re-scans the folder when UIDVALIDITY changes, ignoring stored lastUid", async () => {
    fakeMailboxes = [
      {
        path: "INBOX",
        // Server reports 200, but prior state thought it was 100 → rollover.
        uidValidity: "200",
        exists: 3,
        messages: [
          { uid: 1, source: rfc822(1) },
          { uid: 2, source: rfc822(2) },
          { uid: 3, source: rfc822(3) },
        ],
      },
    ];

    const provider = makeImapProvider(YAHOO_PRESET);
    const result = await provider.fetchPage("access-token", {
      emailAddress: "me@y.com",
      limit: 10,
      providerState: {
        folders: { INBOX: { uidValidity: "100", lastUid: 999 } },
      },
    });

    // Fetch request must start at UID 1 (full rescan), not lastUid+1 = 1000.
    expect(fetchCalls).toContain("1:*");
    expect(fetchCalls).not.toContain("1000:*");

    expect(result.emails).toHaveLength(3);
    const state = result.providerState as {
      folders: Record<string, { uidValidity: string; lastUid: number }>;
    };
    expect(state.folders.INBOX).toEqual({ uidValidity: "200", lastUid: 3 });
  });

  it("does NOT re-scan when UIDVALIDITY matches — fetches from lastUid+1", async () => {
    fakeMailboxes = [
      {
        path: "INBOX",
        uidValidity: "500",
        exists: 2,
        messages: [{ uid: 51, source: rfc822(51) }],
      },
    ];

    const provider = makeImapProvider(YAHOO_PRESET);
    await provider.fetchPage("access-token", {
      emailAddress: "me@y.com",
      limit: 10,
      providerState: {
        folders: { INBOX: { uidValidity: "500", lastUid: 50 } },
      },
    });

    expect(fetchCalls).toContain("51:*");
  });
});
