import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";

// Single-command onboarding wizard. Composes the existing scripts
// (bootstrap-env, doctor, create-user, mint-token) so friends who clone
// this repo can get from zero → searching their Gmail from Claude without
// hand-editing .env or juggling terminals.
//
// Docker Desktop, Node 20+, and pnpm remain prerequisites — we check for
// them and bail with a link rather than trying to install them. Cloud
// account creation (Google/OpenAI/Pinecone/Anthropic) is still manual
// because none of them offer a bootstrap API, but the prompts below
// include the exact signup URL and clicks needed.

const ROOT = process.cwd();
const ENV_PATH = resolve(ROOT, ".env");
const ENV_EXAMPLE = resolve(ROOT, ".env.example");
const MCP_DIR = resolve(ROOT, "mcp");
const MCP_SERVER = resolve(MCP_DIR, "dist/server.js");

const rl = createInterface({ input: process.stdin, output: process.stdout });

function log(msg = ""): void {
  console.log(msg);
}
function step(n: number, title: string): void {
  console.log(`\n\x1b[1m[${n}/8] ${title}\x1b[0m`);
}
function ok(msg: string): void {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
}
function warn(msg: string): void {
  console.log(`  \x1b[33m!\x1b[0m ${msg}`);
}
function fail(msg: string): never {
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
  rl.close();
  process.exit(1);
}

async function prompt(question: string, opts: { default?: string; secret?: boolean } = {}): Promise<string> {
  const suffix = opts.default ? ` \x1b[2m[${opts.default}]\x1b[0m` : "";
  const answer = (await rl.question(`  ${question}${suffix}: `)).trim();
  return answer || opts.default || "";
}
async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const a = (await rl.question(`  ${question} ${hint}: `)).trim().toLowerCase();
  if (!a) return defaultYes;
  return a === "y" || a === "yes";
}

function run(cmd: string, args: string[], opts: { cwd?: string; quiet?: boolean } = {}): Promise<number> {
  return new Promise((res) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? ROOT,
      stdio: opts.quiet ? "ignore" : "inherit",
      env: process.env,
    });
    child.on("close", (code) => res(code ?? 1));
    child.on("error", () => res(1));
  });
}

async function which(cmd: string): Promise<boolean> {
  const code = await run(platform() === "win32" ? "where" : "which", [cmd], { quiet: true });
  return code === 0;
}

function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out.set(m[1]!, m[2]!);
  }
  return out;
}
function setEnvLine(text: string, key: string, value: string): string {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  return text.match(pattern) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
}
function readEnvFile(): { text: string; values: Map<string, string> } {
  const text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : readFileSync(ENV_EXAMPLE, "utf8");
  return { text, values: parseEnv(text) };
}

async function validateOpenAI(key: string): Promise<string | null> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (res.status === 401) return "key rejected (401)";
  if (!res.ok) return `HTTP ${res.status}`;
  return null;
}
async function validateAnthropic(key: string): Promise<string | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: "{}",
  });
  if (res.status === 401) return "key rejected (401)";
  if (res.status !== 400) return `unexpected HTTP ${res.status}`;
  return null;
}
async function validatePinecone(key: string, indexName: string): Promise<string | null> {
  try {
    const { Pinecone } = await import("@pinecone-database/pinecone");
    const pc = new Pinecone({ apiKey: key });
    const list = await pc.listIndexes();
    const names = (list.indexes ?? []).map((i) => i.name);
    if (!names.includes(indexName)) {
      return `index '${indexName}' not found — create it at https://app.pinecone.io (dimension 1536, metric cosine). Existing: ${names.join(", ") || "(none)"}`;
    }
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

async function askWithValidation(
  label: string,
  envKey: string,
  values: Map<string, string>,
  instructions: string[],
  validate?: (v: string) => Promise<string | null>,
): Promise<string> {
  const current = values.get(envKey) ?? "";
  if (current && current !== "replace-me") {
    ok(`${envKey} already set — skipping`);
    return current;
  }
  log("");
  log(`  \x1b[1m${label}\x1b[0m`);
  for (const line of instructions) log(`    ${line}`);
  while (true) {
    const v = await prompt(envKey, { secret: true });
    if (!v) {
      warn("empty value — try again");
      continue;
    }
    if (validate) {
      process.stdout.write("  validating… ");
      const err = await validate(v);
      if (err) {
        log(`\x1b[31mfailed\x1b[0m (${err})`);
        continue;
      }
      log("\x1b[32mok\x1b[0m");
    }
    return v;
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log("\x1b[1msts-project-vector-email — setup wizard\x1b[0m");
  log(
    "This takes ~15 minutes on first run. Press Ctrl-C any time; re-running picks up where you left off.\n",
  );

  // ---- Step 1: preflight ---------------------------------------------------
  step(1, "Checking prerequisites");
  for (const [cmd, url] of [
    ["docker", "https://www.docker.com/products/docker-desktop/"],
    ["node", "https://nodejs.org/"],
    ["pnpm", "https://pnpm.io/installation"],
  ] as const) {
    if (!(await which(cmd))) fail(`${cmd} not found on PATH — install from ${url} and re-run`);
    ok(`${cmd} found`);
  }

  // ---- Step 2: .env + secrets ---------------------------------------------
  step(2, "Preparing .env");
  if (!existsSync(ENV_PATH)) {
    if (!existsSync(ENV_EXAMPLE)) fail(".env.example missing — are you in the repo root?");
    writeFileSync(ENV_PATH, readFileSync(ENV_EXAMPLE, "utf8"));
    ok("copied .env.example → .env");
  } else {
    ok(".env already exists");
  }
  let { text: envText, values } = readEnvFile();
  for (const [key, gen] of [
    ["JWT_SECRET", () => randomBytes(32).toString("hex")],
    ["TOKEN_ENCRYPTION_KEY", () => randomBytes(32).toString("base64")],
  ] as const) {
    const cur = values.get(key) ?? "";
    if (!cur || cur === "replace-me") {
      envText = setEnvLine(envText, key, gen());
      ok(`generated ${key}`);
    } else {
      ok(`${key} already set`);
    }
  }
  writeFileSync(ENV_PATH, envText);
  values = parseEnv(envText);

  // ---- Step 3: Google Cloud checklist -------------------------------------
  step(3, "Google Cloud OAuth credentials");
  log("  If you haven't already, set up a Google OAuth client:");
  log("    1. console.cloud.google.com → new project");
  log("    2. APIs & Services → Library → enable \x1b[1mGmail API\x1b[0m");
  log("    3. OAuth consent screen → External → add your Gmail as a Test user");
  log("       Scopes: gmail.readonly, userinfo.email (+ gmail.modify if using cleanup)");
  log("    4. Credentials → Create → OAuth client ID → Web application");
  log("       Authorized redirect URI: \x1b[1mhttp://localhost:3000/api/oauth/google/callback\x1b[0m");
  log("");
  if (!(values.get("GOOGLE_CLIENT_ID") ?? "") || !(values.get("GOOGLE_CLIENT_SECRET") ?? "")) {
    await confirm("Done with the Google Cloud steps above?", true);
  }

  const googleId = await askWithValidation("Google OAuth client ID", "GOOGLE_CLIENT_ID", values, [
    "Find it in Google Cloud → Credentials → your OAuth 2.0 Client ID",
  ]);
  envText = setEnvLine(envText, "GOOGLE_CLIENT_ID", googleId);

  const googleSecret = await askWithValidation("Google OAuth client secret", "GOOGLE_CLIENT_SECRET", values, [
    "Same page as the client ID — labeled 'Client secret'",
  ]);
  envText = setEnvLine(envText, "GOOGLE_CLIENT_SECRET", googleSecret);

  // ---- Step 4: provider API keys ------------------------------------------
  step(4, "Provider API keys");

  const openai = await askWithValidation(
    "OpenAI API key (for embeddings)",
    "OPENAI_API_KEY",
    values,
    ["Create at https://platform.openai.com/api-keys", "Needs access to text-embedding-3-small"],
    validateOpenAI,
  );
  envText = setEnvLine(envText, "OPENAI_API_KEY", openai);

  const anthropic = await askWithValidation(
    "Anthropic API key (for grounded answers)",
    "ANTHROPIC_API_KEY",
    values,
    ["Create at https://console.anthropic.com/settings/keys"],
    validateAnthropic,
  );
  envText = setEnvLine(envText, "ANTHROPIC_API_KEY", anthropic);

  const pineconeIndex = values.get("PINECONE_INDEX") || "email-vectors";
  const pinecone = await askWithValidation(
    "Pinecone API key (vector store)",
    "PINECONE_API_KEY",
    values,
    [
      "Sign up at https://app.pinecone.io (free tier works)",
      `Create an index named \x1b[1m${pineconeIndex}\x1b[0m — dimension 1536, metric cosine`,
    ],
    (v) => validatePinecone(v, pineconeIndex),
  );
  envText = setEnvLine(envText, "PINECONE_API_KEY", pinecone);

  // ---- Step 5: user + cleanup choice --------------------------------------
  step(5, "Account details");
  const email = await prompt("The Gmail address you're going to connect");
  if (!/.+@.+\..+/.test(email)) fail(`"${email}" doesn't look like an email`);
  const enableCleanup = await confirm(
    "Enable inbox cleanup? (lets rules-based trashing of newsletters — off by default)",
    false,
  );
  envText = setEnvLine(envText, "ENABLE_INBOX_CLEANUP", enableCleanup ? "true" : "false");
  writeFileSync(ENV_PATH, envText);
  ok(".env written");

  // ---- Step 6: boot the stack ---------------------------------------------
  step(6, "Booting Docker stack (postgres, redis, migrate, api, worker, scheduler)");
  log("  This builds images on first run — can take 1–2 minutes.");
  const upCode = await run("docker", ["compose", "up", "-d", "--build"]);
  if (upCode !== 0) fail("docker compose up failed — see output above");

  process.stdout.write("  waiting for API health");
  const apiReady = await waitForHealth("http://localhost:3000/health", 60_000);
  log("");
  if (!apiReady) fail("API didn't come up within 60s — check `docker compose logs api`");
  ok("API is healthy");

  process.stdout.write("  running doctor checks");
  log("");
  const doctorCode = await run("pnpm", ["--silent", "run", "doctor"]);
  if (doctorCode !== 0) fail("doctor reported failures — fix the red items above and rerun `pnpm setup`");

  // ---- Step 7: create user + OAuth ----------------------------------------
  step(7, "Connecting Gmail");
  // Import lazily so earlier steps can run before the DB is up.
  const { createUser } = await import("./create-user.js");
  const { pool } = await import("../src/db/client.js");
  const { userId, token, oauthUrl } = await createUser(email, { cleanup: enableCleanup });
  ok(`user ${email} (${userId})`);

  log("");
  log("  Opening Google consent screen in your browser…");
  log(`  If it doesn't open, paste this URL: \x1b[36m${oauthUrl}\x1b[0m`);
  await openInBrowser(oauthUrl);

  process.stdout.write("  waiting for you to finish Google consent");
  const connected = await waitForAccount(token, 300_000);
  log("");
  if (!connected) {
    await pool.end();
    fail(
      "Didn't see a connected account within 5 minutes. Rerun `pnpm setup` once you've finished the consent screen — it'll pick up from here.",
    );
  }
  ok("Gmail connected — initial sync is running in the background");
  await pool.end();

  // ---- Step 8: MCP build + Claude registration ----------------------------
  step(8, "Building the MCP server for Claude Code");
  const needsBuild = !existsSync(MCP_SERVER);
  if (needsBuild) {
    const installCode = await run("pnpm", ["install"], { cwd: MCP_DIR });
    if (installCode !== 0) fail("pnpm install failed in mcp/");
    const buildCode = await run("pnpm", ["run", "build"], { cwd: MCP_DIR });
    if (buildCode !== 0) fail("pnpm run build failed in mcp/");
    ok("MCP server built");
  } else {
    ok("MCP server already built — skipping");
  }

  log("\n\x1b[1mAll set.\x1b[0m Register the MCP server with Claude Code:\n");
  const claudeCmd = `claude mcp add sts-vector-email \\
  --env EMAIL_API_URL=http://localhost:3000 \\
  --env EMAIL_API_TOKEN=${token} \\
  -- node ${MCP_SERVER}`;
  log(`\x1b[36m${claudeCmd}\x1b[0m\n`);

  if (await which("claude")) {
    if (await confirm("Run this now?", true)) {
      const code = await run("claude", [
        "mcp",
        "add",
        "sts-vector-email",
        "--env",
        "EMAIL_API_URL=http://localhost:3000",
        "--env",
        `EMAIL_API_TOKEN=${token}`,
        "--",
        "node",
        MCP_SERVER,
      ]);
      if (code === 0) ok("registered with Claude Code — restart your Claude session to pick it up");
      else warn("claude mcp add returned non-zero — you can run the command above manually");
    }
  } else {
    warn("`claude` CLI not found on PATH — run the command above from wherever you use Claude Code");
  }

  rl.close();
}

async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function waitForAccount(token: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("http://localhost:3000/api/accounts", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const body = (await res.json()) as { accounts: unknown[] };
        if (body.accounts && body.accounts.length > 0) return true;
      }
    } catch {}
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function openInBrowser(url: string): Promise<void> {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  const args = platform() === "win32" ? ["", url] : [url];
  await run(cmd, args, { quiet: true });
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});
