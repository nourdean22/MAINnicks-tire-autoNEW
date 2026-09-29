/**
 * tests/repo/ai-cost-choke-point.test.ts · 2026-09-08 (program U6)
 *
 * The cost ledger was partial because 47 of 54 `aiChat` callers never called
 * `trackGeneration`. The fix is structural — `aiChat` records every completed
 * call itself — and this pins the structure: the call site is inside aiChat's
 * success path, the opt-out is explicit, the lane stop precedes provider
 * calls, and the two price tables are one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("aiChat is the cost choke point", () => {
  const provider = read("lib/ai/provider.ts");
  const aiChatBody = provider.slice(provider.indexOf("export async function aiChat("));

  it("records every completed call unless the caller opts out", () => {
    expect(aiChatBody).toMatch(/opts\.tracked !== false/);
    expect(aiChatBody).toMatch(/trackGeneration\(\{/);
    // the record carries what the ledger needs to price it
    expect(aiChatBody).toMatch(/provider: entry\.name/);
    expect(aiChatBody).toMatch(/costUsd,?\s*\}\)/);
  });

  it("the cost is computed for the model that actually answered, not the provider family (2026-09-29)", () => {
    // An escalation-lane Fable call ($10/$50) was priced at the anthropic family
    // rate ($2/$10). estimateCostUsd prices Claude ids per model only when it is
    // handed the id — so the id must be the 4th argument here.
    expect(aiChatBody).toMatch(
      /estimateCostUsd\(\s*entry\.name,\s*usage\?\.inputTokens,\s*usage\?\.outputTokens,\s*resolvedModelId,?\s*\)/,
    );
  });

  it("a lane past its cap stops before any provider is called", () => {
    const stop = aiChatBody.indexOf("checkLaneBudget(");
    const firstProviderCall = aiChatBody.indexOf("for (const entry of");
    expect(stop).toBeGreaterThan(0);
    expect(firstProviderCall).toBeGreaterThan(stop);
  });

  it("provider.ts and track.ts price from lib/ai/pricing.ts — no second table", () => {
    expect(provider).toMatch(/from "@\/lib\/ai\/pricing"/);
    expect(provider).not.toMatch(/const PROVIDER_RATES_PER_1M_TOKENS/);
    const track = read("lib/ai/track.ts");
    expect(track).toMatch(/from "@\/lib\/ai\/pricing"/);
    expect(track).toMatch(/costUsd/);
  });

  it("plan-day no longer double-counts (it went through aiChat all along)", () => {
    expect(read("app/api/ai/plan-day/route.ts")).not.toMatch(/trackGeneration\(/);
  });

  it("thumbs reach Langfuse as scores keyed by the turn's traceId", () => {
    const fb = read("lib/services/chat-feedback.ts");
    expect(fb).toMatch(/sendLangfuseScore\(/);
    expect(fb).toMatch(/traceId: payload\.traceId/);
  });
});
