// Populate the env schema with deterministic test values before any src module is imported.
// src/config/env.ts runs `.parse(process.env)` at import time, so this must stay at the top.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.PORT = "3000";
process.env.JWT_SECRET = "test-jwt-secret-value-0123456789";
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";

process.env.OPENAI_API_KEY = "sk-test";
process.env.EMBEDDING_MODEL = "text-embedding-3-small";

process.env.PINECONE_API_KEY = "pc-test";
process.env.PINECONE_INDEX = "test-index";

process.env.ANTHROPIC_API_KEY = "sk-ant-test";
process.env.ANTHROPIC_MODEL = "claude-sonnet-4-6";

process.env.GOOGLE_CLIENT_ID = "google-test";
process.env.GOOGLE_CLIENT_SECRET = "google-secret";
process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/oauth/google/callback";

process.env.MS_CLIENT_ID = "ms-test";
process.env.MS_CLIENT_SECRET = "ms-secret";
process.env.MS_TENANT_ID = "common";
process.env.MS_REDIRECT_URI = "http://localhost:3000/api/oauth/microsoft/callback";
