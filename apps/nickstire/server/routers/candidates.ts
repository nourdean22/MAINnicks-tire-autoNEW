/**
 * Candidate applications — a dedicated home for /careers job applicants,
 * NOT a `leads` row. See the doc comment on `candidates` in
 * drizzle/schema.ts for the full rationale.
 *
 * NOT YET WIRED INTO Careers.tsx as of this commit. Careers.tsx's
 * ApplicationForm still submits through trpc.lead.submit; cutting it over
 * to candidates.submit is a deliberate follow-up step gated on
 * drizzle/0122_candidates.sql being applied to production. This router
 * exists, is tested, and is safe to merge now — it just isn't called by
 * anything live yet.
 */
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createCandidate,
  getCandidates,
  updateCandidateStatus,
} from "../db";
import { sanitizeText, sanitizePhone, sanitizeEmail } from "../sanitize";
import { logAdminAction } from "../services/auditTrail";
import { createLogger } from "../lib/logger";

const log = createLogger("routers:candidates");

export const candidatesRouter = router({
  /**
   * The applicant's primary submission — unlike technicianReferrals.submit,
   * this one DOES throw on a real failure (matching lead.submit's own
   * behavior): losing a job application silently is worse than a visible
   * "please call us instead," since there is no secondary path recording
   * it once Careers.tsx is cut over to this endpoint.
   */
  submit: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        phone: z.string().min(7).max(30),
        email: z.string().email().max(320).nullish().or(z.literal("")),
        positionTitle: z.string().max(100).nullish(),
        experienceLevel: z.string().max(32).nullish(),
        message: z.string().max(2000).nullish(),
        utmSource: z.string().max(100).nullish(),
        utmMedium: z.string().max(100).nullish(),
        utmCampaign: z.string().max(255).nullish(),
        landingPage: z.string().max(500).nullish(),
        referrer: z.string().max(500).nullish(),
        sessionId: z.string().max(64).nullish(),
      }),
    )
    .mutation(async ({ input }) => {
      const name = sanitizeText(input.name);
      const phone = sanitizePhone(input.phone);
      if (!name || !phone) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Name and phone required" });
      }
      const email = input.email ? sanitizeEmail(input.email) : null;
      try {
        return await createCandidate({
          name,
          phone,
          email: email || null,
          positionTitle: input.positionTitle ?? null,
          experienceLevel: input.experienceLevel ?? null,
          message: sanitizeText(input.message ?? "") || null,
          source: "careers",
          utmSource: input.utmSource ?? null,
          utmMedium: input.utmMedium ?? null,
          utmCampaign: input.utmCampaign ?? null,
          landingPage: input.landingPage ?? null,
          referrer: input.referrer ?? null,
          sessionId: input.sessionId ?? null,
        });
      } catch (err) {
        log.error("[candidates.submit] failed:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "We couldn't save your application. Please call us instead.",
        });
      }
    }),

  /** Empty-vs-error: `migrationPending` distinguishes "0122 not applied yet" from "no applicants yet". */
  list: adminProcedure.query(async () => {
    return getCandidates();
  }),

  updateStatus: adminProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["new", "contacted", "interviewing", "hired", "declined", "withdrew"]),
        notes: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ input }) => {
      await updateCandidateStatus(input.id, {
        status: input.status,
        contactedAt: input.status === "contacted" ? new Date() : undefined,
        notes: input.notes ?? undefined,
      });
      logAdminAction({
        action: "candidate.status_changed",
        entityType: "candidate",
        entityId: input.id,
        details: `Status changed to ${input.status}`,
      }).catch((e) => {
        log.warn("[candidates.updateStatus] audit log failed:", e);
      });
      return { success: true };
    }),
});
