/**
 * GET /api/oauth/google-data/status — rich Google OAuth health probe.
 *
 * The system-health card on Ultron used to flag every "not healthy"
 * state as "OAuth expired" because the underlying check was a binary
 * isGoogleOauthConfigured(). Reality has at least four states:
 *
 *   - missing  : never granted (admin needs to click /start)
 *   - expired  : granted but Google rejected the refresh token
 *                (revoked, password reset, 6-month inactivity, etc.)
 *   - stale    : granted, refreshes still work, but ingest crons
 *                haven't written in 7+ days (cron drift)
 *   - healthy  : refresh ok, recent sync
 *
 * This endpoint surfaces the rich state so /system/diagnostics + the
 * Ultron card can render an accurate headline + the right CTA.
 *
 * Sample response:
 *   {
 *     state: "expired",
 *     consecutiveFailures: 4,
 *     lastSyncAt: "2026-04-19T08:12:33.000Z",
 *     email: "nour@bdnick.info",
 *     reason: "Refresh failed 4× in a row — re-grant access",
 *     ctaLabel: "Re-grant access",
 *     ctaHref: "/api/oauth/google-data/start"
 *   }
 */

import { NextResponse } from "next/server";
import { getGoogleOauthStatus } from "@/lib/services/google-oauth";

export async function GET() {
  const status = await getGoogleOauthStatus().catch(() => null);
  if (!status) {
    return NextResponse.json(
      {
        state: "missing",
        reason: "Status probe failed — DB unreachable",
        ctaLabel: "Set up Google OAuth",
        ctaHref: "/api/oauth/google-data/start",
      },
      { status: 200 },
    );
  }

  // The CTA varies by state — surface it server-side so any client
  // (Ultron card, diagnostics page, future Telegram bot) doesn't have
  // to know the OAuth state machine.
  const cta = (() => {
    switch (status.state) {
      case "missing":
        return {
          ctaLabel: "Set up Google OAuth",
          ctaHref: "/api/oauth/google-data/start",
        };
      case "expired":
        return {
          ctaLabel: "Re-grant access",
          ctaHref: "/api/oauth/google-data/start",
        };
      case "stale":
        return {
          ctaLabel: "Inspect ingest crons",
          ctaHref: "/system/cron-diagnostics",
        };
      case "healthy":
        return null;
    }
  })();

  return NextResponse.json({
    state: status.state,
    lastSyncAt: status.lastSyncAt,
    consecutiveFailures: status.consecutiveFailures,
    email: status.email,
    reason: status.reason,
    ctaLabel: cta?.ctaLabel ?? null,
    ctaHref: cta?.ctaHref ?? null,
  });
}
