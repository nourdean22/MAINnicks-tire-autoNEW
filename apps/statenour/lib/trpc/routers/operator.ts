/**
 * lib/trpc/routers/operator.ts · Phase J (2026-05-18 PM)
 *
 * Operator-state procedures · forward-looking intelligence + chains.
 * Replaces:
 *   · GET /api/operator/pulse    → pulse
 *   · GET /api/operator/compound → compound
 *
 * Both are read-heavy + surface-aware · same heuristic composers
 * the legacy endpoints used.
 */

import { z } from "zod";
import { router, operatorProcedure } from "../trpc";
import {
  buildOperatorPulse,
  type PulseSurface,
} from "@/lib/services/operator-pulse";
import {
  buildCompoundChain,
  type CompoundSurface,
} from "@/lib/services/compound-chain";
import { buildGoalsSnapshot } from "@/lib/services/goals-snapshot";
import { buildMetaScoreboard } from "@/lib/services/meta-scoreboard";
import {
  getBodyTracking,
  logBodyEntry,
  bodyEntrySchema,
} from "@/lib/services/body-tracking";

const PulseSurfaceSchema = z.enum([
  "tasks",
  "goals",
  "scoreboard",
  "home",
]) satisfies z.ZodType<PulseSurface>;

const CompoundSurfaceSchema = z.enum([
  "tasks",
  "goals",
  "scoreboard",
  "home",
]) satisfies z.ZodType<CompoundSurface>;

export const operatorRouter = router({
  pulse: operatorProcedure
    .input(z.object({ surface: PulseSurfaceSchema.default("home") }))
    .query(async ({ input }) => {
      return buildOperatorPulse(input.surface);
    }),

  compound: operatorProcedure
    .input(z.object({ surface: CompoundSurfaceSchema.default("home") }))
    .query(async ({ input }) => {
      return buildCompoundChain(input.surface);
    }),

  /**
   * Phase OO (2026-05-19 AM) · owner-only · composite payload for the
   * /goals page (LifeGoal ladder + active missions + 8-axis mastery
   * scores + prune-candidates count). Delegates to
   * `lib/services/goals-snapshot.buildGoalsSnapshot` shared service ·
   * legacy GET /api/goals/snapshot calls the same function · drift
   * impossible.
   *
   * No input · snapshot is operator-scoped (single user surface).
   * React Query inherits the existing 30s cache + auto-refetch.
   */
  goalsSnapshot: operatorProcedure.query(async () => {
    return buildGoalsSnapshot();
  }),

  /**
   * Phase WW (2026-05-19 AM) · owner-only · meta-scoreboard snapshot
   * for the /scoreboard page · 5-10 anchor numbers + anomalies
   * surfaced dynamically · composedAt + lastBriefAt + state ("calm"
   * vs "alive"). Delegates to `lib/services/meta-scoreboard` which
   * the legacy REST endpoint also calls · drift impossible.
   *
   * 30s cache matches the route's prior Cache-Control.
   */
  scoreboardSnapshot: operatorProcedure.query(async () =>
    buildMetaScoreboard(),
  ),

  /**
   * Phase XX (2026-05-19 AM) · owner-only · body tracking timeline +
   * progress to TARGET_WEIGHT (186 lbs). Range filter: "30d" · "90d"
   * (default) · "365d". Returns entries + progress envelope when a
   * latest weight exists.
   */
  bodyTracking: operatorProcedure
    .input(
      z.object({ range: z.enum(["30d", "90d", "365d"]).optional() }).optional(),
    )
    .query(async ({ input }) => getBodyTracking({ range: input?.range })),

  /**
   * Phase XX · owner-only · log a partial body-tracking entry · all
   * fields optional · upsert-by-date so re-submission for the same
   * day updates without duplicating. Operator hits this multiple
   * times per day with different slices (sleep AM · weight PM).
   */
  logBodyEntry: operatorProcedure
    .input(bodyEntrySchema)
    .mutation(async ({ input }) => logBodyEntry(input)),
});
