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
import { adminProcedure, router } from "../_core/trpc";
import {
  OPPORTUNITY_STATES,
  listOpportunities,
  topDecisions,
  transitionOpportunity,
  recordOutcome,
  refreshOpportunityQueue,
  type OpportunityState,
} from "../services/opportunityQueue";

const stateSchema = z.enum(OPPORTUNITY_STATES);

export const opportunityQueueRouter = router({
  /** Ranked top-N owner decisions (default 5) with visible ranking factors. */
  top: adminProcedure
    .input(z.object({ n: z.number().int().min(1).max(20).default(5) }).optional())
    .query(async ({ input }) => topDecisions(input?.n ?? 5)),

  /** Full queue listing, optionally filtered by states. */
  list: adminProcedure
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

  /** The only path to `won`: a real invoice id, verified before writing. */
  recordOutcome: adminProcedure
    .input(z.object({ id: z.string().uuid(), invoiceId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) =>
      recordOutcome({
        id: input.id,
        invoiceId: input.invoiceId,
        by: ctx.user?.email ?? "admin",
      }),
    ),

  /** Manual collector run (the cron also does this on tier 3). */
  refresh: adminProcedure.mutation(async () => refreshOpportunityQueue()),
});
