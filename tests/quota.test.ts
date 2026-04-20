import { describe, expect, it } from "vitest";
import { EMAIL_LIMIT_PER_USER, EXCLUDED_LABELS, namespaceFor } from "../src/config/constants.js";

describe("namespaceFor", () => {
  it("prefixes user_ — query service relies on this for isolation", () => {
    expect(namespaceFor("abc-123")).toBe("user_abc-123");
  });
});

describe("configured guardrails", () => {
  it("caps per-user indexing", () => {
    expect(EMAIL_LIMIT_PER_USER).toBeGreaterThan(0);
  });

  it("excludes Spam and Promotions per TECH-SPEC answer", () => {
    expect(EXCLUDED_LABELS).toContain("SPAM");
    expect(EXCLUDED_LABELS).toContain("CATEGORY_PROMOTIONS");
  });
});
