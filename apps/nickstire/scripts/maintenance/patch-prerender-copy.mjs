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
  // ─── WARRANTY: 36mo → 12mo (BUSINESS.warranty was wrong) ──────
  // Full phrase variants
  [/36 months \/ 36,000 miles/g, "12 months / 12,000 miles"],
  [/36-month\/36,000-mile/g, "12-month/12,000-mile"],
  [/36-month warranty/g, "12-month warranty"],
  [/36-mo warranty/g, "12-mo warranty"],
  [/"36 months \/ 36,000 miles"/g, '"12 months / 12,000 miles"'], // JSON-LD PropertyValue

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
    if (/\$0[- ]down|36-month warranty|36 months \/ 36,000|appointments are recommended for faster service/.test(content)) {
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
