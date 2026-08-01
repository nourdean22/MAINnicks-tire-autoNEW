/**
 * discard-reel-1200004.mjs · retire a reel that must never publish (2026-07-31)
 *
 * Job #1200004 assembled successfully and is parked UNPUBLISHED carrying two
 * defects that the gates now block but did not block when it was generated:
 *
 *   1. A FABRICATED local statistic in the caption — "In Cleveland, we see zero
 *      salt-related brake seizures" — which is false and backwards (road salt
 *      seizing a caliper is a common Cleveland failure). Now caught by
 *      `no-fabricated-stat`.
 *   2. ELEVEN hashtags against Instagram's hard cap of 5; the excess is
 *      rejected or silently stripped. Now caught by `validateHashtagCap`.
 *
 * It also carries no proof-kind sourceNote, which the truth gate now blocks.
 *
 * WHY DISCARD RATHER THAN REPAIR: the caption is not a formatting problem, it
 * is a false claim about the shop's own market. Repairing it would mean
 * regenerating the caption against a video whose beats were built around that
 * claim. Cheaper and more honest to retire the job and let the fixed pipeline
 * produce a fresh one.
 *
 * SAFETY
 *  · DRY RUN by default; --apply to write.
 *  · Refuses if the job has an igPostId — a PUBLISHED reel must never be
 *    silently retired, it would desync the row from a live post.
 *  · Refuses if the job is not in the exact expected state.
 *  · Guarded UPDATE on id AND status, so a concurrent transition cannot be
 *    clobbered. The mp4 and clips are LEFT INTACT — this marks the row, it
 *    does not delete artefacts.
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const JOB_ID = 1200004;
const EXPECTED_STATUS = "assembled";

const url = readFileSync("C:/Users/nourd/NOURCITY/apps/nickstire/.env", "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
const [rows] = await conn.execute(
  "SELECT id, status, igPostId, caption, mp4Url FROM reel_jobs WHERE id = ?",
  [JOB_ID],
);

if (!rows.length) {
  console.error(`job ${JOB_ID} not found — nothing to do`);
  await conn.end();
  process.exit(1);
}
const job = rows[0];
const tags = (job.caption || "").match(/#\w+/g) || [];

console.log(`\njob #${job.id}`);
console.log(`  status    : ${job.status}`);
console.log(`  igPostId  : ${job.igPostId ?? "(none — never published)"}`);
console.log(`  hashtags  : ${tags.length} (cap 5)`);
console.log(`  mp4       : ${job.mp4Url ? String(job.mp4Url).split("/").pop() : "(none)"}`);
console.log(`  fabricated claim present: ${/we see zero/i.test(job.caption || "") ? "YES" : "no"}`);

if (job.igPostId) {
  console.error("\nREFUSING: this reel is PUBLISHED. Retiring the row would desync it from a live post.\n");
  await conn.end();
  process.exit(1);
}
if (job.status !== EXPECTED_STATUS) {
  console.error(`\nREFUSING: expected status "${EXPECTED_STATUS}", found "${job.status}" — state changed since this script was written.\n`);
  await conn.end();
  process.exit(1);
}

if (!APPLY) {
  console.log(`\nDRY RUN — would set status to "discarded" with a reason. Re-run with --apply.\n`);
  await conn.end();
  process.exit(0);
}

const reason =
  "discarded 2026-07-31: caption carried a fabricated local statistic " +
  '("we see zero salt-related brake seizures" — false; road salt seizing a ' +
  "caliper is a common Cleveland failure) and 11 hashtags against Instagram's " +
  "hard cap of 5. Both are now blocked at preflight. Never published; mp4 and " +
  "clips left intact.";

const [res] = await conn.execute(
  "UPDATE reel_jobs SET status = 'discarded', error = ? WHERE id = ? AND status = ?",
  [reason, JOB_ID, EXPECTED_STATUS],
);
console.log(`\naffectedRows = ${res.affectedRows}`);

const [after] = await conn.execute("SELECT status, LEFT(error, 80) e FROM reel_jobs WHERE id = ?", [JOB_ID]);
console.log(`verified: status=${after[0].status} · ${after[0].e}\n`);
await conn.end();
