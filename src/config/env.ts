import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  JWT_SECRET: z.string().min(16),
  TOKEN_ENCRYPTION_KEY: z.string().min(32),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  OPENAI_API_KEY: z.string(),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),

  PINECONE_API_KEY: z.string(),
  PINECONE_INDEX: z.string(),

  ANTHROPIC_API_KEY: z.string(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),

  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  GOOGLE_REDIRECT_URI: z.string().url(),

  MS_CLIENT_ID: z.string(),
  MS_CLIENT_SECRET: z.string(),
  MS_TENANT_ID: z.string().default("common"),
  MS_REDIRECT_URI: z.string().url(),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
