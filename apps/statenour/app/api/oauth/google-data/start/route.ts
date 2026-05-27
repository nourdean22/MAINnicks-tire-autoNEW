import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { buildAuthUrl } from "@/lib/services/google-oauth";
import { requireSession } from "@/lib/auth-guard";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("oauth/google-data/start");

/**
 * GET /api/oauth/google-data/start
 *
 * Kicks off the one-time Google consent flow for headless Gmail /
 * Drive / Calendar ingestion. Redirects the user to Google's consent
 * screen. After they approve, Google bounces back to
 * /api/oauth/google-data/callback with an auth code.
 *
 * This is a one-shot setup — once the refresh token is stored, the
 * cron jobs run forever without user action. If the user ever revokes
 * the grant (at myaccount.google.com/permissions), they just click
 * this URL again.
 *
 * v10.0.529 S-2 fix · cryptographic CSRF state.
 *
 * Pre-fix: state was a caller-controlled URL param or hardcoded
 * "google-data-setup" — a passing attacker who tricked the operator
 * into clicking a crafted callback URL could bind the attacker's
 * Google account to the operator's Integration row (or vice versa).
 *
 * Post-fix: we mint 32 bytes of CSPRNG state on every start, set it
 * in an HttpOnly Secure SameSite=Lax cookie scoped to the OAuth
 * routes only, and require an exact (timing-safe) match in
 * /callback. Cookie expires in 10 minutes — well within the Google
 * consent screen TTL and short enough to bound replay risk.
 */
export async function GET(req: Request) {
  try {
    // v10.0.529.2 S-3 fix · gate /start with session check. Combined
    // with S-2 (CSRF cookie) this means only the authenticated operator
    // can mint a fresh OAuth state · a passing attacker cannot prime
    // the flow with an attacker-chosen state.
    await requireSession(req);

    // 2026-05-27 · multi-account · ?account=<key> picks which slot to
    // write. Default "primary" preserves the legacy "google_oauth"
    // integration row (moeseuclid in operator's prod). "personal",
    // "business", etc. land under "google_oauth_<key>". The chosen
    // account is encoded into the OAuth state alongside the CSRF
    // random — `<csrf>:<account>` — so the callback can route the
    // exchange to the right integration row.
    const url = new URL(req.url);
    const requestedAccount = (url.searchParams.get("account") ?? "primary")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "");
    const accountKey = requestedAccount || "primary";

    const csrf = randomBytes(32).toString("hex");
    const state = `${csrf}:${accountKey}`;

    const cookieStore = await cookies();
    cookieStore.set("__oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 min · matches the consent-screen budget
      path: "/api/oauth/google-data",
    });

    const consentUrl = buildAuthUrl(state, accountKey);
    return Response.redirect(consentUrl, 302);
  } catch (err) {
    // v10.0.529 I-3 fix · do not enumerate env var names in the
    // response · log details server-side, return a generic code.
    log.error("oauth_start_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return Response.json(
      {
        error: "oauth_unavailable",
        detail:
          "Google OAuth start failed. Check the server logs for details.",
      },
      { status: 500 },
    );
  }
}
