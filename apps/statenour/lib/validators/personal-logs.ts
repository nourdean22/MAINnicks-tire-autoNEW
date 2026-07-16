import { z } from "zod";

import {
  booleanFlag,
  integerRange,
  nullableNumber,
  nullableString
} from "@/lib/validators/shared";

// 1–10 self-report score · empty-string and null both collapse to null
// (the form posts "" for an untouched field). Shared by the create and
// update schemas so the two stay in sync.
const nullableScoreOneToTen = z.preprocess(
  (value) => (value === "" || value == null ? null : value),
  z.coerce.number().int().min(1).max(10).nullable()
);

const personalLogBaseSchema = z.object({
  logDate: z.coerce.date(),
  sleepHours: nullableNumber(0, 24).optional(),
  energyScore: nullableScoreOneToTen,
  moodScore: nullableScoreOneToTen,
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

// Update schema — mirrors personalLogBaseSchema field-for-field but
// WITHOUT the .default() wrappers. zod v4 applies defaults even under
// .partial(), so the previous `personalLogBaseSchema.partial()` injected
// workoutCompleted/deepWorkBlocks/revenueMoves/driftIncidents/
// distractionFlag/socialFamilyAction into EVERY parsed partial PATCH.
// updatePersonalLog spreads payload into personalDailyLog.update, so a
// notes-only PATCH would zero those columns — and corrupt twice over,
// because the `payload.x ?? existing.x` fallbacks that recompute
// dailyScore can't fall back through an injected `false`/`0` (it's a
// real value, not undefined), so the score was recomputed from the
// zeroed fields. On update, an absent key means "don't change".
// Keep this field-for-field in sync with personalLogBaseSchema — the
// keys-parity guard in tests/lib/services/update-partial-default-
// injection.test.ts fails if the two drift.
export const personalLogUpdateSchema = z
  .object({
    logDate: z.coerce.date(),
    sleepHours: nullableNumber(0, 24),
    energyScore: nullableScoreOneToTen,
    moodScore: nullableScoreOneToTen,
    workoutCompleted: booleanFlag,
    supplements: nullableString,
    deepWorkBlocks: integerRange(0, 24),
    revenueMoves: integerRange(0, 50),
    driftIncidents: integerRange(0, 20),
    distractionFlag: booleanFlag,
    socialFamilyAction: booleanFlag,
    notes: nullableString,
    tomorrowConstraint: nullableString
  })
  .partial();
