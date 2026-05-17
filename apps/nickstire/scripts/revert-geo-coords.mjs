#!/usr/bin/env node
/**
 * wave-170 · Reverse-patch the wave-169 GPS-coord replacements in
 * prerendered/ HTML. wave-167 broadcast incorrect coords to the
 * schema.org LocalBusiness.geo field on every page; wave-169 propagated
 * those wrong coords into prerendered HTML; wave-170 reverts both back
 * to the Google-pinned canonical (41.5525118 / -81.5571875).
 *
 * The other wave-169 patches (warranty 12mo, $10 down, FCFS line) WERE
 * correct and stay applied.
 *
 * Run: node scripts/revert-geo-coords.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PRERENDER_DIR = path.join(ROOT, "prerendered");

const EDITS = [
  // Reverse the wave-169 lat/lng replacements
  [/"latitude":\s*41\.5855/g, '"latitude": 41.5525118'],
  [/"longitude":\s*-81\.5268/g, '"longitude": -81.5571875'],
  [/41\.5855/g, "41.5525118"],
  [/-81\.5268/g, "-81.5571875"],
];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

function patchFile(filePath) {
  const before = fs.readFileSync(filePath, "utf8");
  let after = before;
  const hits = new Map();
  for (const [pattern, replacement] of EDITS) {
    const m = after.match(pattern);
    if (m) {
      hits.set(pattern.source, m.length);
      after = after.replace(pattern, replacement);
    }
  }
  if (after !== before) {
    fs.writeFileSync(filePath, after, "utf8");
    return hits;
  }
  return null;
}

const files = walk(PRERENDER_DIR);
console.log(`[revert-geo] scanning ${files.length} html files…`);
let patched = 0;
const totals = new Map();
for (const f of files) {
  const hits = patchFile(f);
  if (hits) {
    patched++;
    for (const [pat, n] of hits) totals.set(pat, (totals.get(pat) ?? 0) + n);
  }
}
console.log(`[revert-geo] ${patched} files patched.`);
for (const [pat, n] of totals) console.log(`  ${String(n).padStart(5)} × /${pat}/`);

// Verify no stragglers of the wrong coords remain
let stragglers = 0;
for (const f of files) {
  const c = fs.readFileSync(f, "utf8");
  if (/41\.5855|-81\.5268/.test(c)) stragglers++;
}
if (stragglers > 0) {
  console.log(`[revert-geo] WARNING: ${stragglers} files still contain wrong coords.`);
  process.exit(2);
}
console.log(`[revert-geo] ✓ all reverted cleanly.`);
