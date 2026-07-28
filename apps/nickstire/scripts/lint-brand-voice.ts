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
 * Two modes, unchanged:
 *   - PRE-COMMIT (default) — scans only ADDED lines in `git diff --cached`, so
 *     pre-existing violations don't block; only new ones do. Exit 1 on a
 *     `block`-severity hit.
 *   - AUDIT (`--audit`) — scans all in-scope files and reports the full set.
 *     Never exits non-zero; this is the inventory tool.
 *
 * Ported from lint-brand-voice.mjs (deleted in the same change). Behaviour kept:
 * scope list, admin exclusion, comment skipping, diff line accounting, output
 * shape and exit codes.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findVoiceViolations, KILL_RULES, type VoiceSurface } from "../shared/voice";
import { blankClassNames, keepOnlyStringLiterals } from "./lib/scanText";

const __filename = fileURLToPath(import.meta.url);
const APP_ROOT = resolve(dirname(__filename), "..");
const AUDIT_MODE = process.argv.includes("--audit");

// ─── Scope: only files where customers see the text ─────────────────────────
// Out of scope on purpose: tests, types, drizzle/schema.ts, admin/* (internal
// operator UI), server/_core, server/lib, server/routers (infra, not copy).
const IN_SCOPE: { rx: RegExp; surface: VoiceSurface }[] = [
  { rx: /^client\/src\/pages\/.*\.tsx$/, surface: "web" },
  { rx: /^client\/src\/components\/.*\.tsx$/, surface: "web" },
  { rx: /^server\/services\/vapi\.ts$/, surface: "voice" },
  { rx: /^server\/cron\/jobs\/.*Sequences\.ts$/, surface: "sms" },
  { rx: /^server\/cron\/jobs\/.*Outreach\.ts$/, surface: "sms" },
  { rx: /^server\/cron\/jobs\/.*Recovery\.ts$/, surface: "sms" },
  { rx: /^shared\/routes\.ts$/, surface: "meta" },
];

function scopeOf(relPath: string): VoiceSurface | null {
  if (relPath.includes("admin/")) return null;
  return IN_SCOPE.find((s) => s.rx.test(relPath))?.surface ?? null;
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

// ─── PRE-COMMIT MODE: scan only ADDED lines in the staged diff ──────────────
function scanStagedDiff(): { findings: Finding[]; filesScanned: number } {
  let diff: string;
  try {
    // -U0 = no context lines, only changed lines.
    diff = execSync("git diff --cached -U0", { cwd: APP_ROOT, encoding: "utf8" });
  } catch (err) {
    console.error("[brand-voice] git diff failed:", (err as Error).message);
    return { findings: [], filesScanned: 0 };
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
      // Strip the workspace prefix — git runs from APP_ROOT but reports repo paths.
      currentFile = fileMatch[1].replace(/^apps\/nickstire\//, "");
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
  return { findings, filesScanned: filesScanned.size };
}

// ─── AUDIT MODE: scan ALL in-scope files ────────────────────────────────────
function scanAllFiles(): { findings: Finding[]; filesScanned: number } {
  const out = execSync("git ls-files", { cwd: APP_ROOT, encoding: "utf8" });
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
  return { findings, filesScanned: files.length };
}

// ─── MAIN ───────────────────────────────────────────────────────────────────
const { findings, filesScanned } = AUDIT_MODE ? scanAllFiles() : scanStagedDiff();
const blocking = findings.filter((f) => f.severity === "block");

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
console.log(`Mode: ${AUDIT_MODE ? "AUDIT (all files)" : "PRE-COMMIT (staged diff only)"}`);
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
