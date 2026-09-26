/**
 * tests/lib/ai/claude-pricing.test.ts Â· 2026-09-23 (Q-16)
 *
 * The cost ledger priced Claude Sonnet 5 at $3/$15 per MTok. The pricing
 * page says otherwise â€” this is the line the numbers below are pinned to:
 *
 *   "The $2/$10 per million input/output token pricing for Claude Sonnet 5,
 *    announced at launch as introductory pricing through August 31, 2026, is
 *    now the standard price. The previously scheduled increase to $3/$15 per
 *    million input/output tokens on September 1, 2026 will not occur."
 *   â€” platform.claude.com/docs/en/about-claude/pricing, read 2026-09-25
 *
 * If Anthropic reprices, change the source line and the numbers together.
 */
import { describe, expect, it, vi } from "vitest";

const create = vi.fn(async (_args: { data: { costCents: number } }) => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { aiGeneration: { create: (a: { data: { costCents: number } }) => create(a) } } }));

import { trackGeneration } from "@/lib/ai/track";
import { LANGFUSE_MODEL_PRICES, PROVIDER_RATES_PER_1M_TOKENS } from "@/lib/ai/pricing";
import { PROVIDERS_REGISTRY } from "@/config/ai-providers";

/** The cents trackGeneration actually writes to the AiGeneration ledger. */
async function ledgerCents(model: string, provider?: string): Promise<number> {
  create.mockClear();
  await trackGeneration({ feature: "t", model, provider, promptTokens: 1_000_000, outputTokens: 1_000_000 });
  return create.mock.calls[0]![0].data.costCents;
}

const SONNET_5 = { input: 2.0, output: 10.0 };

describe("Claude Sonnet 5 is priced at the standard $2/$10", () => {
  it("the ledger row for 1M in + 1M out is $12 (1200 cents)", async () => {
    expect(await ledgerCents("claude-sonnet-5")).toBe(1200);
    // with the provider passed, the SKU table still wins for a named model
    expect(await ledgerCents("claude-sonnet-5", "anthropic")).toBe(1200);
  });

  it("the anthropic family rate equals the registry default model's price", () => {
    expect(PROVIDERS_REGISTRY.anthropic.defaultModel).toBe("claude-sonnet-5");
    expect(PROVIDER_RATES_PER_1M_TOKENS.anthropic).toEqual(SONNET_5);
  });

  it("Langfuse gets the same per-token numbers, sampled on the current model", () => {
    const fam = LANGFUSE_MODEL_PRICES.find((m) => m.modelName === "statenour/anthropic-family")!;
    expect(fam.sample).toBe("claude-sonnet-5");
    expect(fam.inputPrice).toBeCloseTo(SONNET_5.input / 1_000_000, 12);
    expect(fam.outputPrice).toBeCloseTo(SONNET_5.output / 1_000_000, 12);
  });

  it("older Sonnets keep their own $3/$15 list price (not swept up by the change)", async () => {
    expect(await ledgerCents("claude-sonnet-4-6")).toBe(1800);
  });
});
