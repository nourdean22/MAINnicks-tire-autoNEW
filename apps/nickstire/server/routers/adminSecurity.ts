import { TRPCError } from "@trpc/server";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { algProbeLog } from "../../drizzle/schema";
import { ADMIN_ROLES, permissionsForAdminRole } from "../../shared/adminPermissions";
import { adminIdentityProcedure, adminPermissionProcedure, adminProcedure, router } from "../_core/trpc";
import { AUTH_ATTEMPTING_OUTCOMES } from "../lib/adminActivity";
import { db } from "../lib/db-helper";
import { buildTotpUri, generateTotpSecret, verifyTotpCode } from "../lib/totp";
import { getRecentAdminActions, recordAdminAction, reportAdminClientError } from "../services/adminAudit";
import {
  decryptMfaSecret,
  enableMfa,
  getAdminSecurityState,
  isAdminMfaRequired,
  isMfaVerificationFresh,
  markMfaVerified,
  MFA_NOT_REQUIRED_STATE,
  setAdminRole,
  storePendingMfaSecret,
} from "../services/adminSecurity";

/**
 * How many recent auth-attempting probes to inspect when counting the failure
 * streak. Bounded because the card only needs "is it failing right now and
 * roughly how badly" — the exact depth of a long outage is the probe log's job,
 * not this card's, and an unbounded scan on a hot 60s-refetch query is not.
 */
const ATTEMPT_WINDOW = 20;

function requestIp(req: { headers?: Record<string, unknown>; ip?: string } | undefined): string | null {
  const forwarded = req?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() || null;
  return req?.ip ?? null;
}

export const adminSecurityRouter = router({
  status: adminIdentityProcedure.query(async ({ ctx }) => {
    // Enforcement off → report the pre-wave contract (owner, no MFA wall)
    // so the client gate and the middleware agree. See isAdminMfaRequired.
    if (!isAdminMfaRequired()) {
      /**
       * The MFA posture is off; the ROLE is still real.
       *
       * This returned MFA_NOT_REQUIRED_STATE.adminRole — the literal "owner" —
       * so the sidebar, command search and topbar rendered an owner's navigation
       * for every admin regardless of their actual role. The client and the
       * server now agree because both read the same stored role
       * (_core/trpc.ts enforces it unconditionally as of the same change).
       *
       * mfaEnabled/mfaVerified stay as they were: enforcement is off, so there is
       * no wall to clear and the client's MFA gate must not render.
       */
      const stored = await getAdminSecurityState(ctx.user.openId);
      const adminRole = stored?.adminRole ?? MFA_NOT_REQUIRED_STATE.adminRole;
      return {
        mfaRequired: false,
        adminRole,
        permissions: permissionsForAdminRole(adminRole),
        mfaEnabled: false,
        mfaVerified: true,
        mfaVerifiedAt: null,
      };
    }
    const security = ctx.adminSecurity ?? await getAdminSecurityState(ctx.user.openId);
    return {
      mfaRequired: true,
      adminRole: security?.adminRole ?? "viewer",
      permissions: permissionsForAdminRole(security?.adminRole ?? "viewer"),
      mfaEnabled: security?.mfaEnabled ?? false,
      mfaVerified: isMfaVerificationFresh(security?.mfaVerifiedAt ?? null),
      mfaVerifiedAt: security?.mfaVerifiedAt ?? null,
    };
  }),

  beginMfaSetup: adminIdentityProcedure.mutation(async ({ ctx }) => {
    const security = ctx.adminSecurity ?? await getAdminSecurityState(ctx.user.openId);
    if (security?.mfaEnabled) {
      throw new TRPCError({ code: "CONFLICT", message: "Two-factor authentication is already enabled." });
    }
    const secret = generateTotpSecret();
    await storePendingMfaSecret(ctx.user.openId, secret);
    const account = ctx.user.email || ctx.user.name || ctx.user.openId;
    return { secret, otpauthUri: buildTotpUri({ secret, account }) };
  }),

  verifyMfa: adminIdentityProcedure
    .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
    .mutation(async ({ ctx, input }) => {
      const security = await getAdminSecurityState(ctx.user.openId);
      if (!security?.encryptedSecret) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Start MFA setup first." });
      }
      const secret = decryptMfaSecret(security.encryptedSecret);
      if (!verifyTotpCode(secret, input.code)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid authentication code." });
      }
      if (!security.mfaEnabled) await enableMfa(ctx.user.openId);
      else await markMfaVerified(ctx.user.openId);
      const reference = await recordAdminAction({
        actor: ctx.user.email || ctx.user.openId,
        action: security.mfaEnabled ? "admin.mfa_verified" : "admin.mfa_enabled",
        entityType: "admin_action",
        entityId: ctx.user.id,
        ipAddress: requestIp(ctx.req),
      });
      return { success: true, reference };
    }),

  setRole: adminPermissionProcedure("security.manage")
    .input(z.object({ openId: z.string().min(1), role: z.enum(ADMIN_ROLES) }))
    .mutation(async ({ ctx, input }) => {
      await setAdminRole(input.openId, input.role);
      const reference = await recordAdminAction({
        actor: ctx.user.email || ctx.user.openId,
        action: "admin.role_changed",
        entityType: "admin_action",
        entityId: input.openId,
        changes: { role: input.role },
        ipAddress: requestIp(ctx.req),
      });
      return { success: true, reference };
    }),

  recordAction: adminProcedure
    .input(z.object({
      action: z.string().min(1).max(100),
      entityType: z.string().max(80).optional(),
      entityId: z.union([z.string(), z.number()]).optional(),
      changes: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => ({
      reference: await recordAdminAction({
        actor: ctx.user.email || ctx.user.openId,
        action: input.action,
        entityType: "admin_action",
        entityId: input.entityId,
        changes: { sourceEntityType: input.entityType ?? null, ...(input.changes ?? {}) },
        ipAddress: requestIp(ctx.req),
      }),
    })),

  recentActions: adminPermissionProcedure("reports.view")
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
    .query(({ input }) => getRecentAdminActions(input?.limit ?? 50)),

  /**
   * ROS-083 · this read used to look ONLY at `outcome = 'success'`, so a live
   * ALG failure was structurally invisible to it. The card is classified from
   * the age of the last success against a 24-hour staleAfterMinutes, which
   * means a total authentication outage kept rendering emerald "Fresh · Nm old"
   * for a FULL DAY after the last good probe, while every probe in between was
   * writing an `auth_failed` row this query never selected.
   *
   * So it now also reports the most recent probe that ATTEMPTED an auth, and
   * how many of those have failed since the last success. AUTH_ATTEMPTING_OUTCOMES
   * is reused rather than redefined — it already encodes the distinction that
   * matters here, and getting it wrong in the other direction is worse: widening
   * `lastSuccessfulAt` to include `dedup` (a probe that was SKIPPED and never
   * reached auth) would make a permanently-dead integration look freshly synced.
   */
  integrationFreshness: adminProcedure.query(async () => {
    const database = await db();
    const generatedAt = new Date();
    if (!database) {
      // `readable: false` rather than `connected: false`. They are different
      // failures and used to be reported as the same one: connected:false made
      // the card say "Offline", blaming ALG for an outage in OUR database.
      return {
        readable: false,
        connected: null,
        lastSuccessfulAt: null,
        lastAttemptAt: null,
        lastAttemptOutcome: null,
        failuresSinceLastSuccess: 0,
        generatedAt,
        source: "alg_probe_log" as const,
      };
    }
    const [rows, attempts] = await Promise.all([
      database
        .select({ completedAt: algProbeLog.completedAt })
        .from(algProbeLog)
        .where(eq(algProbeLog.outcome, "success"))
        .orderBy(desc(algProbeLog.completedAt))
        .limit(1),
      database
        .select({ outcome: algProbeLog.outcome, startedAt: algProbeLog.startedAt })
        .from(algProbeLog)
        .where(inArray(algProbeLog.outcome, [...AUTH_ATTEMPTING_OUTCOMES]))
        .orderBy(desc(algProbeLog.startedAt))
        .limit(ATTEMPT_WINDOW),
    ]);
    // Consecutive failures from the head. Stops at the first non-failing
    // attempt, so an old failure that has since been followed by a good probe
    // does not keep the card red.
    let failuresSinceLastSuccess = 0;
    for (const a of attempts) {
      if (a.outcome === "auth_failed" || a.outcome === "error") failuresSinceLastSuccess++;
      else break;
    }
    return {
      readable: true,
      connected: rows.length > 0,
      lastSuccessfulAt: rows[0]?.completedAt ?? null,
      lastAttemptAt: attempts[0]?.startedAt ?? null,
      lastAttemptOutcome: attempts[0]?.outcome ?? null,
      failuresSinceLastSuccess,
      generatedAt,
      source: "alg_probe_log" as const,
    };
  }),

  reportClientError: adminIdentityProcedure
    .input(z.object({
      reference: z.string().min(1).max(80),
      section: z.string().min(1).max(80),
      message: z.string().min(1).max(500),
      componentStack: z.string().max(2000).optional(),
      path: z.string().max(500).optional(),
      userAgent: z.string().max(300).optional(),
    }))
    .mutation(async ({ ctx, input }) => ({
      reference: await reportAdminClientError({
        actor: ctx.user.email || ctx.user.openId,
        ...input,
        ipAddress: requestIp(ctx.req),
      }),
    })),
});
