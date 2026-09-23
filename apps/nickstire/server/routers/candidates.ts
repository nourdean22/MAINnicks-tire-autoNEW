/**
 * Candidate applications — a dedicated home for /careers job applicants,
 * NOT a `leads` row. See the doc comment on `candidates` in
 * drizzle/schema.ts for the full rationale.
 *
 * WIRED INTO Careers.tsx as of 2026-09-09: ApplicationForm submits through
 * candidates.submit, gated on (and following) drizzle/0122_candidates.sql
 * applying to production.
 */
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createCandidate,
  getCandidates,
  updateCandidateStatus,
  getCandidateSlaBreaches,
  findCandidatesByPhoneE164,
} from "../db";
import {
  CANDIDATE_INTENTS,
  CANDIDATE_INTENT_LABELS,
  CANDIDATE_STATUSES,
  CANDIDATE_CONTACT_IMPLIED_STATUSES,
  MOVE_REASONS,
  MOVE_REASON_LABELS,
  refCodeFromLandingPage,
} from "@shared/candidateLifecycle";
import { normalizePhone } from "../lib/phone";
import { runCandidateIntake } from "../services/candidateIntake";
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
        // ── 2026-09-23 recruiting funnel (drizzle/0129) ──────────────────
        intent: z.enum(CANDIDATE_INTENTS).nullish(),
        moveReasons: z.array(z.enum(MOVE_REASONS)).max(MOVE_REASONS.length).nullish(),
        utmTerm: z.string().max(255).nullish(),
        utmContent: z.string().max(255).nullish(),
        gclid: z.string().max(255).nullish(),
        /**
         * Honeypot. Rendered off-screen and aria-hidden; a person never fills
         * it, a form-spamming bot fills every field. Chosen over a CAPTCHA
         * because it needs no keys and adds no friction for applicants.
         */
        website: z.string().max(200).nullish(),
      }),
    )
    .mutation(async ({ input }) => {
      // A filled honeypot gets the same success shape a person gets, so the
      // bot learns nothing — and nothing is written or sent.
      if (input.website && input.website.trim() !== "") {
        log.info("[candidates.submit] honeypot filled — dropped");
        return { success: true as const, id: 0 };
      }
      const name = sanitizeText(input.name);
      const phone = sanitizePhone(input.phone);
      if (!name || !phone) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Name and phone required" });
      }
      const email = input.email ? sanitizeEmail(input.email) : null;
      const intent = input.intent ?? "apply";
      const reasons = Array.from(new Set(input.moveReasons ?? []));
      const phoneE164 = normalizePhone(phone);
      const refCode = refCodeFromLandingPage(input.landingPage);
      // Intent and reasons ALSO ride in `message`, human-readable, so they
      // survive the pre-0129 fallback insert and show in every existing view.
      const header = [
        intent !== "apply" ? `[${CANDIDATE_INTENT_LABELS[intent]}]` : "",
        reasons.length ? `Would move for: ${reasons.map((r) => MOVE_REASON_LABELS[r]).join(", ")}` : "",
      ].filter(Boolean).join("\n");
      const body = sanitizeText(input.message ?? "") || "";
      const message = [header, body].filter(Boolean).join("\n") || null;
      let result: Awaited<ReturnType<typeof createCandidate>>;
      try {
        result = await createCandidate({
          name,
          phone,
          email: email || null,
          positionTitle: input.positionTitle ?? null,
          experienceLevel: input.experienceLevel ?? null,
          message,
          source: "careers",
          utmSource: input.utmSource ?? null,
          utmMedium: input.utmMedium ?? null,
          utmCampaign: input.utmCampaign ?? null,
          landingPage: input.landingPage ?? null,
          referrer: input.referrer ?? null,
          sessionId: input.sessionId ?? null,
          // 0129 columns: attached only when there is something to write, so
          // a plain application emits the same insert it always did.
          // NULL intent reads as "apply" (the only kind before 0129).
          ...(intent !== "apply" ? { intent } : {}),
          ...(reasons.length ? { moveReasons: reasons.join(",") } : {}),
          ...(phoneE164 ? { phoneE164 } : {}),
          ...(refCode ? { refCode } : {}),
          ...(input.gclid ? { gclid: input.gclid } : {}),
          ...(input.utmTerm ? { utmTerm: input.utmTerm } : {}),
          ...(input.utmContent ? { utmContent: input.utmContent } : {}),
        });
      } catch (err) {
        log.error("[candidates.submit] failed:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "We couldn't save your application. Please call us instead.",
        });
      }

      // createCandidate RETURNS (does not throw) `{ success: false,
      // migrationPending: true }` when the candidates table is missing, so this
      // check sits OUTSIDE the try — inside, the catch would swallow its own
      // TRPCError and log twice. Returning that shape as-is resolved the
      // mutation, so Careers.tsx's onSuccess fired and the applicant was shown
      // "Application Received" while nothing had been written — and data.id was
      // undefined, so the technician-referral row lost its candidateId link too.
      // That is the exact silent loss the doc comment above says this endpoint
      // must not have. Production has 0122 applied, so this is a latent trap
      // (a fresh DB, a restore, a new environment) rather than a live one, but
      // the applicant must see the honest "call us instead" either way.
      if (!result.success) {
        log.error("[candidates.submit] candidates table unavailable — application NOT saved");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "We couldn't save your application. Please call us instead.",
        });
      }

      // After the save, never before it, and never awaited by the applicant:
      // an alert failure must not turn a saved application into an error.
      // Narrowed by the success check above; the union's failure arm has no id.
      const id = (result as { id: number }).id;
      void (async () => {
        // null = "could not check" (no parseable phone, or the lookup failed);
        // [] would claim "first time we've seen them", which we don't know.
        const prior = phoneE164 ? await findCandidatesByPhoneE164(phoneE164, id).catch(() => null) : null;
        await runCandidateIntake({
          id,
          name,
          phone,
          email: email || null,
          positionTitle: input.positionTitle ?? null,
          experienceLevel: input.experienceLevel ?? null,
          message,
          intent,
          moveReasons: reasons.length ? reasons.join(",") : null,
          refCode,
          utmSource: input.utmSource ?? null,
          utmMedium: input.utmMedium ?? null,
          utmCampaign: input.utmCampaign ?? null,
          priorIds: prior && prior.available ? prior.rows.map((p) => p.id) : null,
        });
      })().catch((err) => log.warn("[candidates.submit] intake failed", { id, err: String(err) }));

      return { success: true as const, id };
    }),

  /** Empty-vs-error: `migrationPending` distinguishes "0122 not applied yet" from "no applicants yet". */
  /**
   * Applicants aging against the 48-hour response /careers promises twice.
   * Nothing enforced that promise before: no cron touches this table, no
   * timer, no escalation, no aging sort — the only surface was a collapsible
   * panel someone had to remember to open.
   */
  slaBreaches: adminProcedure.query(async () => {
    return getCandidateSlaBreaches();
  }),

  list: adminProcedure.query(async () => {
    return getCandidates();
  }),

  updateStatus: adminProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(CANDIDATE_STATUSES),
        notes: z.string().max(2000).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await updateCandidateStatus(input.id, {
        status: input.status,
        // Any status that means a human really reached the person stamps
        // contactedAt — the SLA alarm keys off it. updateCandidateStatus keeps
        // an earlier stamp rather than overwriting it.
        contactedAt: CANDIDATE_CONTACT_IMPLIED_STATUSES.includes(input.status) ? new Date() : undefined,
        notes: input.notes ?? undefined,
      });
      logAdminAction({
        // Without this auditTrail stamps "admin" for everyone, so the row
        // cannot say who moved a $300 payout. Same shape as admin/followUps.ts.
        actor: ctx.user?.email ?? ctx.user?.name ?? "admin",
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
