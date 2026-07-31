/**
 * probe-veo-generate.ts · Veo liveness probe (2026-07-31)
 *
 * Answers "can prod generate reel clips on Veo TODAY?" by calling the REAL
 * exported production functions (submitVeoRequest / pollVeoOperation), not a
 * reimplementation — so a pass here is evidence about the code that ships.
 *
 * WHY THIS EXISTS: veoCredentialsPresent() is presence-only by design, and a
 * key that can list models is NOT proof it is billed for video generation. The
 * Higgsfield outage was exactly this class of mistake (a credential that looked
 * fine to every check we had). Only an ACCEPTED predictLongRunning operation
 * proves auth + model name + video quota together.
 *
 * SAFETY
 *  · Default run is FREE: metadata only (models list + probeVeoConnection).
 *  · --apply submits ONE real generation and COSTS MONEY. Veo bills on submit;
 *    an accepted operation cannot be cancelled.
 *  · Never prints key material.
 *
 * Usage (env must be prod's — read it from Railway, do not hardcode):
 *   pnpm exec tsx scripts/probe-veo-generate.ts            # free
 *   pnpm exec tsx scripts/probe-veo-generate.ts --apply    # spends
 *
 * NOTE: veoStudio.ts reads REEL_VEO_MODEL at MODULE LOAD, so the env must be
 * set before import — hence the dynamic import below.
 */
const FULL = process.argv.includes("--full");
const APPLY = FULL || process.argv.includes("--apply");
const model = process.env.REEL_VEO_MODEL || "(code default)";

console.log(`\nmodel under test : ${model}`);
console.log(`auth             : ${process.env.GEMINI_API_KEY ? "GEMINI_API_KEY" : "service account"}`);
console.log(`mode             : ${FULL ? "FULL — submit + poll + download + rehost (billable)" : APPLY ? "APPLY — submit + poll only (billable)" : "FREE (metadata only)"}`);
// The rehost half is what a submit-only probe never reaches, and it fails for
// reasons Veo cannot cause: with no S3_BUCKET, storagePut silently degrades to
// LOCAL DISK and returns a url prod could never fetch — a green run that proves
// nothing about production. Name the backend so a pass is unambiguous.
console.log(`storage backend  : ${process.env.S3_BUCKET ? `S3 bucket ${process.env.S3_BUCKET}` : "LOCAL DISK — no S3_BUCKET; run under `railway run` for the real path"}\n`);

const { probeVeoConnection, submitVeoRequest, pollVeoOperation, generateReelClipVideo } =
  await import("../server/services/veoStudio");

const probe = await probeVeoConnection();
console.log(`probeVeoConnection: ${probe.success ? "OK" : `FAIL — ${probe.error}`}`);
if (!probe.success) {
  console.log("\nmodel is not reachable with these credentials — fix REEL_VEO_MODEL before flipping the provider.\n");
  process.exit(1);
}

if (!APPLY) {
  console.log("\nFREE probe passed: credentials authenticate and the model resolves.");
  console.log("This does NOT prove video quota. Re-run with --apply to submit one real clip.\n");
  process.exit(0);
}

// A prompt matching the real product doctrine: real objects, no people.
const prompt =
  "Close-up cinematic shot of a new all-season tire tread rotating slowly on a clean " +
  "auto shop floor, shallow depth of field, warm garage lighting, no people.";

if (FULL) {
  // generateReelClipVideo is the exact drop-in reelPipeline calls, so this
  // exercises every step prod depends on — including download + the 50KB
  // min-size guard + storagePut — not just the Veo API half.
  console.log("\nrunning the FULL production path via generateReelClipVideo() (billable)...");
  const t0 = Date.now();
  const publicUrl = await generateReelClipVideo(prompt);
  console.log(`\nCLIP URL: ${publicUrl}`);

  // A url the pipeline cannot fetch is not a working clip. Verify it resolves
  // and carries real bytes, the way the assembler will.
  const head = await fetch(publicUrl, { method: "GET", headers: { Range: "bytes=0-262143" } });
  const bytes = head.ok ? (await head.arrayBuffer()).byteLength : 0;
  console.log(`fetch check: HTTP ${head.status} · content-type=${head.headers.get("content-type")} · first-chunk=${bytes} bytes`);
  console.log(`elapsed: ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`\n${head.ok && bytes > 0 ? "PASS — Veo produced a fetchable hosted clip end to end." : "FAIL — clip generated but the hosted url is not fetchable."}\n`);
  process.exit(head.ok && bytes > 0 ? 0 : 1);
}

console.log("\nsubmitting ONE real generation (billable)...");
const opName = await submitVeoRequest(prompt);
console.log(`ACCEPTED — operation: ${opName}`);
console.log("  ^ this alone proves auth + model name + video quota are all valid.\n");

console.log("polling to completion (up to the module's deadline)...");
const videoUri = await pollVeoOperation(opName);
console.log(`\nCOMPLETED — video uri: ${String(videoUri).slice(0, 120)}...`);
console.log("\nVeo API half works. Re-run with --full to prove download + rehost too.\n");
