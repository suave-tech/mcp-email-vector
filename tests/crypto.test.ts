import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/auth/crypto.js";

describe("token crypto (AES-256-GCM)", () => {
  it("round-trips arbitrary strings", () => {
    const secret = "ya29.a0AfH6SMB..refresh..token.value";
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it("produces a different ciphertext per call (fresh IV)", () => {
    const secret = "same-input";
    expect(encrypt(secret)).not.toBe(encrypt(secret));
  });

  it("rejects tampered ciphertext via auth tag verification", () => {
    const blob = encrypt("secret");
    const buf = Buffer.from(blob, "base64");
    buf[buf.length - 1] ^= 0x01;
    expect(() => decrypt(buf.toString("base64"))).toThrow();
  });
});
