/**
 * lib/trpc/routers/brain.ts · Phase UU (2026-05-19 AM) · extended
 * Phase UU.2 (2026-05-22 · legacy-modernizer REST→tRPC settings slice)
 * · extended Phase B.6d (2026-05-22 · REST→tRPC brain-domain slice).
 *
 * Brain-domain procedures · the 8th domain router (nick · operator ·
 * system · chat · browser · task · journal · brain). Wraps the
 * /brain/wisdom dashboard read + curation actions plus — as of B.6d —
 * the full /brain dashboard component surface (alerts · beliefs ·
 * maturity · categories · contradictions · activity stream · graph
 * explorer · nudges · page tracker · patterns · prediction streaks ·
 * qualitative identity · recent insights · suggestion + tool telemetry
 * · wisdom evolution · brain-dump capture).
 *
 * Phase UU.2 adds two brain-domain reads the /settings surfaces touch
 * (the SettingsPage SystemInfo memory count + the SystemDataCards
 * memory-of-the-day card) — they're brain reads, so they live here
 * rather than in a thin `settings` router.
 *
 * Phase B.6d migrates the ~20 components/brain/* + brain-dump-modal
 * call-sites off `authedFetch`. Every NEW procedure delegates to a
 * shared `lib/services/` or `lib/brain/` function the legacy REST route
 * ALSO calls · drift structurally impossible. Read procedures returning
 * Prisma rows go through services with explicit shallow return shapes
 * (the BrainMemory / AuditEvent Json columns projected to scalar /
 * `unknown`) so the recursive `JsonValue` type never reaches the
 * AppRouter — the TS2589 firewall.
 *
 * Delegates to shared services · the legacy REST routes call the same
 * modules · drift impossible.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, operatorProcedure } from "../trpc";
import {
  buildWisdomFeed,
  updateWisdom,
  actOnWisdom,
  WisdomNotFoundError,
  WrongCategoryError,
  NoValidFieldsError,
} from "@/lib/services/brain-wisdom";
import {
  listLinkCandidates,
  decideLinkCandidate,
  ReviewRowNotFoundError,
} from "@/lib/services/link-review";
import { listMediaMoments } from "@/lib/services/media-moments";
import {
  listPins,
  // BDN-322 · saved media moments (read side of media plan #7).
  createPin,
  updatePin,
  deletePin,
  PinNotFoundError,
  PinContentRequiredError,
  PinContentTooLongError,
} from "@/lib/services/pins";
import { brainMemory } from "@/lib/brain/memory-manager";
import { getMemoryOfTheDay } from "@/lib/services/memory-of-the-day";
import { prisma } from "@/lib/prisma";
// 2026-05-24 · Wave V · feature-mining wire-up · calibrationSummary
// procedure surfaces the existing summarizeCalibration helper to /brain.
// Pre-Wave-V the math has been built + tested + the brierScore column
// has been populated by outcome-tracker for ~22 days · zero UI consumer.
import { summarizeCalibration } from "@/lib/brain/calibration";
// Phase B.6d · brain-domain slice · the shared services / lib functions
// the migrated components/brain/* + brain-dump-modal call-sites delegate
// to. Each is also called by the matching legacy REST route — drift
// structurally impossible.
import {
  buildActiveAlerts,
  buildBrainMaturity,
  buildBrainExport,
  resetBrainState,
  buildCategoryStats,
  buildRecentInsights,
  buildGraphNeighborhood,
  buildActivityStream,
  recordPageVisit,
  buildSuggestionStats,
} from "@/lib/services/brain-domain";
import {
  listStoredContradictions,
  resolveStoredContradiction,
  type ContradictionResolveChoice,
} from "@/lib/services/contradictions";
import {
  loadActiveBeliefs,
  loadBeliefCandidates,
  promoteBelief,
  dropBelief,
  editBelief,
  harvestBeliefs,
} from "@/lib/brain/belief-harvester";
import { computeNudges, dismissNudge } from "@/lib/brain/cross-system-nudge";
import { listDiscoveries, rateDiscovery } from "@/lib/brain/discoveries";
import {
  loadCurrentPatterns,
  runPatternClustering,
} from "@/lib/services/pattern-clusterer";
import { computePredictionStreaks } from "@/lib/brain/prediction-streaks";
import {
  loadQualitativeIdentity,
  computeQualitativeIdentity,
  addManualEntry,
  removeEntry,
} from "@/lib/brain/qualitative-identity";
import { getToolStats, getProblemTools } from "@/lib/ai/tool-telemetry";
import { TOOL_CATALOG, getToolRiskClass } from "@/lib/ai/tools/catalog";
import { nourTools } from "@/lib/ai/tools";
import { runWisdomEvolution } from "@/lib/brain/wisdom-evolution";
import { recordMetric } from "@/lib/services/metrics";
import { ingestJournal } from "@/lib/brain/journal-ingest";
import { ServiceError } from "@/lib/utils/service-error";
// Cross-domain residuals slice (2026-05-22) · the shared functions the
// migrated components/chat/* + components/ultron/* cards delegate to for
// their /api/brain/* + /api/intel cross-domain calls. Each is also
// called by the matching legacy REST route — drift structurally
// impossible.
import { getLatestEscalation } from "@/lib/services/escalations";
import { getIndustryIntel } from "@/lib/services/industry-intel";
import {
  trackSuggestionAction,
  recordSuggestionOutcome,
  SuggestionKind,
  OutcomePolarity,
  ActionEvent,
} from "@/lib/brain/suggestion-loop";
import {
  getGhostPredictions,
  computeGhostPredictions,
  loadGhostAccuracy,
  dismissPrediction,
} from "@/lib/brain/ghost-nick";
// actions-surface REST→tRPC slice (2026-05-22) · the shared services the
// migrated components/actions/* cards delegate to for their /api/brain/*
// + /api/ultron/* calls. Each is also called by the matching legacy REST
// route — drift structurally impossible. The memory reads return the
// explicit shallow `BrainMemoryRow` shape (the BrainMemory `metadata`
// Json projected to `unknown` inside the service · the AppRouter type
// stays shallow · TS2589 firewall).
import { buildPulseDigest } from "@/lib/services/pulse-digest";
import {
  listMemories,
  recordMemory,
  forgetMemoryByKey,
} from "@/lib/services/brain-memories";
// scattered-components REST→tRPC slice (2026-05-22) · the shared
// services the migrated components/brain/* views delegate to for their
// /api/brain/{memory-health,insights,continuity} reads. Each is also
// called by the matching legacy REST route — drift structurally
// impossible. Every service projects to flat scalar shapes (the
// BrainMemory `metadata` Json is never selected / never returned) so
// the recursive Prisma `JsonValue` type never reaches the AppRouter —
// the TS2589 firewall.
import { buildMemoryHealth } from "@/lib/services/brain-health";
import { buildBrainInsights } from "@/lib/services/brain-insights";
import { buildContinuityReport } from "@/lib/services/brain-continuity";
// CoALA reflection layer (task #12 · 2026-05-23) · operator-triggered
// per-category synthesis. The cron at /api/cron/reflect-categories
// calls the same service · drift impossible.
import {
  reflectOnCategory,
  type ReflectionResult,
} from "@/lib/services/reflection";
// Reflection viewer read-side (task #13 · 2026-05-23) · the
// /brain/reflections surface. A future REST route could call the same
// function · drift impossible. Returns the explicit flat
// `ReflectionView` (`metadata` Json projected to scalar + string[]
// inside the service · TS2589 firewall).
import {
  listRecentReflections,
  type ReflectionView,
} from "@/lib/services/reflection-read";
// Multi-advisor board consultation (task #24 · 2026-05-23) ·
// composition layer over `lib/ai/board/consult.ts` (pure pattern) +
// `brainMemory.remember` (persistence). Read-side projects metadata
// Json to flat `BoardConsultationView` scalars so the recursive
// Prisma `JsonValue` type never reaches the AppRouter (TS2589
// firewall · same pattern as listRecentReflections).
import {
  consultBoardAndPersist,
  listRecentBoardConsultations,
  type BoardConsultationView,
} from "@/lib/services/board-consult-record";
import { BOARD_IDS } from "@/lib/ai/board/boards";

export const brainRouter = router({
  /**
   * Phase UU · owner-only · /brain/wisdom dashboard feed · all
   * wisdom-category BrainMemory rows grouped by origin + source +
   * hotness-scored. React Query keys on (none) · refetch via
   * invalidate-after-mutation in the curation handlers.
   */
  wisdom: operatorProcedure.query(async () => buildWisdomFeed()),

  /**
   * Phase UU · owner-only · operator-curated edit to wisdom content
   * or confidence. Sets confidence=1.0 unless explicitly overridden
   * (caller-supplied values 0-1 honored). Throws BAD_REQUEST when
   * no valid fields are provided · throws NOT_FOUND on missing id.
   */
  updateWisdom: operatorProcedure
    .input(
      z.object({
        id: z.string().min(1).max(64),
        content: z.string().min(30).max(2000).optional(),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await updateWisdom(input);
      } catch (err) {
        if (err instanceof NoValidFieldsError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Phase UU · owner-only · soft-delete (deprecate) · restore · or
   * promote wisdom_candidate → wisdom. Promotion sets confidence=0.9
   * (conservative · operator-curated). Restore clears deletedAt.
   *
   * Edge cases:
   *   · promote on non-candidate → BAD_REQUEST (WrongCategoryError)
   *   · not-found id             → NOT_FOUND
   */
  actOnWisdom: operatorProcedure
    .input(
      z.object({
        id: z.string().min(1).max(64),
        action: z.enum(["deprecate", "promote", "restore"]),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await actOnWisdom(input);
      } catch (err) {
        if (err instanceof WisdomNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: err.message });
        }
        if (err instanceof WrongCategoryError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Phase VV (2026-05-19 AM) · owner-only · pending conversation→
   * mission link review candidates. The cosine-0.45-0.55 borderline
   * matches queue here for operator approval before being committed
   * to ChatConversation.missionId.
   */
  linkReview: operatorProcedure.query(async () => listLinkCandidates()),

  /**
   * Phase VV · owner-only · approve/reject/snooze a single review
   * candidate. Approve writes ChatConversation.missionId in a
   * transaction + soft-deletes the review row (audit trail). Reject
   * soft-deletes only. Snooze bumps lastSeen so the row sinks to the
   * bottom of the queue.
   */
  decideLinkReview: operatorProcedure
    .input(
      z.object({
        conversationId: z.string().min(1).max(64),
        missionId: z.string().min(1).max(64),
        decision: z.enum(["approve", "reject", "snooze"]),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await decideLinkCandidate(input);
      } catch (err) {
        if (err instanceof ReviewRowNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Phase YY (2026-05-19 AM) · owner-only · pinned-memory roster ·
   * top-50 active pins sorted by updatedAt desc + optional stats
   * envelope (freshPins · stalePins · estimatedPromptTokens · etc.)
   * for the /pins page header.
   *
   * Indexed via `@@index([category, updatedAt])` + `@@index([category,
   * deletedAt])` on BrainMemory (both explicitly added Apr 18/20 for
   * this query · prisma-expert + neon-postgres lens confirm zero
   * findings).
   */
  /**
   * BDN-322 · owner-only · saved media moments for ONE media item,
   * earliest offset first. Scoped to a single id on purpose: a moment
   * stores an offset but no URL, so a seek is only guaranteed to land
   * when that media is already in the player. See lib/services/
   * media-moments.ts for why a global list would show dead entries.
   */
  mediaMoments: operatorProcedure
    .input(z.object({ mediaId: z.string().min(1).max(300) }))
    .query(async ({ input }) => listMediaMoments(input.mediaId)),

  pinned: operatorProcedure
    .input(
      z
        .object({ withStats: z.boolean().optional() })
        .optional(),
    )
    .query(async ({ input }) =>
      listPins({ withStats: input?.withStats ?? false }),
    ),

  /**
   * Phase YY · owner-only · create or re-pin a memory by content-hash
   * key. Idempotent · re-pinning the same slugified key bumps
   * seenCount + reasserts confidence=1.0 instead of duplicating.
   * Fires `storeMemoryEmbedding` fire-and-forget so semantic search
   * stays in sync.
   */
  createPin: operatorProcedure
    .input(
      z.object({
        content: z.string().min(1).max(2000),
        source: z.string().max(40).optional(),
        label: z.string().max(80).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await createPin(input);
      } catch (err) {
        if (err instanceof PinContentRequiredError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        if (err instanceof PinContentTooLongError) {
          throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Phase YY · owner-only · edit a pin's content / label / source.
   * Content >1200 chars truncates server-side (system prompt is
   * already paying for top-5 × 260-char preview · longer is wasted).
   * Re-embeds on content change.
   */
  updatePin: operatorProcedure
    .input(
      z.object({
        id: z.string().min(1).max(64),
        content: z.string().max(2000).optional(),
        label: z.string().max(80).optional(),
        source: z.string().max(40).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await updatePin(input);
      } catch (err) {
        if (err instanceof PinNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: err.message });
        }
        if (err instanceof PinContentRequiredError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Phase YY · owner-only · soft-delete a pin · restorable from the
   * trash view via the existing soft-delete helpers. Uses the
   * `softDelete` lib so the audit trail is consistent with other
   * BrainMemory deletions.
   */
  deletePin: operatorProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => deletePin(input)),

  // ──────────────── Settings surfaces (UU.2) ────────────────

  /**
   * Phase UU.2 · owner-only · brain health + memory stats. Replaces
   * GET /api/brain/status · assembles from the SAME three sources the
   * REST route uses (`brainMemory.getStatus` · recent PatternDetection
   * rows · enabled AutomationRule rows) · drift impossible.
   *
   * The SettingsPage SystemInfo card reads only the memory count off
   * this · with the typed tRPC shape the call-site now reads
   * `data.memories.total` (where the count genuinely lives) rather
   * than the top-level `data.total` the legacy code read — that read
   * was always `undefined` (the route nests the count under
   * `memories`), so the memory line silently never populated. The
   * endpoint payload is unchanged; only the client read is corrected.
   */
  status: operatorProcedure.query(async () => {
    const [memories, recentPatterns, automationRules] = await Promise.all([
      brainMemory.getStatus(),
      prisma.patternDetection.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { patternName: true, date: true, evidence: true },
      }),
      prisma.automationRule.findMany({
        where: { enabled: true },
        select: { name: true, priority: true, lastFired: true, fireCount: true },
        orderBy: { priority: "asc" },
      }),
    ]);
    return {
      memories,
      recentPatterns,
      automationRules: {
        active: automationRules.length,
        rules: automationRules,
      },
    };
  }),

  /**
   * Phase UU.2 · owner-only · the one memory worth surfacing today
   * (weighted-random over high-confidence curated rows · idempotent
   * for the day). Replaces GET /api/brain/memory-of-the-day ·
   * delegates to the shared `memory-of-the-day` service. Returns the
   * report at the top level — the legacy route wrapped it in
   * `{ data }`; the tRPC query hands it back unwrapped.
   */
  memoryOfTheDay: operatorProcedure.query(async () => getMemoryOfTheDay()),

  // ════════════════ Phase B.6d · /brain dashboard surface ════════════════
  //
  // The ~20 components/brain/* + brain-dump-modal call-sites migrated off
  // `authedFetch`. Every procedure delegates to a shared service / lib
  // function the legacy REST route ALSO calls · drift structurally
  // impossible. Read procedures returning Prisma rows go through services
  // with explicit shallow return shapes (`brain-domain.ts` projects every
  // BrainMemory / AuditEvent Json column to scalar / `unknown`) so the
  // recursive `JsonValue` type never reaches the AppRouter — TS2589
  // firewall.

  /**
   * Phase B.6d · owner-only · recent BrainMemory alert rows (correlation
   * · decision-quality-drift · schema-drift · quota · spike · brain-bus)
   * grouped by category. Replaces GET /api/brain/active-alerts ·
   * delegates to the shared `brain-domain.buildActiveAlerts`. The
   * legacy `?limit` / `?sinceDays` query params are mirrored as typed
   * optional inputs (same 1-50 / 1-180 clamps).
   *
   * ActiveAlertsCard read only · React Query drives the refetch (the
   * card used a one-shot `load()` · no interval).
   */
  activeAlerts: operatorProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).optional(),
          sinceDays: z.number().int().min(1).max(180).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      buildActiveAlerts({
        limit: input?.limit ?? 10,
        sinceDays: input?.sinceDays ?? 30,
      }),
    ),

  /**
   * W3 alert lifecycle · resolve = soft-delete the alert row (alerts ARE
   * brainMemory rows; recall + the builder already exclude deletedAt) ·
   * receipt lives in the row's deletedAt. mute = expiring alert_mute row
   * per category, honored server-side in buildActiveAlerts.
   */
  resolveAlert: operatorProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const { prisma } = await import("@/lib/prisma");
      const res = await prisma.brainMemory.updateMany({
        where: { id: input.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return { ok: res.count === 1 };
    }),

  muteAlertCategory: operatorProcedure
    .input(z.object({ category: z.string().min(1).max(64), days: z.number().int().min(1).max(90).default(7) }))
    .mutation(async ({ input, ctx }) => {
      const { prisma } = await import("@/lib/prisma");
      await prisma.brainMemory.upsert({
        where: { category_key: { category: "alert_mute", key: input.category } },
        create: {
          category: "alert_mute",
          key: input.category,
          content: `muted by ${ctx.session.email ?? "operator"} for ${input.days}d`,
          confidence: 1,
          source: "alert-lifecycle",
          expiresAt: new Date(Date.now() + input.days * 86_400_000),
        },
        update: {
          content: `muted by ${ctx.session.email ?? "operator"} for ${input.days}d`,
          expiresAt: new Date(Date.now() + input.days * 86_400_000),
          deletedAt: null,
        },
      });
      return { ok: true as const, until: new Date(Date.now() + input.days * 86_400_000).toISOString() };
    }),

  /**
   * Phase B.6d · owner-only · the curated belief library · active
   * beliefs + pending candidates. Replaces GET /api/beliefs ·
   * delegates to the shared `belief-harvester` lib functions the REST
   * route also calls. Returns `{ active, candidates }` mirroring the
   * legacy envelope. `StoredBelief` is a flat object parsed from a JSON
   * content column (no Prisma Json) · no TS2589 firewall needed.
   */
  beliefs: operatorProcedure.query(async () => {
    const [active, candidates] = await Promise.all([
      loadActiveBeliefs(),
      loadBeliefCandidates(),
    ]);
    return { active, candidates };
  }),

  /**
   * Phase B.6d · owner-only · run the belief harvester now (the
   * "harvest now" button on BeliefsPanel). Replaces the
   * `action: "harvest_now"` branch of PATCH /api/beliefs · delegates to
   * the shared `belief-harvester.harvestBeliefs`. Returns
   * `{ ok, result }` mirroring the legacy envelope.
   */
  harvestBeliefs: operatorProcedure.mutation(async () => {
    const result = await harvestBeliefs();
    return { ok: true as const, result };
  }),

  /**
   * Phase B.6d · owner-only · promote / drop / edit a belief or
   * belief-candidate. Replaces the `promote` / `drop` / `edit` branches
   * of PATCH /api/beliefs · delegates to the shared `belief-harvester`
   * functions the route also calls. The route's per-action validation
   * (statement required on edit · candidate-not-found → 404) is mirrored
   * here so both transports reject identically.
   */
  actOnBelief: operatorProcedure
    .input(
      z.object({
        key: z.string().min(1).max(64),
        action: z.enum(["promote", "drop", "edit"]),
        kind: z.enum(["belief", "belief_candidate"]).optional(),
        statement: z.string().min(1).max(2000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.action === "promote") {
        const promoted = await promoteBelief(input.key, input.statement);
        if (!promoted) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "candidate not found",
          });
        }
        return { ok: true as const, belief: promoted };
      }
      if (input.action === "drop") {
        const kind = input.kind ?? "belief_candidate";
        const dropped = await dropBelief(input.key, kind);
        if (!dropped) {
          throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
        }
        return { ok: true as const, dropped: true };
      }
      // edit
      if (!input.statement) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "statement required",
        });
      }
      const kind = input.kind ?? "belief";
      const edited = await editBelief(input.key, kind, input.statement);
      if (!edited) {
        throw new TRPCError({ code: "NOT_FOUND", message: "not found" });
      }
      return { ok: true as const, belief: edited };
    }),

  /**
   * Phase B.6d · owner-only · the aggregate brain-maturity rollup
   * (0-100 score + per-subsystem counters). Replaces GET
   * /api/brain/maturity · delegates to the shared
   * `brain-domain.buildBrainMaturity`. Returns the rollup at the top
   * level — the legacy route wrapped it in `{ maturity }`; the
   * BrainMaturityHeader call-site reads the object directly.
   */
  maturity: operatorProcedure.query(async () => buildBrainMaturity()),

  /**
   * Phase B.6d · owner-only · the full self-model JSON dump (the
   * download-backup button on BrainMaturityHeader). Replaces GET
   * /api/brain/export · delegates to the shared
   * `brain-domain.buildBrainExport`. Return type is `unknown` — the
   * payload is a heterogeneous backup blob the client serialises
   * straight to a Blob (TS2589 firewall · the deep snapshot types stay
   * out of the AppRouter).
   */
  exportBrain: operatorProcedure.query(async () => buildBrainExport()),

  /**
   * Phase B.6d · owner-only · nuke ALL brain-learning state (the
   * double-confirmed reset button on BrainMaturityHeader). Replaces
   * POST /api/brain/reset · delegates to the shared
   * `brain-domain.resetBrainState` so the destructive 12-category set
   * never drifts between transports. Irreversible.
   */
  reset: operatorProcedure.mutation(async () => resetBrainState()),

  /**
   * Phase B.6d · owner-only · the BrainMemory category heat-map (per-
   * category row counts · freshness · confidence · registry status).
   * Replaces GET /api/brain/category-stats · delegates to the shared
   * `brain-domain.buildCategoryStats`. The legacy route wrapped the
   * payload in `{ data }`; the BrainCategoriesView call-site reads the
   * object directly. Preserves the `cache: "no-store"` semantics — the
   * call-site sets `staleTime: 0`.
   */
  categoryStats: operatorProcedure.query(async () => buildCategoryStats()),

  /**
   * Phase B.6d · owner-only · the /brain panel contradiction list ·
   * unresolved-only by default, full 90-day history when
   * `includeResolved`. Replaces GET /api/contradictions (`?all=1`) ·
   * delegates to the shared `contradictions.listStoredContradictions`.
   * Returns `{ contradictions }` mirroring the legacy envelope ·
   * `StoredContradiction` is a flat object parsed from a JSON content
   * column (no Prisma Json) · no TS2589 firewall needed. Distinct from
   * `system.contradictions` (the ultron card's camelCase view).
   */
  /**
   * 2026-08-16 · owner-only · the Discover feed — what the nightly creative
   * engines found that the operator has not yet judged. Ordered by RECENCY,
   * never confidence (see lib/brain/discoveries.ts for why that matters).
   *
   * Ledgers each surfacing so the verdict below has a row to decide on;
   * recordShown dedups on the content hash within 24h, so re-mounting the
   * tab does not inflate the denominator.
   */
  discoveries: operatorProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).optional(),
          includeRated: z.boolean().optional(),
          withinDays: z.number().int().min(1).max(365).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const result = await listDiscoveries({
        limit: input?.limit,
        includeRated: input?.includeRated,
        withinDays: input?.withinDays,
      });
      void (async () => {
        const { recordShown } = await import("@/lib/services/outcome-ledger");
        for (const d of result.items) {
          if (d.verdict !== null) continue;
          await recordShown({
            kind: "suggestion",
            sourceEngine: `discovery:${d.category}`,
            summary: d.content,
            shownSurface: "brain-discover",
          });
        }
      })().catch(() => {
        /* ledger failure must never break the feed */
      });
      return result;
    }),

  /**
   * 2026-08-16 · owner-only · judge a discovery. "known" is the important
   * one: it is the only measurement of "you told me something I already
   * knew", and therefore the only evidence that can ever justify tuning the
   * novelty axis (NICK_NOVELTY_RECALL).
   */
  rateDiscovery: operatorProcedure
    .input(
      z.object({
        id: z.string().min(1).max(64),
        verdict: z.enum(["investigate", "known", "noise"]),
      }),
    )
    .mutation(async ({ input }) => rateDiscovery(input.id, input.verdict)),

  contradictions: operatorProcedure
    .input(
      z.object({ includeResolved: z.boolean().optional() }).optional(),
    )
    .query(async ({ input }) =>
      listStoredContradictions({
        includeResolved: input?.includeResolved ?? false,
      }),
    ),

  /**
   * Phase B.6d · owner-only · resolve a contradiction from the /brain
   * panel (current_wins · old_wins · both_valid · dismissed). Replaces
   * PATCH /api/contradictions · delegates to the shared
   * `contradictions.resolveStoredContradiction`. A missing-or-corrupt
   * row throws ServiceError(404) → NOT_FOUND so both transports reject
   * identically.
   */
  resolveContradiction: operatorProcedure
    .input(
      z.object({
        key: z.string().min(1).max(128),
        status: z.enum([
          "current_wins",
          "old_wins",
          "both_valid",
          "dismissed",
        ]),
        note: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await resolveStoredContradiction({
          key: input.key,
          status: input.status as ContradictionResolveChoice,
          note: input.note,
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
   * Phase B.6d · owner-only · the cross-OS entity-audit firehose ·
   * recent activity across every entity, newest-first. Replaces the
   * global-firehose branch of GET /api/audit/entity (`?firehose=1`) ·
   * delegates to the shared `brain-domain.buildActivityStream` (the
   * AuditEvent `payload` / before / after Json is dropped, scalar
   * fields only · TS2589 firewall). GlobalActivityStream polls this on
   * a 60s interval · React Query now drives the refetch. The legacy
   * `?limit=` param (clamped 1-500) is mirrored as a typed input.
   */
  activityStream: operatorProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(500).optional() })
        .optional(),
    )
    .query(async ({ input }) =>
      buildActivityStream({ limit: input?.limit ?? 30 }),
    ),

  /**
   * Phase B.6d · owner-only · the edge neighborhood around one memory-
   * graph node (depth 1 or 2). Replaces GET /api/brain/graph-neighborhood
   * · delegates to the shared `brain-domain.buildGraphNeighborhood`. The
   * MemoryGraphExplorer modal fetches this imperatively on each
   * pivot/reload via `utils.brain.graphNeighborhood.fetch()`.
   */
  graphNeighborhood: operatorProcedure
    .input(
      z.object({
        type: z.string().min(1).max(60),
        id: z.string().min(1).max(128),
        depth: z.union([z.literal(1), z.literal(2)]).default(1),
      }),
    )
    .query(async ({ input }) =>
      buildGraphNeighborhood({
        type: input.type,
        id: input.id,
        depth: input.depth,
      }),
    ),

  /**
   * Phase B.6d · owner-only · the cross-system real-time nudge feed.
   * Replaces GET /api/brain/nudges · delegates to the shared
   * `cross-system-nudge.computeNudges` the REST route also calls.
   * Returns `{ nudges }` mirroring the legacy envelope. `Nudge` is a
   * flat object · no TS2589 firewall needed.
   */
  nudges: operatorProcedure.query(async () => {
    const nudges = await computeNudges();
    // 2026-08-16 · ledger the surfacing so the dismissal below has something
    // to decide ON. Before this, IntelligenceOutcome had five producers and
    // zero deciders — `decision` was NULL on every row, `outcomesNeedingReview`
    // always returned empty, and the recall-eval corpus could never grow past
    // its synthetic seeds. The nudge lane closes the loop because it is the
    // one surface where the same TEXT is available on both the show and the
    // dismiss side (see recordDecisionByContent).
    // Fire-and-forget: recordShown dedups identical summaries within 24h, so
    // repeated panel mounts do not inflate the denominator.
    void (async () => {
      const { recordShown } = await import("@/lib/services/outcome-ledger");
      for (const n of nudges) {
        await recordShown({
          kind: "suggestion",
          sourceEngine: `nudge:${n.source}`,
          summary: n.text,
          shownSurface: "brain-nudge-panel",
        });
      }
    })().catch(() => {
      /* ledger failure must never break the nudge feed */
    });
    return { nudges };
  }),

  /**
   * Phase B.6d · owner-only · dismiss (ACK) a nudge for a window. The
   * NudgePanel per-nudge dismiss button fires this. Replaces POST
   * /api/brain/nudges/dismiss · delegates to the shared
   * `cross-system-nudge.dismissNudge` (which lives alongside
   * `computeNudges` so the ack-key derivation can't drift from the
   * suppression filter). `until` defaults to "7d" — the panel sends
   * exactly that.
   */
  dismissNudge: operatorProcedure
    .input(
      z.object({
        source: z.string().min(1).max(60),
        text: z.string().min(1).max(2000),
        until: z.enum(["today", "7d", "forever"]).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await dismissNudge({
        source: input.source,
        text: input.text,
        until: input.until,
      });
      // 2026-08-16 · the other half of the learning loop. A dismissal is the
      // operator saying "this recommendation was not useful" — the exact
      // signal outcomesNeedingReview() harvests into recall-eval cases.
      // Joined by content hash, not id: see recordDecisionByContent.
      void (async () => {
        const { recordDecisionByContent } = await import("@/lib/services/outcome-ledger");
        await recordDecisionByContent(input.text, "dismissed", `nudge:${input.source}`);
      })().catch(() => {
        /* the dismissal itself already succeeded — never fail it on the ledger */
      });
      return result;
    }),

  /**
   * Phase B.6d · owner-only · record a silent page visit for brain
   * pattern detection. The PageTracker component fires this fire-and-
   * forget on every route change. Replaces POST /api/brain/page-visit ·
   * delegates to the shared `brain-domain.recordPageVisit`. Fail-silent
   * (tracking is non-critical) — the service swallows write errors.
   */
  pageVisit: operatorProcedure
    .input(
      z.object({
        page: z.string().min(1).max(512),
        referrer: z.string().max(2048).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) =>
      recordPageVisit({ page: input.page, referrer: input.referrer }),
    ),

  /**
   * Phase B.6d · owner-only · the current task-pattern clusters from
   * BrainMemory (8-axis identity clusters). Replaces GET
   * /api/brain/patterns · delegates to the shared
   * `pattern-clusterer.loadCurrentPatterns`. Returns `{ patterns }`
   * mirroring the legacy envelope. `ClusteredPattern` is a flat object
   * · no TS2589 firewall needed. PatternCard reads this + a 500ms-
   * debounced reload on the `tasks` data-change bus.
   */
  patterns: operatorProcedure.query(async () => {
    const patterns = await loadCurrentPatterns();
    return { patterns };
  }),

  /**
   * Phase B.6d · owner-only · regenerate the task-pattern clusters on
   * demand (the "regen" button on PatternCard). Replaces POST
   * /api/brain/patterns · delegates to the shared
   * `pattern-clusterer.runPatternClustering`. Returns the
   * `{ patterns, emitted }` run result.
   */
  regeneratePatterns: operatorProcedure.mutation(async () =>
    runPatternClustering(),
  ),

  /**
   * Phase B.6d · owner-only · per-category prediction-accuracy streaks.
   * Replaces GET /api/brain/prediction-streaks · delegates to the
   * shared `prediction-streaks.computePredictionStreaks`. The legacy
   * `?windowDays=` param (clamped 7-365 · default 90) is mirrored as a
   * typed optional input. Returns the `StreaksReport` (flat object · no
   * TS2589 firewall needed). PredictionStreaksCard read only.
   */
  predictionStreaks: operatorProcedure
    .input(
      z
        .object({
          windowDays: z.number().int().min(7).max(365).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      computePredictionStreaks(input?.windowDays ?? 90),
    ),

  /**
   * Phase B.6d · owner-only · the qualitative-identity bundle (values ·
   * fears · operating style · rhythms · red lines). Replaces GET
   * /api/identity/qualitative · delegates to the shared
   * `qualitative-identity.loadQualitativeIdentity`. Returns
   * `{ identity }` mirroring the legacy envelope. `QualitativeIdentity`
   * is a flat object parsed from a JSON content column · no TS2589
   * firewall needed.
   */
  qualitativeIdentity: operatorProcedure.query(async () => {
    const identity = await loadQualitativeIdentity();
    return { identity };
  }),

  /**
   * Phase B.6d · owner-only · recompute the qualitative identity from
   * 60d of reflections + chat importance + beliefs (the "recompute"
   * button on QualitativeIdentityPanel). Replaces POST
   * /api/identity/qualitative · delegates to the shared
   * `qualitative-identity.computeQualitativeIdentity`. Returns
   * `{ identity }` so the call-site reads the same shape the GET does.
   */
  recomputeQualitativeIdentity: operatorProcedure.mutation(async () => {
    const identity = await computeQualitativeIdentity();
    return { identity };
  }),

  /**
   * Phase B.6d · owner-only · add or remove a manual qualitative-
   * identity entry. Replaces the `add` / `remove` branches of PATCH
   * /api/identity/qualitative · delegates to the shared
   * `qualitative-identity.{addManualEntry,removeEntry}`. The route's
   * `bucket` whitelist + `text` ≥3-char guard are hoisted to the typed
   * `.input()` so a bad bucket is rejected at the boundary. Returns
   * `{ identity }` so the call-site re-renders from the same shape.
   */
  editQualitativeIdentity: operatorProcedure
    .input(
      z.object({
        action: z.enum(["add", "remove"]),
        bucket: z.enum([
          "values",
          "fears",
          "operating_style",
          "rhythms",
          "red_lines",
        ]),
        text: z.string().min(3).max(180),
      }),
    )
    .mutation(async ({ input }) => {
      const identity =
        input.action === "add"
          ? await addManualEntry(input.bucket, input.text)
          : await removeEntry(input.bucket, input.text);
      return { identity };
    }),

  /**
   * Phase B.6d · owner-only · last-N-days task-insight rows grouped-
   * ready by 8-axis identity. Replaces GET /api/brain/recent-insights ·
   * delegates to the shared `brain-domain.buildRecentInsights` (the
   * BrainMemory `metadata` Json is projected to 3 scalar fields inside
   * the service · TS2589 firewall). The legacy `?days` / `?limit`
   * params (clamped 1-30 / 1-200) are mirrored as typed inputs.
   * RecentInsightsPanel read only · `cache: "no-store"` semantics
   * preserved via `staleTime: 0` at the call-site.
   */
  recentInsights: operatorProcedure
    .input(
      z
        .object({
          days: z.number().int().min(1).max(30).optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      buildRecentInsights({
        days: input?.days ?? 7,
        limit: input?.limit ?? 50,
      }),
    ),

  /**
   * Phase B.6d · owner-only · suggestion-cache hit/miss + Venice
   * OK/fail telemetry (lambda-local live counters + 24h SystemMetric
   * baseline). Replaces GET /api/ai/chat/suggestions/stats · delegates
   * to the shared `brain-domain.buildSuggestionStats`. SuggestionTelemetryPanel
   * polls this on a 15s interval · React Query now drives the refetch.
   */
  suggestionStats: operatorProcedure.query(async () =>
    buildSuggestionStats(),
  ),

  /**
   * Phase B.6d · owner-only · per-tool invocation telemetry (totalCalls
   * · successRate · avgDurationMs · lastErrors) + the problem-tool
   * list. Replaces GET /api/brain/tools · delegates to the shared
   * `tool-telemetry.{getToolStats,getProblemTools}` the REST route also
   * calls. Returns `{ ok, total, problem, stats }` mirroring the legacy
   * envelope. `ToolStat` is a flat object · no TS2589 firewall needed.
   */
  toolTelemetry: operatorProcedure.query(async () => {
    const [stats, problem] = await Promise.all([
      getToolStats(200),
      getProblemTools(),
    ]);

    const statsMap = new Map(stats.map((s) => [s.toolName, s]));
    const liveTools = new Set(Object.keys(nourTools));

    const missingEnvKeysSet = new Set<string>();
    const enrichedStats = TOOL_CATALOG.map((meta) => {
      const name = meta.name;
      const liveInToolset = liveTools.has(name);
      const telemetry = statsMap.get(name);

      const requiredEnv = meta.requiredEnv ?? [];
      const missingEnv = requiredEnv.filter((k) => !process.env[k]);

      // Calculate missing env keys across all active/live tools
      if (liveInToolset) {
        for (const k of missingEnv) {
          missingEnvKeysSet.add(k);
        }
      }

      // Calculate dynamic status
      let status: "active" | "restricted_active" | "scaffolded" | "inert" | "blocked" = "active";
      if (!liveInToolset) {
        status = "scaffolded";
      } else if (missingEnv.length > 0) {
        status = "inert";
      } else if (meta.sideEffecting) {
        status = "restricted_active";
      }

      const riskClass = getToolRiskClass(name, meta);

      return {
        toolName: name,
        category: meta.category,
        description: (nourTools as any)[name]?.description ?? `No description in catalog for ${name}`,
        mutates: meta.sideEffecting ?? false,
        riskClass,
        status,
        requiredEnv,
        missingEnv,
        totalCalls: telemetry?.totalCalls ?? 0,
        successRate: telemetry?.successRate ?? 0,
        avgDurationMs: telemetry?.avgDurationMs ?? 0,
        failCount: telemetry?.failCount ?? 0,
        lastCallAt: telemetry?.lastCallAt,
        lastErrors: telemetry?.lastErrors ?? [],
        registered: true,
        liveInToolset,
      };
    });

    // Handle drift: tools in nourTools but missing from TOOL_CATALOG
    const regKeys = new Set(TOOL_CATALOG.map((t) => t.name));
    const missingFromRegistry = [...liveTools].filter((k) => !regKeys.has(k));
    const missingFromTools = [...regKeys].filter((k) => !liveTools.has(k));

    // Append any live tools missing from registry to the stats list so they still show up
    for (const name of missingFromRegistry) {
      const telemetry = statsMap.get(name);
      enrichedStats.push({
        toolName: name,
        category: "meta" as any,
        description: (nourTools as any)[name]?.description ?? "(missing from tool catalog registry)",
        mutates: false,
        riskClass: "medium",
        status: "active",
        requiredEnv: [],
        missingEnv: [],
        totalCalls: telemetry?.totalCalls ?? 0,
        successRate: telemetry?.successRate ?? 0,
        avgDurationMs: telemetry?.avgDurationMs ?? 0,
        failCount: telemetry?.failCount ?? 0,
        lastCallAt: telemetry?.lastCallAt,
        lastErrors: telemetry?.lastErrors ?? [],
        registered: false,
        liveInToolset: true,
      });
    }

    // Sort enrichedStats by totalCalls descending
    enrichedStats.sort((a, b) => {
      if (a.totalCalls !== b.totalCalls) {
        return b.totalCalls - a.totalCalls;
      }
      return a.toolName.localeCompare(b.toolName);
    });

    return {
      ok: true as const,
      total: enrichedStats.length,
      problem,
      stats: enrichedStats,
      drift: {
        inToolsetMissingFromRegistry: missingFromRegistry,
        inRegistryMissingFromToolset: missingFromTools,
      },
      missingEnvKeys: Array.from(missingEnvKeysSet),
    };
  }),

  /**
   * Phase B.6d · owner-only · the three self-evolution candidate
   * classes (stale · redundant · low-trust). Replaces GET
   * /api/brain/wisdom/evolution · delegates to the shared
   * `wisdom-evolution.runWisdomEvolution` the REST route also calls.
   * Returns `{ stale, redundant, lowTrust, totalCandidates }` — all
   * flat objects · no TS2589 firewall needed. WisdomEvolutionPanel read
   * (the panel reuses `brain.actOnWisdom` for the deprecate action).
   */
  wisdomEvolution: operatorProcedure.query(async () => runWisdomEvolution()),

  /**
   * Phase B.6d · owner-only · lightweight brain-feedback telemetry
   * recorder. Replaces POST /api/brain/telemetry · delegates to the
   * shared `metrics.recordMetric` the REST route also calls. The
   * route's `ALLOWED_EVENTS` whitelist is hoisted to a strict
   * `z.enum` at the `.input()` boundary so an unknown event is
   * rejected there. Fire-and-forget from the WisdomEvolutionPanel
   * deprecate handler.
   */
  recordTelemetry: operatorProcedure
    .input(
      z.object({
        event: z.enum([
          "see_also_click",
          "evolution_deprecate",
          "evolution_review",
          "mode_chip_cycle",
          "mode_chip_send",
          "improve_page_view",
        ]),
        value: z.number().finite().optional(),
        tags: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      await recordMetric(
        `brain_feedback.${input.event}`,
        typeof input.value === "number" && Number.isFinite(input.value)
          ? input.value
          : 1,
        {
          unit: "count",
          tags: input.tags ?? {},
          source: "brain-feedback-ui",
        },
      );
      return { ok: true as const };
    }),

  /**
   * Phase B.6d · owner-only · raw-text brain-dump capture · runs the
   * full journal-ingest pipeline (BrainDump row + AI extraction +
   * pgvector embedding + task/insight/commitment writes). Replaces POST
   * /api/journal/capture · delegates to the shared
   * `journal-ingest.ingestJournal` the REST route also calls. The
   * BrainDumpModal fires this; the optimistic-UI clear happens
   * client-side before the mutation resolves. The route's `min 3 chars`
   * guard is hoisted to the typed `.input()`.
   *
   * Rate-limiting · the REST route checks `checkAiRateLimit(req)` ·
   * the tRPC path is owner-only + single-operator so request-level
   * rate-limiting is deferred (matching the `task.aiGenerate` rationale
   * · essentially zero abuse surface).
   */
  captureThought: operatorProcedure
    .input(
      z.object({
        text: z.string().min(3).max(20_000),
        // Item B (2026-06-10) · capture-mode entry-type hint. The modal's
        // mode picker declares what KIND of entry the operator is writing;
        // ingestJournal lets it outrank the blind fast classification.
        entryTypeHint: z
          .enum(["raw", "thinking", "reasoning", "insight", "decision", "reflection", "planning", "venting"])
          .optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await ingestJournal(input.text.trim(), "manual", {
          entryTypeHint: input.entryTypeHint,
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

  // ═══════════ Cross-domain residuals slice · chat/ultron→brain ═══════════
  //
  // The components/chat/* + components/ultron/* cards that hit /api/brain/*
  // + /api/intel cross-domain endpoints. Each procedure delegates to a
  // shared service / lib function the legacy REST route ALSO calls ·
  // drift structurally impossible. The suggestion-loop write input is a
  // strict discriminated union built from the suggestion-loop lib's own
  // exported z.enum constants (NOT a permissive z.record · the typed-
  // payload-mismatch guard).

  /**
   * Cross-domain residuals slice · owner-only · the most-recent
   * unresolved lead escalation (last 6h). Replaces GET
   * /api/brain/escalations · delegates to the shared
   * `escalations.getLatestEscalation` service. `useAdaptivePlaceholder`
   * fans this in alongside `maturity` + `industryIntel` to craft the
   * composer placeholder. Returns the explicit shallow `EscalationView`
   * (BrainMemory `metadata` Json projected to `unknown` · TS2589
   * firewall). Fail-soft · a DB error resolves to `{ escalation: null }`.
   */
  escalations: operatorProcedure.query(async () => getLatestEscalation()),

  /**
   * Cross-domain residuals slice · owner-only · the last-14d automotive
   * industry-intel rollup (top 30). Replaces GET /api/intel · delegates
   * to the shared `industry-intel.getIndustryIntel` service the REST
   * route also calls · drift impossible. `recallIndustryIntel` already
   * returns a flat scalar array · no Prisma Json reaches the AppRouter.
   * `useAdaptivePlaceholder` reads `industry[0].title` for the quiet
   * placeholder rotation.
   *
   * Routed to the `brain` domain · /api/intel is the brain-intel
   * surface and `useAdaptivePlaceholder` already reads two other
   * /api/brain/* endpoints in the same fan-out.
   */
  industryIntel: operatorProcedure.query(async () => getIndustryIntel()),

  /**
   * Cross-domain residuals slice · owner-only · capture a supervised-
   * signal loop event for a Nick suggestion (action OR outcome).
   * Replaces POST /api/brain/suggestion-loop · delegates to the shared
   * `suggestion-loop.{trackSuggestionAction,recordSuggestionOutcome}`
   * the REST route also calls · drift impossible.
   *
   * Input is a strict discriminated union on `type` — the `action`
   * variant carries `event` (acted/dismissed/modified/deferred), the
   * `outcome` variant carries `polarity` (positive/negative/neutral).
   * Both reuse the suggestion-loop lib's own `SuggestionKind` /
   * `ActionEvent` / `OutcomePolarity` z.enum exports so the enums can't
   * drift from the lib's internal `.parse()`. NickSuggestions fires the
   * `action` variant fire-and-forget on chip tap (`acted`) + X
   * (`dismissed`).
   */
  recordSuggestionSignal: operatorProcedure
    .input(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("action"),
          suggestionId: z.string().min(1).max(128),
          suggestionKind: SuggestionKind,
          event: ActionEvent,
          delaySeconds: z
            .number()
            .int()
            .nonnegative()
            .max(60 * 60 * 24 * 365)
            .optional(),
          modifiedTo: z.string().max(2000).optional(),
          notes: z.string().max(2000).optional(),
        }),
        z.object({
          type: z.literal("outcome"),
          suggestionId: z.string().min(1).max(128),
          suggestionKind: SuggestionKind,
          polarity: OutcomePolarity,
          delaySeconds: z
            .number()
            .int()
            .nonnegative()
            .max(60 * 60 * 24 * 365)
            .optional(),
          notes: z.string().max(4000).optional(),
        }),
      ]),
    )
    .mutation(async ({ input }) => {
      if (input.type === "action") {
        return trackSuggestionAction({
          suggestionId: input.suggestionId,
          suggestionKind: input.suggestionKind,
          event: input.event,
          delaySeconds: input.delaySeconds,
          modifiedTo: input.modifiedTo,
          notes: input.notes,
        });
      }
      return recordSuggestionOutcome({
        suggestionId: input.suggestionId,
        suggestionKind: input.suggestionKind,
        polarity: input.polarity,
        delaySeconds: input.delaySeconds,
        notes: input.notes,
      });
    }),

  /**
   * Cross-domain residuals slice · owner-only · the current Ghost Nick
   * prediction bundle + accuracy. Replaces GET /api/brain/ghost-predict
   * · delegates to the shared `ghost-nick.{getGhostPredictions,
   * loadGhostAccuracy}` the REST route also calls · drift impossible.
   * GhostNickStrip polls this on a 15-min interval · React Query now
   * drives the refetch. `GhostPredictionBundle` / `GhostAccuracy` are
   * flat interfaces (no Prisma Json) · no TS2589 firewall needed.
   */
  ghostPredict: operatorProcedure.query(async () => {
    const [bundle, accuracy] = await Promise.all([
      getGhostPredictions(),
      loadGhostAccuracy(),
    ]);
    return { bundle, accuracy };
  }),

  /**
   * Cross-domain residuals slice · owner-only · force a recompute of
   * the Ghost Nick prediction bundle (the GhostNickStrip "recompute"
   * button). Replaces POST /api/brain/ghost-predict · delegates to the
   * shared `ghost-nick.{computeGhostPredictions,loadGhostAccuracy}`.
   * Modeled as a `.mutation()` · genuine work (re-runs the predictor +
   * persists the bundle). The caller invalidates `brain.ghostPredict`
   * after success.
   */
  recomputeGhostPredict: operatorProcedure.mutation(async () => {
    const [bundle, accuracy] = await Promise.all([
      computeGhostPredictions(),
      loadGhostAccuracy(),
    ]);
    return { bundle, accuracy, recomputed: true as const };
  }),

  /**
   * Cross-domain residuals slice · owner-only · dismiss one Ghost Nick
   * prediction (the per-row "not going to do this" button). Replaces
   * PATCH /api/brain/ghost-predict · delegates to the shared
   * `ghost-nick.dismissPrediction`. The route's `action: "dismiss"`
   * discriminator is dropped (the procedure name IS the action) ·
   * `taskIdOrTitle` is the only real param. A missing bundle / no match
   * throws NOT_FOUND so both transports reject identically.
   */
  dismissGhostPrediction: operatorProcedure
    .input(z.object({ taskIdOrTitle: z.string().min(1).max(400) }))
    .mutation(async ({ input }) => {
      const bundle = await dismissPrediction(input.taskIdOrTitle);
      if (!bundle) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "bundle missing or no match",
        });
      }
      return { bundle };
    }),
  // ═══════════ actions-surface REST→tRPC slice · actions→brain ═══════════
  //
  // The components/actions/* cards that hit /api/ultron/pulse-digest +
  // /api/brain/memories. Each procedure delegates to a shared service the
  // legacy REST route ALSO calls · drift structurally impossible. The
  // memory reads return the explicit shallow `BrainMemoryRow` shape (the
  // BrainMemory `metadata` Json projected to `unknown` inside the service)
  // so no recursive Prisma `JsonValue` type reaches the AppRouter — the
  // TS2589 firewall.

  /**
   * actions-surface slice · owner-only · the ranked-and-clustered
   * notification-bell digest (priority · emerging · wins · maintenance
   * tiers + summary mood). Replaces GET /api/ultron/pulse-digest ·
   * delegates to the shared `pulse-digest.buildPulseDigest` service the
   * REST route also calls · drift impossible. The service is 60s-cached
   * internally · DailyBriefSection polls this on a 5-min interval ·
   * React Query now drives the refetch. The legacy route wrapped the
   * payload in `{ data }`; the procedure returns the explicit shallow
   * `PulseDigest` unwrapped (every field a scalar projection · the
   * AuditEvent `payload` Json is read only to derive a link string
   * inside the service · never returned · TS2589 firewall).
   */
  pulseDigest: operatorProcedure.query(async () => buildPulseDigest()),

  /**
   * actions-surface slice · owner-only · recall BrainMemory rows by
   * category + optional search query, sorted by confidence. Replaces
   * GET /api/brain/memories · delegates to the shared
   * `brain-memories.listMemories` service the REST route also calls ·
   * drift impossible. The legacy `?category` / `?q` / `?minConfidence`
   * / `?limit` query params are mirrored as a typed optional input.
   * KommandoLearn reads `spaced_review` + `decisions`-adjacent rows off
   * this. Returns `{ memories }` (explicit shallow `BrainMemoryRow[]` ·
   * the `metadata` Json column projected to `unknown` · TS2589 firewall).
   */
  memories: operatorProcedure
    .input(
      z
        .object({
          category: z.string().max(80).optional(),
          query: z.string().max(200).optional(),
          minConfidence: z.number().min(0).max(1).optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      listMemories({
        category: input?.category,
        query: input?.query,
        minConfidence: input?.minConfidence,
        limit: input?.limit,
      }),
    ),

  /**
   * actions-surface slice · owner-only · persist (or reinforce) one
   * BrainMemory row. Replaces POST /api/brain/memories · delegates to
   * the shared `brain-memories.recordMemory` service the REST route
   * also calls · `brainMemory.remember` upserts by (category, key) so
   * re-recording the same key reinforces rather than duplicating. The
   * route's `category` / `key` / `content` required-field guard is
   * hoisted to the typed `.input()` (all `.min(1)`) — the typed-
   * payload-mismatch guard. KommandoLearn's "Save to brain" + spaced-
   * review scheduling fire this. Returns `{ memory }` (explicit shallow
   * `BrainMemoryRow`).
   */
  recordMemory: operatorProcedure
    .input(
      z.object({
        category: z.string().min(1).max(80),
        key: z.string().min(1).max(200),
        content: z.string().min(1).max(20_000),
        source: z.string().max(60).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input }) =>
      recordMemory({
        category: input.category,
        key: input.key,
        content: input.content,
        source: input.source,
        metadata: input.metadata,
      }),
    ),

  /**
   * actions-surface slice · owner-only · soft-delete the most-recent
   * BrainMemory row matching a key. KommandoLearn's spaced-review
   * "Got it ✓" affordance fires this.
   *
   * GENUINELY NEW behaviour · the legacy `DELETE /api/brain/memories
   * ?key=…` call had NO route handler — it always 404'd and the error
   * was silently swallowed (the review row never actually cleared).
   * This procedure does the real lookup-by-key soft-delete the UI
   * promised all along. Idempotent · a missing key resolves to
   * `{ ok: true, deleted: false }` (preserving the no-throw contract).
   */
  forgetMemoryByKey: operatorProcedure
    .input(z.object({ key: z.string().min(1).max(200) }))
    .mutation(async ({ input }) => forgetMemoryByKey(input.key)),

  // ═══════════ scattered-components REST→tRPC slice · brain/* views ═══════════
  //
  // The components/brain/* views that hit /api/brain/{memory-health,
  // insights,continuity}. Each procedure delegates to a shared service
  // the legacy REST route ALSO calls · drift structurally impossible.
  // The services project every row to flat scalar shapes (no BrainMemory
  // `metadata` Json is selected or returned) so no recursive Prisma
  // `JsonValue` type reaches the AppRouter — the TS2589 firewall.

  /**
   * scattered-components slice · owner-only · the per-category brain-
   * memory health rollup (counts · freshness · confidence ·
   * vectorization coverage · unhealthy-category flags). Replaces GET
   * /api/brain/memory-health · delegates to the shared
   * `brain-health.buildMemoryHealth` service the REST route also calls
   * · drift impossible. BrainHealthView read only · React Query drives
   * the refetch (the legacy view used `useAuthedFetch`'s one-shot
   * fetch). Returns the explicit flat `MemoryHealthReport` (the rollup
   * is a raw-SQL aggregation yielding plain scalars · TS2589 firewall
   * satisfied trivially).
   */
  memoryHealth: operatorProcedure.query(async () => buildMemoryHealth()),

  /**
   * scattered-components slice · owner-only · the cross-system
   * narrative-ribbon insight feed (week-over-week pattern signal —
   * anti-pattern sprint · category growth · reflection gap · decision
   * velocity · domain clustering · grade trend · cron-failure trend).
   * Replaces GET /api/brain/insights · delegates to the shared
   * `brain-insights.buildBrainInsights` service the REST route also
   * calls · drift impossible. InsightRibbon read only. Distinct from
   * `brain.nudges` (actionable now-deltas) · `BrainInsight` is a flat
   * object · no TS2589 firewall needed.
   */
  insightsRibbon: operatorProcedure.query(async () => buildBrainInsights()),

  /**
   * scattered-components slice · owner-only · the cross-session memory-
   * continuity rollup (totals · 24h created/reinforced/decayed/promoted
   * · 7d reinforced leaderboard · all-time confidence leaderboard ·
   * per-category churn movers). Replaces GET /api/brain/continuity ·
   * delegates to the shared `brain-continuity.buildContinuityReport`
   * service the REST route also calls · drift impossible.
   * BrainContinuityView read only · React Query drives the refetch.
   * Returns the explicit flat `ContinuityReport` (every memory row
   * `select`s scalar fields only · the `metadata` Json is never
   * touched · TS2589 firewall).
   */
  continuityReport: operatorProcedure.query(async () =>
    buildContinuityReport(),
  ),

  // ═══════════ CoALA reflection layer · task #12 (2026-05-23) ═══════════
  //
  // Operator-triggered per-category synthesis. The cron at
  // /api/cron/reflect-categories calls the same service · drift
  // impossible. The result shape is flat (`ReflectionResult` is already
  // scalar · `derivedFrom: string[]`) so no Prisma `JsonValue` reaches
  // the AppRouter — TS2589 firewall satisfied trivially.

  /**
   * CoALA reflection layer · owner-only · synthesize 3-5 higher-level
   * insights across recent BrainMemory rows of the given source
   * category. Persists each insight as a new `reflection`-category
   * BrainMemory row with `metadata.derivedFrom` citing the source ids.
   *
   * Returns `skipped` when nothing was written:
   *   · `insufficient-source`     · fewer than `minSourceCount` rows
   *   · `recent-reflection-exists` · same category reflected on within
   *                                  the last 24h (idempotency guard)
   *
   * Modeled as a `.mutation()` · genuine write work (LLM call +
   * BrainMemory inserts). Operator triggers ad-hoc from the brain
   * dashboard "reflect now" affordance.
   */
  reflect: operatorProcedure
    .input(
      z.object({
        category: z.string().min(1).max(80),
        windowDays: z.number().int().min(1).max(90).optional(),
        maxInsights: z.number().int().min(1).max(10).optional(),
      }),
    )
    .mutation(async ({ input }): Promise<ReflectionResult> =>
      reflectOnCategory({
        category: input.category,
        windowDays: input.windowDays,
        maxInsights: input.maxInsights,
      }),
    ),

  /**
   * CoALA reflection viewer · owner-only · the read-side complement to
   * `brain.reflect`. Lists recent `reflection`-category BrainMemory rows
   * (newest first) projected to the flat `ReflectionView` shape — the
   * known metadata fields (`sourceCategory` · `derivedFrom` ·
   * `reflectionWindow` · `confidence`) hoisted to top-level scalars +
   * string[] · `metadata` Json never reaches the AppRouter. TS2589
   * firewall satisfied trivially.
   *
   * Optional `sourceCategory` filter — passing "all" or omitting
   * returns every category. The /brain/reflections page renders the
   * category-filter dropdown over the five cron-iterated source
   * categories (`decision_log` · `pattern` · `belief` · `lesson` ·
   * `learning_journal`) plus "all".
   */
  recentReflections: operatorProcedure
    .input(
      z.object({
        sourceCategory: z.string().min(1).max(80).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(
      async ({ input }): Promise<{ reflections: ReflectionView[] }> =>
        listRecentReflections({
          sourceCategory: input.sourceCategory,
          limit: input.limit,
        }),
    ),

  /**
   * Task #24 (2026-05-23) · owner-only · runs a multi-advisor board
   * consultation. Fans out to N advisors in parallel, synthesizes,
   * persists the result as a `board_consultation` BrainMemory row,
   * returns both the consultation + the recordId. Caller-side cost
   * proxy = members.length advisor aiChat calls + 1 synthesizer call
   * (default 5-member board = 6 calls · taskType: "reason" routes
   * to Venice/Ollama first).
   *
   * Throws BAD_REQUEST on unknown boardId · throws INTERNAL_SERVER_
   * ERROR on storage failure (consultation completed but write failed).
   */
  consultBoard: operatorProcedure
    .input(
      z.object({
        // BOARD_IDS is a const tuple · use refine to type-narrow the
        // input to a known board id rather than z.enum (which would
        // need a tuple). String-with-includes-check keeps the
        // boards.ts as the single source of truth for board ids.
        boardId: z.string().refine(
          (s): s is (typeof BOARD_IDS)[number] =>
            (BOARD_IDS as ReadonlyArray<string>).includes(s),
          { message: "boardId must be one of: " + BOARD_IDS.join(", ") },
        ),
        question: z
          .string()
          .min(8, "question must be at least 8 chars")
          .max(4000, "question must be under 4000 chars"),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const result = await consultBoardAndPersist(
          input.boardId,
          input.question,
        );
        return result;
      } catch (err) {
        if (err instanceof Error && /Unknown board/.test(err.message)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: err.message,
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            err instanceof Error
              ? `consultBoard failed: ${err.message.slice(0, 120)}`
              : "consultBoard failed",
        });
      }
    }),

  /**
   * Task #24 · owner-only · list recent board consultations · flat
   * projected view (metadata Json opened inside the service · TS2589
   * firewall). Read by the /brain/board surface to render the
   * "recent consultations" rail.
   */
  recentBoardConsultations: operatorProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(
      async ({
        input,
      }): Promise<{ consultations: BoardConsultationView[] }> =>
        listRecentBoardConsultations({ limit: input.limit }),
    ),

  /**
   * 2026-05-24 · Wave V feature-mining · IdentitySnapshot deltaFromLast.
   *
   * loadIdentitySnapshot() in operator-router returns a typed projection
   * without the raw `deltaFromLast` text column · this procedure pulls
   * the most-recent snapshot's narrative directly from the DB. The
   * column is populated by the daily 04:30 identity-refresh cron ·
   * pre-Wave-V no UI surfaced it.
   *
   * Returns null when no snapshot exists OR when deltaFromLast is empty
   * (e.g. first snapshot of a new install · the cron has nothing to
   * compare against).
   */
  identityDelta: operatorProcedure.query(async () => {
    try {
      const row = await prisma.identitySnapshot.findFirst({
        orderBy: { createdAt: "desc" },
        select: { deltaFromLast: true, createdAt: true, date: true },
      });
      if (!row || !row.deltaFromLast || row.deltaFromLast.trim().length === 0) {
        return null;
      }
      return {
        delta: row.deltaFromLast,
        date: row.date,
        computedAt: row.createdAt.toISOString(),
      };
    } catch {
      return null;
    }
  }),

  /**
   * 2026-05-24 · Wave V feature-mining · calibration summary for /brain.
   *
   * Pre-Wave-V `summarizeCalibration` was tested + Prediction.brierScore
   * was populated by the outcome-tracker cron · zero UI rendered it.
   * Now: /brain Predictions zone shows mean Brier + verdict + hit-rate
   * alongside the existing PredictionStreaksCard. Brier is the
   * calibration metric (does 70% confidence actually hit 70% of the
   * time) · hit-rate is the credibility metric (do predictions land
   * at all). Both belong on the page.
   *
   * Degrades to { resolved: 0, ... } on Prisma failure (silent) ·
   * the consuming tile hides itself when resolved === 0.
   */
  calibrationSummary: operatorProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(30) }).optional())
    .query(async ({ input }) => {
      try {
        return await summarizeCalibration({ days: input?.days ?? 30 });
      } catch {
        return {
          resolved: 0,
          confirmed: 0,
          hitRate: null,
          meanBrier: null,
          verdict: "unknown" as const,
          avgClaimVsRealityGap: null,
        };
      }
    }),

  /**
   * Wave W Phase 4 · 2026-05-24 · unified recall inbox.
   *
   * Fans out to 4 paid-for readers in parallel (pins · link-review ·
   * contradictions · active-alerts) and returns the merged "needs
   * your attention" feed. Each source is wrapped in its own try/catch
   * so one slow/broken reader can't break the inbox. Replaces the
   * "operator checks 3 different /brain sub-pages every morning"
   * habit · single panel surface on /brain hub Zone 1.
   */
  recallInbox: operatorProcedure.query(async () => {
    const { buildRecallInbox } = await import(
      "@/lib/services/recall-inbox"
    );
    return await buildRecallInbox();
  }),
});
