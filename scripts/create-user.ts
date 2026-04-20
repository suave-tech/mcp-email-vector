import { pool, query } from "../src/db/client.js";
import { sign } from "../src/auth/jwt.js";

const email = process.argv[2];
if (!email || !/.+@.+\..+/.test(email)) {
  console.error("usage: npm run create-user -- <email>");
  process.exit(1);
}

try {
  const existing = await query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  let userId = existing[0]?.id;
  if (userId) {
    console.error(`User already exists: ${email} (${userId})`);
  } else {
    const inserted = await query<{ id: string }>(
      "INSERT INTO users (email) VALUES ($1) RETURNING id",
      [email],
    );
    userId = inserted[0]!.id;
    console.error(`Created user: ${email} (${userId})`);
  }
  console.error("JWT (7-day expiry):");
  process.stdout.write(`${sign(userId)}\n`);
} finally {
  await pool.end();
}
