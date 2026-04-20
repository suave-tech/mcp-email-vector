import { describe, expect, it } from "vitest";
import { buildEmbeddingText, contentHash } from "../src/ingestion/chunker.js";
import type { NormalizedEmail } from "../src/providers/types.js";
import { MAX_EMAIL_TOKENS } from "../src/config/constants.js";

const base: NormalizedEmail = {
  messageId: "<abc@example.com>",
  threadId: "t1",
  senderEmail: "alice@example.com",
  senderName: "Alice",
  recipients: ["bob@example.com"],
  subject: "Hello",
  bodyText: "Body",
  date: "2026-03-15T10:22:00Z",
  labels: ["INBOX"],
  hasAttachments: false,
};

describe("buildEmbeddingText", () => {
  it("produces the documented From/To/Date/Subject header followed by the body", () => {
    const text = buildEmbeddingText(base);
    expect(text).toContain("From: Alice <alice@example.com>");
    expect(text).toContain("To: bob@example.com");
    expect(text).toContain("Date: 2026-03-15T10:22:00Z");
    expect(text).toContain("Subject: Hello");
    expect(text.endsWith("Body")).toBe(true);
  });

  it("truncates oversized bodies while preserving the header", () => {
    const huge = { ...base, bodyText: "x".repeat(MAX_EMAIL_TOKENS * 4 + 5000) };
    const text = buildEmbeddingText(huge);
    expect(text.length).toBeLessThanOrEqual(MAX_EMAIL_TOKENS * 4);
    expect(text.startsWith("From: Alice")).toBe(true);
    expect(text).toContain("Subject: Hello");
  });
});

describe("contentHash", () => {
  it("is stable for identical input", () => {
    expect(contentHash(base)).toBe(contentHash({ ...base }));
  });

  it("changes when the body changes (drives re-embedding)", () => {
    expect(contentHash(base)).not.toBe(contentHash({ ...base, bodyText: "Body v2" }));
  });

  it("changes when labels change (matches spec 5.4 — label-only edits re-embed)", () => {
    expect(contentHash(base)).not.toBe(contentHash({ ...base, labels: ["INBOX", "IMPORTANT"] }));
  });

  it("is independent of label ordering", () => {
    const a = contentHash({ ...base, labels: ["A", "B", "C"] });
    const b = contentHash({ ...base, labels: ["C", "A", "B"] });
    expect(a).toBe(b);
  });
});
