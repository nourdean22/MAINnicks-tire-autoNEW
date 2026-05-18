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
});
