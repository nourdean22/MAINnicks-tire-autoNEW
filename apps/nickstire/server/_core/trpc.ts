import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { touchAdminActivity } from "../lib/adminActivity";
import { getAdminSecurityState, isMfaVerificationFresh } from "../services/adminSecurity";
import {
  hasAdminPermission,
  permissionForAdminProcedure,
  type AdminPermission,
} from "../../shared/adminPermissions";
import { createLogger } from "../lib/logger";

const log = createLogger("_core:trpc");
const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const isInternal = error.code === "INTERNAL_SERVER_ERROR";
    return {
      ...shape,
      message: isInternal
        ? "Something went wrong. Please try again or call us at (216) 862-0005."
        : shape.message,
      data: {
        ...shape.data,
        stack: process.env.NODE_ENV === "production" ? undefined : shape.data?.stack,
      },
    };
  },
});

export const router = t.router;

const loggerMiddleware = t.middleware(async ({ path, type, next }) => {
  const start = Date.now();
  const result = await next();
  const duration = Date.now() - start;
  if (duration > 2000) log.warn(`[tRPC SLOW] ${type} ${path} took ${duration}ms`);
  if (!result.ok) log.error(`[tRPC ERROR] ${type} ${path} (${duration}ms):`, result.error.message);
  return result;
});

export const publicProcedure = t.procedure.use(loggerMiddleware);

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const protectedProcedure = t.procedure.use(loggerMiddleware).use(requireUser);

const requireAdminIdentity = t.middleware(async opts => {
  const { ctx, next, path } = opts;
  if (!ctx.user || ctx.user.role !== 'admin') {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  }
  touchAdminActivity(`trpc:${path}`);
  const security = await getAdminSecurityState(ctx.user.openId);
  return next({ ctx: { ...ctx, user: ctx.user, adminSecurity: security } });
});

/** Admin identity without MFA enforcement. Restricted to setup/status/verification procedures. */
export const adminIdentityProcedure = t.procedure.use(loggerMiddleware).use(requireAdminIdentity);

const requireFreshMfaAndPermission = t.middleware(async opts => {
  const { ctx, next, path, type } = opts;
  // Standalone t.middleware() is typed against the BASE context — the
  // narrowing from requireAdminIdentity neither flows in nor out of this
  // middleware on its own. Re-assert the precondition fail-closed (same
  // pattern as requireUser above) and re-narrow `user` in next() so
  // adminProcedure handlers see it non-null. At runtime this guard is
  // unreachable: adminProcedure always chains requireAdminIdentity first.
  if (!ctx.user || ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  }
  const inherited = (ctx as { adminSecurity?: Awaited<ReturnType<typeof getAdminSecurityState>> })
    .adminSecurity;
  const security = inherited ?? await getAdminSecurityState(ctx.user.openId);
  if (!security?.mfaEnabled) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Admin two-factor authentication setup is required." });
  }
  if (!isMfaVerificationFresh(security.mfaVerifiedAt)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Admin two-factor verification is required." });
  }
  const requiredPermission = permissionForAdminProcedure(path, type);
  if (!hasAdminPermission(security.adminRole, requiredPermission)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Missing admin permission: ${requiredPermission}` });
  }
  return next({ ctx: { ...ctx, user: ctx.user, adminSecurity: security } });
});

export const adminProcedure = t.procedure
  .use(loggerMiddleware)
  .use(requireAdminIdentity)
  .use(requireFreshMfaAndPermission);

export function adminPermissionProcedure(permission: AdminPermission) {
  // Plain-function .use() (not a standalone t.middleware) so the ctx type
  // inferred from adminProcedure — non-null user + adminSecurity — flows
  // both into this check and out to the procedure handlers.
  return adminProcedure.use(async ({ ctx, next }) => {
    if (!hasAdminPermission(ctx.adminSecurity.adminRole, permission)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `Missing admin permission: ${permission}` });
    }
    return next({ ctx });
  });
}

export const voiceAgentInternalProcedure = t.procedure.use(loggerMiddleware).use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    if (ctx.isVoiceAgentInternal === true) return next();
    const secret = process.env.VOICE_AGENT_INTERNAL_SECRET;
    if (secret) {
      const headerSecret = ctx.req?.headers?.["x-voice-agent-secret"];
      if (typeof headerSecret === "string" && headerSecret.length === secret.length) {
        const { timingSafeEqual } = await import("crypto");
        if (timingSafeEqual(Buffer.from(headerSecret), Buffer.from(secret))) return next();
      }
    }
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Voice-agent write mutations are internal-only — call via the VAPI webhook.",
    });
  }),
);
