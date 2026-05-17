#!/usr/bin/env tsx
/**
 * v8.26 · One-shot migration: add `requireSession` to mutating route
 * handlers that lack any recognized auth pattern.
 *
 * Idempotent — skips files that already have any of:
 *   apiHandler / cronHandler / syncHandler / requireSession /
 *   requireCronAuth / requireSyncAuth / assertRunnerRequest /
 *   EXPECTED_SECRET / SYNC_KEY / "// public:"
 *
 * Operation per matched file:
 *   1. Add `import { requireSession } from "@/lib/auth-guard";` after
 *      the last import line if not present.
 *   2. For each `export async function (POST|PATCH|PUT|DELETE)(req...)`
 *      inject `await requireSession(req);` as the first line of the
 *      function body (works for `try {`-first or bare-body shape).
 *
 * Run:  pnpm exec tsx scripts/add-route-auth.ts
 * Dry:  pnpm exec tsx scripts/add-route-auth.ts --dry
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const DRY = process.argv.includes("--dry");
const AUTH_PATTERNS =
  /apiHandler|cronHandler|syncHandler|requireSession|requireCronAuth|requireSyncAuth|assertRunnerRequest|EXPECTED_SECRET|SYNC_KEY|\/\/ public:/;

const REQ_AUTH_IMPORT = `import { requireSession } from "@/lib/auth-guard";`;
const AUTH_CALL = `await requireSession(req);`;

const out = execSync(`find app/api -name "route.ts" -type f`, { encoding: "utf8" });
const files = out.split("\n").filter(Boolean);

let touched = 0;
let skipped = 0;
const changes: string[] = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");

  // Skip files without a mutating handler.
  if (!/^export (async )?(function|const) (POST|PATCH|PUT|DELETE)/m.test(src)) {
    continue;
  }
  // Skip files that already have any recognized auth.
  if (AUTH_PATTERNS.test(src)) {
    skipped++;
    continue;
  }

  let next = src;

  // 1. Add the import after the last `import` line at module top.
  if (!next.includes(REQ_AUTH_IMPORT)) {
    const importLines = next.match(/^import .+;\s*$/gm) ?? [];
    if (importLines.length === 0) {
      // No imports at all — prepend at top.
      next = `${REQ_AUTH_IMPORT}\n${next}`;
    } else {
      const last = importLines[importLines.length - 1];
      const idx = next.lastIndexOf(last);
      const insertAt = idx + last.length;
      next = `${next.slice(0, insertAt)}\n${REQ_AUTH_IMPORT}${next.slice(insertAt)}`;
    }
  }

  // 2. For each mutating handler, inject the auth call.
  // Strategy: find handler signatures, detect the request param name,
  // build `await requireSession(<param>);` from scratch (don't use
  // string-replace on AUTH_CALL — that bites when the param is `_req`
  // or `request` because `req` substring lives inside `requireSession`
  // too).
  const buildCall = (paramName: string) => `await requireSession(${paramName});`;
  // If the underscored `_req` is used, that's a deliberate "unused"
  // marker. Drop the underscore for the call so we DO use it.
  const usableParam = (raw: string) => (raw.startsWith("_") ? raw.slice(1) : raw);

  const fnRe =
    /export\s+async\s+function\s+(POST|PATCH|PUT|DELETE)\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\{/g;
  next = next.replace(fnRe, (match, _verb, args) => {
    const paramMatch = args.match(/^\s*(\w+)/);
    const rawName = paramMatch ? paramMatch[1] : "req";
    const useName = usableParam(rawName);
    // If the original param was `_req`, rename it to `req` so the call
    // compiles AND so future maintainers see the param is now used.
    const fixedSig =
      rawName !== useName
        ? match.replace(`(${args})`, `(${args.replace(rawName, useName)})`)
        : match;
    return `${fixedSig}\n  ${buildCall(useName)}`;
  });

  // Const-arrow shape: `export const POST = async (req...) => {`
  const constRe =
    /export\s+const\s+(POST|PATCH|PUT|DELETE)\s*=\s*async\s*\(([^)]*)\)\s*(?::\s*[^=]+)?=>\s*\{/g;
  next = next.replace(constRe, (match, _verb, args) => {
    const paramMatch = args.match(/^\s*(\w+)/);
    const rawName = paramMatch ? paramMatch[1] : "req";
    const useName = usableParam(rawName);
    const fixedSig =
      rawName !== useName
        ? match.replace(`(${args})`, `(${args.replace(rawName, useName)})`)
        : match;
    return `${fixedSig}\n  ${buildCall(useName)}`;
  });

  if (next === src) {
    // No mutating handler matched our regex — log and skip.
    console.log(`[skip:no-match] ${file}`);
    continue;
  }

  if (DRY) {
    changes.push(file);
  } else {
    writeFileSync(file, next, "utf8");
    changes.push(file);
  }
  touched++;
}

console.log(`\n${DRY ? "DRY " : ""}touched: ${touched} files`);
console.log(`already-authed: ${skipped} files`);
if (changes.length > 0) {
  console.log("\nfiles changed:");
  for (const c of changes) console.log(`  ${c}`);
}
