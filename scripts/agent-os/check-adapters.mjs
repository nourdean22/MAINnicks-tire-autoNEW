#!/usr/bin/env node
/**
 * agent-os adapter parity check (Agent OS v1 · PR-A · 2026-08-04).
 *
 * Contract it enforces:
 *   1. Root AGENTS.md is the single canonical policy (required sections present,
 *      known-stale claims absent).
 *   2. Every vendor/app adapter EXISTS, POINTS at its canonical AGENTS.md, and
 *      stays THIN (line-capped) so it structurally cannot fork into a second
 *      policy. Drift prevention by construction, not by diffing.
 *   3. Files that previously carried refuted or dangerous claims stay clean
 *      (push-main.sh flow, ".husky", "Two apps", fabricated --read-only flag).
 *
 * Run:  node scripts/agent-os/check-adapters.mjs        (or: pnpm agent:parity)
 * Exit: 0 = parity holds · 1 = violations listed on stderr.
 * Zero dependencies; safe under CRLF.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const errors = [];
let checks = 0;

const abs = (p) => resolve(ROOT, p);
const exists = (p) => existsSync(abs(p));
const read = (p) => readFileSync(abs(p), "utf8");
const lineCount = (p) => read(p).split(/\r?\n/).length;

function requireFile(p, why) {
  checks++;
  if (!exists(p)) {
    errors.push(`MISSING  ${p} — ${why}`);
    return false;
  }
  return true;
}
function requireMatch(p, re, why) {
  checks++;
  if (!exists(p)) return; // reported by requireFile
  if (!re.test(read(p))) errors.push(`ABSENT   ${p} must contain ${re} — ${why}`);
}
/**
 * Forbid a pattern LINE BY LINE, optionally exempting lines that also carry a
 * correction marker.
 *
 * Why line-scoped with an exemption: a whole-file `.includes()` flags the very
 * sentence that retires the thing ("`push-main.sh` is RETIRED"), so the check
 * would demand deleting the correction that keeps the next agent from
 * reinventing it. The target is PRESCRIPTIVE use ("push via push-main.sh"),
 * never mention. `unless` therefore only spares a line that explicitly marks the
 * item dead — writing that marker over a live instruction is a false statement,
 * which is a different failure class than a mis-scoped check.
 */
function forbidLine(p, re, why, unless = null) {
  checks++;
  if (!exists(p)) return;
  const lines = read(p).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    // Prose wraps: a marker can sit on the line above the hit ("**Retired — …:**\n… push-main.sh").
    // Scan a 1-line window so reformatting a paragraph never turns a correction into a violation.
    if (unless && (unless.test(lines[i]) || (i > 0 && unless.test(lines[i - 1])))) continue;
    errors.push(`STALE    ${p}:${i + 1} — ${why}\n             ${lines[i].trim().slice(0, 110)}`);
    return; // one report per file is enough to fail the gate
  }
}

const RETIRED = /RETIRED|retired|no longer|does not exist|there is no|superseded|stale|forbidden/i;
function requireThin(p, max) {
  checks++;
  if (!exists(p)) return;
  const n = lineCount(p);
  if (n > max) errors.push(`FAT      ${p} is ${n} lines (cap ${max}) — adapters stay thin; policy belongs in AGENTS.md`);
}

// ── 1 · Canonical root AGENTS.md ──────────────────────────────────────────────
if (requireFile("AGENTS.md", "canonical cross-agent policy")) {
  for (const section of [
    "## Repo topology",
    "## Source-of-truth hierarchy",
    "## Branching",
    "## Context routing",
    "## Commands",
    "## Verify gates",
    "## Commit Attribution",
    "## Environment (Windows)",
    "## Agent adapters",
  ]) {
    requireMatch("AGENTS.md", new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "required canonical section");
  }
  forbidLine("AGENTS.md", /Two apps share this repo/, "stale two-app topology — three Railway services");
  forbidLine("AGENTS.md", /mcp_config\.json/, "references an untracked file; the launcher script + docs are canonical");
}

// ── 2 · Root vendor adapters ──────────────────────────────────────────────────
if (requireFile("CLAUDE.md", "Claude Code adapter")) {
  requireMatch("CLAUDE.md", /@AGENTS\.md/, "must import the canonical policy");
  requireThin("CLAUDE.md", 60);
}
if (requireFile("GEMINI.md", "Gemini CLI adapter")) {
  requireMatch("GEMINI.md", /@AGENTS\.md/, "must import the canonical policy (memport)");
  requireThin("GEMINI.md", 40);
}
if (requireFile(".github/copilot-instructions.md", "Copilot adapter")) {
  requireMatch(".github/copilot-instructions.md", /AGENTS\.md/, "must point at the canonical policy");
  requireThin(".github/copilot-instructions.md", 60);
}
for (const rule of ["repo-core", "nickstire", "statenour"]) {
  const p = `.cursor/rules/${rule}.mdc`;
  if (requireFile(p, "Cursor project rule")) {
    requireMatch(p, /AGENTS\.md/, "must point at an AGENTS.md");
    requireMatch(p, /alwaysApply:|globs:/, "mdc frontmatter must scope the rule");
    requireThin(p, 60);
  }
}

// ── 3 · Per-app canonical + adapters ─────────────────────────────────────────
for (const app of ["nickstire", "statenour", "worker"]) {
  requireFile(`apps/${app}/AGENTS.md`, "per-app canonical rules");
  const c = `apps/${app}/CLAUDE.md`;
  if (requireFile(c, "per-app Claude adapter")) {
    requireMatch(c, /AGENTS\.md/, "must route to the app AGENTS.md");
    requireThin(c, 80);
  }
}

// ── 4 · Moved / corrected content stays moved ────────────────────────────────
forbidLine("apps/nickstire/CLAUDE.md", /MASTER OPERATING DIRECTIVE/, "persona moved to docs/OPERATOR-DIRECTIVE.md (2026-08-04)");
if (requireFile("apps/nickstire/docs/OPERATOR-DIRECTIVE.md", "relocated operator persona (zero-loss move)")) {
  requireMatch("apps/nickstire/docs/OPERATOR-DIRECTIVE.md", /MASTER OPERATING DIRECTIVE/, "the moved block must actually be here");
}

// `.husky/pre-*` = a claim about where the hook lives (always wrong — lefthook).
// push-main.sh = a retired direct-main-push helper; mention is fine, prescription is not.
for (const f of [
  "AGENT-OPERATING-PROFILE.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".agents/frameworks/ciitty/SKILL.md",
  "apps/nickstire/AGENTS.md",
  "apps/nickstire/DEPLOY.md",
  "apps/statenour/AGENTS.md",
  "apps/worker/AGENTS.md",
]) {
  forbidLine(f, /\.husky\/pre-/, "husky is retired — the hook runner is lefthook.yml", RETIRED);
  forbidLine(f, /push-main\.sh/, "direct-main-push flow retired; branches + PR only", RETIRED);
  forbidLine(f, /There is no `?CODEOWNERS/, ".github/CODEOWNERS exists (real owner since 2026-07-21)");
  forbidLine(f, /apps\/voice/, "apps/voice was removed 2026-08-03", RETIRED);
  // Merge-authority fork (review finding 2026-08-04): root AGENTS.md grants autonomous
  // create-and-merge; per-app files must not quietly re-assert operator-only merging or a
  // branch protection that does not exist.
  forbidLine(f, /[Oo]perator merges all PRs/, "autonomous merging is allowed — root AGENTS.md > Branching");
  forbidLine(f, /main \(protected\)/, "there is NO branch protection on main — say 'squash-merge via PR only'", RETIRED);
}

// ── 5 · MCP truth + supply-chain pin ─────────────────────────────────────────
requireMatch(
  "docs/codebase-memory-mcp.md",
  /READ-WRITE/,
  "doc must state the filesystem server's real posture (no read-only flag exists)"
);
requireMatch(
  "docs/codebase-memory-mcp.md",
  /@modelcontextprotocol\/server-filesystem@\d/,
  "config examples must pin the server version"
);
requireMatch(
  "scripts/start-codebase-mcp.ps1",
  /server-filesystem@\d/,
  "launcher must pin the npx package (no unpinned npx in agent startup)"
);

// ── Report ───────────────────────────────────────────────────────────────────
if (errors.length) {
  console.error(`agent-os parity: ${errors.length} violation(s) across ${checks} checks\n`);
  for (const e of errors) console.error("  · " + e);
  console.error("\nCanonical policy lives in AGENTS.md — fix there or restore the adapter contract.");
  process.exit(1);
}
console.log(`agent-os parity: OK (${checks} checks, 0 violations)`);
