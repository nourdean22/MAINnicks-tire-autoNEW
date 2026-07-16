/**
 * tests/lib/services/update-partial-default-injection.test.ts ·
 * 2026-07-16.
 *
 * Locks the "an absent key means don't change" contract on the mission
 * and personal-log update schemas — the same zod-v4 defect already
 * fixed for tasks in lib/validators/tasks.ts.
 *
 * zod v4 applies .default() values even under .partial(): .partial()
 * marks a key not-required but does NOT unwrap the ZodDefault beneath
 * it, so an absent key still materializes its default. Both services
 * spread the parsed payload straight into prisma.*.update, so every
 * partial PATCH silently RESET the defaulted columns.
 *
 * Mocks prisma + side-effect modules · no real DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mission: {
    findUnique: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
  task: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mission: mocks.mission,
    task: mocks.task,
    $transaction: vi.fn(async (fn) =>
      fn({
        mission: mocks.mission,
        task: mocks.task,
      }),
    ),
  },
}));

vi.mock("@/lib/runtime", () => ({
  isDemoMode: false,
}));

vi.mock("@/lib/services/tasks", () => ({
  syncTaskPriorities: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db/entity-audit", () => ({
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  stripNoise: vi.fn((x) => x),
}));

vi.mock("@/lib/utils/cache", () => ({
  invalidate: vi.fn(),
}));

import { updateMission } from "@/lib/services/missions";
import { missionCreateSchema, missionUpdateSchema } from "@/lib/validators/missions";
import { personalLogCreateSchema, personalLogUpdateSchema } from "@/lib/validators/personal-logs";

/** Row shape for updateMission's `existing` lookup. */
function missionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    title: "Ship the thing",
    // Deliberately non-default values — a partial PATCH must leave every
    // one of these alone. The create defaults they'd be reset to are
    // PERSONAL / 5 / 50 / 50.
    domain: "BUSINESS",
    status: "ACTIVE",
    priority: 9,
    roiScore: 91,
    neglectCost: 88,
    successMetric: "revenue up",
    deadline: null,
    weeklyReviewNote: null,
    manualRankOverride: null,
    planData: null,
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("missionUpdateSchema · partial PATCH must not inject schema defaults", () => {
  it("parses a one-field payload down to exactly that field", () => {
    const parsed = missionUpdateSchema.parse({ status: "KILLED" });
    const definedKeys = Object.entries(parsed)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);
    // Pre-fix, zod v4 injected domain/priority/roiScore/neglectCost via
    // the .default() wrappers surviving .partial().
    expect(definedKeys).toEqual(["status"]);
  });

  it("does not coerce absent nullable keys to null", () => {
    // The nullable* helpers are z.preprocess(undefined -> null) pipes.
    // Dropping the .default() wrappers must not leave those firing on
    // absent keys — that would trade default-injection for a null-wipe
    // (a PATCH would blank successMetric/deadline/weeklyReviewNote).
    const parsed = missionUpdateSchema.parse({ priority: 9 });
    expect(Object.keys(parsed)).toEqual(["priority"]);
    expect("successMetric" in parsed).toBe(false);
    expect("deadline" in parsed).toBe(false);
  });

  it("missionCreateSchema still defaults a thin create payload", () => {
    // The fix must not over-correct: thin create paths (getInbox()'s
    // auto-Inbox creation, AI/omni-capture) rely on these defaults.
    const parsed = missionCreateSchema.parse({ title: "Thin" });
    expect(parsed).toMatchObject({
      title: "Thin",
      domain: "PERSONAL",
      status: "ACTIVE",
      priority: 5,
      roiScore: 50,
      neglectCost: 50,
    });
  });
});

describe("updateMission · the /missions archive tap", () => {
  it("writes only status — priority/ROI/domain/neglect survive", async () => {
    mocks.mission.findUnique.mockResolvedValue(missionRow());
    mocks.mission.update.mockResolvedValue(missionRow({ status: "KILLED" }));

    // Exactly what use-mission-actions.ts handleArchiveMission sends.
    await updateMission("m1", { status: "KILLED" });

    const write = mocks.mission.update.mock.calls[0][0];
    expect(write.data.status).toBe("KILLED");
    // The old defaulted-partial schema injected these on every PATCH —
    // archiving a BUSINESS/priority-9 mission rewrote it to
    // PERSONAL/priority-5 with neutral 50/50 scores.
    expect(write.data.domain).toBeUndefined();
    expect(write.data.priority).toBeUndefined();
    expect(write.data.roiScore).toBeUndefined();
    expect(write.data.neglectCost).toBeUndefined();
  });

  it("still persists the fields a PATCH does send", async () => {
    mocks.mission.findUnique.mockResolvedValue(missionRow());
    mocks.mission.update.mockResolvedValue(missionRow({ priority: 3 }));

    await updateMission("m1", { priority: 3, successMetric: "leads" });

    const write = mocks.mission.update.mock.calls[0][0];
    expect(write.data.priority).toBe(3);
    expect(write.data.successMetric).toBe("leads");
    expect(write.data.domain).toBeUndefined();
    expect(write.data.roiScore).toBeUndefined();
  });
});

describe("update schemas stay field-for-field in sync with their base", () => {
  // The no-defaults update schemas are hand-mirrored from their base, so
  // a field added to the base and forgotten here would silently become
  // un-updatable (parse drops the unknown key — a quieter bug than the
  // one being fixed). These guards turn that comment into a gate.
  it("missionUpdateSchema covers exactly missionCreateSchema's keys", () => {
    expect(Object.keys(missionUpdateSchema.shape).sort()).toEqual(
      Object.keys(missionCreateSchema.shape).sort(),
    );
  });

  it("personalLogUpdateSchema covers exactly personalLogCreateSchema's keys", () => {
    expect(Object.keys(personalLogUpdateSchema.shape).sort()).toEqual(
      Object.keys(personalLogCreateSchema.shape).sort(),
    );
  });
});

describe("personalLogUpdateSchema · partial PATCH must not inject schema defaults", () => {
  // Schema-level only: updatePersonalLog has no call-sites today, so
  // there is no live write path to assert against. The schema carried
  // the identical defect, and the service is already written to spread
  // payload into personalDailyLog.update — so this locks the contract
  // before that path is wired up.
  it("parses a one-field payload down to exactly that field", () => {
    const parsed = personalLogUpdateSchema.parse({ notes: "hello" });
    const definedKeys = Object.entries(parsed)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);
    // Pre-fix, zod v4 injected workoutCompleted/deepWorkBlocks/
    // revenueMoves/driftIncidents/distractionFlag/socialFamilyAction.
    // Worse than a plain reset: updatePersonalLog recomputes dailyScore
    // via `payload.x ?? existing.x`, and an injected `false`/`0` is a
    // real value, so the ?? fallback could not reach `existing` — the
    // score was recalculated from the zeroed fields too.
    expect(definedKeys).toEqual(["notes"]);
  });

  it("does not coerce absent nullable keys to null", () => {
    const parsed = personalLogUpdateSchema.parse({ workoutCompleted: true });
    expect(Object.keys(parsed)).toEqual(["workoutCompleted"]);
    expect("notes" in parsed).toBe(false);
    expect("supplements" in parsed).toBe(false);
  });

  it("personalLogCreateSchema still defaults, and still nulls empty scores", () => {
    const parsed = personalLogCreateSchema.parse({
      logDate: "2026-07-16",
      energyScore: "",
      moodScore: "",
    });
    expect(parsed).toMatchObject({
      workoutCompleted: false,
      deepWorkBlocks: 0,
      revenueMoves: 0,
      driftIncidents: 0,
      distractionFlag: false,
      socialFamilyAction: false,
      // The shared nullableScoreOneToTen preprocess still collapses the
      // form's "" for an untouched field to null.
      energyScore: null,
      moodScore: null,
    });
  });
});
