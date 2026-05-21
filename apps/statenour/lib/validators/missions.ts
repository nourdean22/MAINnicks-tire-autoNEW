import { z } from "zod";

import { missionDomainValues, missionStatusValues } from "@/lib/domain";
import { integerRange, nullableDate, nullableInteger, nullableString, requiredString } from "@/lib/validators/shared";

const missionBaseSchema = z.object({
  title: requiredString("Mission title"),
  // Thin mission-create callers — getInbox()'s auto-Inbox creation on
  // /tasks, and future AI / omni-capture → mission paths — supply only
  // a title. Pre-2026-05-21 domain/priority/roiScore/neglectCost were
  // required with no default, so missionCreateSchema.parse() threw a
  // ZodError for every thin payload (the same drift class as
  // taskCreateSchema · task.create + task.createMission are the only
  // two tRPC mutations behind a permissive z.record() input). They now
  // default to neutral values; the mission editor still sends explicit
  // values and enforces completeness client-side.
  domain: z.enum(missionDomainValues).default("PERSONAL"),
  status: z.enum(missionStatusValues).default("ACTIVE"),
  priority: integerRange(1, 10).default(5),
  roiScore: integerRange(1, 100).default(50),
  neglectCost: integerRange(1, 100).default(50),
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
