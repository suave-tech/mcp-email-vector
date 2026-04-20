# Project conventions for AI agents

Load-bearing context that isn't obvious from `ls`. Keep this file short — docs belong in [docs/](docs/), not here.

## Package manager: pnpm only

- `pnpm install`, `pnpm run …`, `pnpm exec …`. There is no `package-lock.json`; the lockfiles are `pnpm-lock.yaml` at the repo root and in [mcp/](mcp/).
- The Dockerfile uses `corepack enable` and `pnpm install --frozen-lockfile`. Don't reintroduce `npm ci`.
- If you see `npm run …` in any file, it's a leftover from the migration — fix it.

## Where commands run from

| Command | Working dir | Why |
|---|---|---|
| `pnpm setup` / `bootstrap` / `doctor` / `create-user` / `mint-token` | repo root | Scripts read `.env` via `dotenv` at cwd |
| `pnpm run dev` / `worker` / `scheduler` | repo root | Reads root `.env`, expects `DATABASE_URL` to point at `localhost:5432` |
| `pnpm install && pnpm run build` for the MCP server | [mcp/](mcp/) | Separate package; root tsconfig doesn't see it |
| `docker compose up -d --build` | repo root | Uses [Dockerfile](Dockerfile) + [.env](.env) |

## Two environments, two DATABASE_URLs

- `.env` has `DATABASE_URL=postgres://user:pass@localhost:5432/vector_email`. Used by host-side scripts (`pnpm run dev`, `pnpm run doctor`, wizard).
- [docker-compose.yml](docker-compose.yml) overrides it to `postgres://user:pass@postgres:5432/vector_email` for every container, so `api` / `worker` / `scheduler` can reach Postgres via the Docker network. Don't "fix" this divergence — it's intentional.
- Corollary: doctor/create-user/mint-token run from the host (they need tsx). The runtime Docker image strips dev deps, so `docker compose run --rm api pnpm run doctor` will NOT work — run these from the host instead.

## Single-command onboarding

`pnpm setup` ([scripts/setup.ts](scripts/setup.ts)) is the happy path for new users. It composes bootstrap-env → credential prompts (with live validation) → docker compose up → doctor → create-user → browser-open OAuth → poll for connection → build MCP → optional `claude mcp add`. It's idempotent; re-running skips already-configured steps. For power-user debugging, the individual scripts it calls are all still runnable directly.

## Quality gates

Biome + tsc + Vitest, orchestrated by Lefthook on commit/push and by [.github/workflows/ci.yml](.github/workflows/ci.yml) in CI. If you're editing TS, `pnpm run check` + `pnpm run typecheck` + `pnpm test` must all pass. Don't use `LEFTHOOK=0` or `--no-verify` to skip.

## Things not to touch without a reason

- **Per-user Pinecone namespace isolation** — enforced server-side from the JWT `sub`. Any path that lets a user influence the namespace is a security bug. See [docs/SECURITY.md](docs/SECURITY.md).
- **Raw email bodies are never persisted** in Postgres. Metadata + vectors only. A change that logs or stores raw bodies is a bug.
- **`gmail.modify` scope** is opt-in (requires `ENABLE_INBOX_CLEANUP=true` + `--cleanup` on create-user). Don't request it by default.

## Status of the adapter matrix

Gmail is fully wired. Outlook has env vars and a stub adapter but no OAuth routes ([src/routes/oauth.ts](src/routes/oauth.ts) has a `TODO: mirror for Microsoft`). IMAP is not started. Attachment extraction is not started (text-only today). Don't assume parity across providers — check first.
