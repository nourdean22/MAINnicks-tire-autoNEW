/**
 * VERIFIER BANNER IN PERSISTED PARTS -- 2026-09-10.
 *
 * Review #2267 P2, and the reviewer was right.
 *
 * The first fix stripped the banner from `content` only. That reached
 * almost nothing: the verifier rewrite patches BOTH `content` and the
 * persisted text part (post-persist-verification.ts), and
 * `hooks/use-conversations.ts:171-179` explicitly PREFERS the persisted
 * parts tree over `content`. So a normally-rewritten message still
 * hydrated and rendered the raw system trace in NICK's own voice, and
 * the content-only fix applied precisely to the legacy rows that have no
 * parts -- the ones that needed it least.
 *
 * These tests pin the projection behaviourally, against the REAL banner
 * builder, so a change to either side fails here rather than silently
 * un-wiring the fix.
 */
import { describe, it, expect } from "vitest";
import { stripVerifierBannerFromParts } from "@/lib/services/chat-conversation-read";
import { buildVerifierBanner } from "@/lib/ai/chat/fabrication-rewriter";

const ORIGINAL = "Pinned it to the top of your board. Go run.";
const REWRITTEN = buildVerifierBanner("claimed an action but no tool call fired.") + ORIGINAL;

describe("parts projection", () => {
  it("strips the banner from a persisted text part", () => {
    const out = stripVerifierBannerFromParts([{ type: "text", text: REWRITTEN }]) as Array<{
      type: string;
      text: string;
    }>;
    expect(out[0].text).toBe(ORIGINAL);
    expect(out[0].text).not.toMatch(/VERIFIER/i);
  });

  it("leaves every other part shape untouched", () => {
    const parts = [
      { type: "reasoning", text: REWRITTEN },
      { type: "tool-call", toolName: "search", args: { q: "x" } },
      { type: "file", url: "https://example.com/a.png" },
    ];
    const out = stripVerifierBannerFromParts(parts) as typeof parts;
    // Only `type: "text"` nodes are in scope -- a read projection that
    // reshapes on a guess is worse than one that leaves a banner.
    expect(out[0].text).toBe(REWRITTEN);
    expect(out[1]).toEqual(parts[1]);
    expect(out[2]).toEqual(parts[2]);
  });

  it("preserves other fields on the part it rewrites", () => {
    const out = stripVerifierBannerFromParts([
      { type: "text", text: REWRITTEN, providerMetadata: { a: 1 } },
    ]) as Array<Record<string, unknown>>;
    expect(out[0].providerMetadata).toEqual({ a: 1 });
    expect(out[0].text).toBe(ORIGINAL);
  });

  // CONTROL: an untouched tree must come back referentially identical,
  // or every reload churns the message list for nothing.
  it("CONTROL - a clean parts tree is returned by identity", () => {
    const parts = [{ type: "text", text: ORIGINAL }];
    expect(stripVerifierBannerFromParts(parts)).toBe(parts);
  });

  it("CONTROL - non-array input is returned untouched", () => {
    expect(stripVerifierBannerFromParts(null)).toBeNull();
    expect(stripVerifierBannerFromParts(undefined)).toBeUndefined();
    const obj = { not: "an array" };
    expect(stripVerifierBannerFromParts(obj)).toBe(obj);
  });

  it("CONTROL - malformed parts do not throw", () => {
    const junk = [null, 42, "string", { type: "text" }, { text: "no type" }];
    expect(() => stripVerifierBannerFromParts(junk)).not.toThrow();
    expect(stripVerifierBannerFromParts(junk)).toBe(junk);
  });
});
