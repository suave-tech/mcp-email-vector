import { sign } from "../src/auth/jwt.js";
import { pool, query } from "../src/db/client.js";

const args = process.argv.slice(2);
const cleanup = args.includes("--cleanup");
const email = args.find((a) => !a.startsWith("--"));

if (!email || !/.+@.+\..+/.test(email)) {
  console.error("usage: npm run create-user -- <email> [--cleanup]");
  process.exit(1);
}

try {
  const existing = await query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  let userId = existing[0]?.id;
  if (userId) {
    console.error(`User already exists: ${email} (${userId})`);
  } else {
    const inserted = await query<{ id: string }>("INSERT INTO users (email) VALUES ($1) RETURNING id", [
      email,
    ]);
    userId = inserted[0]!.id;
    console.error(`Created user: ${email} (${userId})`);
  }
  const token = sign(userId);
  console.error("JWT (7-day expiry):");
  process.stdout.write(`${token}\n`);

  const base = process.env.API_URL ?? "http://localhost:3000";
  const cleanupQs = cleanup ? "&cleanup=true" : "";
  console.error("");
  console.error("Connect Gmail:");
  console.error(`  ${base}/api/oauth/google/start?token=${token}${cleanupQs}`);
  if (cleanup) {
    console.error("  (requests gmail.modify — required for /api/cleanup)");
    console.error("  (set ENABLE_INBOX_CLEANUP=true in the server env)");
  }
} finally {
  await pool.end();
}
