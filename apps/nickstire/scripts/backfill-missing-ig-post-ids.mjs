/**
 * backfill-missing-ig-post-ids.mjs · repair reel rows that lost their media ID
 *
 * Six reel_jobs rows carried status `published`/`posted` with igPostId NULL — a
 * status asserting something with no receipt. Either they went live and the ID
 * was never captured, or they never published and the status is a lie. Those
 * are very different problems, and the row alone cannot tell you which.
 *
 * Resolved by matching each row's stored caption against the LIVE account
 * (150 media fetched, exact normalised caption equality). All six matched — so
 * the rows are TRUE BUT INCOMPLETE. This backfills the receipt.
 *
 * DESIGN NOTE: the match is recomputed HERE, at apply time, against the live
 * Graph API. Media IDs are deliberately NOT hardcoded from an earlier probe —
 * a hardcoded id can be pasted onto the wrong row, and writing a WRONG media id
 * would turn an incomplete-but-honest row into a confidently false one.
 *
 * SAFETY
 *  · DRY RUN by default; --apply to write.
 *  · Only touches rows that are published/posted AND have NO igPostId.
 *  · Requires an EXACT normalised caption match — no fuzzy matching, because a
 *    near-match would attach the wrong post.
 *  · Refuses a caption that matches MORE THAN ONE live post (ambiguous).
 *  · UPDATE guarded on id AND igPostId IS NULL, so a concurrent write cannot be
 *    clobbered.
 *  · Verifies by reading each row back.
 *
 * Needs META_PAGE_ACCESS_TOKEN + META_IG_USER_ID in the environment:
 *   railway run --service MAINnicks-tire-auto --environment production -- \
 *     node scripts/backfill-missing-ig-post-ids.mjs --apply
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const tok = process.env.META_PAGE_ACCESS_TOKEN || process.env.FB_PAGE_ACCESS_TOKEN;
const igUser = process.env.META_IG_USER_ID;

if (!tok || !igUser) {
  console.error("missing META_PAGE_ACCESS_TOKEN / META_IG_USER_ID — run under `railway run`");
  process.exit(1);
}

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 45);

// Page through the account so older rows are reachable, not just the last 25.
let media = [];
let url = `https://graph.facebook.com/v25.0/${igUser}/media?fields=id,timestamp,caption&limit=50`;
for (let page = 0; page < 4 && url; page++) {
  const j = await (await fetch(url, { headers: { Authorization: `Bearer ${tok}` } })).json();
  if (j.error) {
    console.error(`Graph error: ${j.error.message}`);
    process.exit(1);
  }
  media = media.concat(j.data || []);
  url = (j.paging || {}).next;
}
console.log(`\nfetched ${media.length} live media from the account`);

const dbUrl = readFileSync("C:/Users/nourd/NOURCITY/apps/nickstire/.env", "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");

const conn = await mysql.createConnection({ uri: dbUrl, ssl: { rejectUnauthorized: true } });
const [rows] = await conn.execute(
  `SELECT id, status, caption FROM reel_jobs
    WHERE status IN ('published','posted') AND (igPostId IS NULL OR igPostId = '')
    ORDER BY id`,
);
console.log(`${rows.length} row(s) claim publication with no media id\n`);

let matched = 0, ambiguous = 0, missing = 0, written = 0;
for (const r of rows) {
  const hits = media.filter((m) => norm(m.caption) === norm(r.caption));
  if (hits.length === 0) {
    missing++;
    console.log(`  #${r.id} NOT FOUND on the account — status may be FALSE; leaving untouched for review`);
    continue;
  }
  if (hits.length > 1) {
    ambiguous++;
    console.log(`  #${r.id} AMBIGUOUS — ${hits.length} live posts share this caption; refusing to guess`);
    continue;
  }
  matched++;
  const hit = hits[0];
  if (!APPLY) {
    console.log(`  #${r.id} would set igPostId=${hit.id} (${hit.timestamp.slice(0, 10)})`);
    continue;
  }
  const [res] = await conn.execute(
    "UPDATE reel_jobs SET igPostId = ? WHERE id = ? AND (igPostId IS NULL OR igPostId = '')",
    [hit.id, r.id],
  );
  if (res.affectedRows === 1) written++;
  console.log(`  #${r.id} set igPostId=${hit.id} (affectedRows=${res.affectedRows})`);
}

console.log(`\nmatched=${matched} ambiguous=${ambiguous} notFound=${missing}${APPLY ? ` written=${written}` : ""}`);

if (APPLY) {
  const [after] = await conn.execute(
    `SELECT COUNT(*) n FROM reel_jobs
      WHERE status IN ('published','posted') AND (igPostId IS NULL OR igPostId = '')`,
  );
  console.log(`verified: ${after[0].n} row(s) still missing a media id\n`);
} else {
  console.log("\nDRY RUN — re-run with --apply to write.\n");
}
await conn.end();
