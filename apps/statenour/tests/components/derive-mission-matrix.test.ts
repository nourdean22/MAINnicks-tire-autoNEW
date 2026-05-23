/**
 * tests/components/derive-mission-matrix.test.ts · task #15.
 *
 * Pure-helper test for the MissionScoreboard derivation. The
 * component itself is hard to render through tRPC + React Query in
 * jsdom (matches the /system/providers approach), so the contract
 * test runs against the data-in/data-out helper.
 *
 * Locks:
 *   1. progressPct math (done / total · clamped, no NaN on empty)
 *   2. doneTodayCount uses lastTouchedAt within last 24h + DONE status
 *   3. overdueCount uses past dueDate + non-DONE/CANCELLED
 *   4. daysIdle is the floor-days from latest activity (null when no tasks)
 *   5. daysToDeadline derives from mission.deadline (null when absent)
 *   6. Missions with zero tasks are filtered out of the matrix options
 *   7. Cell resolver returns the right value/score pairs · lower-is-better
 *      columns return the raw count as score (ComparisonMatrix handles
 *      the inversion via criterion.higherIsBetter: false)
 */

import { describe, it, expect } from "vitest";

import type { Project, Task } from "@/components/actions/shared";
import {
  buildMissionMatrixOptions,
  computeMissionMetrics,
  MISSION_MATRIX_CRITERIA,
  resolveMissionMatrixCell,
  type MissionMatrixOption,
} from "@/components/actions/derive-mission-matrix";

// ── Fixtures ────────────────────────────────────────────────────

const NOW = new Date("2026-05-23T18:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number): string =>
  new Date(NOW.getTime() + offsetDays * DAY_MS).toISOString();

function mission(
  id: string,
  overrides: Partial<Project> = {},
): Project {
  return {
    id,
    title: `Mission ${id}`,
    status: "ACTIVE",
    domain: "Inbox",
    ...overrides,
  };
}

function task(
  id: string,
  missionId: string,
  overrides: Partial<Task> = {},
): Task {
  return {
    id,
    missionId,
    title: `Task ${id}`,
    nextPhysicalAction: "",
    status: "OPEN",
    autoPriority: null,
    autoPriorityExplanation: null,
    ...overrides,
  };
}

// ── computeMissionMetrics ───────────────────────────────────────

describe("computeMissionMetrics · progress math", () => {
  it("returns 0% when a mission has tasks but none done", () => {
    const m = computeMissionMetrics(
      [mission("m1")],
      [task("t1", "m1"), task("t2", "m1")],
      NOW,
    );
    expect(m[0].progressPct).toBe(0);
    expect(m[0].totalTasks).toBe(2);
  });

  it("returns 100% when every task is done", () => {
    const m = computeMissionMetrics(
      [mission("m1")],
      [
        task("t1", "m1", { status: "DONE", lastTouchedAt: iso(-3) }),
        task("t2", "m1", { status: "DONE", lastTouchedAt: iso(-2) }),
      ],
      NOW,
    );
    expect(m[0].progressPct).toBe(100);
  });

  it("rounds to integer percent", () => {
    const m = computeMissionMetrics(
      [mission("m1")],
      [
        task("t1", "m1", { status: "DONE", lastTouchedAt: iso(-1) }),
        task("t2", "m1"),
        task("t3", "m1"),
      ],
      NOW,
    );
    // 1/3 = 33.33 → 33
    expect(m[0].progressPct).toBe(33);
  });

  it("returns null progressPct when mission has zero tasks (no signal)", () => {
    const m = computeMissionMetrics([mission("m1")], [], NOW);
    expect(m[0].progressPct).toBeNull();
    expect(m[0].totalTasks).toBe(0);
  });
});

describe("computeMissionMetrics · velocity (doneTodayCount)", () => {
  it("counts DONE tasks touched within the last 24h", () => {
    const m = computeMissionMetrics(
      [mission("m1")],
      [
        task("t1", "m1", { status: "DONE", lastTouchedAt: iso(-0.1) }), // 2.4h ago
        task("t2", "m1", { status: "DONE", lastTouchedAt: iso(-0.9) }), // ~21h ago
        task("t3", "m1", { status: "DONE", lastTouchedAt: iso(-2) }), // 2d ago
      ],
      NOW,
    );
    expect(m[0].doneTodayCount).toBe(2);
  });

  it("does NOT count OPEN tasks touched today (not done yet)", () => {
    const m = computeMissionMetrics(
      [mission("m1")],
      [task("t1", "m1", { status: "OPEN", lastTouchedAt: iso(-0.1) })],
      NOW,
    );
    expect(m[0].doneTodayCount).toBe(0);
  });
});

describe("computeMissionMetrics · overdue count", () => {
  it("counts open tasks whose dueDate is past", () => {
    const m = computeMissionMetrics(
      [mission("m1")],
      [
        task("t1", "m1", { dueDate: iso(-3) }), // 3 days overdue
        task("t2", "m1", { dueDate: iso(-1) }), // 1 day overdue
        task("t3", "m1", { dueDate: iso(2) }), // due in future
      ],
      NOW,
    );
    expect(m[0].overdueCount).toBe(2);
  });

  it("does NOT count DONE tasks even if their dueDate is past", () => {
    const m = computeMissionMetrics(
      [mission("m1")],
      [
        task("t1", "m1", {
          status: "DONE",
          dueDate: iso(-3),
          lastTouchedAt: iso(-3),
        }),
      ],
      NOW,
    );
    expect(m[0].overdueCount).toBe(0);
  });

  it("does NOT count CANCELLED tasks", () => {
    const m = computeMissionMetrics(
      [mission("m1")],
      [task("t1", "m1", { status: "CANCELLED", dueDate: iso(-3) })],
      NOW,
    );
    expect(m[0].overdueCount).toBe(0);
  });
});

describe("computeMissionMetrics · daysIdle", () => {
  it("is the floor-days from latest lastTouchedAt across the mission", () => {
    const m = computeMissionMetrics(
      [mission("m1")],
      [
        task("t1", "m1", { lastTouchedAt: iso(-7) }),
        task("t2", "m1", { lastTouchedAt: iso(-3) }), // latest
        task("t3", "m1", { lastTouchedAt: iso(-5) }),
      ],
      NOW,
    );
    expect(m[0].daysIdle).toBe(3);
  });

  it("falls back to updatedAt when lastTouchedAt is missing", () => {
    const m = computeMissionMetrics(
      [mission("m1")],
      [task("t1", "m1", { updatedAt: iso(-2) })],
      NOW,
    );
    expect(m[0].daysIdle).toBe(2);
  });

  it("is null when mission has zero tasks", () => {
    const m = computeMissionMetrics([mission("m1")], [], NOW);
    expect(m[0].daysIdle).toBeNull();
  });
});

describe("computeMissionMetrics · daysToDeadline", () => {
  it("returns positive days when deadline is in the future", () => {
    const m = computeMissionMetrics(
      [mission("m1", { deadline: iso(5) })],
      [],
      NOW,
    );
    expect(m[0].daysToDeadline).toBe(5);
  });

  it("returns negative days when deadline has passed", () => {
    const m = computeMissionMetrics(
      [mission("m1", { deadline: iso(-2) })],
      [],
      NOW,
    );
    expect(m[0].daysToDeadline).toBe(-2);
  });

  it("returns null when mission has no deadline", () => {
    const m = computeMissionMetrics([mission("m1")], [], NOW);
    expect(m[0].daysToDeadline).toBeNull();
  });
});

// ── buildMissionMatrixOptions ──────────────────────────────────

describe("buildMissionMatrixOptions", () => {
  it("filters out missions with zero tasks (no signal to compare)", () => {
    const options = buildMissionMatrixOptions(
      [mission("m1"), mission("m2")],
      [task("t1", "m1")],
      NOW,
    );
    expect(options.map((o) => o.id)).toEqual(["m1"]);
  });

  it("includes mission domain in the label · lowercased", () => {
    const options = buildMissionMatrixOptions(
      [mission("m1", { domain: "Health" })],
      [task("t1", "m1")],
      NOW,
    );
    expect(options[0].label).toMatch(/health/);
  });

  it("returns empty array when every mission has zero tasks", () => {
    const options = buildMissionMatrixOptions(
      [mission("m1"), mission("m2")],
      [],
      NOW,
    );
    expect(options).toEqual([]);
  });
});

// ── resolveMissionMatrixCell ───────────────────────────────────

describe("resolveMissionMatrixCell", () => {
  const opt = (m: Partial<MissionMatrixOption["_metrics"]>): MissionMatrixOption => ({
    id: "x",
    label: "x",
    _metrics: {
      id: "x",
      title: "x",
      domain: "x",
      progressPct: 50,
      doneTodayCount: 2,
      overdueCount: 1,
      daysIdle: 3,
      daysToDeadline: 7,
      totalTasks: 4,
      ...m,
    },
  });

  it("progress cell returns pct as value + score + display", () => {
    const cell = resolveMissionMatrixCell(
      opt({ progressPct: 50 }),
      MISSION_MATRIX_CRITERIA[0],
    );
    expect(cell.value).toBe(50);
    expect(cell.score).toBe(50);
    expect(cell.display).toBe("50%");
  });

  it("progress cell shows '—' when progressPct is null", () => {
    const cell = resolveMissionMatrixCell(
      opt({ progressPct: null }),
      MISSION_MATRIX_CRITERIA[0],
    );
    expect(cell.value).toBeNull();
    expect(cell.display).toBe("—");
  });

  it("stale cell shows 'today' when daysIdle is 0", () => {
    const cell = resolveMissionMatrixCell(
      opt({ daysIdle: 0 }),
      MISSION_MATRIX_CRITERIA[3],
    );
    expect(cell.display).toBe("today");
  });

  it("deadline cell shows 'Nd past' for negative days", () => {
    const cell = resolveMissionMatrixCell(
      opt({ daysToDeadline: -3 }),
      MISSION_MATRIX_CRITERIA[4],
    );
    expect(cell.display).toBe("3d past");
  });

  it("deadline cell shows '—' when null · no score (informational)", () => {
    const cell = resolveMissionMatrixCell(
      opt({ daysToDeadline: null }),
      MISSION_MATRIX_CRITERIA[4],
    );
    expect(cell.value).toBeNull();
    expect(cell.display).toBe("—");
    expect(cell.score).toBeUndefined();
  });

  it("returns { value: null } for an unknown criterion id (defensive)", () => {
    const cell = resolveMissionMatrixCell(opt({}), {
      id: "unknown",
      label: "x",
    });
    expect(cell.value).toBeNull();
  });
});

// ── Criteria contract ───────────────────────────────────────────

describe("MISSION_MATRIX_CRITERIA · contract", () => {
  it("has exactly 5 columns (the brief locked this)", () => {
    expect(MISSION_MATRIX_CRITERIA.length).toBe(5);
  });

  it("progress + velocity are higher-is-better", () => {
    expect(MISSION_MATRIX_CRITERIA[0]).toMatchObject({
      id: "progress",
      higherIsBetter: true,
    });
    expect(MISSION_MATRIX_CRITERIA[1]).toMatchObject({
      id: "velocity",
      higherIsBetter: true,
    });
  });

  it("overdue + stale are lower-is-better", () => {
    expect(MISSION_MATRIX_CRITERIA[2]).toMatchObject({
      id: "overdue",
      higherIsBetter: false,
    });
    expect(MISSION_MATRIX_CRITERIA[3]).toMatchObject({
      id: "stale",
      higherIsBetter: false,
    });
  });

  it("deadline is informational · no higherIsBetter set", () => {
    expect(MISSION_MATRIX_CRITERIA[4].id).toBe("deadline");
    expect(MISSION_MATRIX_CRITERIA[4].higherIsBetter).toBeUndefined();
  });
});
