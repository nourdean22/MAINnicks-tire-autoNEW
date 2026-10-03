/**
 * 2026-10-03 · the daily brief's narrative call must be BOUNDED per lane, so a
 * slow reason lane falls back inside the step budget instead of the step's
 * outer timer discarding the whole brief.
 *
 * Prod 2026-10-02 10:19:09Z: `brief_compose_failed_degrading: compose timed out
 * after 90s`. The bare generateText(getModel("reason")) carried no abort signal,
 * so it could outlive any budget; the outer race won and the deterministic
 * blocks went with the narrative. These tests drive composeDailyExecutiveBrief
 * with a reason lane that hangs until aborted — the exact prod shape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const gen = vi.fn();

vi.mock("ai", () => ({ generateText: (args: unknown) => gen(args) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: (lane: string) => ({ lane }) }));
vi.mock("@/lib/observability/langfuse", () => ({ langfuseTelemetry: () => undefined }));
vi.mock("@/lib/brain/task-signals", () => ({ gatherTaskSignals: async () => null }));
vi.mock("@/lib/brain/attention-tracker", () => ({
  analyzeAttentionPatterns: async () => ({ neglectedDomains: [] }),
}));
vi.mock("@/lib/brain/page-intelligence", () => ({
  analyzePagePatterns: async () => {
    throw new Error("not under test");
  },
}));
vi.mock("@/lib/personal/energy-router", () => ({
  buildEnergyProfile: async () => {
    throw new Error("not under test");
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    opportunityLog: { findMany: async () => [] },
    socialPublishQueue: { findMany: async () => [] },
    intelligenceClaim: { findMany: async () => [] },
    registeredSource: { findFirst: async () => null },
    $queryRaw: async () => [],
  },
}));

import {
  composeDailyExecutiveBrief,
  REASON_ATTEMPT_MS,
  FAST_ATTEMPT_MS,
  COMPOSE_STEP_TIMEOUT_MS,
} from "@/lib/intelligence/compose-daily-brief";

/** A provider call that never answers — it only ends when its signal aborts. */
function hangUntilAborted(args: { abortSignal?: AbortSignal }) {
  return new Promise((_, reject) => {
    args.abortSignal?.addEventListener("abort", () => reject(new Error("aborted")));
  });
}

async function composeWithin(ms: number) {
  const settled = composeDailyExecutiveBrief().then(
    (v) => ({ done: true as const, v }),
    (e: unknown) => ({ done: true as const, e }),
  );
  const pending = new Promise<{ done: false }>((r) => setTimeout(() => r({ done: false }), ms));
  const out = Promise.race([settled, pending]);
  await vi.advanceTimersByTimeAsync(ms);
  return out;
}

describe("composeDailyExecutiveBrief · bounded narrative lanes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    gen.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("budgets nest: both lane attempts fit inside the step backstop with gather headroom", () => {
    expect(REASON_ATTEMPT_MS + FAST_ATTEMPT_MS).toBeLessThan(COMPOSE_STEP_TIMEOUT_MS);
    expect(COMPOSE_STEP_TIMEOUT_MS - (REASON_ATTEMPT_MS + FAST_ATTEMPT_MS)).toBeGreaterThanOrEqual(10_000);
  });

  it("a hung reason lane is aborted and the fast lane's narrative ships — inside the step budget", async () => {
    gen.mockImplementation((args: { model: { lane: string }; abortSignal?: AbortSignal }) =>
      args.model.lane === "reason"
        ? hangUntilAborted(args)
        : Promise.resolve({ text: "FAST LANE NARRATIVE" }),
    );

    const out = await composeWithin(COMPOSE_STEP_TIMEOUT_MS - 1);

    expect(out.done).toBe(true);
    if (out.done && "v" in out) {
      expect(out.v.text).toContain("# Daily Executive Brief V2");
      expect(out.v.text).toContain("FAST LANE NARRATIVE");
    } else {
      throw new Error("compose rejected");
    }
    const lanes = gen.mock.calls.map((c) => (c[0] as { model: { lane: string } }).model.lane);
    expect(lanes).toEqual(["reason", "fast"]);
    // The reason call was CANCELLED, not orphaned.
    const reasonSignal = (gen.mock.calls[0]![0] as { abortSignal?: AbortSignal }).abortSignal;
    expect(reasonSignal?.aborted).toBe(true);
  });

  it("both lanes hung: the deterministic blocks survive, narrative marked unavailable, inside the budget", async () => {
    gen.mockImplementation((args: { abortSignal?: AbortSignal }) => hangUntilAborted(args));

    const out = await composeWithin(COMPOSE_STEP_TIMEOUT_MS - 1);

    expect(out.done).toBe(true);
    if (out.done && "v" in out) {
      expect(out.v.text).toContain("# Daily Executive Brief V2");
      expect(out.v.text).toContain("Narrative unavailable");
    } else {
      throw new Error("compose rejected");
    }
  });

  it("a healthy reason lane is used as-is and the fast lane is never called", async () => {
    gen.mockResolvedValue({ text: "REASON NARRATIVE" });

    const out = await composeWithin(1_000);

    expect(out.done).toBe(true);
    if (out.done && "v" in out) expect(out.v.text).toContain("REASON NARRATIVE");
    expect(gen).toHaveBeenCalledTimes(1);
  });
});
