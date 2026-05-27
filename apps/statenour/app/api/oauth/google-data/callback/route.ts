import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { exchangeCodeForToken } from "@/lib/services/google-oauth";
import { computeHealthDigest, persistHealthDigest } from "@/lib/system/health-digest";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("oauth/google-data/callback");

/**
 * GET /api/oauth/google-data/callback
 *
 * Receives the auth code from Google after the user approves the
 * consent screen at /api/oauth/google-data/start. Exchanges the
 * code for a refresh_token + access_token and stores the refresh
 * token in the Integration table under name "google_oauth".
 *
 * After this completes once, the Gmail/Drive/Calendar cron jobs
 * run headlessly forever (or until the user revokes the grant).
 *
 * Returns an HTML page confirming the grant — no JSON response
 * because this is a browser redirect target.
 *
 * v10.0.529 S-2 fix · validate CSRF state against the cookie minted
 * in /start before exchanging the code. Same-length + timing-safe
 * comparison. Cookie deleted after the match so a stale state can't
 * be reused.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const providedState = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(
      errorPage(`Google denied the grant: ${error}`),
      { status: 400, headers: { "Content-Type": "text/html" } },
    );
  }

  if (!code) {
    return new Response(errorPage("No auth code received from Google"), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  // v10.0.529 S-2 fix · timing-safe state check.
  const cookieStore = await cookies();
  const storedState = cookieStore.get("__oauth_state")?.value;
  if (!storedState || !providedState) {
    log.warn("oauth_state_missing", {
      hasStored: Boolean(storedState),
      hasProvided: Boolean(providedState),
    });
    return new Response(
      errorPage(
        "OAuth state cookie missing or expired. Restart the flow from /api/oauth/google-data/start.",
      ),
      { status: 400, headers: { "Content-Type": "text/html" } },
    );
  }
  const a = Buffer.from(storedState);
  const b = Buffer.from(providedState);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    log.error("oauth_state_mismatch", {
      // Don't log the actual values — log only lengths so we can spot
      // a "wrong cookie present" vs "truncated callback URL" without
      // leaking the CSRF token itself.
      storedLen: a.length,
      providedLen: b.length,
    });
    return new Response(
      errorPage(
        "OAuth state mismatch · possible CSRF or stale link. Restart the flow from /api/oauth/google-data/start.",
      ),
      { status: 400, headers: { "Content-Type": "text/html" } },
    );
  }
  // Single-use · clear before exchange so a refresh can't replay.
  cookieStore.delete("__oauth_state");

  // 2026-05-27 · multi-account · state shape is `<csrf>:<accountKey>`.
  // Pre-2026-05-27 state was just the CSRF (no colon) so we tolerate
  // the legacy shape gracefully — treat colon-less state as primary.
  const accountKey = providedState.includes(":")
    ? (providedState.split(":")[1] || "primary").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || "primary"
    : "primary";

  try {
    const result = await exchangeCodeForToken(code, accountKey);
    // Apr 27 — once the refresh token lands, force a fresh health
    // digest. Without this, the persisted digest from earlier in the
    // day (which says "Google OAuth not configured") keeps rendering
    // on HQ until the next nightly cron — a confusing 12+ hour gap
    // between the user fixing the problem and the warning clearing.
    // Fire-and-forget — the OAuth response should still land if the
    // recompute fails, since the actual fix is already saved.
    void computeHealthDigest()
      .then((fresh) => persistHealthDigest(fresh))
      .catch((digestErr) => {
        // next page load's GET will recompute anyway once the persisted
        // row crosses the 4h staleness line — log so a persistent fail
        // surfaces during prod debugging instead of staying invisible.
        log.warn("health_digest_recompute_failed", {
          err:
            digestErr instanceof Error
              ? digestErr.message.slice(0, 200)
              : String(digestErr),
        });
      });
    return new Response(successPage(result.email || "(unknown)", result.integrationName), {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  } catch (err) {
    log.error("oauth_callback_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return new Response(errorPage((err as Error).message), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }
}

function successPage(email: string, integrationName: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Google OAuth — Connected</title>
<style>
  body { background: #0a0a0a; color: #e4e4e7; font-family: system-ui, -apple-system, sans-serif; padding: 40px 20px; max-width: 560px; margin: 0 auto; }
  h1 { color: #fdb913; font-size: 20px; text-transform: uppercase; letter-spacing: 0.18em; }
  p { line-height: 1.6; color: #a1a1aa; font-size: 14px; }
  .box { background: #111; border: 1px solid #fdb91340; border-left: 3px solid #fdb913; padding: 16px; border-radius: 8px; margin: 20px 0; }
  code { background: #18181b; padding: 2px 6px; border-radius: 4px; color: #fdb913; font-size: 13px; }
  a { color: #fdb913; text-decoration: none; }
</style>
</head>
<body>
<h1>✓ Google Connected</h1>
<div class="box">
  <p><strong>Account:</strong> ${escapeHtml(email)}</p>
  <p><strong>Scopes:</strong> Gmail (read), Calendar (read), Drive (read)</p>
  <p><strong>Stored:</strong> Integration table as <code>${escapeHtml(integrationName)}</code></p>
</div>
<p>Gmail, Calendar, and Drive ingest crons will now run headlessly on their schedule. You can trigger them immediately from the Nick chat by saying <code>sync my gmail</code>, <code>sync my calendar</code>, or <code>sync my drive</code>.</p>
<p><strong>Want to add another account?</strong> Visit <code>/api/oauth/google-data/start?account=personal</code> (or any label) and sign in with the second Gmail. Each label gets its own slot.</p>
<p><a href="/">← Back to HQ</a></p>
</body>
</html>`;
}

// v10.0.529.2 T-3 fix · proper HTML escape (was `.replace(/</g, "&lt;")`
// only · allowed `>` and quote chars to break out of the <p> context).
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\//g, "&#x2F;");
}

function errorPage(msg: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Google OAuth — Error</title>
<style>
  body { background: #0a0a0a; color: #e4e4e7; font-family: system-ui, -apple-system, sans-serif; padding: 40px 20px; max-width: 560px; margin: 0 auto; }
  h1 { color: #ef4444; font-size: 20px; text-transform: uppercase; letter-spacing: 0.18em; }
  p { line-height: 1.6; color: #a1a1aa; font-size: 14px; }
  .box { background: #111; border: 1px solid #ef444440; border-left: 3px solid #ef4444; padding: 16px; border-radius: 8px; margin: 20px 0; }
  code { background: #18181b; padding: 2px 6px; border-radius: 4px; color: #fdb913; font-size: 13px; }
  a { color: #fdb913; text-decoration: none; }
</style>
</head>
<body>
<h1>✗ OAuth Failed</h1>
<div class="box">
  <p>${escapeHtml(msg)}</p>
</div>
<p>Common fixes:</p>
<ul>
  <li>Add <code>gmail.readonly</code>, <code>drive.readonly</code>, <code>calendar.readonly</code> scopes to your OAuth consent screen in <a href="https://console.cloud.google.com/apis/credentials/consent" target="_blank">Google Cloud Console</a></li>
  <li>Revoke the existing grant at <a href="https://myaccount.google.com/permissions" target="_blank">myaccount.google.com/permissions</a> and retry</li>
  <li>Make sure <code>AUTH_GOOGLE_CLIENT_ID</code> + <code>AUTH_GOOGLE_CLIENT_SECRET</code> are set in Vercel env vars</li>
</ul>
<p><a href="/api/oauth/google-data/start">← Try again</a></p>
</body>
</html>`;
}
