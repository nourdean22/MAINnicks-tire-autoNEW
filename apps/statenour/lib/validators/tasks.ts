import { z } from "zod";

import { effortBandValues, energyLevelValues, taskContextValues, taskStatusValues } from "@/lib/domain";
import {
  booleanFlag,
  integerRange,
  nullableDate,
  nullableInteger,
  nullableString,
  optionalString,
  requiredString
} from "@/lib/validators/shared";

// Loop kind values — kept as a tuple here so zod can z.enum over them
// without importing a generated Prisma enum (the generated TS enum
// lives deep inside @prisma/client and reimporting breaks some
// runtimes). Keep this in sync with prisma/schema.prisma's LoopKind.
export const loopKindValues = ["ONCE", "DAILY", "PROMISE", "WEEKLY"] as const;

const taskBaseSchema = z.object({
  title: requiredString("Task title"),
  missionId: requiredString("Mission"),
  status: z.enum(taskStatusValues).default("INBOX"),
  // Quick-add, AI-capture, omni-capture and chat long-press all create
  // a task from little more than a title — they can't supply the
  // "describe the task" fields below. Pre-2026-05-21 these were
  // requiredString / bare-enum with no default, so every thin-payload
  // create path threw a ZodError inside createTask() and the operator
  // got a "Failed to add task" toast. They now default; the rich task
  // editor still sends explicit values and enforces its own
  // completeness client-side. createTask() upgrades an empty
  // nextPhysicalAction to the title so the column is never "".
  nextPhysicalAction: z.string().trim().default(""),
  effort: z.enum(effortBandValues).default("M15"),
  roiScore: integerRange(1, 100).default(50),
  frictionScore: integerRange(1, 100).default(50),
  energyRequired: z.enum(energyLevelValues).default("MEDIUM"),
  context: z.enum(taskContextValues).default("ANYWHERE"),
  delegatable: booleanFlag.default(false),
  waitingOn: nullableString.optional(),
  dueDate: nullableDate.optional(),
  lastTouchedAt: nullableDate.optional(),
  driftRisk: integerRange(0, 100).default(0),
  manualPriorityOverride: nullableInteger(1, 999).optional(),
  finishCondition: z.string().trim().default(""),
  autoPriorityExplanation: optionalString,
  // ── Loops unification (Apr 15) ──
  loopKind: z.enum(loopKindValues).default("ONCE"),
  promiseTo: nullableString.optional(),
  lastCompletedAt: nullableDate.optional(),
  streakCount: integerRange(0, 9999).default(0),
  // ── Wave AL · 2026-05-28 · recurring tasks ──
  // The schema field has existed since v6 (Task.snoozedUntil DateTime?
  // + the WAITING→READY auto-resurface cron at app/api/cron/task-
  // resurface). It was never in the validator · so updates couldn't
  // touch it. Operator complaint: "how come i cant create recurring
  // tasks?" — the DAILY completion path needs to set it. Adding it
  // here unlocks the existing infrastructure end-to-end.
  snoozedUntil: nullableDate.optional(),
  // 2026-06-06 · WEEKLY recurrence · which weekdays a WEEKLY loop recurs on
  // (0=Sun..6=Sat) · empty for other kinds. Optional so partial updates don't
  // reset it; create defaults to [] via the Prisma column default.
  recurringDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  // ── Lineage + time tracking (Apr 15 pt 2) ──
  goalId: nullableString.optional(),
  phaseName: nullableString.optional(),
  actualMinutes: integerRange(0, 9999).default(0),
  startedAt: nullableDate.optional(),
  // ── Subtask hierarchy (2026-05-23 · task #22 · ADR-0017) ──
  // Nullable self-FK · subtasks point at their parent · top-level
  // tasks have null. The createTask service inherits goalId from
  // the parent at create time when payload.goalId isn't set
  // (per amended Rule 2). Per Rule 4 the UI enforces 1-level depth ·
  // the schema permits N levels (graceful degradation if someone
  // ever bypasses the UI).
  parentTaskId: nullableString.optional(),
  completionNote: nullableString.optional(),
  outcomeScore: nullableInteger(1, 100).optional(),
});

export const taskCreateSchema = taskBaseSchema;
export const taskUpdateSchema = taskBaseSchema.partial();
