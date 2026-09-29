/**
 * ADR-0019 T1 — key derivation. A key must be a pure function of business
 * identity: the same fact gives the same key in every run and process, a
 * different fact gives a different key, and nothing phone-shaped gets through.
 */
import { describe, expect, it } from "vitest";
import { bridgeKey } from "./bridgeKeys";

/** StateNour's readIdempotencyKey accepts exactly this (lib/services/bridge-receipts.ts). */
const RECEIVER_ACCEPTS = (k: string) => k.length >= 1 && k.length <= 190 && /^[\x21-\x7e]+$/.test(k);

describe("bridgeKey", () => {
  it("is deterministic and carries the ADR format", () => {
    const a = bridgeKey("obligation.opened", "campaign_draft_awaiting_send", "draft-42");
    expect(a).toBe("v1:obligation.opened:campaign_draft_awaiting_send:draft-42");
    expect(bridgeKey("obligation.opened", "campaign_draft_awaiting_send", "draft-42")).toBe(a);
  });

  it("a different object or a changed discriminator is a different key", () => {
    const base = bridgeKey("experiment.verdict", "exp-1", { opaque: "c0ffee" }, "keep_running");
    expect(bridgeKey("experiment.verdict", "exp-2", { opaque: "c0ffee" }, "keep_running")).not.toBe(base);
    expect(bridgeKey("experiment.verdict", "exp-1", { opaque: "c0ffee" }, "winner")).not.toBe(base);
    expect(bridgeKey("experiment.verdict", "exp-1", { opaque: "decade" }, "keep_running")).not.toBe(base);
  });

  it("an opaque part is stable, order-sensitive and letters only", () => {
    const k1 = bridgeKey("obligation.opened", "attribution_weak_matches", { opaque: "3,17,254" });
    expect(k1).toBe(bridgeKey("obligation.opened", "attribution_weak_matches", { opaque: "3,17,254" }));
    expect(k1).not.toBe(bridgeKey("obligation.opened", "attribution_weak_matches", { opaque: "3,17" }));
    expect(k1!.split(":").at(-1)).toMatch(/^[a-p]{16}$/);
  });

  it("an opaque digest can never trip the phone guard, even when its hex is all digits", () => {
    // 1_000 inputs: raw hex digests of these would carry a 10-digit run often
    // enough to matter; the letters encoding never does.
    for (let i = 0; i < 1_000; i++) {
      const k = bridgeKey("experiment.verdict", "exp", { opaque: `h${i}` }, "no_signal");
      expect(k).not.toBeNull();
      expect(k).not.toMatch(/\d{10,}/);
    }
  });

  it("refuses a phone-shaped part (PII guard) and says so with null, never a key", () => {
    expect(bridgeKey("obligation.opened", "callback", "2165550100")).toBeNull();
    expect(bridgeKey("obligation.opened", "callback", 12165550100)).toBeNull();
    // positive control: a short numeric id is a legal part
    expect(bridgeKey("obligation.opened", "callback", 216555)).toBe("v1:obligation.opened:callback:216555");
  });

  it("refuses a part that would smuggle a separator, whitespace or nothing", () => {
    expect(bridgeKey("obligation.opened", "a:b")).toBeNull();
    expect(bridgeKey("obligation.opened", "a b")).toBeNull();
    expect(bridgeKey("obligation.opened", "")).toBeNull();
    expect(bridgeKey("obligation.opened", { opaque: "" })).toBeNull();
    expect(bridgeKey("obligation.opened")).toBeNull();
    expect(bridgeKey("Not A Type", "x")).toBeNull();
  });

  it("hashes a key over 190 chars to v1:h:<sha256>, which the receiver accepts", () => {
    const long = "x".repeat(200);
    const k = bridgeKey("obligation.opened", "t", long);
    expect(k).toMatch(/^v1:h:[0-9a-f]{64}$/);
    expect(bridgeKey("obligation.opened", "t", long)).toBe(k);
    expect(RECEIVER_ACCEPTS(k!)).toBe(true);
  });

  it("every key it returns is one StateNour's receiver accepts", () => {
    for (const k of [
      bridgeKey("obligation.opened", "campaign_draft_awaiting_send", "draft-42"),
      bridgeKey("experiment.verdict", "home-hero-subline-2026-09", { opaque: "0123456789abcdef" }, "winner", "variant"),
    ]) {
      expect(k).not.toBeNull();
      expect(RECEIVER_ACCEPTS(k!)).toBe(true);
    }
  });
});
