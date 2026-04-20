import { describe, expect, it } from "vitest";
import { parseExactMatchHints } from "../src/query/search.js";

describe("parseExactMatchHints — hybrid search fallback", () => {
  it("returns empty hints for a normal natural-language query", () => {
    const h = parseExactMatchHints("What did John say about the Q3 budget?");
    expect(h.messageIds).toEqual([]);
    expect(h.addresses).toEqual([]);
  });

  it("extracts a bracketed RFC 5322 Message-ID", () => {
    const h = parseExactMatchHints("find <CAF=xyz@mail.gmail.com>");
    expect(h.messageIds).toEqual(["<CAF=xyz@mail.gmail.com>"]);
    expect(h.addresses).toEqual([]);
  });

  it("extracts a sender email without treating it as a message-id", () => {
    const h = parseExactMatchHints("emails from sarah@company.com about launch");
    expect(h.messageIds).toEqual([]);
    expect(h.addresses).toEqual(["sarah@company.com"]);
  });

  it("handles both in the same query without double-counting the id as an address", () => {
    const h = parseExactMatchHints("<id@x.com> from alice@example.com");
    expect(h.messageIds).toEqual(["<id@x.com>"]);
    expect(h.addresses).toEqual(["alice@example.com"]);
  });

  it("collects multiple addresses so the caller can decide not to filter on them", () => {
    const h = parseExactMatchHints("alice@a.com and bob@b.com");
    expect(h.addresses).toEqual(["alice@a.com", "bob@b.com"]);
  });
});
