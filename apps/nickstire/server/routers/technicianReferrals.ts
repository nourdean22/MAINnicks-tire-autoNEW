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
    .mutation(async ({ input }) => {
      const hiredAt = new Date();
      const eligibleAt = new Date(hiredAt.getTime() + NINETY_DAYS_MS);
      await updateTechnicianReferralStatus(input.id, { status: "eligible", hiredAt, eligibleAt });
      logAdminAction({
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
    .mutation(async ({ input }) => {
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
      await updateTechnicianReferralStatus(input.id, { status: "paid", paidAt: new Date() });
      logAdminAction({
        action: "technician_referral.marked_paid",
        entityType: "technician_referral",
        entityId: input.id,
        details: `Referral #${input.id} marked paid`,
      }).catch((e) => { log.warn("[technicianReferrals.markPaid] audit log failed:", e); });
      return { success: true };
    }),

  disqualify: adminProcedure
    .input(z.object({ id: z.number(), reason: z.string().min(1).max(500) }))
    .mutation(async ({ input }) => {
      await updateTechnicianReferralStatus(input.id, { status: "disqualified", disqualifiedReason: input.reason });
      logAdminAction({
        action: "technician_referral.disqualified",
        entityType: "technician_referral",
        entityId: input.id,
        details: `Referral #${input.id} disqualified: ${input.reason}`,
      }).catch((e) => { log.warn("[technicianReferrals.disqualify] audit log failed:", e); });
      return { success: true };
    }),
});
