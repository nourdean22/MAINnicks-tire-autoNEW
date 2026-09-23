/**
 * POST /api/webhooks/railway/<token> — Railway project webhook receiver.
 *
 * Pages the owner on Telegram when a deploy FAILS or CRASHES (and on volume /
 * CPU / RAM monitor alerts), once per (deployment, status). Logic and the why
 * live in lib/services/railway-deploy-alert.ts.
 *
 * Auth: Railway webhooks are unsigned, so the path token IS the auth. It is
 * compared timing-safe against RAILWAY_WEBHOOK_TOKEN; unset, too short or
 * wrong -> 404, indistinguishable from a route that does not exist. The token
 * is never logged. Public under the /api/webhooks prefix
 * (lib/security/route-policy.ts) — this handler runs its own auth.
 *
 * Dormant until the operator sets RAILWAY_WEBHOOK_TOKEN and points a Railway
 * project webhook at https://bdnick.info/api/webhooks/railway/<token>.
 */
import { NextResponse } from "next/server";
import { classifyRailwayEvent, pageOnce, verifyRailwayWebhookRequest } from "@/lib/services/railway-deploy-alert";

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(req: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!verifyRailwayWebhookRequest(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "payload too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const c = classifyRailwayEvent(body, raw);
  if (c.action === "ignore") {
    return NextResponse.json({ ok: true, action: "ignored", reason: c.reason });
  }

  const outcome = await pageOnce(c);
  // Undelivered -> non-2xx so Railway retries (up to 3x); the claim settled
  // FAILED, so the retry is allowed to page.
  return NextResponse.json({ ok: outcome !== "undelivered", action: outcome }, { status: outcome === "undelivered" ? 502 : 200 });
}
