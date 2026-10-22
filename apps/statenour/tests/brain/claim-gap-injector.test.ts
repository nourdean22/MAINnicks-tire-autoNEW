/**
 * Claim vs record (2026-10-22, docs/research/2026-10-22-insight-engines-audit.md).
 *
 * The nightly thinking engine writes "he said X, the record shows Y" rows to
 * the `contradictions` table; until this reader nothing showed them to anyone
 * (555 of 555 closures were the 30-day auto-expiry). findRelevantClaimGap
 * surfaces at most ONE per day, only when it matches the turn, and never the
 * same topic twice in a week. These tests pin each of those gates.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contradiction: { findMany: vi.fn() },
    brainMemory: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  },
}));

vi.mock("@/lib/ai/provider", () => ({ getEmbedding: vi.fn() }));
vi.mock("@/lib/utils/datetime", () => ({ today: () => "2026-10-22" }));

import { prisma } from "@/lib/prisma";
import { getEmbedding } from "@/lib/ai/provider";
import { findRelevantClaimGap, buildClaimGapBlock, CLAIM_GAP_THRESHOLD } from "@/lib/brain/contradiction-injector";

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

// Fresh id per row: the module caches candidate vectors by id across calls.
let seq = 0;
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: `c${++seq}`,
    claim: "I work 40 hours a week on the shop floor",
    reality: "The time log shows 22 hours this week",
    gap: "Stated 40 hours, logged 22",
    category: "commitment",
    createdAt: new Date("2026-10-21T03:00:00Z"),
    ...overrides,
  };
}

const ALIGNED = [1, 0, 0, 0];
const ORTHOGONAL = [0, 1, 0, 0];
const USER = "how many hours did I put in at the shop this week";

beforeEach(() => {
  vi.resetAllMocks();
  mock(prisma.brainMemory.findMany).mockResolvedValue([]);
  mock(prisma.brainMemory.create).mockResolvedValue({ id: "log" });
});

describe("findRelevantClaimGap", () => {
  it("returns the open row that matches the turn, and claims the day", async () => {
    mock(prisma.contradiction.findMany).mockResolvedValue([row()]);
    mock(getEmbedding).mockResolvedValue(ALIGNED);

    const hit = await findRelevantClaimGap({ userMessage: USER, conversationId: "conv1" });

    expect(hit?.id).toMatch(/^c\d+$/);
    expect(hit?.reality).toContain("22 hours");
    const created = mock(prisma.brainMemory.create).mock.calls[0][0].data;
    expect(created.category).toBe("contradiction_injection_log");
    expect(created.key).toBe("claim-gap:2026-10-22");
    expect(JSON.parse(created.content).category).toBe("commitment");
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
    mock(getEmbedding).mockResolvedValueOnce(ALIGNED).mockResolvedValueOnce(ORTHOGONAL);

    expect(await findRelevantClaimGap({ userMessage: USER })).toBeNull();
    expect(prisma.brainMemory.create).not.toHaveBeenCalled();
  });

  it("surfaces at most one gap per day", async () => {
    mock(prisma.contradiction.findMany).mockResolvedValue([row()]);
    mock(prisma.brainMemory.findMany).mockResolvedValue([
      { key: "claim-gap:2026-10-22", content: JSON.stringify({ category: "habit" }) },
    ]);
    mock(getEmbedding).mockResolvedValue(ALIGNED);

    expect(await findRelevantClaimGap({ userMessage: USER })).toBeNull();
  });

  it("skips a topic already raised in the last week", async () => {
    mock(prisma.contradiction.findMany).mockResolvedValue([row()]);
    mock(prisma.brainMemory.findMany).mockResolvedValue([
      { key: "claim-gap:2026-10-19", content: JSON.stringify({ category: "commitment" }) },
    ]);
    mock(getEmbedding).mockResolvedValue(ALIGNED);

    expect(await findRelevantClaimGap({ userMessage: USER })).toBeNull();
  });

  it("loses the race quietly when another turn claimed the day first", async () => {
    mock(prisma.contradiction.findMany).mockResolvedValue([row()]);
    mock(getEmbedding).mockResolvedValue(ALIGNED);
    mock(prisma.brainMemory.create).mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));

    expect(await findRelevantClaimGap({ userMessage: USER })).toBeNull();
  });

  it("reuses the turn embedding instead of embedding the message again", async () => {
    mock(prisma.contradiction.findMany).mockResolvedValue([row()]);
    mock(getEmbedding).mockResolvedValue(ALIGNED);

    await findRelevantClaimGap({ userMessage: USER, userEmbedding: ALIGNED });

    // one call: the candidate. The user message is never re-embedded.
    expect(getEmbedding).toHaveBeenCalledTimes(1);
  });

  it("embeds a row once, then reuses its vector on later turns", async () => {
    const r = row();
    mock(prisma.contradiction.findMany).mockResolvedValue([r]);
    mock(getEmbedding).mockResolvedValue(ORTHOGONAL); // below the bar, so the day is never claimed

    await findRelevantClaimGap({ userMessage: USER, userEmbedding: ALIGNED });
    await findRelevantClaimGap({ userMessage: USER, userEmbedding: ALIGNED });

    expect(getEmbedding).toHaveBeenCalledTimes(1);
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

describe("buildClaimGapBlock", () => {
  it("fences the row text and tells Nick to answer first and ask record-or-plan", () => {
    const block = buildClaimGapBlock({ ...row(), similarity: 0.6 } as never);
    expect(block).toContain("# CLAIM VS RECORD");
    expect(block).toContain("22 hours");
    expect(block).toMatch(/answer .*first/i);
    expect(block).toMatch(/record is wrong|record wrong/i);
    expect(block).toMatch(/<[^>]*memory_recall/);
  });
});
