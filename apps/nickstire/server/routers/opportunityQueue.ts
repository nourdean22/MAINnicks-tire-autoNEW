/**
 * Opportunity Queue router — the Owner Decision Inbox API (Wave 4).
 *
 * Admin-only. Exposes the durable revenue-opportunity queue: list, the
 * ranked top-5 decisions, state transitions (with receipts), and
 * verified-outcome recording. NO endpoint here contacts a customer —
 * acting on a decision means the OPERATOR calls/texts through existing
 * channels, then records what happened.
 */
import { z } from "zod";
import { adminProcedure, router, dbAdminProcedure } from "../_core/trpc";
import {
  OPPORTUNITY_STATES,
  listOpportunities,
  transitionOpportunity,
  type OpportunityState,
} from "../services/opportunityQueue";

const stateSchema = z.enum(OPPORTUNITY_STATES);


export const opportunityQueueRouter = router({

  /** Full queue listing, optionally filtered by states. */
  list: dbAdminProcedure
    .input(
      z
        .object({
          states: z.array(stateSchema).optional(),
          limit: z.number().int().min(1).max(500).default(100),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      listOpportunities({
        states: input?.states as OpportunityState[] | undefined,
        limit: input?.limit ?? 100,
      }),
    ),

  /**
   * State transition with a mandatory receipt author. `won` is rejected
   * here by the service — use recordOutcome with an invoice id.
   */
  transition: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        to: stateSchema,
        note: z.string().max(500).optional(),
        owner: z.string().max(64).nullable().optional(),
        dueAtISO: z.string().datetime().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) =>
      transitionOpportunity({
        id: input.id,
        to: input.to,
        by: ctx.user?.email ?? "admin",
        note: input.note,
        owner: input.owner,
        dueAt: input.dueAtISO === undefined ? undefined : input.dueAtISO ? new Date(input.dueAtISO) : null,
      }),
    ),
});
