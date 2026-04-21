import { beforeEach, describe, expect, it, vi } from "vitest";

// Integration test for the IMAP adapter's fetchPage. We mock `imapflow`'s
// ImapFlow class entirely — nothing hits the network — and feed it scripted
// mailbox listings, UIDVALIDITY values, and message fetches. This is the
// contract test for the per-folder state machine: UID advancement, mid-page
// cursor resume, and stable folder ordering.

interface FakeMbxInfo {
  path: string;
  uidValidity: string;
  exists: number;
  messages: Array<{ uid: number; source: Buffer; internalDate?: Date }>;
  specialUse?: string | null;
}

let fakeMailboxes: FakeMbxInfo[] = [];
let currentMbx: FakeMbxInfo | undefined;

class FakeImapFlow {
  mailbox: { uidValidity: string; exists: number } | false = false;
  constructor(public opts: unknown) {}
  async connect(): Promise<void> {}
  async logout(): Promise<void> {}
  async list(): Promise<Array<{ path: string; specialUse: string | null; flags: Set<string> }>> {
    return fakeMailboxes.map((m) => ({
      path: m.path,
      specialUse: m.specialUse ?? null,
      flags: new Set<string>(),
    }));
  }
  async getMailboxLock(path: string): Promise<{ release: () => void }> {
    currentMbx = fakeMailboxes.find((m) => m.path === path);
    this.mailbox = currentMbx ? { uidValidity: currentMbx.uidValidity, exists: currentMbx.exists } : false;
    return { release: () => {} };
  }
  async *fetch(
    range: string,
    _fields: unknown,
    _opts: unknown,
  ): AsyncGenerator<{ uid: number; source: Buffer; internalDate?: Date }> {
    if (!currentMbx) return;
    // The adapter passes `${lastUid+1}:*`; parse the lower bound and filter.
    const low = Number.parseInt(range.split(":")[0] ?? "1", 10);
    for (const msg of currentMbx.messages) {
      if (msg.uid >= low) yield msg;
    }
  }
  async search(): Promise<number[]> {
    return [];
  }
  async messageMove(): Promise<void> {}
}

vi.mock("imapflow", () => ({ ImapFlow: FakeImapFlow }));

// Minimal RFC822 message factory. mailparser is real (small, fast, no network).
function rfc822(opts: {
  subject: string;
  from: string;
  to: string;
  messageId?: string;
  body?: string;
  date?: string;
}): Buffer {
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `Date: ${opts.date ?? "Thu, 18 Apr 2024 12:00:00 +0000"}`,
  ];
  if (opts.messageId) lines.push(`Message-ID: ${opts.messageId}`);
  lines.push("Content-Type: text/plain; charset=utf-8", "", opts.body ?? "hello world");
  return Buffer.from(lines.join("\r\n"));
}

const { makeImapProvider } = await import("../src/providers/imap.js");
const { YAHOO_PRESET } = await import("../src/providers/presets.js");

// Set env so oauthCredsFor doesn't throw if anything incidentally reaches it.
process.env.YAHOO_CLIENT_ID = "client-id";
process.env.YAHOO_CLIENT_SECRET = "client-secret";
process.env.YAHOO_REDIRECT_URI = "http://localhost:3000/api/oauth/yahoo/callback";

beforeEach(() => {
  fakeMailboxes = [];
  currentMbx = undefined;
});

describe("imap fetchPage", () => {
  it("walks folders in sorted order, normalizes messages, writes providerState", async () => {
    fakeMailboxes = [
      {
        path: "INBOX",
        uidValidity: "100",
        exists: 2,
        messages: [
          {
            uid: 10,
            source: rfc822({ subject: "hi", from: "a@y.com", to: "me@y.com", messageId: "<m10@y>" }),
          },
          {
            uid: 11,
            source: rfc822({ subject: "again", from: "a@y.com", to: "me@y.com", messageId: "<m11@y>" }),
          },
        ],
      },
      {
        path: "Sent",
        uidValidity: "200",
        exists: 1,
        messages: [
          {
            uid: 5,
            source: rfc822({ subject: "outgoing", from: "me@y.com", to: "b@y.com", messageId: "<s5@y>" }),
          },
        ],
      },
      // SPECIAL-USE Trash should be skipped by the adapter.
      { path: "Trash", uidValidity: "999", exists: 1, messages: [], specialUse: "\\Trash" },
    ];

    const provider = makeImapProvider(YAHOO_PRESET);
    const result = await provider.fetchPage("access-token", {
      emailAddress: "me@y.com",
      limit: 10,
    });

    expect(result.emails).toHaveLength(3);
    const subjects = result.emails.map((e) => e.subject);
    expect(subjects).toContain("hi");
    expect(subjects).toContain("again");
    expect(subjects).toContain("outgoing");
    // Folder becomes labels[0].
    expect(result.emails.find((e) => e.subject === "hi")?.labels).toEqual(["INBOX"]);
    expect(result.emails.find((e) => e.subject === "outgoing")?.labels).toEqual(["Sent"]);

    const state = result.providerState as {
      folders: Record<string, { uidValidity: string; lastUid: number }>;
    };
    expect(state.folders.INBOX).toEqual({ uidValidity: "100", lastUid: 11 });
    expect(state.folders.Sent).toEqual({ uidValidity: "200", lastUid: 5 });
    expect(state.folders.Trash).toBeUndefined();
    expect(result.nextPageToken).toBeUndefined();
  });

  it("resumes from stored state, only fetching UIDs > lastUid", async () => {
    fakeMailboxes = [
      {
        path: "INBOX",
        uidValidity: "100",
        exists: 3,
        messages: [
          { uid: 1, source: rfc822({ subject: "old", from: "a@y.com", to: "me@y.com", messageId: "<m1>" }) },
          { uid: 2, source: rfc822({ subject: "old2", from: "a@y.com", to: "me@y.com", messageId: "<m2>" }) },
          { uid: 3, source: rfc822({ subject: "new", from: "a@y.com", to: "me@y.com", messageId: "<m3>" }) },
        ],
      },
    ];

    const provider = makeImapProvider(YAHOO_PRESET);
    const result = await provider.fetchPage("access-token", {
      emailAddress: "me@y.com",
      limit: 10,
      providerState: { folders: { INBOX: { uidValidity: "100", lastUid: 2 } } },
    });

    // Only uid=3 should have been yielded; 1 and 2 are below the cursor.
    expect(result.emails.map((e) => e.subject)).toEqual(["new"]);
    const state = result.providerState as {
      folders: Record<string, { uidValidity: string; lastUid: number }>;
    };
    expect(state.folders.INBOX!.lastUid).toBe(3);
  });

  it("stops at limit mid-folder and sets a resume cursor", async () => {
    fakeMailboxes = [
      {
        path: "INBOX",
        uidValidity: "100",
        exists: 5,
        messages: Array.from({ length: 5 }, (_, i) => ({
          uid: i + 1,
          source: rfc822({
            subject: `msg ${i + 1}`,
            from: "a@y.com",
            to: "me@y.com",
            messageId: `<m${i + 1}>`,
          }),
        })),
      },
    ];

    const provider = makeImapProvider(YAHOO_PRESET);
    const result = await provider.fetchPage("access-token", {
      emailAddress: "me@y.com",
      limit: 2,
    });

    expect(result.emails).toHaveLength(2);
    expect(result.nextPageToken).toBe("resume");
    const state = result.providerState as {
      folders: Record<string, { lastUid: number }>;
      cursor?: { folder: string; nextUid: number };
    };
    expect(state.cursor).toEqual({ folder: "INBOX", nextUid: 3 });
    expect(state.folders.INBOX!.lastUid).toBe(2);
  });

  it("skips \\Noselect and SPECIAL-USE excluded folders", async () => {
    fakeMailboxes = [
      { path: "INBOX", uidValidity: "1", exists: 0, messages: [] },
      { path: "Trash", uidValidity: "2", exists: 0, messages: [], specialUse: "\\Trash" },
      { path: "Drafts", uidValidity: "3", exists: 0, messages: [], specialUse: "\\Drafts" },
      { path: "Junk", uidValidity: "4", exists: 0, messages: [], specialUse: "\\Junk" },
    ];

    const provider = makeImapProvider(YAHOO_PRESET);
    const result = await provider.fetchPage("access-token", {
      emailAddress: "me@y.com",
      limit: 10,
    });

    const state = result.providerState as { folders: Record<string, unknown> };
    expect(Object.keys(state.folders)).toEqual(["INBOX"]);
  });

  it("requires emailAddress (XOAUTH2 SASL needs the username)", async () => {
    const provider = makeImapProvider(YAHOO_PRESET);
    await expect(provider.fetchPage("access-token", { limit: 10 })).rejects.toThrow(
      "imap_email_address_required",
    );
  });

  it("synthesizes a Message-ID when the header is missing (for dedup)", async () => {
    fakeMailboxes = [
      {
        path: "INBOX",
        uidValidity: "7",
        exists: 1,
        messages: [
          // No Message-ID header — the adapter must fall back.
          { uid: 42, source: rfc822({ subject: "orphan", from: "x@y.com", to: "me@y.com" }) },
        ],
      },
    ];

    const provider = makeImapProvider(YAHOO_PRESET);
    const result = await provider.fetchPage("access-token", {
      emailAddress: "me@y.com",
      limit: 10,
    });

    expect(result.emails[0]!.messageId).toMatch(/^<7\.42@INBOX>$/);
  });
});
