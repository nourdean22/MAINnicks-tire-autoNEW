import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { touchAdminActivity } from "../lib/adminActivity";
import {
  getAdminSecurityState,
  isAdminMfaRequired,
  isMfaVerificationFresh,
  MFA_NOT_REQUIRED_STATE,
} from "../services/adminSecurity";
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

/**
 * Procedures seen at least once in this process.
 *
 * WHY THIS EXISTS. A static census found 163 of 684 procedures with no caller
 * anywhere in the repo — but grep can prove neither liveness nor deadness for a
 * tRPC procedure, because every one of them is reachable over HTTP by something
 * outside this repository (the statenour bridge, a webhook dispatcher, a
 * shortcut, a curl). This repo has already been burned in BOTH directions by
 * trusting the source over the running system, and the middleware only logged
 * SLOW and ERROR calls, so production could not answer the question at all.
 *
 * One `Set.has` on the hot path, and exactly ONE log line per procedure per
 * process lifetime — so a busy endpoint costs nothing after its first call.
 * After a normal business cycle, the procedures that never appear in Railway
 * logs are the genuinely dead ones, and deletion stops being a guess.
 *
 * Deliberately in-memory: no table, no migration, no prod DDL. It resets on
 * deploy, which is correct — a procedure's silence only means something across
 * a window you can name, and the deploy time is in the logs beside it.
 */
const seenProcedures = new Set<string>();

const loggerMiddleware = t.middleware(async ({ path, type, next }) => {
  if (!seenProcedures.has(path)) {
    seenProcedures.add(path);
    log.info(`[tRPC first-call] ${type} ${path}`);
  }
  const start = Date.now();
  const result = await next();
  const duration = Date.now() - start;
  if (duration > 2000) log.warn(`[tRPC SLOW] ${type} ${path} took ${duration}ms`);
  if (!result.ok) log.error(`[tRPC ERROR] ${type} ${path} (${duration}ms):`, result.error.message);
  return result;
});

/** Test seam: which procedures this process has served. */
export function __seenProceduresForTest(): ReadonlySet<string> {
  return seenProcedures;
}

// authTier meta is the auth-coverage contract: server/__tests__/trpc-auth-tier.test.ts
// walks every registered procedure and fails on any that lacks a tier, and on any
// PUBLIC procedure not in its committed allowlist.
export const publicProcedure = t.procedure.meta({ authTier: "public" }).use(loggerMiddleware);

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const protectedProcedure = t.procedure
  .meta({ authTier: "protected" })
  .use(loggerMiddleware)
  .use(requireUser);

const requireAdminIdentity = t.middleware(async opts => {
  const { ctx, next, path } = opts;
  if (!ctx.user || ctx.user.role !== 'admin') {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  }
  touchAdminActivity(`trpc:${path}`);
  // Only fetch security state when the MFA gate is actually on — with it off
  // (the default since #772) this was a wasted DB query on EVERY admin call,
  // and any throw from it 500s ALL admin procedures in middleware, before the
  // handler runs. Consumers that need the state regardless (the MFA setup
  // flows on adminIdentityProcedure) already fall back to fetching it
  // themselves via `ctx.adminSecurity ?? getAdminSecurityState(...)`.
  const security = isAdminMfaRequired() ? await getAdminSecurityState(ctx.user.openId) : null;
  return next({ ctx: { ...ctx, user: ctx.user, adminSecurity: security } });
});

/** Admin identity without MFA enforcement. Restricted to setup/status/verification procedures. */
export const adminIdentityProcedure = t.procedure
  .meta({ authTier: "admin" })
  .use(loggerMiddleware)
  .use(requireAdminIdentity);

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
  /**
   * MFA AND AUTHORIZATION ARE INDEPENDENT CONTROLS.
   *
   *   Authentication  who are you            (requireAdminIdentity, above)
   *   MFA             how strongly proven    (conditional on ADMIN_MFA_REQUIRED)
   *   Authorization   what your role may do  (ALWAYS)
   *
   * This used to early-return when MFA was not required, injecting
   * MFA_NOT_REQUIRED_STATE — whose adminRole is the literal string "owner"
   * (adminSecurity.ts:34) — and skipping permissionForAdminProcedure entirely.
   *
   * So every user with role === "admin" became an effective OWNER, and
   * manager / front_desk / tech / accountant / viewer were decorative. Turning
   * off the second factor also turned off the whole permission system. That is
   * one control silently disabling an unrelated one.
   *
   * It was documented behaviour from the 2026-07-16 decision to back out the MFA
   * lockout, and that decision was right — the lockout was real. But backing out
   * MFA should never have backed out ROLES.
   *
   * SAFE TO ENABLE TODAY, verified against production: all three admin users
   * (nourdean22@, moeseuclid@, and a leftover dev row) already carry
   * adminRole "owner", so enforcing the role check changes nobody's access right
   * now. It starts mattering the moment anyone is assigned a lesser role —
   * which is the point, and there IS already a second real human with owner.
   *
   * MFA enforcement stays exactly where it was: conditional, off by default.
   * mfaEnabled is 0 for all three users, so making it unconditional here would
   * reproduce the lockout that was correctly reversed.
   */
  const inherited = (ctx as { adminSecurity?: Awaited<ReturnType<typeof getAdminSecurityState>> })
    .adminSecurity;

  /**
   * This lookup now runs on EVERY admin request, where the MFA-off path used to
   * skip it entirely — so it must not be able to turn a database problem into a
   * 500 on an authorization check. A throw here would take the whole admin down
   * for a reason that has nothing to do with the caller's permissions.
   *
   * It degrades to the same null the function returns for a missing row, which
   * the fallback below already handles and logs.
   */
  let security = inherited ?? null;
  if (!security) {
    try {
      security = await getAdminSecurityState(ctx.user.openId);
    } catch (err) {
      log.error("could not read admin security state", {
        openId: ctx.user.openId,
        path,
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      security = null;
    }
  }
  const mfaRequired = isAdminMfaRequired();

  if (mfaRequired) {
    if (!security?.mfaEnabled) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Admin two-factor authentication setup is required." });
    }
    if (!isMfaVerificationFresh(security.mfaAgeMinutes)) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Admin two-factor verification is required." });
    }
  }

  /**
   * WHAT IF THE ROLE CANNOT BE READ?
   *
   * The tempting answer is `viewer` — unknown authority is the least authority.
   * It is the wrong answer HERE, and choosing it deliberately rather than by
   * instinct matters.
   *
   * getAdminSecurityState returns null when the database is unreachable, not
   * only when a row is missing. So `viewer` would mean: a transient DB hiccup
   * locks the owner out of their own shop mid-shift. That is precisely the
   * lockout that was hit live and ordered reversed on 2026-07-16, arriving again
   * through a different door.
   *
   * This change must be a STRICT IMPROVEMENT over today, never an availability
   * regression. Today, MFA-off grants owner to every admin unconditionally. So:
   *
   *   role readable    -> enforce the REAL role            (stronger than today)
   *   role unreadable  -> today's documented behaviour     (no worse than today)
   *
   * The unreadable branch is a fail-open, and it is named as one rather than
   * hidden: it is logged at ERROR with the path, so it shows up as an incident
   * instead of as silence. A security change that can take the shop offline will
   * be reverted, and then there is no security change at all.
   */
  const effective = security ?? MFA_NOT_REQUIRED_STATE;
  if (!security) {
    log.error(
      "admin security state unreadable — falling back to pre-RBAC behaviour (owner). " +
      "Roles are NOT being enforced for this request.",
      { openId: ctx.user.openId, path },
    );
  }
  const adminRole = effective.adminRole;

  const requiredPermission = permissionForAdminProcedure(path, type);
  if (!hasAdminPermission(adminRole, requiredPermission)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Missing admin permission: ${requiredPermission}` });
  }
  return next({ ctx: { ...ctx, user: ctx.user, adminSecurity: { ...effective, adminRole } } });
});

export const adminProcedure = t.procedure
  .meta({ authTier: "admin" })
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

export const voiceAgentInternalProcedure = t.procedure.meta({ authTier: "internal" }).use(loggerMiddleware).use(
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
