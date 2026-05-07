#!/usr/bin/env node
/**
 * audit-hook-after-return.mjs
 *
 * Wave-73 caught a hook-after-early-return crash in OverviewSection
 * (React: "Rendered more hooks than during the previous render").
 * This script scans every component .tsx file for the same pattern
 * and exits non-zero if any are found, so CI can block the regression.
 *
 * Wave-76 rewrite: heuristic now uses INDENT MATCHING instead of brace
 * depth. The bug pattern is:
 *
 *   function Component() {
 *     ...
 *     if (isLoading) return <Spinner/>;   ← top-level early return
 *     ...
 *     const x = useMemo(...);             ← hook AFTER, same indent
 *   }
 *
 * Statements at the component body's first indent level are component
 * top-level. Statements indented deeper are inside callbacks/closures
 * (useMemo body, useState initializer, useEffect callback, JSX, etc.)
 * and don't violate Rules of Hooks regardless of return placement.
 *
 * The previous brace-depth heuristic flagged false positives because
 * `return []` inside `useMemo(() => { return []; })` looks like an
 * early return at the same brace depth. Indent matching fixes that:
 * the `return []` is indented 4+ spaces deeper than the `useMemo(`.
 *
 * Caveats: assumes consistent 2-space indentation (project standard).
 * Mixed tabs/spaces would confuse it. Verified false-positive-free
 * on current admin/*.tsx + components/*.tsx + pages/*.tsx.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Hooks that are subject to React Rules of Hooks.
// Match anywhere on the line (after stripping leading whitespace + an
// optional `const/let/var name = ` prefix). Caller checks indent
// separately to verify the hook is at component-body level.
const HOOK_RE = /\b(useState|useEffect|useMemo|useCallback|useRef|useReducer|useContext|useLayoutEffect|useImperativeHandle|useDebugValue|useDeferredValue|useId|useInsertionEffect|useSyncExternalStore|useTransition|useSuspenseQuery)\s*\(/;

// `if (...) return ...;` early-return pattern (single-line). Multi-line
// guards (`if (...) {` followed by `return` on next line) are detected
// separately via OPEN_GUARD_RE + look-ahead.
const EARLY_RETURN_RE = /^(\s*)if\s*\([^)]+\)\s*(?:return|{[^}]*return)/;
// Multi-line guard opener: `if (...) {` with no `return` on same line.
// Combined with a look-ahead for `return` inside the block, this catches
// the wave-65 bug shape (`if (isLoading) { return <Loading/>; }`).
const OPEN_GUARD_RE = /^(\s*)if\s*\([^)]+\)\s*\{\s*$/;

// Component declaration. Picks up `function Foo()`, `const Foo = () =>`,
// `export default function Foo()`, etc.
const COMPONENT_START_RE = /^(?:export\s+)?(?:default\s+)?(?:function\s+([A-Z]\w*)|const\s+([A-Z]\w*)\s*[:=].*=>)\s*[({]/;

// Function exit at indent level 0 — closes the component.
const COMPONENT_END_RE = /^\}/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith(".tsx")) out.push(full.replace(/\\/g, "/"));
  }
  return out;
}

function indentOf(line) {
  const match = line.match(/^(\s*)/);
  if (!match) return 0;
  return match[1].length;
}

const findings = [];

// Default scan paths — every .tsx file in client/src.
const targetRoots = process.argv.length > 2
  ? process.argv.slice(2)
  : ["client/src/pages", "client/src/components"];

const files = targetRoots.flatMap((root) => walk(root));

for (const f of files) {
  const text = readFileSync(f, "utf8");
  const lines = text.split("\n");

  // For each component declaration in the file, find its body's
  // first-level indent and scan that scope for the bug pattern.
  for (let i = 0; i < lines.length; i++) {
    const startMatch = lines[i].match(COMPONENT_START_RE);
    if (!startMatch) continue;

    // Determine component body indent — assume 2 spaces deeper than the
    // declaration line. This is the project convention.
    const declIndent = indentOf(lines[i]);
    const bodyIndent = declIndent + 2;

    let earlyReturnAt = -1;
    let earlyReturnText = "";

    for (let j = i + 1; j < lines.length; j++) {
      const ln = lines[j];

      // Component end: line that starts with `}` at the declaration's
      // indent or shallower (top-level closing brace).
      const lineIndent = indentOf(ln);
      if (ln.trim() === "" || ln.match(/^\s*\/\//)) continue;
      if (lineIndent <= declIndent && ln.trim().startsWith("}")) break;

      // Only consider statements at the component body's indent level.
      if (lineIndent !== bodyIndent) continue;

      const earlyMatch = ln.match(EARLY_RETURN_RE);
      if (earlyMatch && earlyReturnAt === -1) {
        earlyReturnAt = j + 1;
        earlyReturnText = ln.trim();
        continue;
      }

      // Multi-line guard: `if (...) {` with `return` inside the block.
      const openGuardMatch = ln.match(OPEN_GUARD_RE);
      if (openGuardMatch && earlyReturnAt === -1) {
        // Look ahead up to 6 lines for `return` at deeper indent
        for (let k = j + 1; k < Math.min(j + 7, lines.length); k++) {
          const inner = lines[k];
          const innerIndent = indentOf(inner);
          if (innerIndent > bodyIndent && /^\s*return\b/.test(inner)) {
            earlyReturnAt = j + 1;
            earlyReturnText = ln.trim() + " ... " + inner.trim();
            break;
          }
          // If we hit a line at body indent or shallower (and non-empty), the block closed.
          if (inner.trim() && innerIndent <= bodyIndent) break;
        }
        if (earlyReturnAt > 0) continue;
      }

      const hookMatch = ln.match(HOOK_RE);
      if (earlyReturnAt > 0 && hookMatch) {
        findings.push({
          file: f,
          component: startMatch[1] || startMatch[2] || "?",
          earlyReturnLine: earlyReturnAt,
          earlyReturnText: earlyReturnText.slice(0, 80),
          hookLine: j + 1,
          hookText: ln.trim().slice(0, 80),
          hookName: hookMatch[1],
        });
        earlyReturnAt = -1; // flag once per component, then reset
      }
    }
  }
}

if (findings.length === 0) {
  console.log("✓ no hook-after-early-return patterns detected");
  process.exit(0);
}

console.log(`✗ ${findings.length} suspicious pattern(s) — likely real Rules-of-Hooks violation:\n`);
for (const f of findings) {
  console.log(`${f.file}  (component: ${f.component})`);
  console.log(`  L${f.earlyReturnLine} · ${f.earlyReturnText}`);
  console.log(`  L${f.hookLine} · ${f.hookText}`);
  console.log("");
}
console.log(`refactor pattern · move the hook BEFORE the early-return guard`);
process.exit(1);
