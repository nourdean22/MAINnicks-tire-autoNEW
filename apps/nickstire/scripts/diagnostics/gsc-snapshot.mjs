#!/usr/bin/env node
/**
 * GSC live snapshot — pulls top queries / pages / striking distance
 * keywords from Google Search Console via the existing service-account
 * credentials.
 *
 * Run: node --env-file=.env scripts/gsc-snapshot.mjs
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

async function query(token, dimensions, rowLimit = 50, dateOffsetDays = 0) {
  const endDate = new Date(Date.now() - dateOffsetDays * 86400000).toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - (dateOffsetDays + 28) * 86400000).toISOString().slice(0, 10);
  const r = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, dimensions, rowLimit }),
    },
  );
  if (!r.ok) throw new Error(`GSC query failed: ${r.status} ${await r.text()}`);
  return (await r.json()).rows || [];
}

const token = await getAccessToken();
console.log(`\n═══ GSC SNAPSHOT — ${SITE_URL} ═══`);
console.log(`Date range: last 28 days\n`);

// 1. Aggregate totals
const totals = await query(token, ["date"], 100);
const totalClicks = totals.reduce((s, r) => s + r.clicks, 0);
const totalImpr = totals.reduce((s, r) => s + r.impressions, 0);
const avgCtr = totalImpr > 0 ? ((totalClicks / totalImpr) * 100).toFixed(2) : "0.00";
const avgPos = totals.length > 0 ? (totals.reduce((s, r) => s + r.position, 0) / totals.length).toFixed(1) : "n/a";
console.log(`TOTALS · clicks=${totalClicks.toLocaleString()}  impressions=${totalImpr.toLocaleString()}  CTR=${avgCtr}%  avg.position=${avgPos}\n`);

// 2. Top 15 queries by impressions
console.log("TOP 15 QUERIES (by impressions, last 28d):");
const topQueries = await query(token, ["query"], 15);
topQueries.sort((a, b) => b.impressions - a.impressions).forEach((r) => {
  console.log(`  ${String(r.impressions).padStart(6)} imp · ${String(r.clicks).padStart(4)} clk · pos ${r.position.toFixed(1).padStart(4)} · CTR ${(r.ctr * 100).toFixed(1).padStart(4)}% · ${r.keys[0]}`);
});

// 3. Striking-distance queries — positions 11-20, ≥30 impressions, <100 clicks
console.log("\nSTRIKING-DISTANCE QUERIES (pos 11-20, ≥30 impressions — one push from page 1):");
const strike = await query(token, ["query"], 250);
const candidates = strike
  .filter((r) => r.position >= 11 && r.position <= 20 && r.impressions >= 30)
  .sort((a, b) => b.impressions * (20 - b.position) - a.impressions * (20 - a.position));
candidates.slice(0, 15).forEach((r) => {
  console.log(`  ${String(r.impressions).padStart(5)} imp · ${String(r.clicks).padStart(3)} clk · pos ${r.position.toFixed(1).padStart(4)} · ${r.keys[0]}`);
});
if (candidates.length === 0) console.log("  (none in striking distance — site is either very top-ranked or very far back)");

// 4. Pages with high impressions + low CTR (meta-description optimization candidates)
console.log("\nLOW-CTR PAGES (≥100 impressions, CTR < 2.0%):");
const pages = await query(token, ["page"], 200);
const lowCtr = pages
  .filter((r) => r.impressions >= 100 && r.ctr < 0.02)
  .sort((a, b) => b.impressions - a.impressions);
lowCtr.slice(0, 12).forEach((r) => {
  console.log(`  ${String(r.impressions).padStart(5)} imp · CTR ${(r.ctr * 100).toFixed(2).padStart(4)}% · pos ${r.position.toFixed(1).padStart(4)} · ${r.keys[0].replace(SITE_URL, "/")}`);
});
if (lowCtr.length === 0) console.log("  (no low-CTR pages with significant impressions)");

// 5. Top 10 pages by clicks (what's actually converting)
console.log("\nTOP 10 PAGES BY CLICKS (your highest-traffic surfaces):");
pages.sort((a, b) => b.clicks - a.clicks).slice(0, 10).forEach((r) => {
  console.log(`  ${String(r.clicks).padStart(4)} clk · ${String(r.impressions).padStart(5)} imp · CTR ${(r.ctr * 100).toFixed(1).padStart(4)}% · ${r.keys[0].replace(SITE_URL, "/")}`);
});

console.log("\n═══ DONE ═══\n");
