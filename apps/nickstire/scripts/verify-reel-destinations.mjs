/**
 * Confirm a landing destination is actually LIVE, by title discrimination.
 *
 * WHY NOT STATUS CODES. nickstire.org is a single-page app behind a catch-all:
 * it answers HTTP 200 for ANY path and serves the app shell. Measured
 * 2026-08-29 - `/definitely-not-a-real-page-xyz123` returned 200, and so did
 * `/tire-sidewall`, `/tire-pressure` and `/uneven-tire-wear`, none of which
 * exist. A status-code check on this site proves nothing. It nearly put
 * `/tire-sidewall` into a pack as a recommended destination.
 *
 * So the test is: fetch the homepage once to learn the SHELL TITLE, then fetch
 * each candidate. A page whose <title> equals the shell title is the shell -
 * i.e. the route does not exist. A page with its own title is real.
 *
 * Read-only. Issues GET requests to the public site and writes nothing.
 *
 * Usage:
 *   node scripts/verify-reel-destinations.mjs /brakes /alignment /tire-sidewall
 *   node scripts/verify-reel-destinations.mjs --all      # every PRERENDER_ROUTES path
 *   node scripts/verify-reel-destinations.mjs --assigned # paths used in TRIAGE.json
 * Exit code is non-zero if any checked path is NOT live.
 */
import { readFileSync } from "node:fs";

const ORIGIN = process.env.NICKSTIRE_ORIGIN || "https://nickstire.org";
const TIMEOUT_MS = 20000;

async function titleOf(path) {
  const url = `${ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
    const html = await res.text();
    const m = /<title>([\s\S]*?)<\/title>/i.exec(html);
    return { status: res.status, title: m ? m[1].trim() : null };
  } catch (err) {
    return { status: 0, title: null, error: err?.message ?? String(err) };
  }
}

const args = process.argv.slice(2);
let paths = args.filter((a) => !a.startsWith("--"));

if (args.includes("--all") || args.includes("--assigned")) {
  const src = readFileSync(new URL("../shared/routes.ts", import.meta.url), "utf8");
  // Paths are read from the registry source rather than imported, so this
  // script stays runnable as plain node without a TS loader.
  const all = [...src.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (args.includes("--all")) paths = [...new Set(all)];
  if (args.includes("--assigned")) {
    const triage = JSON.parse(readFileSync(new URL("../docs/reel-packs/TRIAGE.json", import.meta.url), "utf8"));
    paths = [...new Set(triage.concepts.map((c) => c.landingDestination).filter(Boolean))];
  }
}

if (!paths.length) {
  console.error("no paths given. Pass paths, or --all / --assigned.");
  process.exit(2);
}

// The shell signature: whatever an impossible path renders.
const shell = await titleOf("/__shell-probe-" + "x".repeat(12));
if (!shell.title) {
  console.error("could not establish the shell title — aborting rather than guessing.");
  process.exit(2);
}
console.log(`shell signature (an impossible path renders this): ${JSON.stringify(shell.title)}\n`);

let live = 0;
let dead = 0;
for (const p of paths) {
  const r = await titleOf(p);
  const isShell = r.title !== null && r.title === shell.title;
  const ok = r.title !== null && !isShell;
  if (ok) live++;
  else dead++;
  const verdict = ok ? "LIVE " : isShell ? "SHELL" : "ERROR";
  console.log(`  ${verdict}  HTTP ${r.status}  ${p}${ok ? `  — ${r.title.slice(0, 60)}` : ""}${r.error ? `  (${r.error})` : ""}`);
}

console.log(`\nlive: ${live}   not-live: ${dead}   checked: ${paths.length}`);
if (dead > 0) {
  console.error("\nAt least one destination is NOT live. A pack pointing here would send a viewer to the app shell.");
  process.exit(1);
}
