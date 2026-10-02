/**
 * lib/trpc/routers/system/cron.ts
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
import {
  runManifestCron,
  setCronEnabled as setCronEnabledService,
} from "@/lib/services/cron-control";
import { ServiceError } from "@/lib/utils/service-error";
import { buildCronTree } from "@/lib/services/cron-tree";
import {
  buildCronRunHistory,
  buildCronCommandDeck,
} from "@/lib/services/system-pages";

export const cronProcedures = {
  /**
   * Phase NN (2026-05-19 AM) · owner-only · manually fire a cron by
   * its jobName. Closes the T.4 coexistence carve-out where the
   * cron-diagnostics page's `runNow` + `enableCron` actions stayed
   * on REST after the read-side was migrated.
   *
   * Pre-fix the page was sending `{jobName}` to a route that
   * expected `{path}` · button was silently broken since wave-181.4.
   * New tRPC takes the operator-natural `{jobName}`; since 2026-10-02 it
   * resolves the path from the config/crons.ts manifest (`runManifestCron`).
   *
   * Caller invalidates `system.cronDiagnostics` after success to
   * refresh the per-job stats table.
   */
  runCron: operatorProcedure
    .input(z.object({ jobName: z.string().min(1).max(80) }))
    // 2026-10-02 · was `triggerCronByName`, which looked the job up in the
    // vercel.json catalog (`listScheduledCrons`, a file deleted with the
    // Vercel deploy) and so answered "unknown jobName" for every cron but a
    // stale hardcoded mega-fanout list. The manifest is the catalog.
    .mutation(async ({ input }) => {
      // Same ServiceError mapping as runManifestCron below: an unknown, retired
      // or Inngest-only job is NOT_FOUND / BAD_REQUEST, not a 500.
      try {
        return await runManifestCron(input.jobName);
      } catch (err) {
        if (err instanceof ServiceError) {
          throw new TRPCError({ code: err.status === 404 ? "NOT_FOUND" : "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Phase NN · owner-only · toggle a cron's enabled flag (kill-switch
   * + re-enable from the diagnostics page). `enabled: false` means
   * the kill-switch is engaged · the cron router skips fanout for
   * that job until re-enabled.
   *
   * Caller invalidates `system.cronDiagnostics` after success.
   */
  setCronEnabled: operatorProcedure
    .input(
      z.object({
        jobName: z.string().min(1).max(80),
        enabled: z.boolean(),
        note: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const next = await setCronEnabledService(
        input.jobName,
        input.enabled,
        input.note,
      );
      return { jobName: input.jobName, enabled: next };
    }),

  // ───────────────── Settings · cron control panel (UU.2) ─────────────────

  // 2026-10-02 · `cronCatalog` and the path-keyed `triggerCron` were deleted
  // with their only consumer, the Settings CronControlPanel; /system/crons
  // reads `cronDeck` and fires `runManifestCron` (docs/design/settings-census-2026-10-02.md).

  // ──────────────── Settings · auto-pilot flags (UU.2) ────────────────

  /**
   * Phase VV · owner-only · the full cron manifest + live stats + the
   * fold/retire lineage (mode + foldedInto per row). Replaces GET
   * /api/system/crons · delegates to the shared `cron-tree.buildCronTree`
   * service. Distinct from `cronCatalog` (UU.2 · the /settings panel) —
   * this carries the FULL manifest so the CronFoldTree lineage view can
   * render folded + retired crons, which the scheduled-only catalog
   * cannot.
   */
  cronTree: operatorProcedure.query(async () => buildCronTree()),

  /**
   * Phase B.7a · owner-only · per-job cron-run history · last N rows +
   * success-rate / median / p95. Replaces GET
   * /api/system/cron-runs/[jobName] · delegates to the shared
   * `system-pages.buildCronRunHistory` service. The legacy `?sinceDays`
   * (clamped 1-180) / `?limit` (clamped 1-500) query params are
   * mirrored as typed inputs · CronRunsPage keys on the input so
   * switching the window refetches.
   */
  cronRunHistory: operatorProcedure
    .input(
      z.object({
        jobName: z.string().min(1).max(120),
        sinceDays: z.number().int().min(1).max(180).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
    )
    .query(async ({ input }) =>
      buildCronRunHistory({
        jobName: input.jobName,
        sinceDays: input.sinceDays,
        limit: input.limit,
      }),
    ),

  /**
   * Phase B.7a · owner-only · the live cron command-deck feed · manifest
   * + per-job stats + drift + next-run countdown. Replaces GET
   * /api/system/crons · delegates to the shared
   * `system-pages.buildCronCommandDeck` service. CronsPage polls this on
   * a 30s interval. Distinct from `cronTree` (the fold-lineage view) —
   * this carries the per-row `nextRunAt` + `drift` the control deck
   * renders.
   */
  cronDeck: operatorProcedure.query(async () => buildCronCommandDeck()),

  /**
   * Phase B.7a · owner-only · fire a cron by jobName, validated against
   * the `config/crons.ts` manifest. Replaces POST /api/system/crons/run
   * · delegates to the shared `cron-control.runManifestCron` service.
   * An unknown jobName throws ServiceError(404) → NOT_FOUND; a retired
   * one ServiceError(410) → the tRPC code has no 410, so retired maps to
   * BAD_REQUEST (the page surfaces the message verbatim either way).
   *
   * Distinct from `runCron` (NN · the cron-diagnostics page · jobName →
   * vercel.json catalog via `triggerCronByName`) — this is the
   * `/system/crons` deck + `/system/cron-runs` drill-down path which
   * validates the typed CronDef manifest.
   */
  runManifestCron: operatorProcedure
    .input(z.object({ jobName: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      try {
        return await runManifestCron(input.jobName);
      } catch (err) {
        if (err instanceof ServiceError) {
          throw new TRPCError({
            code: err.status === 404 ? "NOT_FOUND" : "BAD_REQUEST",
            message: err.message,
          });
        }
        throw err;
      }
    }),

};
