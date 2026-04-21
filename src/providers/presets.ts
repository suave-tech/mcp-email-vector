// IMAP preset registry. Each preset fixes the server endpoints + OAuth
// endpoints for a well-known host. Adding a new preset (iCloud, Fastmail,
// corporate Exchange) is a config-only change — makeImapProvider reads the
// preset and nothing else in the stack needs to know.

export interface ImapOAuthConfig {
  authEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  // Base scopes always requested. Append "mail-w" (or the provider's
  // equivalent) dynamically when the user opts into cleanup.
  scopes: string[];
  // Name of the write scope that gates cleanup endpoints for this preset.
  writeScope: string;
}

export interface ImapPreset {
  id: "yahoo" | "icloud" | "fastmail";
  host: string;
  port: number;
  secure: boolean;
  oauth: ImapOAuthConfig;
  // IMAP SPECIAL-USE folder attributes to skip during sync. \Junk / \Trash /
  // \Drafts never carry anything worth indexing. \All on Gmail-over-IMAP
  // would double-count but Yahoo doesn't expose it.
  excludedSpecialUse: Array<"\\Junk" | "\\Trash" | "\\Drafts" | "\\All">;
}

export const YAHOO_PRESET: ImapPreset = {
  id: "yahoo",
  host: "imap.mail.yahoo.com",
  port: 993,
  secure: true,
  oauth: {
    authEndpoint: "https://api.login.yahoo.com/oauth2/request_auth",
    tokenEndpoint: "https://api.login.yahoo.com/oauth2/get_token",
    userinfoEndpoint: "https://api.login.yahoo.com/openid/v1/userinfo",
    scopes: ["openid", "mail-r"],
    writeScope: "mail-w",
  },
  excludedSpecialUse: ["\\Junk", "\\Trash", "\\Drafts"],
};
