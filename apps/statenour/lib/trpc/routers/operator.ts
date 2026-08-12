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
import { prisma } from "@/lib/prisma";
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
import {
  approveDraft,
  DraftStateError,
  rejectDraft,
  createDraft,
  listDrafts,
  markScheduled,
  getDraftCounts,
} from "@/lib/content/drafts";
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
import {
  createCommitment,
  listProposed,
  acceptCommitment,
  dismissProposed,
  completeActiveCommitment,
  abandonActiveCommitment,
} from "@/lib/services/commitments";
import { TRPCError } from "@trpc/server";
import { logError } from "@/lib/utils/error-log";
import { getTodaysAnticipated } from "@/lib/brain/anticipated-questions";

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

      // Wave-8 (2026-07-29) · autonomy governance: every flag flip gets
      // an audit row (who/when/old→new) BEFORE the write — the Unleash
      // "non-negotiable" and the precondition for the one-flag-per-week
      // ritual. Best-effort: an audit failure never blocks the flip,
      // but it is logged loudly.
      const prior = await p.userPreference
        .findFirst({ where: { key, category: "feature_flags" }, select: { value: true } })
        .catch(() => null);
      await p.auditEvent
        .create({
          data: {
            actor: "operator",
            eventType: "feature_flag_override",
            detail: `${key}: ${prior?.value ?? "(env default)"} → ${value ?? "(cleared to env default)"}`,
            payload: { key, oldValue: prior?.value ?? null, newValue: value },
          },
        })
        .catch((e: unknown) =>
          logError("operator.feature-flags", e, { stage: "flip-audit", key }, "warn"),
        );

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

      // Spine-1: persistence and activation are DIFFERENT facts. The DB
      // write above succeeded; the cache reload can still fail, leaving
      // the running process on the OLD value while the response implied
      // the change was live. Report both truthfully.
      let runtimeApplied = true;
      let runtimeReason: string | null = null;
      try {
        await loadFeatureFlagOverrides(true);
      } catch (e) {
        runtimeApplied = false;
        runtimeReason = e instanceof Error ? e.message.slice(0, 200) : String(e);
        logError("operator.feature-flags", e, { stage: "override-cache-reload", key }, "warn");
      }

      const resolved = getFlag(key);
      if (!resolved) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Flag ${key} is not registered in the registry.`,
        });
      }
      return {
        flag: resolved,
        persisted: true,
        runtimeApplied,
        ...(runtimeReason
          ? { runtimeReason: `cache reload failed — the returned value may reflect the PREVIOUS process state: ${runtimeReason}` }
          : {}),
      };
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
   * 2026-08-12 · owner-only · resolve an ACTIVE commitment directly from
   * the pulse ticker — "done" (completeActiveCommitment) or "drop"
   * (abandonActiveCommitment). The prior state was chat-only: the
   * operator had no way to close an overdue promise except conversation
   * happening to trigger the completeCommitment tool, or the 90-day
   * auto-expiry floor. Invalidates the personalPulse cache so the item
   * disappears on the client's next refetch instead of surviving up to
   * the remaining 90s server-cache window.
   */
  resolveCommitment: operatorProcedure
    .input(
      z.object({
        commitmentId: z.number().int().positive(),
        action: z.enum(["done", "drop"]),
      }),
    )
    .mutation(async ({ input }) => {
      const resolved =
        input.action === "done"
          ? await completeActiveCommitment(input.commitmentId)
          : await abandonActiveCommitment(input.commitmentId);
      if (resolved) {
        const { invalidate } = await import("@/lib/utils/cache");
        invalidate("ultron_personal_pulse_v3");
      }
      return { resolved };
    }),

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
        videoUrl: z.string().max(2000).optional(),
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
        // The sanitizing errorFormatter would flatten DraftStateError into a
        // generic message, so map it here — the operator needs to know a
        // worker owns the row, not just that "something failed".
        let draft;
        try {
          draft = await approveDraft(input.key);
        } catch (err) {
          if (err instanceof DraftStateError) {
            throw new TRPCError({ code: "CONFLICT", message: err.message });
          }
          throw err;
        }
        if (!draft) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "draft_not_found",
          });
        }
        return { ok: true as const, draft };
      }
      try {
        await rejectDraft(input.key, input.reason);
      } catch (err) {
        if (err instanceof DraftStateError) {
          throw new TRPCError({ code: "CONFLICT", message: err.message });
        }
        throw err;
      }
      return { ok: true as const, rejected: true as const };
    }),

  generateMarketingContent: operatorProcedure
    .input(
      z.object({
        personaKey: z.string().min(1),
        prompt: z.string().min(1),
        // 2026-07-12 · target platforms for the generated draft. Was
        // omitted → createDraft defaulted platforms to [] → EVERY draft
        // this endpoint produced was un-publishable (approve→publish
        // requires ≥1 platform), so the content flywheel never turned.
        platforms: z.array(z.enum(["instagram", "facebook"])).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { getMarketingPersonas } = await import("@/lib/ai/agents/marketing/loader");
      const { personaToSystemPrompt } = await import("@/lib/ai/personas");
      const { makeTracedAiChat } = await import("@/lib/ai/traced-aichat");

      const personas = getMarketingPersonas();
      const persona = personas[input.personaKey];
      if (!persona) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Unknown marketing persona key: ${input.personaKey}`,
        });
      }

      // AG-33 · route through the ghostwriter service (which owns the
      // voice packs + the critic-gated single revision pass that AG-15
      // introduced inline here).
      const { ghostwrite } = await import("@/lib/ai/ghostwriter");
      const ghost = await ghostwrite({
        brief: input.prompt,
        channel: "social",
        personaKey: input.personaKey,
      });

      // 2026-07-12 · guard: if the model asked the operator for missing
      // input instead of producing a post ("Please share the URL…"), do
      // NOT persist it as a publishable draft — that landed a clarifying
      // question in the SocialPublishQueue as a pending post (one such row
      // sat in prod 2026-07-05 → -12). Surface it back to the operator.
      if (ghost.needsClarification) {
        return {
          content: ghost.text,
          provider: ghost.provider,
          needsClarification: true as const,
          draftId: undefined,
          draftKey: undefined,
        };
      }

      const { createDraft } = await import("@/lib/content/drafts");
      const draft = await createDraft({
        content: ghost.text,
        // Default to Instagram so the draft is publishable; the caller can
        // override. A draft with no platforms can never be approved+published.
        suggestedPlatforms: input.platforms ?? ["instagram"],
        source: `assistant-${input.personaKey}`,
        kind: "post",
        sourceMetadata:
          ghost.score !== null
            ? { criticScore: ghost.score, regenApplied: ghost.regenApplied }
            : null,
      });

      return {
        content: ghost.text,
        provider: ghost.provider,
        needsClarification: false as const,
        draftId: draft.id,
        draftKey: draft.key,
      };
    }),

  // AG-33 · one-tap revision: rerun the ghostwriter revision loop on an
  // existing draft. Approval was binary approve/reject with no revise
  // path — a weak draft could only be discarded.
  reviseDraft: operatorProcedure
    .input(
      z.object({
        draftKey: z.string().min(1),
        instruction: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { listDrafts, updateDraftContent } = await import("@/lib/content/drafts");
      const drafts = await listDrafts({ status: "all", limit: 200 });
      const draft = drafts.find((d) => d.key === input.draftKey);
      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Unknown draft: ${input.draftKey}` });
      }

      const { ghostwrite } = await import("@/lib/ai/ghostwriter");
      const brief = input.instruction
        ? `Revise this draft per the instruction.\n\nINSTRUCTION: ${input.instruction}\n\nDRAFT:\n${draft.content}`
        : `Revise this draft — tighter, more specific, same substance.\n\nDRAFT:\n${draft.content}`;
      const ghost = await ghostwrite({ brief, channel: "social" });

      // 2026-07-12 · if the revision came back as a request for input
      // rather than revised copy, leave the existing draft untouched —
      // overwriting it with a clarifying question would destroy the
      // operator's draft. Surface the question instead.
      if (ghost.needsClarification) {
        return {
          content: ghost.text,
          score: ghost.score,
          draftKey: input.draftKey,
          needsClarification: true as const,
        };
      }

      const updated = await updateDraftContent(input.draftKey, ghost.text, {
        criticScore: ghost.score,
        regenApplied: true,
        revisedAt: new Date().toISOString(),
      });
      return {
        content: ghost.text,
        score: ghost.score,
        draftKey: updated?.key ?? input.draftKey,
        needsClarification: false as const,
      };
    }),

  getMarketingPersonas: operatorProcedure
    .query(async () => {
      const { getMarketingPersonas } = await import("@/lib/ai/agents/marketing/loader");
      const personas = getMarketingPersonas();
      
      return Object.entries(personas).map(([key, p]) => ({
        key,
        name: p.role || key,
        description: p.goal || "",
        emoji: (p as any).emoji || "🤖",
        color: (p as any).color || "#a1a1aa",
      }));
    }),

  listPublishQueue: operatorProcedure
    .input(
      z.object({
        status: z.enum(["pending", "approved", "rejected", "scheduled", "published", "all"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const status = input?.status ?? "pending";
      const limit = input?.limit ?? 50;
      return listDrafts({ status, limit });
    }),

  addToPublishQueue: operatorProcedure
    .input(
      z.object({
        content: z.string().min(1).max(4000),
        imageUrl: z.string().max(2000).nullish(),
        platforms: z.array(z.string().max(32)).max(10).optional(),
        kind: z.enum(["post", "thread", "story", "reel"]).optional(),
        source: z.string().max(80).optional(),
        missionId: z.string().max(80).nullish(),
        sourceMetadata: z.record(z.string(), z.any()).nullish(),
      })
    )
    .mutation(async ({ input }) => {
      return createDraft({
        content: input.content,
        imageUrl: input.imageUrl,
        suggestedPlatforms: input.platforms,
        kind: input.kind,
        source: input.source,
        missionId: input.missionId,
        sourceMetadata: input.sourceMetadata,
      });
    }),

  updatePublishQueueItem: operatorProcedure
    .input(
      z.object({
        id: z.string().min(1).max(80),
        content: z.string().max(4000).optional(),
        platforms: z.array(z.string().max(32)).max(10).optional(),
        scheduledFor: z.string().max(64).nullish(),
        // "published" is deliberately NOT accepted: it is the durable worker's
        // verdict. Setting it by hand stamps a result nobody observed, leaves
        // publishedAt null, and permanently locks the row out of approveDraft.
        status: z.enum(["pending", "approved", "rejected", "scheduled"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const updateData: any = {};
      if (data.content !== undefined) updateData.content = data.content;
      if (data.platforms !== undefined) updateData.platforms = data.platforms;
      if (data.scheduledFor !== undefined) {
        updateData.scheduledFor = data.scheduledFor ? new Date(data.scheduledFor) : null;
      }
      if (data.status !== undefined) updateData.status = data.status;

      // A bare update here could re-state a row the publish worker is holding
      // in "rendering": that trips its finalize lock (a live post records no
      // publishedAt/publishUrls) AND returns the row to the claim set, where
      // the next dispatch posts it again. Compare-and-set instead, matching
      // approveDraft/markScheduled/rejectDraft.
      const claimed = await prisma.socialPublishQueue.updateMany({
        where: { id, deletedAt: null, status: { notIn: ["rendering", "published"] } },
        data: updateData,
      });
      if (claimed.count !== 1) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Cannot edit a queue item that is rendering, published, or deleted — a worker owns it.",
        });
      }

      return prisma.socialPublishQueue.findUnique({ where: { id } });
    }),

  actOnPublishQueueItem: operatorProcedure
    .input(
      z.object({
        id: z.string().min(1).max(80),
        action: z.enum(["approve", "reject", "schedule", "publish", "delete"]),
        reason: z.string().max(2000).optional(),
        scheduledFor: z.string().max(64).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { id, action, reason, scheduledFor } = input;
      
      if (action === "approve") {
        let draft;
        try {
          draft = await approveDraft(id);
        } catch (err) {
          if (err instanceof DraftStateError) {
            throw new TRPCError({ code: "CONFLICT", message: err.message });
          }
          throw err;
        }
        if (!draft) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "draft_not_found",
          });
        }
        return { ok: true as const, draft };
      }

      if (action === "reject") {
        // rejectDraft throws DraftStateError now; without this catch the
        // sanitizing errorFormatter flattens it into a generic 500 + errorId —
        // the exact failure mode already fixed for PublishDispatchError.
        try {
          await rejectDraft(id, reason);
        } catch (err) {
          if (err instanceof DraftStateError) {
            throw new TRPCError({ code: "CONFLICT", message: err.message });
          }
          throw err;
        }
        return { ok: true as const, rejected: true as const };
      }

      if (action === "schedule") {
        if (!scheduledFor) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "scheduledFor is required for scheduling",
          });
        }
        try {
          await markScheduled(id, scheduledFor);
        } catch (err) {
          if (err instanceof DraftStateError) {
            throw new TRPCError({ code: "CONFLICT", message: err.message });
          }
          throw err;
        }
        return { ok: true as const, scheduled: true as const };
      }
      
      if (action === "publish") {
        // Shares ONE dispatcher with POST /api/sync/queue. Both surfaces used
        // to carry byte-identical copies of this block, and both stamped
        // status:"published" before dispatching — which moved the row out of
        // the worker's claim set, so it could never be picked up. Writing the
        // status is the worker's job; this only hands the row over.
        const { dispatchQueuedPublish, PublishDispatchError } = await import(
          "@/lib/services/social-actions"
        );
        const hostHeader = ctx.headers?.get("host") || undefined;
        try {
          const item = await dispatchQueuedPublish(id, hostHeader);
          return { ok: true as const, dispatched: true as const, item };
        } catch (err) {
          if (err instanceof PublishDispatchError) {
            // Mirror the REST refusal map (sync/queue/route.ts) rather than
            // collapsing every non-404 to BAD_REQUEST — a state conflict and a
            // malformed row are different answers to the operator.
            const code = {
              not_found: "NOT_FOUND",
              unclaimable: "CONFLICT",
              not_ready: "CONFLICT",
              no_platforms: "BAD_REQUEST",
              invalid_input: "BAD_REQUEST",
            }[err.reason] as "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST";
            throw new TRPCError({ code, message: err.message });
          }
          throw err;
        }
      }
      
      if (action === "delete") {
        // Guarded like reject — soft-deleting a row the worker holds hides a
        // post that may already be live (finalize does not filter deletedAt).
        const removed = await prisma.socialPublishQueue.updateMany({
          where: { id, deletedAt: null, status: { notIn: ["rendering", "published"] } },
          data: { deletedAt: new Date() },
        });
        if (removed.count !== 1) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Cannot delete a queue item that is rendering, published, or already deleted — a worker owns it.",
          });
        }
        return { ok: true as const, deleted: true as const };
      }
      
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid action",
      });
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

  /**
   * Return daily anticipated questions and pending follow-up items.
   */
  // ── Spine-4 · durable follow-up agenda (replaces localStorage) ──
  // Follow-ups are generated strings; the ledger rows live in the
  // EXISTING agenda_items table (category FOLLOW_UP, source "follow_up",
  // sourceId = sha256(title) hex16). Dismissals/conversions are server
  // receipts that survive devices and storage clears.
  agendaSyncFollowUps: operatorProcedure
    .input(z.object({ titles: z.array(z.string().min(1).max(500)).max(50) }))
    .mutation(async ({ input }) => {
      const { createHash } = await import("node:crypto");
      const prismaModule = await import("@/lib/prisma");
      const p = prismaModule.prisma;
      let created = 0;
      for (const title of input.titles) {
        const fp = createHash("sha256").update(title.replace(/\s+/g, " ").trim().toLowerCase()).digest("hex").slice(0, 16);
        const existing = await p.agendaItem.findFirst({
          where: { source: "follow_up", sourceId: fp },
          select: { id: true },
        });
        if (existing) continue;
        await p.agendaItem.create({
          data: {
            title: title.slice(0, 500),
            category: "FOLLOW_UP",
            status: "ACTIVE",
            source: "follow_up",
            sourceId: fp,
          },
        });
        created++;
      }
      return { created };
    }),

  agendaActiveFollowUps: operatorProcedure.query(async () => {
    const prismaModule = await import("@/lib/prisma");
    const rows = await prismaModule.prisma.agendaItem.findMany({
      where: { category: "FOLLOW_UP", status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { id: true, title: true, createdAt: true },
    });
    return { items: rows };
  }),

  agendaDismissFollowUp: operatorProcedure
    .input(z.object({ id: z.string(), reason: z.string().max(300).optional() }))
    .mutation(async ({ input, ctx }) => {
      const prismaModule = await import("@/lib/prisma");
      const res = await prismaModule.prisma.agendaItem.updateMany({
        where: { id: input.id, status: "ACTIVE" },
        data: {
          status: "ARCHIVED",
          metadata: {
            dismissedAt: new Date().toISOString(),
            dismissedBy: ctx.session.email ?? "operator",
            ...(input.reason ? { dismissalReason: input.reason } : {}),
          },
        },
      });
      return { ok: res.count === 1 };
    }),

  agendaConvertFollowUp: operatorProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const prismaModule = await import("@/lib/prisma");
      const p = prismaModule.prisma;
      const item = await p.agendaItem.findUnique({ where: { id: input.id } });
      if (!item || item.status !== "ACTIVE")

        return { ok: false as const, error: "not found or not active" };
      // Reuse the canonical task-creation service (fills the required
      // scoring/effort defaults the raw model demands) — same path the
      // task router's create procedure delegates to.
      const { createTaskFromAPI } = await import("@/lib/services/task-actions");
      const task = (await createTaskFromAPI({
        title: item.title.slice(0, 300),
        status: "INBOX",
      })) as { id: string };
      await p.agendaItem.update({
        where: { id: item.id },
        data: {
          status: "RESOLVED",
          metadata: {
            convertedAt: new Date().toISOString(),
            convertedBy: ctx.session.email ?? "operator",
            taskId: task.id,
          },
        },
      });
      return { ok: true as const, taskId: task.id };
    }),

  /**
   * WP-13/16 · 2026-07-28 · proposed-commitment lifecycle. Machine
   * proposers (journal nextAction is the first) create status="proposed"
   * rows; these three procedures are the operator's verdict surface on
   * Home. Accept → active (on the books); dismiss → abandoned
   * (remembered — the proposer's sourceRef idempotency spans all
   * statuses, so a dismissal never re-proposes).
   */
  commitmentsProposed: operatorProcedure.query(async () => {
    const items = await listProposed(10);
    return { items };
  }),

  commitmentAccept: operatorProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const ok = await acceptCommitment(input.id);
      return { ok };
    }),

  commitmentDismiss: operatorProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const ok = await dismissProposed(input.id);
      return { ok };
    }),

  nickRemembersContext: operatorProcedure.query(async () => {
    const [anticipated, recentDigests] = await Promise.all([
      getTodaysAnticipated().catch(() => null),
      prisma.auditEvent.findMany({
        where: { eventType: "conversation_digest" },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { payload: true },
      }).catch((): any[] => []),
    ]);

    const followUps: string[] = [];
    for (const row of recentDigests) {
      if (row.payload && typeof row.payload === "object") {
        const payload = row.payload as Record<string, any>;
        if (typeof payload.followUpNeeded === "string" && payload.followUpNeeded.trim().length > 0) {
          followUps.push(payload.followUpNeeded.trim());
        }
      }
    }

    return {
      anticipatedQuestions: anticipated ? anticipated.questions.map((q) => q.question) : [],
      followUps,
    };
  }),
});
