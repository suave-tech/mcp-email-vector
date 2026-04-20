import express from "express";
import { env } from "./config/env.js";
import { oauthRouter } from "./routes/oauth.js";
import { accountsRouter } from "./routes/accounts.js";
import { searchRouter } from "./routes/search.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/oauth", oauthRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/search", searchRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal_error", message: err.message });
});

app.listen(env.PORT, () => {
  console.log(`[api] listening on :${env.PORT}`);
});
