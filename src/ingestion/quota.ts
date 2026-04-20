import { EMAIL_LIMIT_PER_USER } from "../config/constants.js";
import { query } from "../db/client.js";

export async function getIndexedCount(userId: string): Promise<number> {
  const rows = await query<{ emails_indexed: number }>(
    "SELECT emails_indexed FROM user_quota WHERE user_id = $1",
    [userId],
  );
  return rows[0]?.emails_indexed ?? 0;
}

export async function remainingQuota(userId: string): Promise<number> {
  return Math.max(0, EMAIL_LIMIT_PER_USER - (await getIndexedCount(userId)));
}

export async function incrementIndexedCount(userId: string, delta: number): Promise<void> {
  if (delta === 0) return;
  await query(
    `INSERT INTO user_quota (user_id, emails_indexed, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE
       SET emails_indexed = user_quota.emails_indexed + EXCLUDED.emails_indexed,
           updated_at = now()`,
    [userId, delta],
  );
}
