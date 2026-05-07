#!/usr/bin/env node
/**
 * audit-hook-after-return.mjs · admin v1.7.6
 *
 * Wave-73 caught a hook-after-early-return crash in OverviewSection.
 * This audit scans every admin page for the same pattern · React
 * throws "Rendered more hooks than during the previous render" when
 * a hook is placed AFTER a conditional `if (...) return ...` guard.
 *
 * Heuristic · we look for the pattern:
 *   1. Inside a function declaration (component)
 *   2. Look for an `if (...) return` line
 *   3. Look for a useState/useEffect/useMemo/useCallback/useRef
 *      AFTER that line in the SAME function
 *
 * False positives possible (return is inside a callback, hook is
 * inside another function inside the component) · this is a sniff
 * test, not a precise scanner.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith(".tsx")) out.push(full.replace(/\\/g, "/"));
  }
  return out;
}

const HOOK_RE = /\b(useState|useEffect|useMemo|useCallback|useRef|useReducer|useContext|useLayoutEffect)\s*\(/;
const RETURN_GUARD_RE = /^\s*if\s*\([^)]+\)\s*(?:return|{[^}]*return)/;
const FUNCTION_BODY_START_RE = /(?:export\s+(?:default\s+)?function|^function|const\s+\w+\s*=\s*(?:\([^)]*\)|\w+)\s*=>\s*{)/;

const findings = [];
const files = walk("client/src/pages/admin");

for (const f of files) {
  const text = readFileSync(f, "utf8");
  const lines = text.split("\n");
  let inFunction = false;
  let braceDepth = 0;
  let sawEarlyReturn = -1;
  let earlyReturnLine = "";

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (FUNCTION_BODY_START_RE.test(ln)) {
      inFunction = true;
      braceDepth = (ln.match(/{/g)?.length ?? 0) - (ln.match(/}/g)?.length ?? 0);
      sawEarlyReturn = -1;
      continue;
    }
    if (!inFunction) continue;

    braceDepth += (ln.match(/{/g)?.length ?? 0) - (ln.match(/}/g)?.length ?? 0);
    if (braceDepth <= 0) { inFunction = false; sawEarlyReturn = -1; continue; }

    if (RETURN_GUARD_RE.test(ln) && sawEarlyReturn === -1) {
      sawEarlyReturn = i + 1;
      earlyReturnLine = ln.trim();
    }
    if (sawEarlyReturn > 0 && HOOK_RE.test(ln)) {
      const hookMatch = ln.match(HOOK_RE);
      findings.push({
        file: f,
        earlyReturnLine: sawEarlyReturn,
        earlyReturnText: earlyReturnLine.slice(0, 80),
        hookLine: i + 1,
        hookText: ln.trim().slice(0, 80),
        hookName: hookMatch ? hookMatch[1] : "?",
      });
      sawEarlyReturn = -1; // only flag once per function · avoid spam
    }
  }
}

if (findings.length === 0) {
  console.log("✓ no hook-after-early-return patterns detected in admin");
  process.exit(0);
}

console.log(`✗ ${findings.length} suspicious pattern(s):\n`);
for (const f of findings) {
  console.log(`${f.file}`);
  console.log(`  L${f.earlyReturnLine} · ${f.earlyReturnText}`);
  console.log(`  L${f.hookLine} · ${f.hookText}`);
  console.log("");
}
console.log(`refactor pattern · move ${findings[0].hookName} BEFORE the early-return guard`);
process.exit(0);
