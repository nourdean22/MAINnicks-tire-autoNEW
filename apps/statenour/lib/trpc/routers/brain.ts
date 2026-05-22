/**
 * lib/trpc/routers/brain.ts · Phase UU (2026-05-19 AM) · extended
 * Phase UU.2 (2026-05-22 · legacy-modernizer REST→tRPC settings slice).
 *
 * Brain-domain procedures · the 8th domain router (nick · operator ·
 * system · chat · browser · task · journal · brain). Wraps the
 * /brain/wisdom dashboard read + curation actions. /brain galaxy ·
 * health · identity-trajectory have minimal authedFetch · they can
 * migrate in a future UU+ phase.
 *
 * Phase UU.2 adds two brain-domain reads the /settings surfaces touch
 * (the SettingsPage SystemInfo memory count + the SystemDataCards
 * memory-of-the-day card) — they're brain reads, so they live here
 * rather than in a thin `settings` router.
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
import {
  listPins,
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
});
