/**
 * fitment v1 · public vehicle tire finder: year > make > model > trim -> OE tire sizes.
 *
 * Every read returns { ok: true, ... } or { ok: false, reason }, where reason is
 * "unconfigured" | "daily_cap" | "upstream_error" | "not_found". An upstream failure is
 * never an empty list; a 200 with no items is. The chosen size feeds
 * gatewayTire.publicSearch on the client; this router does not search stock.
 *
 * Public and paid per call: protected by the app-wide /api/trpc apiLimiter (the same
 * limiter gatewayTire.publicSearch rides on), the in-memory cache and the daily cap
 * in services/fitment/wheelSize.ts.
 */
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  MAX_YEAR,
  MIN_YEAR,
  SLUG_RE,
  getMakes,
  getModels,
  getSizes,
  getTrims,
  getYears,
  isFitmentConfigured,
} from "../services/fitment/wheelSize";

const year = z.number().int().min(MIN_YEAR).max(MAX_YEAR);
const slug = z.string().regex(SLUG_RE);

export const fitmentRouter = router({
  status: publicProcedure.query(() => ({ available: isFitmentConfigured() })),

  years: publicProcedure.query(() => getYears()),

  makes: publicProcedure
    .input(z.object({ year }))
    .query(({ input }) => getMakes(input.year)),

  models: publicProcedure
    .input(z.object({ year, make: slug }))
    .query(({ input }) => getModels(input.year, input.make)),

  trims: publicProcedure
    .input(z.object({ year, make: slug, model: slug }))
    .query(({ input }) => getTrims(input.year, input.make, input.model)),

  sizes: publicProcedure
    .input(z.object({ year, make: slug, model: slug, trim: slug }))
    .query(({ input }) => getSizes(input.year, input.make, input.model, input.trim)),
});
