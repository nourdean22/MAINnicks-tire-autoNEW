/**
 * 2026-10-02 · thinking engine revival (/api/cron/think).
 *
 * The engine's writing layers lost their only scheduled caller in the
 * 2026-05-28 prune. Reviving them nightly creates two new risks this file pins:
 *   1. the contradiction detector restating the same open claim every night;
 *   2. the route falling out of the evening fan-out, or being retried there.
 * Plus the causal-chain reader's age window, which keeps a future freeze from
 * feeding stale chains into the shop brief.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  aiChat: vi.fn(),
  contradictionFindMany: vi.fn(),
  contradictionCreate: vi.fn(),
  causalChainFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contradiction: { findMany: mocks.contradictionFindMany, create: mocks.contradictionCreate },
    commitment: { findMany: vi.fn().mockResolvedValue([]) },
    brainDump: { findMany: vi.fn().mockResolvedValue([]) },
    brainMemory: { findMany: vi.fn().mockResolvedValue([]) },
    prediction: { findMany: vi.fn().mockResolvedValue([]) },
    causalChain: { findMany: mocks.causalChainFindMany },
  },
}));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => mocks.aiChat }));
vi.mock("@/lib/brain/legacy-shims", () => ({
  recentScoreSnapshots: vi.fn().mockResolvedValue([]),
  recentDailyHabits: vi.fn().mockResolvedValue([]),
  recentShopJobs: vi.fn().mockResolvedValue([]),
  recentShopLeads: vi.fn().mockResolvedValue([]),
  recentShopQuotes: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/nickstire/query", () => ({ queryNick: vi.fn(), queryNickBatch: vi.fn() }));

import { detectContradictions, normalizeClaim } from "@/lib/brain/thinking-engine";
import { generateShopIntelligence } from "@/lib/brain/pipeline-controller";
import { EVENING_JOBS } from "@/lib/inngest/jobs";
import { DETACHED_CHILDREN } from "@/lib/inngest/functions/mega-fanout";
import { CRONS } from "@/config/crons";

const row = (claim: string) => ({
  claim, reality: "r", gap: "g", severity: "moderate", category: "habit",
});

describe("detectContradictions · nightly runs do not restate open claims", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.contradictionCreate.mockResolvedValue({});
  });

  it("skips a claim already open in the window (case/punctuation-insensitive)", async () => {
    mocks.contradictionFindMany.mockResolvedValue([{ claim: "I'm disciplined." }]);
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify([row("i'm   DISCIPLINED"), row("I follow up on every lead")]),
    });
    await expect(detectContradictions()).resolves.toEqual({ found: 1 });
    expect(mocks.contradictionCreate).toHaveBeenCalledTimes(1);
    expect(mocks.contradictionCreate.mock.calls[0][0].data.claim).toBe("I follow up on every lead");
  });

  it("collapses a claim the model repeats within one run", async () => {
    mocks.contradictionFindMany.mockResolvedValue([]);
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify([row("Exercise is my priority"), row("exercise is my priority!")]),
    });
    await expect(detectContradictions()).resolves.toEqual({ found: 1 });
  });

  it("PLANTED POSITIVE · new claims with nothing open are all written", async () => {
    mocks.contradictionFindMany.mockResolvedValue([]);
    mocks.aiChat.mockResolvedValue({ content: JSON.stringify([row("a"), row("b")]) });
    await expect(detectContradictions()).resolves.toEqual({ found: 2 });
    expect(mocks.contradictionCreate).toHaveBeenCalledTimes(2);
  });

  it("normalizeClaim ignores case, whitespace and punctuation only", () => {
    expect(normalizeClaim("  I'm  Disciplined!! ")).toBe(normalizeClaim("i m disciplined"));
    expect(normalizeClaim("I'm disciplined")).not.toBe(normalizeClaim("I'm not disciplined"));
  });
});

describe("generateShopIntelligence · causal chains are read inside an age window", () => {
  it("filters on lastSeen, so a frozen analyser cannot feed old chains as current", async () => {
    mocks.contradictionFindMany.mockResolvedValue([]);
    mocks.causalChainFindMany.mockResolvedValue([]);
    mocks.aiChat.mockResolvedValue({ content: "{}" });
    await generateShopIntelligence().catch(() => undefined);
    expect(mocks.causalChainFindMany).toHaveBeenCalledTimes(1);
    const where = mocks.causalChainFindMany.mock.calls[0][0].where;
    expect(where.broken).toBe(false);
    const ageMs = Date.now() - (where.lastSeen.gte as Date).getTime();
    expect(ageMs).toBeGreaterThan(29 * 86_400_000);
    expect(ageMs).toBeLessThan(31 * 86_400_000);
  });
});

describe("/api/cron/think wiring", () => {
  it("is in the evening fan-out, detached, and in the manifest as folded", () => {
    expect(EVENING_JOBS).toContain("/api/cron/think");
    expect(DETACHED_CHILDREN.has("/api/cron/think")).toBe(true);
    const entry = CRONS.find((c) => c.name === "think");
    expect(entry).toMatchObject({ mode: "folded", foldedInto: "mega-evening" });
  });
});
