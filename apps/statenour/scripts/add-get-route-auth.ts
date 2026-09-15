#!/usr/bin/env tsx
/**
 * v9.1.17 · One-shot migration: add `{ auth: "owner" }` to GET-only
 * apiHandler calls under operator-private paths (system/, brain/,
 * financial/, decisions/, audit/) that lack auth.
 *
 * Two passes:
 *   1. Files using `apiHandler(...)` — append `, { auth: "owner" }`
 *      before the matching `})`. Idempotent (skips files that
 *      already contain `auth: "owner"` or `auth: "cron"` etc).
 *   2. Files using `export async function GET(...)` — inject
 *      `await requireSession(req);` at the top of the function body
 *      and add the import if missing.
 *
 * PUBLIC ANNOTATION: any file that contains `// public:` is skipped.
 * Use this to whitelist genuinely public endpoints (heartbeat,
 * deploy-info, etc).
 *
 * Run: pnpm exec tsx scripts/add-get-route-auth.ts
 * Dry: pnpm exec tsx scripts/add-get-route-auth.ts --dry
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const DRY = process.argv.includes("--dry");
const SENSITIVE_PATHS = [
  "app/api/system",
  "app/api/brain",
  "app/api/financial",
  "app/api/decisions",
  "app/api/audit",
];

const AUTH_PATTERNS =
  /auth:\s*"(owner|cron|sync|evidence)"|requireSession|requireCronAuth|requireSyncAuth|requireEvidenceAuth|EXPECTED_SECRET|SYNC_KEY|\/\/ public:/;
const HAS_GET = /^export (async )?(function|const) GET/m;
const USES_API_HANDLER = /apiHandler\s*\(/;

const out = SENSITIVE_PATHS.flatMap((p) =>
  execSync(`find ${p} -name "route.ts" -type f`, { encoding: "utf8" })
    .split("\n")
    .filter(Boolean),
);

let touched = 0;
let skipped = 0;
const changes: string[] = [];

for (const file of out) {
  const src = readFileSync(file, "utf8");

  if (!HAS_GET.test(src)) {
    continue;
  }
  if (AUTH_PATTERNS.test(src)) {
    skipped++;
    continue;
  }

  let next = src;
  let updated = false;

  if (USES_API_HANDLER.test(src)) {
    // Find every `apiHandler(async ... { ... })` and append the options
    // arg. We do this by walking the file and inserting before each
    // top-level `})` that closes an apiHandler call. The tightest
    // safe heuristic: if the next non-whitespace lines after a `});`
    // are NOT `, { auth:`, append it.
    //
    // Strategy: regex-replace `^});` on lines whose enclosing context
    // matches an apiHandler call. Simpler heuristic: replace every
    // standalone `^});\s*$` (end of handler) with `}, { auth: "owner" });`.
    // The risk is over-replacement (e.g., closing a non-apiHandler
    // arrow). But this only runs on files we already validated have
    // a GET handler + no auth pattern + DO use apiHandler — we're
    // inside the safety envelope.
    next = next.replace(
      /^\}\);\s*$/gm,
      '}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts',
    );
    updated = next !== src;
  } else {
    // Direct `async function GET(req)` — inject requireSession at the
    // top of the function body. Add the import if missing.
    const hasImport = /from\s+["']@\/lib\/auth-guard["']/.test(next);
    if (!hasImport) {
      // Insert after the last import line.
      const lines = next.split("\n");
      let lastImport = -1;
      // v9.1.17 lesson · multi-line imports look like:
      //   import {
      //     A, B, C,
      //   } from "...";
      // Tracking the LAST line that ENDS an import statement (i.e.
      // ends with `;` AND the import keyword is on this line OR a
      // recent line with no closure between). Simplest robust check:
      // a line is the END of an import statement if it ends with `;`
      // AND either starts with `import` OR ends with `from "..."`.
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const endsImport =
          /^import\s.*;\s*$/.test(line) ||
          /from\s+["'][^"']+["'];\s*$/.test(line);
        if (endsImport) lastImport = i;
      }
      if (lastImport >= 0) {
        lines.splice(
          lastImport + 1,
          0,
          'import { requireSession } from "@/lib/auth-guard";',
        );
        next = lines.join("\n");
      } else {
        // No imports — prepend.
        next =
          'import { requireSession } from "@/lib/auth-guard";\n' + next;
      }
    }

    // Inject requireSession(req) at the top of the GET function body.
    // Match `export async function GET(<param>)` then `{` then inject.
    next = next.replace(
      /(export\s+async\s+function\s+GET\s*\(\s*([a-zA-Z_$][a-zA-Z_$0-9]*)\s*[^)]*\)\s*\{)/,
      (full, decl, paramName) => {
        return `${full}\n  await requireSession(${paramName});`;
      },
    );

    // Some routes have GET() with no parameter — inject an underscore-
    // prefixed req binding so requireSession has something to call.
    next = next.replace(
      /(export\s+async\s+function\s+GET\s*\(\s*\)\s*\{)/,
      (full) => {
        // Replace () with (req: Request) if it was empty.
        return full
          .replace(/GET\s*\(\s*\)/, "GET(req: Request)")
          .replace(/\{$/, "{\n  await requireSession(req);");
      },
    );

    updated = next !== src;
  }

  if (updated) {
    if (!DRY) {
      writeFileSync(file, next, "utf8");
    }
    touched++;
    changes.push(file);
  } else {
    skipped++;
  }
}

console.log(
  `\n${DRY ? "[DRY] " : ""}touched: ${touched} files · skipped: ${skipped}\n`,
);
for (const c of changes) console.log("  ✓", c);
