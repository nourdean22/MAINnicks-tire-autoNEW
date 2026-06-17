/**
 * lib/trpc/routers/operator.ts · Phase J (2026-05-18 PM) · extended
 * Phase UU.2 (2026-05-22 · legacy-modernizer REST→tRPC settings slice).
 *
 * Operator-state procedures · forward-looking intelligence + chains.
 * Replaces:
 *   · GET /api/operator/pulse    → pulse
 *   · GET /api/operator/compound → compound
 *
 * Both are read-heavy + surface-aware · same heuristic composers
 * the legacy endpoints used.
 *
 * Phase UU.2 folds the /settings operator-preference + self-model
 * surfaces in here (rather than spawning a thin `settings` router):
 * the 8-axis identity snapshot, the behavioral skill library, the live
 * AI config, and the cold-memory Drive sync. All are operator-scoped
 * preference / self-model state → `operator` is their natural home.
 * Each procedure delegates to the SAME module the legacy REST route
 * calls · drift structurally impossible.
 */

import { z } from "zod";
import { router, operatorProcedure } from "../trpc";
import { DOMAINS } from "@/lib/mastery/config";
import { xpEventTotalsSince } from "@/lib/mastery/credit";
import { toDateString } from "@/lib/utils/datetime";
import {
  buildOperatorPulse,
  type PulseSurface,
} from "@/lib/services/operator-pulse";
import {
  buildCompoundChain,
  type CompoundSurface,
} from "@/lib/services/compound-chain";
import { buildGoalsSnapshot } from "@/lib/services/goals-snapshot";
import { buildMetaScoreboard } from "@/lib/services/meta-scoreboard";
import { computeCharacterSheet } from "@/lib/mastery/character-sheet";
import {
  getBodyTracking,
  logBodyEntry,
  bodyEntrySchema,
} from "@/lib/services/body-tracking";
import {
  listKnowledgeFiles,
  readKnowledgeFile,
  searchKnowledge,
} from "@/lib/mastery/knowledge";
import {
  computeIdentitySnapshot,
  loadIdentitySnapshot,
  loadIdentityHistory,
  setManualOverride,
  projectIdentityForward,
} from "@/lib/brain/identity-snapshot";
import {
  loadActiveSkills,
  loadPendingSkills,
  promoteSkill,
  dropSkill,
  setGraduated,
  editSkill,
  extractSkillsFromTasks,
} from "@/lib/brain/skill-extractor";
import {
  getAiConfig,
  updateAiConfig,
  resetAiConfig,
} from "@/lib/settings/ai-config";
import { runDriveIngest } from "@/lib/brain/drive-ingest";
import { getColdMemoryStats } from "@/lib/brain/cold-memory";
import { ServiceError } from "@/lib/utils/service-error";
import {
  getAllFlags,
  getFlag,
  loadFeatureFlagOverrides,
} from "@/lib/feature-flags";
import {
  aiConfigPatchSchema,
  skillCurationSchema,
} from "@/lib/validators/settings";
import { buildTickerFeed } from "@/lib/services/ultron-ticker";
import { buildPersonalPulse } from "@/lib/services/personal-pulse";
import { buildSituation } from "@/lib/services/ultron-situation";
import { buildTodoDesk } from "@/lib/services/todo-desk";
import { buildMicroPlan, IntentTooShortError } from "@/lib/services/ultron-plan";
import { getMit, setMit } from "@/lib/services/mit";
import { refreshHealthDigest } from "@/lib/system/health-digest";
import { buildCommandCenterState } from "@/lib/ai/context/command-center-state";
import { getFinancialSnapshots } from "@/lib/services/financial-snapshot";
import {
  getRevenueStats,
  getDashboardSummary,
} from "@/lib/services/business-intel";
import { getContentHistory } from "@/lib/services/content-history";
import { approveDraft, rejectDraft } from "@/lib/content/drafts";
import {
  getDecisionDetail,
  gradeDecision as gradeDecisionService,
} from "@/lib/services/decision-detail";
// actions-surface REST→tRPC slice (2026-05-22) · the decision-log list
// read · also called by the legacy GET /api/decisions route — drift
// structurally impossible. The scattered-components slice (2026-05-22)
// adds `createDecision` — the decision-log WRITE the OmniCapture
// `/decide` branch fires — also called by the legacy POST handler.
import { listDecisions, createDecision } from "@/lib/services/decisions";
import { improvePhoto, MissingImageError } from "@/lib/services/photo-improver";
import {
  getSocialSchedule,
  getRecentImages,
  publishSocialPost,
  scheduleSocialPost as scheduleSocialPostService,
  SocialPublishInputError,
  SocialImageUrlUnresolvedError,
  SocialScheduleInputError,
} from "@/lib/services/social-actions";
// straggler-pages REST→tRPC slice (2026-05-22) · the two shared
// services the migrated /knowledge + /voice page surfaces delegate to.
// Each is also called by the matching legacy REST route — drift
// structurally impossible. Both return explicit flat shapes (the
// knowledge-refresh result is all scalars; the morning-brief view
// stringifies its Date) — no Prisma Json reaches the wire.
import {
  runKnowledgeRefresh,
  KnowledgeRefreshError,
  type KnowledgeRefreshResult,
} from "@/lib/services/knowledge-refresh";
import {
  readMorningBrief,
  type MorningBriefView,
} from "@/lib/services/morning-brief-read";
// hooks-lib REST→tRPC slice (2026-05-22) · the commitment-create
// service the `/commit` chat direct-action fires. Also called by the
// create branch of the legacy POST /api/commitments route — drift
// structurally impossible.
import { createCommitment } from "@/lib/services/commitments";
import { TRPCError } from "@trpc/server";

// The 8 valid identity axes · mirrors `VALID_AXES` in
// app/api/identity/route.ts verbatim (the route keeps its copy as the
// rollback path). Used as the strict enum for the `pinIdentityAxis`
// input so an unknown axis is rejected at the procedure boundary.
const IDENTITY_AXES = [
  "velocity",
  "patience_horizon",
  "promise_integrity",
  "dopamine_discipline",
  "business_vs_personal",
  "risk_appetite",
  "social_battery",
  "reflection_cadence",
] as const;

const PulseSurfaceSchema = z.enum([
  "tasks",
  "goals",
  "scoreboard",
  "home",
]) satisfies z.ZodType<PulseSurface>;

const CompoundSurfaceSchema = z.enum([
  "tasks",
  "goals",
  "scoreboard",
  "home",
]) satisfies z.ZodType<CompoundSurface>;

export const operatorRouter = router({
  pulse: operatorProcedure
    .input(z.object({ surface: PulseSurfaceSchema.default("home") }))
    .query(async ({ input }) => {
      return buildOperatorPulse(input.surface);
    }),

  compound: operatorProcedure
    .input(z.object({ surface: CompoundSurfaceSchema.default("home") }))
    .query(async ({ input }) => {
      return buildCompoundChain(input.surface);
    }),

  /**
   * Phase OO (2026-05-19 AM) · owner-only · composite payload for the
   * /goals page (LifeGoal ladder + active missions + 8-axis mastery
   * scores + prune-candidates count). Delegates to
   * `lib/services/goals-snapshot.buildGoalsSnapshot` shared service ·
   * legacy GET /api/goals/snapshot calls the same function · drift
   * impossible.
   *
   * No input · snapshot is operator-scoped (single user surface).
   * React Query inherits the existing 30s cache + auto-refetch.
   */
  goalsSnapshot: operatorProcedure.query(async () => {
    return buildGoalsSnapshot();
  }),

  /**
   * Phase WW (2026-05-19 AM) · owner-only · meta-scoreboard snapshot
   * for the /scoreboard page · 5-10 anchor numbers + anomalies
   * surfaced dynamically · composedAt + lastBriefAt + state ("calm"
   * vs "alive"). Delegates to `lib/services/meta-scoreboard` which
   * the legacy REST endpoint also calls · drift impossible.
   *
   * 30s cache matches the route's prior Cache-Control.
   */
  scoreboardSnapshot: operatorProcedure.query(async () =>
    buildMetaScoreboard(),
  ),

  /**
   * 2026-05-30 · the mastery leveling engine's read side. One StatLevel
   * per domain (level · tier · XP-into-level · progress%), computed from
   * the lifetime sum of MasteryScore.delta (task XP via auto-learn) +
   * mastery_xp event log (journal/chat/email XP via the nightly cron).
   * Schema-free · no new tables · delegates to computeCharacterSheet so
   * the /scoreboard card and Nick's system prompt read the same numbers.
   */
  characterSheet: operatorProcedure.query(async () => computeCharacterSheet()),

  /**
   * Phase XX (2026-05-19 AM) · owner-only · body tracking timeline +
   * progress to TARGET_WEIGHT (186 lbs). Range filter: "30d" · "90d"
   * (default) · "365d". Returns entries + progress envelope when a
   * latest weight exists.
   */
  bodyTracking: operatorProcedure
    .input(
      z.object({ range: z.enum(["30d", "90d", "365d"]).optional() }).optional(),
    )
    .query(async ({ input }) => getBodyTracking({ range: input?.range })),

  /**
   * Phase XX · owner-only · log a partial body-tracking entry · all
   * fields optional · upsert-by-date so re-submission for the same
   * day updates without duplicating. Operator hits this multiple
   * times per day with different slices (sleep AM · weight PM).
   */
  logBodyEntry: operatorProcedure
    .input(bodyEntrySchema)
    .mutation(async ({ input }) => logBodyEntry(input)),

  /**
   * Phase ZZ (2026-05-19 AM) · owner-only · list filesystem-backed
   * knowledge files (markdown corpus in `data/knowledge/`). Returns
   * the manifest + categories.
   *
   * Delegates to `lib/mastery/knowledge.listKnowledgeFiles` which
   * the legacy REST endpoint also calls · drift impossible.
   */
  knowledgeFiles: operatorProcedure.query(async () => {
    const files = listKnowledgeFiles();
    const categories = [...new Set(files.map((f) => f.category))];
    return { files, categories, total: files.length };
  }),

  /**
   * Phase ZZ · owner-only · read a single knowledge file's content.
   * Throws NOT_FOUND when the path doesn't resolve to a real file.
   */
  knowledgeFile: operatorProcedure
    .input(z.object({ path: z.string().min(1).max(400) }))
    .query(async ({ input }) => {
      const content = readKnowledgeFile(input.path);
      if (!content) {
        throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
      }
      return { path: input.path, content };
    }),

  /**
   * Phase ZZ · owner-only · search across the knowledge corpus.
   * Returns ranked matches with snippet excerpts.
   */
  knowledgeSearch: operatorProcedure
    .input(z.object({ q: z.string().min(1).max(200) }))
    .query(async ({ input }) => {
      const results = searchKnowledge(input.q);
      return {
        query: input.q,
        results: results.map((r) => ({
          name: r.file.name,
          category: r.file.category,
          path: r.file.relativePath,
          match_count: r.matches.length,
          matches: r.matches,
        })),
        total: results.length,
      };
    }),

  // ──────────────── Settings · identity snapshot (UU.2) ────────────────

  /**
   * Phase UU.2 · owner-only · the 8-axis self-model + optional 30-day
   * history. Replaces GET /api/identity?history=1 · delegates to the
   * same `identity-snapshot` module the REST route calls · drift
   * impossible. Returns `{ snapshot, history }` matching the legacy
   * `data` envelope so IdentityPanel's `raw.data?.snapshot` access is
   * unchanged.
   */
  identity: operatorProcedure
    .input(
      z.object({
        history: z.boolean().optional(),
        days: z.number().optional(),
      }).optional(),
    )
    .query(async ({ input }) => {
      const days = input?.days ?? 90;
      const [snapshot, history] = await Promise.all([
        loadIdentitySnapshot(),
        input?.history ? loadIdentityHistory(days) : Promise.resolve(null),
      ]);
      return { snapshot, history };
    }),

  identityProjection: operatorProcedure
    .input(z.object({ days: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const days = input?.days ?? 30;
      return projectIdentityForward(days);
    }),

  xpGrowthComparison: operatorProcedure.query(async () => {
    const horizons = [30, 60, 90, 180];
    const now = new Date();
    const prismaModule = await import("@/lib/prisma");
    const p = prismaModule.prisma;
    
    const promises = horizons.map(async (days) => {
      const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const sinceKey = toDateString(since);
      
      const [taskSums, eventSums] = await Promise.all([
        p.masteryScore
          .groupBy({
            by: ["domain"],
            _sum: { delta: true },
            where: { date: { gte: sinceKey } },
          })
          .catch(() => [] as { domain: string; _sum: { delta: number | null } }[]),
        xpEventTotalsSince(since),
      ]);
      
      const map = new Map<string, number>();
      for (const t of taskSums) {
        map.set(t.domain, Math.max(0, t._sum.delta ?? 0));
      }
      for (const [key, val] of eventSums.entries()) {
        map.set(key, (map.get(key) ?? 0) + val);
      }
      return { days, map };
    });
    
    const results = await Promise.all(promises);
    
    return DOMAINS.map((d) => {
      const g30 = results.find((r) => r.days === 30)?.map.get(d.key) ?? 0;
      const g60 = results.find((r) => r.days === 60)?.map.get(d.key) ?? 0;
      const g90 = results.find((r) => r.days === 90)?.map.get(d.key) ?? 0;
      const g180 = results.find((r) => r.days === 180)?.map.get(d.key) ?? 0;
      
      return {
        stat: d.key,
        label: d.label,
        icon: d.icon,
        gained30d: Math.round(g30 * 10) / 10,
        gained60d: Math.round(g60 * 10) / 10,
        gained90d: Math.round(g90 * 10) / 10,
        gained180d: Math.round(g180 * 10) / 10,
      };
    });
  }),

  /**
   * Phase UU.2 · owner-only · recompute the identity snapshot NOW
   * (normally rolls daily 04:30). Replaces POST /api/identity ·
   * delegates to `computeIdentitySnapshot` · returns `{ snapshot }`.
   */
  recomputeIdentity: operatorProcedure.mutation(async () => {
    return { snapshot: await computeIdentitySnapshot() };
  }),

  /**
   * Phase UU.2 · owner-only · pin (or clear) a manual override on one
   * identity axis. Replaces PATCH /api/identity · delegates to
   * `setManualOverride`. The axis is a strict enum (the 8 valid axes)
   * and the value is bounded 0-100 or null — the typed-payload-mismatch
   * guard: a bad axis or out-of-range value is rejected at the
   * procedure boundary, exactly as the REST route's manual checks did.
   */
  pinIdentityAxis: operatorProcedure
    .input(
      z.object({
        axis: z.enum(IDENTITY_AXES),
        value: z.number().min(0).max(100).nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      return { snapshot: await setManualOverride(input.axis, input.value) };
    }),

  // ──────────────── Settings · skill library (UU.2) ────────────────

  /**
   * Phase UU.2 · owner-only · the SkillLibraryPanel data load · active
   * + pending behavioral skills. Replaces GET /api/skills · delegates
   * to the same `skill-extractor` module · drift impossible. Returns
   * `{ active, pending }` matching the legacy `data` envelope.
   */
  skills: operatorProcedure.query(async () => {
    const [active, pending] = await Promise.all([
      loadActiveSkills(),
      loadPendingSkills(),
    ]);
    return { active, pending };
  }),

  /**
   * Phase UU.2 · owner-only · the SkillLibraryPanel curation action ·
   * multiplexes 6 actions over one typed body (promote · drop ·
   * graduate · ungraduate · edit · extract_now). Replaces PATCH
   * /api/skills · the action branching mirrors the REST route
   * verbatim · delegates to the SAME `skill-extractor` functions.
   *
   * Input uses the SHARED `skillCurationSchema` from
   * @/lib/validators/settings — NOT a permissive z.record — so the
   * action enum can't drift. `key` is required for all actions except
   * `extract_now`; that conditional is enforced here (a thin
   * `extract_now` payload legitimately omits `key`). The route's
   * `ServiceError(…, 404)` "not found" cases map to NOT_FOUND so both
   * transports reject identically.
   */
  curateSkill: operatorProcedure
    .input(skillCurationSchema)
    .mutation(async ({ input }) => {
      try {
        if (input.action === "extract_now") {
          const result = await extractSkillsFromTasks();
          return { ok: true as const, result };
        }
        if (!input.key) {
          throw new ServiceError("key required", 400);
        }
        if (input.action === "promote") {
          const promoted = await promoteSkill(input.key, input.note);
          if (!promoted) throw new ServiceError("candidate not found", 404);
          return { ok: true as const, skill: promoted };
        }
        if (input.action === "drop") {
          const kind = input.kind ?? "skill_pending";
          const dropped = await dropSkill(input.key, kind);
          if (!dropped) throw new ServiceError("skill not found", 404);
          return { ok: true as const, dropped: true, kind };
        }
        if (input.action === "graduate" || input.action === "ungraduate") {
          const updated = await setGraduated(
            input.key,
            input.action === "graduate",
          );
          if (!updated) throw new ServiceError("active skill not found", 404);
          return { ok: true as const, skill: updated };
        }
        // action === "edit"
        const kind = input.kind ?? "skill_pending";
        const updated = await editSkill(input.key, kind, {
          trigger: input.trigger,
          action: input.actionText,
          reviewNote: input.note,
        });
        if (!updated) throw new ServiceError("skill not found", 404);
        return { ok: true as const, skill: updated };
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

  // ──────────────── Settings · AI config (UU.2) ────────────────

  /**
   * Phase UU.2 · owner-only · the live AI config the chat pipeline
   * reads. Replaces GET /api/settings/ai-config · delegates to
   * `getAiConfig` · returns the merged config at the top level (the
   * REST route returned the bare config too · no envelope change).
   */
  aiConfig: operatorProcedure.query(async () => getAiConfig()),

  /**
   * Phase UU.2 · owner-only · apply a partial update to the live AI
   * config. Replaces PATCH /api/settings/ai-config · delegates to
   * `updateAiConfig` (which merges over the current config). Input
   * uses the SHARED `aiConfigPatchSchema` — every field strictly
   * typed (NOT z.record) so a string temperature or a non-enum
   * reasoningEffort fails at the boundary. The settings panel fires a
   * one-field PATCH per slider/toggle · the schema's all-optional
   * shape is the genuine common case.
   */
  updateAiConfig: operatorProcedure
    .input(aiConfigPatchSchema)
    .mutation(async ({ input }) => updateAiConfig(input, "settings_ui")),

  /**
   * Phase UU.2 · owner-only · reset the AI config to defaults (the
   * "Reset to Nick's tuning" button). Replaces DELETE
   * /api/settings/ai-config · delegates to `resetAiConfig`.
   */
  resetAiConfig: operatorProcedure.mutation(async () =>
    resetAiConfig("settings_ui"),
  ),

  /**
   * Expose feature flags snapshot to operator UI dashboard.
   */
  featureFlags: operatorProcedure.query(async () => {
    return { flags: getAllFlags() };
  }),

  /**
   * Set a database-backed feature flag override.
   */
  setFeatureFlagOverride: operatorProcedure
    .input(
      z.object({
        key: z.string().min(1).max(80),
        value: z.enum(["true", "false"]).nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      const { key, value } = input;
      const prismaModule = await import("@/lib/prisma");
      const p = prismaModule.prisma;

      if (value === null) {
        await p.userPreference.deleteMany({
          where: { key, category: "feature_flags" },
        });
      } else {
        await p.userPreference.upsert({
          where: { key },
          create: { key, value, type: "string", category: "feature_flags" },
          update: { value },
        });
      }

      // Sync overrides cache and process.env immediately
      await loadFeatureFlagOverrides(true).catch(() => {});

      const resolved = getFlag(key);
      if (!resolved) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Flag ${key} is not registered in the registry.`,
        });
      }
      return { flag: resolved };
    }),

  // ──────────────── Settings · cold memory / Drive sync (UU.2) ────────────────

  /**
   * Phase UU.2 · owner-only · cold-memory stats (how much is indexed ·
   * last sync · embedding coverage). Replaces GET /api/drive/sync ·
   * delegates to `getColdMemoryStats` · drift impossible.
   */
  coldMemoryStats: operatorProcedure.query(async () => getColdMemoryStats()),

  /**
   * Phase UU.2 · owner-only · manual Google Drive ingest trigger ·
   * runs the same pipeline as the scheduled cron. Replaces POST
   * /api/drive/sync · delegates to the same `runDriveIngest` the REST
   * route + the `syncDriveMemory` chat tool call · drift impossible.
   *
   * `actor` labels the audit event; `limit` (1-100, default 25) caps
   * how many recent files are considered — the same bounds the REST
   * route enforced. Returns the full ingest stats envelope so the
   * panel's toast can show concrete numbers.
   */
  syncDrive: operatorProcedure
    .input(
      z
        .object({
          actor: z.string().max(60).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .mutation(async ({ input }) =>
      runDriveIngest({
        limit: Math.min(100, Math.max(1, input?.limit ?? 25)),
        actor: input?.actor || "user_sync",
        source: "drive_manual_sync",
      }),
    ),

  // ──────────────── Ultron · operator-domain HQ surfaces (B.6a) ────────────────

  /**
   * Phase B.6a (2026-05-22 · legacy-modernizer REST→tRPC ultron slice)
   * · owner-only · the ambient awareness feed for the Ultron top strip
   * (markets · macro · shop pulse · brain pulse · self metrics · ops).
   * Replaces GET /api/ultron/ticker · delegates to the
   * `ultron-ticker.buildTickerFeed` shared service the REST route also
   * calls · drift impossible. The service owns its own 60s `cached()`
   * window · React Query's 5-min refetchInterval mirrors the legacy
   * setInterval. No input · the feed is operator-scoped.
   */
  ticker: operatorProcedure.query(async () => buildTickerFeed()),

  /**
   * Phase B.6a · owner-only · the bottom personal-pulse ticker —
   * rotates PERSONAL state (capture · MIT · tomorrow note · narrator ·
   * commitments · reflection · wins · contradictions · mind · life ·
   * wisdom). Replaces GET /api/ultron/personal-pulse · delegates to
   * `personal-pulse.buildPersonalPulse` · drift impossible. Service
   * owns its own 90s `cached()` window. No input.
   */
  personalPulse: operatorProcedure.query(async () => buildPersonalPulse()),

  /**
   * Phase B.6a · owner-only · THE unified signal payload for the HQ
   * SituationCard (the meta-aggregated narrative that replaced the
   * 7-card stack). Replaces GET /api/ultron/situation · delegates to
   * `ultron-situation.buildSituation` · drift impossible. Service owns
   * its own 120s `cached()` window · React Query's 2-min
   * refetchInterval mirrors the legacy poll. No input.
   */
  situation: operatorProcedure.query(async () => buildSituation()),

  /**
   * Phase B.6a · owner-only · force a live recompute of the system
   * health digest (the SystemHealthCard "Refresh" button). Replaces
   * POST /api/ultron/health-digest · delegates to the shared
   * `health-digest.refreshHealthDigest` the REST POST also calls ·
   * drift impossible.
   *
   * Modeled as `.mutation()` · genuine state change (recompute +
   * fire-and-forget persist of a BrainMemory row). No input · the
   * recompute scans the whole system. The card refetches the GET-side
   * `useUltronFetch` after this resolves — that read endpoint stays on
   * REST (out of this sub-slice's scope).
   */
  refreshHealthDigest: operatorProcedure.mutation(async () =>
    refreshHealthDigest(),
  ),

  /**
   * Phase B.6a · owner-only · the v9.0 Command Spine unified state
   * (active command + today's proof ratio + risk counts). Replaces
   * GET /api/command-center/state · delegates to the same
   * `buildCommandCenterState` the REST route calls · drift impossible.
   * No input · React Query's 60s refetchInterval mirrors the legacy
   * setInterval.
   */
  commandCenterState: operatorProcedure.query(async () =>
    buildCommandCenterState(),
  ),

  /**
   * Phase B.6a · owner-only · read today's MIT (the binary daily-focus
   * anchor · BrainMemory category="daily_mit", key=YYYY-MM-DD).
   * Replaces GET /api/mit · delegates to the `mit.getMit` shared
   * service the REST route also calls · drift impossible. Returns
   * `{ key, text, updatedAt }` · `text` is null when not set today.
   */
  mit: operatorProcedure.query(async () => getMit()),

  /**
   * Phase B.6a · owner-only · set/update today's MIT. Empty/blank
   * `text` clears it (soft-delete · keeps history). Replaces POST
   * /api/mit · delegates to `mit.setMit` · drift impossible.
   *
   * Modeled as `.mutation()` · genuine state change (BrainMemory
   * upsert or soft-delete). `text` is bounded to 200 chars at the
   * boundary (the MITSlot input has maxLength=120 · the service
   * slices to 120 anyway · the 200 cap is the tRPC-boundary guard,
   * generous enough to never reject a legitimate payload).
   */
  setMit: operatorProcedure
    .input(z.object({ text: z.string().max(200) }))
    .mutation(async ({ input }) => setMit(input.text)),

  /**
   * Phase B.6a · owner-only · clear today's MIT (the MITSlot "Clear"
   * button sends an empty-text POST). A dedicated mutation rather than
   * `setMit("")` so the call-site reads intentionally; delegates to
   * the SAME `mit.setMit` with an empty string · the service's
   * empty-text branch soft-deletes · drift impossible.
   */
  clearMit: operatorProcedure.mutation(async () => setMit("")),

  /**
   * Phase B.6a · owner-only · compile a micro-plan from a free-text
   * intent (the omni-capture /plan path · 3-6 concrete steps).
   * Replaces POST /api/ultron/plan · delegates to the
   * `ultron-plan.buildMicroPlan` shared service the REST route also
   * calls · drift impossible.
   *
   * Modeled as a `.query()` despite the legacy POST · the route does
   * NO DB/state write (the doc explicitly says "No server-side
   * execution — the client decides what to do, keeping the API
   * pure") · only an LLM read. The component fires it imperatively
   * via `utils.operator.plan.fetch`.
   *
   * `intent` is bounded 1-2000 at the boundary · `buildMicroPlan`
   * itself enforces the 3-char floor and throws `IntentTooShortError`
   * → mapped to BAD_REQUEST so both transports reject identically.
   */
  plan: operatorProcedure
    .input(z.object({ intent: z.string().min(1).max(2000) }))
    .query(async ({ input }) => {
      try {
        return await buildMicroPlan(input.intent);
      } catch (err) {
        if (err instanceof IntentTooShortError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Phase B.6a · owner-only · the TodoDesk HQ surface payload — active
   * task + ranked queue + aging backlog + tomorrow preview + counts.
   * Replaces GET /api/ultron/todo-desk · delegates to the shared
   * `todo-desk.buildTodoDesk` the REST route also calls · drift
   * impossible. The service owns its own 60s `cached()` window · React
   * Query's 60s refetchInterval mirrors the legacy setInterval. No
   * input · the desk is operator-scoped.
   */
  todoDesk: operatorProcedure.query(async () => buildTodoDesk()),

  // ──────────────── Misc pages · /financial (2026-05-22) ────────────────

  /**
   * misc-pages slice (2026-05-22 · legacy-modernizer REST→tRPC) ·
   * owner-only · last 12 monthly financial snapshots + `latest` for
   * the /financial personal-finance card. Replaces GET /api/financial
   * · delegates to the shared `financial-snapshot.getFinancialSnapshots`
   * the REST route also calls · drift impossible.
   *
   * No input · the snapshot set is operator-scoped. The service
   * returns the explicit shallow `FinancialSnapshotView[]` shape (no
   * Json column · no Date object) so the procedure type stays shallow.
   * The page polls this every 60s · React Query's refetchInterval
   * mirrors the legacy setInterval.
   */
  financialSnapshot: operatorProcedure.query(async () =>
    getFinancialSnapshots(),
  ),

  /**
   * misc-pages slice (2026-05-22) · owner-only · revenue rollup for a
   * window (the /financial page sends "month"). Replaces GET
   * /api/analytics/revenue · delegates to the SAME
   * `business-intel.getRevenueStats` the REST route already called ·
   * drift impossible. `period` is a strict enum · the page's 120s
   * poll maps to React Query's refetchInterval.
   */
  revenueStats: operatorProcedure
    .input(
      z
        .object({
          period: z.enum(["day", "week", "month", "year"]).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => getRevenueStats(input?.period ?? "month")),

  /**
   * scattered-components slice (2026-05-22) · owner-only · the business
   * dashboard summary (month revenue · customer counts · review stats ·
   * jobs today · per-card bridge health). Replaces GET
   * /api/analytics/dashboard · delegates to the SAME
   * `business-intel.getDashboardSummary` the REST route also calls ·
   * drift impossible. The CommandPalette "Check Lead Pipeline" probe
   * reads this. Every field is a flat scalar / nested-scalar object ·
   * no Prisma Json reaches the AppRouter · no TS2589 firewall needed.
   */
  businessDashboard: operatorProcedure.query(async () =>
    getDashboardSummary(),
  ),

  // ──────────────── Misc pages · /social (2026-05-22) ────────────────

  /**
   * misc-pages slice (2026-05-22) · owner-only · Buffer connection
   * status + connected profiles for the /social schedule UI. Replaces
   * GET /api/social/schedule · delegates to the shared
   * `social-actions.getSocialSchedule` the REST route also calls ·
   * drift impossible. No input.
   */
  socialSchedule: operatorProcedure.query(async () => getSocialSchedule()),

  /**
   * misc-pages slice (2026-05-22) · owner-only · last 24 generated /
   * upscaled images for the /social publish picker. Replaces GET
   * /api/social/recent-images · delegates to
   * `social-actions.getRecentImages` · drift impossible. The service
   * projects AuditEvent rows to the flat `RecentImageRow` (TS2589
   * firewall). No input.
   */
  socialRecentImages: operatorProcedure.query(async () => getRecentImages()),

  /**
   * misc-pages slice (2026-05-22) · owner-only · direct publish to
   * Meta IG + FB. Replaces POST /api/social/publish · delegates to
   * `social-actions.publishSocialPost` the REST route also calls ·
   * drift impossible.
   *
   * IRREVERSIBLE · modeled as a `.mutation()`. The /social page only
   * fires this after an explicit `confirm()` dialog. `requestHost`
   * (for resolving a relative imageUrl to a public URL Meta accepts)
   * comes from `ctx.headers` — the REST route used the request `host`
   * header; same source. The service's `SocialPublishInputError` /
   * `SocialImageUrlUnresolvedError` map to BAD_REQUEST /
   * INTERNAL_SERVER_ERROR so both transports reject identically.
   *
   * `platforms` is a strict enum array · `caption` / `message` are
   * bounded · the typed-payload-mismatch guard.
   */
  socialPublish: operatorProcedure
    .input(
      z.object({
        platforms: z.array(z.enum(["instagram", "facebook"])).min(1).max(2),
        imageUrl: z.string().max(2000).optional(),
        videoUrl: z.string().max(2000).optional(),
        caption: z.string().max(4000).optional(),
        message: z.string().max(4000).optional(),
        linkUrl: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await publishSocialPost(
          input,
          ctx.headers?.get("host") ?? undefined,
        );
      } catch (err) {
        if (err instanceof SocialPublishInputError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        if (err instanceof SocialImageUrlUnresolvedError) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * misc-pages slice (2026-05-22) · owner-only · schedule a post via
   * Buffer (reversible · Buffer holds the queue). Replaces POST
   * /api/social/schedule · delegates to
   * `social-actions.scheduleSocialPost` · drift impossible.
   *
   * Modeled as a `.mutation()` · genuine state change (Buffer queue +
   * AuditEvent). `requestHost` from `ctx.headers` mirrors the REST
   * route. `text` is bounded + required · the empty-text
   * `SocialScheduleInputError` maps to BAD_REQUEST.
   */
  scheduleSocialPost: operatorProcedure
    .input(
      z.object({
        text: z.string().min(1).max(4000),
        imageUrl: z.string().max(2000).optional(),
        linkUrl: z.string().max(2000).optional(),
        profileIds: z.array(z.string().min(1).max(64)).max(20).optional(),
        scheduledAt: z.string().max(64).optional(),
        shareNow: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await scheduleSocialPostService(
          input,
          ctx.headers?.get("host") ?? undefined,
        );
      } catch (err) {
        if (err instanceof SocialScheduleInputError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  // ──────────────── Misc pages · /content (2026-05-22) ────────────────

  /**
   * misc-pages slice (2026-05-22) · owner-only · search past content
   * scored by the 7-axis output critic, with aggregate stats.
   * Replaces GET /api/content/history · delegates to
   * `content-history.getContentHistory` the REST route also calls ·
   * drift impossible. The service projects the brain_memory `metadata`
   * Json column to the flat `QualityMetadata` (TS2589 firewall).
   *
   * All numeric inputs are strictly bounded · the page sends
   * `{ q, minScore, maxScore, days, contentMode }`.
   */
  contentHistory: operatorProcedure
    .input(
      z
        .object({
          q: z.string().max(200).optional(),
          minScore: z.number().int().min(0).max(100).optional(),
          maxScore: z.number().int().min(0).max(100).optional(),
          shape: z.string().max(40).optional(),
          intent: z.string().max(40).optional(),
          contentModeOnly: z.boolean().optional(),
          days: z.number().int().min(1).max(365).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => getContentHistory(input ?? {})),

  /**
   * misc-pages slice (2026-05-22) · owner-only · approve or reject a
   * single content draft (the /content/drafts approval queue). Replaces
   * POST /api/content/drafts/[key] · delegates to the SAME
   * `content/drafts.approveDraft` / `rejectDraft` the REST route also
   * calls · drift impossible.
   *
   * Modeled as a `.mutation()` · genuine state change (a metadata
   * status write / soft-delete). `action` is a strict enum. An
   * approve that doesn't resolve a draft maps to NOT_FOUND — the same
   * 404 the REST route returned.
   */
  actOnDraft: operatorProcedure
    .input(
      z.object({
        key: z.string().min(1).max(120),
        action: z.enum(["approve", "reject"]),
        reason: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.action === "approve") {
        const draft = await approveDraft(input.key);
        if (!draft) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "draft_not_found",
          });
        }
        return { ok: true as const, draft };
      }
      await rejectDraft(input.key, input.reason);
      return { ok: true as const, rejected: true as const };
    }),

  // ──────────────── Misc pages · /decisions/[id] (2026-05-22) ────────────────

  /**
   * misc-pages slice (2026-05-22) · owner-only · the single-decision
   * detail payload (decision + same-domain sibling lineage + matching
   * anti-patterns + computed timeline). Replaces GET /api/decisions/[id]
   * · delegates to `decision-detail.getDecisionDetail` the REST route
   * also calls · drift impossible. The service returns the explicit
   * shallow `DecisionDetailView` (Dates → ISO string · anti-pattern
   * `metadata` → `unknown` · the TS2589 firewall).
   *
   * `id` is a positive int · the service's `ServiceError(…, 400/404)`
   * for a bad / missing id maps to BAD_REQUEST / NOT_FOUND.
   */
  decisionDetail: operatorProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      try {
        return await getDecisionDetail(input.id);
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

  /**
   * actions-surface REST→tRPC slice (2026-05-22) · owner-only · the
   * decision-log list — the 50 most-recent decisions + the pending-
   * review subset. Replaces GET /api/decisions · delegates to the
   * shared `decisions.listDecisions` service the REST route also calls
   * · drift impossible. No input · the feed is operator-scoped.
   *
   * KommandoLearn reads `decisions[].title` + `.context` off this for
   * its "learn before you decide" topic seeds. Returns `{ decisions,
   * pending_review }` (explicit shallow `DecisionRow[]` · every Date
   * stringified · the TS2589 firewall). The legacy route's `?status` /
   * `?limit` query params were never read by the GET handler — the
   * list was always the same 50 + pending subset — so no input is
   * needed for parity.
   */
  decisions: operatorProcedure.query(async () => listDecisions()),

  /**
   * scattered-components slice (2026-05-22) · owner-only · log a new
   * decision to the decision journal. Replaces the POST-create branch
   * of /api/decisions · delegates to `decisions.createDecision` the
   * REST route also calls · drift impossible. OmniCapture's `/decide`
   * branch fires this · the route's `title required` guard is hoisted
   * to the typed `.input()` (`.min(1)`) — the typed-payload-mismatch
   * guard. Returns `{ ok, id }` mirroring the legacy envelope.
   */
  logDecision: operatorProcedure
    .input(
      z.object({
        title: z.string().min(1).max(500),
        domain: z.string().max(80).optional(),
        stakes: z.string().max(40).optional(),
        context: z.string().max(8000).optional(),
        optionsConsidered: z.array(z.string().max(500)).max(20).optional(),
        chosen: z.string().max(500).optional(),
        reasoning: z.string().max(8000).optional(),
        predictedOutcome: z.string().max(2000).optional(),
        emotionalState: z.string().max(200).optional(),
        reviewDate: z.string().max(40).optional(),
      }),
    )
    .mutation(async ({ input }) => createDecision(input)),

  /**
   * misc-pages slice (2026-05-22) · owner-only · grade / edit a single
   * decision (the /decisions/[id] edit form). Replaces POST
   * /api/decisions/[id] · delegates to `decision-detail.gradeDecision`
   * the REST route also calls · drift impossible.
   *
   * Modeled as a `.mutation()` · genuine state change (a partial
   * update + an entity-audit diff). Every field is optional — the
   * form submits whichever of outcome / grade / reviewDate changed.
   */
  gradeDecision: operatorProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        actualOutcome: z.string().max(8000).optional(),
        grade: z.string().max(40).optional(),
        reviewDate: z.string().max(40).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await gradeDecisionService(input.id, {
          actualOutcome: input.actualOutcome,
          grade: input.grade,
          reviewDate: input.reviewDate,
        });
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

  // ──────────────── Misc pages · /photo-improver (2026-05-22) ────────────────

  /**
   * misc-pages slice (2026-05-22) · owner-only · the storefront photo
   * improver — vision-model scorecard + improvements + a Nick's-Tire
   * branded re-render. Replaces POST /api/images/improve · delegates
   * to `photo-improver.improvePhoto` the REST route also calls · drift
   * impossible.
   *
   * Modeled as a `.mutation()` · genuine work (LLM vision call +
   * optional image generation + fire-and-forget `trackGeneration`
   * telemetry). `imageBase64` is a large bound (a data-URL payload);
   * `mode` is a strict enum. The `MissingImageError` (neither base64
   * nor url) maps to BAD_REQUEST · the same 400 the REST route
   * returned.
   */
  improvePhoto: operatorProcedure
    .input(
      z.object({
        imageBase64: z.string().max(15_000_000).optional(),
        imageUrl: z.string().max(2000).optional(),
        mode: z.enum(["analyze", "rebrand", "both"]).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await improvePhoto(input);
      } catch (err) {
        if (err instanceof MissingImageError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  /**
   * straggler-pages slice · owner-only · fan out to every knowledge-
   * pull cron + hot-flush the prompt cache. Replaces POST
   * /api/admin/knowledge-refresh · delegates to the shared
   * `knowledge-refresh.runKnowledgeRefresh` the legacy route also
   * calls · drift impossible. The fan-out targets the project's own
   * /api/cron/* routes, so the service needs the caller's request
   * headers (host + forwarded-proto) to build the absolute base URL —
   * `ctx.headers` is populated by createTRPCContext (the App Router
   * fetch handler). `KnowledgeRefreshError` carries the no-targets /
   * env-missing cases the legacy route surfaced as 400/500 — mapped
   * to BAD_REQUEST / INTERNAL_SERVER_ERROR. The `only` filter mirrors
   * the route's `RefreshBody.only`. The /knowledge page's "refresh
   * now" button fires this. All-scalar result · no TS2589 firewall.
   */
  knowledgeRefresh: operatorProcedure
    .input(
      z
        .object({ only: z.array(z.string().max(40)).max(20).optional() })
        .optional(),
    )
    .mutation(async ({ ctx, input }): Promise<KnowledgeRefreshResult> => {
      try {
        return await runKnowledgeRefresh({
          headers: ctx.headers ?? new Headers(),
          only: input?.only,
        });
      } catch (err) {
        if (err instanceof KnowledgeRefreshError) {
          throw new TRPCError({
            code:
              err.status === 400
                ? "BAD_REQUEST"
                : "INTERNAL_SERVER_ERROR",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * straggler-pages slice · owner-only · today's morning-brief
   * metadata + text + sentence-bounded preview. Replaces GET
   * /api/morning-brief · delegates to the shared
   * `morning-brief-read.readMorningBrief` the legacy route also calls
   * · drift impossible. The result is the explicit flat
   * `MorningBriefView` (the BrainMemory row's `updatedAt` Date is
   * stringified inside the service) — no Prisma Json reaches the
   * wire. The /voice page's BriefSection polls this. The rendered
   * audio (/api/morning-brief/today.mp3) stays REST — tRPC can't
   * carry a binary mp3 body.
   */
  morningBrief: operatorProcedure.query(
    async (): Promise<MorningBriefView> => readMorningBrief(),
  ),

  /**
   * hooks-lib REST→tRPC slice (2026-05-22) · owner-only · log a new
   * commitment. The `/commit` chat direct-action (`lib/chat/direct-
   * actions.ts`) fires this. Replaces the create branch of POST
   * /api/commitments · delegates to the shared `commitments.create
   * Commitment` the legacy route also calls · drift impossible. The
   * route's `if (!description)` guard is hoisted to the typed
   * `.input()` (`.min(1)`) — the typed-payload-mismatch guard. Returns
   * `{ ok, id }` mirroring the legacy envelope.
   *
   * `direct-actions.ts` is a non-React module · it calls this via the
   * vanilla tRPC client (`trpcVanilla.operator.createCommitment
   * .mutate()`).
   */
  createCommitment: operatorProcedure
    .input(
      z.object({
        description: z.string().min(1).max(2000),
        toWhom: z.string().max(120).nullable().optional(),
        deadline: z.string().max(40).nullable().optional(),
        domain: z.string().max(80).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) =>
      createCommitment({
        description: input.description,
        toWhom: input.toWhom,
        deadline: input.deadline,
        domain: input.domain,
      }),
    ),
});
