#!/usr/bin/env node
/**
 * Source linting — custom, zero-dep, enforces the rules that matter for this
 * codebase without pulling in 80MB of ESLint deps. Pairs with `tsc --noEmit`
 * for type safety; this script catches style + anti-patterns tsc misses.
 *
 * Rules (hard fail on any):
 *   - no-console-in-server: server/ must not call console.log/warn/error.
 *     Use createLogger() instead. (console.info / .debug allowed.)
 *
 * Soft reports (warning only, doesn't fail the run):
 *   - `: any` or `as any` usage count — tracked but not enforced yet
 *   - TODO/FIXME count
 *   - raw SQL count in routers
 *
 * Run: pnpm run lint:source
 * Fix: there is no auto-fix; address each hit by hand (it's intentional).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── Config ────────────────────────────────────────
const EXEMPT_FILES = new Set([
  "server/lib/logger.ts",        // the logger itself
  "server/lib/sentry.ts",        // boot-time — logger may not be ready
  "server/_core/index.ts",       // boot-time console
  // wave-127c — eval runner is a CLI script invoked via `pnpm test:ai-evals`
  // and writes status to stdout for the human + CI. createLogger() routes to
  // structured JSON which the eval reporter doesn't read. console is correct.
  "server/lib/ai/evals/blog-seeder/runner.ts",
]);

const ALLOW_CONSOLE_INFO = true;  // console.info is acceptable
const ALLOW_CONSOLE_DEBUG = true; // console.debug is acceptable

// ─── Tree walk ─────────────────────────────────────
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(p, out);
    } else if (entry.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx"))) {
      if (p.endsWith(".test.ts") || p.endsWith(".test.tsx")) continue;
      out.push(p);
    }
  }
  return out;
}

// ─── Rules ─────────────────────────────────────────
const serverFiles = walk(path.join(ROOT, "server"));

let errors = 0;
const stats = {
  consoleHits: 0,
  anyHits: 0,
  rawSqlHits: 0,
  todoHits: 0,
};

for (const file of serverFiles) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  if (EXEMPT_FILES.has(rel)) continue;

  const src = fs.readFileSync(file, "utf8");
  const lines = src.split("\n");

  lines.forEach((line, idx) => {
    // no-console-in-server
    const mConsole = /\bconsole\.(log|warn|error)\s*\(/.exec(line);
    if (mConsole) {
      // Skip commented lines
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      console.error(`${rel}:${idx + 1} console.${mConsole[1]}() — use createLogger() instead`);
      errors++;
      stats.consoleHits++;
    }

    // soft: any
    if (/\b:\s*any\b|\bas\s+any\b/.test(line)) stats.anyHits++;
    // soft: raw SQL
    if (/\bsql`[A-Z]/.test(line)) stats.rawSqlHits++;
    // soft: todo
    if (/\b(TODO|FIXME|XXX|HACK)\b/.test(line)) stats.todoHits++;
  });
}

// ─── Summary ───────────────────────────────────────
console.log("");
console.log("─── source lint summary ───");
console.log(`  any / as any usages:  ${stats.anyHits} (soft — target < 100)`);
console.log(`  raw SQL queries:      ${stats.rawSqlHits} (soft)`);
console.log(`  TODO / FIXME markers: ${stats.todoHits} (soft)`);
console.log(`  forbidden console.* : ${stats.consoleHits}`);
console.log("");

if (errors > 0) {
  console.error(`\n\u2717 ${errors} errors. Fix them and re-run.\n`);
  process.exit(1);
}

console.log("\u2713 source lint passed");
