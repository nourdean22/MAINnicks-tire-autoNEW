/**
 * Technician-referral tracking — structured backing for the $300-after-
 * 90-days technician-referral bonus advertised on /careers. Previously the
 * referrer's name lived only inside a free-text note concatenated onto the
 * applicant's `leads.problem` field, so the shop had no reliable way to know
 * who referred whom, verify the 90-day condition, or pay the bonus out
 * without a dispute. This router gives that promise a real, queryable,
 * payable record.
 *
 * Separate from `referralsRouter` in ./services.ts, which backs the
 * unrelated $25/$25 CUSTOMER referral program at /refer — do not merge them.
 */
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createTechnicianReferral,
  getTechnicianReferrals,
  getReferralOrphans,
  getTechnicianReferralById,
  updateTechnicianReferralStatus,
} from "../db";
import { sanitizeText, sanitizePhone } from "../sanitize";
import { logAdminAction } from "../services/auditTrail";
import { createLogger } from "../lib/logger";

const log = createLogger("routers:technicianReferrals");

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export const technicianReferralsRouter = router({
  /**
   * Called right after a /careers application submits, only when the
   * applicant named a referrer. Never throws to the caller on a missing
   * table — a defensive path for any environment where migration 0121
   * hasn't been applied yet (production has it as of 2026-09-09; a fresh
   * dev DB might not). The applicant's own candidate/lead row already
   * saved either way; losing the structured referral record must not read
   * to them as a failed application.
   */
  submit: publicProcedure
    .input(z.object({
      leadId: z.number().nullish(),
      candidateId: z.number().nullish(),
      referrerName: z.string().min(1).max(255),
      referrerPhone: z.string().max(30).nullish(),
      positionTitle: z.string().max(100).nullish(),
    }))
    .mutation(async ({ input }) => {
      const referrerName = sanitizeText(input.referrerName);
      if (!referrerName) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Referrer name required" });
      }
      const referrerPhone = input.referrerPhone ? sanitizePhone(input.referrerPhone) : null;
      try {
        return await createTechnicianReferral({
          leadId: input.leadId ?? null,
          candidateId: input.candidateId ?? null,
          referrerName,
          referrerPhone: referrerPhone || null,
          positionTitle: input.positionTitle ?? null,
        });
      } catch (err) {
        log.error("[technicianReferrals.submit] failed:", err);
        return { success: false } as const;
      }
    }),

  /**
   * Empty-vs-error, same discipline as the Lot section's vehicle_visits read:
   * `migrationPending` distinguishes "0121 not applied yet" from "zero
   * referrals so far" — the admin panel must render these differently.
   */
  list: adminProcedure.query(async () => {
    return getTechnicianReferrals();
  }),

  /**
   * Candidates who named a referrer but have no structured referral row.
   *
   * submit above is deliberately soft-fail so a referral write can never break
   * the applicant's own submission. This is the other half of that decision:
   * without it a lost $300 obligation is invisible to the applicant, the
   * referrer and the operator alike, surviving only as free text in
   * candidates.message that no surface renders.
   */
  orphans: adminProcedure.query(async () => {
    return getReferralOrphans();
  }),

  /**
   * Admin confirms a referred applicant was actually hired. Stamps hiredAt
   * and the 90-day eligibility date TOGETHER so eligibility is a stored
   * fact, not a recomputation that could drift if the 90-day rule changes
   * later.
   */
  markHired: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const hiredAt = new Date();
      const eligibleAt = new Date(hiredAt.getTime() + NINETY_DAYS_MS);
      // ONLY from pending. Without this precondition the only guard was the
      // UI rendering the button by status, so a stale tab could move a PAID
      // referral back to eligible with a FRESH 90-day clock while paidAt
      // stayed set — a second $300 on one referral. The status is part of the
      // WHERE, so two concurrent clicks cannot both observe pending.
      const res = await updateTechnicianReferralStatus(
        input.id,
        { status: "eligible", hiredAt, eligibleAt },
        { expectStatus: ["pending"] },
      );
      if (!res.success) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This referral is no longer pending — reload before marking it hired. Re-hiring an already-paid referral would start a second 90-day clock.",
        });
      }
      logAdminAction({
        // Without this auditTrail stamps "admin" for everyone, so the row
        // cannot say who moved a $300 payout. Same shape as admin/followUps.ts.
        actor: ctx.user?.email ?? ctx.user?.name ?? "admin",
        action: "technician_referral.marked_hired",
        entityType: "technician_referral",
        entityId: input.id,
        details: `Referral #${input.id} marked hired; eligible ${eligibleAt.toISOString().split("T")[0]}`,
      }).catch((e) => { log.warn("[technicianReferrals.markHired] audit log failed:", e); });
      return { success: true, eligibleAt };
    }),

  /**
   * The advertised bonus is "$300 AFTER 90 DAYS" — markHired sets status to
   * "eligible" immediately (which is what unlocks the panel's Mark Paid
   * button), but eligibility for the button to be SHOWN is not the same as
   * eligibility for the payout to be OWED. Re-check eligibleAt here, not just
   * status, so a just-hired referral can't be paid same-day even via a stale
   * client or a direct mutation call.
   */
  markPaid: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const referral = await getTechnicianReferralById(input.id);
      if (referral.status !== "eligible") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Referral must be marked hired and eligible before it can be paid." });
      }
      if (!referral.eligibleAt || referral.eligibleAt.getTime() > Date.now()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Not eligible until ${referral.eligibleAt ? referral.eligibleAt.toISOString().split("T")[0] : "unknown"} — the 90-day wait isn't up yet.`,
        });
      }
      // The checks above are a READ-then-write: two concurrent clicks both
      // observe "eligible" and both proceed, paying twice. expectStatus puts
      // the status in the WHERE so exactly one of them matches a row.
      const paid = await updateTechnicianReferralStatus(
        input.id,
        { status: "paid", paidAt: new Date() },
        { expectStatus: ["eligible"] },
      );
      if (!paid.success) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This referral was already paid or changed state — reload before paying it again.",
        });
      }
      logAdminAction({
        // Without this auditTrail stamps "admin" for everyone, so the row
        // cannot say who moved a $300 payout. Same shape as admin/followUps.ts.
        actor: ctx.user?.email ?? ctx.user?.name ?? "admin",
        action: "technician_referral.marked_paid",
        entityType: "technician_referral",
        entityId: input.id,
        details: `Referral #${input.id} marked paid`,
      }).catch((e) => { log.warn("[technicianReferrals.markPaid] audit log failed:", e); });
      return { success: true };
    }),

  disqualify: adminProcedure
    .input(z.object({ id: z.number(), reason: z.string().min(1).max(500) }))
    .mutation(async ({ input, ctx }) => {
      // A PAID referral cannot be disqualified: the money is already out, so
      // flipping the record would misstate what happened rather than undo it.
      // Reversing a payout is an accounting action, not a status edit.
      const dq = await updateTechnicianReferralStatus(
        input.id,
        { status: "disqualified", disqualifiedReason: input.reason },
        { expectStatus: ["pending", "eligible"] },
      );
      if (!dq.success) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Only a pending or eligible referral can be disqualified — a paid one needs an accounting reversal, not a status change.",
        });
      }
      logAdminAction({
        // Without this auditTrail stamps "admin" for everyone, so the row
        // cannot say who moved a $300 payout. Same shape as admin/followUps.ts.
        actor: ctx.user?.email ?? ctx.user?.name ?? "admin",
        action: "technician_referral.disqualified",
        entityType: "technician_referral",
        entityId: input.id,
        details: `Referral #${input.id} disqualified: ${input.reason}`,
      }).catch((e) => { log.warn("[technicianReferrals.disqualify] audit log failed:", e); });
      return { success: true };
    }),

  /**
   * The referred technician WAS hired and then left before the 90 days were
   * up, so no bonus is owed.
   *
   * WHY THIS EXISTS (2026-09-10). `forfeited` was declared in the schema's
   * status comment, typed in updateTechnicianReferralStatus's union, and given
   * its own colour in TechnicianReferralsPanel — and written by NOTHING. A
   * status with a colour and no writer is dead UI at best; here it was worse,
   * because the state it names happens constantly in this trade. Techs leave
   * inside 90 days. With no forfeit action an admin had exactly two options,
   * both wrong: leave the referral sitting in `eligible` forever, where it
   * overstates what the shop owes, or press Disqualify — which says the CLAIM
   * was invalid when in fact it was perfectly good and the CONDITION simply
   * was not met. The referrer did nothing wrong, and the record should not say
   * they did. That distinction is the whole reason for two terminal states.
   *
   * ONLY from `eligible`. A `pending` referral was never confirmed hired, so
   * there is no 90-day condition to fail — nothing to forfeit. A `paid` one is
   * money already out: reversing it is an accounting action, not a status
   * edit, exactly as with disqualify above.
   *
   * The reason rides in `disqualifiedReason` because that is the only reason
   * column on the table and adding one needs a hand-applied migration, which
   * is operator-gated. Read that column as "why no bonus is owed" — it now
   * serves both terminal states, and the status beside it says which.
   */
  markForfeited: adminProcedure
    .input(z.object({ id: z.number(), reason: z.string().min(1).max(500) }))
    .mutation(async ({ input, ctx }) => {
      // ONCE THE 90 DAYS HAVE ELAPSED THE BONUS IS OWED, and forfeiting it is
      // no longer a status edit — it is refusing a debt. markPaid re-checks
      // eligibleAt for the mirror-image reason ("eligibility for the button to
      // be SHOWN is not the same as eligibility for the payout to be OWED");
      // without the same check here, a stale tab, a double-click or a direct
      // mutation call could wipe out an EARNED $300, and the only thing
      // standing in the way was a confirm dialog ASKING whether the tech left
      // before day 90 - a guard against a cooperative user, which is precisely
      // what markHired's own comment says is not a guard at all.
      //
      // A genuinely late-discovered departure (left at day 45, found out at
      // day 95) is real but rare, and it is the case that should cost a person
      // a conversation rather than the common case costing someone their bonus.
      // Recording the DEPARTURE DATE would let this decide honestly instead of
      // erring; ConfirmDialog cannot capture free text today (see the note in
      // the disqualify handler), so this errs toward not denying money.
      const referral = await getTechnicianReferralById(input.id);
      if (referral.eligibleAt && referral.eligibleAt.getTime() <= Date.now()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `This referral cleared its 90 days on ${referral.eligibleAt.toISOString().split("T")[0]} — the bonus is owed, so it cannot be forfeited from here. Pay it, or handle a genuine late-discovered departure as an accounting reversal.`,
        });
      }
      const res = await updateTechnicianReferralStatus(
        input.id,
        { status: "forfeited", disqualifiedReason: input.reason },
        { expectStatus: ["eligible"] },
      );
      if (!res.success) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Only an eligible referral can be forfeited — reload before trying again. A pending one was never hired, and a paid one needs an accounting reversal.",
        });
      }
      logAdminAction({
        actor: ctx.user?.email ?? ctx.user?.name ?? "admin",
        action: "technician_referral.forfeited",
        entityType: "technician_referral",
        entityId: input.id,
        details: `Referral #${input.id} forfeited (left before 90 days): ${input.reason}`,
      }).catch((e) => { log.warn("[technicianReferrals.markForfeited] audit log failed:", e); });
      return { success: true };
    }),
});
