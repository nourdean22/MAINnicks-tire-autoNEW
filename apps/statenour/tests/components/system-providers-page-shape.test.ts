/**
 * tests/components/system-providers-page-shape.test.ts
 *
 * Pure shape tests for the /system/providers derivation helper. Exercises
 * the pre-render data path: ProviderHealthSnapshot → matrix options +
 * cells. Does NOT render the page through React (the page leans on the
 * tRPC client + React Query provider tree · jsdom + mock-Next-app is more
 * surface than this slice warrants).
 *
 * Instead, we assert against the extracted pure helper
 * `derive-provider-matrix.ts`. If a future refactor moves the columns
 * around, this test pins the contract (4 providers × 5 criteria =
 * 20 cells · per-column scoring · tier informational).
 */

import { describe, it, expect } from "vitest";

import {
  PROVIDER_MATRIX_CRITERIA,
  PROVIDER_TIER,
  buildProviderMatrixOptions,
  resolveProviderMatrixCell,
  type ProviderMatrixOption,
} from "@/app/(mastery)/system/providers/derive-provider-matrix";
import type { ProviderHealthSnapshot } from "@/lib/ai/provider-health";

// ── Fixture · 4 providers · a mix of healthy + degraded states. ────────
const FIXTURE: ProviderHealthSnapshot = {
  generatedAt: "2026-05-23T12:00:00.000Z",
  overallTone: "amber",
  pillLabel: "fallback active",
  rateLimit: { activeKeys: 0, warm: true, buckets: [] },
  providers: [
    {
      name: "venice",
      configured: true,
      available: true,
      modelId: "venice-large",
      quotaExhausted: false,
      quotaCooldownRemainingMs: 0,
      toolsSupported: true,
      recentCalls: 100,
      recentErrors: 1,
      errorRate: 0.01,
      avgLatencyMs: 850,
    },
    {
      name: "ollama",
      configured: true,
      available: false,
      modelId: "qwen3-coder",
      quotaExhausted: true,
      quotaCooldownRemainingMs: 60_000,
      toolsSupported: true,
      recentCalls: 50,
      recentErrors: 8,
      errorRate: 0.16,
      avgLatencyMs: 1200,
    },
    {
      name: "openai",
      configured: true,
      available: true,
      modelId: "gpt-5",
      quotaExhausted: false,
      quotaCooldownRemainingMs: 0,
      toolsSupported: true,
      recentCalls: 10,
      recentErrors: 0,
      errorRate: 0,
      avgLatencyMs: 600,
    },
    {
      name: "anthropic",
      configured: true,
      available: true,
      modelId: "claude-sonnet-4.7",
      quotaExhausted: false,
      quotaCooldownRemainingMs: 0,
      toolsSupported: true,
      recentCalls: 5,
      recentErrors: 0,
      errorRate: 0,
      avgLatencyMs: 0, // ← silent · should resolve to null/—
    },
  ],
};

// ── Criteria contract ──────────────────────────────────────────────────

describe("/system/providers · criteria contract", () => {
  it("exposes exactly five criteria · matching the agent brief", () => {
    expect(PROVIDER_MATRIX_CRITERIA).toHaveLength(5);
    expect(PROVIDER_MATRIX_CRITERIA.map((c) => c.id)).toEqual([
      "status",
      "latency",
      "errors",
      "cooldown",
      "tier",
    ]);
  });

  it("flips lower-is-better on the three quantitative degraders", () => {
    const byId = Object.fromEntries(
      PROVIDER_MATRIX_CRITERIA.map((c) => [c.id, c]),
    );
    expect(byId.latency.higherIsBetter).toBe(false);
    expect(byId.errors.higherIsBetter).toBe(false);
    expect(byId.cooldown.higherIsBetter).toBe(false);
  });

  it("status uses higher-is-better (online > down via score)", () => {
    const status = PROVIDER_MATRIX_CRITERIA.find((c) => c.id === "status");
    expect(status?.higherIsBetter).toBe(true);
  });

  it("tier is informational (no higherIsBetter set · no scoring)", () => {
    const tier = PROVIDER_MATRIX_CRITERIA.find((c) => c.id === "tier");
    expect(tier?.higherIsBetter).toBeUndefined();
  });
});

// ── Tier map ───────────────────────────────────────────────────────────

describe("/system/providers · tier map", () => {
  it("classifies venice + ollama as primary lanes", () => {
    expect(PROVIDER_TIER.venice).toBe("primary");
    expect(PROVIDER_TIER.ollama).toBe("primary");
  });

  it("classifies openai + anthropic as fallback lanes", () => {
    expect(PROVIDER_TIER.openai).toBe("fallback");
    expect(PROVIDER_TIER.anthropic).toBe("fallback");
  });

  it("classifies emergency as its own tier", () => {
    expect(PROVIDER_TIER.emergency).toBe("emergency");
  });
});

// ── Option derivation ──────────────────────────────────────────────────

describe("/system/providers · option derivation", () => {
  it("emits one option per provider in the snapshot", () => {
    const options = buildProviderMatrixOptions(FIXTURE);
    expect(options).toHaveLength(4);
    expect(options.map((o) => o.id)).toEqual([
      "venice",
      "ollama",
      "openai",
      "anthropic",
    ]);
  });

  it("formats labels as 'Capitalized · modelId'", () => {
    const options = buildProviderMatrixOptions(FIXTURE);
    expect(options[0].label).toBe("Venice · venice-large");
    expect(options[1].label).toBe("Ollama · qwen3-coder");
    expect(options[2].label).toBe("Openai · gpt-5");
    expect(options[3].label).toBe("Anthropic · claude-sonnet-4.7");
  });

  it("tunnels the raw metrics onto each option for the cell resolver", () => {
    const [venice, ollama] = buildProviderMatrixOptions(FIXTURE);
    expect(venice._available).toBe(true);
    expect(venice._avgLatencyMs).toBe(850);
    expect(ollama._available).toBe(false);
    expect(ollama._quotaCooldownRemainingMs).toBe(60_000);
    expect(ollama._tier).toBe("primary");
  });
});

// ── Cell resolution ────────────────────────────────────────────────────

describe("/system/providers · cell resolution", () => {
  // We synthesize a single option once · then thread it through every
  // criterion. The 4 × 5 = 20 cell coverage check sits in its own test.
  const fixtureOption: ProviderMatrixOption = {
    id: "venice",
    label: "Venice · venice-large",
    _available: true,
    _modelId: "venice-large",
    _avgLatencyMs: 850,
    _recentErrors: 3,
    _quotaCooldownRemainingMs: 45_000,
    _tier: "primary",
  };

  it("status · online maps to score 1 · 'online' display", () => {
    const cell = resolveProviderMatrixCell(
      fixtureOption,
      PROVIDER_MATRIX_CRITERIA[0], // status
    );
    expect(cell.value).toBe("online");
    expect(cell.score).toBe(1);
    expect(cell.display).toBe("online");
  });

  it("status · down maps to score 0", () => {
    const cell = resolveProviderMatrixCell(
      { ...fixtureOption, _available: false },
      PROVIDER_MATRIX_CRITERIA[0],
    );
    expect(cell.value).toBe("down");
    expect(cell.score).toBe(0);
  });

  it("latency · positive value flows through unchanged", () => {
    const cell = resolveProviderMatrixCell(
      fixtureOption,
      PROVIDER_MATRIX_CRITERIA[1], // latency
    );
    expect(cell.value).toBe(850);
    expect(cell.score).toBe(850);
    expect(cell.display).toBe("850");
  });

  it("latency · zero means 'no calls in last hour' · renders null/—", () => {
    // Silent providers (no calls yet) shouldn't accidentally win the
    // latency column just by registering 0. Null-cell skips tinting.
    const cell = resolveProviderMatrixCell(
      { ...fixtureOption, _avgLatencyMs: 0 },
      PROVIDER_MATRIX_CRITERIA[1],
    );
    expect(cell.value).toBeNull();
    expect(cell.display).toBe("—");
  });

  it("errors · count flows through with its score", () => {
    const cell = resolveProviderMatrixCell(
      fixtureOption,
      PROVIDER_MATRIX_CRITERIA[2],
    );
    expect(cell.value).toBe(3);
    expect(cell.score).toBe(3);
  });

  it("cooldown · ms converts to seconds and rounds", () => {
    const cell = resolveProviderMatrixCell(
      fixtureOption,
      PROVIDER_MATRIX_CRITERIA[3],
    );
    expect(cell.value).toBe(45); // 45_000ms / 1000
    expect(cell.score).toBe(45);
    expect(cell.display).toBe("45");
  });

  it("tier · informational · NO score so the matrix tints neutral", () => {
    const cell = resolveProviderMatrixCell(
      fixtureOption,
      PROVIDER_MATRIX_CRITERIA[4],
    );
    expect(cell.value).toBe("primary");
    expect(cell.score).toBeUndefined();
    expect(cell.display).toBe("primary");
  });
});

// ── End-to-end shape ───────────────────────────────────────────────────

describe("/system/providers · 4 providers × 5 criteria = 20 cells", () => {
  it("produces a fully-populated grid · no exception on any combo", () => {
    const options = buildProviderMatrixOptions(FIXTURE);
    const cells: Array<{
      provider: string;
      criterion: string;
      value: unknown;
    }> = [];
    for (const opt of options) {
      for (const crit of PROVIDER_MATRIX_CRITERIA) {
        const cell = resolveProviderMatrixCell(opt, crit);
        cells.push({ provider: opt.id, criterion: crit.id, value: cell.value });
      }
    }
    expect(cells).toHaveLength(20);
    // No silent crashes · every cell got SOMETHING back (even if null).
    expect(cells.every((c) => c.value !== undefined)).toBe(true);
  });

  it("the silent anthropic latency row reports null (no calls)", () => {
    const options = buildProviderMatrixOptions(FIXTURE);
    const anthropic = options.find((o) => o.id === "anthropic")!;
    const latencyCriterion = PROVIDER_MATRIX_CRITERIA[1];
    const cell = resolveProviderMatrixCell(anthropic, latencyCriterion);
    expect(cell.value).toBeNull();
  });

  it("the down ollama row reports status=down + cooldown>0", () => {
    const options = buildProviderMatrixOptions(FIXTURE);
    const ollama = options.find((o) => o.id === "ollama")!;
    const statusCell = resolveProviderMatrixCell(
      ollama,
      PROVIDER_MATRIX_CRITERIA[0],
    );
    expect(statusCell.value).toBe("down");
    expect(statusCell.score).toBe(0);
    const cooldownCell = resolveProviderMatrixCell(
      ollama,
      PROVIDER_MATRIX_CRITERIA[3],
    );
    expect(cooldownCell.value).toBe(60); // 60_000ms → 60s
  });
});
