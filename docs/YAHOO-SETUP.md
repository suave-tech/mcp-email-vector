# Connecting a Yahoo Mail account

Yahoo has no modern REST API; the supported integration path is **IMAP + XOAUTH2** (OAuth 2.0 over IMAP's SASL layer). Registering the app takes ~5 minutes. All of this is for the deployment operator — end users only see the consent screen.

## 1. Register a Yahoo Developer app

1. Sign in at [developer.yahoo.com/apps](https://developer.yahoo.com/apps) and click **Create an App**.
2. **Application Type**: Web Application.
3. **Redirect URI (Callback Domain)**: paste exactly this, no trailing slash, no typos:
   ```
   http://localhost:3000/api/oauth/yahoo/callback
   ```
   (In production, replace with your HTTPS host. Yahoo rejects mismatches silently with a 400.)
4. **API Permissions → Mail**: tick **Read** (required). Tick **Read/Write** if you want inbox cleanup to work — it's the scope that authorizes `UID MOVE` to Trash.
5. **OpenID Connect Permissions**: tick **Email** and **Profile**. Both are needed; we use the `/openid/v1/userinfo` endpoint to fetch the account's email after the callback.
6. Create the app. Yahoo shows a **Client ID** (a.k.a. Consumer Key) and **Client Secret** (Consumer Secret) — copy both.

## 2. Set the environment variables

In the repo's `.env`:

```env
YAHOO_CLIENT_ID=<paste Consumer Key>
YAHOO_CLIENT_SECRET=<paste Consumer Secret>
YAHOO_REDIRECT_URI=http://localhost:3000/api/oauth/yahoo/callback
```

`pnpm setup` collects these interactively; you don't have to edit `.env` by hand unless you want to.

## 3. Connect the first Yahoo account

Interactive:

```bash
pnpm setup   # pick "2) Yahoo Mail" at the provider prompt
```

Scripted (skip the wizard):

```bash
pnpm run create-user -- you@yahoo.com --yahoo --cleanup
```

Either path prints a JWT + an OAuth URL. Open the URL, complete the Yahoo consent screen, and the callback redirects back to `http://localhost:3000/accounts?connected=<uuid>`.

Initial sync kicks off immediately. Watch the worker logs:

```bash
docker compose logs -f worker
```

## 4. What to expect

- **All folders except Spam/Trash/Drafts are indexed.** The folder name becomes the vector's `labels: [folder]`, so you can filter a search to `account_ids` or see which folder a hit came from.
- **Per-folder state** is stored in `accounts.provider_state` as JSON: `{ folders: { "INBOX": { uidValidity, lastUid }, "Sent": {…} } }`. If a folder's UIDVALIDITY changes (Yahoo reassigns UIDs), that folder is re-scanned from UID 1; dedup on RFC822 Message-ID catches duplicates.
- **Tokens refresh automatically.** Yahoo access tokens live ~1 hour; the refresh flow is triggered on the next sync tick when there's less than 10 minutes left.
- **Cleanup moves to Trash**, not permanent delete. Yahoo Trash retention depends on the user's account settings (default is ~indefinite unless they empty it manually).

## 5. Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `yahoo_not_configured` on `/api/oauth/yahoo/start` | Missing `YAHOO_CLIENT_ID/SECRET/REDIRECT_URI` | Run `pnpm setup` or fill `.env` manually |
| Yahoo consent screen returns a 400 | Redirect URI mismatch | The URI in your app settings must be character-for-character identical to `.env`'s `YAHOO_REDIRECT_URI` |
| `yahoo_token_exchange_failed` in API logs | Wrong client secret, or Yahoo IP rate-limited the exchange | Regenerate the secret in the developer console; retry |
| `needs_reauth = true` on the account row | Refresh token expired (~60 days of inactivity) | Re-run the OAuth flow for that account — existing vectors stay, new tokens replace the old ones |
| Sync logs `imap uidvalidity rollover` | Yahoo reassigned UIDs in a folder | Expected; the adapter re-scans the folder and dedup filters duplicates. No action needed |
| Cleanup returns `imap_trash_folder_not_found` | Yahoo account has no folder with the `\Trash` SPECIAL-USE flag | Rare; log into the Yahoo web UI and empty/recreate the Trash folder once |

## 6. Testing the connection without end-to-end OAuth

See [tests/yahoo.oauth.integration.test.ts](../tests/yahoo.oauth.integration.test.ts) and [tests/imap.fetchPage.test.ts](../tests/imap.fetchPage.test.ts) — both mock `fetch` (for the token endpoint) and `imapflow` (for IMAP) so they run without network access.
