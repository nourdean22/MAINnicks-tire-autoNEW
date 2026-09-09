#!/usr/bin/env node
/**
 * Google Indexing API submission — restricted worldwide to exactly two
 * content types: JobPosting pages and BroadcastEvent/VideoObject (livestream)
 * pages. /careers is one of the only pages on the entire site legally
 * eligible to use this for near-instant re-crawl (default quota 200/day).
 *
 * Reuses the SAME service-account credential family as scripts/gsc-snapshot.mjs
 * (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_KEY), just with the
 * `indexing` scope instead of `webmasters.readonly`. That account must ALSO be
 * added as an Owner on the nickstire.org property in Search Console — a
 * one-time, dashboard-only step only the operator can do (Settings > Users
 * and permissions > Add user, paste the service-account email, role Owner).
 * Until that's done this script will fail with a clear 403 — same graceful-
 * degradation shape as server/google-reviews.ts when GOOGLE_MAPS_API_KEY is
 * absent, not a crash.
 *
 * Run: node scripts/indexing-api-submit.mjs careers [--delete]
 * Defaults to /careers, type URL_UPDATED. Pass --delete for URL_DELETED
 * (a role was removed — see Careers.tsx's own datePosted/removal discipline
 * before ever using this for a still-live JobPosting).
 *
 * ARGUMENT FORM — omit the leading slash (same MSYS/Git-Bash path-mangling
 * trap documented in scripts/indexnow-submit.mjs's header; `careers` round-
 * trips correctly and this script normalizes it internally either way).
 */

import "dotenv/config";
import crypto from "node:crypto";

const SITE_URL = "https://nickstire.org";

function b64url(buf) {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_KEY not set — same credential " +
      "gsc-snapshot.mjs already uses. Nothing to submit until that's configured.",
    );
  }

  const header = b64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const now = Math.floor(Date.now() / 1000);
  const claims = b64url(Buffer.from(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/indexing",
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
  return (await r.json()).access_token;
}

const args = process.argv.slice(2);
const isDelete = args.includes("--delete");
const path = args.find((a) => !a.startsWith("--")) || "/careers";
const url = `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
const type = isDelete ? "URL_DELETED" : "URL_UPDATED";

console.log(`═══ Google Indexing API submission ═══`);
console.log(`url: ${url}  type: ${type}`);

try {
  const token = await getAccessToken();
  const r = await fetch("https://indexing.googleapis.com/v3/urlNotifications:publish", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, type }),
  });
  const text = await r.text();
  if (r.ok) {
    console.log(`ACCEPTED (HTTP ${r.status}): ${text.slice(0, 300)}`);
  } else {
    console.error(`REJECTED (HTTP ${r.status}): ${text.slice(0, 500)}`);
    if (r.status === 403) {
      console.error(
        "403 usually means the service account isn't yet added as an Owner on the " +
        "nickstire.org Search Console property — see this file's header comment.",
      );
    }
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`FAILED: ${err.message}`);
  process.exitCode = 1;
}
