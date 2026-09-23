/**
 * Stored tool errors must keep the REASON, not just the input.
 *
 * `recordToolInvocation` stored `errorMessage.slice(0, 200)` — a head
 * truncation. AI SDK validation errors put the reason at the TAIL, behind a
 * dump of the offending value:
 *
 *   Invalid input for tool X: Type validation failed: Value: {…}. Error message: <REASON>
 *
 * So the stored evidence was the input prefix and never the cause. Measured on
 * production 2026-09-16: all three `createMissionPlan` failures were EXACTLY
 * 200 characters, each cut off mid-payload. The tool was known to fail 75% of
 * the time and not one row said why.
 *
 * It compounds: `tool-description-rewrite.ts` feeds these to an LLM as failure
 * evidence. A rewriter reading input fragments with no reason is guessing.
 */
import { describe, it, expect } from "vitest";
import { condenseToolError } from "@/lib/ai/tool-telemetry";

/** The real shape, reconstructed from the production sample. */
function aiSdkValidationError(reason: string, payloadChars = 900): string {
  const payload = JSON.stringify({
    domain: "BUSINESS",
    priority: 30,
    successMetric: "ROI & Shop Catch-up completed each Monday",
    title: "Shop Operations",
    tasks: [{ context: "Shop Operations", filler: "x".repeat(payloadChars) }],
  });
  return `Invalid input for tool createMissionPlan: Type validation failed: Value: ${payload}. Error message: ${reason}`;
}

describe("condenseToolError", () => {
  it("keeps a short message whole", () => {
    const msg = "Model tried to call unavailable tool 'getGoals'.";
    expect(condenseToolError(msg)).toBe(msg);
  });

  it("KEEPS THE REASON when the value dump is long — the whole point", () => {
    const reason = `Invalid enum value. Expected 'DESK' | 'PHONE' | 'SHOP' | 'CAR' | 'HOME' | 'ANYWHERE', received 'Shop Operations' at tasks[0].context`;
    const out = condenseToolError(aiSdkValidationError(reason));

    // Under the old head-only truncation this assertion was impossible: the
    // reason sits thousands of characters past the 200-char cut.
    expect(out).toContain("received 'Shop Operations'");
    expect(out).toContain("tasks[0].context");
  });

  it("still identifies WHICH tool and what kind of failure", () => {
    const out = condenseToolError(aiSdkValidationError("Required at tasks[0].nextPhysicalAction"));
    expect(out).toContain("createMissionPlan");
    expect(out).toContain("Type validation failed");
  });

  it("says how much was dropped instead of hiding it", () => {
    // A silent elision invites the reader to treat a fragment as the whole
    // message — which is how the 200-char cut went unnoticed for so long.
    const out = condenseToolError(aiSdkValidationError("boom"));
    expect(out).toMatch(/\[\d+ chars elided\]/);
  });

  it("stays bounded — this is stored per call on an aggregate row", () => {
    const out = condenseToolError(aiSdkValidationError("boom", 50_000));
    expect(out.length).toBeLessThan(600);
  });

  it("does not lose a reason that arrives at the HEAD instead", () => {
    // Ordinary thrown Errors put the message first. Keeping both ends means
    // the fix is not tuned to one library's formatting.
    const msg = `ECONNREFUSED connecting to upstream. ${"context ".repeat(200)}`;
    expect(condenseToolError(msg)).toContain("ECONNREFUSED");
  });
});
