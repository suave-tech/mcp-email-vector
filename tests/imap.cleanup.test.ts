import { beforeEach, describe, expect, it, vi } from "vitest";

// Integration tests for the IMAP cleanup runner (previewCleanupImap,
// runCleanupImap) and the shared IMAP query plan builder.
//
// imapflow is mocked entirely — nothing hits the network. The FakeImapFlow
// has scriptable `search` return values and records every `messageMove` call
// so we can assert on exactly which UIDs were trashed in which folder.
//
// Scope-gate tests go through runner.ts, which also requires a db mock.

// ---------- db state (module-level so vi.mock factory can close over it) --

const accountsDb: Array<Record<string, unknown>> = [];

// ---------- shared state -----------------------------------------------

interface MailboxEntry {
  path: string;
  specialUse: string | null;
  flags: Set<string>;
}

interface FakeMessage {
  uid: number;
  envelope: {
    from: Array<{ name: string; address: string }>;
    subject: string;
    date: Date;
  };
}

let mailboxes: MailboxEntry[] = [];
let messagesByFolder: Record<string, FakeMessage[]> = {};
let searchResultsByFolder: Record<string, number[]> = {};
const messageMoveLog: Array<{ uids: string; dest: string }> = [];

let currentFolder = "";

// ---------- fake ImapFlow -----------------------------------------------

class FakeImapFlow {
  constructor(public opts: unknown) {}
  async connect(): Promise<void> {}
  async logout(): Promise<void> {}

  async list(): Promise<MailboxEntry[]> {
    return mailboxes;
  }

  async getMailboxLock(path: string): Promise<{ release: () => void }> {
    currentFolder = path;
    return { release: () => {} };
  }

  async search(_criteria: unknown, _opts: unknown): Promise<number[]> {
    return searchResultsByFolder[currentFolder] ?? [];
  }

  async *fetch(
    uidSet: string,
    _fields: unknown,
    _opts: unknown,
  ): AsyncGenerator<FakeMessage & { uid: number }> {
    const msgs = messagesByFolder[currentFolder] ?? [];
    // uidSet can be comma-joined UIDs or a range like "1:*". For tests
    // we only emit messages whose uid appears in the requested set.
    const wanted = new Set(uidSet.includes(":") ? msgs.map((m) => m.uid) : uidSet.split(",").map(Number));
    for (const msg of msgs) {
      if (wanted.has(msg.uid)) yield msg;
    }
  }

  async messageMove(uids: string, dest: string, _opts: unknown): Promise<void> {
    messageMoveLog.push({ uids, dest });
  }
}

vi.mock("imapflow", () => ({ ImapFlow: FakeImapFlow }));

process.env.YAHOO_CLIENT_ID = "x";
process.env.YAHOO_CLIENT_SECRET = "x";
process.env.YAHOO_REDIRECT_URI = "http://localhost:3000/api/oauth/yahoo/callback";

const { previewCleanupImap, runCleanupImap } = await import("../src/cleanup/imap-runner.js");
const { rulesToImapPlan, passesVetoes } = await import("../src/cleanup/imap-query.js");
const { CleanupRules } = await import("../src/cleanup/rules.js");

// ---------- helpers -------------------------------------------------------

function makeRules(
  overrides: Partial<{
    senders: string[];
    subjectMatches: string[];
    hasUnsubscribe: boolean;
    olderThanDays: number;
    maxMessages: number;
    keep: { senders: string[]; labels: string[]; subjectMatches: string[] };
  }> = {},
): ReturnType<typeof CleanupRules.parse> {
  return CleanupRules.parse(overrides);
}

function fakeMsg(uid: number, opts: { from?: string; subject?: string } = {}): FakeMessage {
  return {
    uid,
    envelope: {
      from: [{ name: "", address: opts.from ?? "sender@promo.com" }],
      subject: opts.subject ?? "Big Sale!",
      date: new Date("2024-01-01"),
    },
  };
}

const ctx = {
  provider: "yahoo" as const,
  emailAddress: "me@yahoo.com",
  accessToken: "token",
};

beforeEach(() => {
  mailboxes = [];
  messagesByFolder = {};
  searchResultsByFolder = {};
  messageMoveLog.length = 0;
  currentFolder = "";
});

// ==========================================================================
// imap-query unit tests
// ==========================================================================

describe("rulesToImapPlan", () => {
  it("produces an OR block for senders", () => {
    const plan = rulesToImapPlan(makeRules({ senders: ["a@b.com", "c@d.com"] }));
    expect(plan.search).toMatchObject({ or: expect.any(Array) });
  });

  it("sets before: date when olderThanDays provided", () => {
    const plan = rulesToImapPlan(makeRules({ olderThanDays: 30 }));
    expect(plan.search.before).toBeInstanceOf(Date);
  });

  it("sets header list-unsubscribe when hasUnsubscribe=true", () => {
    const plan = rulesToImapPlan(makeRules({ hasUnsubscribe: true }));
    expect(plan.search.header).toEqual({ "list-unsubscribe": "" });
  });

  it("always sets flagged=false", () => {
    const plan = rulesToImapPlan(makeRules());
    expect(plan.search.flagged).toBe(false);
  });
});

describe("passesVetoes", () => {
  it("rejects if sender is in vetoSenders", () => {
    const plan = rulesToImapPlan(
      makeRules({ keep: { senders: ["important@company.com"], labels: [], subjectMatches: [] } }),
    );
    expect(passesVetoes(plan, { from: "important@company.com", subject: "hi", folder: "INBOX" })).toBe(false);
  });

  it("rejects if subject matches vetoSubjectMatches", () => {
    const plan = rulesToImapPlan(
      makeRules({ keep: { senders: [], labels: [], subjectMatches: ["receipt"] } }),
    );
    expect(
      passesVetoes(plan, { from: "shop@store.com", subject: "Your receipt #123", folder: "INBOX" }),
    ).toBe(false);
  });

  it("rejects if folder is in vetoLabels", () => {
    const plan = rulesToImapPlan(makeRules({ keep: { senders: [], labels: ["INBOX"], subjectMatches: [] } }));
    expect(passesVetoes(plan, { from: "a@b.com", subject: "hi", folder: "INBOX" })).toBe(false);
  });

  it("accepts when no vetoes match", () => {
    const plan = rulesToImapPlan(makeRules());
    expect(passesVetoes(plan, { from: "promo@brand.com", subject: "Big Sale", folder: "INBOX" })).toBe(true);
  });
});

// ==========================================================================
// previewCleanupImap
// ==========================================================================

describe("previewCleanupImap", () => {
  it("reports match count across folders", async () => {
    mailboxes = [
      { path: "INBOX", specialUse: null, flags: new Set() },
      { path: "Sent", specialUse: null, flags: new Set() },
      { path: "Trash", specialUse: "\\Trash", flags: new Set() }, // excluded
    ];
    searchResultsByFolder = {
      INBOX: [1, 2, 3],
      Sent: [10],
    };
    messagesByFolder = {
      INBOX: [fakeMsg(1), fakeMsg(2), fakeMsg(3)],
      Sent: [fakeMsg(10)],
    };

    const rules = makeRules({ senders: ["sender@promo.com"] });
    const result = await previewCleanupImap(ctx, rules);

    // 3 from INBOX + 1 from Sent = 4 (Trash was excluded).
    expect(result.matched).toBe(4);
  });

  it("caps result at maxMessages", async () => {
    mailboxes = [{ path: "INBOX", specialUse: null, flags: new Set() }];
    searchResultsByFolder = { INBOX: [1, 2, 3, 4, 5] };
    messagesByFolder = { INBOX: Array.from({ length: 5 }, (_, i) => fakeMsg(i + 1)) };

    const rules = makeRules({ senders: ["sender@promo.com"], maxMessages: 3 });
    const result = await previewCleanupImap(ctx, rules);

    expect(result.matched).toBe(3);
    expect(result.cap).toBe(3);
  });

  it("returns sample candidates with from+subject populated", async () => {
    mailboxes = [{ path: "INBOX", specialUse: null, flags: new Set() }];
    searchResultsByFolder = { INBOX: [99] };
    messagesByFolder = {
      INBOX: [fakeMsg(99, { from: "news@example.com", subject: "Weekly digest" })],
    };

    const rules = makeRules({ senders: ["news@example.com"] });
    const result = await previewCleanupImap(ctx, rules);

    expect(result.sample).toHaveLength(1);
    expect(result.sample[0]!.from).toContain("news@example.com");
    expect(result.sample[0]!.subject).toBe("Weekly digest");
  });

  it("excludes SPECIAL-USE Trash and Drafts folders from counts", async () => {
    mailboxes = [
      { path: "INBOX", specialUse: null, flags: new Set() },
      { path: "Trash", specialUse: "\\Trash", flags: new Set() },
      { path: "Drafts", specialUse: "\\Drafts", flags: new Set() },
    ];
    searchResultsByFolder = {
      INBOX: [1],
      Trash: [2, 3, 4], // should be ignored
      Drafts: [5, 6], // should be ignored
    };
    messagesByFolder = {
      INBOX: [fakeMsg(1)],
    };

    const rules = makeRules({ senders: ["sender@promo.com"] });
    const result = await previewCleanupImap(ctx, rules);
    expect(result.matched).toBe(1);
  });
});

// ==========================================================================
// runCleanupImap
// ==========================================================================

describe("runCleanupImap", () => {
  it("moves matched UIDs to the Trash folder", async () => {
    mailboxes = [
      { path: "INBOX", specialUse: null, flags: new Set() },
      { path: "Trash", specialUse: "\\Trash", flags: new Set() },
    ];
    searchResultsByFolder = { INBOX: [1, 2] };
    messagesByFolder = { INBOX: [fakeMsg(1), fakeMsg(2)] };

    const rules = makeRules({ senders: ["sender@promo.com"] });
    const result = await runCleanupImap(ctx, rules);

    expect(result.trashed).toBe(2);
    expect(messageMoveLog).toHaveLength(1);
    expect(messageMoveLog[0]!.dest).toBe("Trash");
    expect(messageMoveLog[0]!.uids).toBe("1,2");
  });

  it("falls back to case-insensitive 'Trash' name when SPECIAL-USE absent", async () => {
    mailboxes = [
      { path: "INBOX", specialUse: null, flags: new Set() },
      // No specialUse — fallback discovery by name.
      { path: "trash", specialUse: null, flags: new Set() },
    ];
    searchResultsByFolder = { INBOX: [7] };
    messagesByFolder = { INBOX: [fakeMsg(7)] };

    const rules = makeRules({ senders: ["sender@promo.com"] });
    const result = await runCleanupImap(ctx, rules);

    expect(result.trashed).toBe(1);
    expect(messageMoveLog[0]!.dest).toBe("trash");
  });

  it("never moves messages from the Trash folder back into Trash", async () => {
    mailboxes = [
      { path: "INBOX", specialUse: null, flags: new Set() },
      { path: "Trash", specialUse: "\\Trash", flags: new Set() },
    ];
    // Even if search returns hits in Trash, runner should skip it.
    searchResultsByFolder = { INBOX: [], Trash: [55, 56] };
    messagesByFolder = { Trash: [fakeMsg(55), fakeMsg(56)] };

    const rules = makeRules({ senders: ["sender@promo.com"] });
    const result = await runCleanupImap(ctx, rules);

    expect(result.trashed).toBe(0);
    expect(messageMoveLog).toHaveLength(0);
  });

  it("respects maxMessages across folders", async () => {
    mailboxes = [
      { path: "INBOX", specialUse: null, flags: new Set() },
      { path: "Sent", specialUse: null, flags: new Set() },
      { path: "Trash", specialUse: "\\Trash", flags: new Set() },
    ];
    searchResultsByFolder = { INBOX: [1, 2, 3], Sent: [10, 11, 12] };
    messagesByFolder = {
      INBOX: [fakeMsg(1), fakeMsg(2), fakeMsg(3)],
      Sent: [fakeMsg(10), fakeMsg(11), fakeMsg(12)],
    };

    const rules = makeRules({ senders: ["sender@promo.com"], maxMessages: 4 });
    const result = await runCleanupImap(ctx, rules);

    expect(result.trashed).toBeLessThanOrEqual(4);
  });

  it("applies veto senders client-side (messages from keep.senders are skipped)", async () => {
    mailboxes = [
      { path: "INBOX", specialUse: null, flags: new Set() },
      { path: "Trash", specialUse: "\\Trash", flags: new Set() },
    ];
    searchResultsByFolder = { INBOX: [1, 2] };
    messagesByFolder = {
      INBOX: [fakeMsg(1, { from: "promo@brand.com" }), fakeMsg(2, { from: "keep@important.com" })],
    };

    const rules = makeRules({
      senders: ["promo@brand.com", "keep@important.com"],
      keep: { senders: ["keep@important.com"], labels: [], subjectMatches: [] },
    });
    const result = await runCleanupImap(ctx, rules);

    // Only uid=1 passes the veto; uid=2 is vetoed.
    expect(result.trashed).toBe(1);
    expect(messageMoveLog[0]!.uids).toBe("1");
  });

  it("throws CleanupError imap_trash_folder_not_found when no Trash exists", async () => {
    mailboxes = [{ path: "INBOX", specialUse: null, flags: new Set() }];
    searchResultsByFolder = { INBOX: [1] };
    messagesByFolder = { INBOX: [fakeMsg(1)] };

    const rules = makeRules({ senders: ["sender@promo.com"] });
    await expect(runCleanupImap(ctx, rules)).rejects.toThrow("imap_trash_folder_not_found");
  });
});

vi.mock("../src/db/client.js", () => ({
  query: async (sql: string, params?: unknown[]) => {
    const s = sql.trim();
    if (s.startsWith("SELECT id, user_id, provider")) {
      const [accountId, userId] = params as [string, string];
      return accountsDb.filter((a) => a.id === accountId && a.user_id === userId && a.is_active);
    }
    return [];
  },
  pool: { end: async () => {} },
}));

vi.mock("../src/auth/token.js", () => ({
  ensureFreshToken: async (acct: { access_token: string }) => acct.access_token,
}));

// ==========================================================================
// scope-gate (via runner.ts which does the provider dispatch + auth check)
// ==========================================================================

describe("scope gate via runner.ts", () => {
  // The db mock and auth mock are declared at module level (above) so the
  // vi.mock factory can close over `accountsDb` which is also module-level.

  beforeEach(() => {
    accountsDb.length = 0;
  });

  it("rejects Yahoo account without mail-w scope with 403", async () => {
    accountsDb.push({
      id: "acct-1",
      user_id: "user-1",
      provider: "yahoo",
      email_address: "me@yahoo.com",
      access_token: "token",
      refresh_token: "rtoken",
      token_expires_at: null,
      scopes_granted: ["openid", "mail-r"], // NO mail-w
      is_active: true,
    });

    const { previewCleanup } = await import("../src/cleanup/runner.js");
    const rules = makeRules({ senders: ["promo@brand.com"] });
    await expect(previewCleanup("user-1", "acct-1", rules)).rejects.toMatchObject({
      code: "cleanup_not_authorized",
      status: 403,
    });
  });

  it("accepts Yahoo account with mail-w scope", async () => {
    mailboxes = [
      { path: "INBOX", specialUse: null, flags: new Set() },
      { path: "Trash", specialUse: "\\Trash", flags: new Set() },
    ];
    searchResultsByFolder = { INBOX: [1] };
    messagesByFolder = { INBOX: [fakeMsg(1)] };

    accountsDb.push({
      id: "acct-2",
      user_id: "user-2",
      provider: "yahoo",
      email_address: "me@yahoo.com",
      access_token: "token",
      refresh_token: "rtoken",
      token_expires_at: null,
      scopes_granted: ["openid", "mail-r", "mail-w"],
      is_active: true,
    });

    const { previewCleanup } = await import("../src/cleanup/runner.js");
    const rules = makeRules({ senders: ["sender@promo.com"] });
    const result = await previewCleanup("user-2", "acct-2", rules);
    expect(result.matched).toBe(1);
  });
});
