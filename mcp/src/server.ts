#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = (process.env.EMAIL_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const API_TOKEN = process.env.EMAIL_API_TOKEN;

if (!API_TOKEN) {
  console.error("EMAIL_API_TOKEN is required (JWT signed by the API's JWT_SECRET).");
  process.exit(1);
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

const server = new McpServer({ name: "sts-vector-email", version: "0.1.0" });

server.tool(
  "search_email",
  "Semantic + hybrid search over the user's connected email accounts. Returns top-K matching emails with metadata; optionally returns a grounded LLM answer.",
  {
    query: z.string().min(1).describe("Natural-language question or keywords."),
    top_k: z.number().int().positive().max(50).optional().describe("Number of hits to return (default 10)."),
    account_ids: z.array(z.string().uuid()).optional().describe("Restrict to specific account UUIDs (see list_email_accounts)."),
    date_from: z.string().datetime().optional().describe("ISO-8601 lower bound on email date."),
    date_to: z.string().datetime().optional().describe("ISO-8601 upper bound on email date."),
    answer: z.boolean().optional().describe("If true, also return a Claude-generated grounded answer."),
  },
  async (args) => {
    const data = await api<{ hits: unknown; answer?: unknown }>("/api/search", {
      method: "POST",
      body: JSON.stringify(args),
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "list_email_accounts",
  "List the user's connected email accounts (id, provider, address, sync state). Use the returned ids to filter search_email.",
  {},
  async () => {
    const data = await api<unknown>("/api/accounts");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "get_account_sync_status",
  "Fetch recent sync jobs for one account. Useful to check if the initial sync is still running.",
  { account_id: z.string().uuid() },
  async ({ account_id }) => {
    const data = await api<unknown>(`/api/accounts/${account_id}/sync`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

await server.connect(new StdioServerTransport());
