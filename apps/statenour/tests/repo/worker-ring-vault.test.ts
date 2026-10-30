/**
 * Ring W1a: the token vault's two pure halves (2026-10-30).
 * - seal/open: AES-256-GCM, so Redis never holds the refresh token in plain text;
 *   a wrong key or a tampered value fails closed (throws), never returns garbage.
 * - RESP: the minimal Redis protocol the worker speaks (no new npm dependency).
 * The network half is exercised by the poller test through the same vault contract.
 */
import { describe, it, expect } from "vitest";
import { openToken, sealToken, encodeCommand, parseReply, CAS_SCRIPT } from "../../../worker/src/ring-vault";

describe("sealToken / openToken", () => {
  it("round-trips and never stores the plain value", () => {
    const sealed = sealToken("rt-secret-value", "key-1");
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("rt-secret-value");
    expect(openToken(sealed, "key-1")).toBe("rt-secret-value");
  });
  it("two seals of the same value differ (random IV)", () => {
    expect(sealToken("x", "k")).not.toBe(sealToken("x", "k"));
  });
  it("a wrong key throws", () => {
    expect(() => openToken(sealToken("x", "k1"), "k2")).toThrow();
  });
  // Tamper the DECODED bytes at fixed positions: IV (0), auth tag (12), ciphertext body (28).
  // The old test flipped a random base64 character; about 1 run in 16 that character only held
  // base64 padding bits, the decoded bytes were identical, and the test failed with no tamper
  // (PR 3420 node run, 2026-10-30; reproduced 23 of 400 locally, every one byte-identical).
  const flipByte = (sealed: string, at: number) => {
    const raw = Buffer.from(sealed.slice(3), "base64");
    raw[at] ^= 0x01;
    return "v1:" + raw.toString("base64");
  };
  it.each([["IV", 0], ["auth tag", 12], ["ciphertext body", 28]])("a tampered %s byte throws", (_part, at) => {
    const s = sealToken("x", "k");
    expect(() => openToken(flipByte(s, at as number), "k")).toThrow();
  });
  it("positive control: the same helper with no flip opens", () => {
    const s = sealToken("x", "k");
    const raw = Buffer.from(s.slice(3), "base64");
    expect(openToken("v1:" + raw.toString("base64"), "k")).toBe("x");
  });
  it("an empty key refuses to seal", () => {
    expect(() => sealToken("x", "")).toThrow();
  });
});

describe("RESP", () => {
  it("encodes a command as an array of bulk strings", () => {
    expect(encodeCommand(["GET", "ring:auth"])).toBe("*2\r\n$3\r\nGET\r\n$9\r\nring:auth\r\n");
  });
  it("counts bytes, not characters", () => {
    expect(encodeCommand(["SET", "k", "é"])).toBe("*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$2\r\né\r\n");
  });
  it("parses simple, integer, bulk, nil and error replies", () => {
    expect(parseReply(Buffer.from("+OK\r\n"))).toEqual({ value: "OK", rest: 5 });
    expect(parseReply(Buffer.from(":1\r\n"))).toEqual({ value: 1, rest: 4 });
    expect(parseReply(Buffer.from("$5\r\nhello\r\n"))).toEqual({ value: "hello", rest: 11 });
    expect(parseReply(Buffer.from("$-1\r\n"))).toEqual({ value: null, rest: 5 });
    expect(parseReply(Buffer.from("-ERR bad\r\n"))).toEqual({ value: new Error("ERR bad"), rest: 10 });
  });
  it("returns null for an incomplete reply (wait for more bytes)", () => {
    expect(parseReply(Buffer.from("$5\r\nhel"))).toBeNull();
    expect(parseReply(Buffer.from(":1"))).toBeNull();
  });
  it("the CAS script compares before it sets (empty string = no stored value)", () => {
    expect(CAS_SCRIPT).toMatch(/redis\.call\('GET', KEYS\[1\]\) or ''\) == ARGV\[1\]/);
    expect(CAS_SCRIPT).toMatch(/redis\.call\('SET', KEYS\[1\], ARGV\[2\]\)/);
  });
});
