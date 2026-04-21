import { sign } from "../src/auth/jwt.js";
import { pool, query } from "../src/db/client.js";

export type OAuthProvider = "google" | "yahoo";

export interface CreateUserResult {
  userId: string;
  token: string;
  oauthUrl: string;
  created: boolean;
}

export async function createUser(
  email: string,
  opts: { cleanup?: boolean; apiUrl?: string; provider?: OAuthProvider } = {},
): Promise<CreateUserResult> {
  if (!/.+@.+\..+/.test(email)) throw new Error(`invalid email: ${email}`);
  const existing = await query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  let userId = existing[0]?.id;
  let created = false;
  if (!userId) {
    const inserted = await query<{ id: string }>("INSERT INTO users (email) VALUES ($1) RETURNING id", [
      email,
    ]);
    userId = inserted[0]!.id;
    created = true;
  }
  const token = sign(userId);
  const base = opts.apiUrl ?? process.env.API_URL ?? "http://localhost:3000";
  const provider: OAuthProvider = opts.provider ?? "google";
  const cleanupQs = opts.cleanup ? "&cleanup=true" : "";
  const oauthUrl = `${base}/api/oauth/${provider}/start?token=${token}${cleanupQs}`;
  return { userId, token, oauthUrl, created };
}

// CLI entrypoint — kept so `pnpm run create-user -- <email>` still works.
// The wizard imports createUser() directly instead of spawning tsx.
const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const args = process.argv.slice(2);
  const cleanup = args.includes("--cleanup");
  const yahoo = args.includes("--yahoo");
  const email = args.find((a) => !a.startsWith("--"));

  if (!email) {
    console.error("usage: pnpm run create-user -- <email> [--cleanup] [--yahoo]");
    process.exit(1);
  }

  try {
    const { userId, token, oauthUrl, created } = await createUser(email, {
      cleanup,
      provider: yahoo ? "yahoo" : "google",
    });
    console.error(
      created ? `Created user: ${email} (${userId})` : `User already exists: ${email} (${userId})`,
    );
    console.error("JWT (7-day expiry):");
    process.stdout.write(`${token}\n`);
    console.error("");
    console.error(`Connect ${yahoo ? "Yahoo Mail" : "Gmail"}:`);
    console.error(`  ${oauthUrl}`);
    if (cleanup) {
      console.error("  (requests write scope — required for /api/cleanup)");
      console.error("  (set ENABLE_INBOX_CLEANUP=true in the server env)");
    }
  } finally {
    await pool.end();
  }
}
