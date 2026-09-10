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

import { refuseMangledPaths } from "./lib/sitePathArg.mjs";
import { JOB_OPENINGS } from "../shared/jobOpenings.ts";
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
// Same MSYS trap as indexnow-submit.mjs, same gate. This endpoint is Google's
// Indexing API — a junk URL burns a slice of a hard daily quota and cannot be
// recalled. Flags are excluded: only real path arguments are checked.
refuseMangledPaths(args.filter((a) => !a.startsWith("--")), { scriptName: "indexing-api-submit.mjs" });
const isDelete = args.includes("--delete");
// ELIGIBILITY. Google restricts this API to JobPosting and BroadcastEvent
// pages, and wants ONE notification per individual job URL. /careers is the
// LIST page: verified live 2026-09-10 it carried three JobPosting objects at
// once, which is the arrangement Google's own requirements forbid. Since the
// leaf pages exist (shared/jobOpenings.ts -> /careers/<slug>), notifying
// /careers would be submitting an ineligible URL.
//
// No default. A bare run used to silently submit /careers; now it refuses and
// prints the eligible URLs, because "it ran and printed something" is exactly
// how the wrong URL got notified in the first place.
const ELIGIBLE = JOB_OPENINGS.filter((j) => j.status === "open").map((j) => `/careers/${j.slug}`);
const path = args.find((a) => !a.startsWith("--"));
if (!path) {
  console.error("REFUSED: no URL given, and there is no safe default.");
  console.error("Google accepts JobPosting/BroadcastEvent URLs only. Eligible now:");
  for (const e of ELIGIBLE) console.error(`  ${e}`);
  process.exit(1);
}
{
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!ELIGIBLE.includes(normalized)) {
    console.error(`REFUSED: ${normalized} is not an eligible JobPosting URL.`);
    console.error("Eligible now:");
    for (const e of ELIGIBLE) console.error(`  ${e}`);
    console.error("A list page or a closed role must never be notified.");
    process.exit(1);
  }
}
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
      // TWO DIFFERENT CAUSES share this status, and guessing one sent a reader
      // to the wrong console (witnessed 2026-09-10). Read the body: Google
      // names which it is.
      const disabledApi = /has not been used in project|is disabled/i.test(text);
      const lines403 = disabledApi
        ? [
            "403 - THE API ITSELF IS DISABLED in the Cloud project. This is NOT a",
            "Search Console permission problem. Enable Web Search Indexing API for the",
            "project named in the message above, at",
            "console.cloud.google.com/apis/library/indexing.googleapis.com , wait a",
            "minute for it to propagate, then retry.",
          ]
        : [
            "403 - the service account is probably not yet added as an Owner on the",
            "nickstire.org Search Console property. See this file header comment.",
            "If the body above mentions the API being disabled, that is the OTHER",
            "cause: enable Web Search Indexing API in the Cloud project instead.",
          ];
      console.error(lines403.join(String.fromCharCode(10)));
    }
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`FAILED: ${err.message}`);
  process.exitCode = 1;
}
