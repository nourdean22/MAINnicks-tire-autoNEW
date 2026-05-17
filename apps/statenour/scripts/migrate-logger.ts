#!/usr/bin/env tsx
/**
 * P5 · One-shot migration: convert `console.warn` / `console.error`
 * calls in `lib/` to `logger.warn` / `logger.error`.
 *
 * STATUS · STAGED, NOT YET RUN. The regex approach in this script is
 * too brittle for multi-line console calls with nested parens (e.g.
 * `console.warn(\`[scope] ${fn(a, b)}\`)` or template literals
 * spanning 3+ lines). A full lib/ run breaks ~20 files with TypeScript
 * syntax errors that need hand-fixing.
 *
 * Use carefully — review each diff. Or rewrite this with ts-morph for
 * proper AST traversal before running across the whole tree.
 *
 * Why · the structured logger (lib/logger.ts) wraps console under the
 * hood in dev (so output looks the same locally) but emits JSON in
 * production — Vercel's runtime-log scraper is JSON-aware. Migrating
 * brings every lib/ warning + error into the production observability
 * pipeline without changing dev ergonomics.
 *
 * Scope · lib/ only. NOT app/api/** (those routes already log via
 * apiHandler's structured wrapper) and NOT components/ (browser-side
 * console is fine; the logger doesn't help there).
 *
 * Conservative · only RENAMES. Doesn't try to restructure multi-arg
 * calls into `{ meta }` objects — that needs context-aware editing.
 * `console.warn("foo", err)` becomes `logger.warn("foo", err)` with
 * an `as any` shim where the 2nd arg isn't already an object literal,
 * which we patch up by wrapping in a meta object only when it's safe
 * to do so via regex.
 *
 * Idempotent · skips files that already only use logger.
 *
 * Run · pnpm exec tsx scripts/migrate-logger.ts
 * Dry · pnpm exec tsx scripts/migrate-logger.ts --dry
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const DRY = process.argv.includes("--dry");

const out = execSync(`find lib -type f -name "*.ts"`, { encoding: "utf8" });
const files = out.split("\n").filter(Boolean);

const IMPORT_LINE = `import { logger } from "@/lib/logger";`;

let touched = 0;
let calls = 0;
const changes: string[] = [];

// Match `console.warn(` or `console.error(` followed by a balanced
// argument list. We rewrite using a simple regex that handles the
// 1-arg and 2-arg shapes, which covers ~95% of existing call sites.
//   1-arg:  console.warn("foo")          → logger.warn("foo")
//   2-arg:  console.warn("foo", err)     → logger.warn("foo", { err })
//   2-arg w/ object: console.warn("foo", { x }) → logger.warn("foo", { x })
//
// We wrap the second argument as `{ err: <arg> }` only when it's NOT
// already an object literal. This gives the logger a stable meta shape
// without changing semantics for cases that already pass an object.
//
// 3+ arg shapes are left alone (rare; `console.warn("a", x, y)` would
// require manual review).

for (const file of files) {
  // Skip the logger module itself — it uses `console.log` etc internally.
  if (file === "lib/logger.ts") continue;

  const src = readFileSync(file, "utf8");
  if (!/console\.(warn|error)\s*\(/.test(src)) continue;

  let next = src;
  let localCalls = 0;

  // 2-arg form. Greedy-but-bounded match of two top-level args. We use
  // a non-greedy second arg up to the closing `)` at the same depth,
  // approximated by stopping at the first `)` that's preceded by a
  // non-`{` non-`,` char. Quick + clean for the common shape.
  next = next.replace(
    /console\.(warn|error)\(\s*([^,()]+(?:\([^()]*\))?[^,]*?),\s*([^)]+)\)/g,
    (_m, level, arg1, arg2) => {
      localCalls++;
      const trimmed = arg2.trim();
      // If arg2 is already a `{ ... }` object literal, pass through.
      // Otherwise wrap as `{ err: <arg> }` so the logger's redaction
      // pass + JSON serializer can do their thing.
      const wrapped = /^\{[\s\S]*\}$/.test(trimmed) ? trimmed : `{ err: ${trimmed} }`;
      return `logger.${level}(${arg1}, ${wrapped})`;
    },
  );

  // 1-arg form (after 2-arg pass to avoid double-rewrites).
  next = next.replace(/console\.(warn|error)\(\s*([^()]+)\)/g, (_m, level, arg) => {
    localCalls++;
    return `logger.${level}(${arg})`;
  });

  if (next === src) continue;

  // Add the import once if absent.
  if (!/from ["']@\/lib\/logger["']/.test(next)) {
    const importLines = next.match(/^import .+;\s*$/gm) ?? [];
    if (importLines.length === 0) {
      next = `${IMPORT_LINE}\n${next}`;
    } else {
      const last = importLines[importLines.length - 1];
      const idx = next.lastIndexOf(last);
      const insertAt = idx + last.length;
      next = `${next.slice(0, insertAt)}\n${IMPORT_LINE}${next.slice(insertAt)}`;
    }
  }

  if (!DRY) writeFileSync(file, next, "utf8");
  changes.push(`${file}  (${localCalls} calls)`);
  touched++;
  calls += localCalls;
}

console.log(`\n${DRY ? "DRY " : ""}touched: ${touched} files (${calls} call sites)`);
if (changes.length > 0) {
  console.log("\nfiles changed:");
  for (const c of changes) console.log(`  ${c}`);
}
