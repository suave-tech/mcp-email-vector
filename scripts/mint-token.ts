import { sign } from "../src/auth/jwt.js";

const userId = process.argv[2];
if (!userId) {
  console.error("usage: tsx scripts/mint-token.ts <user_id>");
  process.exit(1);
}
process.stdout.write(`${sign(userId)}\n`);
