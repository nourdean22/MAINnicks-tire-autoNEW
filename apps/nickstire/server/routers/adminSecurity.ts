import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { algProbeLog } from "../../drizzle/schema";
import { ADMIN_ROLES, permissionsForAdminRole } from "../../shared/adminPermissions";
import { adminIdentityProcedure, adminPermissionProcedure, adminProcedure, router } from "../_core/trpc";
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
      return {
        mfaRequired: false,
        adminRole: MFA_NOT_REQUIRED_STATE.adminRole,
        permissions: permissionsForAdminRole(MFA_NOT_REQUIRED_STATE.adminRole),
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

  integrationFreshness: adminProcedure.query(async () => {
    const database = await db();
    const generatedAt = new Date();
    if (!database) {
      return { connected: false, lastSuccessfulAt: null, generatedAt, source: "alg_probe_log" as const };
    }
    const rows = await database
      .select({ completedAt: algProbeLog.completedAt })
      .from(algProbeLog)
      .where(eq(algProbeLog.outcome, "success"))
      .orderBy(desc(algProbeLog.completedAt))
      .limit(1);
    return {
      connected: rows.length > 0,
      lastSuccessfulAt: rows[0]?.completedAt ?? null,
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
