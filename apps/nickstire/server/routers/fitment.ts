/**
 * fitment v1 · public vehicle tire finder: year > make > model > trim (D&K submodel) -> OE sizes.
 *
 * Every read returns { ok: true, ... } or { ok: false, reason }, where reason is
 * "unconfigured" | "upstream_error" | "not_found". An upstream failure is never an empty
 * list; a 200 with no items is. The chosen size feeds gatewayTire.publicSearch on the
 * client; this router does not search stock. Provider: D&K's b2b quicksearch API through
 * the shop's Gateway Tire login (services/fitment/dkFitment.ts).
 *
 * Public: protected by the app-wide /api/trpc apiLimiter (the same limiter
 * gatewayTire.publicSearch rides on) and the in-memory cache.
 */
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  MAX_YEAR,
  MIN_YEAR,
  VALUE_RE,
  getMakes,
  getModels,
  getSizes,
  getTrims,
  getYears,
  isFitmentAvailable,
} from "../services/fitment/dkFitment";

const year = z.number().int().min(MIN_YEAR).max(MAX_YEAR);
/** A D&K make/model/submodel value as the list endpoints return it ("Alfa Romeo", "CR-V"). */
const value = z.string().trim().regex(VALUE_RE);

export const fitmentRouter = router({
  status: publicProcedure.query(async () => ({ available: await isFitmentAvailable() })),

  years: publicProcedure.query(() => getYears()),

  makes: publicProcedure
    .input(z.object({ year }))
    .query(({ input }) => getMakes(input.year)),

  models: publicProcedure
    .input(z.object({ year, make: value }))
    .query(({ input }) => getModels(input.year, input.make)),

  trims: publicProcedure
    .input(z.object({ year, make: value, model: value }))
    .query(({ input }) => getTrims(input.year, input.make, input.model)),

  sizes: publicProcedure
    .input(z.object({ year, make: value, model: value, trim: value }))
    .query(({ input }) => getSizes(input.year, input.make, input.model, input.trim)),
});
