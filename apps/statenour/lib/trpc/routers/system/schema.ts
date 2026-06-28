/**
 * lib/trpc/routers/system/schema.ts
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
import { getSchemaDrift } from "@/lib/services/schema-drift";
import { listGroupedErrors, listRecentErrors } from "@/lib/services/error-log";
import { scanStaleData } from "@/lib/system/stale-data-scanner";
import { StaleCategoryId } from "@/lib/system/stale-data-scanner";
import {
  purgeStaleCategory,
  purgeAllStale,
} from "@/lib/system/stale-data-purger";
import { buildSchemaCoverageReport } from "@/lib/db/schema-coverage";
import { getTopSlowQueries } from "@/lib/db/slow-query-tracker";
import { scanSystemGaps } from "@/lib/services/system-gaps";
import { buildEmbeddingCoverage } from "@/lib/services/embedding-coverage";
import { getEntityHistory } from "@/lib/db/entity-audit";
import {
  buildSchemaHistory,
  buildActorActivity,
  buildSystemLogs,
} from "@/lib/services/system-pages-b";
import { cached } from "@/lib/utils/cache";
import { FEATURE_REGISTRY, summarize } from "@/lib/system/feature-status";
import { FeatureMeta } from "@/lib/system/feature-status";
import {
  buildMigrationsTracker,
  type MigrationsPayload,
} from "@/lib/services/migrations-tracker";
const STALE_CATEGORIES: ReadonlySet<StaleCategoryId> =
  new Set<StaleCategoryId>([
    "drift_alerts_unresolved_14d",
    "pending_actions_7d",
    "skill_candidates_30d",
    "open_contradictions_60d",
    "abandoned_tasks_30d",
    "orphan_conversations",
    "overdue_decisions_reviews",
    "ancient_device_events",
  ]);

export const schemaProcedures = {
  /**
   * Phase VV · owner-only · the 30s-cached schema-drift check. Replaces
   * GET /api/system/schema-drift · delegates to the shared
   * `schema-drift.getSchemaDrift` service (which now owns the cache the
   * route used to hold as a module closure). `force` skips the cache —
   * the SchemaDriftCard's reload button passes `{force:true}`.
   */
  schemaDrift: operatorProcedure
    .input(
      z.object({ force: z.boolean().optional() }).optional(),
    )
    .query(async ({ input }) => getSchemaDrift(input?.force ?? false)),

  /**
   * Phase VV · owner-only · top-20 error fingerprints grouped by
   * message. Replaces the `?grouped=true` branch of GET
   * /api/system/errors · delegates to the shared
   * `error-log.listGroupedErrors` service. Optional level filter
   * mirrors the legacy `?level=` param.
   *
   * Phase B.6c · `sinceHours` added for the ultron HQErrorsCard, which
   * needs a true 24h window for its rose/amber severity threshold (the
   * legacy card sent `?from=<24h-ago ISO>`). The procedure converts the
   * hours to a `from` Date before delegating. Omitting it scans the
   * whole log — the components/system/* ErrorsFingerprints behavior,
   * unchanged.
   */
  errorsGrouped: operatorProcedure
    .input(
      z
        .object({
          level: z.enum(["fatal", "error", "warn"]).optional(),
          sinceHours: z.number().int().min(1).max(8760).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      listGroupedErrors({
        level: input?.level,
        from: input?.sinceHours
          ? new Date(Date.now() - input.sinceHours * 3_600_000)
          : undefined,
      }),
    ),

  /**
   * Phase VV · owner-only · paginated recent-errors feed. Replaces the
   * paginated branch of GET /api/system/errors · delegates to the
   * shared `error-log.listRecentErrors` service. ErrorsFingerprints
   * calls this with `{pageSize:50}`.
   */
  errorsRecent: operatorProcedure
    .input(
      z
        .object({
          level: z.enum(["fatal", "error", "warn"]).optional(),
          page: z.number().int().min(1).max(1000).optional(),
          pageSize: z.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      listRecentErrors({
        level: input?.level,
        page: input?.page,
        pageSize: input?.pageSize,
      }),
    ),

  /**
   * Phase VV · owner-only · scan for "looks-live-but-stale" rows across
   * 8 categories. Replaces GET /api/system/stale-data · delegates to
   * the same `scanStaleData` scanner the route + cron use. No writes.
   */
  staleData: operatorProcedure.query(async () => scanStaleData()),

  /**
   * Phase VV · owner-only · purge stale data. Replaces POST
   * /api/system/stale-data/purge · delegates to the same
   * `purgeStaleCategory` / `purgeAllStale` the route calls.
   *
   * Omitting `category` purges EVERY category (the big-red-button);
   * passing one purges only that category. The category whitelist
   * mirrors the REST route's `KNOWN` set verbatim — an unknown id
   * throws BAD_REQUEST so both transports reject identically. Returns
   * the legacy `{ ok, mode, ... }` envelope so CoverageStaleView's
   * `data.result` / `data.totalPurged` reads are unchanged.
   */
  purgeStaleData: operatorProcedure
    .input(
      z
        .object({ category: z.string().max(80).optional() })
        .optional(),
    )
    .mutation(async ({ input }) => {
      if (input?.category) {
        if (!STALE_CATEGORIES.has(input.category as StaleCategoryId)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Unknown category: ${input.category}. Valid: ${[
              ...STALE_CATEGORIES,
            ].join(", ")}`,
          });
        }
        const result = await purgeStaleCategory(
          input.category as StaleCategoryId,
        );
        return { ok: true, mode: "single" as const, result };
      }
      const all = await purgeAllStale();
      return { ok: true, mode: "all" as const, ...all };
    }),

  /**
   * Phase VV · owner-only · the index-coverage audit (every tracked
   * model with row + index counts + under-indexed-hot-table flag).
   * Replaces GET /api/system/schema-coverage · delegates to the same
   * `buildSchemaCoverageReport` the route calls, cross-referenced with
   * the slow-query tracker exactly as the route did.
   */
  schemaCoverage: operatorProcedure.query(async () => {
    const slowQueryShapes = getTopSlowQueries(20).map((q) => q.shape);
    return buildSchemaCoverageReport({ slowQueryShapes });
  }),

  /**
   * Phase VV · owner-only · the "nothing missing" detector (W11.4) —
   * scans for unscheduled crons, empty API shells, tool-catalog drift,
   * stale models, unset env vars. Replaces GET /api/system/gaps ·
   * delegates to the shared `system-gaps.scanSystemGaps` service.
   */
  gaps: operatorProcedure.query(async () => scanSystemGaps()),

  /**
   * Phase VV · owner-only · the pgvector-migration coverage rollup.
   * Replaces GET /api/system/embedding-coverage · delegates to the
   * shared `embedding-coverage.buildEmbeddingCoverage` service.
   */
  embeddingCoverage: operatorProcedure.query(async () =>
    buildEmbeddingCoverage(),
  ),

  /**
   * Phase VV · owner-only · the field-level provenance log for one
   * entity. Replaces the per-entity-history branch of GET
   * /api/audit/entity · delegates to the same `getEntityHistory` the
   * route calls. The actor-firehose / global-firehose modes stay
   * REST-only · no tRPC consumer in this slice (EntityHistoryDrawer
   * only ever uses the per-entity mode).
   */
  entityHistory: operatorProcedure
    .input(
      z.object({
        entityType: z.string().min(1).max(60),
        entityId: z.string().min(1).max(128),
        limit: z.number().int().min(1).max(500).default(50),
      }),
    )
    .query(async ({ input }) => {
      const entries = await getEntityHistory(
        input.entityType,
        input.entityId,
        { limit: input.limit },
      );
      return { count: entries.length, entries, mode: "entity" as const };
    }),

  /**
   * Phase B.7b · owner-only · the SchemaChangeLedger operator feed ·
   * 6-axis summary + recent ledger entries with destructive flag +
   * rollback plan. Replaces GET /api/system/schema-history ·
   * delegates to the shared `system-pages-b.buildSchemaHistory`
   * service (which projects every `Date` to an ISO string). The
   * legacy `?limit` (clamped 1-200) / `?env` query params are
   * mirrored as typed inputs · SchemaHistoryPage keys on the input so
   * switching the env filter refetches.
   */
  schemaHistory: operatorProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).optional(),
          env: z.enum(["local", "preview", "production"]).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      buildSchemaHistory({
        limit: input?.limit,
        environment: input?.env,
      }),
    ),

  /**
   * Phase B.7b · owner-only · recent entity-audit activity by one
   * actor across all entities · the /system/history firehose mode.
   * Replaces the `?firehose=1&actor=` branch of GET /api/audit/entity
   * · delegates to the shared `system-pages-b.buildActorActivity`
   * (which wraps the `getActorActivity` service the legacy route also
   * calls, drops the `before`/`after` Json columns, and stringifies
   * `createdAt`). The per-entity + global-firehose modes stay
   * REST-only · no tRPC consumer in this slice (the history page only
   * uses the actor-firehose mode here · the per-entity mode is served
   * by the existing `entityHistory` procedure via EntityHistoryDrawer).
   *
   * `since` rides as an ISO string (tRPC has no Date wire type) ·
   * converted to a Date in the procedure. `action` is accepted for
   * call-shape parity but, like the legacy firehose, not applied —
   * `getActorActivity` never took an action filter.
   */
  actorActivity: operatorProcedure
    .input(
      z.object({
        actor: z.string().min(1).max(120),
        action: z
          .enum(["created", "updated", "soft_deleted", "restored", "purged"])
          .optional(),
        since: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
    )
    .query(async ({ input }) =>
      buildActorActivity({
        actor: input.actor,
        action: input.action,
        since: input.since ? new Date(input.since) : undefined,
        limit: input.limit,
      }),
    ),

  /**
   * Phase B.7b · owner-only · the unified live log tail · merges
   * ErrorLog + CronJobLog + SystemMetric + AutonomousAction +
   * ApiRequestLog into one reverse-chron stream. Replaces GET
   * /api/system/logs · delegates to the shared
   * `system-pages-b.buildSystemLogs` service (the SystemMetric `tags`
   * / ErrorLog `context` Json columns are nested under each entry's
   * `meta` bag typed `unknown` · TS2589 firewall). The legacy
   * `?limit` (clamped 10-500) / `?since` (ms · clamped 60s-24h) /
   * `?level` / `?source` (comma-list) query params are mirrored as
   * typed inputs — `sinceMs` is a number, `sources` an array. LogsPage
   * keys on the input + polls on a 10s interval.
   */
  systemLogs: operatorProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(10).max(500).optional(),
          sinceMs: z.number().int().min(60_000).max(86_400_000).optional(),
          level: z
            .enum(["error", "warn", "info", "success", "metric"])
            .optional(),
          sources: z
            .array(
              z.enum(["errors", "crons", "metrics", "actions", "requests"]),
            )
            .max(5)
            .optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      buildSystemLogs({
        limit: input?.limit,
        sinceMs: input?.sinceMs,
        level: input?.level,
        sources: input?.sources,
      }),
    ),

  // ═══════════ Cross-domain residuals slice · chat→system ═══════════
  //
  // The components/chat/* cards that hit /api/ai/* + /api/system/*
  // cross-domain endpoints. Each procedure delegates to a shared
  // lib/services/ function the legacy REST route ALSO calls · drift
  // structurally impossible. No input takes a permissive z.record —
  // providerHealth takes no input; agentTraceByMessage
  // takes a strict z.object.

  /**
   * straggler-pages slice · owner-only · the live migration tracker ·
   * static registry + scanned source-tree progress + the feature-flag
   * board. Replaces GET /api/system/migrations · delegates to the
   * shared `migrations-tracker.buildMigrationsTracker` the legacy
   * route also calls · drift impossible. The payload is fully typed
   * (`MigrationsPayload`) — flag list + summary are scalars, no Prisma
   * Json reaches the wire. The /system/migrations page polls this.
   */
  migrationsTracker: operatorProcedure.query(
    async (): Promise<MigrationsPayload> => buildMigrationsTracker(),
  ),

  /**
   * straggler-pages slice · owner-only · the honest feature-status
   * registry (LIVE / PARTIAL / DORMANT + activation triggers).
   * Replaces GET /api/system/feature-status · reads the same
   * `FEATURE_REGISTRY` + `summarize()` the legacy route returns ·
   * drift impossible. Both are plain serializable data (no Prisma) ·
   * no TS2589 firewall needed. The /system/features page polls this.
   */
  featureStatus: operatorProcedure.query(
    (): {
      generatedAt: string;
      summary: ReturnType<typeof summarize>;
      features: FeatureMeta[];
    } => ({
      generatedAt: new Date().toISOString(),
      summary: summarize(),
      features: FEATURE_REGISTRY,
    }),
  ),

};
