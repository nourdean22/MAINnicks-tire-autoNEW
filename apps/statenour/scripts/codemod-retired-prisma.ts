/**
 * Codemod — replace retired `prisma.MODEL.METHOD(...)` calls with
 * equivalent zero-value literals. Shim in lib/prisma.ts already
 * returns these same values at runtime; this replacement just
 * eliminates the shim round-trip (dead JS + JIT overhead).
 *
 * v2 — PAREN-BALANCED. Matches exactly one `prisma.MODEL.METHOD(` +
 * walks braces until the matching `)`. Does NOT consume trailing
 * `.catch(...)` or `.then(...)` — those we leave in place since the
 * Promise resolve chain keeps them safe and no-op.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const DRY = !process.argv.includes("--apply");

const MODELS = [
  "dailyScore",
  "openLoop",
  "morningBrief",
  "masteryHabit",
  "weeklyReview",
  "notificationQueue",
  "integrationSyncLog",
  "simulation",
  "cameraRecording",
  "brokenPromiseLog",
  "cameraMetric",
  "cameraAlert",
  "knownFace",
  "plateLog",
  "applicant",
  "appointmentRequest",
  "googleReview",
  "smsLog",
  "contentPost",
  "contentCalendar",
  "projection",
  "scraperRun",
  "competitorPrice",
  "paymentRecord",
  "laborOperation",
  "quoteTemplate",
  "quoteItem",
  "quote",
  "markupRule",
  "tire",
  "lead",
  "job",
  "customerProfile",
  "customer",
];

const METHOD_DEFAULTS: Record<string, string> = {
  // `as any` (+ `as any[]`) so downstream callers that treat results
  // as the prior Prisma type don't all 404 on property access. Keeps
  // ~350 type errors from splattering the build. The whole point of
  // this codemod is "behaviorally identical to shim but no DB hop"
  // — type-looseness is the cost of not rewriting every caller.
  findMany: "Promise.resolve([] as any[])",
  findFirst: "Promise.resolve(null as any)",
  findUnique: "Promise.resolve(null as any)",
  findUniqueOrThrow: "Promise.resolve(null as any)",
  count: "Promise.resolve(0)",
  aggregate: "Promise.resolve({ _count: 0, _avg: {}, _sum: {}, _min: {}, _max: {} } as any)",
  groupBy: "Promise.resolve([] as any[])",
  deleteMany: "Promise.resolve({ count: 0 })",
  updateMany: "Promise.resolve({ count: 0 })",
  createMany: "Promise.resolve({ count: 0 })",
  create: "Promise.resolve(null as any)",
  update: "Promise.resolve(null as any)",
  upsert: "Promise.resolve(null as any)",
  delete: "Promise.resolve(null as any)",
};

function findCallEnd(src: string, openParenIdx: number): number {
  // openParenIdx must point at '('
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = openParenIdx; i < src.length; i++) {
    const ch = src[i];
    const prev = src[i - 1];
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "/" && prev === "*") inBlockComment = false;
      continue;
    }
    if (!inSingle && !inDouble && !inTemplate && ch === "/" && src[i + 1] === "/") {
      inLineComment = true;
      continue;
    }
    if (!inSingle && !inDouble && !inTemplate && ch === "/" && src[i + 1] === "*") {
      inBlockComment = true;
      continue;
    }
    if (!inDouble && !inTemplate && ch === "'" && prev !== "\\") inSingle = !inSingle;
    else if (!inSingle && !inTemplate && ch === '"' && prev !== "\\") inDouble = !inDouble;
    else if (!inSingle && !inDouble && ch === "`" && prev !== "\\") inTemplate = !inTemplate;
    else if (!inSingle && !inDouble && !inTemplate) {
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
  }
  return -1;
}

const files = execSync(
  `grep -rlE "prisma\\.(${MODELS.join("|")})\\." lib app 2>/dev/null || true`,
  { encoding: "utf8", cwd: process.cwd() },
)
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);

console.log(`scanning ${files.length} files`);

let totalReplacements = 0;
let totalSkipped = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");
  let out = "";
  let cursor = 0;
  let fileReplacements = 0;

  // v2.1 · Allow whitespace/newlines between `.MODEL` and `.METHOD`
  // for multi-line-formatted Prisma calls (e.g. `prisma.quote\n   .findMany(...)`).
  const callRegex = new RegExp(
    `prisma\\.(${MODELS.join("|")})\\s*\\.\\s*(${Object.keys(METHOD_DEFAULTS).join("|")})\\s*\\(`,
    "g",
  );

  while (true) {
    callRegex.lastIndex = cursor;
    const m = callRegex.exec(src);
    if (!m) break;
    const matchStart = m.index;
    const openParenIdx = matchStart + m[0].length - 1;
    const callEnd = findCallEnd(src, openParenIdx);
    if (callEnd < 0) {
      // malformed — skip this match, keep going from after it
      out += src.slice(cursor, openParenIdx + 1);
      cursor = openParenIdx + 1;
      totalSkipped++;
      continue;
    }
    const method = m[2];
    out += src.slice(cursor, matchStart);
    out += METHOD_DEFAULTS[method];
    cursor = callEnd;
    fileReplacements++;
  }
  out += src.slice(cursor);

  if (fileReplacements > 0) {
    const lineDelta = (src.match(/\n/g) || []).length - (out.match(/\n/g) || []).length;
    console.log(
      `${DRY ? "[dry]" : "[apply]"} ${file} · ${fileReplacements} replacements · -${Math.max(0, lineDelta)} lines`,
    );
    if (!DRY) writeFileSync(file, out, "utf8");
    totalReplacements += fileReplacements;
  }
}

console.log(`\n${totalReplacements} replacements ${DRY ? "planned" : "applied"} · ${totalSkipped} skipped (malformed)`);
if (DRY) console.log("re-run with --apply to write files");
