/**
 * requeue-reel-1200003.mjs · recover a job whose clips were never actually lost
 *
 * #1200003 failed at MAX_ATTEMPTS with:
 *   ENOENT: copyfile '/app/apps/nickstire/data/generated/veo-…mp4' -> '/tmp/…'
 *
 * The assembler assumed a `/generated/` url meant a local file. It has meant an
 * S3 PROXY url since object storage landed, so it copied a path nothing wrote.
 * Fixed in f34358b6. The four clips are intact in the bucket and fetchable.
 *
 * This puts the job back in `assets_ready` so the pipeline reassembles it from
 * clips that are ALREADY PAID FOR — no regeneration, no new spend.
 *
 * IT ALSO TRIMS THE CAPTION. The job predates the hashtag cap and carries 10
 * tags against Instagram's hard limit of 5; requeueing without that fix would
 * produce a reel that assembles fine and then publishes mangled. Only hashtags
 * are removed — the caption body and CTA are untouched, so no new claim can be
 * introduced.
 *
 * SAFETY
 *  · DRY RUN by default; --apply to write.
 *  · PRE-FLIGHT, all of which must pass or it refuses:
 *      - status is exactly `failed` (not mid-flight)
 *      - no igPostId (never published)
 *      - clip count EQUALS beat count — assembly throws on a mismatch, and
 *        requeueing into a guaranteed throw just burns the attempt budget again
 *      - every clip url returns HTTP 2xx RIGHT NOW, so we are not requeueing
 *        into the same ENOENT with extra steps
 *  · UPDATE guarded on id AND status.
 *  · Verifies by reading the row back.
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const JOB_ID = 1200003;
const CAP = 5;

const url = readFileSync("C:/Users/nourd/NOURCITY/apps/nickstire/.env", "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
const [rows] = await conn.execute(
  "SELECT id, status, attempts, igPostId, caption, clipUrlsJson, payload FROM reel_jobs WHERE id = ?",
  [JOB_ID],
);
if (!rows.length) { console.error(`job ${JOB_ID} not found`); await conn.end(); process.exit(1); }
const job = rows[0];

let clips = [];
try { clips = JSON.parse(job.clipUrlsJson || "[]").filter(Boolean); } catch { /* handled below */ }
let beats = 0;
try { beats = (JSON.parse(job.payload || "{}").storyboardBeats || []).length; } catch { /* handled below */ }
const tags = (job.caption || "").match(/#\w+/g) || [];

console.log(`\n#${job.id}  status=${job.status}  attempts=${job.attempts}`);
console.log(`  clips=${clips.length}  beats=${beats}  tags=${tags.length}  igPostId=${job.igPostId ?? "none"}`);

const refuse = (why) => { console.error(`\nREFUSING: ${why}\n`); process.exit(1); };
if (job.status !== "failed") refuse(`expected status "failed", found "${job.status}"`);
if (job.igPostId) refuse("this job is PUBLISHED — requeueing would re-post it");
if (clips.length === 0) refuse("no clips — there is nothing to reassemble");
if (beats > 0 && clips.length !== beats) {
  refuse(`clip/beat mismatch (${clips.length} clips vs ${beats} beats) — assembleReel throws on this, so requeueing would burn the attempt budget again`);
}

// The whole premise is that the clips are reachable. Prove it before writing.
console.log("\n  verifying every clip is fetchable RIGHT NOW:");
for (let i = 0; i < clips.length; i++) {
  const r = await fetch(clips[i], { method: "GET", headers: { Range: "bytes=0-1023" } }).catch((e) => ({ ok: false, status: String(e).slice(0, 40) }));
  const name = String(clips[i]).split("/").pop();
  console.log(`    ${r.ok ? "OK  " : "FAIL"} HTTP ${r.status}  ${name}`);
  if (!r.ok) refuse(`clip ${i + 1} is not reachable — requeueing would hit the same failure`);
}

const keep = tags.slice(0, CAP);
const body = String(job.caption || "").replace(/#\w+/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const nextCaption = tags.length > CAP ? `${body}\n\n${keep.join(" ")}` : job.caption;
if (tags.length > CAP) console.log(`\n  caption: ${tags.length} -> ${keep.length} tags (dropping ${tags.slice(CAP).join(" ")})`);

if (!APPLY) {
  console.log(`\nDRY RUN — would set status='assets_ready', attempts=0${tags.length > CAP ? ", and trim the caption" : ""}.`);
  console.log("  re-run with --apply to write.\n");
  await conn.end();
  process.exit(0);
}

const [res] = await conn.execute(
  "UPDATE reel_jobs SET status = 'assets_ready', attempts = 0, error = NULL, caption = ? WHERE id = ? AND status = 'failed'",
  [nextCaption, JOB_ID],
);
console.log(`\naffectedRows = ${res.affectedRows}`);

const [after] = await conn.execute("SELECT status, attempts, caption FROM reel_jobs WHERE id = ?", [JOB_ID]);
const nowTags = (String(after[0].caption || "").match(/#\w+/g) || []).length;
console.log(`verified: status=${after[0].status} attempts=${after[0].attempts} tags=${nowTags}\n`);
await conn.end();
