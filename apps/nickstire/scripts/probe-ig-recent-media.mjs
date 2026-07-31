/**
 * probe-ig-recent-media.mjs · READ-ONLY (2026-07-31)
 *
 * Lists recent Instagram media for the connected IG account so a reel in
 * `publish_ambiguous` state can be resolved with EVIDENCE instead of a guess.
 *
 * Job #750002 (Jul 19, "worn out oil") has status publish_ambiguous and an
 * empty igPostId — meaning the publish outcome was never confirmed. It may
 * already be live. Re-publishing blind would put a duplicate on a real
 * business account, so: look first.
 *
 * SAFETY: GET requests only. No publishing, no mutations. Never prints the
 * access token.
 */
const token = process.env.META_PAGE_ACCESS_TOKEN;
const igUser = process.env.META_IG_USER_ID;
if (!token || !igUser) {
  console.error(`missing creds · token=${token ? "set" : "MISSING"} igUser=${igUser ? "set" : "MISSING"}`);
  process.exit(1);
}

const url =
  `https://graph.facebook.com/v18.0/${igUser}/media` +
  `?fields=id,caption,timestamp,permalink,media_type&limit=50&access_token=${token}`;

const res = await fetch(url);
const body = await res.json();

if (!res.ok || body.error) {
  console.error(`Graph API error ${res.status}:`, JSON.stringify(body.error ?? body).slice(0, 300));
  process.exit(1);
}

const items = body.data ?? [];
console.log(`\n=== ${items.length} recent IG media items ===\n`);
for (const m of items.slice(0, 25)) {
  const when = m.timestamp ? new Date(m.timestamp).toISOString().slice(0, 16).replace("T", " ") : "?";
  const cap = (m.caption ?? "").replace(/\s+/g, " ").slice(0, 62);
  console.log(`  ${when}  ${String(m.media_type ?? "").padEnd(10)} ${cap}`);
}

console.log("\n=== Jul 16-21 window (does the 'worn out oil' reel already exist?) ===");
const window = items.filter((m) => {
  if (!m.timestamp) return false;
  const d = new Date(m.timestamp);
  return d >= new Date("2026-07-16T00:00:00Z") && d < new Date("2026-07-22T00:00:00Z");
});
if (!window.length) console.log("  (no posts in that window)");
for (const m of window) {
  console.log(`  ${new Date(m.timestamp).toISOString().slice(0, 16)}  ${m.permalink}`);
  console.log(`     ${(m.caption ?? "").replace(/\s+/g, " ").slice(0, 100)}`);
}

const show = (label, re) => {
  const hits = items.filter((m) => re.test(m.caption ?? ""));
  console.log(`\n=== ${label}: ${hits.length} hit(s) ===`);
  for (const m of hits) {
    console.log(`  ${m.timestamp}  ${m.media_type}  ${m.permalink}`);
    console.log(`     ${(m.caption ?? "").replace(/\s+/g, " ").slice(0, 110)}`);
  }
};

// #750002 (Jul 19) — "worn out oil"
show("OIL topic (job #750002)", /oil (really )?looks like|worn out.{0,4}oil|old engine oil/i);
// #660002 (Jul 17) — "mid-July sun ... Euclid Ave ... baking the asphalt"
show("HEAT/ASPHALT topic (job #660002)", /asphalt|baking|mid-july|heat wave|scorcher/i);

console.log("\ndone · read-only\n");
