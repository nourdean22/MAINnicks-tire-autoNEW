/**
 * CLI · Stale-doc guard.
 *
 * Scans ACTIVE (non-archive) agent-facing docs for retired deploy/provider
 * claims that would mislead a future AI agent into wrong behavior (pushing to
 * a retired branch, looking for a Vercel dashboard, citing a stale model).
 *
 * Current truth lives in docs/CURRENT-TRUTH.md:
 *   · statenour deploys from `main` → Railway → bdnick.info (NO Vercel).
 *   · `codex/ollama-local`, `statenour-master`, the standalone statenour-os
 *     repo, and the C:\Users\nourd\NOUR-OS path are all retired.
 *   · provider/model truth lives in lib/ai/provider.ts, not in prose.
 *
 * Two-layer exemption keeps false positives near zero:
 *   1. Whole-file skip when a file announces itself historical — under
 *      docs/archive/**, a dated filename (YYYY-MM-DD), a *-HISTORICAL name, or
 *      a safe-context word in its first 25 lines (a quarantine banner).
 *   2. Per-line skip when the offending line itself carries a safe-context
 *      word (historical / retired / archived / do-not-execute / obsolete /
 *      not current / superseded / quarantined / deprecated).
 *   A critical term in an ACTIVE doc on a line with NO safe word is the only
 *   thing that fails strict mode — exactly the case that misleads agents.
 *
 * Modes:
 *   · default            — print findings, exit 0 (advisory; safe in verify).
 *   · STALE_DOCS_STRICT=1 — exit 1 if any CRITICAL finding exists.
 *
 * Run:  pnpm check:stale-docs   ·   STALE_DOCS_STRICT=1 pnpm check:stale-docs
 */

import fs from "node:fs";
import path from "node:path";

export interface StaleTerm {
  /** Case-insensitive substring to match. */
  term: string;
  severity: "critical" | "warn";
  recommendation: string;
}

/** Words that, on a line or in a file header, mark stale terms as history. */
export const SAFE_CONTEXT_WORDS = [
  "historical",
  "retired",
  "archived",
  "do-not-execute",
  "do not execute",
  "obsolete",
  "not current",
  "superseded",
  "quarantined",
  "deprecated",
];

/**
 * CRITICAL = an active doc stating a retired deploy fact as a current
 * instruction. WARN = a hardcoded provider/model claim that should point to
 * lib/ai/provider.ts instead.
 */
export const STALE_TERMS: StaleTerm[] = [
  // ── critical: retired deploy paths ──
  { term: "push to BOTH", severity: "critical", recommendation: "Single push to `main` → Railway. Remove the dual-push instruction." },
  { term: "dual push", severity: "critical", recommendation: "Single push to `main` → Railway. Remove the dual-push instruction." },
  { term: "codex/ollama-local", severity: "critical", recommendation: "Retired branch. Production is `main`. See docs/CURRENT-TRUTH.md." },
  { term: "statenour-master", severity: "critical", recommendation: "Retired branch/mirror. Production is `main`. See docs/CURRENT-TRUTH.md." },
  { term: "Vercel production", severity: "critical", recommendation: "Vercel is retired for statenour. Production is `main` → Railway → bdnick.info." },
  { term: "deploys to Vercel", severity: "critical", recommendation: "Vercel is retired for statenour. Production is `main` → Railway → bdnick.info." },
  { term: "deployed on Vercel", severity: "critical", recommendation: "Vercel is retired for statenour. Production is `main` → Railway → bdnick.info." },
  { term: "deploy to Vercel", severity: "critical", recommendation: "Vercel is retired for statenour. Production is `main` → Railway → bdnick.info." },
  { term: "Vercel project config", severity: "critical", recommendation: "No Vercel project for statenour. Deploy config is Railway service watch-paths." },
  { term: "github.com/nourdean22/statenour-os", severity: "critical", recommendation: "Standalone repo retired. statenour lives in nourdean22/MAINnicks-tire-autoNEW at apps/statenour." },
  { term: "C:\\Users\\nourd\\NOUR-OS", severity: "critical", recommendation: "Retired local path. Canonical checkout is C:\\Users\\nourd\\NOURCITY." },
  // ── warn: hardcoded provider/model claims ──
  { term: "GLM-4.7", severity: "warn", recommendation: "Model ids drift — point to lib/ai/provider.ts instead of naming a model." },
  { term: "Venice primary", severity: "warn", recommendation: "Provider order is env/code-driven — point to lib/ai/provider.ts." },
  { term: "Venice is primary", severity: "warn", recommendation: "Provider order is env/code-driven — point to lib/ai/provider.ts." },
  { term: "AI_PROVIDER=ollama", severity: "warn", recommendation: "Don't assert a pinned provider in prose — AI_PROVIDER is an env knob; see lib/ai/provider.ts." },
  { term: "activeProviderSupportsTools", severity: "warn", recommendation: "Dead symbol removed in the 2026-06-04 code-review wave — drop the reference." },
];

const DATE_RE = /\d{4}-\d{2}-\d{2}/;

export interface Finding {
  file: string;
  line: number;
  term: string;
  severity: "critical" | "warn";
  recommendation: string;
  text: string;
}

function hasSafeWord(line: string): boolean {
  const lower = line.toLowerCase();
  return SAFE_CONTEXT_WORDS.some((w) => lower.includes(w));
}

/**
 * Prose wraps — a sentence like "the codex/ollama-local branch … are all
 * retired" puts the safe word a line or two below the term. Exempt a line if
 * any line within ±2 carries a safe-context word.
 */
function hasSafeWordNear(lines: string[], i: number, window = 2): boolean {
  const lo = Math.max(0, i - window);
  const hi = Math.min(lines.length - 1, i + window);
  for (let j = lo; j <= hi; j++) {
    if (hasSafeWord(lines[j])) return true;
  }
  return false;
}

/** A file is exempt wholesale when it announces itself as history. */
export function fileIsHistorical(relPath: string, content: string): boolean {
  const base = path.basename(relPath);
  const norm = relPath.replace(/\\/g, "/");
  // archive/ = quarantined; adr/ = immutable decision records (history by design).
  if (norm.includes("/archive/") || norm.includes("/adr/")) return true;
  if (DATE_RE.test(base)) return true;
  if (/HISTORICAL|DO-NOT-EXECUTE/i.test(base)) return true;
  const header = content.split(/\r?\n/).slice(0, 25).join("\n");
  if (hasSafeWord(header)) return true;
  return false;
}

/** Scan one file's content. Returns findings (empty if exempt). */
export function scanContent(relPath: string, content: string): Finding[] {
  if (fileIsHistorical(relPath, content)) return [];
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((rawLine, i) => {
    if (hasSafeWordNear(lines, i)) return; // line-level exemption (±2 for wrapped prose)
    const lower = rawLine.toLowerCase();
    for (const t of STALE_TERMS) {
      if (lower.includes(t.term.toLowerCase())) {
        findings.push({
          file: relPath,
          line: i + 1,
          term: t.term,
          severity: t.severity,
          recommendation: t.recommendation,
          text: rawLine.trim().slice(0, 120),
        });
      }
    }
  });
  return findings;
}

/** Recursively collect *.md under a dir, skipping docs/archive/**. */
function collectMarkdown(dir: string, acc: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "archive") continue; // never scan quarantined docs
      collectMarkdown(full, acc);
    } else if (entry.name.endsWith(".md")) {
      acc.push(full);
    }
  }
}

function checkDateSynchronization(cwd: string): Finding[] {
  const findings: Finding[] = [];
  const agentsPath = path.join(cwd, "AGENTS.md");
  const reconPath = path.join(cwd, "docs/RECONCILIATION.md");

  if (!fs.existsSync(agentsPath) || !fs.existsSync(reconPath)) {
    return [];
  }

  const agentsContent = fs.readFileSync(agentsPath, "utf8");
  const reconContent = fs.readFileSync(reconPath, "utf8");

  const agentsMatch = /Last refreshed:(?:\*\*|\s)*(\d{4}-\d{2}-\d{2})/i.exec(agentsContent);
  const reconMatch = /Last verified:(?:\*\*|\s)*(\d{4}-\d{2}-\d{2})/i.exec(reconContent);

  if (!agentsMatch) {
    findings.push({
      file: "AGENTS.md",
      line: 1,
      term: "Last refreshed",
      severity: "warn",
      recommendation: "Please add a 'Last refreshed: YYYY-MM-DD' stamp to AGENTS.md.",
      text: "Could not find last refreshed date stamp in AGENTS.md",
    });
  }

  if (!reconMatch) {
    findings.push({
      file: "docs/RECONCILIATION.md",
      line: 1,
      term: "Last verified",
      severity: "warn",
      recommendation: "Please add a 'Last verified: YYYY-MM-DD' stamp to docs/RECONCILIATION.md.",
      text: "Could not find last verified date stamp in docs/RECONCILIATION.md",
    });
  }

  if (agentsMatch && reconMatch) {
    const agentsDate = agentsMatch[1];
    const reconDate = reconMatch[1];

    if (agentsDate !== reconDate) {
      findings.push({
        file: "AGENTS.md",
        line: 1,
        term: "Date mismatch",
        severity: "critical",
        recommendation: `Update AGENTS.md Last refreshed date (${agentsDate}) to match docs/RECONCILIATION.md Last verified date (${reconDate}).`,
        text: `AGENTS.md last refreshed date (${agentsDate}) does not match docs/RECONCILIATION.md last verified date (${reconDate}).`,
      });
    }
  }

  return findings;
}

function main(): void {
  const cwd = process.cwd();
  const strict = process.env.STALE_DOCS_STRICT === "1";

  // Scan set: AGENTS.md + docs/**/*.md (minus archive) + optional CLAUDE.md /
  // README.md at the app root and the monorepo root.
  const targets: string[] = [];
  const agentsMd = path.join(cwd, "AGENTS.md");
  if (fs.existsSync(agentsMd)) targets.push(agentsMd);
  collectMarkdown(path.join(cwd, "docs"), targets);
  for (const extra of ["CLAUDE.md", "README.md", "../../CLAUDE.md", "../../README.md"]) {
    const p = path.join(cwd, extra);
    if (fs.existsSync(p)) {
      // Only scan a README if it actually references statenour.
      if (extra.endsWith("README.md")) {
        const c = fs.readFileSync(p, "utf8");
        if (!/statenour/i.test(c)) continue;
      }
      targets.push(p);
    }
  }

  console.log("");
  console.log("stale-doc guard · scanning active agent-facing docs");
  console.log(strict ? "  mode: STRICT (critical findings fail)" : "  mode: advisory (warn only, exit 0)");
  console.log("");

  const all: Finding[] = [];
  for (const file of targets) {
    const rel = path.relative(cwd, file).replace(/\\/g, "/");
    const content = fs.readFileSync(file, "utf8");
    all.push(...scanContent(rel, content));
  }

  // Check date synchronization between AGENTS.md and docs/RECONCILIATION.md
  all.push(...checkDateSynchronization(cwd));

  const criticals = all.filter((f) => f.severity === "critical");
  const warns = all.filter((f) => f.severity === "warn");

  const emit = (f: Finding) => {
    const icon = f.severity === "critical" ? "❌" : "⚠️ ";
    console.log(`  ${icon} [${f.severity}] ${f.file}:${f.line}  matched "${f.term}"`);
    console.log(`        ${f.text}`);
    console.log(`        → ${f.recommendation}`);
  };

  if (criticals.length) {
    console.log(`CRITICAL (${criticals.length}) — retired deploy facts stated as current:`);
    criticals.forEach(emit);
    console.log("");
  }
  if (warns.length) {
    console.log(`WARN (${warns.length}) — hardcoded provider/model claims:`);
    warns.forEach(emit);
    console.log("");
  }

  console.log(`scanned ${targets.length} files · ${criticals.length} critical · ${warns.length} warn`);

  if (criticals.length === 0 && warns.length === 0) {
    console.log("✓ no stale deploy/provider claims in active docs");
  }

  if (strict && criticals.length > 0) {
    console.error(`✖ ${criticals.length} critical stale-doc finding(s) — failing (STALE_DOCS_STRICT=1)`);
    process.exit(1);
  }
  process.exit(0);
}

// Only run when invoked directly (not when imported by the test).
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  /check-stale-docs\.(ts|js|mjs)$/.test(process.argv[1]);
if (invokedDirectly) main();
