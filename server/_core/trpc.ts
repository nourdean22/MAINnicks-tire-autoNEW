import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { touchAdminActivity } from "../lib/adminActivity";

import { createLogger } from "../lib/logger";

const log = createLogger("_core:trpc");
const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // In production, sanitize internal errors so raw SQL/stack traces never leak to clients
    const isInternal = error.code === "INTERNAL_SERVER_ERROR";
    return {
      ...shape,
      message: isInternal
        ? "Something went wrong. Please try again or call us at (216) 862-0005."
        : shape.message,
      data: {
        ...shape.data,
        // Strip stack traces in production
        stack: process.env.NODE_ENV === "production" ? undefined : shape.data?.stack,
      },
    };
  },
});

export const router = t.router;

/**
 * Logging middleware — logs slow procedures and errors for debugging.
 */
const loggerMiddleware = t.middleware(async ({ path, type, next }) => {
  const start = Date.now();
  const result = await next();
  const duration = Date.now() - start;

  // Log slow procedures (>2s) for performance monitoring
  if (duration > 2000) {
    log.warn(`[tRPC SLOW] ${type} ${path} took ${duration}ms`);
  }

  // Log errors with procedure context
  if (!result.ok) {
    log.error(`[tRPC ERROR] ${type} ${path} (${duration}ms):`, result.error.message);
  }

  return result;
});

export const publicProcedure = t.procedure.use(loggerMiddleware);

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(loggerMiddleware).use(requireUser);

export const adminProcedure = t.procedure.use(loggerMiddleware).use(
  t.middleware(async opts => {
    const { ctx, next, path } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    // Record admin activity — gates ShopDriver/ALG probes so cron doesn't
    // kick the shop's session while they're actively using ShopDriver.
    // See server/lib/adminActivity.ts.
    touchAdminActivity(`trpc:${path}`);

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

/**
 * wave-148 — voiceAgentInternalProcedure: gates write mutations on the
 * voiceAgent router so they only succeed when called by the VAPI webhook
 * handler (which sets ctx.isVoiceAgentInternal=true via createCaller),
 * NOT when invoked directly over HTTP /api/trpc/voiceAgent.*
 *
 * Two acceptable paths:
 *   1. Internal createCaller dispatch from server/routes/webhooks/vapi.ts
 *      (already VAPI-signature-verified at the webhook layer)
 *   2. HTTP request with `x-voice-agent-secret` header matching the
 *      VOICE_AGENT_INTERNAL_SECRET env var (for testing / future tools)
 *
 * Without either, throws UNAUTHORIZED. The previous publicProcedure
 * exposed bookSlot/escalate/sendConfirmationSms to anyone who could
 * POST to /api/trpc — letting an attacker insert arbitrary bookings,
 * callback queue entries, and trigger SMS sends to arbitrary numbers.
 */
export const voiceAgentInternalProcedure = t.procedure.use(loggerMiddleware).use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    if (ctx.isVoiceAgentInternal === true) return next();
    const secret = process.env.VOICE_AGENT_INTERNAL_SECRET;
    if (secret) {
      const headerSecret = ctx.req?.headers?.["x-voice-agent-secret"];
      if (typeof headerSecret === "string" && headerSecret === secret) return next();
    }
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Voice-agent write mutations are internal-only — call via the VAPI webhook.",
    });
  }),
);
