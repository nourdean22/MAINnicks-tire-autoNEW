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
 * 2026-09-29 · per model. Every aiChat call on the anthropic provider was
 * priced at that one $2/$10 family rate, so an escalation-lane Fable call
 * ($10/$50) was recorded at a fifth of its cost, and track.ts's
 * "claude-opus-4" substring key priced Opus 4.5-4.8 at Opus 4's $15/$75.
 * The numbers below are copied by hand from the pricing page's "Model
 * pricing" table (read 2026-09-29), NOT derived from lib/ai/pricing.ts,
 * so a wrong row in the table fails here.
 *
 * If Anthropic reprices, change the source line and the numbers together.
 */
import { describe, expect, it, vi } from "vitest";

const create = vi.fn(async (_args: { data: { costCents: number } }) => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { aiGeneration: { create: (a: { data: { costCents: number } }) => create(a) } } }));

import { trackGeneration } from "@/lib/ai/track";
import {
  CLAUDE_MODEL_RATES_PER_1M_TOKENS,
  LANGFUSE_MODEL_PRICES,
  PROVIDER_RATES_PER_1M_TOKENS,
  estimateCostUsd,
} from "@/lib/ai/pricing";
import { PROVIDERS_REGISTRY } from "@/config/ai-providers";

/** The cents trackGeneration actually writes to the AiGeneration ledger. */
async function ledgerCents(model: string, provider?: string): Promise<number> {
  create.mockClear();
  await trackGeneration({ feature: "t", model, provider, promptTokens: 1_000_000, outputTokens: 1_000_000 });
  return create.mock.calls[0]![0].data.costCents;
}

const SONNET_5 = { input: 2.0, output: 10.0 };

/** [model id as a caller sends it, $ input / MTok, $ output / MTok] */
const LIST_PRICES: Array<[string, number, number]> = [
  ["claude-fable-5-1", 10, 50],
  ["claude-mythos-5-1", 10, 50],
  ["claude-fable-5", 10, 50],
  ["claude-mythos-5", 10, 50],
  ["claude-opus-5-5", 4, 20],
  ["claude-opus-5", 5, 25],
  ["claude-opus-4-8", 5, 25],
  ["claude-opus-4-7", 5, 25],
  ["claude-opus-4-6", 5, 25],
  ["claude-opus-4-5-20251101", 5, 25],
  ["claude-sonnet-5-5", 2, 10],
  ["claude-sonnet-5", 2, 10],
  ["claude-sonnet-4-6", 3, 15],
  ["claude-sonnet-4-5-20250929", 3, 15],
  ["claude-haiku-4-5-20251001", 1, 5],
];

describe("every Claude model is priced at its own list price", () => {
  it("the hand-copied list covers every row of the rate table (no unpinned row)", () => {
    const keys = new Set(LIST_PRICES.map(([id]) => id.replace(/-\d{8}$/, "")));
    expect([...keys].sort()).toEqual(Object.keys(CLAUDE_MODEL_RATES_PER_1M_TOKENS).sort());
  });

  for (const [id, input, output] of LIST_PRICES) {
    const cents = (input + output) * 100; // 1M in + 1M out

    it(`${id}: aiChat cost (provider.ts) is $${input}/$${output}`, () => {
      expect(estimateCostUsd("anthropic", 1_000_000, 1_000_000, id)).toBe(input + output);
    });

    it(`${id}: the AiGeneration ledger row is ${cents} cents, with or without the provider`, async () => {
      expect(await ledgerCents(id)).toBe(cents);
      expect(await ledgerCents(id, "anthropic")).toBe(cents);
    });

    it(`${id}: exactly one Langfuse definition matches it, at the same price`, () => {
      const hits = LANGFUSE_MODEL_PRICES.filter((m) =>
        new RegExp(m.matchPattern.replace(/^\(\?i\)/, ""), "i").test(id),
      );
      expect(hits.map((h) => h.modelName)).toHaveLength(1);
      expect(hits[0]!.inputPrice).toBeCloseTo(input / 1_000_000, 12);
      expect(hits[0]!.outputPrice).toBeCloseTo(output / 1_000_000, 12);
    });
  }

  it("an id the table does not name never borrows the price of an id it starts with", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // a hypothetical claude-opus-5-9 is not Opus 5 ($5/$25): family rate + flag
      expect(estimateCostUsd("anthropic", 1_000_000, 1_000_000, "claude-opus-5-9")).toBe(12);
      expect(warn.mock.calls.some((c) => String(c[0]).includes("claude-opus-5-9"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("a newer id never prices as the older id it starts with", () => {
    expect(estimateCostUsd("anthropic", 1_000_000, 0, "claude-opus-5-5")).toBe(4);
    expect(estimateCostUsd("anthropic", 1_000_000, 0, "claude-opus-5")).toBe(5);
    expect(estimateCostUsd("anthropic", 1_000_000, 0, "claude-fable-5-1")).toBe(10);
  });

  it("aliases resolve: -latest and @date", async () => {
    expect(estimateCostUsd("anthropic", 1_000_000, 0, "claude-sonnet-4-5-latest")).toBe(3);
    expect(estimateCostUsd("anthropic", 1_000_000, 0, "claude-opus-4-5@20251101")).toBe(5);
    expect(await ledgerCents("CLAUDE-OPUS-4-8")).toBe(3000);
  });
});

describe("an unknown Claude id: family rate, and flagged", () => {
  it("positive control: gets the anthropic family rate and one console.warn naming it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(estimateCostUsd("anthropic", 1_000_000, 1_000_000, "claude-opus-9-9")).toBe(12);
      expect(await ledgerCents("claude-opus-9-9")).toBe(1200);
      const flagged = warn.mock.calls.filter((c) => String(c[0]).includes("claude-opus-9-9"));
      expect(flagged).toHaveLength(1); // once per id, not once per call
      // a known id is never flagged
      estimateCostUsd("anthropic", 10, 10, "claude-opus-5");
      expect(warn.mock.calls.some((c) => String(c[0]).includes('"claude-opus-5"'))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it("an unknown Claude id is not priced by Langfuse at a wrong rate (no catch-all)", () => {
    const hits = LANGFUSE_MODEL_PRICES.filter((m) =>
      new RegExp(m.matchPattern.replace(/^\(\?i\)/, ""), "i").test("claude-opus-9-9"),
    );
    expect(hits).toEqual([]);
  });

  it("non-Claude ids on other providers keep their family rate", () => {
    expect(estimateCostUsd("gemini", 1_000_000, 0, "gemini-2.5-flash")).toBe(0.075);
    expect(estimateCostUsd("anthropic", 1_000_000, 1_000_000)).toBe(12);
  });
});

describe("Claude Sonnet 5 is priced at the standard $2/$10", () => {
  it("the anthropic family rate equals the registry default model's price", () => {
    expect(PROVIDERS_REGISTRY.anthropic.defaultModel).toBe("claude-sonnet-5");
    expect(PROVIDER_RATES_PER_1M_TOKENS.anthropic).toEqual(SONNET_5);
  });
});
