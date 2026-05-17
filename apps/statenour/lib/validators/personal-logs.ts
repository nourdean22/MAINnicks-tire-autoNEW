import { z } from "zod";

import {
  booleanFlag,
  integerRange,
  nullableNumber,
  nullableString
} from "@/lib/validators/shared";

const personalLogBaseSchema = z.object({
  logDate: z.coerce.date(),
  sleepHours: nullableNumber(0, 24).optional(),
  energyScore: z.preprocess(
    (value) => (value === "" || value == null ? null : value),
    z.coerce.number().int().min(1).max(10).nullable()
  ),
  moodScore: z.preprocess(
    (value) => (value === "" || value == null ? null : value),
    z.coerce.number().int().min(1).max(10).nullable()
  ),
  workoutCompleted: booleanFlag.default(false),
  supplements: nullableString.optional(),
  deepWorkBlocks: integerRange(0, 24).default(0),
  revenueMoves: integerRange(0, 50).default(0),
  driftIncidents: integerRange(0, 20).default(0),
  distractionFlag: booleanFlag.default(false),
  socialFamilyAction: booleanFlag.default(false),
  notes: nullableString.optional(),
  tomorrowConstraint: nullableString.optional()
});

export const personalLogCreateSchema = personalLogBaseSchema;
export const personalLogUpdateSchema = personalLogBaseSchema.partial();
