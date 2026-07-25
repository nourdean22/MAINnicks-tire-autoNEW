#!/usr/bin/env node
/**
 * smoke-prod · post-deploy verification for statenour-web-production
 *
 * Fetch-based smoke test · zero deps · catches "deploy is broken"
 * vs "deploy is fine but I'm not logged in".
 *
 * What it verifies:
 *   1. GET /                       → 200 (or an auth redirect — the middleware
 *                                    itself working IS the healthy signal here)
 *   2. GET /api/system/heartbeat   → 200 STRICT (Railway healthcheck endpoint —
 *                                    a redirect here means the endpoint is
 *                                    broken or shadowed, never "healthy")
 *   3. GET /auth/sign-in           → 200 STRICT (auth wall accessible)
 *   4. GET /api/system/deploy-info → deploy identity. The endpoint sits
 *                                    BEHIND the session wall (middleware
 *                                    public-route policy, truth-substrate
 *                                    P0 2026-07-21), so unauthenticated a
 *                                    401 counts as "alive behind the wall".
 *                                    Set SMOKE_SESSION_COOKIE (an operator
 *                                    session cookie) to read the real SHA;
 *                                    with --expect-sha=<sha> the run FAILS
 *                                    unless the deployed SHA matches
 *                                    (prefix match, so a short SHA works).
 *                                    --expect-sha without a cookie is a
 *                                    hard failure — an assertion that
 *                                    cannot be evaluated must not pass.
 *   5. No 5xx server errors
 *
 * 2026-07-25 hardening (quality-pass audit):
 *   - Default URL is now the REAL production domain https://bdnick.info —
 *     previously it hit the Railway-generated *.up.railway.app domain, so
 *     the custom-domain + cert path was never exercised by "deploy is
 *     healthy". (Not the *.railway.internal private network — that is a
 *     different thing this script never touched and cannot reach.)
 *   - 3xx is acceptable ONLY on "/" (auth-walled page). It previously
 *     counted as healthy on EVERY check, including the heartbeat.
 *   - Deploy identity: /api/system/deploy-info is auth-walled (see item 4);
 *     401-no-cookie passes as alive-behind-wall, and SMOKE_SESSION_COOKIE
 *     + --expect-sha turns it into a hard SHA assertion.
 *
 * What it does NOT verify:
 *   - Authenticated UI (would need an operator session cookie · use the
 *     Playwright smoke at tests/e2e for that)
 *   - Cross-browser rendering
 *
 * Usage:
 *   pnpm --filter @statenour/web smoke:prod
 *   pnpm --filter @statenour/web smoke:prod --url=http://localhost:3001
 *   pnpm --filter @statenour/web smoke:prod --expect-sha=$(git rev-parse HEAD)
 *
 * Exit codes:
 *   0 · all checks pass
 *   1 · any check failed (use in CI / post-deploy verification)
 *
 * Added 2026-05-19 (playwright-skill follow-up · after the wave-181.92
 * fetch-timeout sweep landed). Hardened 2026-07-25.
 */

const PROD_URL = process.argv
  .find((arg) => arg.startsWith("--url="))
  ?.slice("--url=".length) ?? "https://bdnick.info";

const EXPECT_SHA = process.argv
  .find((arg) => arg.startsWith("--expect-sha="))
  ?.slice("--expect-sha=".length) ?? null;

const TIMEOUT_MS = 15_000;

/**
 * @param {string} path
 * @param {{ allowAuthRedirect?: boolean }} [opts] — 3xx counts as healthy
 *   ONLY when explicitly allowed (auth-walled page routes). API endpoints
 *   must answer 200 themselves.
 */
async function check(path, opts = {}) {
  const { allowAuthRedirect = false } = opts;
  const url = `${PROD_URL}${path}`;
  const start = Date.now();
  try {
    const resp = await fetch(url, {
      method: "GET",
      redirect: "manual", // see auth redirects explicitly · don't follow blindly
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - start;
    // Release the socket promptly · an unconsumed response body keeps the
    // underlying connection dangling. We only need the status line.
    if (resp.body) await resp.body.cancel().catch(() => {});
    const isAuthRedirect = resp.status >= 300 && resp.status < 400;
    const acceptable =
      resp.status === 200 || (allowAuthRedirect && isAuthRedirect);
    const symbol = acceptable ? "✅" : "❌";
    console.log(
      `  ${symbol} ${path.padEnd(28)} → HTTP ${resp.status} · ${ms}ms${
        acceptable && isAuthRedirect ? " (auth redirect · OK)" : ""
      }`,
    );
    return acceptable;
  } catch (err) {
    const ms = Date.now() - start;
    console.log(`  ❌ ${path.padEnd(28)} → THREW · ${ms}ms · ${err.message}`);
    return false;
  }
}

/**
 * Deploy identity check — /api/system/deploy-info sits behind the NextAuth
 * session wall (it is NOT in lib/security/route-policy.ts PUBLIC_EXACT).
 * Unauthenticated, a 401 therefore proves the endpoint is alive behind the
 * wall — pass, but the SHA stays unverified. Provide SMOKE_SESSION_COOKIE
 * to read the identity; --expect-sha then becomes a hard assertion.
 */
async function checkDeployIdentity() {
  const path = "/api/system/deploy-info";
  const cookie = process.env.SMOKE_SESSION_COOKIE ?? null;
  const start = Date.now();
  try {
    const resp = await fetch(`${PROD_URL}${path}`, {
      method: "GET",
      redirect: "manual",
      headers: cookie ? { cookie } : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - start;
    const authWalled =
      resp.status === 401 || (resp.status >= 300 && resp.status < 400);
    if (authWalled && !cookie) {
      if (resp.body) await resp.body.cancel().catch(() => {});
      if (EXPECT_SHA) {
        console.log(
          `  ❌ ${path.padEnd(28)} → HTTP ${resp.status} · ${ms}ms · --expect-sha given but endpoint is auth-gated — set SMOKE_SESSION_COOKIE`,
        );
        return false;
      }
      console.log(
        `  ✅ ${path.padEnd(28)} → HTTP ${resp.status} · ${ms}ms (auth-gated · alive · SHA unverified)`,
      );
      return true;
    }
    if (resp.status !== 200) {
      if (resp.body) await resp.body.cancel().catch(() => {});
      console.log(`  ❌ ${path.padEnd(28)} → HTTP ${resp.status} · ${ms}ms`);
      return false;
    }
    const body = await resp.json().catch(() => null);
    const info = body?.data ?? null;
    if (!info || typeof info.sha !== "string") {
      console.log(`  ❌ ${path.padEnd(28)} → 200 but malformed body · ${ms}ms`);
      return false;
    }
    const identity = `sha=${info.shaShort ?? info.sha} branch=${info.branch} env=${info.env}`;
    if (EXPECT_SHA) {
      const matches =
        info.sha.startsWith(EXPECT_SHA) || EXPECT_SHA.startsWith(info.sha);
      const symbol = matches ? "✅" : "❌";
      console.log(
        `  ${symbol} ${path.padEnd(28)} → ${identity} · ${ms}ms${
          matches ? "" : ` · EXPECTED ${EXPECT_SHA}`
        }`,
      );
      return matches;
    }
    console.log(`  ✅ ${path.padEnd(28)} → ${identity} · ${ms}ms`);
    return true;
  } catch (err) {
    const ms = Date.now() - start;
    console.log(`  ❌ ${path.padEnd(28)} → THREW · ${ms}ms · ${err.message}`);
    return false;
  }
}

console.log(`Smoke testing ${PROD_URL}${EXPECT_SHA ? ` (expect SHA ${EXPECT_SHA})` : ""}\n`);

const results = await Promise.all([
  check("/", { allowAuthRedirect: true }),
  check("/api/system/heartbeat"),
  check("/auth/sign-in"),
  checkDeployIdentity(),
]);

const allPass = results.every(Boolean);
console.log(`\n${allPass ? "✅ SMOKE PASSED · deploy is healthy" : "❌ SMOKE FAILED"}`);

// undici (the engine behind global fetch) keeps keep-alive sockets and
// internal async handles open after the requests resolve. On Windows,
// process teardown then races libuv's handle cleanup and aborts —
// `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` — leaving a
// non-zero exit code even though every check passed. Destroying undici's
// global connection pool first leaves nothing for teardown to race. The
// Symbol lookup is how undici's own getGlobalDispatcher() resolves it; if
// a runtime ever changes that, this no-ops and behaviour is unchanged.
const dispatcher = globalThis[Symbol.for("undici.globalDispatcher.1")];
if (dispatcher && typeof dispatcher.destroy === "function") {
  await dispatcher.destroy().catch(() => {});
}

process.exit(allPass ? 0 : 1);
