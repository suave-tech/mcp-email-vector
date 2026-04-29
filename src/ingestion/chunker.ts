import { createHash } from "node:crypto";
import { MAX_EMAIL_TOKENS } from "../config/constants.js";
import type { NormalizedEmail } from "../providers/types.js";

// Conservative 3-chars-per-token heuristic — safer than 4 for content with
// URLs, Unicode, or dense punctuation. Not for billing, just a hard guardrail.
const CHAR_BUDGET = MAX_EMAIL_TOKENS * 3;

export function buildEmbeddingText(email: NormalizedEmail): string {
  const header =
    `From: ${email.senderName ?? ""} <${email.senderEmail}>\n` +
    `To: ${email.recipients.join(", ")}\n` +
    `Date: ${email.date}\n` +
    `Subject: ${email.subject}\n\n`;

  const body = email.bodyText ?? "";
  const combined = header + body;
  if (combined.length <= CHAR_BUDGET) return combined;

  // Preserve header + first slice of body.
  return header + body.slice(0, CHAR_BUDGET - header.length);
}

export function contentHash(email: NormalizedEmail): string {
  return createHash("sha256")
    .update(email.subject)
    .update("\x00")
    .update(email.bodyText ?? "")
    .update("\x00")
    .update(email.labels.sort().join(","))
    .digest("hex");
}
