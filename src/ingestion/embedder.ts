import OpenAI from "openai";
import { env } from "../config/env.js";

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

// At 1 char ≈ 1 token (worst case: base64, dense numbers, some Unicode) this
// is safely below the model's 8192-token hard limit. Only applied as a last
// resort when the normal chunker budget still isn't enough.
const EMERGENCY_CHAR_CAP = 8_000;

export async function embed(text: string): Promise<number[]> {
  const res = await client.embeddings.create({ model: env.EMBEDDING_MODEL, input: text });
  return res.data[0]!.embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  try {
    const res = await client.embeddings.create({ model: env.EMBEDDING_MODEL, input: texts });
    return res.data.map((d) => d.embedding);
  } catch (err: unknown) {
    if (!isTokenLimitError(err)) throw err;

    // At least one item in the batch exceeds 8192 tokens (pathological email:
    // base64 inline content, dense Unicode, etc.). Fall back to one-by-one
    // embedding with an emergency hard cap so the rest of the batch still lands.
    return Promise.all(texts.map((t) => embedOneSafe(t)));
  }
}

async function embedOneSafe(text: string): Promise<number[]> {
  const safe = text.length > EMERGENCY_CHAR_CAP ? text.slice(0, EMERGENCY_CHAR_CAP) : text;
  const res = await client.embeddings.create({ model: env.EMBEDDING_MODEL, input: safe });
  return res.data[0]!.embedding;
}

function isTokenLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.includes("maximum input length") || err.message.includes("too many tokens");
}
