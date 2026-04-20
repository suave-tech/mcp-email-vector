import { describe, expect, it } from "vitest";
import { CleanupRules, rulesToGmailQuery } from "../src/cleanup/rules.js";

describe("rulesToGmailQuery", () => {
  it("always appends starred/important safety rails", () => {
    const q = rulesToGmailQuery(CleanupRules.parse({}));
    expect(q).toContain("-is:starred");
    expect(q).toContain("-is:important");
  });

  it("joins multiple senders with OR", () => {
    const q = rulesToGmailQuery(CleanupRules.parse({ senders: ["promos@brand.com", "@news.example"] }));
    expect(q).toContain("(from:promos@brand.com OR from:@news.example)");
  });

  it("maps CATEGORY_* labels to Gmail category syntax", () => {
    const q = rulesToGmailQuery(CleanupRules.parse({ labels: ["CATEGORY_PROMOTIONS"] }));
    expect(q).toContain("category:promotions");
  });

  it("quotes subject phrases with whitespace", () => {
    const q = rulesToGmailQuery(CleanupRules.parse({ subjectMatches: ["flash sale"] }));
    expect(q).toContain('subject:"flash sale"');
  });

  it("adds has:list when hasUnsubscribe is true", () => {
    const q = rulesToGmailQuery(CleanupRules.parse({ hasUnsubscribe: true }));
    expect(q).toContain("has:list");
  });

  it("emits negative filters for keep rules", () => {
    const q = rulesToGmailQuery(
      CleanupRules.parse({
        senders: ["@news.example"],
        keep: { senders: ["boss@company.com"], labels: ["STARRED"], subjectMatches: ["invoice"] },
      }),
    );
    expect(q).toContain("-from:boss@company.com");
    expect(q).toContain("-label:starred");
    expect(q).toContain("-subject:invoice");
  });

  it("adds older_than:Nd when olderThanDays is set", () => {
    const q = rulesToGmailQuery(CleanupRules.parse({ olderThanDays: 90 }));
    expect(q).toContain("older_than:90d");
  });

  it("rejects maxMessages above the hard ceiling", () => {
    expect(() => CleanupRules.parse({ maxMessages: 10_000 })).toThrow();
  });
});
