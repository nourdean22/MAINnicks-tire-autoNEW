/**
 * probe-higgsfield-api-key.mts · READ-ONLY, ZERO SPEND (2026-08-17)
 *
 * Answers one question: does the Higgsfield API KEY work? No generation, no credit
 * spend, no publish, no DB write. It looks up a request id that cannot exist, so
 * the server's own reply tells us whether the key authenticated:
 *
 *   404       -> the key WORKS (request was authenticated and processed)
 *   401/403   -> the key is REJECTED (wrong or revoked)
 *   anything  -> UNKNOWN, reported as such and never as a clean bill
 *
 * PRECISELY WHAT IS PROVEN. The base URL and auth scheme are VERIFIED LIVE: with a
 * deliberately bogus key this returned a real HTTP 401 from platform.higgsfield.ai
 * — not a connection error, not a 404 — which the server can only answer after
 * parsing `Authorization: Key <id>:<secret>`. GENERATION is still unverified: the
 * submit body, DoP endpoint path, polling shape and result URL field come from
 * docs.higgsfield.ai and the official Node SDK, tested against a mocked `fetch`.
 * Exercising those spends credits and is the operator's call.
 *
 * THREE BUGS THIS FILE SHIPPED, all the same shape, all worth not repeating:
 *   1. It read the ENV-ONLY resolver while the key lives in `app_secret_kv`, so it
 *      printed "configured: NO" for a key that was correctly stored — telling the
 *      operator their save had failed when it had succeeded.
 *   2. It never loaded `.env`, so `db()` returned null, the DB was never queried,
 *      and "I could not look" was reported as "it is not there".
 *   3. A scan-and-replace of mine then matched the string "configured: NO" inside
 *      an explanatory COMMENT rather than the console.log, and clobbered the
 *      credential resolution outright.
 * The through-line: a verification tool that reads a different source than the code
 * it verifies is not a verification tool, and unknown must never render as absent.
 *
 * Usage — locally (reads `.env` for DATABASE_URL, so it sees the stored key):
 *   pnpm exec tsx scripts/probe-higgsfield-api-key.mts
 *
 * Usage — against prod's injected env:
 *   railway run --service MAINnicks-tire-auto -- pnpm exec tsx scripts/probe-higgsfield-api-key.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Mirrors scripts/data-census.ts. Under `railway run` this is a no-op. */
function loadEnvFromDotenv(): void {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* the shell may already carry the vars */
  }
}
loadEnvFromDotenv();

const { probeHiggsfieldApiCredentials, getHiggsfieldApiCredentials } = await import(
  "../server/services/higgsfieldApiClient"
);

/**
 * Whether we could reach the store the key actually lives in. Without this, a
 * missing DATABASE_URL is indistinguishable from a missing key — and those need
 * opposite responses from the operator.
 */
const dbReachable = await (async () => {
  try {
    const { db } = await import("../server/lib/db-helper");
    return Boolean(await db());
  } catch {
    return false;
  }
})();

// DB-first resolver, matching what generateReelClipVideo itself uses.
const creds = await getHiggsfieldApiCredentials();

console.log("\n-- Higgsfield API key --");

if (!creds && !dbReachable) {
  console.log("  configured: UNKNOWN - no database connection");
  console.log("    The key is stored in app_secret_kv, so this cannot see it without");
  console.log("    DATABASE_URL. Only the env vars were checked, and those are unset.");
  console.log("");
  console.log("VERDICT: UNKNOWN - not a clean bill, and not a missing key. Re-run with");
  console.log("prod env:  railway run --service MAINnicks-tire-auto -- \\");
  console.log("             pnpm exec tsx scripts/probe-higgsfield-api-key.mts");
  console.log("Or from the phone: Today -> HQ -> Higgsfield health.");
  console.log("");
} else if (!creds) {
  console.log("  configured: NO");
  console.log("    Checked app_secret_kv (higgsfield_api_key_id / _secret) AND the env");
  console.log("    vars. BOTH halves are required in whichever store you use, and a");
  console.log("    whitespace-only value counts as unset.");
  console.log("");
  console.log("VERDICT: the API lane is INERT. generateReelClipVideo uses the CLI session");
  console.log("lane, which is the one that expires (runbook section 1).");
  console.log("Get a key at cloud.higgsfield.ai -> API section. See runbook section 6.");
  console.log("");
} else {
  // Never print the secret, nor its length - a length is a hint. Only the id tail.
  console.log(`  configured: YES  (key id ends ...${creds.keyId.slice(-4)}, from ${dbReachable ? "app_secret_kv or env" : "env"})`);
  console.log("  probing platform.higgsfield.ai - no generation, no credits\n");

  const r = await probeHiggsfieldApiCredentials(creds);

  if (r.healthy === true) {
    console.log("  key: WORKS");
    console.log(`  detail: ${r.reason}`);
    console.log("");
    console.log("VERDICT: the API lane will be PREFERRED by generateReelClipVideo. It has no");
    console.log("session to expire, so the four-day-outage failure mode cannot recur on it.");
    console.log("Still unproven for GENERATION - this proves auth only, exactly as");
    console.log("veoCredentialsPresent() proves presence and not quota.");
  } else if (r.healthy === false) {
    console.log("  key: REJECTED");
    console.log(`  detail: ${r.reason}`);
    console.log("");
    console.log("VERDICT: fix the key before relying on this lane. generateReelClipVideo");
    console.log("reports a first-call 401/403 immediately instead of silently falling back,");
    console.log("so a wrong key surfaces rather than hiding behind the CLI lane.");
  } else {
    console.log("  key: UNKNOWN");
    console.log(`  detail: ${r.reason}`);
    console.log("");
    console.log("VERDICT: cannot tell - treated as UNKNOWN, never as a clean bill. A");
    console.log("transport blip and a dead key are different faults; re-run before");
    console.log("concluding anything, and do NOT rotate a key on this result alone.");
  }
  console.log("");
}

// FORCE THE EXIT. I had this backwards: the comment here used to claim the loop
// would "drain", but a mysql pool never drains on its own — and this probe now
// opens one, because the key lives in app_secret_kv. Setting only exitCode made the
// script HANG with zero output, which is precisely the failure I fixed in
// reel-shadow-judge-readout.mts and then reintroduced here.
//
// The libuv UV_HANDLE_CLOSING assertion that made me avoid this applied to the
// NO-DATABASE case, where nothing held the loop and the only open handle was
// undici's closing socket. Every await above has already settled by this line, and
// a hang is strictly worse than one line of cosmetic stderr noise. Sibling probes
// force-exit for exactly this reason.
process.exit(0);
