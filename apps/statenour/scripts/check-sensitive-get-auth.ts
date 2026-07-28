/**
 * Sensitive GET-route auth coverage gate · v10.0.183
 *
 * Replaces the bash-based file-level grep that was missing this
 * critical class:
 *
 *   export async function GET(...) {  ← no auth here
 *     const conv = await prisma.findUnique(...);
 *   }
 *   export async function PATCH(req, ...) {
 *     await requireSession(req);  ← only PATCH guarded
 *   }
 *
 * Pre-v10.0.183 the bash gate did `grep requireSession` against the
 * whole file. The PATCH usage matched, the gate passed, the GET was
 * left unauthed. /api/ai/chat/[id]/route.ts shipped this way.
 *
 * v10.0.183 fix · scope the auth check to each handler's BODY, not
 * the file globally. We do this lexically: find each "export...GET"
 * declaration and scan its body for an auth signal.
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const SENSITIVE_PREFIXES = [
  "app/api/system",
  "app/api/brain",
  "app/api/financial",
  "app/api/decisions",
  "app/api/audit",
  "app/api/journal",
  "app/api/goals",
  "app/api/missions",
  "app/api/tasks",
  "app/api/commitments",
  "app/api/body",
  "app/api/habits",
  "app/api/score-daily",
  "app/api/devices",
  "app/api/pins",
  "app/api/mastery",
  "app/api/settings",
  "app/api/command",
  "app/api/sse",
  "app/api/chat",
  "app/api/actions-brain",
  "app/api/personal-logs",
  "app/api/analytics",
  "app/api/integrations",
  "app/api/drift",
  "app/api/ai",
  "app/api/conversations",
];

// 2026-07-28 cron-truth audit (dim 6): `validateToken` added — the
// chrome-extension bearer gate (app/api/brain/by-url) is a legitimate
// auth signal this checker was blind to. Kept deliberately NARROW
// otherwise: `await auth()` is NOT a signal — routes should use the
// canonical requireSession so one grep-able idiom guards them all.
const AUTH_SIGNAL =
  /(requireSession|requireCronAuth|requireSyncAuth|validateToken|EXPECTED_SECRET|SYNC_KEY|auth:\s*"(owner|cron|sync)"|\/\/\s*public:)/;

interface Violation {
  file: string;
  reason: string;
}

function listRoutes(): string[] {
  const out = execSync(
    `git ls-files ${SENSITIVE_PREFIXES.map((p) => `"${p}/**/route.ts"`).join(" ")}`,
    { encoding: "utf8" },
  );
  return out.split("\n").filter(Boolean);
}

/**
 * Find each handler's body and check for an auth signal inside it.
 * Returns one violation per unguarded handler.
 *
 * Heuristic: extract from `export ... GET(...)` (or function/const)
 * up to the matching closing brace. Limited to GET because mutating
 * routes (POST/PATCH/DELETE) are covered by the separate auth gate.
 *
 * Also handles `export const GET = apiHandler(...)` shape — those
 * declare auth via the apiHandler({ auth: "owner" }) options arg.
 */
function checkFile(file: string): Violation | null {
  const src = readFileSync(file, "utf8");

  // Allow the whole-file allowlist comment for intentional public GETs.
  if (/\/\/\s*public:/i.test(src.split("\n").slice(0, 10).join("\n"))) {
    return null;
  }

  if (!/export\s+(?:async\s+)?(?:function|const)\s+GET\b/.test(src)) {
    return null;
  }

  // Locate the GET declaration line.
  const lines = src.split("\n");
  let getStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/export\s+(?:async\s+)?(?:function|const)\s+GET\b/.test(lines[i])) {
      getStart = i;
      break;
    }
  }
  if (getStart === -1) return null;

  // Scope the body: from getStart, walk forward to the matching close.
  // Fast heuristic — stop at the next `^export ` or end of file.
  let bodyEnd = lines.length;
  for (let i = getStart + 1; i < lines.length; i++) {
    if (/^export\s+(?:async\s+)?(?:function|const)\s+/.test(lines[i])) {
      bodyEnd = i;
      break;
    }
  }
  // Include up to 5 preceding comment lines so a `// public:` marker
  // placed directly above the export declaration is recognized.
  let preStart = getStart;
  for (let i = getStart - 1; i >= 0 && i >= getStart - 5; i--) {
    const ln = lines[i].trim();
    if (ln.startsWith("//") || ln.startsWith("*") || ln === "") {
      preStart = i;
    } else {
      break;
    }
  }
  const body = lines.slice(preStart, bodyEnd).join("\n");

  if (AUTH_SIGNAL.test(body)) return null;

  // 2026-07-28 cron-truth audit (dim 6): wrapped-identifier resolution.
  // `export const GET = withTracing(handler, …)` was a blind spot — the
  // auth lives inside `handler`'s body, which the GET-declaration scope
  // above never reaches (app/api/brain/wisdom false-positived exactly
  // this way). When the GET line wraps a bare identifier, locate that
  // identifier's own declaration in-file and scan ITS scoped body with
  // the same next-export boundary heuristic. Still NOT a file-level
  // grep: a signal in PATCH/DELETE alone continues to fail GET.
  const wrapped = lines[getStart].match(/=\s*\w+\(\s*(\w+)\b/);
  if (wrapped) {
    const id = wrapped[1];
    const declRe = new RegExp(
      `^(?:export\\s+)?(?:async\\s+)?(?:function\\s+${id}\\b|const\\s+${id}\\s*=)`,
    );
    for (let i = 0; i < lines.length; i++) {
      if (i === getStart || !declRe.test(lines[i])) continue;
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^(?:export\s+)?(?:async\s+)?(?:function|const)\s+/.test(lines[j])) {
          end = j;
          break;
        }
      }
      if (AUTH_SIGNAL.test(lines.slice(i, end).join("\n"))) return null;
      break;
    }
  }

  return {
    file,
    reason:
      "GET handler body contains no auth signal. " +
      "Add `await requireSession(req)` as the first line, " +
      "or `apiHandler(..., { auth: \"owner\" })` if using apiHandler, " +
      "or a `// public:` comment in the first 10 lines if intentionally open.",
  };
}

const routes = listRoutes();
const violations: Violation[] = [];
for (const f of routes) {
  try {
    const v = checkFile(f);
    if (v) violations.push(v);
  } catch {
    /* file vanished or unreadable */
  }
}

if (violations.length === 0) {
  console.log(
    `✓ all ${routes.length} sensitive GET handlers have auth in their body`,
  );
  process.exit(0);
}

console.error("");
console.error(
  `✗ ${violations.length} GET handler(s) under sensitive paths lack auth IN THEIR BODY:`,
);
console.error("");
for (const v of violations) {
  console.error(`  ${v.file}`);
  console.error(`    ${v.reason}`);
  console.error("");
}
console.error(
  "background: a previous file-level grep would pass when requireSession was used in",
);
console.error(
  "PATCH/DELETE but missing in GET. v10.0.183 caught such a leak in /api/ai/chat/[id].",
);
process.exit(1);
