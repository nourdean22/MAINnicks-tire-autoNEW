/**
 * close-resolved-reel-failures.mjs · close failures whose root cause is fixed
 *
 * Five reel jobs failed with "Session expired" between 07-28 and 07-31. That
 * root cause was fixed on 2026-07-31 (Higgsfield session restored, and the
 * keepalive now throws so a future expiry alerts instead of failing silently).
 * The jobs themselves are stale: the topics have aged out and regenerating
 * costs less than resurrecting a 4-day-old brief.
 *
 * They keep appearing in the attention badge because there is no `closed`
 * status — a failure stays `failed` forever. This writes an explicit closure
 * marker so the badge stops counting a decision that has been made.
 *
 * WHY PER-ROW AND NOT A RULE: it would be easy to make the badge ignore
 * "Session expired" as a category. That would also hide the NEXT expiry, which
 * is a real outage that cost four days of production the last time it went
 * unnoticed. Closing specific rows cannot do that — an uncommented row still
 * shows, however familiar its error text.
 *
 * SAFETY
 *  · DRY RUN by default; --apply to write.
 *  · Only `failed` rows matching the given error substring.
 *  · Refuses any row that has an mp4Url or igPostId — a job with an artifact or
 *    a live post is NOT dead history and must be reviewed by hand.
 *  · APPENDS the marker; the original error text is preserved for forensics.
 *  · UPDATE guarded on id AND status.
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const MATCH = "Session expired";
const MARKER = "closed — root cause resolved";
const NOTE =
  `${MARKER}: Higgsfield session restored 2026-07-31 and the keepalive now ` +
  `throws on failure (was silent for 526 runs). Topic aged out — regenerate ` +
  `rather than resurrect.`;

const url = readFileSync("C:/Users/nourd/NOURCITY/apps/nickstire/.env", "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
const [rows] = await conn.execute(
  "SELECT id, status, mp4Url, igPostId, error FROM reel_jobs WHERE status = 'failed' AND error LIKE ? ORDER BY id",
  [`%${MATCH}%`],
);

console.log(`\n${rows.length} failed row(s) matching "${MATCH}" · ${APPLY ? "APPLY" : "DRY RUN"}\n`);
let closed = 0, refused = 0, already = 0;

for (const r of rows) {
  if (String(r.error || "").includes(MARKER)) {
    already++;
    console.log(`  #${r.id} already closed — skipping`);
    continue;
  }
  if (r.mp4Url || r.igPostId) {
    refused++;
    console.log(`  #${r.id} REFUSED — has ${r.mp4Url ? "an mp4" : ""}${r.mp4Url && r.igPostId ? " and " : ""}${r.igPostId ? "a live post" : ""}; not dead history`);
    continue;
  }
  if (!APPLY) {
    console.log(`  #${r.id} would close`);
    continue;
  }
  // Append — never overwrite. The original failure text is the forensic record.
  const next = `${String(r.error || "").slice(0, 700)} | ${NOTE}`;
  const [res] = await conn.execute(
    "UPDATE reel_jobs SET error = ? WHERE id = ? AND status = 'failed'",
    [next, r.id],
  );
  if (res.affectedRows === 1) closed++;
  console.log(`  #${r.id} closed (affectedRows=${res.affectedRows})`);
}

console.log(`\nclosed=${APPLY ? closed : 0} refused=${refused} alreadyClosed=${already}`);
if (!APPLY) console.log("DRY RUN — re-run with --apply to write.\n");
await conn.end();
