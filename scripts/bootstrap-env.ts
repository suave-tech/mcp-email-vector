import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Generates secure defaults for JWT_SECRET and TOKEN_ENCRYPTION_KEY so a
// fresh clone never runs with replace-me placeholders. Idempotent — if .env
// already exists, we only fill in blank secret slots. Assumes invocation
// from the repo root (which `npm run bootstrap` guarantees).
const ROOT = process.cwd();
const EXAMPLE = resolve(ROOT, ".env.example");
const TARGET = resolve(ROOT, ".env");

if (!existsSync(EXAMPLE)) {
  console.error("error: .env.example not found — are you running from the repo root?");
  process.exit(1);
}

const force = process.argv.includes("--force");
const base = existsSync(TARGET) && !force ? readFileSync(TARGET, "utf8") : readFileSync(EXAMPLE, "utf8");

const patches: Array<[RegExp, string, string]> = [
  [/^JWT_SECRET=.*/m, `JWT_SECRET=${randomBytes(32).toString("hex")}`, "JWT_SECRET"],
  [
    /^TOKEN_ENCRYPTION_KEY=.*/m,
    `TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
    "TOKEN_ENCRYPTION_KEY",
  ],
];

let out = base;
const written: string[] = [];
for (const [pattern, replacement, name] of patches) {
  const current = out.match(pattern)?.[0] ?? "";
  const value = current.split("=")[1] ?? "";
  // Only overwrite when the slot is empty or holds the placeholder.
  if (value === "" || value === "replace-me") {
    out = out.replace(pattern, replacement);
    written.push(name);
  }
}

writeFileSync(TARGET, out);

if (written.length === 0) {
  console.error(
    ".env already has secrets — nothing to do. Pass --force to regenerate (invalidates existing tokens).",
  );
} else {
  console.error(`Wrote .env with fresh: ${written.join(", ")}`);
  console.error("");
  console.error("Next: fill in the provider keys (OPENAI_API_KEY, PINECONE_API_KEY,");
  console.error("ANTHROPIC_API_KEY, GOOGLE_CLIENT_ID/SECRET) and run `docker compose up -d --build`.");
}
