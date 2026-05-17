#!/usr/bin/env tsx
/**
 * v9.1.19 · One-shot migration: add `checkAiRateLimit(req)` after
 * `await requireSession(req)` in direct-export AI routes.
 *
 * Targets a hand-picked list of routes that call AI providers and
 * use raw `export async function POST(req)` instead of apiHandler.
 *
 * Idempotent: skips files that already import or call checkAiRateLimit.
 *
 * Run: pnpm exec tsx scripts/add-ai-rate-limit.ts
 * Dry: pnpm exec tsx scripts/add-ai-rate-limit.ts --dry
 */

import { readFileSync, writeFileSync } from "node:fs";

const DRY = process.argv.includes("--dry");

const TARGETS = [
  "app/api/ai/assist/route.ts",
  "app/api/ai/coach-goal/route.ts",
  "app/api/ai/page-insight/route.ts",
  "app/api/ai/plan-day/route.ts",
  "app/api/ai/plan-project/route.ts",
  "app/api/ai/review/route.ts",
  "app/api/ai/suggest-goals/route.ts",
  "app/api/ai/teach/route.ts",
  "app/api/ai/track-story/route.ts",
  "app/api/ai/voice-to-content/route.ts",
  "app/api/chat/reword/route.ts",
];

let touched = 0;
let skipped = 0;

for (const file of TARGETS) {
  const src = readFileSync(file, "utf8");

  if (/checkAiRateLimit/.test(src)) {
    skipped++;
    continue;
  }

  let next = src;

  // Add the import after the requireSession import (if present) or
  // after the last import line.
  const reqSessionImport =
    /import\s*\{\s*requireSession\s*(?:,[^}]*)?\}\s*from\s*["']@\/lib\/auth-guard["'];?/;
  if (reqSessionImport.test(next)) {
    next = next.replace(reqSessionImport, (m) => {
      return `${m}\nimport { checkAiRateLimit } from "@/lib/rate-limit";`;
    });
  } else {
    // Skip if no requireSession — shape mismatch, do manually.
    skipped++;
    continue;
  }

  // Inject after the FIRST `await requireSession(<param>);` call
  // we find, in any function body.
  const reqCall = /(await\s+requireSession\s*\(\s*([a-zA-Z_$][\w$]*)\s*\)\s*;)/;
  const match = reqCall.exec(next);
  if (!match) {
    skipped++;
    continue;
  }
  next = next.replace(
    reqCall,
    `$1\n  const __aiLimit = checkAiRateLimit($2);\n  if (__aiLimit) return __aiLimit; // v9.1.19 · cost-bomb guard`,
  );

  if (next !== src) {
    if (!DRY) writeFileSync(file, next, "utf8");
    touched++;
    console.log(`  ✓ ${file}`);
  } else {
    skipped++;
  }
}

console.log(
  `\n${DRY ? "[DRY] " : ""}touched: ${touched} · skipped: ${skipped}`,
);
