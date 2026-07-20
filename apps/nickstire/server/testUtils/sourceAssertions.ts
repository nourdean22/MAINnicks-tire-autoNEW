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
 *
 * STRING-AWARE, and that is not a nicety.
 *
 * The first implementation was two regexes: `/\/\*[\s\S]*?\*\//g` then
 * `/\/\/.*$/gm`. The second one has no idea what a string literal is, so the
 * `//` inside "https://oauth2.googleapis.com/token" read as a line comment and
 * it deleted the REST OF THAT LINE. Any file with a URL in it came back
 * silently truncated.
 *
 * That fails in the dangerous direction: a negative assertion ("this code no
 * longer calls X") PASSES when the stripper quietly removed the line X was on.
 * A security assertion that cannot fail is worse than no assertion, and this
 * helper backs several of them.
 *
 * Caught 2026-07-20 when a test for the GSC token fetch could not find the
 * token fetch.
 *
 * Known limitation: regex literals are not tracked, so a regex containing an
 * unbalanced quote (/'/ ) could desync the scanner. No file here does that, and
 * the failure mode is a visibly mangled result rather than a silent pass.
 */
export function readCode(relativePath: string): string {
  const src = readSource(relativePath);
  let out = "";
  let i = 0;
  type Mode = "code" | "line" | "block" | "'" | '"' | "`";
  let mode: Mode = "code";

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (mode === "code") {
      if (c === "/" && next === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && next === "*") { mode = "block"; i += 2; continue; }
      if (c === "'" || c === '"' || c === "`") { mode = c; out += c; i++; continue; }
      out += c; i++; continue;
    }

    if (mode === "line") {
      // Keep the newline so line-anchored patterns still behave.
      if (c === "\n") { mode = "code"; out += c; }
      i++; continue;
    }

    if (mode === "block") {
      if (c === "*" && next === "/") { mode = "code"; i += 2; continue; }
      // Preserve newlines so line numbers do not shift.
      if (c === "\n") out += c;
      i++; continue;
    }

    // Inside a string literal: copy verbatim, respect escapes, and let an
    // unterminated line end the scan rather than swallowing the file.
    if (c === "\\") { out += c + (next ?? ""); i += 2; continue; }
    if (c === mode) { mode = "code"; out += c; i++; continue; }
    if (c === "\n" && mode !== "`") { mode = "code"; out += c; i++; continue; }
    out += c; i++;
  }

  return out;
}
