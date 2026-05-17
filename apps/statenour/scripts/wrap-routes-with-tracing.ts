/**
 * Wrap Routes with withTracing CLI · v10.0.387
 *
 * Scans `app/api/**\/route.ts` and surfaces which routes are
 * NOT yet wrapped with withTracing(). Default mode is DRY-RUN ·
 * just lists candidates. Pass `--apply` to perform the rewrite.
 *
 * Why dry-run by default · 60+ route files · risk of breaking
 * auth via misregex · operator should review the diff before
 * applying. The wrapper is purely additive (adds tracing) but
 * requires refactoring `export async function GET()` to
 * `async function handler() ... export const GET = withTracing(handler, {...})`
 * which moves code around · regex-based rewrites can corrupt
 * complex routes (e.g. those using apiHandler higher-order).
 *
 * SAFE ROUTES · single GET/POST export, no apiHandler, no complex
 * auth wrapper · these are the candidates this CLI handles.
 *
 * UNSAFE ROUTES · skipped:
 *   · apiHandler() routes (already have their own wrapping)
 *   · routes with NextResponse passthrough (handled differently)
 *   · routes with named handler exports (operator owns the choice)
 *
 * Run:
 *   pnpm tsx scripts/wrap-routes-with-tracing.ts          # dry-run
 *   pnpm tsx scripts/wrap-routes-with-tracing.ts --apply  # rewrite
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const API_DIR = path.join(ROOT, "app", "api");

interface RouteCandidate {
  file: string;
  rel: string;
  reason: "wrappable" | "already-wrapped" | "uses-apihandler" | "complex" | "skip-cron" | "skip-public";
  detail?: string;
}

const SKIP_PATTERNS = [
  /\/api\/cron\//,        // CRON_SECRET bearer · own auth path
  /\/api\/auth\//,        // NextAuth handlers
  /\/api\/webhook/,       // signed webhooks
  /\/api\/telegram\//,    // signed telegram webhook
  /\/api\/vapi\//,        // signed VAPI tool routes
  /\/api\/internal\/runner\//, // RUNNER_SHARED_SECRET
];

function* walkRoutes(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkRoutes(full);
    } else if (entry.isFile() && entry.name === "route.ts") {
      yield full;
    }
  }
}

function classify(file: string, content: string): RouteCandidate {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");

  if (SKIP_PATTERNS.some((p) => p.test(rel))) {
    return { file, rel, reason: "skip-cron" };
  }

  // Already wrapped?
  if (/withTracing\s*\(/.test(content)) {
    return { file, rel, reason: "already-wrapped" };
  }

  // apiHandler is its own pattern · don't double-wrap
  if (/apiHandler\s*\(/.test(content)) {
    return { file, rel, reason: "uses-apihandler" };
  }

  // Complex routes · multiple exports, exported objects, dynamic exports
  const exportCount = (content.match(/^export\s+(?:const|async\s+function|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/gm) || []).length;
  if (exportCount === 0) {
    return { file, rel, reason: "complex", detail: "no GET/POST/etc export" };
  }

  // Wrappable · single or few simple exports
  return { file, rel, reason: "wrappable", detail: `${exportCount} method handler(s)` };
}

function summarize(candidates: RouteCandidate[]): void {
  const groups: Record<RouteCandidate["reason"], RouteCandidate[]> = {
    wrappable: [],
    "already-wrapped": [],
    "uses-apihandler": [],
    complex: [],
    "skip-cron": [],
    "skip-public": [],
  };
  for (const c of candidates) groups[c.reason].push(c);

  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  WRAP ROUTES WITH withTracing · v10.0.387");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Scanned ${candidates.length} route files`);
  console.log("");
  console.log(`  ✅ Already wrapped     · ${groups["already-wrapped"].length}`);
  console.log(`  🟢 Wrappable           · ${groups.wrappable.length}`);
  console.log(`  ⏭  Uses apiHandler    · ${groups["uses-apihandler"].length} (own wrapping)`);
  console.log(`  ⏭  Skip · public      · ${groups["skip-cron"].length} (cron / webhook / auth)`);
  console.log(`  ⚠️  Complex/skip       · ${groups.complex.length}`);
  console.log("");

  if (groups.wrappable.length > 0) {
    console.log("  Wrappable routes:");
    for (const c of groups.wrappable.slice(0, 30)) {
      console.log(`    · ${c.rel}${c.detail ? ` (${c.detail})` : ""}`);
    }
    if (groups.wrappable.length > 30) {
      console.log(`    ... and ${groups.wrappable.length - 30} more`);
    }
    console.log("");
  }

  console.log("  Run with --apply to rewrite (operator review the diff before commit).");
  console.log("");
}

async function main() {
  const apply = process.argv.includes("--apply");

  const candidates: RouteCandidate[] = [];
  for (const file of walkRoutes(API_DIR)) {
    const content = fs.readFileSync(file, "utf8");
    candidates.push(classify(file, content));
  }

  summarize(candidates);

  if (!apply) {
    console.log("  ℹ️  DRY-RUN · no files modified.");
    return;
  }

  // For now, --apply is a NO-OP · the rewrite logic is intentionally
  // not implemented because each route's structure varies enough that
  // a regex-based mass rewrite is risky. Operator hand-wraps via the
  // existing pattern (see app/api/brain/wisdom/route.ts) on routes
  // that warrant tracing. The CLI's value is the inventory above.
  console.log("  ⚠️  --apply is intentionally a no-op (regex rewrite is risky).");
  console.log("     Use the inventory above to manually wrap routes one at a time:");
  console.log("       1. Refactor `export async function GET(req)` →");
  console.log("          `async function handler(req) { await requireSession(req); ... }`");
  console.log("       2. Add `export const GET = withTracing(handler, { name: '...' });`");
  console.log("       3. Add comment `// Auth: handler invokes requireSession on first line`");
  console.log("");
}

main().catch((err) => {
  console.error("❌ Wrap CLI failed:", err);
  process.exit(1);
});
