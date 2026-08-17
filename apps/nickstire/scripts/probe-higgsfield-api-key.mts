/**
 * probe-higgsfield-api-key.mts · READ-ONLY, ZERO SPEND (2026-08-17)
 *
 * Answers one question: does the Higgsfield API KEY work? No generation, no
 * credit spend, no publish, no DB write. It looks up a request id that cannot
 * exist, so the server's own reply tells us whether the key authenticated:
 *
 *   404       -> the key WORKS (request was authenticated and processed)
 *   401/403   -> the key is REJECTED (wrong or revoked)
 *   anything  -> UNKNOWN, reported as such and never as a clean bill
 *
 * WHY THIS FILE EXISTS. `probeHiggsfieldApiCredentials()` shipped with ZERO
 * callers — exported, documented in the runbook as "the intended first step", and
 * reachable only by writing TypeScript by hand. That is the same
 * built-tested-unwired defect this arc has now found four times (the reel
 * shadow-judge readout, `higgsfieldSessionHealth`, `buildDraftWorkspace`, and
 * then my own probe). A safety check you cannot run is not a safety check.
 *
 * Run it BEFORE letting the API lane near a real reel — it is the cheapest
 * possible way to learn that the documented wire shape has drifted.
 *
 * PRECISELY WHAT IS PROVEN. The base URL and auth scheme are VERIFIED LIVE: run
 * with a deliberately bogus key, this returned a real HTTP 401 from
 * platform.higgsfield.ai — not a connection error, not a 404 — and a 401 is
 * something the server can only answer after parsing
 * `Authorization: Key <id>:<secret>` and routing the request. GENERATION is still
 * unverified: the submit body, DoP endpoint path, polling shape and result URL
 * field come from docs.higgsfield.ai and the official Node SDK, tested against a
 * mocked `fetch`. Exercising those spends credits and is the operator's call.
 *
 * Usage — locally, with the two vars exported:
 *   HIGGSFIELD_API_KEY_ID=... HIGGSFIELD_API_KEY_SECRET=... pnpm exec tsx scripts/probe-higgsfield-api-key.mts
 *
 * Usage — against prod's env (no DB access needed; this touches no database):
 *   railway run --service MAINnicks-tire-auto -- pnpm exec tsx scripts/probe-higgsfield-api-key.mts
 */
const { probeHiggsfieldApiCredentials, higgsfieldApiCredentialsFromEnv } = await import(
  "../server/services/higgsfieldApiClient"
);

const creds = higgsfieldApiCredentialsFromEnv();

console.log("\n── Higgsfield API key ──");
if (!creds) {
  console.log("  configured: NO");
  console.log("    HIGGSFIELD_API_KEY_ID / HIGGSFIELD_API_KEY_SECRET — both are required,");
  console.log("    and a whitespace-only value counts as unset.");
  console.log("\nVERDICT: the API lane is INERT. generateReelClipVideo will use the CLI");
  console.log("session lane, which is the one that expires (runbook section 1).");
  console.log("Get a key at cloud.higgsfield.ai -> API section. See runbook section 6.\n");
} else {
  // Never print the secret, or its length — a length is a hint. Only the id's shape.
  console.log(`  configured: YES  (key id ends ...${creds.keyId.slice(-4)})`);
  console.log("  probing platform.higgsfield.ai — no generation, no credits\n");

  const r = await probeHiggsfieldApiCredentials(creds);

  if (r.healthy === true) {
    console.log("  key: WORKS");
    console.log(`  detail: ${r.reason}`);
    console.log("\nVERDICT: the API lane will be PREFERRED by generateReelClipVideo.");
    console.log("It has no session to expire, so the four-day-outage failure mode cannot");
    console.log("recur on this lane. Still unproven for GENERATION — this call only proves");
    console.log("auth, exactly as veoCredentialsPresent() proves presence and not quota.");
  } else if (r.healthy === false) {
    console.log("  key: REJECTED");
    console.log(`  detail: ${r.reason}`);
    console.log("\nVERDICT: fix the key before relying on this lane. generateReelClipVideo");
    console.log("reports a first-call 401/403 immediately instead of silently falling back,");
    console.log("so a wrong key surfaces rather than hiding behind the CLI lane.");
  } else {
    console.log("  key: UNKNOWN");
    console.log(`  detail: ${r.reason}`);
    console.log("\nVERDICT: cannot tell — treated as UNKNOWN, never as a clean bill. A");
    console.log("transport blip and a dead key are different faults; re-run before");
    console.log("concluding anything, and do NOT rotate a key on this result alone.");
  }
  console.log("");
}

// NO FORCED EXIT ANYWHERE, unlike the sibling probes — they terminate the process
// explicitly because a mysql pool holds the event loop open, and this probe opens
// no DB. Terminating while undici's socket is still closing crashes on Windows
// with libuv's `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` — observed
// on this script's very first run. The exit code was still 0, so it was pure noise
// printed directly under a verdict line, which reads as a crash to an operator.
//
// (Worded without the literal API name on purpose: the test that pins this rule
// greps the source, and naming the forbidden call in prose is how a scan
// assertion ends up matching its own explanatory comment — a mistake this session
// has now made four separate times.)
process.exitCode = 0;
