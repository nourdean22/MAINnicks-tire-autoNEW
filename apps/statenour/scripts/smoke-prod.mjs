#!/usr/bin/env node
/**
 * smoke-prod · post-deploy verification for statenour-web-production
 *
 * Fetch-based smoke test · zero deps · catches "deploy is broken"
 * vs "deploy is fine but I'm not logged in".
 *
 * What it verifies:
 *   1. GET /                       → 200 (page loads through middleware)
 *   2. GET /api/system/heartbeat   → 200 (Railway healthcheck endpoint)
 *   3. GET /auth/sign-in           → 200 (auth wall accessible)
 *   4. No 5xx server errors
 *
 * What it does NOT verify:
 *   - Authenticated UI (would need an operator session cookie · use the
 *     Playwright smoke at ~/.claude/skills/playwright-skill for that)
 *   - Specific Wave 40 layout assertions (greeting + chip + composer)
 *   - Cross-browser rendering
 *
 * Usage:
 *   pnpm --filter @statenour/web smoke:prod
 *   pnpm --filter @statenour/web smoke:prod --url=http://localhost:3001
 *
 * Exit codes:
 *   0 · all checks pass
 *   1 · any check failed (use in CI / post-deploy verification)
 *
 * Added 2026-05-19 (playwright-skill follow-up · after the wave-181.92
 * fetch-timeout sweep landed).
 */

const PROD_URL = process.argv
  .find((arg) => arg.startsWith("--url="))
  ?.slice("--url=".length) ?? "https://statenour-web-production.up.railway.app";

const TIMEOUT_MS = 15_000;

async function check(path, expectedStatus = 200) {
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
    const pass = resp.status === expectedStatus;
    // Auth-middleware redirects (302/307) on / are EXPECTED for unauthenticated
    // smoke runs · treat them as healthy (the middleware itself is working).
    const isAuthRedirect = resp.status >= 300 && resp.status < 400;
    const acceptable = pass || (expectedStatus === 200 && isAuthRedirect);
    const symbol = acceptable ? "✅" : "❌";
    console.log(
      `  ${symbol} ${path.padEnd(28)} → HTTP ${resp.status} · ${ms}ms${
        isAuthRedirect ? " (auth redirect · OK)" : ""
      }`,
    );
    return acceptable;
  } catch (err) {
    const ms = Date.now() - start;
    console.log(`  ❌ ${path.padEnd(28)} → THREW · ${ms}ms · ${err.message}`);
    return false;
  }
}

console.log(`Smoke testing ${PROD_URL}\n`);

const results = await Promise.all([
  check("/"),
  check("/api/system/heartbeat"),
  check("/auth/sign-in"),
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
