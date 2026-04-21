import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pool, query } from "./client.js";

// Tiny forward-only migration runner. Each file in src/db/migrations/ is
// sorted lexicographically and applied inside a single transaction; success
// records the filename in _migrations so it's skipped next boot.
//
// Intentionally minimal. No down-migrations, no timestamps in file names —
// just numbered SQL files in lockstep with repo commits. If you need to
// roll something back, write a new forward migration that fixes the state.
//
// Path resolution: tsc emits CJS (package.json has no "type":"module"), so
// __dirname is available both under tsx (dev) and compiled node (Docker).
// In Docker the Dockerfile COPYs src/db/migrations → dist/db/migrations so
// this resolves correctly in both environments.
const MIGRATIONS_DIR = resolve(__dirname, "migrations");

async function ensureMetaTable(): Promise<void> {
  await query(`CREATE TABLE IF NOT EXISTS _migrations (
    name       TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}

async function appliedMigrations(): Promise<Set<string>> {
  const rows = await query<{ name: string }>("SELECT name FROM _migrations");
  return new Set(rows.map((r) => r.name));
}

async function applyMigration(name: string, sql: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  await ensureMetaTable();
  const applied = await appliedMigrations();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
    process.stdout.write(`applying ${file}… `);
    await applyMigration(file, sql);
    process.stdout.write("ok\n");
    ran++;
  }

  if (ran === 0) console.log("no pending migrations");
  else console.log(`${ran} migration(s) applied`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("migration failed:", err);
  await pool.end();
  process.exit(1);
});
