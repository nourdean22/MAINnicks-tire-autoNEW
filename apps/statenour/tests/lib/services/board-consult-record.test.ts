/**
 * tests/lib/services/board-consult-record.test.ts · 2026-09-02 self-audit.
 *
 * Three defects in the board's persistence + projection layer:
 *
 *  1. THE MOOD GATE LEFT NO RECORD. lib/ai/board/consult.ts drops up to 3
 *     of the strategic board's 5 advisors when mood=depleted and 4 when
 *     mood=scattered, and returns `droppedAdvisorIds` + `operatorState`.
 *     Neither was persisted, so a past consultation could not be
 *     re-inspected: a three-advisor row in history was indistinguishable
 *     from a three-advisor board.
 *  2. `advisorCount` WAS DOCUMENTED AS EXCLUDING ERRORED TAKES AND DID
 *     NOT. It was `arrLen(meta.takes)`. Nothing rendered it, so the wrong
 *     number was invisible — waiting to be inherited by the first
 *     consumer, with a doc comment vouching for it.
 *  3. ROWS THAT FAIL PROJECTION VANISHED WITHOUT A COUNT. A malformed row
 *     simply made the list shorter, which reads exactly like "you have
 *     consulted the board fewer times".
 *
 * `brainMemory.remember` and prisma are mocked; these are assertions about
 * what this module WRITES and what it PROJECTS, not about the database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  remember: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  consultBoard: vi.fn(),
  warn: vi.fn(),
  getRevenueStats: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: { findMany: h.findMany, findFirst: h.findFirst } },
}));
vi.mock("@/lib/brain/memory-manager", () => ({
  brainMemory: { remember: h.remember },
}));
vi.mock("@/lib/ai/board/consult", () => ({ consultBoard: h.consultBoard }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ warn: h.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
// The live-context builder reaches for the scoreboard; keep it inert so
// these tests measure persistence, not context assembly.
vi.mock("@/lib/services/meta-scoreboard", () => ({
  buildMetaScoreboard: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/services/business-intel", () => ({ getRevenueStats: h.getRevenueStats }));

import {
  buildBusinessContextBlock,
  consultBoardAndPersist,
  listRecentBoardConsultations,
} from "@/lib/services/board-consult-record";

const CREATED = new Date("2026-09-02T12:00:00Z");

function take(over: Record<string, unknown> = {}) {
  return {
    advisorId: "warren-buffett",
    advisorName: "Warren Buffett",
    lensOneLine: "moats first",
    keyInsight: "durability beats speed here",
    recommendation: "hold the price",
    confidence: 0.7,
    divergenceFlag: undefined,
    provider: "venice",
    error: undefined,
    ...over,
  };
}

function row(meta: Record<string, unknown>, id = "row-1") {
  return { id, createdAt: CREATED, metadata: meta };
}

/** A metadata blob shaped the way consultBoardAndPersist writes one. */
function persistedMeta(over: Record<string, unknown> = {}) {
  return {
    boardId: "strategic",
    boardName: "Strategic Board",
    question: "should I raise alignment prices",
    ranAt: CREATED.toISOString(),
    takes: [take()],
    synthesis: {
      consensus: ["a"],
      divergences: [],
      tension: null,
      recommendation: "hold",
      confidence: 0.6,
    },
    droppedAdvisorIds: [],
    operatorState: null,
    ...over,
  };
}

beforeEach(() => {
  h.remember.mockReset().mockResolvedValue({ id: "mem-row-1" });
  h.findMany.mockReset().mockResolvedValue([]);
  h.findFirst.mockReset().mockResolvedValue(null);
  h.consultBoard.mockReset();
  h.warn.mockReset();
  h.getRevenueStats.mockReset();
});

describe("the advisors' business context never states an unread month as $0", () => {
  // getRevenueStats' two real outcomes (lib/services/business-intel.ts): a bridge
  // reading, and a failed read that still carries computed zeros beside
  // `bridgeAvailable: false`. The context used to paste either one in as "live numbers".
  const QUESTION = "should we raise our pricing on alignments";

  it("PLANTED POSITIVE · a month the bridge read goes in with its real figure", async () => {
    h.getRevenueStats.mockResolvedValue({
      period: "month",
      totalRevenue: "4210.50",
      jobCount: 7,
      avgTicket: "601.50",
      bridgeAvailable: true,
    });
    const block = await buildBusinessContextBlock(QUESTION);
    expect(h.getRevenueStats).toHaveBeenCalledWith("month");
    expect(block).toContain("Revenue (month):");
    expect(block).toContain("4210.50");
    expect(block).not.toMatch(/UNKNOWN/);
  });

  it("an unreadable month is stated as unknown, and no zero reaches the advisors", async () => {
    h.getRevenueStats.mockResolvedValue({
      period: "month",
      totalRevenue: "0.00",
      jobCount: 0,
      avgTicket: "0.00",
      bridgeAvailable: false,
    });
    const block = await buildBusinessContextBlock(QUESTION);
    expect(block).toMatch(/Revenue \(month\): UNKNOWN/);
    expect(block).not.toContain("0.00");
  });

  it("a question that is not about money never reads revenue at all", async () => {
    await buildBusinessContextBlock("who should run the Saturday shift");
    expect(h.getRevenueStats).not.toHaveBeenCalled();
  });
});

describe("consultBoardAndPersist · the mood gate leaves a record", () => {
  function consultation(over: Record<string, unknown> = {}) {
    return {
      boardId: "strategic",
      boardName: "Strategic Board",
      question: "should I raise alignment prices",
      takes: [take(), take({ advisorId: "inversion", advisorName: "Inversion" })],
      synthesis: {
        consensus: [],
        divergences: [],
        tension: undefined,
        recommendation: "hold",
        confidence: 0.5,
      },
      durationMs: 1200,
      ranAt: CREATED.toISOString(),
      operatorState: {
        mood: "depleted",
        focus: 0.3,
        capacity: 0.2,
        drift: 0.4,
        momentum: 0.1,
        confidence: 0.8,
      },
      droppedAdvisorIds: ["elon-musk", "steve-jobs", "growth-engine"],
      ...over,
    };
  }

  it("PLANTED POSITIVE · the write happens at all, with the fields we then assert on", async () => {
    h.consultBoard.mockResolvedValue(consultation());
    await consultBoardAndPersist("strategic", "should I raise alignment prices");
    expect(h.remember).toHaveBeenCalledTimes(1);
    const meta = h.remember.mock.calls[0][4] as Record<string, unknown>;
    expect(meta.boardId).toBe("strategic");
  });

  it("persists droppedAdvisorIds so history can say WHICH lenses were withheld", async () => {
    h.consultBoard.mockResolvedValue(consultation());
    await consultBoardAndPersist("strategic", "should I raise alignment prices");
    const meta = h.remember.mock.calls[0][4] as Record<string, unknown>;
    expect(meta.droppedAdvisorIds).toEqual(["elon-musk", "steve-jobs", "growth-engine"]);
  });

  it("persists the operator state so history can say WHY", async () => {
    h.consultBoard.mockResolvedValue(consultation());
    await consultBoardAndPersist("strategic", "should I raise alignment prices");
    const meta = h.remember.mock.calls[0][4] as Record<string, unknown>;
    expect((meta.operatorState as { mood: string }).mood).toBe("depleted");
  });

  it("writes an EMPTY drop list rather than omitting the field when nothing was gated", async () => {
    // "No advisors were dropped" and "this row predates the field" must not
    // project to the same thing.
    h.consultBoard.mockResolvedValue(consultation({ droppedAdvisorIds: [], operatorState: null }));
    await consultBoardAndPersist("strategic", "should I raise alignment prices");
    const meta = h.remember.mock.calls[0][4] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(meta, "droppedAdvisorIds")).toBe(true);
    expect(meta.droppedAdvisorIds).toEqual([]);
  });
});

describe("advisorCount means what its comment says", () => {
  it("PLANTED POSITIVE · a clean board projects every take as an advisor", async () => {
    h.findMany.mockResolvedValue([row(persistedMeta({ takes: [take(), take()] }))]);
    const { consultations } = await listRecentBoardConsultations();
    expect(consultations[0].advisorCount).toBe(2);
    expect(consultations[0].erroredCount).toBe(0);
  });

  it("EXCLUDES errored takes from advisorCount", async () => {
    h.findMany.mockResolvedValue([
      row(
        persistedMeta({
          takes: [take(), take({ error: "provider timeout" }), take({ error: "parse failed" })],
        }),
      ),
    ]);
    const { consultations } = await listRecentBoardConsultations();
    expect(
      consultations[0].advisorCount,
      "documented as 'advisors who actually produced takes (vs errored)'",
    ).toBe(1);
  });

  it("does not lose the errored advisors — they get their own number", async () => {
    // Making advisorCount honest must not make the failures invisible.
    h.findMany.mockResolvedValue([
      row(persistedMeta({ takes: [take(), take({ error: "provider timeout" })] })),
    ]);
    const { consultations } = await listRecentBoardConsultations();
    expect(consultations[0].erroredCount).toBe(1);
    expect(consultations[0].advisorCount + consultations[0].erroredCount).toBe(2);
  });
});

describe("the projection carries the gate verdict into history", () => {
  it("projects droppedAdvisorIds and the mood that drove them", async () => {
    h.findMany.mockResolvedValue([
      row(
        persistedMeta({
          takes: [take(), take({ advisorId: "inversion" })],
          droppedAdvisorIds: ["elon-musk", "steve-jobs", "growth-engine"],
          operatorState: { mood: "depleted", confidence: 0.8 },
        }),
      ),
    ]);
    const { consultations } = await listRecentBoardConsultations();
    const v = consultations[0];

    expect(v.droppedAdvisorIds).toEqual(["elon-musk", "steve-jobs", "growth-engine"]);
    expect(v.moodAtConsult).toBe("depleted");
    // The reading the operator gets: 2 of 5 lenses actually ran.
    expect(v.advisorCount + v.erroredCount + v.droppedAdvisorIds.length).toBe(5);
  });

  it("degrades an old row (no gate fields) to empty + null, never to a crash", async () => {
    const legacy = persistedMeta();
    delete (legacy as Record<string, unknown>).droppedAdvisorIds;
    delete (legacy as Record<string, unknown>).operatorState;
    h.findMany.mockResolvedValue([row(legacy)]);

    const { consultations } = await listRecentBoardConsultations();
    expect(consultations).toHaveLength(1);
    expect(consultations[0].droppedAdvisorIds).toEqual([]);
    expect(consultations[0].moodAtConsult).toBeNull();
  });

  it("ignores non-string entries in a malformed drop list", async () => {
    h.findMany.mockResolvedValue([
      row(persistedMeta({ droppedAdvisorIds: ["elon-musk", { id: "x" }, 42, null] })),
    ]);
    const { consultations } = await listRecentBoardConsultations();
    expect(consultations[0].droppedAdvisorIds).toEqual(["elon-musk"]);
  });
});

describe("rows that fail projection are counted, not swallowed", () => {
  it("PLANTED POSITIVE · well-formed rows report zero unreadable", async () => {
    h.findMany.mockResolvedValue([row(persistedMeta())]);
    const res = await listRecentBoardConsultations();
    expect(res.consultations).toHaveLength(1);
    expect(res.unreadable).toBe(0);
  });

  it("reports how many rows could not be projected", async () => {
    h.findMany.mockResolvedValue([
      row(persistedMeta(), "good-1"),
      row({ boardId: "", boardName: "x", question: "y" }, "bad-1"),
      row({ nothing: true }, "bad-2"),
    ]);

    const res = await listRecentBoardConsultations();

    expect(res.consultations).toHaveLength(1);
    expect(
      res.unreadable,
      "a shorter list must not be the ONLY evidence that rows were dropped",
    ).toBe(2);
    expect(h.warn).toHaveBeenCalledWith(
      "board_consultations_unreadable",
      expect.objectContaining({ unreadable: 2, fetched: 3 }),
    );
  });

  it("stays quiet when nothing was dropped", async () => {
    h.findMany.mockResolvedValue([row(persistedMeta())]);
    await listRecentBoardConsultations();
    expect(h.warn).not.toHaveBeenCalled();
  });
});
