/**
 * POST /api/email/send · v10.0.49 · Apr 30.
 *
 * Owner-gated email send for the Nick chat draft-card flow. The
 * `composeEmail` tool returns a reviewable draft; this route is the
 * explicit-permission action triggered by the "Send" button on the
 * <EmailDraftCard /> component.
 *
 * Auth: requireSession() — only Nour, never autonomous.
 * Body:  { to: string, subject: string, body: string, html?: string }
 * Returns: { ok: true, id: string|null } on success.
 *
 * Why this is its own route + not a tool:
 *   · Tools fire from Nick autonomously during a turn. Sending email
 *     must be a deliberate, explicit-permission action — the same
 *     reason `purchases / subscriptions / sharing` are ALL gated to
 *     UI clicks per the project's safety rules.
 *   · Audit trail: each send writes an `auditEvent` so the operator
 *     can see when + to-whom Nick-drafted messages went out.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { sendEmail } from "@/lib/services/email";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { z } from "zod";

const log = rootLogger.withSurface("api/email/send");

const SendSchema = z.object({
  to: z.string().email().max(254),
  subject: z.string().min(1).max(998),
  body: z.string().min(1).max(50_000),
  html: z.string().max(120_000).optional(),
});

export async function POST(req: Request) {
  await requireSession(req);

  let payload: z.infer<typeof SendSchema>;
  try {
    const json = await req.json();
    payload = SendSchema.parse(json);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "invalid body" },
      { status: 400 },
    );
  }

  try {
    const id = await sendEmail({
      to: payload.to,
      subject: payload.subject,
      text: payload.body,
      html: payload.html,
    });

    // Audit trail — non-fatal; matches the v8.x universal audit pattern.
    await prisma.auditEvent
      .create({
        data: {
          actor: "user:email-draft-card",
          eventType: "email_sent",
          detail: `Sent "${payload.subject.slice(0, 80)}" → ${payload.to}`,
          payload: {
            to: payload.to,
            subject: payload.subject,
            // Body excerpt only; never persist the full body for privacy
            // (long-term: PII review surface flagged anything >800 chars).
            bodyPreview: payload.body.slice(0, 240),
            messageId: id,
          },
        },
      })
      .catch((auditErr) => {
        log.warn("audit_write_failed", {
          error: auditErr instanceof Error ? auditErr.message : String(auditErr),
        });
      });

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "send failed";
    log.error("send_failed", { error: message, to: payload.to });
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
