/**
 * Completing a task must record that it was completed. BEHAVIOURALLY.
 *
 * THE ORIGINAL DEFECT, 2026-08-23. `task_events` held 294 rows across
 * created / revived / reframed / started / snoozed and ZERO "completed".
 * During an incident its silence was nearly read as "no completion was
 * attempted".
 *
 * CORRECTION, made during adversarial review: an earlier draft of this file
 * said "the kind existed in the union; no call site ever emitted it". That is
 * FALSE and is exactly the kind of unverified claim this repo keeps paying
 * for. TWO emitters existed — tasks.ts:1038, annotated in-source as
 * UNREACHABLE, and app/api/realtime/tool-call/route.ts, which only fires on a
 * voice completion. Neither had ever produced a row. The gap was this spine.
 *
 * THE DEFECT IN THE FIRST FIX — which is why this file exists. The emit was
 * added near the END of `checkTask`, and `checkTask` returns early for
 * recurring completions long before reaching it:
 *
 *     task-actions.ts:197   if ((loopKind === "DAILY" || "WEEKLY") && action === "complete") {
 *     task-actions.ts:314       return { ok: true, task: updated, ... }   ← exits here
 *     task-actions.ts:611   emitTaskEventAsync({ kind: "completed" })     ← never reached
 *
 * So DAILY and WEEKLY completions still emitted nothing. That is not a
 * marginal case: /missions routes recurring completions to `trpc.task.check`,
 * and the NON-recurring route (`trpc.task.update`) short-circuits into
 * checkTask anyway (tasks.ts:891, `isCompletionTransition`) — the emit at
 * tasks.ts:1031 is annotated in-source "★ UNREACHABLE since the
 * isCompletionTransition short-circuit above". Both UI routes converge here,
 * so the recurring branch was the whole remaining hole.
 *
 * WHY BEHAVIOURAL AND NOT SOURCE-TEXT. The first attempt asserted that the
 * string `kind: "completed"` appeared between two function declarations. That
 * assertion passes whether or not the line is reachable — it was green over a
 * live blind spot. It also claimed no harness could drive checkTask without a
 * large mock; that claim was false. tests/lib/services/task-actions-cascade.test.ts
 * and task-actions-daily-streak.test.ts have driven checkTask for weeks with
 * roughly the mock surface reproduced below. An instrument that cannot observe
 * its subject is worse than none, because its silence gets mistaken for
 * evidence — and a test that cannot observe reachability is the same thing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({
  task: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
  },
  mission: { findUnique: vi.fn(), findMany: vi.fn() },
  brainMemory: { findMany: vi.fn(), upsert: vi.fn() },
  emitTaskEventAsync: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: mocks.task,
    mission: mocks.mission,
    brainMemory: mocks.brainMemory,
    $transaction: vi.fn(async (fn) =>
      fn({ task: mocks.task, mission: mocks.mission, brainMemory: mocks.brainMemory }),
    ),
  },
}));

vi.mock("@/lib/db/entity-audit", () => ({
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  stripNoise: vi.fn((x) => x),
}));
vi.mock("@/lib/cache/dashboard-cache", () => ({ invalidateMutationCaches: vi.fn() }));
vi.mock("@/lib/brain/task-events", () => ({
  emitTaskEventAsync: mocks.emitTaskEventAsync,
  emitTaskCompleted: vi.fn(),
}));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitTaskCompleted: vi.fn(async () => undefined) }));
vi.mock("@/lib/services/auto-learn", () => ({ runAutoLearn: vi.fn(async () => null) }));
vi.mock("@/lib/services/skill-reinforce", () => ({ reinforceSkillFromTask: vi.fn(async () => null) }));
vi.mock("@/lib/mastery/goal-stats", () => ({
  creditTaskStats: vi.fn(async () => ({ statsCredited: 0, xpCredited: 0 })),
}));
vi.mock("@/lib/runtime", () => ({ isDemoMode: false }));

import { checkTask } from "@/lib/services/task-actions";

function setupTask(loopKind: string, over: Record<string, unknown> = {}) {
  mocks.task.findUnique.mockResolvedValueOnce({
    id: "t-1",
    title: "a task",
    finishCondition: "done",
    missionId: "mission-1",
    loopKind,
    status: "READY",
    lastCompletedAt: null,
    streakCount: 0,
    startedAt: null,
    actualMinutes: 0,
    context: "ANYWHERE",
    effort: "M30",
    autoPriority: 50,
    roiScore: 50,
    goalId: null,
    mission: { title: "Mission 1", domain: "test" },
    goal: null,
    ...over,
  });
  mocks.task.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: "t-1",
    title: "a task",
    loopKind,
    status: args.data.status ?? "DONE",
    actualMinutes: 0,
    effort: "M30",
    streakCount: args.data.streakCount ?? 0,
    lastCompletedAt: args.data.lastCompletedAt ?? null,
  }));
  mocks.task.findMany.mockResolvedValue([]);
}

const completions = () =>
  mocks.emitTaskEventAsync.mock.calls
    .map((c) => c[0])
    .filter((e) => e?.kind === "completed");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brainMemory.findMany.mockResolvedValue([]);
  mocks.brainMemory.upsert.mockResolvedValue({});
});

describe("checkTask emits a completion event on EVERY completing path", () => {
  it("ONCE — the non-recurring completion", async () => {
    setupTask("ONCE");
    await checkTask({ id: "t-1", action: "complete" });
    expect(completions()).toHaveLength(1);
    expect(completions()[0]).toMatchObject({ taskId: "t-1", source: "service:checkTask" });
  });

  it("DAILY — the path the first fix missed entirely", async () => {
    // Returns at task-actions.ts:314, ~300 lines before the original emit.
    setupTask("DAILY");
    await checkTask({ id: "t-1", action: "complete" });
    expect(
      completions(),
      "a DAILY completion is a real completion — it credits a streak and stats",
    ).toHaveLength(1);
    expect(completions()[0]).toMatchObject({ taskId: "t-1" });
  });

  it("WEEKLY — same branch, same hole", async () => {
    setupTask("WEEKLY");
    await checkTask({ id: "t-1", action: "complete" });
    expect(completions()).toHaveLength(1);
  });

  it("attribution travels through BOTH paths — ONCE and recurring", async () => {
    // The voice route (app/api/realtime/tool-call) used to emit its own event
    // purely to keep `source: "voice:completeTask"`, which the history and
    // pattern views read. That duplicate is gone, so this parameter is now the
    // ONLY carrier of surface attribution — and a mutation that made the
    // recurring branch ignore it survived the first version of this file.
    setupTask("ONCE");
    await checkTask({ id: "t-1", action: "complete", eventSource: "voice:completeTask" });
    expect(completions()[0].source).toBe("voice:completeTask");

    vi.clearAllMocks();
    mocks.brainMemory.findMany.mockResolvedValue([]);
    mocks.brainMemory.upsert.mockResolvedValue({});

    // A voice-completed DAILY habit is an ordinary case, not an exotic one.
    setupTask("DAILY");
    await checkTask({ id: "t-1", action: "complete", eventSource: "voice:completeTask" });
    expect(
      completions()[0].source,
      "the recurring branch has its own emit — it must not hardcode the default",
    ).toBe("voice:completeTask");
  });

  it("the emit does NOT arm the witnessed-commitment resolver", async () => {
    // lib/brain/task-events.ts resolves ACTIVE WITNESSED_COMMITMENT agenda items
    // by fuzzy title match when kind==="completed" AND the emit opts in. It had
    // never executed: zero completed events ever, zero RESOLVED agenda rows.
    // Wiring this event without the opt-in would have made an observability fix
    // the first thing ever to rewrite 35 of the operator's personal commitments,
    // with no confirmation and no undo. That is the operator's decision.
    setupTask("ONCE");
    await checkTask({ id: "t-1", action: "complete" });
    expect(completions()[0].resolveWitnessedCommitments).toBeUndefined();

    vi.clearAllMocks();
    mocks.brainMemory.findMany.mockResolvedValue([]);
    mocks.brainMemory.upsert.mockResolvedValue({});
    setupTask("DAILY");
    await checkTask({ id: "t-1", action: "complete" });
    expect(completions()[0].resolveWitnessedCommitments).toBeUndefined();
  });

  it("the recurring event carries its loopKind, so a reader can tell them apart", async () => {
    // Without this the two lanes are indistinguishable downstream, and a
    // completion-rate metric would silently blend habits with one-off work.
    setupTask("DAILY");
    await checkTask({ id: "t-1", action: "complete" });
    expect(completions()[0].payload).toMatchObject({ loopKind: "DAILY" });
  });
});

describe("NEGATIVE CONTROLS · non-completions must stay silent", () => {
  it("an idempotent same-day DAILY re-check emits NOTHING", async () => {
    // The task was already completed today. It returns at task-actions.ts:212
    // with idempotent:true and nothing is credited — emitting here would
    // inflate every completion count by the number of times the operator
    // tapped a habit twice, which is exactly the kind of fake signal this
    // whole change exists to prevent.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T15:00:00Z"));
    setupTask("DAILY", { lastCompletedAt: new Date("2026-07-16T13:00:00Z") });

    const result = await checkTask({ id: "t-1", action: "complete" });

    expect(result.idempotent).toBe(true);
    expect(completions()).toHaveLength(0);
    vi.useRealTimers();
  });

  it("breaking a PROMISE loop is not a completion", async () => {
    // "break" is the only non-complete action checkTask accepts —
    // CheckAction is `"complete" | "break"` (task-actions.ts:50) and the tRPC
    // input is z.enum(["complete","break"]). It returns at task-actions.ts:357,
    // also before the emit, and must stay silent: breaking a promise is the
    // opposite of completing it, and a completion-rate metric that counted it
    // would read best when the operator was failing most.
    setupTask("PROMISE");
    await checkTask({ id: "t-1", action: "break" });
    expect(completions()).toHaveLength(0);
  });

  it("break on a DAILY habit is REFUSED, not silently completed", () => {
    // Found while auditing which paths reach the emit. The DAILY guard requires
    // action==="complete" and the PROMISE guard requires loopKind==="PROMISE",
    // so a DAILY task sent "break" matched neither and fell into the ONCE
    // completion path: status DONE, startedAt nulled, the recurrence destroyed,
    // and a "completed" event emitted whose payload said action:"break".
    setupTask("DAILY");
    return expect(checkTask({ id: "t-1", action: "break" })).rejects.toThrow(/PROMISE/);
  });

  it("…and nothing was written when it refused", async () => {
    setupTask("WEEKLY");
    await expect(checkTask({ id: "t-1", action: "break" })).rejects.toThrow();
    expect(mocks.task.update).not.toHaveBeenCalled();
    expect(completions()).toHaveLength(0);
  });

  it("an unrecognised action string is COERCED to complete — documenting, not endorsing", () => {
    // The coercion `args.action === "break" ? "break" : "complete"` still exists,
    // so any unexpected value would complete the task. It is now unreachable by
    // accident: the parameter was narrowed from `string` to CheckAction, so the
    // compiler rejects "uncheck" at every in-process call site — and those three
    // callers bypass the tRPC zod enum entirely, which is why the type mattered.
    // Pinned so the coercion is discovered by reading a test, not an incident.
    const src = readFileSync(resolve(process.cwd(), "lib/services/task-actions.ts"), "utf8");
    expect(src).toContain('args.action === "break" ? "break" : "complete"');
  });
});
