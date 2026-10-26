/**
 * RETIRED 2026-10-26 (PR 3294); delete after 2026-11-09 once old bundles have reloaded.
 *
 * The booking follow-up lane (server/follow-ups.ts) is gone: no cron ran it and bookings are
 * rare at a walk-in shop; the post-visit and review texts key to invoices on their own lanes.
 * An installed PWA on the old bundle keeps polling followUps.pending / followUps.recent until
 * it reloads (client/public/sw.js is static), so this adapter answers instead of NOT_FOUND:
 * empty lists for the reads, a reload message for the actions. Nothing here reads or writes.
 */
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../../_core/trpc";

const retired = () => {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "The booking follow-ups lane was retired on 2026-10-26; reload the admin.",
  });
};

export const followUpsRouter = router({
  pending: adminProcedure.query(() => [] as never[]),
  recent: adminProcedure.query(() => [] as never[]),
  run: adminProcedure.mutation(retired),
  cancel: adminProcedure.mutation(retired),
  retry: adminProcedure.mutation(retired),
});
