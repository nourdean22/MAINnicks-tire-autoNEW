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

// Update schema — mirrors missionBaseSchema field-for-field but WITHOUT
// the .default() wrappers. zod v4 applies defaults even under
// .partial(), so the previous `missionBaseSchema.partial()` injected
// domain/priority/roiScore/neglectCost into EVERY parsed partial PATCH —
// and updateMission spreads payload straight into mission.update, so the
// /missions archive tap (PATCH { status: "KILLED" }) reset the mission's
// domain to PERSONAL and its priority/ROI/neglect scores to the neutral
// create defaults. The tRPC missionUpdate call-sites ({ status } ·
// { planData } · { status, ...meta }) hit the same trap. On update, an
// absent key means "don't change".
// Keep this field-for-field in sync with missionBaseSchema — the
// keys-parity guard in tests/lib/services/update-partial-default-
// injection.test.ts fails if the two drift.
export const missionUpdateSchema = z
  .object({
    title: requiredString("Mission title"),
    domain: z.enum(missionDomainValues),
    status: z.enum(missionStatusValues),
    priority: integerRange(1, 10),
    roiScore: integerRange(1, 100),
    neglectCost: integerRange(1, 100),
    successMetric: nullableString,
    deadline: nullableDate,
    weeklyReviewNote: nullableString,
    manualRankOverride: nullableInteger(1, 999),
    planData: z.unknown()
  })
  .partial();
