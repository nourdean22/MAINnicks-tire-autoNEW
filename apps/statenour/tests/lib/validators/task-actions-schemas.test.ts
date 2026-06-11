/**
 * Actions-slice contract tests · Phase WW (2026-05-22 ·
 * legacy-modernizer REST→tRPC actions slice).
 *
 * The actions slice migrated 14 client files (components/actions/* +
 * components/plan|missions|goals/*) off `authedFetch` onto
 * `trpc.task.*`. The risk that migration introduces is the
 * typed-payload-mismatch class: a client payload TypeScript accepts
 * but the server Zod input rejects at runtime, surfacing as a
 * generic failure toast (the /tasks quick-add bug, 2026-05-21).
 *
 * Two groups of new `task` router procedures have genuinely
 * structured inputs:
 *
 *   1. SHARED-SCHEMA procedures · `task.update` takes
 *      `taskUpdateSchema` from @/lib/validators/tasks · `task.goalsCreate`
 *      / `task.goalsUpdate` take `createGoalSchema` / `updateGoalSchema`
 *      from @/lib/services/goals. These are the EXACT schemas the
 *      legacy REST routes (PATCH /api/tasks/[id], POST/PATCH /api/goals)
 *      parse — and the same schemas `updateTask` / `createGoal` /
 *      `updateGoal` re-parse internally. The contract IS the schema, so
 *      these tests pin the real call-site payloads against it.
 *
 *   2. SCALAR-INPUT procedures · `domainSwap` · `missionLinkCreate` ·
 *      `missionLinkDelete` · `missionLinks` · `missionUpdate` ·
 *      `spawnTasks` · `goalNextActions` take bare scalar / small-object
 *      inputs declared inline in lib/trpc/routers/task.ts. Their
 *      `.input(...)` objects are re-declared here verbatim so a
 *      tightened bound fails CI before it breaks a real call-site.
 *
 * Pure schema parse, no Prisma — the contract is the schema, so the
 * test is too.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { taskUpdateSchema } from "@/lib/validators/tasks";
import { createGoalSchema, updateGoalSchema } from "@/lib/services/goals";

// ──────────────────── task.update · taskUpdateSchema ────────────────────
//
// task.update's input is z.object({ id, fields: taskUpdateSchema }).
// The `fields` payloads below are the exact partial-update objects the
// migrated call-sites send. taskUpdateSchema = taskBaseSchema.partial(),
// so every key is optional · the call-sites send 1-2 keys at a time.

describe("taskUpdateSchema · task.update call-site payloads", () => {
  it("accepts a status-only update (link-project / review-wizard / mode-track / project-detail)", () => {
    // killTask / archiveDone / handleWarningKill → { status: "ARCHIVED" }
    expect(() => taskUpdateSchema.parse({ status: "ARCHIVED" })).not.toThrow();
    // bulkSnooze → { status: "WAITING" }
    expect(() => taskUpdateSchema.parse({ status: "WAITING" })).not.toThrow();
    // switchStatus walks INBOX → READY → DOING
    for (const status of ["INBOX", "READY", "DOING", "DONE"] as const) {
      expect(() => taskUpdateSchema.parse({ status })).not.toThrow();
    }
  });

  it("accepts a goalId link payload — a non-null string (link-goal-picker / project-card)", () => {
    const r = taskUpdateSchema.parse({ goalId: "clx9k2p4t0001abcd1234efgh" });
    expect(r.goalId).toBe("clx9k2p4t0001abcd1234efgh");
  });

  it("accepts a goalId unlink payload — null (link-goal-picker / project-card)", () => {
    // goalId is nullableString — `null` is a legitimate unlink value.
    expect(() => taskUpdateSchema.parse({ goalId: null })).not.toThrow();
    expect(taskUpdateSchema.parse({ goalId: null }).goalId).toBeNull();
  });

  it("accepts a missionId link payload — a non-null string (link-project-picker)", () => {
    // handleLink → { missionId: <project id> }
    const r = taskUpdateSchema.parse({ missionId: "clx9k2p4t0001abcd1234efgh" });
    expect(r.missionId).toBe("clx9k2p4t0001abcd1234efgh");
  });

  it("rejects a missionId unlink payload — null (the leave-mission flow is pre-broken)", () => {
    // Task.missionId is a non-null FK (prisma/schema.prisma) and
    // missionId is requiredString in taskBaseSchema → `.partial()`
    // makes it optional but NOT nullable. The legacy "leave mission"
    // PATCH already fails this payload at updateTask()'s internal
    // parse; the migrated call-sites that send `missionId: null`
    // (link-project-picker.handleLeave, project-detail.clearInbox +
    // the remove-from-project chip) were intentionally LEFT on
    // authedFetch for exactly this reason. This test pins WHY.
    expect(() => taskUpdateSchema.parse({ missionId: null })).toThrow();
  });

  it("accepts a title-only rename payload (project-detail.saveRename)", () => {
    expect(() => taskUpdateSchema.parse({ title: "Rebuild the brake bay" })).not.toThrow();
  });

  it("rejects an empty title — requiredString min(1) is the guard", () => {
    expect(() => taskUpdateSchema.parse({ title: "" })).toThrow();
  });

  it("rejects an unknown status — the enum is the guard", () => {
    expect(() =>
      taskUpdateSchema.parse({ status: "SNOOZED" as unknown as "WAITING" }),
    ).toThrow();
  });

  it("accepts a `snoozedUntil` key — Wave AL added it to the validator", () => {
    // Pre-Wave-AL the validator had no snoozedUntil, so Zod stripped it and
    // the snooze date never persisted. Wave AL (2026-05-28) added
    // `snoozedUntil: nullableDate.optional()` to taskBaseSchema to unlock the
    // WAITING→READY resurface cron end-to-end — so the key now survives parse.
    const until = new Date().toISOString();
    const r = taskUpdateSchema.parse({
      status: "WAITING",
      snoozedUntil: until,
    });
    expect(r.status).toBe("WAITING");
    expect((r as Record<string, unknown>).snoozedUntil).toBeDefined();
  });

  it("accepts completionNote and outcomeScore", () => {
    const r = taskUpdateSchema.parse({
      completionNote: "Finished successfully",
      outcomeScore: 85,
    });
    expect(r.completionNote).toBe("Finished successfully");
    expect(r.outcomeScore).toBe(85);
  });

  it("rejects invalid outcomeScore", () => {
    expect(() => taskUpdateSchema.parse({ outcomeScore: 0 })).toThrow();
    expect(() => taskUpdateSchema.parse({ outcomeScore: 101 })).toThrow();
  });
});

// ───────────────── task.goalsCreate · createGoalSchema ──────────────────
//
// task.goalsCreate's input IS createGoalSchema. The payloads below are
// what goal-board.adoptSuggestion / addManual forward.

describe("createGoalSchema · task.goalsCreate call-site payloads", () => {
  it("accepts the adoptSuggestion payload (every AI-suggested field populated)", () => {
    const r = createGoalSchema.parse({
      domain: "business",
      title: "Hit 50K social interactions",
      metric: "interactions",
      targetValue: 50000,
      unit: "interactions",
      horizon: "LIFE",
      why: "compounding reach feeds every booking channel",
    });
    expect(r.title).toBe("Hit 50K social interactions");
    expect(r.targetValue).toBe(50000);
  });

  it("accepts the addManual payload — domain + title + horizon, why omitted", () => {
    // addManual sends `horizon: newHorizon || undefined` · the typed
    // task.goalsCreate input forces the field-omitted shape rather
    // than the legacy `|| null`, which createGoalSchema rejects.
    expect(() =>
      createGoalSchema.parse({
        domain: "personal",
        title: "Read 24 books this year",
        horizon: "YEAR",
      }),
    ).not.toThrow();
  });

  it("accepts a bare domain + title — every other field is optional", () => {
    expect(() =>
      createGoalSchema.parse({ domain: "personal", title: "Ship the OS v11" }),
    ).not.toThrow();
  });

  it("rejects an empty title — min(1) is the guard", () => {
    expect(() =>
      createGoalSchema.parse({ domain: "personal", title: "" }),
    ).toThrow();
  });

  it("rejects a horizon outside the enum — the enum is the guard", () => {
    expect(() =>
      createGoalSchema.parse({
        domain: "personal",
        title: "x",
        horizon: "DECADE" as unknown as "YEAR",
      }),
    ).toThrow();
  });

  it("rejects a null horizon — optional enum is not nullable (the legacy addManual bug)", () => {
    expect(() =>
      createGoalSchema.parse({
        domain: "personal",
        title: "x",
        horizon: null as unknown as undefined,
      }),
    ).toThrow();
  });
});

// ───────────────── task.goalsUpdate · updateGoalSchema ──────────────────
//
// task.goalsUpdate's input IS updateGoalSchema. The payloads below are
// what goal-board (archiveGoal · submitProgressLog · saveEdit) +
// review-wizard.pauseGoal + mode-track.handleGoalArchive forward.

describe("updateGoalSchema · task.goalsUpdate call-site payloads", () => {
  it("accepts the pause payload — { id, status: 'paused' }", () => {
    // archiveGoal / pauseGoal / handleGoalArchive all send this.
    const r = updateGoalSchema.parse({ id: "goal-1", status: "paused" });
    expect(r.status).toBe("paused");
  });

  it("accepts the progress-log payload — { id, progressDelta }", () => {
    // submitProgressLog sends a non-zero number (can be negative).
    expect(() =>
      updateGoalSchema.parse({ id: "goal-1", progressDelta: 1500 }),
    ).not.toThrow();
    expect(() =>
      updateGoalSchema.parse({ id: "goal-1", progressDelta: -3 }),
    ).not.toThrow();
  });

  it("accepts the full saveEdit delta payload", () => {
    // goal-board.saveEdit builds a delta with any of title/why/horizon/
    // targetValue/metric/unit/deadline/domain/status.
    const r = updateGoalSchema.parse({
      id: "goal-1",
      title: "Hit 60K interactions",
      why: "scope bumped after Q2 review",
      horizon: "LIFE",
      targetValue: 60000,
      metric: "interactions",
      unit: "interactions",
      deadline: "2026-12-31T23:59:59.000Z",
      domain: "business",
      status: "active",
    });
    expect(r.targetValue).toBe(60000);
    expect(r.deadline).toBe("2026-12-31T23:59:59.000Z");
  });

  it("accepts a saveEdit payload that clears the deadline — deadline is nullable", () => {
    // saveEdit sends `deadline: null` when the date field is blank.
    expect(() =>
      updateGoalSchema.parse({ id: "goal-1", title: "x", deadline: null }),
    ).not.toThrow();
  });

  it("requires a non-empty id — the goal being updated", () => {
    expect(() => updateGoalSchema.parse({ id: "", status: "paused" })).toThrow();
  });

  it("rejects an unknown status — the enum is the guard", () => {
    expect(() =>
      updateGoalSchema.parse({
        id: "goal-1",
        status: "archived" as unknown as "paused",
      }),
    ).toThrow();
  });

  it("rejects a non-ISO deadline — datetime() is the guard", () => {
    expect(() =>
      updateGoalSchema.parse({ id: "goal-1", deadline: "2026-12-31" }),
    ).toThrow();
  });
});

// ───────────────── task scalar-input procedures ─────────────────────────
//
// These procedures take scalar / small-object inputs declared inline in
// lib/trpc/routers/task.ts. The schemas below are the literal
// `.input(...)` objects — re-declared here so a tightened bound fails
// this test before it breaks a real call-site.

describe("task scalar-input procedures · call-site payload contract", () => {
  // task.update — z.object({ id, fields }) · the `id` half. fields is
  // covered above.
  const taskUpdateIdInput = z.object({
    id: z.string().min(1).max(64),
    fields: taskUpdateSchema,
  });

  it("update accepts an { id, fields } envelope", () => {
    expect(() =>
      taskUpdateIdInput.parse({
        id: "clx9k2p4t0001abcd1234efgh",
        fields: { status: "ARCHIVED" },
      }),
    ).not.toThrow();
  });

  it("update rejects an empty id", () => {
    expect(() =>
      taskUpdateIdInput.parse({ id: "", fields: { status: "DONE" } }),
    ).toThrow();
  });

  // task.domainSwap — loop-stream.onCommitDomainSwap sends { id, domain }
  // where domain is a free-text label ("business", "health", etc).
  const domainSwapInput = z.object({
    id: z.string().min(1).max(64),
    domain: z.string().min(1).max(50),
  });

  it("domainSwap accepts the loop-stream { id, domain } payload", () => {
    for (const domain of ["business", "personal", "health", "content", "finance"]) {
      expect(() =>
        domainSwapInput.parse({ id: "task-1", domain }),
      ).not.toThrow();
    }
  });

  it("domainSwap rejects an empty domain", () => {
    expect(() => domainSwapInput.parse({ id: "task-1", domain: "" })).toThrow();
  });

  // task.missionUpdate — review-wizard.archiveProject sends
  // { id, fields: { status } } · project-detail.reorderPhase sends
  // { id, fields: { planData } } · saveEdit sends { id, fields: {...meta} }.
  const missionUpdateInput = z.object({
    id: z.string().min(1).max(64),
    fields: z.record(z.string(), z.unknown()),
  });

  it("missionUpdate accepts a status-only fields payload (review-wizard)", () => {
    expect(() =>
      missionUpdateInput.parse({ id: "m-1", fields: { status: "PAUSED" } }),
    ).not.toThrow();
  });

  it("missionUpdate accepts a planData fields payload (project-detail.reorderPhase)", () => {
    // planData is an arbitrarily-nested plan object · z.unknown() values.
    expect(() =>
      missionUpdateInput.parse({
        id: "m-1",
        fields: { planData: { phases: [{ name: "Phase 1", steps: [] }] } },
      }),
    ).not.toThrow();
  });

  it("missionUpdate rejects an empty id", () => {
    expect(() =>
      missionUpdateInput.parse({ id: "", fields: { status: "PAUSED" } }),
    ).toThrow();
  });

  // task.missionLinks — linked-missions-panel reads links for one mission.
  const missionLinksInput = z.object({
    missionId: z.string().min(1).max(64),
  });

  it("missionLinks accepts a { missionId } payload", () => {
    expect(() =>
      missionLinksInput.parse({ missionId: "m-1" }),
    ).not.toThrow();
  });

  // task.missionLinkCreate — linked-missions-panel.addLink sends
  // { sourceId, targetId, relation } · relation from a 5-value select.
  const missionLinkCreateInput = z.object({
    sourceId: z.string().min(1).max(64),
    targetId: z.string().min(1).max(64),
    relation: z.string().max(40).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  });

  it("missionLinkCreate accepts the addLink payload across every relation", () => {
    for (const relation of [
      "related",
      "depends-on",
      "blocks",
      "supersedes",
      "spawned-from",
    ]) {
      expect(() =>
        missionLinkCreateInput.parse({
          sourceId: "m-1",
          targetId: "m-2",
          relation,
        }),
      ).not.toThrow();
    }
  });

  it("missionLinkCreate accepts a payload with relation + note omitted", () => {
    expect(() =>
      missionLinkCreateInput.parse({ sourceId: "m-1", targetId: "m-2" }),
    ).not.toThrow();
  });

  it("missionLinkCreate rejects an empty sourceId / targetId", () => {
    expect(() =>
      missionLinkCreateInput.parse({ sourceId: "", targetId: "m-2" }),
    ).toThrow();
    expect(() =>
      missionLinkCreateInput.parse({ sourceId: "m-1", targetId: "" }),
    ).toThrow();
  });

  // task.missionLinkDelete — linked-missions-panel.removeLink sends { linkId }.
  const missionLinkDeleteInput = z.object({
    linkId: z.string().min(1).max(64),
  });

  it("missionLinkDelete accepts a { linkId } payload", () => {
    expect(() => missionLinkDeleteInput.parse({ linkId: "link-1" })).not.toThrow();
  });

  it("missionLinkDelete rejects an empty linkId", () => {
    expect(() => missionLinkDeleteInput.parse({ linkId: "" })).toThrow();
  });

  // task.spawnTasks — milestones-flow + project-detail send
  // { missionId, phaseIndex, goalId? }.
  const spawnTasksInput = z.object({
    missionId: z.string().min(1).max(64),
    phase: z.string().max(200).optional(),
    phaseIndex: z.number().int().min(0).max(200).optional(),
    all: z.boolean().optional(),
    goalId: z.string().max(64).nullable().optional(),
  });

  it("spawnTasks accepts the milestones-flow { missionId, phaseIndex, goalId } payload", () => {
    const r = spawnTasksInput.parse({
      missionId: "m-1",
      phaseIndex: 0,
      goalId: "goal-1",
    });
    expect(r.phaseIndex).toBe(0);
  });

  it("spawnTasks accepts the project-detail { missionId, phaseIndex } payload (no goalId)", () => {
    expect(() =>
      spawnTasksInput.parse({ missionId: "m-1", phaseIndex: 2 }),
    ).not.toThrow();
  });

  it("spawnTasks rejects a negative phaseIndex", () => {
    expect(() =>
      spawnTasksInput.parse({ missionId: "m-1", phaseIndex: -1 }),
    ).toThrow();
  });

  it("spawnTasks rejects an empty missionId", () => {
    expect(() =>
      spawnTasksInput.parse({ missionId: "", phaseIndex: 0 }),
    ).toThrow();
  });

  // task.goalNextActions — GoalNextActionsCard fetches with no input;
  // the schema accepts an optional limit (1..20) for future callers.
  const goalNextActionsInput = z
    .object({ limit: z.number().int().min(1).max(20).optional() })
    .optional();

  it("goalNextActions accepts the no-arg GoalNextActionsCard call", () => {
    expect(() => goalNextActionsInput.parse(undefined)).not.toThrow();
  });

  it("goalNextActions rejects a limit above the 20-row cap", () => {
    expect(() => goalNextActionsInput.parse({ limit: 50 })).toThrow();
  });

  // task.events — event-timeline reads { taskId } (limit defaults to 50).
  const taskEventsInput = z.object({
    taskId: z.string().min(1).max(64),
    limit: z.number().int().min(1).max(100).default(50),
  });

  it("events accepts the event-timeline { taskId } payload", () => {
    const r = taskEventsInput.parse({ taskId: "clx9k2p4t0001abcd1234efgh" });
    expect(r.limit).toBe(50);
  });

  it("events rejects an empty taskId", () => {
    expect(() => taskEventsInput.parse({ taskId: "" })).toThrow();
  });
});
