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
 * 2026-10-10 (audit 07-X4, 08-F3): owner-gated here, not only by the proxy;
 * reads EVERY Google account (the worst one wins, `accounts` lists each); a
 * failed status read answers state "unknown" with no CTA, never "missing".
 *
 * Sample response:
 *   {
 *     state: "expired",
 *     consecutiveFailures: 4,
 *     lastSyncAt: "2026-04-19T08:12:33.000Z",
 *     email: "nour@bdnick.info",
 *     reason: "personal: Refresh failed 4x in a row, re-grant access",
 *     ctaLabel: "Re-grant access",
 *     ctaHref: "/api/oauth/google-data/start?account=personal",
 *     accounts: [{ key: "primary", state: "healthy" }, { key: "personal", state: "expired" }]
 *   }
 */

import { NextResponse } from "next/server";
import { getGoogleOauthAccountsStatus } from "@/lib/services/google-oauth";
import { apiHandler } from "@/lib/utils/http";

export const GET = apiHandler(async () => {
  const status = await getGoogleOauthAccountsStatus().catch(() => null);
  if (!status || status.probeFailed) {
    // We could not ASK: a claim about our DB, not about Google. Nothing to set up or re-grant.
    return NextResponse.json({
      state: "unknown",
      probeFailed: true,
      reason: status?.reason ?? "Status probe failed - DB unreachable",
      ctaLabel: null,
      ctaHref: null,
      accounts: [],
    });
  }

  // The re-grant flow for the account the worst state belongs to.
  const key = status.accounts.find((a) => a.state === status.state)?.key;
  const start =
    key && key !== "primary" ? `/api/oauth/google-data/start?account=${encodeURIComponent(key)}` : "/api/oauth/google-data/start";

  // The CTA varies by state — surface it server-side so any client
  // (Ultron card, diagnostics page, future Telegram bot) doesn't have
  // to know the OAuth state machine.
  const cta = (() => {
    switch (status.state) {
      case "missing":
        return { ctaLabel: "Set up Google OAuth", ctaHref: start };
      case "expired":
        return { ctaLabel: "Re-grant access", ctaHref: start };
      case "stale":
        return { ctaLabel: "Inspect ingest crons", ctaHref: "/system/crons" };
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
    accounts: status.accounts,
  });
}, { auth: "owner" });
