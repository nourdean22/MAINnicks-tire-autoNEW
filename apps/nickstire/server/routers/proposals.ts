/**
 * Proposals router — the admin surface of the generic approval queue.
 *
 * Execution is reachable ONLY through `approve` / `retry` (which run the CAS
 * chain in services/proposals.ts). There is no direct "perform action"
 * mutation anywhere — that is the backend-enforced half of the trust ladder.
 *
 * RBAC: `proposals.` prefix — queries admin.view, mutations settings.manage
 * (shared/adminPermissions.ts). Deliberately operator-grade to start; loosen
 * per-role only on an explicit operator decision.
 */
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { deriveActor } from "../services/activityLedger";
import {
  approveAndExecute,
  countReviewable,
  createProposal,
  getProposal,
  listExecutors,
  listProposals,
  PROPOSAL_STATUSES,
  rejectProposal,
  retryExecution,
  submitForReview,
} from "../services/proposals";

const statusEnum = z.enum(PROPOSAL_STATUSES);

export const proposalsRouter = router({
  /** Queue + history. Default view = needs-decision (draft + pending_review). */
  list: adminProcedure
    .input(
      z
        .object({
          statuses: z.array(statusEnum).max(PROPOSAL_STATUSES.length).optional(),
          limit: z.number().int().min(1).max(500).default(100),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      return listProposals({ statuses: input?.statuses, limit: input?.limit });
    }),

  get: adminProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
    return getProposal(input.id);
  }),

  /** Tri-state: readable=false must render "?" — never a confident zero. */
  counts: adminProcedure.query(async () => {
    return countReviewable();
  }),

  /** Registry metadata for the review UI (what will approval actually do). */
  actionTypes: adminProcedure.query(() => listExecutors()),

  /**
   * Human-originated draft (Phase 7 in-page actions land here). AI callers do
   * NOT use this router — they call createProposal from server code.
   */
  create: adminProcedure
    .input(
      z.object({
        actionType: z.string().min(1).max(48),
        title: z.string().min(1).max(255),
        payload: z.record(z.string(), z.unknown()),
        entityType: z.string().max(50).optional(),
        entityId: z.string().max(64).optional(),
        context: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const actor = deriveActor(ctx);
      return createProposal({
        source: "human_user",
        actor: actor.actor,
        actionType: input.actionType,
        title: input.title,
        payload: input.payload,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        context: input.context ?? null,
      });
    }),

  submitForReview: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => submitForReview(input.id, deriveActor(ctx))),

  approve: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => approveAndExecute(input.id, deriveActor(ctx))),

  reject: adminProcedure
    .input(z.object({ id: z.string().uuid(), note: z.string().max(1000).optional() }))
    .mutation(async ({ input, ctx }) => rejectProposal(input.id, deriveActor(ctx), input.note)),

  retry: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => retryExecution(input.id, deriveActor(ctx))),
});
