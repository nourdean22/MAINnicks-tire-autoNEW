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
  ok: true;
  id: string | null;
}

export async function sendEmailWithAudit(args: SendEmailArgs): Promise<SendEmailResult> {
  const id = await sendEmail({
    to: args.to,
    subject: args.subject,
    text: args.body,
    html: args.html,
  });

  // Audit trail — non-fatal · matches the v8.x universal audit pattern.
  // Body excerpt only · never persist the full body for privacy (the
  // long-term PII review surface flags anything >800 chars).
  await prisma.auditEvent
    .create({
      data: {
        actor: "user:email-draft-card",
        eventType: "email_sent",
        detail: `Sent "${args.subject.slice(0, 80)}" → ${args.to}`,
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

  return { ok: true, id };
}
