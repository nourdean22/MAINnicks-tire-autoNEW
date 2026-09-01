/**
 * Execution Deck read model — the /missions page's one query.
 *
 * Pins the section derivations that carry the redesign's load:
 *  · hero eligibility (the boundary rule: shop-anchor tasks, habits and
 *    blocked rows can NEVER own the next move — the old TopMissionToday
 *    picked "GENERAL BUSINESS & NICKS TIRE" precisely because it had no
 *    predicate; this test is the regression pin for that defect)
 *  · resume beats start (a DOING task owns the hero)
 *  · lanes carry counts + shop flag, missions carry progress ONLY with a
 *    declared end state (a catch-all has no 100%)
 *  · readiness freshness bound (a 9-day-old health log reads "unknown",
 *    never a confident score — the old strip printed 96/100 off it)
 *  · guarded sources land in `unmeasured`, never as fake zeros.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mission: { findMany: vi.fn() },
  task: { findMany: vi.fn() },
  taskEvent: { findMany: vi.fn(), findFirst: vi.fn() },
  captureInboxItem: { findMany: vi.fn(), count: vi.fn() },
  personalDailyLog: { findFirst: vi.fn() },
  stateLog: { findFirst: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks }));
vi.mock("@/lib/services/task-rescue", () => ({
  buildTaskRescue: vi.fn(async () => ({ findings: [], scannedCount: 0 })),
}));

import { buildMissionsDeck, MISSION_WIP_CAP } from "@/lib/missions/deck";
import { buildTaskRescue } from "@/lib/services/task-rescue";

const NOW = new Date("2026-09-01T15:00:00Z"); // 11:00 ET
const DAY = 86_400_000;

const shopAnchor = {
  id: "m-general-business",
  title: "GENERAL BUSINESS & NICKS TIRE",
  status: "ACTIVE",
  systemKind: "GENERAL",
  canonicalDomain: "business",
  domain: "BUSINESS",
  priority: 5,
  roiScore: 50,
  neglectCost: 50,
  deadline: null,
};
const homeAnchor = {
  id: "m-general-personal",
  title: "GENERAL PERSONAL & HOME",
  status: "ACTIVE",
  systemKind: "GENERAL",
  canonicalDomain: "personal",
  domain: "PERSONAL",
  priority: 5,
  roiScore: 50,
  neglectCost: 50,
  deadline: null,
};
const project = {
  id: "m-bathroom",
  title: "Bathroom repair",
  status: "ACTIVE",
  systemKind: null,
  canonicalDomain: null,
  domain: "PERSONAL",
  priority: 5,
  roiScore: 50,
  neglectCost: 50,
  deadline: new Date(NOW.getTime() + 10 * DAY).toISOString(),
};

function task(overrides: Record<string, unknown>) {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    title: "task",
    nextPhysicalAction: null,
    status: "READY",
    effort: "M30",
    energyRequired: "MEDIUM",
    roiScore: 50,
    frictionScore: 20,
    dueDate: null,
    lastTouchedAt: new Date(NOW.getTime() - 1 * DAY),
    lastCompletedAt: null,
    loopKind: "ONCE",
    manualPriorityOverride: null,
    waitingOn: null,
    startedAt: null,
    snoozedUntil: null,
    missionId: "m-bathroom",
    pendingClassification: null,
    createdAt: new Date(NOW.getTime() - 5 * DAY),
    updatedAt: new Date(NOW.getTime() - 1 * DAY),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mission.findMany.mockResolvedValue([shopAnchor, homeAnchor, project]);
  mocks.taskEvent.findMany.mockResolvedValue([]);
  mocks.taskEvent.findFirst.mockResolvedValue(null);
  mocks.captureInboxItem.findMany.mockResolvedValue([]);
  mocks.captureInboxItem.count.mockResolvedValue(0);
  mocks.personalDailyLog.findFirst.mockResolvedValue({ logDate: new Date(NOW.getTime() - 9 * DAY) });
  mocks.stateLog.findFirst.mockResolvedValue(null);
  vi.mocked(buildTaskRescue).mockResolvedValue({ findings: [], scannedCount: 0 } as never);
});

describe("deck · next move eligibility (the boundary pin)", () => {
  it("a shop-anchor task can NEVER own the hero, even when it outscores everything", async () => {
    mocks.task.findMany.mockResolvedValue([
      task({
        id: "t-shop",
        title: "Collect $9,000 — huge shop money",
        missionId: "m-general-business",
        dueDate: new Date(NOW.getTime() - 30 * DAY), // screaming overdue
      }),
      task({ id: "t-home", title: "Fix the bathroom ceiling", missionId: "m-bathroom" }),
    ]);
    const deck = await buildMissionsDeck(NOW);
    expect(deck.nextMove?.task.id).toBe("t-home");
    // …and the shop task is not smuggled in through alternates either.
    expect(deck.nextMove?.alternates.map((a) => a.id)).not.toContain("t-shop");
  });

  it("habits and blocked rows are hero-ineligible; a DOING task resumes", async () => {
    mocks.task.findMany.mockResolvedValue([
      task({ id: "t-habit", title: "5-min journal", loopKind: "DAILY", missionId: "m-general-personal" }),
      task({ id: "t-blocked", title: "Waiting on Eddy", waitingOn: "Eddy" }),
      task({ id: "t-doing", title: "Half-done drywall", status: "DOING", startedAt: new Date(NOW.getTime() - 3600e3) }),
      task({ id: "t-fresh", title: "Brand new task", dueDate: new Date(NOW.getTime() - 5 * DAY) }),
    ]);
    mocks.taskEvent.findFirst.mockResolvedValue({ payload: { note: "drywall cut, tape next" } });
    const deck = await buildMissionsDeck(NOW);
    expect(deck.nextMove?.kind).toBe("resume");
    expect(deck.nextMove?.task.id).toBe("t-doing");
    expect(deck.nextMove?.resumeNote).toBe("drywall cut, tape next");
    const heroPool = [deck.nextMove?.task.id, ...(deck.nextMove?.alternates.map((a) => a.id) ?? [])];
    expect(heroPool).not.toContain("t-habit");
    expect(heroPool).not.toContain("t-blocked");
  });

  it("empty board → null next move, never a fabricated pick", async () => {
    mocks.task.findMany.mockResolvedValue([]);
    const deck = await buildMissionsDeck(NOW);
    expect(deck.nextMove).toBeNull();
  });

  it("PROD-shape pin: a business USER PROJECT (no anchor flag) is dampened via mission domain", async () => {
    // Live prod's "GENERAL BUSINESS & NICKS TIRE" row is a real Mission
    // (systemKind null), NOT a GENERAL anchor — so the hero's anchor
    // exclusion is inert there and the boundary rides entirely on the
    // scorer's domain multiplier. This pins that path end-to-end.
    const shopProject = {
      ...project,
      id: "m-shop-project",
      title: "GENERAL BUSINESS & NICKS TIRE",
      systemKind: null,
      domain: "BUSINESS",
      deadline: null,
    };
    mocks.mission.findMany.mockResolvedValue([shopProject, project]);
    mocks.task.findMany.mockResolvedValue([
      task({ id: "t-shop", title: "drop off signs", missionId: "m-shop-project" }),
      task({ id: "t-home", title: "Fix the bathroom ceiling", missionId: "m-bathroom" }),
    ]);
    const deck = await buildMissionsDeck(NOW);
    // Equal terms → the personal task wins BECAUSE of shop ×0.7…
    expect(deck.nextMove?.task.id).toBe("t-home");
    // …and the dampening is named on the shop alternate (instrument fired,
    // not a coincidence of other terms).
    const shopAlt = deck.nextMove?.alternates.find((a) => a.id === "t-shop");
    expect(shopAlt?.why).toContain("shop ×");
    // A business user project stays HERO-ELIGIBLE (judgment items must be
    // able to win when genuinely hot) — it is dampened, never excluded.
    expect(deck.nextMove?.alternates.map((a) => a.id)).toContain("t-shop");
  });
});

describe("deck · sections tell the truth about their shapes", () => {
  it("lanes carry counts + the shop flag; missions carry progress only with an end state", async () => {
    mocks.task.findMany.mockResolvedValue([
      task({ id: "t-s1", missionId: "m-general-business" }),
      task({ id: "t-p1", missionId: "m-general-personal", lastTouchedAt: new Date(NOW.getTime() - 12 * DAY) }),
      task({ id: "t-b1", missionId: "m-bathroom" }),
      task({ id: "t-b2", missionId: "m-bathroom", status: "DONE", updatedAt: new Date(NOW.getTime() - 3 * DAY) }),
    ]);
    const deck = await buildMissionsDeck(NOW);

    const shopLane = deck.lanes.find((l) => l.id === "m-general-business");
    expect(shopLane?.isShop).toBe(true);
    expect(shopLane?.openCount).toBe(1);
    const homeLane = deck.lanes.find((l) => l.id === "m-general-personal");
    expect(homeLane?.oldestOpenDays).toBe(12);
    // Shop lane sorts last — the personal OS leads with personal lanes.
    expect(deck.lanes[deck.lanes.length - 1]?.isShop).toBe(true);

    const bathroom = deck.missions.find((m) => m.id === "m-bathroom");
    expect(bathroom?.openCount).toBe(1);
    expect(bathroom?.doneCount).toBe(1);
    expect(deck.missionSlotsOpen).toBe(MISSION_WIP_CAP - 1);
    // Anchors are lanes, never missions.
    expect(deck.missions.map((m) => m.id)).not.toContain("m-general-business");
  });

  it("habits leave the board: they appear in rhythms, not in mission/lane counts", async () => {
    mocks.task.findMany.mockResolvedValue([
      task({ id: "t-journal", title: "5-min journal", loopKind: "DAILY", missionId: "m-general-personal" }),
    ]);
    const deck = await buildMissionsDeck(NOW);
    expect(deck.rhythms.map((r) => r.id)).toContain("t-journal");
    expect(deck.lanes.find((l) => l.id === "m-general-personal")).toBeUndefined(); // no non-habit opens
  });

  it("rhythm windows count distinct completion days, and doneToday reads lastCompletedAt", async () => {
    mocks.task.findMany.mockResolvedValue([
      task({ id: "t-journal", title: "5-min journal", loopKind: "DAILY", missionId: "m-general-personal", lastCompletedAt: NOW }),
    ]);
    mocks.taskEvent.findMany.mockResolvedValue([
      { taskId: "t-journal", createdAt: new Date(NOW.getTime() - 1 * DAY) },
      { taskId: "t-journal", createdAt: new Date(NOW.getTime() - 2 * DAY) },
      { taskId: "t-journal", createdAt: new Date(NOW.getTime() - 2 * DAY + 3600e3) }, // same ET day
    ]);
    const deck = await buildMissionsDeck(NOW);
    const r = deck.rhythms.find((x) => x.id === "t-journal");
    expect(r?.windowDone).toBe(2);
    expect(r?.doneToday).toBe(true);
  });
});

describe("deck · readiness freshness bound (the 96/100-off-stale-logs pin)", () => {
  it("a 9-day-old health log reads unknown with its age named — never a score", async () => {
    mocks.task.findMany.mockResolvedValue([]);
    const deck = await buildMissionsDeck(NOW);
    expect(deck.readiness.state).toBe("unknown");
    expect(deck.readiness.state === "unknown" && deck.readiness.line).toContain("9 days old");
  });

  it("no health log at all is also unknown, not nominal", async () => {
    mocks.personalDailyLog.findFirst.mockResolvedValue(null);
    mocks.task.findMany.mockResolvedValue([]);
    const deck = await buildMissionsDeck(NOW);
    expect(deck.readiness.state).toBe("unknown");
  });
});

describe("deck · guarded sources fail loud, not silent", () => {
  it("a capture-store read failure lands in unmeasured instead of rendering zero", async () => {
    mocks.task.findMany.mockResolvedValue([]);
    mocks.captureInboxItem.findMany.mockRejectedValue(new Error("boom"));
    const deck = await buildMissionsDeck(NOW);
    expect(deck.unmeasured).toContain("captures");
  });
});
