# sts-project-vector-email

Self-hosted RAG over your own email. Connect a Gmail account, sync it to a vector database, and ask grounded natural-language questions across your inbox — either through the HTTP API or directly from Claude Code via the bundled MCP server.

Full design rationale lives in [TECH-SPEC.md](./TECH-SPEC.md).

## Status

| Area | State |
|---|---|
| Gmail (OAuth + sync + search) | ✅ Working |
| Outlook / Microsoft Graph | 🚧 Stub (env wired, routes not implemented) |
| Generic IMAP | ❌ Not started |
| Attachment indexing (PDFs, etc.) | ❌ Not started — text-only today |
| GDPR erasure endpoint | 🚧 Helper exists, no route |
| Inbox cleanup (opt-in, off by default) | ✅ Working ([see below](#inbox-cleanup-opt-in)) |
| MCP server for Claude Code | ✅ Working ([mcp/](./mcp/)) |
| Test coverage | ⚠️ Pure-logic units only; no integration tests |

If you need anything in the ❌ / 🚧 column, see [CONTRIBUTING.md](./CONTRIBUTING.md) — those are the highest-leverage PRs.

## What you'll need before starting

- Node 20+ and Docker
- A Google Cloud project with the **Gmail API** enabled and an OAuth 2.0 Web client
- API keys for: **OpenAI** (embeddings), **Pinecone** (vector store, free tier works), **Anthropic** (grounded answers)

Roughly 15–20 minutes to provision the external accounts the first time.

## Quick start

```bash
# 1. Configure
cp .env.example .env
# Fill in the keys above. Generate TOKEN_ENCRYPTION_KEY with:
#   openssl rand -base64 32

# 2. Boot everything (postgres, redis, api, worker, scheduler)
docker compose up -d --build

# 3. Create your user and mint a JWT
docker compose run --rm api npm run create-user -- you@example.com
# → prints a JWT to stdout. Save it as EMAIL_API_TOKEN for the MCP step below.

# 4. Connect your Gmail account in a browser:
#    http://localhost:3000/api/oauth/google/start?token=<JWT>
#    Initial sync runs automatically and shows up in the worker logs.
```

To check sync progress:

```bash
curl -H "Authorization: Bearer $EMAIL_API_TOKEN" http://localhost:3000/api/accounts
```

To search:

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Authorization: Bearer $EMAIL_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "what did Sarah send about the budget?", "answer": true}'
```

## Local development (without Docker)

```bash
docker compose up -d postgres redis     # just the data stores
npm install
npm run db:migrate
npm run dev                              # terminal 1: api
npm run worker                           # terminal 2: bullmq worker
npm run scheduler                        # terminal 3: hourly poller
```

## Stack

- Node 20 + TypeScript + Express
- Postgres (accounts, sync state, dedup log)
- Redis + BullMQ (sync queue + scheduler)
- OpenAI `text-embedding-3-small` (1536-d vectors)
- Pinecone (one namespace per user)
- Anthropic Claude (grounded answers)
- Gmail API (provider adapter)

## Layout

```
src/
  config/        env + tunable constants
  db/            schema.sql + pg client
  auth/          JWT + AES-256-GCM token crypto
  providers/     gmail / outlook adapters, normalized email shape
  ingestion/     chunker, embedder, dedup, quota, sync orchestrator
  vector/        Pinecone upsert / query / delete
  query/         vector + lexical hybrid search, LLM grounding
  queue/         BullMQ queue, worker, hourly scheduler
  routes/        /api/oauth, /api/accounts, /api/search
  index.ts       Express entry
mcp/             Standalone MCP server for Claude Code
scripts/         Operational helpers (create-user, mint-token)
```

## Key tunables

| Setting | Default | Where |
|---|---|---|
| Per-user email cap | 50,000 | `EMAIL_LIMIT_PER_USER` in [src/config/constants.ts](src/config/constants.ts) |
| Excluded labels/folders | Spam, Promotions, Junk | `EXCLUDED_LABELS` / `EXCLUDED_OUTLOOK_FOLDERS` |
| Poll cadence | 60 min | `POLL_INTERVAL_MS` |
| Initial-sync batch | 100 | `INITIAL_SYNC_BATCH` |
| Default top-K | 10 | `DEFAULT_TOP_K` |

## Inbox cleanup (opt-in)

Off by default — if you only want search, you'll never see this feature.

To enable, set `ENABLE_INBOX_CLEANUP=true` in the server env, then connect Gmail with the `--cleanup` flag so the OAuth flow requests `gmail.modify` instead of the default read-only scope:

```bash
docker compose run --rm api npm run create-user -- you@example.com --cleanup
# → prints the Gmail connect URL with ?cleanup=true appended
```

Users who already connected without cleanup can re-run the start URL with `&cleanup=true` to upgrade the scope. Accounts that never granted `gmail.modify` get a 403 from the cleanup endpoints — belt-and-suspenders so a stale token can't be used destructively.

Preview before running (no writes, shows the translated Gmail query + a 20-message sample):

```bash
curl -X POST http://localhost:3000/api/cleanup/preview \
  -H "Authorization: Bearer $EMAIL_API_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "accountId": "<uuid>",
    "rules": {
      "labels": ["CATEGORY_PROMOTIONS"],
      "hasUnsubscribe": true,
      "olderThanDays": 30,
      "keep": { "senders": ["boss@company.com"] },
      "maxMessages": 200
    }
  }'
```

Then execute with `{"confirm": true}`:

```bash
curl -X POST http://localhost:3000/api/cleanup/run \
  -H "Authorization: Bearer $EMAIL_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"accountId": "<uuid>", "confirm": true, "rules": { /* same */ }}'
```

Messages go to **Trash** (reversible for ~30 days via Gmail), not permanently deleted. Starred and Important messages are excluded automatically. Rule schema is in [src/cleanup/rules.ts](src/cleanup/rules.ts).

## MCP server (Claude Code integration)

A standalone MCP server in [mcp/](mcp/) exposes three tools — `search_email`, `list_email_accounts`, `get_account_sync_status` — so Claude Code can query your inbox directly.

```bash
# 1. Build the MCP server
cd mcp && npm install && npm run build && cd ..

# 2. Mint a token (skip if you saved one from `create-user`)
npm run mint-token <your-user-uuid>

# 3. Register with Claude Code
claude mcp add sts-vector-email \
  --env EMAIL_API_URL=http://localhost:3000 \
  --env EMAIL_API_TOKEN=<paste-jwt> \
  -- node /absolute/path/to/sts-project-vector-email/mcp/dist/server.js
```

Restart your Claude session and the tools appear as `mcp__sts-vector-email__search_email` etc. The API server must be running for Claude to reach it.

## Quality gates

- **Biome** — lint + format + organize-imports. Config in [biome.json](biome.json).
- **Lefthook** — runs Biome + typecheck on commit, full check + tests on push. Installed automatically by `npm install` (via the `prepare` script). Config in [lefthook.yml](lefthook.yml).
- **Vitest** — unit tests in [tests/](tests/). Env is faked in [tests/setup.ts](tests/setup.ts) so the Zod env schema doesn't need real secrets.
- **GitHub Actions** — same checks run on every PR ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

| Command | What it does |
|---|---|
| `npm test` | Vitest once (CI + pre-push) |
| `npm run check` | Biome lint + format + organize-imports (no writes) |
| `npm run check:fix` | Same, but auto-fixes |
| `npm run typecheck` | `tsc --noEmit` |

Escape hatch: `LEFTHOOK=0 git commit ...` skips the hooks. Don't rely on this — CI runs the same checks.

## License

MIT — see [LICENSE](./LICENSE).

## Security

See [SECURITY.md](./SECURITY.md) for how to report vulnerabilities. **Do not** open public issues for security bugs.
