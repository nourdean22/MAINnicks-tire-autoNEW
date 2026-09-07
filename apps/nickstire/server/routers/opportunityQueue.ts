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
import { eq } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import {
  OPPORTUNITY_STATES,
  listOpportunities,
  topDecisions,
  transitionOpportunity,
  recordOutcome,
  refreshOpportunityQueue,
  snoozeOpportunity,
  type OpportunityState,
} from "../services/opportunityQueue";
import { getRecoveryLiftReport } from "../services/recoveryLift";

const stateSchema = z.enum(OPPORTUNITY_STATES);

/** Everything a customer can STATE about a declined quote (Recovery 2.0).
 *  price/proof/time/waiting_event route a track; the last three CLOSE
 *  recovery for the estimate. */
const statedConcernSchema = z.enum([
  "price",
  "proof",
  "time",
  "waiting_event",
  "repaired_elsewhere",
  "no_longer_owns",
  "not_interested",
]);

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

  /** The only path to `won`: a real invoice id, match-verified against
   * THIS opportunity (direct source linkage or phone+date). Pass
   * allowManualMatch to attach an unlinked invoice as an explicit
   * operator judgment — recorded as `manual`, never as independently
   * verified. */
  recordOutcome: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      invoiceId: z.number().int().positive(),
      allowManualMatch: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) =>
      recordOutcome({
        id: input.id,
        invoiceId: input.invoiceId,
        by: ctx.user?.email ?? "admin",
        allowManualMatch: input.allowManualMatch === true,
      }),
    ),

  /** Snooze: push due_at, receipt-logged, no state change. */
  snooze: adminProcedure
    .input(z.object({ id: z.string().uuid(), untilISO: z.string().datetime() }))
    .mutation(async ({ input, ctx }) =>
      snoozeOpportunity({ id: input.id, untilISO: input.untilISO, by: ctx.user?.email ?? "admin" }),
    ),

  /**
   * Recovery 2.0 · an operator RELAYING what the customer actually said.
   *
   * 2026-09-07 · reshaped, not removed. The defect was never that staff may
   * record a customer's words — front-desk hears them on the phone constantly,
   * and that is real evidence that should stop a recovery sequence. The defect
   * was that HIDING A CARD wrote those words as a side effect.
   *
   * This endpoint's only caller was the Decision Inbox's "Fixed elsewhere /
   * Sold the car / Not interested" chips, which an operator clicked to clear a
   * card off the home screen. It stamped `stated_concern_source = "operator"`,
   * and three consumers then treated that as the customer speaking: the
   * collector excluded the estimate forever, the reconciler flipped the
   * opportunity to `lost`, and declinedWorkRecovery ended that customer's real
   * recovery sequence — under a comment reading "The customer told us".
   *
   * The two acts are now separated and cannot be confused:
   *   · "This row is not worth acting on"  -> transition -> "dismissed".
   *     Neutral. Writes no concern, no consent change, no lost.
   *   · "The customer told me X"           -> THIS endpoint, which now requires
   *     an explicit `heardFrom: "customer"` attestation. There is no way to
   *     reach it as a side effect of tidying a list.
   *
   * Source is recorded as `operator_relayed` — distinct from `sms_reply` (the
   * customer's own words, captured passively) and from the old undifferentiated
   * `operator`. Both count as customer-sourced in CUSTOMER_SOURCED_CONCERN,
   * because in both a human is attesting to what the customer said; the
   * distinction is preserved in the column so the two can ever be told apart.
   */
  captureStatedConcern: adminProcedure
    .input(
      z.object({
        estimateId: z.number().int().positive(),
        concern: statedConcernSchema,
        /**
         * Required attestation. A literal, not a boolean, so the call site has
         * to say the quiet part out loud — and so a future "hide this" feature
         * cannot satisfy it by passing a default.
         */
        heardFrom: z.literal("customer"),
        note: z.string().max(300).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return { ok: false as const, error: "DB unavailable" };
      const { algEstimates } = await import("../../drizzle/schema");
      const result = await db
        .update(algEstimates)
        .set({
          statedConcern: input.concern,
          statedConcernSource: "operator_relayed",
          statedConcernAt: new Date(),
        })
        .where(eq(algEstimates.id, input.estimateId));
      const raw = (Array.isArray(result) && result[0] && typeof result[0] === "object"
        ? result[0]
        : result) as { affectedRows?: number; rowsAffected?: number };
      const affected = raw.affectedRows ?? raw.rowsAffected ?? 0;
      if (affected === 0) return { ok: false as const, error: `estimate ${input.estimateId} not found` };
      return { ok: true as const, capturedBy: ctx.user?.email ?? "admin" };
    }),

  /** Treated-vs-holdout recovery lift (raw rates, sample-size-gated). */
  recoveryLift: adminProcedure
    .input(z.object({ windowDays: z.number().int().min(14).max(365).default(90) }).optional())
    .query(async ({ input }) => getRecoveryLiftReport(input?.windowDays ?? 90)),

  /** Manual collector run (the cron also does this on tier 3). */
  refresh: adminProcedure.mutation(async () => refreshOpportunityQueue()),

  /**
   * Decision Inbox 2.0 (2026-07-29): deterministic outreach draft + best
   * channel + risk label for one opportunity. Read-only — nothing sends.
   * Call-first source types (callback / complaint / promise) return no
   * draft with the reason stated.
   */
  draftOutreach: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const { draftOpportunityOutreach } = await import("../services/opportunityDraft");
      const { items, queryable } = await listOpportunities({ limit: 500 });
      // An unreadable queue is not an absent opportunity. Saying "not found"
      // would invite the operator to conclude the row is gone.
      if (!queryable) return { ok: false as const, error: "opportunity queue unreadable — this is UNKNOWN, not empty" };
      const opp = items.find((r) => r.id === input.id);
      if (!opp) return { ok: false as const, error: "opportunity not found" };
      return draftOpportunityOutreach(opp);
    }),

  /**
   * Operator-approved send of the (possibly edited) draft. Ladder level 1:
   * the human taps send on the exact text; sendSms's full chokepoint
   * (opt-out fail-closed, caps, pause, quiet-hour queue) still applies.
   * Success transitions the opportunity to `attempted` with a receipt.
   */
  sendOutreach: adminProcedure
    .input(z.object({ id: z.string().uuid(), body: z.string().min(1).max(480) }))
    .mutation(async ({ input, ctx }) => {
      const { sendOpportunityDraft } = await import("../services/opportunityDraft");
      return sendOpportunityDraft({ id: input.id, body: input.body, by: ctx.user?.email ?? "admin" });
    }),
});
