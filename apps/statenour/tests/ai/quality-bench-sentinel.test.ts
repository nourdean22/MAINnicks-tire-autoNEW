/**
 * Audit 2026-10-10 06-F7: the weekly quality bench counted a provider throw
 * as a FAILED prompt, so an outage dropped pass_rate and fired the "Model,
 * system prompt, or sanitizer drifted" alert. A provider throw (or an empty
 * completion, generateText's equivalent of the aiChat sentinel) is `errored`:
 * excluded from pass_rate, never a drift alert. The model id rides the metric.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  generateText: vi.fn(),
  metricFindFirst: vi.fn(),
  metricCreate: vi.fn(),
  coach: vi.fn(),
  telegram: vi.fn(),
  buildSystemPrompt: vi.fn(),
  density: vi.fn(),
  realDensity: null as null | ((t: string) => number),
}));

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: (...a: unknown[]) => h.generateText(...a),
}));
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  getModel: () => ({ modelId: "deepseek-v4-flash:0731" }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemMetric: { findFirst: h.metricFindFirst, create: h.metricCreate },
    aiGeneration: { groupBy: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/lib/inngest/client", () => ({
  getInngest: () => ({ createFunction: (_cfg: unknown, handler: unknown) => ({ handler }) }),
}));
vi.mock("@/lib/inngest/on-failure", () => ({ onInngestFailure: vi.fn() }));
vi.mock("@/lib/services/coach-events", () => ({ recordCoachEvent: (...a: unknown[]) => h.coach(...a) }));
vi.mock("@/lib/services/telegram", () => ({
  sendTelegram: (...a: unknown[]) => h.telegram(...a),
  formatTelegramNotification: (t: string) => t,
}));
vi.mock("@/lib/ai/system-prompt", () => ({
  buildSystemPromptUncached: (...a: unknown[]) => h.buildSystemPrompt(...a),
  detectTopicTier: () => "business",
}));
vi.mock("@/lib/ai/nour-voice-profile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/nour-voice-profile")>();
  h.realDensity = actual.specificityDensity;
  return { ...actual, specificityDensity: (t: string) => h.density(t) };
});

import { goldSetHash, runPrompt, runQualityBench } from "@/lib/ai/evals/quality-bench-core";
import { qualityBenchWeekly, classifyBenchOutcome } from "@/lib/inngest/functions/quality-bench";
import { QUALITY_PROMPTS } from "@/tests/fixtures/quality-prompts.gold";

const step = { run: (_id: string, fn: () => unknown) => fn() };
const runWeekly = () =>
  (qualityBenchWeekly as unknown as { handler: (ctx: unknown) => Promise<Record<string, unknown>> }).handler({ step });

beforeEach(() => {
  h.generateText.mockReset();
  h.metricFindFirst.mockReset().mockResolvedValue({ value: 0.875, createdAt: new Date("2026-10-03T13:00:00Z") });
  h.metricCreate.mockReset().mockResolvedValue({});
  h.coach.mockReset().mockResolvedValue(undefined);
  h.telegram.mockReset().mockResolvedValue(undefined);
  h.buildSystemPrompt.mockReset().mockResolvedValue("SYS");
  h.density.mockReset().mockImplementation((t: string) => h.realDensity!(t));
});

describe("quality bench core - provider failure is errored, not failed", () => {
  it("a provider throw is errored and never counted as a failed prompt", async () => {
    h.generateText.mockRejectedValue(new Error("fetch failed"));
    const bench = await runQualityBench(QUALITY_PROMPTS.slice(0, 2));
    expect(bench.errored).toBe(2);
    expect(bench.failed).toBe(0);
    expect(bench.failedIds).toEqual([]);
    expect(bench.results.every((r) => r.errored === true)).toBe(true);
  });

  it("an empty completion is errored too", async () => {
    h.generateText.mockResolvedValue({ text: "" });
    const bench = await runQualityBench(QUALITY_PROMPTS.slice(0, 1));
    expect(bench.errored).toBe(1);
    expect(bench.failed).toBe(0);
  });

  it("records the model id the bench actually ran against", async () => {
    h.generateText.mockResolvedValue({ text: "Nick closed 3 estimates today for $2,400 at the Euclid shop." });
    const bench = await runQualityBench(QUALITY_PROMPTS.slice(0, 1));
    expect(bench.model).toBe("deepseek-v4-flash:0731");
  });
});

describe("quality bench weekly - outage never fires the drift alert", () => {
  it("all prompts errored: no alert, no confident pass_rate of 0", async () => {
    h.generateText.mockRejectedValue(new Error("fetch failed"));
    const res = await runWeekly();
    expect(h.coach).not.toHaveBeenCalled();
    expect(h.telegram).not.toHaveBeenCalled();
    expect(h.metricCreate).not.toHaveBeenCalled();
    expect(res.passRate).toBeNull();
  });

  it("control: a measured run writes pass_rate with the model id in its tags", async () => {
    h.generateText.mockResolvedValue({ text: "Nick closed 3 estimates today for $2,400 at the Euclid shop." });
    await runWeekly();
    expect(h.metricCreate).toHaveBeenCalledTimes(1);
    const { data } = h.metricCreate.mock.calls[0][0] as { data: { metric: string; tags: Record<string, unknown> } };
    expect(data.metric).toBe("quality_bench.pass_rate");
    expect(data.tags.model).toBe("deepseek-v4-flash:0731");
  });

  it("classifyBenchOutcome: nothing measured is its own state, never ok or alert", () => {
    expect(classifyBenchOutcome({ failed: 0, passRate: null, prevRate: 0.875 })).toBe("unmeasured");
  });
});

// Audit 2026-10-10 06-F7: the bench sent no system prompt, so it never tested
// production; a crash while checking counted as a failed prompt (a drift alert).
describe("quality bench - production system prompt", () => {
  it("runPrompt sends the production system prompt and records its length", async () => {
    h.generateText.mockResolvedValue({ text: "Nick closed 3 estimates today for $2,400 at the Euclid shop." });
    const r = await runPrompt(QUALITY_PROMPTS[0], false);
    expect(h.generateText).toHaveBeenCalledWith(expect.objectContaining({ system: "SYS" }));
    expect(h.buildSystemPrompt).toHaveBeenCalledWith("business", QUALITY_PROMPTS[0].user);
    expect(r.systemPromptLength).toBe(3);
  });

  it("a crash while checking is errored, not failed", async () => {
    h.generateText.mockResolvedValue({ text: "Nick closed 3 estimates today for $2,400 at the Euclid shop." });
    h.density.mockImplementation(() => {
      throw new Error("density blew up");
    });
    const r = await runPrompt({ id: "x", description: "x", user: "u", checks: { minSpecificityMarkerDensity: 1 } }, false);
    expect(r.errored).toBe(true);
  });

  it("a system-prompt build failure is errored (no production prompt to test)", async () => {
    h.buildSystemPrompt.mockRejectedValue(new Error("brain db down"));
    const r = await runPrompt(QUALITY_PROMPTS[0], false);
    expect(r.errored).toBe(true);
    expect(h.generateText).not.toHaveBeenCalled();
  });
});

// Audit 2026-10-10 06-X3: a gold-set or model change made old and new pass
// rates incomparable, and the diff could raise a false REGRESSION.
describe("quality bench weekly - comparability", () => {
  const weak = { text: "ok" };
  const prevRow = (tags: Record<string, unknown>) => ({ value: 0.875, createdAt: new Date("2026-10-03T13:00:00Z"), tags });
  const titles = () => h.coach.mock.calls.map((c) => (c[0] as { title: string }).title);

  it("a previous row with a different goldHash raises no REGRESSION", async () => {
    h.generateText.mockResolvedValue(weak);
    h.metricFindFirst.mockResolvedValue(prevRow({ goldHash: "old-gold-set", model: "deepseek-v4-flash:0731" }));
    const res = await runWeekly();
    expect(res.prevRate).toBeNull();
    expect(res.regressed).toBe(false);
    expect(titles().some((t) => t.includes("REGRESSION"))).toBe(false);
  });

  it("a previous row from a different model raises no REGRESSION", async () => {
    h.generateText.mockResolvedValue(weak);
    h.metricFindFirst.mockResolvedValue(prevRow({ goldHash: goldSetHash(QUALITY_PROMPTS), model: "other-model" }));
    const res = await runWeekly();
    expect(res.regressed).toBe(false);
  });

  it("CONTROL: same gold set and model still raises REGRESSION on a drop", async () => {
    h.generateText.mockResolvedValue(weak);
    h.metricFindFirst.mockResolvedValue(prevRow({ goldHash: goldSetHash(QUALITY_PROMPTS), model: "deepseek-v4-flash:0731" }));
    const res = await runWeekly();
    expect(res.regressed).toBe(true);
    expect(titles().some((t) => t.includes("REGRESSION"))).toBe(true);
  });

  it("the written metric carries goldHash", async () => {
    h.generateText.mockResolvedValue({ text: "Nick closed 3 estimates today for $2,400 at the Euclid shop." });
    await runWeekly();
    const { data } = h.metricCreate.mock.calls[0][0] as { data: { tags: Record<string, unknown> } };
    expect(data.tags.goldHash).toBe(goldSetHash(QUALITY_PROMPTS));
  });

  it("goldSetHash sees a regex edit (JSON.stringify drops RegExp)", () => {
    const a = [{ id: "a", description: "d", user: "u", checks: { mustMention: [/foo/] } }];
    const b = [{ id: "a", description: "d", user: "u", checks: { mustMention: [/bar/] } }];
    expect(goldSetHash(a)).not.toBe(goldSetHash(b));
  });
});
