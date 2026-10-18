/**
 * fitment v1 · public vehicle tire finder: year > make > model > trim (D&K submodel) -> OE sizes.
 *
 * Every read returns { ok: true, ... } or { ok: false, reason }, where reason is
 * "unconfigured" | "upstream_error" | "not_found" | "rate_limited". An upstream failure is
 * never an empty list; a 200 with no items is. The chosen size feeds gatewayTire.publicSearch
 * on the client; this router does not search stock. Provider: D&K's b2b quicksearch API
 * through the shop's Gateway Tire login (services/fitment/dkFitment.ts).
 *
 * Public. The app-wide apiLimiter counts HTTP REQUESTS, and tRPC batching packs N calls
 * into one, so the reads below are also limited per CALL per IP (20/min, 120/15 min);
 * identical in-flight reads share one D&K call and failures are remembered for 30 s.
 * Batching itself stays on: the page batches status + years on mount.
 */
import { z } from "zod";
import type { TrpcContext } from "../_core/context";
import { publicProcedure, router } from "../_core/trpc";
import { clientIp } from "../middleware/rateLimiters";
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
  takeFitmentCall,
} from "../services/fitment/dkFitment";

const year = z.number().int().min(MIN_YEAR).max(MAX_YEAR);
/** A D&K make/model/submodel value as the list endpoints return it ("Alfa Romeo", "CR-V"). */
const value = z.string().trim().regex(VALUE_RE);

/** A read that may reach D&K: counted per call, per client IP, before it runs. */
function limited<T>(ctx: TrpcContext, read: () => Promise<T>): Promise<T | { ok: false; reason: "rate_limited" }> {
  const ip = ctx.req ? clientIp(ctx.req) : "unknown";
  return takeFitmentCall(ip) ? read() : Promise.resolve({ ok: false, reason: "rate_limited" });
}

export const fitmentRouter = router({
  status: publicProcedure.query(async () => ({ available: await isFitmentAvailable() })),

  years: publicProcedure.query(({ ctx }) => limited(ctx, () => getYears())),

  makes: publicProcedure
    .input(z.object({ year }))
    .query(({ ctx, input }) => limited(ctx, () => getMakes(input.year))),

  models: publicProcedure
    .input(z.object({ year, make: value }))
    .query(({ ctx, input }) => limited(ctx, () => getModels(input.year, input.make))),

  trims: publicProcedure
    .input(z.object({ year, make: value, model: value }))
    .query(({ ctx, input }) => limited(ctx, () => getTrims(input.year, input.make, input.model))),

  sizes: publicProcedure
    .input(z.object({ year, make: value, model: value, trim: value }))
    .query(({ ctx, input }) => limited(ctx, () => getSizes(input.year, input.make, input.model, input.trim))),
});
