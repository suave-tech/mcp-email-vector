import OpenAI from "openai";
import { env } from "../config/env.js";

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export async function embed(text: string): Promise<number[]> {
  const res = await client.embeddings.create({ model: env.EMBEDDING_MODEL, input: text });
  return res.data[0]!.embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await client.embeddings.create({ model: env.EMBEDDING_MODEL, input: texts });
  return res.data.map((d) => d.embedding);
}
