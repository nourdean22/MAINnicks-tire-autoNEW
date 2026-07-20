/**
 * Helpers for source-level assertions.
 *
 * Several invariants in this codebase are pinned by reading a source file and
 * matching against it — used where the alternative (booting two cron workers, a
 * Meta double and three tables) would test the harness rather than the rule.
 *
 * THE TRAP, HIT THREE TIMES IN ONE SESSION: a good docblock explains the defect
 * it replaced by QUOTING it. So a whole-file `not.toMatch(/old expression/)`
 * fails against the very comment that documents the fix. Twice I patched the
 * individual assertion; the third time it was clearly a missing tool rather than
 * a missing fix.
 *
 * NEGATIVE assertions run on CODE. Positive ones may run on the whole file.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Whole file, comments and all. Use for POSITIVE assertions. */
export function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

/**
 * Source with block and line comments stripped. Use for NEGATIVE assertions —
 * "this code no longer does X" is a claim about code, not about prose.
 */
export function readCode(relativePath: string): string {
  return readSource(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}
