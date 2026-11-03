/**
 * Home "check-in due" row (job 2026-11-02-nour-os-interconnect W2, Linear L3) and the "Nick remembers"
 * read (map gap 6). Both are reads that render: a failed read is "couldn't read", never a quiet empty.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({
  goalFindMany: vi.fn(),
  eventFindMany: vi.fn(),
  taskFindMany: vi.fn(),
  auditFindMany: vi.fn(),
  anticipated: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lifeGoal: { findMany: h.goalFindMany },
    goalEvent: { findMany: h.eventFindMany },
    // W8b: the row reads through activeGoalsWithHealth (lib/services/goal-health.ts), which counts tasks too.
    task: { findMany: h.taskFindMany },
    auditEvent: { findMany: h.auditFindMany },
    // W8b: the anticipated-questions read runs for real over this mock; its failure path is driven here, not faked.
    brainMemory: { findUnique: h.anticipated },
  },
}));
const logWarn = vi.hoisted(() => vi.fn());
// The dev logger prints only the message, so the reason is asserted at the logger, not on console.
vi.mock("@/lib/logger", async (orig) => {
  const m = await orig<typeof import("@/lib/logger")>();
  return { ...m, logger: { ...m.logger, withSurface: (s: string) => ({ ...m.logger.withSurface(s), warn: logWarn }) } };
});
vi.mock("@/lib/services/outcome-ledger", () => ({ recordShownBounded: vi.fn(async () => "led") }));

import { GoalsCardView } from "@/components/home/home-cards";
import { __testInternals } from "@/lib/home/operator-brief";
import { readNickRemembers } from "@/lib/home/nick-remembers";
import { _resetTodayCacheForTests } from "@/lib/brain/anticipated-questions";
import { remembersFailedLine } from "@/components/home/nick-command-line";

const DAY = 86_400_000;
const NOW = new Date("2026-11-02T15:00:00Z");
const READ = { title: "Save $15k", label: "40d left", active: 3 };

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  _resetTodayCacheForTests();
  h.taskFindMany.mockResolvedValue([]);
});

describe("loadGoalCheckInDue (the brief's read)", () => {
  it("returns the most overdue active goal from the check-in events", async () => {
    h.goalFindMany.mockResolvedValue([
      { id: "g1", title: "Week goal", horizon: "WEEK", createdAt: new Date(NOW.getTime() - 40 * DAY) },
      { id: "g2", title: "Month goal", horizon: "MONTH", createdAt: new Date(NOW.getTime() - 50 * DAY) },
    ]);
    h.eventFindMany.mockResolvedValue([{ goalId: "g1", kind: "check_in", payload: { health: "on_track" }, createdAt: new Date(NOW.getTime() - 1 * DAY) }]);
    expect(await __testInternals.loadGoalCheckInDue(NOW)).toEqual({ goalId: "g2", title: "Month goal", daysOverdue: 20 });
  });

  // W8b (manager ruling, "one number"): Home reads the SAME goals-with-health read the Goals card and Nick read,
  // not a second check-in query: the shared reader asks for check_in AND horizon_set, newest per (goal, kind).
  it("reads through activeGoalsWithHealth: the shared event query shape, not a Home-only check-in query", async () => {
    h.goalFindMany.mockResolvedValue([{ id: "g1", title: "Week goal", horizon: "WEEK", createdAt: new Date(NOW.getTime() - 40 * DAY) }]);
    h.eventFindMany.mockResolvedValue([]);
    await __testInternals.loadGoalCheckInDue(NOW);
    const q = h.eventFindMany.mock.calls[0][0];
    expect(q.where.kind).toEqual({ in: ["check_in", "horizon_set"] });
    expect(q.distinct).toEqual(["goalId", "kind"]);
  });

  it("a failed TASKS read does not touch the check-in row (it needs no tasks): the due goal is still named", async () => {
    h.goalFindMany.mockResolvedValue([{ id: "g1", title: "Week goal", horizon: "WEEK", createdAt: new Date(NOW.getTime() - 40 * DAY) }]);
    h.eventFindMany.mockResolvedValue([]);
    h.taskFindMany.mockRejectedValue(new Error("tasks down"));
    expect(await __testInternals.loadGoalCheckInDue(NOW)).toMatchObject({ goalId: "g1" });
  });

  it("a failed check-in read is 'unknown', never null (null means nothing is due)", async () => {
    h.goalFindMany.mockResolvedValue([{ id: "g1", title: "Week goal", horizon: "WEEK", createdAt: new Date(NOW.getTime() - 40 * DAY) }]);
    h.eventFindMany.mockRejectedValue(new Error("timeout"));
    expect(await __testInternals.loadGoalCheckInDue(NOW)).toBe("unknown");
  });

  it("a thrown goals read is logged with its reason and named in the failed sources (second reader P2-2)", async () => {
    logWarn.mockClear();
    const warn = logWarn;
    h.goalFindMany.mockRejectedValue(new Error("goals-read-marker"));
    const due = await __testInternals.loadGoalCheckInDue(NOW);
    expect(due).toBe("unknown");
    expect(JSON.stringify(warn.mock.calls)).toContain("goals-read-marker");
    const OK = { contradictions: [], proposals: [], followUps: [], pendingActions: [], approvalRequests: [] };
    expect(__testInternals.collectFailedSources({ ...OK, goalCheckInDue: due })).toEqual(["goal check-ins"]);
    expect(__testInternals.collectFailedSources({ ...OK, goalCheckInDue: null })).toEqual([]);
  });
});

describe("the Goals card's check-in row", () => {
  it("names the due goal and links to the goals tab", () => {
    const html = renderToStaticMarkup(<GoalsCardView read={READ} checkIn={{ goalId: "g2", title: "Month goal", daysOverdue: 20 }} />);
    expect(html).toContain("Check-in due: Month goal");
    expect(html).toContain('href="/stats?tab=goals"');
  });
  it("a failed check-in read shows the card's unknown line", () => {
    const html = renderToStaticMarkup(<GoalsCardView read={READ} checkIn="unknown" />);
    expect(html).toMatch(/Check-in unknown, couldn.*t load/);
  });
  it("nothing due shows no row", () => {
    expect(renderToStaticMarkup(<GoalsCardView read={READ} checkIn={null} />)).not.toContain("Check-in");
  });
});

describe("readNickRemembers (map gap 6)", () => {
  it("a failed digest read is named in failed, not an empty follow-up list", async () => {
    h.anticipated.mockResolvedValue(null);
    h.auditFindMany.mockRejectedValue(new Error("db down"));
    const r = await readNickRemembers();
    expect(r.failed).toEqual(["conversation digests"]);
    expect(r.followUps).toEqual([]);
  });
  it("each failed read is logged with its reason (second reader P2-3)", async () => {
    logWarn.mockClear();
    const warn = logWarn;
    h.anticipated.mockRejectedValue(new Error("anticipated-marker"));
    h.auditFindMany.mockRejectedValue(new Error("digest-marker"));
    await readNickRemembers();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("anticipated-marker");
    expect(logged).toContain("digest-marker");
  });
  // W8b (audit B4): the real failure path. fetchSetByKey used to swallow a thrown read into null and cache it, so
  // readNickRemembers' catch could never fire in production; the old test mocked a rejection prod never produced.
  it("a failed anticipated read (the store throws) is named, and the failure is not cached as an empty day", async () => {
    h.anticipated.mockRejectedValue(new Error("anticipated-store-down"));
    h.auditFindMany.mockResolvedValue([{ payload: { followUpNeeded: " call the bank " } }]);
    const r = await readNickRemembers();
    expect(r.failed).toEqual(["anticipated questions"]);
    expect(r.followUps).toEqual(["call the bank"]);
    expect(JSON.stringify(logWarn.mock.calls)).toContain("anticipated-store-down");
    // The store recovers: the next read is measured, not served from a cached failure.
    h.anticipated.mockResolvedValue(null);
    expect((await readNickRemembers()).failed).toEqual([]);
  });

  it("a measured empty day (no set for today or yesterday) is failed = [] with no questions", async () => {
    h.anticipated.mockResolvedValue(null);
    h.auditFindMany.mockResolvedValue([]);
    const r = await readNickRemembers();
    expect(r).toEqual({ anticipatedQuestions: [], followUps: [], failed: [] });
    // today's key, then yesterday's: two reads, both measured null.
    expect(h.anticipated).toHaveBeenCalledTimes(2);
  });
  it("the command line says it couldn't read, and stays quiet on a clean read", () => {
    expect(remembersFailedLine({ failed: ["conversation digests"] }, false)).toBe("Couldn't read what Nick remembers (conversation digests)");
    expect(remembersFailedLine(undefined, true)).toBe("Couldn't read what Nick remembers");
    expect(remembersFailedLine({ failed: [] }, false)).toBeNull();
    expect(remembersFailedLine(undefined, false)).toBeNull();
  });
});
