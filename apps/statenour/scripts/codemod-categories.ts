#!/usr/bin/env tsx
/**
 * scripts/codemod-categories.ts · Phase P.2 + BB (2026-05-18 PM)
 *
 * Rewrites inline `category: "literal"` strings to
 * `category: BRAIN_CATEGORIES.ENUM_KEY` so typos become compile
 * errors. Closes the O.2 loop · O.2 added entries to the registry
 * but call sites still used inline strings.
 *
 * SCOPES (pick via --scope flag):
 *   --scope=h-plus       · default · only the 9 H+ category entries
 *                           (preserves Phase P.2 behavior · narrow + safe)
 *   --scope=registered   · BB · ALL inline strings that match a
 *                           BRAIN_CATEGORIES entry · broader sweep
 *                           with file-level safety filter
 *
 * BB safety net · in --scope=registered mode we ONLY touch files
 * that import + use `prisma.brainMemory` somewhere. Files that have
 * inline `category: "..."` matching a registry value but DON'T use
 * brainMemory at all (integration registries · tool catalogs ·
 * automation trigger configs) are skipped · those `category` fields
 * belong to other models and would corrupt if rewritten.
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

/** Phase BB · read the full BRAIN_CATEGORIES registry from
 *  lib/brain/categories.ts at runtime · keeps the codemod in sync
 *  with the registry without manual duplication. Matches
 *  `KEY: "literal",` patterns (object-literal entries). */
function readRegisteredCategories(repoRoot: string): Array<{ literal: string; enumKey: string }> {
  const path = join(
    repoRoot,
    "apps/statenour/lib/brain/categories.ts",
  );
  const text = readFileSync(path, "utf8");
  const entries: Array<{ literal: string; enumKey: string }> = [];
  const re = /^\s*([A-Z][A-Z0-9_]*)\s*:\s*"([a-z][a-z0-9_]*)"/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    entries.push({ enumKey: m[1], literal: m[2] });
  }
  return entries;
}

/** H+ scope · narrow set of well-known target files (Phase P.2 default). */
const H_PLUS_SCAN_GLOBS = [
  "apps/statenour/lib/ai/reasoning/**/*.ts",
  "apps/statenour/lib/ai/personas/**/*.ts",
  "apps/statenour/lib/services/operator-pulse.ts",
  "apps/statenour/lib/brain/wisdom-suggest.ts",
  "apps/statenour/app/api/nick/**/*.ts",
  "apps/statenour/app/api/operator/**/*.ts",
  "apps/statenour/app/api/system/**/*.ts",
  "apps/statenour/scripts/audit-deps.ts",
];

/** BB · registered scope · broader tree · file-level filter
 *  (only touches files that use prisma.brainMemory) compensates. */
const REGISTERED_SCAN_GLOBS = [
  "apps/statenour/lib/**/*.ts",
  "apps/statenour/lib/**/*.tsx",
  "apps/statenour/app/**/*.ts",
  "apps/statenour/app/**/*.tsx",
  "apps/statenour/scripts/**/*.ts",
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
  categories: Array<{ literal: string; enumKey: string }>,
  apply: boolean,
  requireBrainMemoryContext: boolean,
): FileChange | null {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  // BB safety net · in registered scope we ONLY touch files that
  // actually use prisma.brainMemory. Catches the false-positive
  // case where unrelated `category: "ai"` (integration registry)
  // or `category: "asc"` (prisma orderBy) lives in a file that
  // would otherwise match the literal regex.
  if (requireBrainMemoryContext && !/prisma\.brainMemory/.test(content)) {
    return null;
  }

  const replacements: FileChange["replacements"] = [];
  let newContent = content;
  let touched = false;

  for (const { literal, enumKey } of categories) {
    // Match `category: "literal"` and `category: 'literal'` · the
    // value form (not bare string usage). Limits blast radius vs
    // matching the literal anywhere.
    //
    // Phase BB type-position guard · negative lookahead skips
    // TS union-type literals where the match is followed by `|`
    // (e.g. `category: "skill" | "skill_pending"` is a type, not a
    // value · `BRAIN_CATEGORIES.SKILL` in that position is invalid
    // TS namespace reference · stay inline). Also skips when the
    // PREVIOUS non-whitespace token is `|` (same pattern, suffix
    // form: `category: "foo" | "literal"`).
    const re = new RegExp(
      `(?<!\\|\\s{0,5}["'])category:\\s*["']${literal}["'](?!\\s{0,5}\\|)`,
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

type Scope = "h-plus" | "registered";

function resolveScope(argv: string[]): Scope {
  for (const a of argv) {
    if (a === "--scope=h-plus") return "h-plus";
    if (a === "--scope=registered") return "registered";
  }
  return "h-plus";
}

function main(): void {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const jsonOut = argv.includes("--json");
  const scope = resolveScope(argv);
  const repoRoot = execSync("git rev-parse --show-toplevel", {
    encoding: "utf8",
  }).trim();

  const categories =
    scope === "registered" ? readRegisteredCategories(repoRoot) : H_PLUS_CATEGORIES;
  const scanGlobs =
    scope === "registered" ? REGISTERED_SCAN_GLOBS : H_PLUS_SCAN_GLOBS;
  const requireBrainMemoryContext = scope === "registered";

  const targetFiles: string[] = [];
  for (const g of scanGlobs) {
    const matches = globSync(g, { cwd: repoRoot, ignore: IGNORE_GLOBS });
    targetFiles.push(...matches.map((f) => join(repoRoot, f)));
  }
  // De-dupe in case of overlapping globs
  const uniqueFiles = Array.from(new Set(targetFiles));

  const changes: FileChange[] = [];
  for (const f of uniqueFiles) {
    const result = rewriteFile(f, categories, apply, requireBrainMemoryContext);
    if (result) changes.push(result);
  }

  if (jsonOut) {
    console.log(
      JSON.stringify({ apply, scope, categoriesScanned: categories.length, filesScanned: uniqueFiles.length, changes }, null, 2),
    );
  } else {
    const header = `[scope=${scope} · categories=${categories.length} · files=${uniqueFiles.length}]`;
    if (changes.length === 0) {
      console.log(
        `✓ codemod-categories · ${header} · no inline category strings found`,
      );
    } else {
      console.log(
        `${apply ? "✓ applied" : "→ dry-run"} · ${header} · ${changes.length} file(s) ${apply ? "rewritten" : "would be rewritten"}:`,
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
