/**
 * Customer Promise Ledger router — admin-only. Create, keep (with
 * mandatory evidence), cancel, list. Escalation happens in the cron
 * sweep, not here. No endpoint contacts a customer.
 */
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  PROMISE_TYPES,
  createPromise,
  keepPromise,
  cancelPromise,
  listOpenPromises,
  sweepOverduePromises,
} from "../services/promiseLedger";

export const promisesRouter = router({
  listOpen: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(async ({ input }) => listOpenPromises(input?.limit ?? 100)),

  create: adminProcedure
    .input(
      z.object({
        promiseType: z.enum(PROMISE_TYPES),
        promisedAction: z.string().min(5).max(500),
        dueAtISO: z.string().datetime(),
        customerName: z.string().max(255).optional(),
        customerPhone: z.string().max(32).optional(),
        owner: z.string().max(64).optional(),
        sourceId: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) =>
      createPromise({
        promiseType: input.promiseType,
        promisedAction: input.promisedAction,
        dueAt: new Date(input.dueAtISO),
        customerName: input.customerName ?? null,
        customerPhone: input.customerPhone ?? null,
        owner: input.owner ?? null,
        sourceKind: "operator",
        sourceId: input.sourceId ?? null,
        createdBy: ctx.user?.email ?? "admin",
      }),
    ),

  /** Kept requires evidence — "what did you actually do". */
  keep: adminProcedure
    .input(z.object({ id: z.string().uuid(), evidence: z.string().min(3).max(280) }))
    .mutation(async ({ input, ctx }) =>
      keepPromise({ id: input.id, evidence: input.evidence, by: ctx.user?.email ?? "admin" }),
    ),

  cancel: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => cancelPromise({ id: input.id, by: ctx.user?.email ?? "admin" })),

  /** Manual sweep (the cron also runs this on tier 3). */
  sweep: adminProcedure.mutation(async () => sweepOverduePromises()),
});
