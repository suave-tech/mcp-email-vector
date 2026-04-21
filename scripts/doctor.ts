import { env } from "../src/config/env.js";
import { pool, query } from "../src/db/client.js";

// Validates that the local config can actually reach every external dep.
// Exits non-zero on the first failure so CI / a new user can block on it.
interface Check {
  name: string;
  run: () => Promise<string>;
}

const checks: Check[] = [
  {
    name: "env: TOKEN_ENCRYPTION_KEY is 32 bytes",
    run: async () => {
      const buf = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64");
      if (buf.length !== 32) throw new Error(`expected 32 bytes, got ${buf.length}`);
      return "ok";
    },
  },
  {
    name: "env: JWT_SECRET is not the placeholder",
    run: async () => {
      if (env.JWT_SECRET === "replace-me") throw new Error("JWT_SECRET is still 'replace-me'");
      return "ok";
    },
  },
  {
    name: "postgres: can connect + schema applied",
    run: async () => {
      const rows = await query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      const names = new Set(rows.map((r) => r.table_name));
      for (const t of ["users", "accounts", "sync_jobs", "sync_log", "user_quota"]) {
        if (!names.has(t)) throw new Error(`missing table '${t}' — run pnpm run db:migrate`);
      }
      return `${names.size} tables`;
    },
  },
  {
    name: "redis: can PING",
    run: async () => {
      const { default: Redis } = await import("ioredis");
      const r = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
      try {
        await r.connect();
        const reply = await r.ping();
        if (reply !== "PONG") throw new Error(`unexpected reply: ${reply}`);
        return "PONG";
      } finally {
        r.disconnect();
      }
    },
  },
  {
    name: "openai: embeddings endpoint auth",
    run: async () => {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      });
      if (res.status === 401) throw new Error("OPENAI_API_KEY rejected (401)");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return "authorized";
    },
  },
  {
    name: "anthropic: messages endpoint auth",
    run: async () => {
      // Cheapest possible probe — deliberately malformed body yields 400 if
      // the key is good, 401 if not. Avoids burning tokens on a real call.
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: "{}",
      });
      if (res.status === 401) throw new Error("ANTHROPIC_API_KEY rejected (401)");
      if (res.status !== 400) throw new Error(`unexpected HTTP ${res.status}`);
      return "authorized";
    },
  },
  {
    name: "pinecone: index exists",
    run: async () => {
      const { Pinecone } = await import("@pinecone-database/pinecone");
      const pc = new Pinecone({ apiKey: env.PINECONE_API_KEY });
      const list = await pc.listIndexes();
      const names = (list.indexes ?? []).map((i) => i.name);
      if (!names.includes(env.PINECONE_INDEX)) {
        throw new Error(`index '${env.PINECONE_INDEX}' not found. Existing: ${names.join(", ") || "(none)"}`);
      }
      return "found";
    },
  },
  {
    // Setup flow only asks for the chosen provider's creds, so require that
    // at least one OAuth provider is configured rather than failing Yahoo-only
    // users on missing Google creds (or vice versa).
    name: "oauth: at least one provider configured",
    run: async () => {
      const google = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
      const yahoo = Boolean(env.YAHOO_CLIENT_ID && env.YAHOO_CLIENT_SECRET && env.YAHOO_REDIRECT_URI);
      if (!google && !yahoo) {
        throw new Error(
          "no provider configured — set GOOGLE_CLIENT_ID/SECRET or YAHOO_CLIENT_ID/SECRET/REDIRECT_URI",
        );
      }
      const configured = [google && "google", yahoo && "yahoo"].filter(Boolean).join(", ");
      return `${configured} (actual OAuth tested via browser flow)`;
    },
  },
  {
    name: "cleanup: feature flag state",
    run: async () =>
      env.ENABLE_INBOX_CLEANUP ? "enabled — users can opt in with --cleanup" : "disabled (default)",
  },
];

let failed = 0;
for (const check of checks) {
  try {
    const detail = await check.run();
    console.log(`  ok   ${check.name} — ${detail}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  FAIL ${check.name} — ${msg}`);
  }
}

await pool.end();

console.log("");
if (failed > 0) {
  console.log(`${failed} check(s) failed.`);
  process.exit(1);
}
console.log("All checks passed. Ready to connect an account.");
