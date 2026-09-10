#!/usr/bin/env node
/**
 * IndexNow URL submission — the key file (server/_core/index.ts) has been live
 * and served since before this script existed, but nothing ever POSTed a
 * submission through it. This closes that gap: fire-and-report a bulk POST to
 * IndexNow's shared endpoint whenever a JobPosting (or any URL) genuinely
 * changes. IndexNow's current participants are Bing, Naver, Seznam.cz,
 * Yandex, and Yep — Google explicitly does NOT participate (use
 * scripts/indexing-api-submit.mjs for Google, JobPosting/BroadcastEvent
 * pages only).
 *
 * Run: node scripts/indexnow-submit.mjs careers [other-path ...]
 * Defaults to /careers with no args, since that's this script's primary
 * reason for existing (see docs/QUALITY-PROGRAM-2026-09-07.md).
 *
 * ARGUMENT FORM — omit the leading slash on the command line. In Git Bash on
 * Windows (MSYS), a bare `/careers` argument is silently rewritten to an
 * absolute Windows path (`C:/Program Files/Git/careers`) by the shell BEFORE
 * Node ever sees it — this script then submits that mangled string as a real
 * URL to IndexNow's live API. Confirmed 2026-09-09: this happened for real on
 * a first run. `careers` (no leading slash) round-trips correctly, and this
 * script normalizes it to `/careers` internally either way. If you must pass
 * a leading slash, prefix the command with `MSYS_NO_PATHCONV=1` or double the
 * slash (`//careers`) instead.
 */

import { refuseMangledPaths } from "./lib/sitePathArg.mjs";
const SITE_URL = "https://nickstire.org";
const INDEXNOW_KEY = "d274e03f24e4438599616695d23dab67";
const KEY_LOCATION = `${SITE_URL}/${INDEXNOW_KEY}.txt`;

const paths = process.argv.slice(2);

refuseMangledPaths(paths, { scriptName: "indexnow-submit.mjs" });

const urlList = (paths.length ? paths : ["/careers"]).map(
  (p) => `${SITE_URL}${p.startsWith("/") ? p : `/${p}`}`,
);

const body = {
  host: new URL(SITE_URL).host,
  key: INDEXNOW_KEY,
  keyLocation: KEY_LOCATION,
  urlList,
};

console.log(`═══ IndexNow submission ═══`);
console.log(`urlList: ${urlList.join(", ")}`);

const r = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});

// IndexNow's documented success responses: 200 (accepted) or 202 (accepted,
// key not yet verified by all participants) — both mean "queued", not
// "indexed" (that's still up to each participating engine's own crawler).
if (r.status === 200 || r.status === 202) {
  console.log(`ACCEPTED (HTTP ${r.status}) — queued with Bing/Naver/Seznam.cz/Yandex/Yep.`);
} else {
  const text = await r.text().catch(() => "");
  console.error(`REJECTED (HTTP ${r.status}): ${text.slice(0, 500)}`);
  process.exitCode = 1;
}
