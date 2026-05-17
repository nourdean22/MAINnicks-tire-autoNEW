#!/usr/bin/env tsx
/**
 * v8.28 · One-shot migration: replace bare `fetch("/api/...")` callers
 * in client code with `authedFetch(...)`.
 *
 * Why · `authedFetch` (defined in hooks/use-authed-fetch.ts) is
 * API-compatible with `fetch` but adds:
 *   1. `credentials: "include"` so the session cookie always rides.
 *   2. Auto-retry once on 401 (cookie-arrival timing race).
 *   3. Hard redirect to /auth/sign-in when 401 persists.
 *
 * Scope · client-only files. Stays out of `app/api/**` and `lib/**` —
 * those are server modules where session cookies aren't a thing.
 *
 * Idempotent · skips files that already use `authedFetch`.
 *
 * Run · pnpm exec tsx scripts/migrate-authed-fetch.ts
 * Dry · pnpm exec tsx scripts/migrate-authed-fetch.ts --dry
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const DRY = process.argv.includes("--dry");
const ROOTS = ["components", "app/(mastery)", "hooks"];

const out = execSync(
  `find ${ROOTS.join(" ")} -type f \\( -name "*.ts" -o -name "*.tsx" \\)`,
  { encoding: "utf8" },
);
const files = out.split("\n").filter(Boolean);

const IMPORT_LINE = `import { authedFetch } from "@/hooks/use-authed-fetch";`;

let touched = 0;
let calls = 0;
const changes: string[] = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");

  // Skip the hook itself.
  if (file.endsWith("use-authed-fetch.ts")) continue;

  // Find bare `fetch("/api/...")` or `fetch(`/api/...`)` calls. The
  // `\b` is critical so we don't match `authedFetch(` we already added.
  const callRe = /(?<![a-zA-Z_$])fetch\(\s*(["'`])(\/api\/[^"'`]+)\1/g;
  if (!callRe.test(src)) continue;

  let next = src.replace(
    /(?<![a-zA-Z_$])fetch\(\s*(["'`])(\/api\/[^"'`]+)\1/g,
    (_m, q, path) => {
      calls++;
      return `authedFetch(${q}${path}${q}`;
    },
  );

  // Add import if absent.
  if (!/from ["']@\/hooks\/use-authed-fetch["']/.test(next)) {
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

  if (next === src) continue;

  if (!DRY) {
    writeFileSync(file, next, "utf8");
  }
  changes.push(file);
  touched++;
}

console.log(`\n${DRY ? "DRY " : ""}touched: ${touched} files (${calls} call sites)`);
if (changes.length > 0) {
  console.log("\nfiles changed:");
  for (const c of changes) console.log(`  ${c}`);
}
