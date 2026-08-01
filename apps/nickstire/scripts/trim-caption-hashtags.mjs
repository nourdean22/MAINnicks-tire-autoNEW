/**
 * trim-caption-hashtags.mjs · bring stored captions under Instagram's 5-tag cap
 *
 * Instagram caps a post at FIVE hashtags (hard limit since Dec 2025); beyond
 * that the publish is rejected or the excess is SILENTLY STRIPPED. Reels
 * assembled before the cap was enforced carry 8-13 tags and would publish
 * mangled — the mp4 is already paid for, so the caption is worth repairing
 * rather than discarding the render.
 *
 * WHY THIS IS SAFE TO AUTOMATE: it only removes hashtags. The caption BODY —
 * every factual sentence and the CTA — is untouched. Nothing is reworded, so no
 * new claim can be introduced by this script.
 *
 * WHICH FIVE: the first five as they appear, in order. Deliberately mechanical.
 * Picking "the best five" would be a judgment call with no data behind it, and
 * a script that quietly rewrites which tags a post carries is harder to audit
 * than one that truncates. The generator now emits <= 5 directly; this is
 * cleanup for the backlog, not the ongoing path.
 *
 * REFUSES to touch a caption carrying a fabricated statistic or a failure
 * timeline — those are not tag problems and must not be made publishable by a
 * cosmetic fix.
 *
 * SAFETY
 *  · DRY RUN by default; --apply to write.
 *  · Only rows in `assembled` with MORE than 5 tags.
 *  · UPDATE guarded on id AND status.
 *  · Prints the before/after caption and re-reads each row.
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const CAP = 5;

const FABRICATED =
  /\b(?:we|our (?:shop|techs?|customers?|drivers?))\b[^.!?]{0,70}?\b(?:see|seen|find|found|had|never|always)\b[^.!?]{0,40}?(?:\b(?:zero|none|every\s+single)\b|\d{1,3}\s?%)/i;
const TIMELINE = /\b(?:will fail|fails?)\b[^.!?]{0,40}\b(?:within|in)\b[^.!?]{0,20}\b(?:days?|weeks?|months?|miles)\b/i;

const url = readFileSync("C:/Users/nourd/NOURCITY/apps/nickstire/.env", "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
const [rows] = await conn.execute(
  "SELECT id, status, caption FROM reel_jobs WHERE status = 'assembled' AND caption IS NOT NULL ORDER BY id",
);

console.log(`\n${rows.length} assembled row(s) · cap ${CAP} · ${APPLY ? "APPLY" : "DRY RUN"}\n`);
let changed = 0, skipped = 0, refused = 0;

for (const r of rows) {
  const caption = String(r.caption);
  const tags = caption.match(/#\w+/g) || [];
  if (tags.length <= CAP) {
    skipped++;
    console.log(`  #${r.id} ${tags.length} tags — already within cap, untouched`);
    continue;
  }
  if (FABRICATED.test(caption) || TIMELINE.test(caption)) {
    refused++;
    console.log(`  #${r.id} REFUSED — caption carries a fabricated stat or failure timeline; not a tag problem`);
    continue;
  }

  // Strip every hashtag, then re-append the first CAP in original order.
  const keep = tags.slice(0, CAP);
  const body = caption.replace(/#\w+/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const next = `${body}\n\n${keep.join(" ")}`;

  console.log(`  #${r.id} ${tags.length} -> ${keep.length} tags`);
  console.log(`     dropped: ${tags.slice(CAP).join(" ")}`);
  if (!APPLY) continue;

  const [res] = await conn.execute(
    "UPDATE reel_jobs SET caption = ? WHERE id = ? AND status = 'assembled'",
    [next, r.id],
  );
  if (res.affectedRows === 1) changed++;
  const [after] = await conn.execute("SELECT caption FROM reel_jobs WHERE id = ?", [r.id]);
  const nowTags = (String(after[0].caption).match(/#\w+/g) || []).length;
  console.log(`     verified: ${nowTags} tags stored (affectedRows=${res.affectedRows})`);
}

console.log(`\nchanged=${APPLY ? changed : 0} skipped=${skipped} refused=${refused}`);
if (!APPLY) console.log("DRY RUN — re-run with --apply to write.\n");
await conn.end();
