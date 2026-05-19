/**
 * POST /api/email/send · v10.0.49 · Apr 30.
 *
 * Owner-gated email send for the Nick chat draft-card flow. The
 * `composeEmail` tool returns a reviewable draft; this route is the
 * explicit-permission action triggered by the "Send" button on the
 * <EmailDraftCard /> component.
 *
 * Phase HH (2026-05-18 PM) · heavy lifting moved to
 * `lib/services/email-send.ts` so both this REST endpoint AND the
 * new `trpc.chat.sendEmail` mutation call the same
 * `sendEmailWithAudit()` function · drift between the two consumers
 * is structurally impossible. Stays mounted for back-compat with
 * any non-tRPC consumer (curl probes, external integrations).
 *
 * Auth: requireSession() — only Nour, never autonomous.
 * Body:  { to: string, subject: string, body: string, html?: string }
 * Returns: { ok: true, id: string|null } on success.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { sendEmailWithAudit } from "@/lib/services/email-send";
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
    return NextResponse.json(await sendEmailWithAudit(payload));
  } catch (err) {
    const message = err instanceof Error ? err.message : "send failed";
    log.error("send_failed", { error: message, to: payload.to });
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
