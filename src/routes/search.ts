import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../auth/jwt.js";
import { search } from "../query/search.js";
import { answer } from "../query/llm.js";

export const searchRouter: Router = Router();

const body = z.object({
  query: z.string().min(1),
  account_ids: z.array(z.string().uuid()).optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  top_k: z.number().int().positive().max(50).optional(),
  answer: z.boolean().optional(),
});

searchRouter.post("/", requireAuth, async (req, res) => {
  const parsed = body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  const userId = (req as AuthedRequest).userId;
  const hits = await search({
    userId,
    query: parsed.data.query,
    accountIds: parsed.data.account_ids,
    dateFrom: parsed.data.date_from,
    dateTo: parsed.data.date_to,
    topK: parsed.data.top_k,
  });
  const grounded = parsed.data.answer ? await answer(parsed.data.query, hits) : undefined;
  res.json({ hits, answer: grounded });
});
