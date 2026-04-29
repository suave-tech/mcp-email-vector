export function gmailDeeplink(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(messageId)}`;
}

export function yahooDeeplink(subject: string): string {
  return `https://mail.yahoo.com/d/search/keyword=${encodeURIComponent(subject)}`;
}

export function buildDeeplink(provider: string, messageId: string, subject: string): string {
  if (provider === "gmail") return gmailDeeplink(messageId);
  if (provider === "yahoo") return yahooDeeplink(subject);
  return "";
}
