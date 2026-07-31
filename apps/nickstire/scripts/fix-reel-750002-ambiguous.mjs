/**
 * fix-reel-750002-ambiguous.mjs · one-shot data repair (2026-07-31)
 *
 * Job #750002 sat in `publish_ambiguous` with an empty igPostId. Operator
 * confirmed 2026-07-31 that its reel IS live as
 * https://www.instagram.com/reel/DbBicPIm6dV/ (Jul 20 18:02, "old engine
 * oil") — publish_ambiguous meant it published and the id was never
 * recorded. This backfills the real numeric media id and settles the status
 * so the row stops reading as unfinished work (and can never be
 * accidentally re-published as a duplicate).
 *
 * SAFETY
 *  · DRY RUN by default. Pass --apply to write.
 *  · The UPDATE is guarded: id = 750002 AND status = 'publish_ambiguous'.
 *    If the row already moved on, it matches 0 rows and changes nothing.
 *  · The igPostId is NOT hardcoded — it is resolved from the live Graph API
 *    by matching the permalink, so a typo cannot write a wrong id.
 *  · Prints the row before and after.
 */
import mysql from "mysql2/promise";

const JOB_ID = 750002;
const PERMALINK_FRAGMENT = "DbBicPIm6dV";
const APPLY = process.argv.includes("--apply");

const token = process.env.META_PAGE_ACCESS_TOKEN;
const igUser = process.env.META_IG_USER_ID;
if (!token || !igUser || !process.env.DATABASE_URL) {
  console.error("missing META_PAGE_ACCESS_TOKEN / META_IG_USER_ID / DATABASE_URL");
  process.exit(1);
}

// 1 · resolve the real numeric media id from the live account
const res = await fetch(
  `https://graph.facebook.com/v18.0/${igUser}/media?fields=id,permalink,timestamp,caption&limit=50&access_token=${token}`,
);
const body = await res.json();
if (!res.ok || body.error) {
  console.error("Graph API error:", JSON.stringify(body.error ?? body).slice(0, 200));
  process.exit(1);
}
const match = (body.data ?? []).filter((m) => (m.permalink ?? "").includes(PERMALINK_FRAGMENT));
if (match.length !== 1) {
  console.error(`expected exactly 1 permalink match for ${PERMALINK_FRAGMENT}, got ${match.length} — refusing to write`);
  process.exit(1);
}
const media = match[0];
console.log(`\nresolved igPostId ${media.id}`);
console.log(`  permalink ${media.permalink}`);
console.log(`  posted    ${media.timestamp}`);
console.log(`  caption   ${(media.caption ?? "").replace(/\s+/g, " ").slice(0, 80)}`);

const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
const show = async (label) => {
  const [rows] = await conn.execute(
    "SELECT id, status, COALESCE(igPostId,'-') AS ig, updatedAt FROM reel_jobs WHERE id = ?",
    [JOB_ID],
  );
  for (const r of rows) console.log(`  ${label}: #${r.id} ${r.status} ig=${r.ig} ${r.updatedAt}`);
  return rows[0];
};

console.log("\n=== before ===");
const before = await show("row");

if (!APPLY) {
  console.log(`\nDRY RUN — would set status='posted', igPostId='${media.id}'`);
  console.log("  guard: WHERE id = 750002 AND status = 'publish_ambiguous'");
  console.log("  re-run with --apply to write.\n");
  await conn.end();
  process.exit(0);
}

if (before?.status !== "publish_ambiguous") {
  console.log(`\nrow is '${before?.status}', not 'publish_ambiguous' — nothing to do.\n`);
  await conn.end();
  process.exit(0);
}

const [result] = await conn.execute(
  "UPDATE reel_jobs SET status = 'posted', igPostId = ?, updatedAt = NOW() WHERE id = ? AND status = 'publish_ambiguous'",
  [media.id, JOB_ID],
);
console.log(`\nUPDATE affectedRows = ${result.affectedRows} (expected 1)`);

console.log("\n=== after ===");
await show("row");
await conn.end();
console.log("");
