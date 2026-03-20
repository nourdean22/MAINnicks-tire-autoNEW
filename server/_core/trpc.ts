import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

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
    console.warn(`[tRPC SLOW] ${type} ${path} took ${duration}ms`);
  }

  // Log errors with procedure context
  if (!result.ok) {
    console.error(`[tRPC ERROR] ${type} ${path} (${duration}ms):`, result.error.message);
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
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
