/**
 * W7 (job 2026-11-02-nour-os-interconnect, map gap 6) · Home names the mission and goal behind the next move, and
 * shows the latest journal line with the people it names. Both are reads that render: a failed read says so
 * ("unknown"), never a quiet empty (empty-vs-error).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({
  taskFindUnique: vi.fn(),
  dumpFindFirst: vi.fn(),
  peopleFindMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { findUnique: h.taskFindUnique },
    brainDump: { findFirst: h.dumpFindFirst },
    personProfile: { findMany: h.peopleFindMany },
  },
}));
const logWarn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logger", async (orig) => {
  const m = await orig<typeof import("@/lib/logger")>();
  return { ...m, logger: { ...m.logger, withSurface: (s: string) => ({ ...m.logger.withSurface(s), warn: logWarn }) } };
});
vi.mock("@/lib/services/outcome-ledger", () => ({ recordShownBounded: vi.fn(async () => "led") }));

import { __testInternals, HOME_JOURNAL_EXCERPT_CHARS } from "@/lib/home/operator-brief";
import { JournalLineView, leadContextDetail } from "@/components/home/journal-line";

const { loadLeadContext, loadJournalLine } = __testInternals;

const task = (over: Record<string, unknown> = {}) => ({
  goal: null,
  mission: { id: "m1", title: "Open the second bay", lifeGoal: { id: "g-m", title: "Grow the shop", deletedAt: null } },
  ...over,
});

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  logWarn.mockReset();
});

describe("loadLeadContext (the next move's mission and goal)", () => {
  it("reads the task's mission and the goal it inherits from the mission, in one query", async () => {
    h.taskFindUnique.mockResolvedValue(task());
    expect(await loadLeadContext("t1")).toEqual({
      mission: { id: "m1", title: "Open the second bay" },
      goal: { id: "g-m", title: "Grow the shop" },
    });
    expect(h.taskFindUnique).toHaveBeenCalledTimes(1);
    expect(h.taskFindUnique.mock.calls[0][0].where).toEqual({ id: "t1" });
  });

  it("the task's own goal overrides the mission's (taskGoal's rule)", async () => {
    h.taskFindUnique.mockResolvedValue(task({ goal: { id: "g-t", title: "Save $15k", deletedAt: null } }));
    expect((await loadLeadContext("t1"))?.valueOf()).toMatchObject({ goal: { id: "g-t", title: "Save $15k" } });
  });

  it("a deleted goal is not named; the inbox mission is not a mission", async () => {
    h.taskFindUnique.mockResolvedValue(
      task({ mission: { id: "m-inbox", title: "Inbox - business", lifeGoal: { id: "g-x", title: "Gone", deletedAt: new Date() } } }),
    );
    expect(await loadLeadContext("t1")).toEqual({ mission: null, goal: null });
  });

  it("no task id (the lead is not a task) reads nothing", async () => {
    expect(await loadLeadContext(null)).toBeNull();
    expect(h.taskFindUnique).not.toHaveBeenCalled();
  });

  it("a failed read is 'unknown' and logged with its reason, never null", async () => {
    h.taskFindUnique.mockRejectedValue(new Error("column missing"));
    expect(await loadLeadContext("t1")).toBe("unknown");
    expect(logWarn).toHaveBeenCalledWith("lead_context_read_failed", expect.objectContaining({ err: "column missing" }));
  });
});

describe("loadJournalLine (Home's latest journal line)", () => {
  const dump = { id: "d1", rawThoughts: "x".repeat(300), createdAt: new Date("2026-11-02T14:00:00Z"), personIds: ["p2", "p1", "gone"] };

  it("reads the newest live entry, clips it, and names its live people in the entry's order (one query)", async () => {
    h.dumpFindFirst.mockResolvedValue(dump);
    h.peopleFindMany.mockResolvedValue([
      { id: "p1", name: "Dania" },
      { id: "p2", name: "Samir" },
    ]);
    const line = await loadJournalLine();
    expect(h.dumpFindFirst.mock.calls[0][0]).toMatchObject({ where: { deletedAt: null }, orderBy: { createdAt: "desc" } });
    expect(h.peopleFindMany.mock.calls[0][0].where).toEqual({ id: { in: ["p2", "p1", "gone"] }, deletedAt: null });
    expect(line).not.toBe("unknown");
    if (!line || line === "unknown") throw new Error("expected a line");
    expect(line.excerpt.length).toBeLessThanOrEqual(HOME_JOURNAL_EXCERPT_CHARS);
    expect(line.people).toEqual([
      { id: "p2", name: "Samir" },
      { id: "p1", name: "Dania" },
    ]);
  });

  it("an entry naming no one skips the people read", async () => {
    h.dumpFindFirst.mockResolvedValue({ ...dump, rawThoughts: "short", personIds: [] });
    const line = await loadJournalLine();
    expect(line).toMatchObject({ excerpt: "short", people: [] });
    expect(h.peopleFindMany).not.toHaveBeenCalled();
  });

  it("no entries at all is a measured null", async () => {
    h.dumpFindFirst.mockResolvedValue(null);
    expect(await loadJournalLine()).toBeNull();
  });

  it("a failed names read keeps the line and marks people null (couldn't load), not []", async () => {
    h.dumpFindFirst.mockResolvedValue(dump);
    h.peopleFindMany.mockRejectedValue(new Error("timeout"));
    expect(await loadJournalLine()).toMatchObject({ id: "d1", people: null });
  });

  it("a failed entry read is 'unknown' and logged", async () => {
    h.dumpFindFirst.mockRejectedValue(new Error("db down"));
    expect(await loadJournalLine()).toBe("unknown");
    expect(logWarn).toHaveBeenCalledWith("journal_line_read_failed", expect.objectContaining({ err: "db down" }));
  });
});

describe("Home renders them", () => {
  it("the lead row's detail names the mission and goal, or says it couldn't read them", () => {
    expect(leadContextDetail({ mission: { id: "m1", title: "Bay two" }, goal: { id: "g1", title: "Grow" } })).toBe(
      "Mission: Bay two · Goal: Grow",
    );
    expect(leadContextDetail({ mission: null, goal: { id: "g1", title: "Grow" } })).toBe("Goal: Grow");
    expect(leadContextDetail({ mission: null, goal: null })).toBeNull();
    expect(leadContextDetail(null)).toBeNull();
    expect(leadContextDetail("unknown")).toBe("Mission and goal couldn't load");
  });

  it("the journal line links the entry and each person; a failed read says unknown, not empty", () => {
    const html = renderToStaticMarkup(
      <JournalLineView
        line={{ id: "d1", excerpt: "Called the supplier", createdAt: "2026-11-02T14:00:00.000Z", people: [{ id: "p1", name: "Dania" }] }}
      />,
    );
    expect(html).toContain("Called the supplier");
    expect(html).toContain('href="/journal"');
    expect(html).toContain("/people?inspect=person:p1");
    expect(renderToStaticMarkup(<JournalLineView line="unknown" />)).toContain("couldn&#x27;t load");
    expect(renderToStaticMarkup(<JournalLineView line={null} />)).toBe("");
    expect(
      renderToStaticMarkup(<JournalLineView line={{ id: "d1", excerpt: "x", createdAt: "2026-11-02T14:00:00.000Z", people: null }} />),
    ).toContain("People on this entry couldn&#x27;t load");
  });
});
