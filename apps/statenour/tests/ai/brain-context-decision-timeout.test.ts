/**
 * tests/ai/brain-context-decision-timeout.test.ts · brain W3 round 3 (2026-10-17)
 *
 * A decision turn slower than the 3 s brain-context budget must not hang the
 * turn: no block, contextBlocksFired.decisionTimeout = true, and an info log.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const generic = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    upsert: vi.fn().mockResolvedValue({}),
    groupBy: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn().mockResolvedValue({}),
  });
  const prisma = new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop === "$queryRaw" || prop === "$queryRawUnsafe"
          ? () => Promise.resolve([])
          : prop === "$transaction"
            ? (fns: unknown) => Promise.resolve(fns)
            : generic(),
    },
  );
  return { prisma };
});
vi.mock("@/lib/brain/embedding-utils", () => ({
  getEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  semanticSearch: vi.fn().mockResolvedValue([]),
  cosineSimilarity: () => 0,
  storeGenericEmbedding: vi.fn(),
}));
vi.mock("@/lib/feature-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feature-flags")>();
  return { ...actual, getFlag: (key: string) => ({ key, isOn: false }) };
});
// The decision turn never answers inside the budget.
vi.mock("@/lib/brain/decision-forecast", () => ({
  runDecisionTurn: () =>
    new Promise((resolve) => setTimeout(() => resolve({ block: "## DECISION MODE: late", fired: { decisionAsk: true } }), 3_400)),
}));

import { buildBrainContext } from "@/lib/services/chat/brain-context";

describe("brain-context · decision turn timeout", () => {
  it("past 3 s: no block, decisionTimeout flagged, info logged", async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const out = await buildBrainContext({
      userContent: "Should I hire Zach full time or keep him hybrid?",
      mode: "standard" as never,
      userEmbedding: [],
      forceRecall: false,
      messages: [],
      convId: "conv_slow",
      log: log as never,
    });
    expect(out.systemPromptAddendum).not.toContain("DECISION MODE");
    expect(out.contextBlocksFired.decisionTimeout).toBe(true);
    expect(out.contextBlocksFired.decisionAsk).toBeFalsy();
    expect(log.info).toHaveBeenCalledWith("decision_turn_timeout", { ms: 3000 });
  }, 10_000);
});
