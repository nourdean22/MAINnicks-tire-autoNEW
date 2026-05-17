#!/usr/bin/env node
/**
 * Local prerender drift check.
 *
 * Mirrors the .github/workflows/verify-prerender.yml logic so devs
 * can run it before pushing instead of finding out via failed CI.
 * Also useful when a regen feels off — fast sanity check that the
 * prerendered/ tree matches the route+blog source of truth.
 *
 * Run: pnpm prerender:check
 *
 * Exits 0 if MISSING <= 5 (matches CI threshold). Reports extras as
 * informational — DB-dynamic blogs surface as legit "extras" and
 * can't be predicted from static source.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PRERENDER_DIR = path.resolve(ROOT, "prerendered");

if (!fs.existsSync(PRERENDER_DIR)) {
  console.error(`[prerender:check] No prerendered/ at ${PRERENDER_DIR} — run 'pnpm run regen' first.`);
  process.exit(2);
}

// Compute expected set from PRERENDER_ROUTES + BLOG_SLUGS via tsx.
const expectedJson = execSync(
  `node --import tsx -e "import { PRERENDER_ROUTES, BLOG_SLUGS } from './shared/routes.ts'; const e = []; for (const r of PRERENDER_ROUTES) e.push(r.path === '/' ? 'index.html' : r.path.replace(/^\\//, '') + '/index.html'); for (const s of BLOG_SLUGS) e.push('blog/' + s + '/index.html'); console.log(JSON.stringify(e));"`,
  { cwd: ROOT, encoding: "utf-8", timeout: 15000 }
);
const expected = new Set(JSON.parse(expectedJson));

// Compute actual set from prerendered/.
const actual = new Set();
function walk(dir, prefix = "") {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(full, rel);
    else if (entry.name === "index.html") actual.add(rel);
  }
}
walk(PRERENDER_DIR);

const missing = [...expected].filter(x => !actual.has(x)).sort();
const extra = [...actual].filter(x => !expected.has(x)).sort();

console.log(`expected: ${expected.size}`);
console.log(`actual:   ${actual.size}`);
console.log(`missing:  ${missing.length}`);
console.log(`extra:    ${extra.length} (DB-dynamic blogs etc — informational)`);

if (missing.length > 0) {
  console.log("\nMissing (in source but not prerendered):");
  for (const m of missing.slice(0, 50)) console.log("  - " + m);
}
if (extra.length > 0 && process.env.VERBOSE) {
  console.log("\nExtras (prerendered but not in source — usually fine):");
  for (const e of extra.slice(0, 50)) console.log("  - " + e);
}

if (missing.length > 5) {
  console.error(`\nFAIL: ${missing.length} missing — run 'pnpm run regen'.`);
  process.exit(1);
}
console.log("\nOK.");
