/**
 * lib/trpc/routers/system/autopilot.ts
 *
 * Per-domain slice of the system router (mechanical split · 2026-05-31).
 * Exports a plain procedure-object that system.ts spreads back into
 * `systemRouter` — the client paths stay FLAT as `trpc.system.<proc>`.
 * Procedures moved VERBATIM · no behavior / input-schema / middleware
 * change. See system.ts for the recomposition.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { operatorProcedure } from "../../trpc";
import { prisma } from "@/lib/prisma";
import {
  getAutopilotFlags,
  setAutopilotFlags,
} from "@/lib/services/autopilot-flags";
import { ServiceError } from "@/lib/utils/service-error";
import {
  listPendingActions,
  summarizeQueue,
  decidePendingAction,
} from "@/lib/automation/approval-queue";
import {
  listPoliciesView,
  updatePolicyFields,
  listPolicyFiresView,
  applyPowerSetting,
} from "@/lib/services/system-pages-b";
import { getPowerSettings } from "@/lib/services/power-panel";
import { PowerSettings } from "@/lib/services/power-panel";

export const autopilotProcedures = {
  /**
   * Phase UU.2 · owner-only · read the persisted auto-pilot flag map.
   * Replaces GET /api/settings/autopilot · delegates to the shared
   * `autopilot-flags` service · drift impossible. Returns
   * `{ flags }` matching the legacy envelope so the page's
   * `data.flags` access is unchanged.
   */
  autopilotFlags: operatorProcedure.query(async () => {
    return { flags: await getAutopilotFlags() };
  }),

  /**
   * Phase UU.2 · owner-only · persist the auto-pilot flag map. Replaces
   * POST /api/settings/autopilot · the service merges over DEFAULTS so
   * every known key is present. Input is a typed string→boolean record
   * (the panel builds the map from its flag list · the keys are
   * operator-defined flag names so a `z.record` of `z.boolean()` is the
   * correct shape — the *values* are strictly typed, which is the guard
   * that matters here).
   */
  setAutopilotFlags: operatorProcedure
    .input(z.object({ flags: z.record(z.string(), z.boolean()) }))
    .mutation(async ({ input }) => {
      return { flags: await setAutopilotFlags(input.flags) };
    }),

  // ─────────────── Settings · Wave T feature-mining (2026-05-24) ───────────────
  // Four procedures wire AutomationPolicy + BrainMemory infrastructure
  // into the autopilot section. Same kaizen pattern as Wave S · zero
  // new schema · operator-visible signal from paid-for data.

  /**
   * Wave T #1 + #5 · Proof-of-life status per autopilot flag +
   * blast-radius preview.
   *
   * Joins flag keys to AutomationPolicy rows by tag (preferred · the
   * policy registry tags rows with `autopilot:<flag-key>` to bind
   * them) and falls back to substring match on policy id. Returns
   * lastFiredAt + lastResult + fireCount per flag + the policy's
   * `successMetric` for the blast-radius preview rendered in the
   * confirm-hold expansion.
   */
  autopilotPolicyStatus: operatorProcedure.query(async () => {
    try {
      const { prisma } = await import("@/lib/prisma");
      const policies = await prisma.automationPolicy.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          objective: true,
          successMetric: true,
          tags: true,
          lastFiredAt: true,
          lastResult: true,
          fireCount: true,
        },
      });
      // Index policies by tag-binding (preferred) and by id-substring
      // (fallback). The "autopilot:<key>" tag is the canonical link ·
      // unbound policies stay out of the proof-of-life map.
      const byFlag = new Map<
        string,
        {
          policyId: string;
          name: string;
          lastFiredAt: string | null;
          lastResult: string | null;
          fireCount: number;
          successMetric: string;
          objective: string;
        }
      >();
      for (const p of policies) {
        for (const t of p.tags) {
          if (t.startsWith("autopilot:")) {
            const key = t.slice("autopilot:".length);
            byFlag.set(key, {
              policyId: p.id,
              name: p.name,
              lastFiredAt: p.lastFiredAt?.toISOString() ?? null,
              lastResult: p.lastResult,
              fireCount: p.fireCount,
              successMetric: p.successMetric,
              objective: p.objective,
            });
          }
        }
      }
      return Object.fromEntries(byFlag);
    } catch (err) {
      const { logger } = await import("@/lib/logger");
      logger
        .withSurface("trpc/system")
        .warn("autopilot_policy_status_failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      return {};
    }
  }),

  /**
   * Wave T #2 · Record an autopilot flag change · operator-grade audit
   * trail. Writes a BrainMemory row under category AUTOPILOT_FLAG_CHANGE
   * so the existing soft-delete cron retains it on the 90d schedule.
   * The settings page calls this on every flag toggle · optional `note`
   * surfaces in the drawer.
   */
  recordAutopilotFlagChange: operatorProcedure
    .input(
      z.object({
        flagKey: z.string().min(1).max(64),
        previousState: z.boolean(),
        newState: z.boolean(),
        priorStateDurationHours: z.number().min(0).optional(),
        note: z.string().max(280).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const { prisma } = await import("@/lib/prisma");
        const { BRAIN_CATEGORIES } = await import("@/lib/brain/categories");
        await prisma.brainMemory.create({
          data: {
            key: `autopilot_change:${input.flagKey}:${Date.now()}`,
            category: BRAIN_CATEGORIES.AUTOPILOT_FLAG_CHANGE,
            content: JSON.stringify({
              flagKey: input.flagKey,
              previousState: input.previousState,
              newState: input.newState,
              priorStateDurationHours: input.priorStateDurationHours ?? null,
              note: input.note ?? null,
            }),
            source: "settings/autopilot",
            confidence: 1,
          },
        });
        return { ok: true as const };
      } catch (err) {
        const { logger } = await import("@/lib/logger");
        logger
          .withSurface("trpc/system")
          .warn("record_autopilot_flag_change_failed", {
            err: err instanceof Error ? err.message : String(err),
          });
        return { ok: false as const };
      }
    }),

  /**
   * Wave T #2 · Recent autopilot flag changes · feeds the drawer
   * showing the last 5 changes per flag (used when the operator
   * long-presses a flag row to see the change history).
   */
  recentAutopilotFlagChanges: operatorProcedure
    .input(
      z.object({
        flagKey: z.string().min(1).max(64).optional(),
        limit: z.number().int().min(1).max(50).default(10),
      }),
    )
    .query(async ({ input }) => {
      try {
        const { prisma } = await import("@/lib/prisma");
        const { BRAIN_CATEGORIES } = await import("@/lib/brain/categories");
        const rows = await prisma.brainMemory.findMany({
          where: {
            category: BRAIN_CATEGORIES.AUTOPILOT_FLAG_CHANGE,
            deletedAt: null,
            ...(input.flagKey
              ? { key: { startsWith: `autopilot_change:${input.flagKey}:` } }
              : {}),
          },
          orderBy: { createdAt: "desc" },
          take: input.limit,
          select: { id: true, key: true, content: true, createdAt: true },
        });
        return rows.map((r) => {
          let parsed: {
            flagKey?: string;
            previousState?: boolean;
            newState?: boolean;
            priorStateDurationHours?: number | null;
            note?: string | null;
          } = {};
          try {
            parsed = JSON.parse(r.content) as typeof parsed;
          } catch {
            // skip
          }
          return {
            id: r.id,
            flagKey: parsed.flagKey ?? null,
            previousState: parsed.previousState ?? null,
            newState: parsed.newState ?? null,
            priorStateDurationHours: parsed.priorStateDurationHours ?? null,
            note: parsed.note ?? null,
            at: r.createdAt.toISOString(),
          };
        });
      } catch (err) {
        const { logger } = await import("@/lib/logger");
        logger
          .withSurface("trpc/system")
          .warn("recent_autopilot_changes_failed", {
            err: err instanceof Error ? err.message : String(err),
          });
        return [];
      }
    }),

  // ─────────────── Settings · tools health + data cards (UU.2) ───────────────

  /**
   * Phase B.7b · owner-only · the AutomationPolicy registry feed ·
   * every cron / tool / slash / webhook with its six governance
   * fields. Replaces GET /api/system/policies · delegates to the
   * shared `system-pages-b.listPoliciesView` (which wraps the
   * `listPolicies` service the legacy route also calls and projects
   * every `Date` to an ISO string). Returns `{ count, policies }`
   * mirroring the legacy `data` envelope. The legacy `?surface` /
   * `?approvalClass` / `?enabledOnly` params are mirrored as typed
   * optional inputs (PoliciesPage currently sends none · the filters
   * are client-side · the typed input keeps future server-filtering
   * cheap).
   */
  policies: operatorProcedure
    .input(
      z
        .object({
          surface: z
            .enum(["cron", "tool", "slash", "autonomous-action", "webhook"])
            .optional(),
          approvalClass: z
            .enum(["auto", "pending", "forbidden"])
            .optional(),
          enabledOnly: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      listPoliciesView({
        surface: input?.surface,
        approvalClass: input?.approvalClass,
        enabledOnly: input?.enabledOnly,
      }),
    ),

  /**
   * Phase B.7b · owner-only · operator-facing policy edit · the
   * multi-field PATCH (approval-class flip · kill-switch toggle ·
   * notes edit). Replaces PATCH /api/system/policies/[id] · delegates
   * to the shared `system-pages-b.updatePolicyFields` service (each
   * field applied sequentially through the policy setters so the
   * audit log captures separate events · mirrors the route). The
   * route carried the id as a path param; tRPC has no path, so it
   * rides in the input object. A missing id throws ServiceError(404)
   * → NOT_FOUND so both transports reject identically.
   */
  updatePolicy: operatorProcedure
    .input(
      z.object({
        id: z.string().min(1).max(160),
        approvalClass: z
          .enum(["auto", "pending", "forbidden"])
          .optional(),
        enabled: z.boolean().optional(),
        notes: z.string().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await updatePolicyFields({
          id: input.id,
          approvalClass: input.approvalClass,
          enabled: input.enabled,
          notes: input.notes,
        });
      } catch (err) {
        if (err instanceof ServiceError) {
          throw new TRPCError({
            code: err.status === 404 ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * Phase B.7b · owner-only · chronological fire history for one
   * policy. Replaces GET /api/system/policies/[id]/fires · delegates
   * to the shared `system-pages-b.listPolicyFiresView` (which wraps
   * `getPolicyFireHistory` and stringifies the `firedAt` Date). The
   * legacy `?limit` / `?offset` query params + the route's `id` path
   * param are mirrored as typed inputs. PoliciesPage's PolicyRow
   * lazy-loads this when the operator opens the fire-history panel.
   */
  policyFires: operatorProcedure
    .input(
      z.object({
        policyId: z.string().min(1).max(160),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).max(100000).optional(),
      }),
    )
    .query(async ({ input }) =>
      listPolicyFiresView({
        policyId: input.policyId,
        limit: input.limit,
        offset: input.offset,
      }),
    ),

  /**
   * Phase B.7b · owner-only · the full power-panel settings snapshot.
   * Replaces GET /api/system/power · delegates to the shared
   * `getPowerSettings` service (which already returns string-typed
   * fields). Returns `{ settings }` mirroring the legacy envelope so
   * PowerPanel's `data.settings` access is unchanged.
   */
  powerSettings: operatorProcedure.query(async () => {
    return { settings: await getPowerSettings() };
  }),

  /**
   * Phase B.7b · owner-only · patch a single power-panel setting.
   * Replaces POST /api/system/power · delegates to the shared
   * `system-pages-b.applyPowerSetting` service (the `pauseAllCrons`
   * pseudo-setting also fans out to every active cron's kill-switch ·
   * mirrors the route). The `key` enum is strict to the 6 mutable
   * PowerSettings keys (`updatedAt`/`updatedBy` are server-derived,
   * never client-settable) — the route's `PatchSchema` enum verbatim.
   * The route's extra `providerPin` / `quietMode` value guards are
   * hoisted here so a bad value is rejected at the boundary, not
   * silently persisted. Returns `{ settings }` mirroring the legacy
   * envelope.
   */
  setPowerSetting: operatorProcedure
    .input(
      z.object({
        key: z.enum([
          "quietMode",
          "providerPin",
          "strictMode",
          "dailyCostCapCents",
          "pauseAllCrons",
          "shadowMode",
        ]),
        value: z.union([z.string(), z.number(), z.boolean()]),
        note: z.string().max(280).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.key === "providerPin") {
        if (
          !["openai", "anthropic", "gemini", "auto"].includes(
            String(input.value),
          )
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "invalid providerPin",
          });
        }
      }
      if (input.key === "quietMode") {
        if (!["off", "nudges", "all"].includes(String(input.value))) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "invalid quietMode",
          });
        }
      }
      return applyPowerSetting({
        key: input.key as keyof PowerSettings,
        value: input.value,
        note: input.note,
      });
    }),

  /**
   * Phase B.7a · owner-only · the pending-autonomous-action approval
   * queue · every approval="pending" AutonomousAction row + policy
   * hints + a summary. Replaces GET /api/system/approvals · delegates
   * to the shared `approval-queue.{listPendingActions,summarizeQueue}`
   * the legacy route also calls. Returns `{ summary, rows }` mirroring
   * the legacy `data` envelope so ApprovalsPage's `data.rows` /
   * `data.summary` reads are unchanged.
   */
  approvals: operatorProcedure.query(async () => {
    const rowsPromise = listPendingActions();
    const summaryPromise = summarizeQueue();
    const rows = await rowsPromise;
    const summary = await summaryPromise;
    return { summary, rows };
  }),

  /**
   * Phase B.7a · owner-only · decide one pending AutonomousAction row
   * (approve · reject) with optional notes. Replaces POST
   * /api/system/approvals/[id] · delegates to the shared
   * `approval-queue.decidePendingAction` service (which on approve also
   * replays the deferred side effect). The route carried the row id as
   * a path param; tRPC has no path, so it rides in the input object.
   * A missing id throws ServiceError(404) → NOT_FOUND; a non-pending
   * row ServiceError(409) → CONFLICT · both transports reject
   * identically.
   */
  decideApproval: operatorProcedure
    .input(
      z.object({
        id: z.string().min(1).max(128),
        decision: z.enum(["approved", "rejected"]),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await decidePendingAction(
          input.id,
          input.decision,
          "nour",
          input.notes,
        );
      } catch (err) {
        if (err instanceof ServiceError) {
          throw new TRPCError({
            code:
              err.status === 404
                ? "NOT_FOUND"
                : err.status === 409
                  ? "CONFLICT"
                  : "INTERNAL_SERVER_ERROR",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  // ═════════════ Phase B.7b · system-pages sub-slice B ═════════════
  //
  // The authedFetch call-sites in the REMAINING app/(mastery)/system/*
  // page files migrated onto trpc.system.*. Every procedure delegates
  // to a shared lib/services/system-pages-b.ts function the legacy REST
  // route ALSO calls · drift structurally impossible. Read procedures
  // return the explicit shallow service shapes (Prisma Json columns
  // projected to `unknown` / scalars · every Date stringified inside
  // the service · the public AppRouter type stays shallow · TS2589
  // firewall).

};
