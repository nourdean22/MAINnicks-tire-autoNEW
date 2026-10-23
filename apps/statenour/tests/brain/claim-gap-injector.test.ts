/**
 * Claim vs record (2026-10-22, docs/research/2026-10-22-insight-engines-audit.md).
 *
 * The nightly thinking engine writes "he said X, the record shows Y" rows to
 * the `contradictions` table; until this reader nothing showed them to anyone
 * (555 of 555 closures were the 30-day auto-expiry). findRelevantClaimGap only
 * READS: at most one a day, only when it matches the turn, never the same topic
 * twice in a week. claimClaimGapDay spends the day, and fails closed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contradiction: { findMany: vi.fn() },
    brainMemory: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  },
}));

vi.mock("@/lib/ai/provider", () => ({ getEmbedding: vi.fn(), getEmbeddingWithModel: vi.fn() }));
vi.mock("@/lib/utils/datetime", () => ({ today: () => "2026-10-22" }));

import { prisma } from "@/lib/prisma";
import { getEmbeddingWithModel } from "@/lib/ai/provider";
import {
  findRelevantClaimGap,
  claimClaimGapDay,
  buildClaimGapBlock,
  CLAIM_GAP_THRESHOLD,
} from "@/lib/brain/contradiction-injector";

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

// Fresh id per row: the module caches candidate vectors by id across calls.
let seq = 0;
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: `c${++seq}`,
    date: "2026-10-20",
    claim: "I work 40 hours a week on the shop floor",
    reality: "The time log shows 22 hours this week",
    gap: "Stated 40 hours, logged 22",
    category: "commitment",
    createdAt: new Date("2026-10-21T03:00:00Z"),
    ...overrides,
  };
}

const ALIGNED = { vec: [1, 0, 0, 0], model: "m1" };
const ORTHOGONAL = { vec: [0, 1, 0, 0], model: "m1" };
const USER = "how many hours did I put in at the shop this week";

beforeEach(() => {
  vi.resetAllMocks();
  mock(prisma.brainMemory.findMany).mockResolvedValue([]);
  mock(prisma.brainMemory.create).mockResolvedValue({ id: "log" });
});

describe("findRelevantClaimGap", () => {
  it("returns the open row that matches the turn, and writes nothing", async () => {
    mock(prisma.contradiction.findMany).mockResolvedValue([row()]);
    mock(getEmbeddingWithModel).mockResolvedValue(ALIGNED);

    const hit = await findRelevantClaimGap({ userMessage: USER });

    expect(hit?.id).toMatch(/^c\d+$/);
    expect(hit?.reality).toContain("22 hours");
    expect(prisma.brainMemory.create).not.toHaveBeenCalled();
  });

  it("reads only open, undeleted rows", async () => {
    mock(prisma.contradiction.findMany).mockResolvedValue([]);
    await findRelevantClaimGap({ userMessage: USER });
    const where = mock(prisma.contradiction.findMany).mock.calls[0][0].where;
    expect(where.resolved).toBe(false);
    expect(where.deletedAt).toBeNull();
  });

  it("stays silent below the similarity bar", async () => {
    mock(prisma.contradiction.findMany).mockResolvedValue([row()]);
    mock(getEmbeddingWithModel).mockResolvedValueOnce(ALIGNED).mockResolvedValueOnce(ORTHOGONAL);

    expect(await findRelevantClaimGap({ userMessage: USER })).toBeNull();
  });

  it("surfaces at most one gap per day", async () => {
    mock(prisma.contradiction.findMany).mockResolvedValue([row()]);
    mock(prisma.brainMemory.findMany).mockResolvedValue([
      { key: "claim-gap:2026-10-22", content: JSON.stringify({ category: "habit" }) },
    ]);
    mock(getEmbeddingWithModel).mockResolvedValue(ALIGNED);

    expect(await findRelevantClaimGap({ userMessage: USER })).toBeNull();
  });

  it("stays silent on a day the daily question was already asked (one shared day key)", async () => {
    mock(prisma.contradiction.findMany).mockResolvedValue([row()]);
    mock(prisma.brainMemory.findMany).mockResolvedValue([
      { key: "claim-gap:2026-10-22", content: JSON.stringify({ category: "health", kind: "daily" }) },
    ]);
    mock(getEmbeddingWithModel).mockResolvedValue(ALIGNED);

    expect(await findRelevantClaimGap({ userMessage: USER })).toBeNull();
  });

  it("a FRESH reservation today holds the day too (a turn is asking right now)", async () => {
    mock(prisma.contradiction.findMany).mockResolvedValue([row()]);
    mock(prisma.brainMemory.findMany).mockResolvedValue([
      { key: "claim-gap:2026-10-22", content: JSON.stringify({ category: "habit", state: "reserved" }), lastSeen: new Date() },
    ]);
    mock(getEmbeddingWithModel).mockResolvedValue(ALIGNED);
    expect(await findRelevantClaimGap({ userMessage: USER })).toBeNull();
  });

  it("a reservation that was never delivered does NOT cool its topic down", async () => {
    mock(prisma.contradiction.findMany).mockResolvedValue([row()]); // category "commitment"
    mock(prisma.brainMemory.findMany).mockResolvedValue([
      { key: "claim-gap:2026-10-20", content: JSON.stringify({ category: "commitment", state: "reserved" }), lastSeen: new Date("2026-10-20T12:00:00Z") },
    ]);
    mock(getEmbeddingWithModel).mockResolvedValue(ALIGNED);
    expect(await findRelevantClaimGap({ userMessage: USER })).not.toBeNull();
  });

  it("skips a topic already raised in the last week", async () => {
    mock(prisma.contradiction.findMany).mockResolvedValue([row()]);
    mock(prisma.brainMemory.findMany).mockResolvedValue([
      { key: "claim-gap:2026-10-19", content: JSON.stringify({ category: "commitment" }) },
    ]);
    mock(getEmbeddingWithModel).mockResolvedValue(ALIGNED);

    expect(await findRelevantClaimGap({ userMessage: USER })).toBeNull();
  });

  it("applies the topic cooldown BEFORE the candidate cap", async () => {
    // 30 newest rows are a cooled topic; the 31st is a fresh topic and must still be scored.
    const cooled = Array.from({ length: 30 }, () => row({ category: "habit" }));
    const fresh = row({ category: "business" });
    mock(prisma.contradiction.findMany).mockResolvedValue([...cooled, fresh]);
    mock(prisma.brainMemory.findMany).mockResolvedValue([
      { key: "claim-gap:2026-10-19", content: JSON.stringify({ category: "habit" }) },
    ]);
    mock(getEmbeddingWithModel).mockResolvedValue(ALIGNED);

    expect((await findRelevantClaimGap({ userMessage: USER }))?.id).toBe(fresh.id);
  });

  it("embeds a row once, then reuses its vector on later turns", async () => {
    mock(prisma.contradiction.findMany).mockResolvedValue([row()]);
    mock(getEmbeddingWithModel).mockImplementation(async (text: string) => (text === USER ? ALIGNED : ORTHOGONAL));

    await findRelevantClaimGap({ userMessage: USER });
    await findRelevantClaimGap({ userMessage: USER });

    const candidateEmbeds = mock(getEmbeddingWithModel).mock.calls.filter(([t]) => t !== USER);
    expect(candidateEmbeds).toHaveLength(1);
  });

  it("never scores across two embedding spaces, and re-embeds when the model changes", async () => {
    const r = row();
    mock(prisma.contradiction.findMany).mockResolvedValue([r]);
    // Turn 1 in space m1 caches the candidate. Turn 2's message comes back from m2.
    mock(getEmbeddingWithModel).mockImplementation(async (text: string) => (text === USER ? ALIGNED : ALIGNED));
    expect(await findRelevantClaimGap({ userMessage: USER })).not.toBeNull();

    mock(getEmbeddingWithModel).mockClear();
    mock(getEmbeddingWithModel).mockImplementation(async (text: string) =>
      text === USER ? { vec: [1, 0, 0, 0], model: "m2" } : { vec: [1, 0, 0, 0], model: "m1" },
    );
    // The candidate re-embeds but still lands in m1: unscored, so nothing fires.
    expect(await findRelevantClaimGap({ userMessage: USER })).toBeNull();
    expect(mock(getEmbeddingWithModel).mock.calls.filter(([t]) => t !== USER)).toHaveLength(1);
  });

  it("returns null instead of throwing when the read fails", async () => {
    mock(prisma.contradiction.findMany).mockRejectedValue(new Error("neon down"));
    await expect(findRelevantClaimGap({ userMessage: USER })).resolves.toBeNull();
  });

  it("uses a bar this embedding space can actually clear", () => {
    // Measured 2026-10-22: best match of 250 chat turns vs analysis-style
    // memories was p95 0.482, max 0.576. A 0.7 bar (the pair injector's) never fires.
    expect(CLAIM_GAP_THRESHOLD).toBeGreaterThan(0.4);
    expect(CLAIM_GAP_THRESHOLD).toBeLessThan(0.576);
  });
});

describe("findRelevantClaimGap · cold cache", () => {
  it("keeps at most 4 candidate embeddings in flight at once", async () => {
    mock(prisma.contradiction.findMany).mockResolvedValue(Array.from({ length: 20 }, () => row()));
    let inFlight = 0;
    let peak = 0;
    mock(getEmbeddingWithModel).mockImplementation(async (text: string) => {
      if (text === USER) return ALIGNED;
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return ORTHOGONAL;
    });

    await findRelevantClaimGap({ userMessage: USER });

    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(4);
  });
});

describe("claimClaimGapDay", () => {
  const hit = { ...row(), similarity: 0.6 } as never;

  it("claims today's slot with the topic, so the weekly cooldown can read it", async () => {
    expect(await claimClaimGapDay(hit, "conv1")).toBe(true);
    const data = mock(prisma.brainMemory.create).mock.calls[0][0].data;
    expect(data.category).toBe("contradiction_injection_log");
    expect(data.key).toBe("claim-gap:2026-10-22");
    expect(JSON.parse(data.content).category).toBe("commitment");
  });

  it("loses the race quietly when another turn claimed the day first", async () => {
    mock(prisma.brainMemory.create).mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    expect(await claimClaimGapDay(hit)).toBe(false);
  });

  it("fails closed on any other write error, so the daily cap holds", async () => {
    mock(prisma.brainMemory.create).mockRejectedValue(new Error("connection reset"));
    expect(await claimClaimGapDay(hit)).toBe(false);
  });
});

describe("buildClaimGapBlock", () => {
  it("fences the row text, dates the record and tells Nick to answer first and ask record-or-plan", () => {
    const block = buildClaimGapBlock({ ...row(), similarity: 0.6 } as never, "2026-10-30");
    expect(block).toContain("# CLAIM VS RECORD");
    expect(block).toContain("22 hours");
    expect(block).toContain("Recorded 2026-10-20 (10 days ago)");
    expect(block).not.toMatch(/\[brain:contradiction/);
    expect(block).toMatch(/answer .*first/i);
    expect(block).toMatch(/record is wrong|record wrong/i);
    expect(block).toMatch(/<[^>]*memory_recall/);
  });
});

describe("buildClaimGapBlock · the record date is the ET day it was written", () => {
  it("a row written at 10 pm ET (03:00 UTC next day) keeps its ET date", () => {
    const lateNight = { ...row({ date: "2026-10-21", createdAt: new Date("2026-10-22T03:00:00Z") }), similarity: 0.6 };
    const block = buildClaimGapBlock(lateNight as never, "2026-10-22");
    expect(block).toContain("Recorded 2026-10-21 (1 day ago)");
  });
});
