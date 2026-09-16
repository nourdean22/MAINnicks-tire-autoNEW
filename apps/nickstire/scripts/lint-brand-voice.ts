#!/usr/bin/env tsx
/**
 * lint-brand-voice — brand-voice CI gate.
 *
 * The rules USED to live in this file as a local `KILL_LIST` array. They no
 * longer do: every pattern now comes from the Voice Kernel at `shared/voice.ts`,
 * which is also what the IG generator prompt, the IG critic prompt and
 * `voice-compliance.test.ts` read. That is the whole point — before the kernel,
 * this file's list, the two prompts' lists and the two governing documents all
 * disagreed, and "reliable" (killed by VOICE.md, banned in both IG prompts) had
 * no pattern here at all, so it shipped to the public site.
 *
 * If you want to add or change a rule, edit `shared/voice.ts`. Adding a local
 * list back here fails `voiceKernelParity.test.ts`.
 *
 * Three modes:
 *   - PRE-COMMIT (default) — scans only ADDED lines in `git diff --cached`, so
 *     pre-existing violations don't block; only new ones do. Exit 1 on a
 *     `block`-severity hit.
 *   - RANGE (`--range <ref>`) — same added-lines semantics against
 *     `<ref>...HEAD`. This is the CI mode: a CI checkout stages nothing, so
 *     PRE-COMMIT mode there is structurally blind (see below).
 *   - AUDIT (`--audit`) — scans all in-scope files and reports the full set.
 *     Never exits non-zero; this is the inventory tool. NOT gateable: 28
 *     blocking findings in 17 files exist today, several of them false
 *     positives on internal identifiers ("unmatched" invoice rows). That is
 *     precisely why the other two modes read ADDED LINES only.
 *
 * ⚠ TWO FAIL-OPENS, BOTH FIXED 2026-09-16, BOTH MEASURED — this gate had never
 * scanned a single file on any automatic invocation:
 *
 *   1. PRE-COMMIT under a real `git commit`. Git exports `GIT_DIR` (absolute)
 *      and no `GIT_WORK_TREE` to its hooks. With `GIT_DIR` set, git takes the
 *      CURRENT DIRECTORY as the work-tree root — and this script runs git with
 *      `cwd: APP_ROOT`. STAGE 1 (`--name-only`, no pathspec) still returned
 *      repo-root paths, so the scope filter looked healthy; STAGE 3's pathspec
 *      `server/...` was then resolved against `apps/nickstire`-as-root and
 *      matched NOTHING in an index keyed `apps/nickstire/server/...`. Empty
 *      diff, zero files scanned, printed as `ok`. Proved end to end: the same
 *      staged `"your trusted neighborhood tire shop"` exits 1 with
 *      `cliche.trusted` in a clean env and prints
 *      `0 file(s) scanned · 0 violations · ok` with `GIT_DIR` set.
 *   2. CI. `.github/workflows/test.yml` ran the bare script on a checkout with
 *      NOTHING STAGED, so STAGE 1 returned an empty list every time — a real
 *      pass shape, reached without reading a byte of the diff.
 *
 * The lesson is the one in the buffer comment below, one layer up: it is not
 * enough to make the read robust, the ABSENCE of a read must be unable to
 * impersonate a clean one. Hence `--range` for CI, a neutralised git env, and
 * the STAGE 3 invariant that a changed in-scope file with an EMPTY per-file
 * diff is UNREADABLE rather than clean.
 *
 * Ported from lint-brand-voice.mjs (deleted in the same change). Behaviour kept:
 * scope list, admin exclusion, comment skipping, diff line accounting, output
 * shape and exit codes.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findVoiceViolations, KILL_RULES, type VoiceSurface } from "../shared/voice";
import { blankClassNames, keepOnlyStringLiterals } from "./lib/scanText";
import { scopeOf, stripWorkspacePrefix } from "./lib/brandVoiceScope";

const __filename = fileURLToPath(import.meta.url);
const APP_ROOT = resolve(dirname(__filename), "..");
const AUDIT_MODE = process.argv.includes("--audit");

/**
 * `--range <ref>` — the CI mode. Three-dot, so the comparison is against the
 * MERGE BASE and a PR is judged on what it added, not on what main moved on to.
 */
const RANGE_IDX = process.argv.indexOf("--range");
const RANGE_REF = RANGE_IDX >= 0 ? process.argv[RANGE_IDX + 1] : undefined;
if (RANGE_IDX >= 0 && (!RANGE_REF || RANGE_REF.startsWith("--"))) {
  console.error("[brand-voice] --range needs a ref, e.g. --range origin/main");
  process.exit(1);
}

interface Finding {
  file: string;
  line: number;
  match: string;
  context?: string;
  why: string;
  fix: string;
  severity: "block" | "warn";
  ruleId: string;
}

/** A line that is entirely a comment carries no customer-facing copy. */
function isCommentLine(text: string): boolean {
  const t = text.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/**
 * 64 MiB. `execSync`/`execFileSync` default to 1 MiB and THROW ENOBUFS past it.
 * That default is what made this script fail open: a merge staging
 * `prerendered/**` overflowed the read, the catch swallowed it, and a scan of
 * zero files printed the same `ok` line a genuinely clean commit prints. The
 * per-file read below makes an overflow implausible; this makes it impossible
 * for any realistic single file.
 */
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Git's hook environment, NEUTRALISED.
 *
 * `git commit` exports `GIT_DIR` (absolute) and NO `GIT_WORK_TREE` to hooks.
 * With `GIT_DIR` set and `GIT_WORK_TREE` unset, git stops discovering the repo
 * from the filesystem and treats the CURRENT DIRECTORY as the work-tree root —
 * and every call below runs with `cwd: APP_ROOT`. So a pathspec of
 * `server/services/vapi.ts` was resolved against `apps/nickstire` as if that
 * were the repo root, and matched nothing in an index keyed
 * `apps/nickstire/server/services/vapi.ts`. Header fail-open #1.
 *
 * Deleting the two variables restores ordinary discovery from `cwd`, which
 * finds the same repository (worktree or primary) by walking up to the `.git`
 * entry. `GIT_INDEX_FILE` is deliberately KEPT: git sets it to an absolute path,
 * and it is what makes a PARTIAL commit (`git commit -- <paths>`, which builds a
 * temporary index) gate the bytes actually being committed rather than the
 * full index. Dropping it would have been a second, quieter bug.
 */
const GIT_ENV: NodeJS.ProcessEnv = (() => {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
})();

/** git with a bounded buffer and no shell — argv array, so paths are literal. */
function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: APP_ROOT,
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER,
    env: GIT_ENV,
  });
}

// ─── DIFF MODES: scan only ADDED lines (staged, or a ref range) ─────────────
interface ScanResult {
  findings: Finding[];
  filesScanned: number;
  unreadable: string | null;
  /** Nothing CHANGED at all — a different statement from "nothing violated". */
  nothingChanged?: boolean;
}

function scanDiff(rangeRef?: string): ScanResult {
  // The two modes differ only in which revisions git is asked to compare.
  const nameArgs = rangeRef
    ? ["diff", "--name-only", `${rangeRef}...HEAD`]
    : ["diff", "--cached", "--name-only"];
  const fileArgs = (file: string) =>
    rangeRef
      ? ["diff", "-U0", `${rangeRef}...HEAD`, "--", file]
      : ["diff", "--cached", "-U0", "--", file];
  const source = rangeRef ? `${rangeRef}...HEAD` : "the staged diff";

  // STAGE 1 — names only. Bounded by the FILE COUNT, not by the diff size, so a
  // commit that stages a megabyte of prerendered HTML costs a few hundred bytes
  // here. This is what removes the overflow at the root rather than papering
  // over it with a bigger buffer.
  let changed: string[];
  try {
    changed = git(nameArgs)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map(stripWorkspacePrefix);
  } catch (err) {
    // An unresolvable ref lands here, and it must be LOUD: a CI step pointed at
    // a ref that does not exist would otherwise report a clean gate forever.
    return { findings: [], filesScanned: 0, unreadable: `git ${nameArgs.join(" ")} failed: ${(err as Error).message}` };
  }

  // Said explicitly rather than folded into "0 files scanned · ok", because the
  // two are different facts and only one of them is a pass. In PRE-COMMIT mode
  // this is unreachable under a real commit (a commit stages something); it is
  // exactly what a CI checkout looks like, which is fail-open #2 in the header.
  if (changed.length === 0) return { findings: [], filesScanned: 0, unreadable: null, nothingChanged: true };

  // STAGE 2 — keep only voice surfaces BEFORE asking for any content. Most
  // commits stage nothing in scope, so most runs now read no diff at all.
  // `inScope` holds STRIPPED (workspace-relative) paths from here on — both
  // for the scopeOf() check and as the pathspec arg to `git diff -- <file>`
  // below, since pathspecs resolve relative to cwd (APP_ROOT), the opposite
  // direction from --name-only output. See stripWorkspacePrefix's doc comment.
  const inScope = changed.filter((f) => scopeOf(f) !== null);
  if (inScope.length === 0) return { findings: [], filesScanned: 0, unreadable: null };

  // STAGE 3 — one diff per file. Concatenated per-file diffs are still a valid
  // unified diff (each carries its own `+++ b/…` header and hunks), so the
  // parser below is untouched. Paths go through an argv array, never a shell
  // string, so a space or a quote in a filename cannot change the command.
  let diff = "";
  for (const file of inScope) {
    let one: string;
    try {
      one = git(fileArgs(file));
    } catch (err) {
      return { findings: [], filesScanned: 0, unreadable: `git diff of ${file} failed: ${(err as Error).message}` };
    }
    // STAGE 3 INVARIANT — a file STAGE 1 just reported as changed cannot have an
    // empty diff of its own. If it does, the pathspec did not resolve, and the
    // file goes UNSCANNED while every count stays zero and renders as a pass.
    // That is fail-open #1 in the header, and this check catches it whatever
    // the cause: a git env change, a cwd change, a path-convention regression.
    // Deliberately root-cause-independent — the env fix above removes the known
    // trigger, this removes the whole failure SHAPE.
    //
    // No legitimate empty case exists: `--name-only` lists only changed entries,
    // and mode-only changes, renames, deletions and binaries all still emit a
    // non-empty per-file diff (a header, at minimum).
    if (one.trim() === "") {
      return {
        findings: [],
        filesScanned: 0,
        unreadable: `${file} is in ${source} but its own diff came back EMPTY — the pathspec did not resolve, so the file was never scanned`,
      };
    }
    diff += one;
  }

  const findings: Finding[] = [];
  const filesScanned = new Set<string>();
  let currentFile: string | null = null;
  let currentSurface: VoiceSurface | null = null;
  let currentLineNum = 0;
  /** Added lines awaiting a block scan, so quote state survives the hunk. */
  let pending: { line: number; text: string }[] = [];

  const flush = () => {
    if (!currentFile || !currentSurface || pending.length === 0) {
      pending = [];
      return;
    }
    const block = pending.map((p) => p.text).join("\n");
    const scannable = currentFile.endsWith(".tsx")
      ? blankClassNames(block)
      : keepOnlyStringLiterals(block);
    for (const v of findVoiceViolations(scannable, { surface: currentSurface })) {
      // findVoiceViolations reports a 1-based line WITHIN the block, and both
      // blankers preserve newlines, so the index maps straight back.
      const src = pending[v.line - 1] ?? pending[pending.length - 1];
      findings.push({
        file: currentFile,
        line: src.line,
        match: v.match,
        context: src.text.trim().slice(0, 120),
        why: v.why,
        fix: v.fix,
        severity: v.severity,
        ruleId: v.ruleId,
      });
    }
    pending = [];
  };

  for (const line of diff.split("\n")) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      flush();
      // Diff-header output (`+++ b/...`) is always repo-root-relative
      // regardless of the pathspec used to request it — same strip, same
      // helper as STAGE 1/2 above, different data source.
      currentFile = stripWorkspacePrefix(fileMatch[1]);
      currentSurface = scopeOf(currentFile);
      currentLineNum = 0;
      if (currentSurface) filesScanned.add(currentFile);
      continue;
    }

    const hunkMatch = line.match(/^@@ .* \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      flush();
      currentLineNum = parseInt(hunkMatch[1], 10) - 1;
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentLineNum++;
      if (!currentFile || !currentSurface) continue;
      const text = line.slice(1);
      if (isCommentLine(text)) continue;
      // Buffer the added lines and scan them as ONE block at the end of the
      // hunk. Scanning line-by-line looked equivalent and was not: for a .ts
      // file, keepOnlyStringLiterals restarts with no open quote on every call,
      // so the interior lines of a multi-line template literal have no opening
      // backtick and were blanked entirely — a banned phrase added on one of
      // those lines sailed through the gate. Quote state has to survive the
      // whole block. Caught in review on #1140.
      pending.push({ line: currentLineNum, text });
    } else if (line.startsWith(" ")) {
      currentLineNum++;
    }
    // "-" lines don't advance the new-file line counter.
  }

  flush();
  return { findings, filesScanned: filesScanned.size, unreadable: null };
}

// ─── AUDIT MODE: scan ALL in-scope files ────────────────────────────────────
function scanAllFiles(): ScanResult {
  const out = git(["ls-files"]);
  const files = out
    .split("\n")
    .filter(Boolean)
    .map((f) => ({ f, surface: scopeOf(f) }))
    .filter((x): x is { f: string; surface: VoiceSurface } => x.surface !== null);

  const findings: Finding[] = [];
  for (const { f, surface } of files) {
    let body: string;
    try {
      body = readFileSync(resolve(APP_ROOT, f), "utf8");
    } catch {
      continue;
    }
    // Blank out comments rather than deleting them, so line numbers survive.
    const stripped = body
      .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length))
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, " "));
    const scannable = f.endsWith(".tsx")
      ? blankClassNames(stripped)
      : keepOnlyStringLiterals(stripped);
    for (const v of findVoiceViolations(scannable, { surface })) {
      findings.push({
        file: f,
        line: v.line,
        match: v.match,
        why: v.why,
        fix: v.fix,
        severity: v.severity,
        ruleId: v.ruleId,
      });
    }
  }
  return { findings, filesScanned: files.length, unreadable: null };
}

// ─── MAIN ───────────────────────────────────────────────────────────────────
const { findings, filesScanned, unreadable, nothingChanged } = AUDIT_MODE
  ? scanAllFiles()
  : scanDiff(RANGE_REF);
const blocking = findings.filter((f) => f.severity === "block");

// UNKNOWN is not CLEAN. Handled before any counting, because every count below
// is zero when the read failed, and zero renders as a pass.
//
// This FAILS CLOSED, unlike the unattended publishers in this codebase that
// deliberately fail open — and the difference is that a human is standing right
// here. A pre-commit gate that blocks tells the operator something is wrong and
// they can act or use --no-verify; a pre-commit gate that passes silently tells
// them nothing and the unscanned copy ships. The three-stage read above makes
// this branch essentially unreachable, so blocking costs nothing in practice.
if (unreadable) {
  console.error(`\n[brand-voice] SKIPPED — COULD NOT READ THE DIFF. Nothing was scanned.`);
  console.error(`  cause: ${unreadable}`);
  console.error(`  This is NOT a pass. The brand-voice kernel did not run against these changes.`);
  console.error(`  Re-run: pnpm run lint:brand-voice   ·   audit everything: pnpm exec tsx scripts/lint-brand-voice.ts --audit`);
  console.error(`  To commit anyway, deliberately: git commit --no-verify`);
  process.exit(1);
}

// NOTHING CHANGED is not CLEAN either, and it must not borrow the `ok` line.
//
// Exit 0, not 1: on a clean tree `pnpm run verify` legitimately has nothing to
// compare, and a gate that fails there is a gate someone routes around. But the
// wording has to make the vacuum visible, because this is exactly the shape CI
// ran in for months (a checkout stages nothing) while reporting green. Under a
// real `git commit` it cannot happen — a commit stages something.
if (nothingChanged) {
  console.log(
    `[brand-voice] NOTHING CHANGED to scan — ${RANGE_REF ? `${RANGE_REF}...HEAD is empty` : "nothing is staged"}. ` +
      `This is not a clean bill of health; nothing was read. ` +
      `CI: --range <base> · everything: --audit`,
  );
  process.exit(0);
}

if (findings.length === 0) {
  console.log(
    `[brand-voice] ${filesScanned} file(s) scanned · ${KILL_RULES.length} kernel rules · 0 violations · ok`,
  );
  process.exit(0);
}

const byFile = new Map<string, Finding[]>();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file)!.push(f);
}

for (const [file, fs] of byFile) {
  console.log(`\n${file}`);
  for (const f of fs) {
    console.log(`   line ${f.line}: "${f.match}"  [${f.ruleId} · ${f.severity}]`);
    if (f.context) console.log(`     -> ${f.context}`);
    console.log(`     why: ${f.why}`);
    console.log(`     fix: ${f.fix}`);
  }
}

console.log(`\n${"-".repeat(60)}`);
console.log(
  `Found ${findings.length} brand-voice violation(s) in ${byFile.size} file(s) · ${blocking.length} blocking.`,
);
console.log(
  `Mode: ${AUDIT_MODE ? "AUDIT (all files)" : RANGE_REF ? `RANGE (added lines in ${RANGE_REF}...HEAD)` : "PRE-COMMIT (staged diff only)"}`,
);
console.log(`Rules: shared/voice.ts (the Voice Kernel) — edit rules there, not here.`);

if (AUDIT_MODE) {
  console.log(`(audit mode — not blocking. Pre-commit mode only blocks on NEW lines.)`);
  process.exit(0);
}

if (blocking.length === 0) {
  console.log(`(warnings only — not blocking.)`);
  process.exit(0);
}

console.log(`To bypass for a legitimate one-off: git commit --no-verify`);
process.exit(1);
