/**
 * lib/trpc/routers/journal.ts · Phase TT (2026-05-19 AM) ·
 * extended Phase TT.2 (2026-05-22 · legacy-modernizer REST→tRPC
 * journal slice).
 *
 * Journal-domain procedures · the 7th domain router (nick · operator ·
 * system · chat · browser · task · journal). Wraps every endpoint the
 * /journal page + its 5 sub-components touch:
 *
 *   feed · metacognition          → the page's two loads (Phase TT)
 *   threads · createThread        → ThreadRail
 *   convergence · runConvergenceScan · dismissCandidate → ThreadRadar
 *   suggestions · acceptSuggestion · dismissSuggestion  → ThreadSuggestions
 *   reflect                       → ReflectComposer
 *   calibrationSamples · calibrate → MemoryCalibration
 *
 * Delegates to shared services so the legacy REST routes and these
 * procedures call the SAME functions · drift structurally impossible:
 *   · buildJournalFeed              → @/lib/services/journal-feed
 *   · getLatestLearningJournalEntry → @/lib/brain/learning-journal
 *   · journal-threads.ts            → listThreads · createEmptyThread ·
 *       confirmCandidate · listConvergenceCandidates · dismissCandidate ·
 *       listThreadSuggestions · acceptThreadSuggestion ·
 *       dismissThreadSuggestion
 *   · journal-convergence.runConvergenceScan
 *   · journal-reflect.createReflection   (extracted in TT.2)
 *   · journal-calibrate.{getCalibrationSamples,applyCalibration} (TT.2)
 *
 * The thread / convergence / suggestion inputs are bare scalars
 * (key · hash · name) declared inline. The reflect / calibrate inputs
 * have real structure → the schemas live in @/lib/validators/journal
 * and are SHARED with the REST routes (the schema is the contract).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, operatorProcedure } from "../trpc";
import { buildJournalFeed } from "@/lib/services/journal-feed";
import { getLatestLearningJournalEntry } from "@/lib/brain/learning-journal";
import {
  acceptThreadSuggestion,
  confirmCandidate,
  createEmptyThread,
  dismissCandidate,
  dismissThreadSuggestion,
  listConvergenceCandidates,
  listThreadSuggestions,
  listThreads,
} from "@/lib/services/journal-threads";
import { runConvergenceScan } from "@/lib/services/journal-convergence";
import { createReflection, ReflectFieldError } from "@/lib/services/journal-reflect";
import {
  applyCalibration,
  getCalibrationSamples,
} from "@/lib/services/journal-calibrate";
import { ServiceError } from "@/lib/utils/service-error";
import {
  calibrationRulingSchema,
  reflectSubmitSchema,
} from "@/lib/validators/journal";

export const journalRouter = router({
  /**
   * Phase TT · owner-only · unified journal feed merging the 4
   * thought-capture tables (BrainDump · Reflection · SituationLog ·
   * DecisionReplay) into a single chronologically-sorted stream
   * with rollup counts by source and entryType.
   *
   * The page polls this on filter switch (source · type · limit ·
   * days change) · React Query keys on the input so each filter
   * combination has its own cache slot.
   */
  feed: operatorProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(100),
          days: z.number().int().min(1).max(365).default(60),
          type: z.string().max(40).nullable().optional(),
          source: z.string().max(40).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      buildJournalFeed({
        limit: input?.limit,
        days: input?.days,
        type: input?.type,
        source: input?.source,
      }),
    ),

  /**
   * Phase TT · owner-only · most-recent learning-journal entry ·
   * Nick's nightly self-assessment of his own brain. Powers the
   * small metacognition card at the top of /journal. Returns
   * `null` when no cron run has landed yet · page renders nothing
   * in that case.
   */
  metacognition: operatorProcedure.query(async () => {
    return getLatestLearningJournalEntry();
  }),

  // ──────────────────────── Threads (ThreadRail) ────────────────────────

  /**
   * Phase TT.2 · owner-only · active (and optionally dormant) journal
   * threads with a 3-excerpt preview. Replaces GET /api/journal/threads.
   * Delegates to `journal-threads.listThreads` · the same function the
   * REST route calls · drift impossible.
   */
  threads: operatorProcedure
    .input(
      z
        .object({ includeDormant: z.boolean().optional() })
        .optional(),
    )
    .query(async ({ input }) =>
      listThreads({ includeDormant: input?.includeDormant ?? false }),
    ),

  /**
   * Phase TT.2 · owner-only · create a journal thread · two modes,
   * matching POST /api/journal/threads verbatim:
   *   · clusterHash present → confirm a convergence candidate
   *     (spawn thread + seed members + retire candidate)
   *   · clusterHash absent  → operator-initiated empty thread
   *
   * Both service functions return `{ error }` on a business-rule
   * rejection (duplicate name · candidate gone · too few members) ·
   * we surface that as a BAD_REQUEST so the component's existing
   * error-toast path is preserved (the REST route returned 422).
   */
  createThread: operatorProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        clusterHash: z.string().min(1).max(200).optional(),
        summary: z.string().max(400).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const result = input.clusterHash
        ? await confirmCandidate({
            clusterHash: input.clusterHash,
            name: input.name,
            summary: input.summary ?? null,
          })
        : await createEmptyThread({
            name: input.name,
            summary: input.summary ?? null,
          });
      if ("error" in result) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
      }
      return result;
    }),

  // ─────────────────── Convergence radar (ThreadRadar) ───────────────────

  /**
   * Phase TT.2 · owner-only · active convergence candidates the
   * nightly cron detected and the operator hasn't named yet.
   * Replaces GET /api/journal/convergence · delegates to
   * `journal-threads.listConvergenceCandidates`.
   */
  convergence: operatorProcedure.query(async () =>
    listConvergenceCandidates(),
  ),

  /**
   * Phase TT.2 · owner-only · run the convergence scan NOW (manual
   * trigger · normally fires nightly at 22:00 UTC). Replaces POST
   * /api/journal/convergence · delegates to the same
   * `runConvergenceScan` the Inngest cron + REST route use.
   *
   * Returns the scan telemetry the ThreadRadar shows inline. The
   * component reads `ranAt` + the scanned/found/afterPrune counts ·
   * we add `ranAt` here exactly as the REST route did.
   */
  runConvergenceScan: operatorProcedure.mutation(async () => {
    const result = await runConvergenceScan();
    return { ok: true, ranAt: new Date().toISOString(), ...result };
  }),

  /**
   * Phase TT.2 · owner-only · dismiss a convergence candidate by
   * clusterHash (soft-delete so the next scan doesn't re-surface it).
   * Replaces DELETE /api/journal/convergence?hash=... · delegates to
   * `journal-threads.dismissCandidate`.
   */
  dismissCandidate: operatorProcedure
    .input(z.object({ hash: z.string().min(1).max(200) }))
    .mutation(async ({ input }) => dismissCandidate(input.hash)),

  // ───────────────── Borderline joins (ThreadSuggestions) ─────────────────

  /**
   * Phase TT.2 · owner-only · entries the capture-hook scored in the
   * 0.65-0.80 SUGGEST band · waiting for operator confirm/reject.
   * Replaces GET /api/journal/suggestions · delegates to
   * `journal-threads.listThreadSuggestions`.
   */
  suggestions: operatorProcedure.query(async () =>
    listThreadSuggestions(),
  ),

  /**
   * Phase TT.2 · owner-only · accept a suggested thread join · promotes
   * the entry to a real JournalThreadEntry and clears the suggestion.
   * Replaces POST /api/journal/suggestions · delegates to
   * `journal-threads.acceptThreadSuggestion`.
   */
  acceptSuggestion: operatorProcedure
    .input(z.object({ key: z.string().min(1).max(200) }))
    .mutation(async ({ input }) => acceptThreadSuggestion(input.key)),

  /**
   * Phase TT.2 · owner-only · dismiss a suggested join (soft-delete).
   * Replaces DELETE /api/journal/suggestions?key=... · delegates to
   * `journal-threads.dismissThreadSuggestion`.
   */
  dismissSuggestion: operatorProcedure
    .input(z.object({ key: z.string().min(1).max(200) }))
    .mutation(async ({ input }) => dismissThreadSuggestion(input.key)),

  // ─────────────────────── Reflect (ReflectComposer) ──────────────────────

  /**
   * Phase TT.2 · owner-only · create a structured Reflection from a
   * template submission. Replaces POST /api/ultron/reflect · delegates
   * to `journal-reflect.createReflection` · the SAME function the REST
   * route calls.
   *
   * Input uses the SHARED `reflectSubmitSchema` from
   * @/lib/validators/journal — the exact schema the REST route's
   * `safeParseBody` parses. NOT a permissive z.record at the procedure
   * boundary · this is the typed-payload-mismatch guard (the /tasks
   * quick-add bug class). `ReflectFieldError` (zero filled fields) maps
   * to BAD_REQUEST so both transports reject identically.
   */
  reflect: operatorProcedure
    .input(reflectSubmitSchema)
    .mutation(async ({ input }) => {
      try {
        return await createReflection(input);
      } catch (err) {
        if (err instanceof ReflectFieldError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  // ──────────────────── Calibrate (MemoryCalibration) ─────────────────────

  /**
   * Phase TT.2 · owner-only · pick 1-3 aging brain memories for the
   * operator to re-rule. Replaces GET /api/ultron/calibrate · delegates
   * to `journal-calibrate.getCalibrationSamples`. Returns
   * `{ samples, generatedAt }` mirroring the legacy `data` envelope.
   */
  calibrationSamples: operatorProcedure.query(async () =>
    getCalibrationSamples(),
  ),

  /**
   * Phase TT.2 · owner-only · apply one calibration ruling (verify /
   * update / retire) to a brain memory. Replaces PATCH
   * /api/ultron/calibrate · delegates to
   * `journal-calibrate.applyCalibration`.
   *
   * Input uses the SHARED `calibrationRulingSchema` · the service
   * throws ServiceError(404) for a missing memory and ServiceError(400)
   * when an `update` ruling omits `newContent` · mapped to NOT_FOUND /
   * BAD_REQUEST so both transports behave identically.
   */
  calibrate: operatorProcedure
    .input(calibrationRulingSchema)
    .mutation(async ({ input }) => {
      try {
        return await applyCalibration(input);
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
});
