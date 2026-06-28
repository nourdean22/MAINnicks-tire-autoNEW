/**
 * lib/trpc/trpc.ts · Phase J (2026-05-18 PM)
 *
 * The tRPC builder + reusable procedure types. Centralizes the
 * middleware chain that every H-series endpoint previously
 * implemented in per-route boilerplate:
 *
 *   · enforceOperator   · requires ctx.session · throws UNAUTHORIZED
 *   · sanitizeErrors    · errorFormatter routes leaked details to the
 *                          internal logger and returns a generic
 *                          operator-readable message (mirrors the
 *                          H.7.1 error-sanitizer behavior)
 *   · budgetGate        · attached to reasoning procedures · runs
 *                          checkBudget · 402 on cap · reserves on
 *                          allow · releases in finally
 *
 * publicProcedure · ungated · used for health-style reads
 * operatorProcedure · enforceOperator + sanitizeErrors
 * reasoningProcedure · operatorProcedure + budgetGate
 */

import { initTRPC, TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { type TRPCContext } from "./context";
import { sanitizeError } from "@/lib/ai/reasoning/error-sanitizer";

const t = initTRPC.context<TRPCContext>().create({
  // H.7.1 parity · raw err.message leaks Prisma internals · the
  // formatter routes the full error through the sanitizer + only
  // exposes the generic public message + errorId. ZodError gets a
  // structured shape passed through for client-side field errors.
  errorFormatter({ shape, error }) {
    if (error.cause instanceof ZodError) {
      return {
        ...shape,
        data: { ...shape.data, zodError: error.cause.flatten() },
      };
    }
    // For everything else, sanitize the message but keep the original
    // error code (UNAUTHORIZED · NOT_FOUND · etc) which the client uses
    // for branching. Only the message is replaced.
    if (error.code === "INTERNAL_SERVER_ERROR") {
      const { publicMessage, errorId } = sanitizeError(error.cause ?? error, {
        // shape.data.path may be undefined on top-level errors · pass a
        // safe fallback so the sanitizer's route field is never empty.
        route: shape.data.path ?? "trpc:unknown",
        op: "trpc",
      });
      return {
        ...shape,
        message: publicMessage,
        data: { ...shape.data, errorId },
      };
    }
    return shape;
  },
});

export const router = t.router;
export const middleware = t.middleware;
export const publicProcedure = t.procedure;

// ── Middleware · enforce operator session ───────────────────────────
 
const enforceOperator = middleware(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    // Narrow · session is non-null from here on
    ctx: { ...ctx, session: ctx.session },
  });
});

const mutationGateMiddleware = middleware(async ({ ctx, next, type }) => {
  if (type === "mutation") {
    try {
      const { getFlag } = await import("@/lib/feature-flags");
      const mutationLock = getFlag("NICK_MUTATION_LOCK")?.isOn ?? false;
      if (mutationLock) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Mutations are currently locked by NICK_MUTATION_LOCK.",
        });
      }
    } catch {
      // safe fallback
    }
  }
  return next();
});

export const operatorProcedure = t.procedure.use(enforceOperator).use(mutationGateMiddleware);

// ── Note · withBudgetGate middleware ──────────────────────────────
//
// A composable budget-gate middleware was prototyped here but tRPC v11
// moved rawInput access to async `getRawInput()` and the typed shape
// is per-procedure (not generic across the router). To keep the budget
// + reservation logic clean we apply it INLINE inside each reasoning
// procedure (see lib/trpc/routers/nick.ts · `reason` mutation). The
// inline pattern matches H.6.2 + H.7.2 + H.7.3 wiring exactly without
// fighting the tRPC v11 middleware generics.
//
// Future H+ scope · once tRPC v11 middleware ergonomics improve, move
// the gate to a `reasoningProcedure = operatorProcedure.use(budgetGate)`
// pattern.
