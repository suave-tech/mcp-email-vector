import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for the cleanup toggle routes:
//   GET  /api/accounts/:id/cleanup/upgrade  → {redirectUrl} for OAuth re-consent
//   DELETE /api/accounts/:id/cleanup        → strips write scope from DB

// Mutable env so individual tests can flip ENABLE_INBOX_CLEANUP.
const mockEnv = vi.hoisted(() => ({
  ENABLE_INBOX_CLEANUP: true,
  YAHOO_CLIENT_ID: "yahoo-id",
  YAHOO_CLIENT_SECRET: "yahoo-secret",
  YAHOO_REDIRECT_URI: "http://localhost:3000/api/oauth/yahoo/callback",
  JWT_SECRET: "test-jwt-secret-value-0123456789",
  TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  GOOGLE_CLIENT_ID: "google-test",
  GOOGLE_CLIENT_SECRET: "google-secret",
  GOOGLE_REDIRECT_URI: "http://localhost:3000/api/oauth/google/callback",
}));

vi.mock("../src/config/env.js", () => ({ env: mockEnv }));

const dbRows: Record<string, unknown[]> = {};
const dbUpdates: unknown[][] = [];

vi.mock("../src/db/client.js", () => ({
  query: async (sql: string, params?: unknown[]) => {
    if (sql.includes("SELECT provider FROM accounts")) {
      return dbRows[params?.[0] as string] ?? [];
    }
    if (sql.includes("array_remove")) {
      dbUpdates.push(params ?? []);
      return [];
    }
    if (sql.includes("INSERT INTO accounts") || sql.includes("SELECT") || sql.includes("SELECT id")) {
      return [{ id: "acct-db" }];
    }
    return [];
  },
  pool: { end: async () => {} },
}));

vi.mock("../src/queue/queue.js", () => ({
  syncQueue: { add: async () => ({ id: "job-1" }) },
}));

vi.mock("../src/vector/pinecone.js", () => ({
  deleteByAccount: async () => {},
}));

vi.mock("../src/providers/gmail.js", () => ({
  oauthClient: () => ({
    generateAuthUrl: (_opts: unknown) => "https://accounts.google.com/o/oauth2/auth?fake=1",
    getToken: async () => ({
      tokens: { access_token: "at", refresh_token: "rt", expiry_date: Date.now() + 3600_000 },
    }),
    setCredentials: () => {},
    request: async () => ({ data: { email: "alice@example.com" } }),
  }),
}));

const { accountsRouter } = await import("../src/routes/accounts.js");
const { sign } = await import("../src/auth/jwt.js");

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/accounts", accountsRouter);
  return app;
}

async function startApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = makeApp();
  const server = app.listen(0);
  await new Promise<void>((r) => server.on("listening", () => r()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

function authHeader(userId = "user-1"): { Authorization: string } {
  return { Authorization: `Bearer ${sign(userId)}` };
}

beforeEach(() => {
  Object.keys(dbRows).forEach((k) => delete dbRows[k]);
  dbUpdates.length = 0;
  mockEnv.ENABLE_INBOX_CLEANUP = true;
});

describe("GET /api/accounts/:accountId/cleanup/upgrade", () => {
  it("returns a Google redirectUrl when provider is gmail", async () => {
    dbRows["acct-gmail"] = [{ provider: "gmail" }];
    const { url, close } = await startApp();
    try {
      const res = await fetch(`${url}/api/accounts/acct-gmail/cleanup/upgrade`, {
        headers: authHeader(),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { redirectUrl: string };
      expect(body.redirectUrl).toMatch(/accounts\.google\.com/);
    } finally {
      await close();
    }
  });

  it("returns a Yahoo redirectUrl when provider is yahoo", async () => {
    dbRows["acct-yahoo"] = [{ provider: "yahoo" }];
    const { url, close } = await startApp();
    try {
      const res = await fetch(`${url}/api/accounts/acct-yahoo/cleanup/upgrade`, {
        headers: authHeader(),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { redirectUrl: string };
      expect(body.redirectUrl).toMatch(/login\.yahoo\.com/);
    } finally {
      await close();
    }
  });

  it("403s when ENABLE_INBOX_CLEANUP is false", async () => {
    mockEnv.ENABLE_INBOX_CLEANUP = false;
    dbRows["acct-gmail"] = [{ provider: "gmail" }];
    const { url, close } = await startApp();
    try {
      const res = await fetch(`${url}/api/accounts/acct-gmail/cleanup/upgrade`, {
        headers: authHeader(),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("cleanup_disabled_by_deployment");
    } finally {
      await close();
    }
  });

  it("404s for an unknown account or wrong user", async () => {
    const { url, close } = await startApp();
    try {
      const res = await fetch(`${url}/api/accounts/no-such-account/cleanup/upgrade`, {
        headers: authHeader(),
      });
      expect(res.status).toBe(404);
    } finally {
      await close();
    }
  });

  it("400s for a provider that does not support cleanup upgrade", async () => {
    dbRows["acct-imap"] = [{ provider: "imap" }];
    const { url, close } = await startApp();
    try {
      const res = await fetch(`${url}/api/accounts/acct-imap/cleanup/upgrade`, {
        headers: authHeader(),
      });
      expect(res.status).toBe(400);
    } finally {
      await close();
    }
  });

  it("401s without a token", async () => {
    const { url, close } = await startApp();
    try {
      const res = await fetch(`${url}/api/accounts/acct-gmail/cleanup/upgrade`);
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });
});

describe("DELETE /api/accounts/:accountId/cleanup", () => {
  it("strips the Gmail modify scope and returns cleanupEnabled: false", async () => {
    dbRows["acct-gmail"] = [{ provider: "gmail" }];
    const { url, close } = await startApp();
    try {
      const res = await fetch(`${url}/api/accounts/acct-gmail/cleanup`, {
        method: "DELETE",
        headers: authHeader(),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { cleanupEnabled: boolean };
      expect(body.cleanupEnabled).toBe(false);

      expect(dbUpdates).toHaveLength(1);
      expect(dbUpdates[0]![0]).toBe("https://www.googleapis.com/auth/gmail.modify");
      expect(dbUpdates[0]![1]).toBe("acct-gmail");
    } finally {
      await close();
    }
  });

  it("strips the Yahoo write scope for yahoo accounts", async () => {
    dbRows["acct-yahoo"] = [{ provider: "yahoo" }];
    const { url, close } = await startApp();
    try {
      const res = await fetch(`${url}/api/accounts/acct-yahoo/cleanup`, {
        method: "DELETE",
        headers: authHeader(),
      });
      expect(res.status).toBe(200);
      expect(dbUpdates[0]![0]).toBe("mail-w");
    } finally {
      await close();
    }
  });

  it("404s for an unknown account or wrong user", async () => {
    const { url, close } = await startApp();
    try {
      const res = await fetch(`${url}/api/accounts/no-such/cleanup`, {
        method: "DELETE",
        headers: authHeader(),
      });
      expect(res.status).toBe(404);
      expect(dbUpdates).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it("401s without a token", async () => {
    const { url, close } = await startApp();
    try {
      const res = await fetch(`${url}/api/accounts/acct-gmail/cleanup`, { method: "DELETE" });
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });
});
