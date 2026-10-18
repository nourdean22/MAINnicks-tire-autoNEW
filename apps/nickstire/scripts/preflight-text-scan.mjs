#!/usr/bin/env node
// Tests that READ a changed file as text (readFileSync + a path literal) are not in
// vitest's import graph, so `vitest related` never selects them. #2978 merged with
// cronLockHandback.test.ts red that way; on 2026-10-18 (#3152) capability-ledger.json
// changed, preflight said all green, and CI failed on completionAuthority.test.ts,
// which reads that JSON at runtime. So the scan takes data files (json, md, sql, mjs)
// as well as source files: every test under server/ and client/src that names a
// changed file as "dir/base" or as "dir", "base" (path.join style) is selected.
//
//   node scripts/preflight-text-scan.mjs <changed path relative to apps/nickstire>...
//
// Prints one test path per line. Tested by server/__tests__/preflight-text-scan.test.ts.
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

const ROOTS = ["server", "client/src"];

function* testFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") yield* testFiles(p);
    } else if (/\.test\.tsx?$/.test(entry.name)) {
      yield p;
    }
  }
}

/** @param {string[]} changed paths relative to apps/nickstire @param {string} appDir */
function scanTestsNaming(changed, appDir = process.cwd()) {
  const keys = [];
  for (const f of changed) {
    if (/\.test\.tsx?$/.test(f)) continue; // a changed test runs by itself
    const base = basename(f);
    const dir = basename(dirname(f));
    if (!dir || dir === ".") continue;
    keys.push(`${dir}/${base}`, `"${dir}", "${base}"`);
  }
  if (keys.length === 0) return [];
  const hits = new Set();
  for (const root of ROOTS) {
    let files;
    try {
      files = [...testFiles(join(appDir, root))];
    } catch {
      continue;
    }
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (keys.some((k) => text.includes(k))) hits.add(relative(appDir, file).replace(/\\/g, "/"));
    }
  }
  return [...hits].sort();
}

for (const t of scanTestsNaming(process.argv.slice(2))) process.stdout.write(`${t}\n`);
