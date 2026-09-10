/**
 * Regenerate config/thin-prerender-baseline.json — PRUNE ONLY.
 *
 * WHY IT HAS TO EXIST. The gate in check-prerender-semantic.mjs is fatal in BOTH
 * directions on purpose: a new empty artifact fails, and so does a baseline row
 * that no longer reproduces, because a list that may quietly contain fixed
 * entries teaches the next reader it is decorative. That second rule has a
 * consequence the first PR did not close: the moment a prerender refresh
 * actually FIXES one of the named pages, every open PR in the repo goes red on
 * a stale row until a human prunes it. A gate that fires on success is a gate
 * people learn to switch off.
 *
 * So the refresh prunes the ledger in the same commit that fixes the pages.
 *
 * IT REFUSES TO GROW, and that is the whole reason it is a separate script
 * rather than a flag on the gate. A regenerator that happily records a bigger
 * number turns the ratchet into a rubber stamp — the fix for a red becomes
 * "re-run the script". Growth has to be a deliberate, reviewable edit. Same
 * shape as scripts/update-fabricated-read-baseline.mjs, for the same reason.
 *
 * Run inside the prerender refresh workflow, AFTER regen and BEFORE the commit:
 * a non-zero exit there means the refresh produced a soft 404, and failing the
 * job is exactly right — that artifact must not reach main.
 *
 * Imports the SAME scanner the gate uses. The fail-open-slice pair in this
 * directory drifted twice when each side carried its own copy.
 *
 * Usage:  node scripts/update-thin-prerender-baseline.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { emptyArtifacts } from "./lib/prerenderText.mjs";

const NL = String.fromCharCode(10);
const APP = process.cwd();
const PATH = resolve(APP, "config/thin-prerender-baseline.json");

const prev = JSON.parse(readFileSync(PATH, "utf8"));
const live = emptyArtifacts(resolve(APP, "prerendered")).map((a) => a.rel).sort();
const known = new Set(prev.known);

const fresh = live.filter((rel) => !known.has(rel));
if (fresh.length > 0) {
  console.error(
    [
      `REFUSING: this would ADD ${fresh.length} artifact(s) to the baseline.`,
      ...fresh.map((f) => `  + ${f}`),
      "",
      "These pages render no article and would be served to crawlers at HTTP 200.",
      "Fix the render — do not record it. If a page is genuinely expected to be",
      "empty, edit the baseline by hand in a PR where the diff is reviewable.",
    ].join(NL),
  );
  process.exit(1);
}

const kept = prev.known.filter((rel) => live.includes(rel));
const removed = prev.known.length - kept.length;

writeFileSync(PATH, JSON.stringify({ $comment: prev.$comment, known: kept }, null, 2) + NL);

console.log(
  removed > 0
    ? `thin-prerender baseline lowered: ${prev.known.length} -> ${kept.length} (${removed} fixed)`
    : `thin-prerender baseline unchanged at ${kept.length}`,
);
