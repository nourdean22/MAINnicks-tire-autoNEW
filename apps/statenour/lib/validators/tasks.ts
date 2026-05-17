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
export const loopKindValues = ["ONCE", "DAILY", "PROMISE"] as const;

const taskBaseSchema = z.object({
  title: requiredString("Task title"),
  missionId: requiredString("Mission"),
  status: z.enum(taskStatusValues).default("INBOX"),
  nextPhysicalAction: requiredString("Next physical action"),
  effort: z.enum(effortBandValues),
  roiScore: integerRange(1, 100),
  frictionScore: integerRange(1, 100),
  energyRequired: z.enum(energyLevelValues),
  context: z.enum(taskContextValues),
  delegatable: booleanFlag.default(false),
  waitingOn: nullableString.optional(),
  dueDate: nullableDate.optional(),
  lastTouchedAt: nullableDate.optional(),
  driftRisk: integerRange(0, 100).default(0),
  manualPriorityOverride: nullableInteger(1, 999).optional(),
  finishCondition: requiredString("Finish condition"),
  autoPriorityExplanation: optionalString,
  // ── Loops unification (Apr 15) ──
  loopKind: z.enum(loopKindValues).default("ONCE"),
  promiseTo: nullableString.optional(),
  lastCompletedAt: nullableDate.optional(),
  streakCount: integerRange(0, 9999).default(0),
  // ── Lineage + time tracking (Apr 15 pt 2) ──
  goalId: nullableString.optional(),
  phaseName: nullableString.optional(),
  actualMinutes: integerRange(0, 9999).default(0),
  startedAt: nullableDate.optional(),
});

export const taskCreateSchema = taskBaseSchema;
export const taskUpdateSchema = taskBaseSchema.partial();
