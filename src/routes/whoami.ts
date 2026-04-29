import { Router } from "express";
import { getUserId, requireAuth } from "../auth/jwt.js";
import { query } from "../db/client.js";

export const whoamiRouter: Router = Router();

whoamiRouter.get("/", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const rows = await query<{ email_address: string }>(
    "SELECT email_address FROM accounts WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1",
    [userId],
  );
  const email = rows[0]?.email_address;
  res.json({ userId, ...(email ? { email } : {}) });
});
