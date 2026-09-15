#!/usr/bin/env tsx
/**
 * scripts/check-scripts-typecheck.ts · 2026-09-15
 *
 * `tsconfig.json` and `tsconfig.typecheck.json` both EXCLUDE `scripts/`, so
 * every gate in verify:hard runs a script that no typecheck has ever read.
 * Measured the day this landed: 50 errors across 22 files, including two
 * smoke scripts importing a component that no longer exists (TS2307) and one
 * verify-gate script (lint-baseline.ts) with a missing return path. A broken
 * import in a script passes every gate and fails only at runtime.
 *
 * Same ratchet shape as lint-baseline.ts: per-file error counts are snapshotted
 * once, and from then on a file may only get BETTER. A new file with errors,
 * or an existing file with more errors than its baseline, fails the gate.
 * TS2307 (cannot find module) is listed on every run as a named finding —
 * a script that cannot even import is dead code wearing a filename.
 *
 * Modes:
 *   --verify (default)  · fail on any regression vs .scripts-tsc-baseline.json
 *   --snapshot          · re-baseline (operator acknowledges the new debt level)
 *   --json              · structured output for tooling
 *
 * The pure parts (parse, count, compare) are exported and unit-tested in
 * tests/scripts/check-scripts-typecheck.test.ts; only main() spawns tsc.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface TscError {
  /** posix-slash path relative to the app dir, e.g. scripts/foo.ts */
  file: string;
  line: number;
  code: string;
  message: string;
}

export interface Baseline {
  generatedAt: string;
  totalErrors: number;
  /** file → error count allowed */
  files: Record<string, number>;
}

export interface Verdict {
  ok: boolean;
  total: number;
  regressions: Array<{ file: string; allowed: number; actual: number }>;
  newFiles: Array<{ file: string; actual: number }>;
  improvements: Array<{ file: string; allowed: number; actual: number }>;
  /** TS2307 — the file cannot even import what it names. */
  deadImports: TscError[];
}

const TSC_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

/** Parse `tsc --pretty false` output. Windows and posix paths normalise to posix. */
export function parseTscOutput(text: string): TscError[] {
  const out: TscError[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = TSC_LINE.exec(raw.trim());
    if (!m) continue;
    out.push({ file: m[1].replace(/\\/g, "/"), line: Number(m[2]), code: m[4], message: m[5] });
  }
  return out;
}

export function countByFile(errors: readonly TscError[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of errors) counts[e.file] = (counts[e.file] ?? 0) + 1;
  return counts;
}

export function compareToBaseline(errors: readonly TscError[], baseline: Baseline | null): Verdict {
  const counts = countByFile(errors);
  const allowed = baseline?.files ?? {};
  const regressions: Verdict["regressions"] = [];
  const newFiles: Verdict["newFiles"] = [];
  const improvements: Verdict["improvements"] = [];
  for (const [file, actual] of Object.entries(counts).sort()) {
    if (!(file in allowed)) newFiles.push({ file, actual });
    else if (actual > allowed[file]) regressions.push({ file, allowed: allowed[file], actual });
    else if (actual < allowed[file]) improvements.push({ file, allowed: allowed[file], actual });
  }
  for (const [file, was] of Object.entries(allowed)) {
    if (!(file in counts) && was > 0) improvements.push({ file, allowed: was, actual: 0 });
  }
  const deadImports = errors.filter((e) => e.code === "TS2307");
  return {
    // With no baseline at all, every error is "new": the first run must be a --snapshot.
    ok: regressions.length === 0 && newFiles.length === 0,
    total: errors.length,
    regressions,
    newFiles,
    improvements,
    deadImports,
  };
}

export function toBaseline(errors: readonly TscError[], now = new Date()): Baseline {
  return { generatedAt: now.toISOString(), totalErrors: errors.length, files: countByFile(errors) };
}

function runTsc(appDir: string): string {
  // The installed compiler, run by this node — no shell, no pnpm wrapper
  // chatter, and the same binary `pnpm typecheck` uses.
  const tscJs = createRequire(import.meta.url).resolve("typescript/lib/tsc.js");
  const r = spawnSync(process.execPath, [tscJs, "--noEmit", "--pretty", "false", "-p", "tsconfig.scripts.json"], {
    cwd: appDir,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  const text = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  // tsc exits 2 on type errors — that is the expected path. Any other
  // non-zero with NO parseable error line is tsc itself failing to run.
  if (r.status !== 0 && parseTscOutput(text).length === 0) {
    throw new Error(`tsc exited ${r.status} with no diagnostics:\n${text.slice(0, 2000)}`);
  }
  return text;
}

function main(): void {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const baselinePath = join(appDir, ".scripts-tsc-baseline.json");
  const args = new Set(process.argv.slice(2));
  const json = args.has("--json");
  let errors: TscError[];
  try {
    errors = parseTscOutput(runTsc(appDir));
  } catch (err) {
    console.error("✗ check:scripts · tsc did not run:", err instanceof Error ? err.message : err);
    process.exit(2);
  }

  if (args.has("--snapshot")) {
    const b = toBaseline(errors);
    writeFileSync(baselinePath, JSON.stringify(b, null, 2) + "\n");
    console.log(`✓ check:scripts · baseline written: ${b.totalErrors} errors in ${Object.keys(b.files).length} files → ${baselinePath}`);
    return;
  }

  const baseline: Baseline | null = existsSync(baselinePath) ? (JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline) : null;
  const v = compareToBaseline(errors, baseline);
  if (json) {
    console.log(JSON.stringify(v, null, 2));
  } else {
    console.log(`check:scripts · ${v.total} type error(s) in scripts/ (baseline ${baseline?.totalErrors ?? "NONE"})`);
    if (v.deadImports.length) {
      console.log(`  FINDING · ${v.deadImports.length} dead import(s) — these scripts cannot run at all:`);
      for (const d of v.deadImports) console.log(`    ${d.file}:${d.line} ${d.message}`);
    }
    for (const r of v.regressions) console.log(`  ✗ ${r.file}: ${r.actual} errors (baseline ${r.allowed})`);
    for (const n of v.newFiles) console.log(`  ✗ ${n.file}: ${n.actual} errors (NEW — not in baseline)`);
    if (v.improvements.length) {
      console.log(`  ratchet · ${v.improvements.length} file(s) improved; run \`pnpm scripts-baseline:snapshot\` to lock the lower count in`);
    }
  }
  if (!baseline) {
    console.error("✗ check:scripts · no baseline yet — run `pnpm scripts-baseline:snapshot` once");
    process.exit(1);
  }
  if (!v.ok) {
    console.error("✗ check:scripts · scripts/ got WORSE. Fix the file, or --snapshot with the reason in the commit message.");
    process.exit(1);
  }
  console.log("✓ check:scripts · no regression");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
