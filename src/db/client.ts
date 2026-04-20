import { Pool } from "pg";
import { env } from "../config/env.js";

export const pool = new Pool({ connectionString: env.DATABASE_URL });

export async function query<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}
