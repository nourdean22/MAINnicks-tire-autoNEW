/**
 * lib/trpc/routers/brain.ts · Phase UU (2026-05-19 AM).
 *
 * Brain-domain procedures · the 8th domain router (nick · operator ·
 * system · chat · browser · task · journal · brain). Wraps the
 * /brain/wisdom dashboard read + curation actions. /brain galaxy ·
 * health · identity-trajectory have minimal authedFetch · they can
 * migrate in a future UU+ phase.
 *
 * Delegates to `lib/services/brain-wisdom.ts` · the legacy REST
 * routes call the same module · drift impossible.
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
});
