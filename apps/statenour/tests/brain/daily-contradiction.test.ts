/**
 * One open contradiction asked a day (2026-10-23, NICK_DAILY_CONTRADICTION).
 *
 * On the first chat turn of an America/New_York day with no claim-gap hit,
 * Nick asks the oldest open table row (most severe first) as one question with
 * three answers. The day key is the claim, so it never fires twice. The real
 * `today()` runs here under a frozen clock, so the ET day is pinned whatever
 * zone the machine is in. Fixtures are made up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contradiction: { findMany: vi.fn() },
    brainMemory: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("@/lib/ai/provider", () => ({ getEmbedding: vi.fn(), getEmbeddingWithModel: vi.fn() }));

import { prisma } from "@/lib/prisma";
import {
  pickDailyContradiction,
  findDailyContradiction,
  claimDailyContradiction,
  buildDailyContradictionBlock,
  buildClaimGapBlock,
} from "@/lib/brain/contradiction-injector";

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "d1",
    date: "2026-10-10",
    claim: "I read before bed every night",
    reality: "The reading log is empty for 12 days",
    gap: "Stated nightly, logged never",
    category: "habit",
    severity: "moderate",
    createdAt: new Date("2026-10-10T15:00:00Z"),
    ...overrides,
  };
}

// 02:30 UTC on Oct 23 is 22:30 ET on Oct 22: a UTC day key would say the 23rd.
const LATE_EVENING_ET = new Date("2026-10-23T02:30:00Z");

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(LATE_EVENING_ET);
  mock(prisma.brainMemory.findFirst).mockResolvedValue(null);
  mock(prisma.brainMemory.create).mockResolvedValue({ id: "log" });
});
afterEach(() => vi.useRealTimers());

describe("pickDailyContradiction", () => {
  it("most severe first, then oldest", () => {
    const rows = [
      row({ id: "new-mild", severity: "mild", createdAt: new Date("2026-10-01T00:00:00Z") }),
      row({ id: "new-critical", severity: "critical", createdAt: new Date("2026-10-20T00:00:00Z") }),
      row({ id: "old-critical", severity: "critical", createdAt: new Date("2026-10-05T00:00:00Z") }),
      row({ id: "severe", severity: "severe", createdAt: new Date("2026-09-30T00:00:00Z") }),
    ];
    expect(pickDailyContradiction(rows)?.id).toBe("old-critical");
    expect(pickDailyContradiction(rows.filter((r) => r.severity !== "critical"))?.id).toBe("severe");
  });

  it("an empty list picks nothing", () => {
    expect(pickDailyContradiction([])).toBeNull();
  });
});

describe("findDailyContradiction", () => {
  it("reads open rows only and returns the pick", async () => {
    mock(prisma.contradiction.findMany).mockResolvedValue([row()]);
    const hit = await findDailyContradiction();
    expect(hit?.id).toBe("d1");
    const where = mock(prisma.contradiction.findMany).mock.calls[0][0].where;
    expect(where.resolved).toBe(false);
    expect(where.deletedAt).toBeNull();
    expect(prisma.brainMemory.create).not.toHaveBeenCalled();
  });

  it("returns null when today's daily question OR today's claim gap was already used (ET day)", async () => {
    mock(prisma.brainMemory.findFirst).mockResolvedValue({ id: "claimed" });
    mock(prisma.contradiction.findMany).mockResolvedValue([row()]);
    expect(await findDailyContradiction()).toBeNull();
    const keys = mock(prisma.brainMemory.findFirst).mock.calls[0][0].where.key.in as string[];
    expect(keys).toContain("claim-gap-daily:2026-10-22");
    expect(keys).toContain("claim-gap:2026-10-22");
  });

  it("a failed read returns null and never throws", async () => {
    mock(prisma.contradiction.findMany).mockRejectedValue(new Error("connection reset"));
    expect(await findDailyContradiction()).toBeNull();
  });
});

describe("claimDailyContradiction · once a day", () => {
  it("claims the ET day key; a second claim the same day loses (P2002)", async () => {
    expect(await claimDailyContradiction(row(), "conv_1")).toBe(true);
    const data = mock(prisma.brainMemory.create).mock.calls[0][0].data;
    expect(data.key).toBe("claim-gap-daily:2026-10-22");
    expect(JSON.parse(data.content).contradictionId).toBe("d1");

    mock(prisma.brainMemory.create).mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    expect(await claimDailyContradiction(row(), "conv_2")).toBe(false);
  });

  it("any other failed write fails closed", async () => {
    mock(prisma.brainMemory.create).mockRejectedValue(new Error("connection reset"));
    expect(await claimDailyContradiction(row(), "conv_1")).toBe(false);
  });
});

describe("the blocks offer the three answers and the resolve path", () => {
  it("the daily block asks ONE question with the three answers and names the tbl key", () => {
    const block = buildDailyContradictionBlock(row(), "2026-10-22");
    expect(block).toContain("The reading log is empty");
    expect(block).toMatch(/record is right/i);
    expect(block).toMatch(/outdated/i);
    expect(block).toMatch(/ignore/i);
    expect(block).toContain('contradictionKey "tbl:d1"');
    expect(block).toContain("resolveContradiction");
  });

  it("the claim-gap block's closing line offers the same three answers and the tbl key", () => {
    const block = buildClaimGapBlock({ ...row(), similarity: 0.6 }, "2026-10-22");
    expect(block).toMatch(/record is right/i);
    expect(block).toMatch(/outdated/i);
    expect(block).toMatch(/ignore/i);
    expect(block).toContain('contradictionKey "tbl:d1"');
  });
});
