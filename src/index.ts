import express from "express";
import { env } from "./config/env.js";
import { accountsRouter } from "./routes/accounts.js";
import { cleanupRouter } from "./routes/cleanup.js";
import { oauthRouter } from "./routes/oauth.js";
import { searchRouter } from "./routes/search.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Landing page after the Google OAuth callback redirects the browser here.
// Plain HTML so there's no build step; the wizard's poller is what actually
// advances the flow — this page just tells the human they can close the tab.
app.get("/accounts", (req, res) => {
  const connected = typeof req.query.connected === "string";
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${connected ? "Gmail connected" : "sts-project-vector-email"}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body { font: 16px/1.5 system-ui, sans-serif; margin: 0; min-height: 100vh;
      display: grid; place-items: center; background: #fafafa; color: #111; }
    .card { background: #fff; border: 1px solid #e5e5e5; border-radius: 12px;
      padding: 32px 40px; max-width: 440px; text-align: center; }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 0; color: #555; }
    .ok { color: #16a34a; font-size: 32px; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="card">
    ${
      connected
        ? `<div class="ok">✓</div>
    <h1>Gmail connected</h1>
    <p>You can close this tab and return to your terminal. Initial sync is running in the background.</p>`
        : `<h1>sts-project-vector-email</h1>
    <p>API is running. Start a connection flow from the CLI with <code>pnpm setup</code>.</p>`
    }
  </div>
</body>
</html>`);
});

app.use("/api/oauth", oauthRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/search", searchRouter);
if (env.ENABLE_INBOX_CLEANUP) {
  app.use("/api/cleanup", cleanupRouter);
  console.log("[api] inbox cleanup enabled (/api/cleanup)");
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal_error", message: err.message });
});

app.listen(env.PORT, () => {
  console.log(`[api] listening on :${env.PORT}`);
});
