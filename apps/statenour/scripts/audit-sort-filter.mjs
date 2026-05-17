#!/usr/bin/env node
/**
 * audit-sort-filter.mjs · v10.0.444
 *
 * Surveys list-heavy operator surfaces to determine which have:
 *   · sort controls (visible <select> for sortKey)
 *   · filter controls (search input + filter chips/dropdowns)
 *   · neither
 *
 * Output: report listing where sort+filter is consistent and where
 * it's missing.
 *
 * v10.0.444 · widened FILTER_PATTERNS to recognize Set-based multi-
 * select filters (e.g. /system/alerts uses `useState<Set<string>>` +
 * `toggleCategory` — was being mis-classified as "sort only").
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e);
    let s; try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) walk(full, out);
    else if (e === "page.tsx") out.push(full.replace(/\\/g, "/"));
  }
  return out;
}

const SORT_PATTERNS = [
  /\bsortKey\b/,
  /\bsortBy\b/,
  /\bSORT_OPTIONS\b/,
  /<select[^>]*onChange.*sort/is,
  /sort=\{/,
  /<SortDropdown\b/,
  /searchParams\?\.\w*[Ss]ort/i, // URL-driven sort (?sort=)
];

const FILTER_PATTERNS = [
  /\bfilter\b.*useState/i,
  /\bset[A-Z]\w*Filter\(/, // catches setFilter, setKindFilter, setPlatformFilter, etc.
  /searchQuery|searchTerm|setSearch/i,
  /<input[^>]*type=["']search["']/i,
  /\bfilterBy\b/,
  /<FilterChipBar\b/,
  /<FilterPill\b/,
  /searchParams\?\.\w+|\.searchParams\.get\(["']q["']\)/i, // URL-driven filter
  // v10.0.444 · Set-based multi-select filter (e.g. /system/alerts uses
  // useState<Set<string>>(new Set(ALL_CATS)) + toggleCategory). Only the
  // typed-Set-of-string form qualifies — prevents false positives from
  // unrelated WeakSet / Set<number> uses elsewhere in the codebase.
  /useState<Set<string>>/,
  /\btoggle[A-Z]\w*\s*\(.*string/, // toggleCategory(cat: string) handler
];

const SEARCH_PATTERNS = [
  /<input[^>]*type=["']search["']/i,
  /placeholder=.*search/i,
];

const pages = walk("app/(mastery)");
const findings = [];

for (const p of pages) {
  const text = readFileSync(p, "utf8");
  const len = text.length;
  // Heuristic for list-heavy: has .map( + array iteration + 200+ LOC
  const mapsArrays = (text.match(/\.map\s*\(/g) ?? []).length;
  const isListHeavy = mapsArrays >= 3 && len > 5000;

  const hasSort = SORT_PATTERNS.some((re) => re.test(text));
  const hasFilter = FILTER_PATTERNS.some((re) => re.test(text));
  const hasSearch = SEARCH_PATTERNS.some((re) => re.test(text));

  findings.push({
    page: p.replace("app/(mastery)/", "").replace("/page.tsx", "") || "(root)",
    hasSort,
    hasFilter,
    hasSearch,
    isListHeavy,
    mapCount: mapsArrays,
    chars: len,
  });
}

// Categorize
const listHeavy = findings.filter((f) => f.isListHeavy);
const sortAndFilter = listHeavy.filter((f) => f.hasSort && (f.hasFilter || f.hasSearch));
const filterOnly = listHeavy.filter((f) => !f.hasSort && (f.hasFilter || f.hasSearch));
const sortOnly = listHeavy.filter((f) => f.hasSort && !f.hasFilter && !f.hasSearch);
const neither = listHeavy.filter((f) => !f.hasSort && !f.hasFilter && !f.hasSearch);

console.log(`=== sort+filter audit · ${findings.length} pages scanned · ${listHeavy.length} list-heavy ===\n`);

function printGroup(name, list) {
  console.log(`${name} · ${list.length}`);
  for (const f of list.sort((a, b) => b.chars - a.chars)) {
    const tags = [];
    if (f.hasSort) tags.push("sort");
    if (f.hasFilter) tags.push("filter");
    if (f.hasSearch) tags.push("search");
    console.log(`  · /${f.page.padEnd(30)} ${tags.join(" + ").padEnd(25)} (${f.mapCount} maps · ${(f.chars / 1024).toFixed(1)}KB)`);
  }
  console.log("");
}

printGroup("✓ sort + filter (the gold standard)", sortAndFilter);
printGroup("⚠ filter only (no sort)", filterOnly);
printGroup("⚠ sort only (no filter)", sortOnly);
printGroup("✗ neither", neither);
