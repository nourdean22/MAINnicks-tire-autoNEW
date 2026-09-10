#!/usr/bin/env node
/**
 * GSC live snapshot — pulls top queries / pages / striking distance
 * keywords from Google Search Console via the existing service-account
 * credentials.
 *
 * Run: node --env-file=.env scripts/gsc-snapshot.mjs
 *
 * Pass --careers for a recruiting-funnel-specific pull instead of the
 * sitewide report: same auth, same API, just a page-dimension filter added
 * to every query (dimensionFilterGroups, operator "contains") so results are
 * scoped to /careers* URLs only.
 *   Run: node --env-file=.env scripts/gsc-snapshot.mjs --careers
 */

import "dotenv/config";
import crypto from "node:crypto";

const SITE_URL = "https://nickstire.org/";

function b64url(buf) {
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) throw new Error("GOOGLE_SERVICE_ACCOUNT_* env missing");

  const header = b64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const now = Math.floor(Date.now() / 1000);
  const claims = b64url(Buffer.from(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })));

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(privateKey));

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!r.ok) throw new Error(`token exchange failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.access_token;
}

const CAREERS_MODE = process.argv.includes("--careers");
const PAGE_FILTER = CAREERS_MODE
  ? { dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "contains", expression: "/careers" }] }] }
  : {};

async function query(token, dimensions, rowLimit = 50, dateOffsetDays = 0, startRow = 0) {
  const endDate = new Date(Date.now() - dateOffsetDays * 86400000).toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - (dateOffsetDays + 28) * 86400000).toISOString().slice(0, 10);
  const r = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, dimensions, rowLimit, startRow, ...PAGE_FILTER }),
    },
  );
  if (!r.ok) throw new Error(`GSC query failed: ${r.status} ${await r.text()}`);
  return (await r.json()).rows || [];
}

/**
 * Fetch EVERY row, not a click-ranked prefix.
 *
 * THE DEFECT THIS REPLACES. Google returns Search Analytics rows ordered by
 * CLICKS descending. Every discovery panel below asked for a small prefix and
 * then filtered locally for LOW-click rows — so it filtered for exactly the
 * population the ordering had already excluded.
 *
 * Worked case. Query A: 10,000 impressions, 0 clicks, position 8 — the single
 * best opportunity on the site. Queries B..P: 10 impressions, 1 click each.
 * Google returns B..P first because they have clicks. rowLimit 15 means A
 * never reaches this process, and sorting those 15 by impressions afterwards
 * cannot recover a row that was never fetched. The header still read
 * "TOP 15 QUERIES (by impressions)".
 *
 * Striking-distance was worse: position 11-20 queries earn almost no clicks by
 * definition, so a 250-row click-ranked prefix removes the target population,
 * and the panel then printed the affirmative wrong conclusion "(none in
 * striking distance — site is either very top-ranked or very far back)".
 *
 * Pagination is via startRow in 25,000-row pages, which is the documented
 * maximum for one response. A short page means the end of the data.
 */
async function queryAll(token, dimensions, dateOffsetDays = 0, cap = 100000) {
  const PAGE = 25000;
  const out = [];
  for (let startRow = 0; startRow < cap; startRow += PAGE) {
    const rows = await query(token, dimensions, PAGE, dateOffsetDays, startRow);
    out.push(...rows);
    if (rows.length < PAGE) return { rows: out, exhausted: true };
  }
  // Hit the cap with a full final page: more rows may exist. Say so rather
  // than presenting a truncated set as complete.
  return { rows: out, exhausted: false };
}

const token = await getAccessToken();
console.log(`\n═══ GSC SNAPSHOT — ${SITE_URL}${CAREERS_MODE ? " (scoped to /careers*)" : ""} ═══`);
console.log(`Date range: last 28 days\n`);

// 1. Aggregate totals
const totals = await query(token, ["date"], 100);
const totalClicks = totals.reduce((s, r) => s + r.clicks, 0);
const totalImpr = totals.reduce((s, r) => s + r.impressions, 0);
const avgCtr = totalImpr > 0 ? ((totalClicks / totalImpr) * 100).toFixed(2) : "0.00";
// Impression-WEIGHTED. An unweighted mean over date rows lets a single quiet
// day dominate: 27 days at 1,000 impressions / position 3.0 plus one day at
// 2 impressions / position 60.0 weights to 3.0 and averages to 5.0 — a 67%
// overstatement. (clicks/impressions above are correct unweighted, because
// date-dimensioned rows DO sum to the property total; only position needs it.)
const posNum = totals.reduce((s, r) => s + r.position * r.impressions, 0);
const avgPos = totalImpr > 0 ? (posNum / totalImpr).toFixed(1) : "n/a";
console.log(`TOTALS · clicks=${totalClicks.toLocaleString()}  impressions=${totalImpr.toLocaleString()}  CTR=${avgCtr}%  avg.position=${avgPos}\n`);

// 2. Top 15 queries by impressions
const allQueries = await queryAll(token, ["query"]);
console.log(
  `TOP 15 QUERIES (by impressions, last 28d) — ranked over ${allQueries.rows.length} rows` +
    `${allQueries.exhausted ? "" : " (CAPPED — more rows exist, ranking may be incomplete)"}:`,
);
const topQueries = allQueries.rows.slice();
topQueries.sort((a, b) => b.impressions - a.impressions).slice(0, 15).forEach((r) => {
  console.log(`  ${String(r.impressions).padStart(6)} imp · ${String(r.clicks).padStart(4)} clk · pos ${r.position.toFixed(1).padStart(4)} · CTR ${(r.ctr * 100).toFixed(1).padStart(4)}% · ${r.keys[0]}`);
});

// 3. Striking-distance queries — positions 11-20, ≥30 impressions, <100 clicks
console.log("\nSTRIKING-DISTANCE QUERIES (pos 11-20, ≥30 impressions — one push from page 1):");
const strike = allQueries.rows;
const candidates = strike
  .filter((r) => r.position >= 11 && r.position <= 20 && r.impressions >= 30)
  .sort((a, b) => b.impressions * (20 - b.position) - a.impressions * (20 - a.position));
candidates.slice(0, 15).forEach((r) => {
  console.log(`  ${String(r.impressions).padStart(5)} imp · ${String(r.clicks).padStart(3)} clk · pos ${r.position.toFixed(1).padStart(4)} · ${r.keys[0]}`);
});
if (candidates.length === 0) {
  // Only a truthful claim once the search was exhaustive. Said over a
  // click-ranked prefix it was an affirmative wrong conclusion.
  console.log(
    allQueries.exhausted
      ? `  (none in striking distance across all ${allQueries.rows.length} queries)`
      : "  (none found, but retrieval was CAPPED — this is not evidence of absence)",
  );
}

// 4. Pages with high impressions + low CTR (meta-description optimization candidates)
console.log("\nLOW-CTR PAGES (≥100 impressions, CTR < 2.0%):");
const allPages = await queryAll(token, ["page"]);
const lowCtr = allPages.rows
  .filter((r) => r.impressions >= 100 && r.ctr < 0.02)
  .sort((a, b) => b.impressions - a.impressions);
lowCtr.slice(0, 12).forEach((r) => {
  console.log(`  ${String(r.impressions).padStart(5)} imp · CTR ${(r.ctr * 100).toFixed(2).padStart(4)}% · pos ${r.position.toFixed(1).padStart(4)} · ${r.keys[0].replace(SITE_URL, "/")}`);
});
if (lowCtr.length === 0) {
  console.log(
    allPages.exhausted
      ? `  (no low-CTR pages across all ${allPages.rows.length} pages)`
      : "  (none found, but retrieval was CAPPED — not evidence of absence)",
  );
}

// 5. Top 10 pages by clicks (what's actually converting)
console.log("\nTOP 10 PAGES BY CLICKS (your highest-traffic surfaces):");
pages.sort((a, b) => b.clicks - a.clicks).slice(0, 10).forEach((r) => {
  console.log(`  ${String(r.clicks).padStart(4)} clk · ${String(r.impressions).padStart(5)} imp · CTR ${(r.ctr * 100).toFixed(1).padStart(4)}% · ${r.keys[0].replace(SITE_URL, "/")}`);
});

console.log("\n═══ DONE ═══\n");
