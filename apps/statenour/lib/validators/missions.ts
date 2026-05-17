import { z } from "zod";

import { missionDomainValues, missionStatusValues } from "@/lib/domain";
import { integerRange, nullableDate, nullableInteger, nullableString, requiredString } from "@/lib/validators/shared";

const missionBaseSchema = z.object({
  title: requiredString("Mission title"),
  domain: z.enum(missionDomainValues),
  status: z.enum(missionStatusValues).default("ACTIVE"),
  priority: integerRange(1, 10),
  roiScore: integerRange(1, 100),
  neglectCost: integerRange(1, 100),
  successMetric: nullableString.optional(),
  deadline: nullableDate.optional(),
  weeklyReviewNote: nullableString.optional(),
  manualRankOverride: nullableInteger(1, 999).optional(),
  // May 02 · phase reorder + manual plan tweaks PATCH planData
  // through the same /api/missions/[id] route. Validator stays
  // permissive on shape since ProjectPlanData is a deep nested type
  // owned by the AI plan-project surface; the client-side
  // isProjectPlanData type-guard validates before render.
  planData: z.unknown().optional()
});

export const missionCreateSchema = missionBaseSchema;
export const missionUpdateSchema = missionBaseSchema.partial();
