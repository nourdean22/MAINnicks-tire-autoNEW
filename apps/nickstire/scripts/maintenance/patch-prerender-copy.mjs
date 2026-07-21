#!/usr/bin/env node
/**
 * wave-169 · Stale-copy hot-patcher for prerendered/ HTML.
 *
 * Three regen attempts failed in this Windows env (Puppeteer/Chrome
 * instability). Instead of waiting ≤7 days for the weekly Linux-runner
 * regen workflow, this script surgically find-replaces the wave-167
 * copy fixes directly in the committed prerendered HTML so cold-cache
 * Googlebot + non-JS visitors see the correct copy starting on the
 * next push.
 *
 * Scope: high-confidence string replacements only. No structural HTML
 * changes, no JSON-LD additions, no new sections. Pages that need
 * NEW content (e.g. TireSizePage's FAQ schema + BookingForm injection
 * from wave-159) still wait for the next full regen — but those pages
 * already work correctly in production via React hydration.
 *
 * Run: node scripts/patch-prerender-copy.mjs
 *      Commit prerendered/ + push when done.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PRERENDER_DIR = path.join(ROOT, "prerendered");

/**
 * Edits ordered most-specific first so the broader rules don't clobber
 * the narrower ones (e.g. "$0 down" inside "$0 down today" before the
 * generic "$0 down" pass).
 *
 * Each entry: [pattern, replacement, optional description].
 */
const EDITS = [
  // ─── WARRANTY: canonicalize to 12-month parts / 90-day labor ──────
  // Canonical (2026-07-21, matches the shop's printed invoice): a 12-month
  // limited PARTS warranty + a 90-day limited LABOR warranty. NO mileage,
  // NO road-hazard, NO 24/36-month premium tier. Every mileage / tier /
  // "whichever comes first" claim below collapses to that one promise.
  // Ordered MOST-SPECIFIC FIRST so broad fallbacks never clobber the
  // context-carrying rules above them.

  // -- JSON-LD: split the single laborWarranty PropertyValue into two
  //    accurate values (parts 1 year + labor 90 days). MUST run before any
  //    bare "12 months / 12,000 miles" rule or the inner value rewrites first.
  [
    /\{"@type":"PropertyValue","name":"laborWarranty","value":"12 months \/ 12,000 miles"\}/g,
    '{"@type":"PropertyValue","name":"partsWarranty","value":"1 year"},{"@type":"PropertyValue","name":"laborWarranty","value":"90 days"}',
  ],
  [/"12 months \/ 12,000 miles"/g, '"12-month parts / 90-day labor"'], // any other quoted PropertyValue slot

  // -- Legacy 36-month/36,000-mile artifacts → canonical (was premium-padded)
  [/36 months \/ 36,000 miles/g, "12-month parts / 90-day labor"],
  [/36-month\/36,000-mile/g, "12-month parts / 90-day labor"],
  [/36-month warranty/g, "12-month parts / 90-day labor warranty"],
  [/36-mo warranty/g, "12-mo parts / 90-day labor warranty"],
  [/"36 months \/ 36,000 miles"/g, '"12-month parts / 90-day labor"'], // JSON-LD PropertyValue

  // -- 24-month/24,000-mile premium-pad (there is NO premium tier) → canonical
  [/24-month \/ 24,000-mile warranty/g, "12-month parts / 90-day labor warranty"],
  [/24-month \/ 24,000-mile/g, "12-month parts / 90-day labor"],

  // -- Nick's own repair-warranty sentences (drop mileage + "whichever comes first")
  [
    /the parts we supplied for 12 months or 12,000 miles \(whichever comes first\)/g,
    "the parts we supplied under our 12-month parts / 90-day labor warranty",
  ],
  [
    /covered for 12 months or 12,000 miles, whichever comes first/g,
    "covered under our 12-month parts / 90-day labor warranty",
  ],
  [
    /12,000-mile or 12-month — whichever comes first, in writing/g,
    "12-month parts / 90-day labor warranty, in writing",
  ],
  [/12-month or 12,000-mile parts-and-labor guarantee/g, "12-month parts / 90-day labor guarantee"],
  [
    /our repairs for 12 months or 12,000 miles — three times the industry standard/g,
    "our repairs with a 12-month parts / 90-day labor warranty",
  ],

  // -- workmanship / install / alignment warranty variants → canonical
  [/12 months \/ 12,000 miles on labor/g, "90-day labor coverage"],
  [/12-month \/ 12,000-mile install workmanship warranty/g, "12-month parts / 90-day labor warranty"],
  [/12-month \/ 12,000-mile warranty on install workmanship/g, "12-month parts / 90-day labor warranty"],
  [/12-month \/ 12,000-mile warranty on installations/g, "12-month parts / 90-day labor warranty"],
  [/12-month \/ 12,000-mile alignment warranty/g, "12-month parts / 90-day labor warranty"],
  [/12-month \/ 12,000-mile warranty covering parts and labor/g, "12-month parts / 90-day labor warranty"],
  [/12-month \/ 12,000-mile warranty on parts and labor/g, "12-month parts / 90-day labor warranty"],

  // -- remaining "... warranty" phrasings (case + separator variants) → canonical
  [/12 months \/ 12,000 miles on parts and labor/g, "12-month parts / 90-day labor"],
  [/12 months \/ 12,000 miles parts \+ labor/g, "12-month parts / 90-day labor"],
  [/12-mo \/ 12,000-mi warranty/g, "12-mo parts / 90-day labor warranty"],
  [/12-MONTH \/ 12,000-MILE WARRANTY/g, "12-MONTH PARTS / 90-DAY LABOR WARRANTY"],
  [/12-Month\/12,000-Mile/g, "12-Month Parts / 90-Day Labor"],
  [/12-Month, 12,000-Mile Warranty/g, "12-Month Parts / 90-Day Labor Warranty"],
  [/12-month, 12,000-mile warranty/g, "12-month parts / 90-day labor warranty"],
  [/12-month\/12,000-mile warranty/g, "12-month parts / 90-day labor warranty"],
  [/12-month \/ 12,000-mile warranty/g, "12-month parts / 90-day labor warranty"],

  // -- competitor / dealership descriptions: drop mileage only, keep truthful "12 months"
  [/12 months or 12,000 miles on parts and labor/g, "12 months on parts and labor"],
  [/12 months or 12,000 miles on non-warranty repair work/g, "12 months on non-warranty repair work"],

  // -- broad fallbacks LAST (after every contextual rule above) --
  [/12-month \/ 12,000-mile/g, "12-month parts / 90-day labor"],
  [/12 months \/ 12,000 miles/g, "12-month parts / 90-day labor"],
  [/12 months or 12,000 miles/g, "12 months"],

  // ─── FINANCING: $0 down → $10 down ($10 is real Acima minimum) ──
  [/\$0[- ]down/g, "$10 down"],
  [/\$0 Down/g, "$10 Down"],

  // ─── FAQ: "appointments recommended" contradicts FCFS ──────────
  [
    /Walk-ins are welcome, but appointments are recommended for faster service\./g,
    "No appointment needed — first come, first served, 7 days a week.",
  ],

  // ─── CONTACT: GPS coords were 3.6km off from real address ──────
  // wave-183: REMOVED 4 GPS-coord rules — they reverted the canonical
  // Google-pinned coords (41.5525118 / -81.5571875) to the WRONG 41.5855 /
  // -81.5268. business.ts wave-170 is canonical — Google wins. Do not re-add.
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile() && entry.name.endsWith(".html")) out.push(p);
  }
  return out;
}

function patchFile(filePath) {
  const before = fs.readFileSync(filePath, "utf8");
  let after = before;
  const hits = new Map();
  for (const [pattern, replacement] of EDITS) {
    const matches = after.match(pattern);
    if (matches) {
      hits.set(pattern.source, matches.length);
      after = after.replace(pattern, replacement);
    }
  }
  if (after !== before) {
    fs.writeFileSync(filePath, after, "utf8");
    return hits;
  }
  return null;
}

function main() {
  if (!fs.existsSync(PRERENDER_DIR)) {
    console.error(`[patch-prerender] ${PRERENDER_DIR} not found`);
    process.exit(1);
  }

  const files = walk(PRERENDER_DIR);
  console.log(`[patch-prerender] Scanning ${files.length} HTML files…`);

  let filesPatched = 0;
  const totalsByPattern = new Map();

  for (const file of files) {
    const hits = patchFile(file);
    if (hits) {
      filesPatched++;
      for (const [pat, n] of hits) {
        totalsByPattern.set(pat, (totalsByPattern.get(pat) ?? 0) + n);
      }
    }
  }

  console.log(`\n[patch-prerender] ${filesPatched} / ${files.length} files patched.`);
  console.log(`[patch-prerender] Replacement counts by pattern:`);
  for (const [pat, n] of Array.from(totalsByPattern.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)} × /${pat}/`);
  }

  // Sanity check — no stale copy should remain.
  let stragglers = 0;
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    // Warranty stragglers are anchored to warranty tokens (…-mile warranty,
    // …-mi warranty, PropertyValue value, tier variants) so they never flag
    // the legitimate NON-warranty copy that also contains "12,000" (e.g. a
    // "$12,000 replacement car", "every 12,000 miles" brake interval).
    if (
      /\$0[- ]down|36-month warranty|36 months \/ 36,000|appointments are recommended for faster service|12,000-mile warranty|12,000-mi warranty|12,000-mile install|12,000-mile alignment|24,000-mile|"12 months \/ 12,000 miles"/i.test(
        content,
      )
    ) {
      stragglers++;
      if (stragglers <= 5) console.log(`  STRAGGLER: ${path.relative(ROOT, file)}`);
    }
  }
  if (stragglers > 0) {
    console.log(`\n[patch-prerender] WARNING: ${stragglers} files still contain stale copy. Investigate before commit.`);
    process.exit(2);
  }
  console.log(`\n[patch-prerender] ✓ Zero stragglers — all targeted stale copy removed.`);
}

main();
