/**
 * PHASE 3 PROVER - runs the publish path end to end and HALTS immediately before
 * the Instagram API call. It makes NO POST request. Ever.
 *
 * Social publishing is on the operator's protected-operations list, and this
 * path has completed end to end only a handful of times, so its first run after
 * a fix gets watched rather than fired blind. This script shows exactly what
 * WOULD be sent so the operator can authorize the real post from evidence.
 *
 * Reads: reel_jobs (SELECT only). Writes: nothing.
 *
 * Run: railway run --service MAINnicks-tire-auto -- node scripts/reel-publish-dryrun.mjs
 */
import mysql from "mysql2/promise";
import { disclosureViolation, requiredPublishParams } from "../shared/reelDisclosure.ts";

const GRAPH_VERSION = "v21.0";
const conn = await mysql.createConnection(process.env.DATABASE_URL);

// The exact job the drain fix would pick: oldest assembled job with an mp4.
const [rows] = await conn.query(
  "SELECT id, briefId, status, mp4Url, caption, payload, createdAt FROM reel_jobs " +
    "WHERE status='assembled' AND mp4Url IS NOT NULL AND mp4Url <> '' ORDER BY id ASC LIMIT 1",
);
if (!rows.length) {
  console.log("No assembled job with an mp4 - nothing to drain.");
  await conn.end();
  process.exit(0);
}
const job = rows[0];

let provider = null;
try {
  const p = JSON.parse(job.payload);
  provider = p?.videoProvider ?? p?.provider ?? process.env.REEL_VIDEO_PROVIDER ?? null;
} catch {
  provider = process.env.REEL_VIDEO_PROVIDER ?? null;
}

const caption = job.caption ?? "";

console.log("=".repeat(72));
console.log("PHASE 3 - PUBLISH DRY RUN. NOTHING IS SENT.");
console.log("=".repeat(72));
console.log(`\n[1] JOB SELECTED BY THE DRAIN FIX`);
console.log(`    id          : ${job.id}`);
console.log(`    briefId     : ${job.briefId}   <- NOT today's briefId; this is the orphaned backlog`);
console.log(`    status      : ${job.status}`);
console.log(`    createdAt   : ${new Date(job.createdAt).toISOString()}`);

console.log(`\n[2] RENDERED ARTIFACT`);
console.log(`    mp4Url      : ${job.mp4Url}`);
try {
  const head = await fetch(job.mp4Url, { method: "HEAD", signal: AbortSignal.timeout(15000) });
  console.log(`    reachable   : HTTP ${head.status} ${head.ok ? "OK" : "FAIL"}`);
  console.log(`    type/size   : ${head.headers.get("content-type") ?? "?"} / ${head.headers.get("content-length") ?? "?"} bytes`);
} catch (e) {
  console.log(`    reachable   : FETCH FAILED (${e?.name}) - publish would fail here`);
}

console.log(`\n[3] DISCLOSURE GATE`);
// The publish path MUST send Meta's structured self-disclosure for generated
// video (is_ai_generated). Verified against Meta's own docs 2026-08-28 - caption
// text is not the platform mechanism.
const packFacts = { id: `reel-job-${job.id}`, videoProvider: provider, copy: caption };
const required = requiredPublishParams(packFacts);
const violation = disclosureViolation({ ...packFacts, apiDisclosureFlag: required.is_ai_generated === true });
console.log(`    provider    : ${provider ?? "(unknown)"}`);
console.log(`    required    : ${JSON.stringify(required)}  <- must be on the container`);
console.log(`    verdict     : ${violation ? "BLOCKED" : "PASS"}`);
if (violation) console.log(`    reason      : ${violation}`);

console.log(`\n[4] CAPTION AS IT WOULD PUBLISH`);
console.log("    " + "-".repeat(66));
for (const line of caption.split("\n")) console.log("    " + line);
console.log("    " + "-".repeat(66));

console.log(`\n[5] THE EXACT REQUEST THAT WOULD BE SENT (NOT SENT)`);
const igUserId = process.env.META_IG_USER_ID || process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || "<IG_USER_ID>";
console.log(`    STEP 1  POST https://graph.facebook.com/${GRAPH_VERSION}/${igUserId}/media`);
console.log(
  "            body: " +
    JSON.stringify(
      { media_type: "REELS", video_url: job.mp4Url, caption, ...required, share_to_feed: true, access_token: "<REDACTED>" },
      null,
      2,
    )
      .split("\n")
      .join("\n            "),
);
console.log(`\n    STEP 2  POST https://graph.facebook.com/${GRAPH_VERSION}/${igUserId}/media_publish`);
console.log(`            body: { "creation_id": "<from step 1>", "access_token": "<REDACTED>" }`);

console.log(`\n[6] HALT`);
console.log("    No request was sent. Publishing is an operator-authorized action.");
console.log(`    Gate verdict: ${violation ? "WOULD BE BLOCKED before any API call." : "would proceed on operator authorization."}`);

await conn.end();
