/**
 * Fabrication rewriter tests · v10.0.162
 *
 * Pure helpers, easy to pin. Verifies:
 *   · no-rewrite when claims empty
 *   · banner prepended when claims present
 *   · banner is detectable via isVerifierRewritten
 *   · stripVerifierBanner round-trips back to original
 *   · banner mentions the verb(s) detected (operator-readable)
 */

import { describe, it, expect } from "vitest";
import {
  rewriteForFabrication,
  isVerifierRewritten,
  stripVerifierBanner,
  buildKnownTruthBanner,
  VERIFIER_MARKER,
} from "@/lib/ai/chat/fabrication-rewriter";
import type { ActionClaim } from "@/lib/ai/chat/action-claim-detector";

const sampleClaim = (over: Partial<ActionClaim> = {}): ActionClaim => ({
  verb: "added/created task",
  snippet: "added the suggested tasks",
  expectedTool: "createTask",
  ...over,
});

describe("rewriteForFabrication", () => {
  it("no-ops when no claims detected", () => {
    const r = rewriteForFabrication("Some response.", []);
    expect(r.rewrote).toBe(false);
    expect(r.text).toBe("Some response.");
    expect(r.bannerLength).toBe(0);
  });

  it("prepends a verifier banner when claims present", () => {
    const original = "Yes, added the suggested tasks to Bay 5 Revive.";
    const r = rewriteForFabrication(original, [sampleClaim()]);
    expect(r.rewrote).toBe(true);
    expect(r.text).toContain(VERIFIER_MARKER);
    expect(r.text).toContain(original); // original preserved verbatim
    expect(r.text.length).toBeGreaterThan(original.length);
  });

  it("banner mentions the detected verb so operator sees the diagnostic", () => {
    const r = rewriteForFabrication("Sent the email.", [
      sampleClaim({ verb: "sent/emailed/messaged", expectedTool: "sendEmail" }),
    ]);
    expect(r.text).toContain("sent/emailed/messaged");
  });

  it("dedupes verb list when multiple claims share the same verb", () => {
    const r = rewriteForFabrication("Added 3 tasks. Added another. Added one more.", [
      sampleClaim(),
      sampleClaim(),
      sampleClaim(),
    ]);
    // The verb list inside the banner should appear once, not three times
    const matches = r.text.match(/added\/created task/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("caps verb list at 3 even when many distinct claims fire", () => {
    const claims: ActionClaim[] = [
      sampleClaim({ verb: "verb1" }),
      sampleClaim({ verb: "verb2" }),
      sampleClaim({ verb: "verb3" }),
      sampleClaim({ verb: "verb4" }),
      sampleClaim({ verb: "verb5" }),
    ];
    const r = rewriteForFabrication("Did all five things.", claims);
    expect(r.text).toContain("verb1");
    expect(r.text).toContain("verb3");
    expect(r.text).not.toContain("verb4");
    expect(r.text).not.toContain("verb5");
  });
});

describe("isVerifierRewritten", () => {
  it("detects a previously rewritten message", () => {
    const r = rewriteForFabrication("Sent it.", [
      sampleClaim({ verb: "sent" }),
    ]);
    expect(isVerifierRewritten(r.text)).toBe(true);
  });

  it("returns false on an untouched message", () => {
    expect(isVerifierRewritten("Some normal response.")).toBe(false);
  });

  it("only matches when marker is at the start (not embedded)", () => {
    expect(
      isVerifierRewritten(`Sup. ${VERIFIER_MARKER} embedded in the middle.`),
    ).toBe(false);
  });
});

describe("stripVerifierBanner", () => {
  it("returns text unchanged when no banner present", () => {
    expect(stripVerifierBanner("Plain text.")).toBe("Plain text.");
  });

  it("strips the banner and returns the original message body", () => {
    const original = "Yes, added the suggested tasks.";
    const rewritten = rewriteForFabrication(original, [sampleClaim()]).text;
    const stripped = stripVerifierBanner(rewritten);
    expect(stripped).toBe(original);
  });

  it("handles multi-line bodies cleanly", () => {
    const original = "Line 1.\nLine 2.\nLine 3.";
    const rewritten = rewriteForFabrication(original, [sampleClaim()]).text;
    const stripped = stripVerifierBanner(rewritten);
    expect(stripped).toBe(original);
  });
});

// ── 2026-07-11 review · idempotency + single-builder guarantees ──
import { buildVerifierBanner } from "@/lib/ai/chat/fabrication-rewriter";

describe("verifier banner unification (2026-07-11)", () => {
  const claim = { verb: "sent", snippet: "I sent the email", expectedTool: "sendEmail" } as any;

  it("rewriteForFabrication is idempotent — never stacks a second banner", () => {
    const once = rewriteForFabrication("I sent the email.", [claim]);
    expect(once.rewrote).toBe(true);
    const twice = rewriteForFabrication(once.text, [claim]);
    expect(twice.rewrote).toBe(false);
    expect(twice.text).toBe(once.text);
    // exactly ONE marker in the final text
    expect(once.text.split("[VERIFIER · v10.0.162]").length - 1).toBe(1);
  });

  it("buildVerifierBanner carries the marker + unverified framing", () => {
    const banner = buildVerifierBanner("The response below claimed action(s) (sent) but tool call(s) failed.");
    expect(banner.startsWith("[VERIFIER · v10.0.162]")).toBe(true);
    expect(banner).toContain("**unverified**");
    expect(banner).toContain("_Original response (unverified):_");
  });
});

describe("buildKnownTruthBanner", () => {
  it("evidence_free_status → banner names the status claim + is verifier-detectable + strips clean", () => {
    const banner = buildKnownTruthBanner(["evidence_free_status"]);
    const wrapped = `${banner}Deployed and all tests passed.`;
    expect(isVerifierRewritten(wrapped)).toBe(true);
    expect(banner).toContain("no supporting evidence or tool receipt");
    expect(banner).toContain("unverified");
    expect(banner).toContain("_Original response (unverified):_");
    expect(stripVerifierBanner(wrapped)).toBe("Deployed and all tests passed.");
  });

  it("stale_active_claim → banner names the retired-infra case", () => {
    const banner = buildKnownTruthBanner(["stale_active_claim"]);
    expect(banner).toContain("retired or inactive infrastructure");
    expect(isVerifierRewritten(banner)).toBe(true);
  });
});
