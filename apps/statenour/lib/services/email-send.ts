/**
 * lib/services/email-send.ts · Phase HH (2026-05-18 PM)
 *
 * Owner-gated email send for the Nick chat draft-card flow. Wraps
 * `lib/services/email.sendEmail()` with the audit-event write so
 * every operator-initiated send leaves an audit trail.
 *
 * Extracted from `app/api/email/send/route.ts` so the legacy REST
 * endpoint AND the new `trpc.chat.sendEmail` mutation both call
 * this single function · drift between the two consumers is
 * structurally impossible. Same shared-service pattern as S.2 / U.3 /
 * Y.1 / Z / DD / EE / GG.
 *
 * The audit-event write is best-effort · matches the v8.x universal
 * audit pattern · a failed audit write never blocks the send result
 * (operator-grade priority).
 */

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/services/email";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/email-send");

export interface SendEmailArgs {
  to: string;
  subject: string;
  body: string;
  html?: string;
}

export interface SendEmailResult {
  /**
   * Derived from whether Resend actually accepted the message. This was typed
   * as the LITERAL `true`, so no caller could branch on failure even if it
   * wanted to — and `sendEmail` returns null (not a throw) when the provider
   * is unconfigured, which is precisely the case that needs branching.
   */
  ok: boolean;
  id: string | null;
  /** Provider not configured · nothing was attempted. */
  skipped?: boolean;
}

export async function sendEmailWithAudit(args: SendEmailArgs): Promise<SendEmailResult> {
  const id = await sendEmail({
    to: args.to,
    subject: args.subject,
    text: args.body,
    html: args.html,
  });

  // A null id means Resend is not configured — nothing left the building.
  // Writing "email_sent" there put a delivery in the audit trail that never
  // happened, and /system/events renders it as a send.
  const delivered = id !== null;
  if (!delivered) {
    log.error("email_not_sent", { reason: "provider_not_configured", to: args.to });
  }

  // Audit trail — non-fatal · matches the v8.x universal audit pattern.
  // Body excerpt only · never persist the full body for privacy (the
  // long-term PII review surface flags anything >800 chars).
  await prisma.auditEvent
    .create({
      data: {
        actor: "user:email-draft-card",
        eventType: delivered ? "email_sent" : "email_send_skipped",
        detail: delivered
          ? `Sent "${args.subject.slice(0, 80)}" → ${args.to}`
          : `NOT sent (email provider not configured) "${args.subject.slice(0, 80)}" → ${args.to}`,
        payload: {
          to: args.to,
          subject: args.subject,
          bodyPreview: args.body.slice(0, 240),
          messageId: id,
        },
      },
    })
    .catch((auditErr) => {
      log.warn("audit_write_failed", {
        error:
          auditErr instanceof Error ? auditErr.message : String(auditErr),
      });
    });

  return { ok: delivered, id, skipped: !delivered };
}
