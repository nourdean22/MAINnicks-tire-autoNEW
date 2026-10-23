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
    contradiction: { findMany: vi.fn(), findFirst: vi.fn() },
    brainMemory: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/ai/provider", () => ({ getEmbedding: vi.fn(), getEmbeddingWithModel: vi.fn() }));

import { prisma } from "@/lib/prisma";
import {
  pickDailyContradiction,
  findDailyContradiction,
  claimDailyContradiction,
  claimClaimGapDay,
  findClaimedContradictionFollowUp,
  buildContradictionFollowUpBlock,
  markContradictionAsked,
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
    claimSource: "ai_detected",
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
  mock(prisma.brainMemory.findUnique).mockResolvedValue(null);
  mock(prisma.brainMemory.findMany).mockResolvedValue([]);
  mock(prisma.brainMemory.create).mockResolvedValue({ id: "log" });
  mock(prisma.brainMemory.updateMany).mockResolvedValue({ count: 0 });
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

  it("returns null when today's one claim (daily question OR claim gap) is taken (ET day)", async () => {
    mock(prisma.brainMemory.findUnique).mockResolvedValue({ id: "claimed", content: JSON.stringify({ state: "asked" }), lastSeen: new Date() });
    mock(prisma.contradiction.findMany).mockResolvedValue([row()]);
    expect(await findDailyContradiction()).toBeNull();
    const where = mock(prisma.brainMemory.findUnique).mock.calls[0][0].where;
    expect(where.category_key.key).toBe("claim-gap:2026-10-22");
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
    expect(data.key).toBe("claim-gap:2026-10-22");
    // A RESERVATION, not a receipt: nothing has been asked until the reply is persisted.
    expect(JSON.parse(data.content)).toMatchObject({ contradictionId: "d1", kind: "daily", conversationId: "conv_1", state: "reserved" });

    mock(prisma.brainMemory.create).mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    expect(await claimDailyContradiction(row(), "conv_2")).toBe(false);
  });

  it("RACE · the claim gap and the daily question share ONE unique day key: the second claim loses", async () => {
    // A unique index, as the database has on (category, key).
    const taken = new Set<string>();
    mock(prisma.brainMemory.create).mockImplementation(async ({ data }: { data: { key: string } }) => {
      if (taken.has(data.key)) throw Object.assign(new Error("dup"), { code: "P2002" });
      taken.add(data.key);
      return { id: data.key };
    });
    expect(await claimClaimGapDay({ ...row(), similarity: 0.6 }, "conv_1")).toBe(true);
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

  it("an AI-inferred claim is never quoted as his words; a chat claim is", () => {
    for (const block of [
      buildDailyContradictionBlock(row(), "2026-10-22"),
      buildClaimGapBlock({ ...row(), similarity: 0.6 }, "2026-10-22"),
      buildContradictionFollowUpBlock(row()),
    ]) {
      expect(block).not.toContain("He said");
      expect(block).toMatch(/inferred/i);
    }
    expect(buildDailyContradictionBlock(row({ claimSource: "chat" }), "2026-10-22")).toContain("He said");
  });

  it("the claim-gap block's closing line offers the same three answers and the tbl key", () => {
    const block = buildClaimGapBlock({ ...row(), similarity: 0.6 }, "2026-10-22");
    expect(block).toMatch(/record is right/i);
    expect(block).toMatch(/outdated/i);
    expect(block).toMatch(/ignore/i);
    expect(block).toContain('contradictionKey "tbl:d1"');
  });
});

describe("the asked row stays answerable on later turns (Codex P1 + round 2)", () => {
  const claim = (key: string, conversationId: string, state = "asked", contradictionId = "d1") => ({
    key,
    content: JSON.stringify({ contradictionId, conversationId, kind: "daily", state }),
    lastSeen: new Date(),
  });

  it("the same conversation gets its asked row back while it is open", async () => {
    mock(prisma.brainMemory.findMany).mockResolvedValue([claim("claim-gap:2026-10-22", "conv_1")]);
    mock(prisma.contradiction.findFirst).mockResolvedValue(row());
    const hit = await findClaimedContradictionFollowUp("conv_1");
    expect(hit?.id).toBe("d1");
    const where = mock(prisma.contradiction.findFirst).mock.calls[0][0].where;
    expect(where).toMatchObject({ id: "d1", resolved: false, deletedAt: null });
  });

  it("DAY ROLLOVER · yesterday's ask in this conversation, with another conversation holding today", async () => {
    // The frozen clock's ET day is 2026-10-22: today belongs to conv_2, conv_1 asked on the 21st.
    mock(prisma.brainMemory.findMany).mockResolvedValue([
      claim("claim-gap:2026-10-22", "conv_2", "asked", "d2"),
      claim("claim-gap:2026-10-21", "conv_1", "asked", "d1"),
    ]);
    mock(prisma.contradiction.findFirst).mockResolvedValue(row());
    expect((await findClaimedContradictionFollowUp("conv_1"))?.id).toBe("d1");
    expect(mock(prisma.contradiction.findFirst).mock.calls[0][0].where.id).toBe("d1");
    // Only live claims are read.
    expect(mock(prisma.brainMemory.findMany).mock.calls[0][0].where.expiresAt).toBeDefined();
  });

  it("a RESERVATION that was never delivered is not 'asked earlier'", async () => {
    mock(prisma.brainMemory.findMany).mockResolvedValue([claim("claim-gap:2026-10-22", "conv_1", "reserved")]);
    mock(prisma.contradiction.findFirst).mockResolvedValue(row());
    expect(await findClaimedContradictionFollowUp("conv_1")).toBeNull();
  });

  it("another conversation, a resolved row, no claim or no conversation: nothing", async () => {
    mock(prisma.brainMemory.findMany).mockResolvedValue([claim("claim-gap:2026-10-22", "conv_1")]);
    mock(prisma.contradiction.findFirst).mockResolvedValue(row());
    expect(await findClaimedContradictionFollowUp("conv_2")).toBeNull();
    expect(await findClaimedContradictionFollowUp(null)).toBeNull();
    mock(prisma.contradiction.findFirst).mockResolvedValue(null); // a resolved row fails the where
    expect(await findClaimedContradictionFollowUp("conv_1")).toBeNull();
    mock(prisma.brainMemory.findMany).mockResolvedValue([]);
    expect(await findClaimedContradictionFollowUp("conv_1")).toBeNull();
  });

  it("a failed read returns null and never throws", async () => {
    mock(prisma.brainMemory.findMany).mockRejectedValue(new Error("connection reset"));
    expect(await findClaimedContradictionFollowUp("conv_1")).toBeNull();
  });

  it("the follow-up block is resolution-only: the key, the three answers, no new question", () => {
    const block = buildContradictionFollowUpBlock(row());
    expect(block).toContain('contradictionKey "tbl:d1"');
    expect(block).toContain("resolveContradiction");
    expect(block).toMatch(/do not ask (it )?again/i);
  });
});

describe("the day is spent on DELIVERY, not on the attempt (Codex round 2)", () => {
  const CLAIM = { key: "claim-gap:2026-10-22", contradictionId: "d1", kind: "daily" as const };
  const reserved = JSON.stringify({ kind: "daily", state: "reserved", contradictionId: "d1", conversationId: "conv_1" });

  it("a persisted reply that asks promotes the reservation to asked, CAS on the exact content", async () => {
    mock(prisma.brainMemory.findUnique).mockResolvedValue({ content: reserved, lastSeen: new Date() });
    mock(prisma.brainMemory.updateMany).mockResolvedValue({ count: 1 });

    expect(await markContradictionAsked(CLAIM, "msg_1", "Done. One thing: is the reading log right, or is that claim outdated?")).toBe(true);
    const arg = mock(prisma.brainMemory.updateMany).mock.calls[0][0];
    expect(arg.where).toMatchObject({ key: "claim-gap:2026-10-22", content: reserved });
    expect(JSON.parse(arg.data.content)).toMatchObject({ state: "asked", messageId: "msg_1", contradictionId: "d1" });
  });

  it("a reply with no question leaves the reservation unpromoted", async () => {
    mock(prisma.brainMemory.findUnique).mockResolvedValue({ content: reserved, lastSeen: new Date() });
    expect(await markContradictionAsked(CLAIM, "msg_1", "Start with the brake job, then the two oil changes.")).toBe(false);
    expect(prisma.brainMemory.updateMany).not.toHaveBeenCalled();
  });

  it("a claim that now belongs to another row is not promoted", async () => {
    mock(prisma.brainMemory.findUnique).mockResolvedValue({
      content: JSON.stringify({ kind: "daily", state: "reserved", contradictionId: "other" }),
      lastSeen: new Date(),
    });
    expect(await markContradictionAsked(CLAIM, "msg_1", "Is that right?")).toBe(false);
    expect(prisma.brainMemory.updateMany).not.toHaveBeenCalled();
  });

  it("a FRESH reservation holds the day; a STALE one (failed or cancelled turn) frees it", async () => {
    mock(prisma.contradiction.findMany).mockResolvedValue([row()]);
    mock(prisma.brainMemory.findUnique).mockResolvedValue({ content: reserved, lastSeen: new Date() });
    expect(await findDailyContradiction()).toBeNull();
    mock(prisma.brainMemory.findUnique).mockResolvedValue({ content: reserved, lastSeen: new Date(Date.now() - 60 * 60_000) });
    expect((await findDailyContradiction())?.id).toBe("d1");
  });

  it("claiming over a STALE reservation is a compare-and-swap that takes it over", async () => {
    mock(prisma.brainMemory.create).mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    mock(prisma.brainMemory.updateMany).mockResolvedValue({ count: 1 });
    expect(await claimDailyContradiction(row(), "conv_1")).toBe(true);
    const where = mock(prisma.brainMemory.updateMany).mock.calls[0][0].where;
    expect(where.key).toBe("claim-gap:2026-10-22");
    expect(where.content).toMatchObject({ contains: '"state":"reserved"' });
    expect(where.lastSeen.lt).toBeInstanceOf(Date);

    mock(prisma.brainMemory.updateMany).mockResolvedValue({ count: 0 }); // fresh or asked: the takeover loses
    expect(await claimDailyContradiction(row(), "conv_1")).toBe(false);
  });
});
