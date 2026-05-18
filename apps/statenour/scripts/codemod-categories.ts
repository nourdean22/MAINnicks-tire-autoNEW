#!/usr/bin/env tsx
/**
 * scripts/codemod-categories.ts · Phase P.2 (2026-05-18 PM)
 *
 * Rewrites H+ inline `category: "reasoning_trace"` strings to
 * `category: BRAIN_CATEGORIES.REASONING_TRACE` so typos become
 * compile errors. Closes the O.2 loop · O.2 added the entries to
 * the registry but call sites still used inline strings.
 *
 * SCOPE · H+ categories only · the 100+ legacy inline strings stay
 * untouched (separate codemod wave if ever needed · low value vs risk).
 *
 * Modes:
 *   --dry-run (default) · prints planned changes · no writes
 *   --apply              · writes the changes
 *   --json               · structured output for tools
 *
 * Adds the `BRAIN_CATEGORIES` import if missing from the target file
 * (heuristic: looks for an existing import from "@/lib/brain/categories"
 * · adds one if absent).
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { globSync } from "glob";

/** H+ categories that O.2 added to the BRAIN_CATEGORIES registry.
 *  Each `enumKey` is the constant name to reference. */
const H_PLUS_CATEGORIES: Array<{ literal: string; enumKey: string }> = [
  { literal: "reasoning_trace", enumKey: "REASONING_TRACE" },
  { literal: "reasoning_orphan", enumKey: "REASONING_ORPHAN" },
  { literal: "reasoning_in_flight", enumKey: "REASONING_IN_FLIGHT" },
  { literal: "reasoning_idempotency", enumKey: "REASONING_IDEMPOTENCY" },
  { literal: "persona_usage", enumKey: "PERSONA_USAGE" },
  { literal: "sanitized_error", enumKey: "SANITIZED_ERROR" },
  { literal: "dependency_cve", enumKey: "DEPENDENCY_CVE" },
  { literal: "wisdom_shown", enumKey: "WISDOM_SHOWN" },
  { literal: "pulse_wisdom_shown", enumKey: "PULSE_WISDOM_SHOWN" },
];

const SCAN_GLOBS = [
  "apps/statenour/lib/ai/reasoning/**/*.ts",
  "apps/statenour/lib/ai/personas/**/*.ts",
  "apps/statenour/lib/services/operator-pulse.ts",
  "apps/statenour/lib/brain/wisdom-suggest.ts",
  "apps/statenour/app/api/nick/**/*.ts",
  "apps/statenour/app/api/operator/**/*.ts",
  "apps/statenour/app/api/system/**/*.ts",
  "apps/statenour/scripts/audit-deps.ts",
];

const IGNORE_GLOBS = [
  "**/node_modules/**",
  "**/*.test.ts",
  "**/codemod-categories.ts",
];

interface FileChange {
  file: string;
  replacements: Array<{ from: string; to: string; count: number }>;
  addedImport: boolean;
}

function rewriteFile(
  filePath: string,
  apply: boolean,
): FileChange | null {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const replacements: FileChange["replacements"] = [];
  let newContent = content;
  let touched = false;

  for (const { literal, enumKey } of H_PLUS_CATEGORIES) {
    // Match `category: "literal"` and `category: 'literal'` · the
    // value form (not bare string usage). Limits blast radius vs
    // matching the literal anywhere.
    const re = new RegExp(
      `category:\\s*["']${literal}["']`,
      "g",
    );
    const matches = newContent.match(re);
    if (!matches || matches.length === 0) continue;
    const before = `category: "${literal}"`;
    const after = `category: BRAIN_CATEGORIES.${enumKey}`;
    newContent = newContent.replace(re, after);
    replacements.push({ from: before, to: after, count: matches.length });
    touched = true;
  }

  if (!touched) return null;

  // Add the BRAIN_CATEGORIES import if missing
  let addedImport = false;
  if (!/from\s+["']@\/lib\/brain\/categories["']/.test(newContent)) {
    // Find the last import statement and insert after it
    const importRe = /^(import .* from .*;)$/gm;
    let lastImportEnd = -1;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(newContent)) !== null) {
      lastImportEnd = importRe.lastIndex;
    }
    const importLine = `\nimport { BRAIN_CATEGORIES } from "@/lib/brain/categories";`;
    if (lastImportEnd > 0) {
      newContent =
        newContent.slice(0, lastImportEnd) +
        importLine +
        newContent.slice(lastImportEnd);
    } else {
      newContent = importLine.trimStart() + "\n" + newContent;
    }
    addedImport = true;
  }

  if (apply) {
    writeFileSync(filePath, newContent, "utf8");
  }

  return {
    file: filePath,
    replacements,
    addedImport,
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const jsonOut = argv.includes("--json");
  const repoRoot = execSync("git rev-parse --show-toplevel", {
    encoding: "utf8",
  }).trim();

  const targetFiles: string[] = [];
  for (const g of SCAN_GLOBS) {
    const matches = globSync(g, { cwd: repoRoot, ignore: IGNORE_GLOBS });
    targetFiles.push(...matches.map((f) => join(repoRoot, f)));
  }

  const changes: FileChange[] = [];
  for (const f of targetFiles) {
    const result = rewriteFile(f, apply);
    if (result) changes.push(result);
  }

  if (jsonOut) {
    console.log(JSON.stringify({ apply, changes }, null, 2));
  } else {
    if (changes.length === 0) {
      console.log(
        `✓ codemod-categories · no inline H+ category strings found in ${targetFiles.length} files`,
      );
    } else {
      console.log(
        `${apply ? "✓ applied" : "→ dry-run"} · ${changes.length} file(s) ${apply ? "rewritten" : "would be rewritten"}:`,
      );
      for (const c of changes) {
        const rel = relative(repoRoot, c.file).replace(/\\/g, "/");
        const totalReplacements = c.replacements.reduce(
          (s, r) => s + r.count,
          0,
        );
        console.log(
          `  ${rel} · ${totalReplacements} replacement(s)${c.addedImport ? " · +import" : ""}`,
        );
        for (const r of c.replacements) {
          console.log(`    ${r.from}  →  ${r.to}  (×${r.count})`);
        }
      }
      if (!apply) {
        console.log(
          "\nRun with --apply to write changes. Recommended: review the diff first with `git diff` after applying.",
        );
      }
    }
  }
  process.exit(0);
}

main();
