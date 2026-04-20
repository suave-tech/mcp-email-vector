import { TOKEN_REFRESH_SKEW_MS } from "../config/constants.js";
import { query } from "../db/client.js";
import { providerFor } from "../providers/index.js";
import type { Provider } from "../providers/types.js";
import { decrypt, encrypt } from "./crypto.js";

interface TokenAccount {
  id: string;
  provider: Provider;
  access_token: string;
  refresh_token: string;
  token_expires_at: string | null;
}

/**
 * Return a valid access token for the account, refreshing through the
 * provider and persisting the new credentials when the current one is
 * within the refresh skew window.
 */
export async function ensureFreshToken(acct: TokenAccount): Promise<string> {
  const expires = acct.token_expires_at ? new Date(acct.token_expires_at).getTime() : 0;
  if (expires - Date.now() > TOKEN_REFRESH_SKEW_MS) {
    return decrypt(acct.access_token);
  }

  try {
    const refreshed = await providerFor(acct.provider).refreshAccessToken(decrypt(acct.refresh_token));
    await query(
      "UPDATE accounts SET access_token = $1, token_expires_at = $2, needs_reauth = false WHERE id = $3",
      [encrypt(refreshed.accessToken), refreshed.expiresAt.toISOString(), acct.id],
    );
    return refreshed.accessToken;
  } catch (err) {
    await query("UPDATE accounts SET needs_reauth = true WHERE id = $1", [acct.id]);
    throw err;
  }
}
