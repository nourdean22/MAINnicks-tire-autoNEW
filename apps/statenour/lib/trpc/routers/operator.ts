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
  aiConfigPatchSchema,
  skillCurationSchema,
} from "@/lib/validators/settings";
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
    .input(z.object({ history: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      const [snapshot, history] = await Promise.all([
        loadIdentitySnapshot(),
        input?.history ? loadIdentityHistory(30) : Promise.resolve(null),
      ]);
      return { snapshot, history };
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
});
