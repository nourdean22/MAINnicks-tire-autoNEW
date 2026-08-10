#!/usr/bin/env tsx
/**
 * scripts/lint-baseline.ts · Phase K (2026-05-18 PM)
 *
 * Lint ratchet · snapshot the current set of warnings as a baseline,
 * then on subsequent runs fail if any NEW warnings appear. Existing
 * tech debt is tolerated · new code can't add more.
 *
 * Pattern: per-file warning counts. Updates require an explicit
 * --snapshot (operator acknowledges new baseline).
 *
 * Modes:
 *   --snapshot          · re-baseline · writes .lintbaseline.json
 *   --verify (default)  · fail if any file exceeds its baseline count
 *   --json              · structured output for tooling
 *
 * The baseline file is .lintbaseline.json at repo root. Format:
 *   {
 *     "generatedAt": "ISO",
 *     "files": { "<relative-path>": <warning-count> }
 *   }
 */

import { execSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

interface ESLintMessage {
  ruleId: string | null;
  severity: number; // 1=warn, 2=error
  message: string;
  line: number;
}

interface ESLintFileResult {
  filePath: string;
  messages: ESLintMessage[];
  warningCount: number;
  errorCount: number;
}

interface Baseline {
  generatedAt: string;
  /** filePath (relative, posix-slash) → warningCount allowed */
  files: Record<string, number>;
}

const BASELINE_PATH = "apps/statenour/.lintbaseline.json";

function getRepoRoot(): string {
  return execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
}

function runEslint(repoRoot: string): ESLintFileResult[] {
  // Write to a temp file to avoid execSync stdout-buffer + pnpm-wrapper
  // chatter polluting the JSON. The temp file approach is bulletproof
  // for large outputs (~4MB+).
  const tmpPath = join(repoRoot, ".lintbaseline.tmp.json");
  try {
    // Run from apps/statenour so eslint picks up the local config + tsconfig
    const statenourDir = join(repoRoot, "apps", "statenour");
    try {
      execSync(`pnpm exec eslint . -f json --output-file "${tmpPath}"`, {
        cwd: statenourDir,
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
        stdio: ["ignore", "ignore", "ignore"],
      });
    } catch {
      // eslint exits non-zero when warnings/errors exist · the file was
      // still written. Only fail if the file doesn't exist (real error).
      if (!existsSync(tmpPath)) {
        console.error("✗ lint-baseline · eslint did not produce output");
        process.exit(2);
      }
    }
    const raw = readFileSync(tmpPath, "utf8");
    return JSON.parse(raw) as ESLintFileResult[];
  } catch (err) {
    console.error(
      "✗ lint-baseline · parse failed:",
      err instanceof Error ? err.message : err,
    );
    process.exit(2);
  } finally {
    // 2026-08-10 · was `execSync("rm -f ...")`, which does not exist on
    // Windows — every run printed "'rm' is not recognized" and left a ~2.5MB
    // .lintbaseline.tmp.json in the REPO ROOT, untracked and one `git add -A`
    // from being committed. rmSync is cross-platform; `force` swallows ENOENT.
    // Still guarded: a cleanup failure must never mask the real error above.
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function buildWarningMap(
  results: ESLintFileResult[],
  repoRoot: string,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of results) {
    if (r.warningCount === 0 && r.errorCount === 0) continue;
    const rel = relative(repoRoot, r.filePath).replace(/\\/g, "/");
    map.set(rel, r.warningCount + r.errorCount);
  }
  return map;
}

function loadBaseline(repoRoot: string): Baseline | null {
  const path = join(repoRoot, BASELINE_PATH);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Baseline;
}

function saveBaseline(repoRoot: string, baseline: Baseline): void {
  const path = join(repoRoot, BASELINE_PATH);
  writeFileSync(path, JSON.stringify(baseline, null, 2) + "\n", "utf8");
}

function main(): void {
  const argv = process.argv.slice(2);
  const mode = argv.includes("--snapshot")
    ? "snapshot"
    : argv.includes("--verify")
      ? "verify"
      : "verify";
  const jsonOut = argv.includes("--json");

  const repoRoot = getRepoRoot();
  const results = runEslint(repoRoot);
  const current = buildWarningMap(results, repoRoot);

  if (mode === "snapshot") {
    const files: Record<string, number> = {};
    for (const [file, count] of current) files[file] = count;
    const baseline: Baseline = {
      generatedAt: new Date().toISOString(),
      files,
    };
    saveBaseline(repoRoot, baseline);
    const total = Array.from(current.values()).reduce((s, n) => s + n, 0);
    console.log(
      `✓ lint-baseline · snapshot written · ${current.size} files · ${total} total warnings/errors`,
    );
    process.exit(0);
  }

  // verify mode
  const baseline = loadBaseline(repoRoot);
  if (!baseline) {
    console.error(
      `✗ lint-baseline · no baseline at ${BASELINE_PATH} · run with --snapshot first`,
    );
    process.exit(2);
  }

  const regressions: Array<{
    file: string;
    baseline: number;
    current: number;
    delta: number;
  }> = [];
  const newFiles: Array<{ file: string; current: number }> = [];

  for (const [file, count] of current) {
    const allowed = baseline.files[file];
    if (allowed === undefined) {
      // New file with warnings · this counts as a regression (must be 0)
      if (count > 0) newFiles.push({ file, current: count });
    } else if (count > allowed) {
      regressions.push({
        file,
        baseline: allowed,
        current: count,
        delta: count - allowed,
      });
    }
  }

  if (jsonOut) {
    console.log(JSON.stringify({ regressions, newFiles }, null, 2));
  } else {
    if (regressions.length === 0 && newFiles.length === 0) {
      const totalBaseline = Object.values(baseline.files).reduce(
        (s, n) => s + n,
        0,
      );
      const totalCurrent = Array.from(current.values()).reduce(
        (s, n) => s + n,
        0,
      );
      console.log(
        `✓ lint-baseline · no regressions · current ${totalCurrent} ≤ baseline ${totalBaseline}`,
      );
    } else {
      console.error(
        `✗ lint-baseline · ${regressions.length} regression(s) · ${newFiles.length} new-file warning(s):`,
      );
      for (const r of regressions) {
        console.error(
          `  REGRESSION ${r.file} · baseline ${r.baseline} → current ${r.current} (+${r.delta})`,
        );
      }
      for (const nf of newFiles) {
        console.error(
          `  NEW FILE ${nf.file} · ${nf.current} warning(s) · new code must have 0`,
        );
      }
      console.error(
        `\nFix the warnings, OR if intentional, re-snapshot with: pnpm tsx scripts/lint-baseline.ts --snapshot`,
      );
    }
  }
  process.exit(regressions.length > 0 || newFiles.length > 0 ? 1 : 0);
}

main();
