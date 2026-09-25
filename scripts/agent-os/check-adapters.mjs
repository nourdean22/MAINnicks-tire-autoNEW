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

// AGENT_OS_ROOT lets the canary suite (adapters.test.mjs) point this checker at a
// throwaway fixture tree. Without it the control is untestable: you can only prove
// it fires by mutating the real policy files, which nobody will do in CI. Making a
// control testable is part of shipping it — see AGENTS.md > "Ship the canary".
const ROOT = process.env.AGENT_OS_ROOT
  ? resolve(process.env.AGENT_OS_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Say so, loudly, when the root is redirected. A green line reading the same whether
// this inspected the repo or a stray tree is the failure this file exists to prevent —
// and the checkout carries 8 worktrees, each with a complete, passing policy file set.
if (process.env.AGENT_OS_ROOT) {
  console.warn(`agent-os parity: ROOT OVERRIDDEN via AGENT_OS_ROOT -> ${ROOT}`);
  console.warn("  (correct ONLY under the canary suite; unset it for a real check)");
}
const errors = [];
let checks = 0;

const abs = (p) => resolve(ROOT, p);
const exists = (p) => existsSync(abs(p));
const read = (p) => readFileSync(abs(p), "utf8");
// A file ending in "\n" has N lines, not N+1: split() yields a trailing empty string
// for the final newline. The previous count charged every newline-terminated file one
// phantom line, so every cap was really one lower — uniformly, across all 11 requireThin
// call sites (15 files once the app loops expand), not just the four AGENTS.md ones.
// Disclosure: correcting this is what lets root AGENTS.md sit at exactly 200 rather
// than 199, so it is proved at the boundary in adapters.test.mjs (a file of exactly
// `cap` lines passes; `cap + 1` fails) rather than taken on trust.
const lineCount = (p) => {
  const text = read(p);
  return text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0);
};

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

/**
 * A line cap counts newlines, not context cost. Reflowing wrapped bullets into one long
 * line buys lines for free and changes nothing about what an agent loads. That is how root
 * AGENTS.md "made room" on 2026-08-22: seven wrapped passages reflowed into single long
 * lines, no words removed, and every gate stayed green while the file GREW.
 *
 * The intermediate line and byte figures are deliberately NOT quoted here. They existed only
 * in an uncommitted working tree, so no reader could reproduce them — and an unreproducible
 * receipt is worse than none. Same reason the ratchet comment below measures against origin/main.
 *
 * This is the canary the 2026-08-21 audit proposed under "Add a max-line-length canary" and
 * never built. Without it the line cap is a control that fires reliably on the wrong metric.
 *
 * Markdown table rows are exempt: one fact per row is the correct form, and the widest
 * row here (the Enforcement map, 549 chars) cannot be wrapped without losing the scope
 * column that makes it useful.
 */
function forbidLongLine(p, max = 140) {
  checks++;
  if (!exists(p)) return;
  const lines = read(p).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    // A real markdown row starts AND ends with a pipe and carries at least three.
    // Testing only the first character let any prose line evade the gate by being
    // prefixed with "| ". Verified: the strict form still exempts all 17 legitimate
    // long rows across the 8 enforced files, and newly fails none.
    const t = lines[i].trim();
    if (t.startsWith("|") && t.endsWith("|") && (t.match(/\|/g) || []).length >= 3) continue;
    if (lines[i].length <= max) continue;
    errors.push(
      `LONG     ${p}:${i + 1} is ${lines[i].length} chars (max ${max}) — wrap it; never reflow to beat a line cap`,
    );
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
requireFile("NOUR-COMMAND.md", "default cross-agent execution framework");
if (requireFile("AGENTS.md", "canonical cross-agent policy")) {
  for (const section of [
    "## Repo topology",
    "## Source-of-truth hierarchy",
    "## Branching",
    // Never listed before, despite being the no-agent-initiative list that every
    // non-Claude agent depends on entirely (they get no PreToolUse hook).
    "## Protected operations",
    "## Context routing",
    "## Commands",
    "## Verify gates",
    // Added with the section itself, 2026-08-22. Shipping a load-bearing section
    // without adding it here is how one got silently deleted before — the canary
    // "a required canonical section cannot vanish" exists because of that.
    "## Ship the canary",
    "## Commit Attribution",
    "## Environment (Windows)",
    "## Agent adapters",
  ]) {
    requireMatch("AGENTS.md", new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "required canonical section");
  }
  requireMatch("AGENTS.md", /NOUR-COMMAND\.md/, "must route non-trivial work through Nour Command");
  forbidLine("AGENTS.md", /Two apps share this repo/, "stale two-app topology — three Railway services");
  forbidLine("AGENTS.md", /mcp_config\.json/, "references an untracked file; the launcher script + docs are canonical");
}

// ── 2 · Root vendor adapters ──────────────────────────────────────────────────
if (requireFile("CLAUDE.md", "Claude Code adapter")) {
  // Anchored: an unanchored /@AGENTS\.md/ passes on any prose mention, which is the exact
  // false-green that let a LINKED profile ship as if it loaded (2026-08-21).
  requireMatch("CLAUDE.md", /^@AGENTS\.md$/m, "must IMPORT the canonical policy on its own @ line");
  requireMatch("CLAUDE.md", /^@NOUR-COMMAND\.md$/m, "must IMPORT Nour Command on its own @ line");
  requireThin("CLAUDE.md", 60);
}
if (requireFile("GEMINI.md", "Gemini CLI adapter")) {
  requireMatch("GEMINI.md", /@AGENTS\.md/, "must import the canonical policy (memport)");
  requireMatch("GEMINI.md", /^@NOUR-COMMAND\.md$/m, "must import Nour Command via memport");
  requireThin("GEMINI.md", 40);
}
if (requireFile(".github/copilot-instructions.md", "Copilot adapter")) {
  requireMatch(".github/copilot-instructions.md", /AGENTS\.md/, "must point at the canonical policy");
  requireMatch(".github/copilot-instructions.md", /NOUR-COMMAND\.md/, "must route through Nour Command");
  requireThin(".github/copilot-instructions.md", 60);
}
for (const rule of ["repo-core", "nickstire", "statenour"]) {
  const p = `.cursor/rules/${rule}.mdc`;
  if (requireFile(p, "Cursor project rule")) {
    requireMatch(p, /AGENTS\.md/, "must point at an AGENTS.md");
    requireMatch(p, /alwaysApply:|globs:/, "mdc frontmatter must scope the rule");
    if (rule === "repo-core") requireMatch(p, /NOUR-COMMAND\.md/, "always-on Cursor rule must route through Nour Command");
    requireThin(p, 60);
  }
}
// Antigravity was the ONE adapter with no cap here, and it is the one that forked: 885 lines
// across `.antigravityrules` + two docs/ANTIGRAVITY-*.md files, restating policy AGENTS.md
// already owned and contradicting it outright ("never merge without explicit owner approval"
// vs the autonomous-merge rule). Capping it is the fix; trimming it without the cap is not.
if (requireFile(".antigravityrules", "Antigravity adapter")) {
  requireMatch(".antigravityrules", /AGENTS\.md/, "must point at the canonical policy");
  requireMatch(".antigravityrules", /NOUR-COMMAND\.md/, "must route through Nour Command");
  requireThin(".antigravityrules", 60);
}
if (requireFile("docs/ANTIGRAVITY-RULES.md", "Antigravity reasoning layer (not policy)")) {
  requireMatch("docs/ANTIGRAVITY-RULES.md", /AGENTS\.md/, "must defer to the canonical policy");
}

// ── 3 · Per-app canonical + adapters ─────────────────────────────────────────
for (const app of ["nickstire", "statenour", "worker"]) {
  requireFile(`apps/${app}/AGENTS.md`, "per-app canonical rules");
  const c = `apps/${app}/CLAUDE.md`;
  if (requireFile(c, "per-app Claude adapter")) {
    requireMatch(c, /^@AGENTS\.md$/m, "must IMPORT its app AGENTS.md on its own @ line — a markdown link loads nothing");
    requireThin(c, 80);
  }
}

// ── 4 · Moved / corrected content stays moved ────────────────────────────────
forbidLine("apps/nickstire/CLAUDE.md", /MASTER OPERATING DIRECTIVE/, "persona moved to docs/OPERATOR-DIRECTIVE.md (2026-08-04)");
// The prescriptive form, not the mention: an adapter that TELLS an agent to wait for approval
// before merging contradicts the autonomous-merge rule in AGENTS.md. The archived profile is
// allowed to quote it (that is lineage); a live adapter is not (that is a second policy).
for (const f of [".antigravityrules", "docs/ANTIGRAVITY-RULES.md"]) {
  forbidLine(f, /Never merge without explicit owner approval/, "contradicts the autonomous-merge rule in AGENTS.md", RETIRED);
}
if (requireFile("apps/nickstire/docs/OPERATOR-DIRECTIVE.md", "relocated operator persona (zero-loss move)")) {
  requireMatch("apps/nickstire/docs/OPERATOR-DIRECTIVE.md", /MASTER OPERATING DIRECTIVE/, "the moved block must actually be here");
}

// Same zero-loss-move shape, 2026-08-21 (PR #1765): the operator's skill-discovery and subagent
// policies moved OUT of the machine-local ~/.claude/CLAUDE.md and INTO the repo. A machine-local
// file cannot be reviewed, versioned, or read by a sibling agent, so the move is the point — but a
// move is only zero-loss while BOTH ends hold. Assert the blocks landed AND that the capped adapter
// still points at them; otherwise the profile silently becomes an orphan doc and the adapter a
// dangling reference, which is exactly how the Antigravity fork started.
if (requireFile("CLAUDE-OPERATING-PROFILE.md", "relocated Claude operating profile (zero-loss move)")) {
  requireMatch("CLAUDE-OPERATING-PROFILE.md", /^SKILL DISCOVERY$/m, "the moved skill-discovery SECTION must be here (anchored: a bare substring match passes on a gutted section)");
  requireMatch("CLAUDE-OPERATING-PROFILE.md", /^SUBAGENT POLICY$/m, "the moved subagent SECTION must be here (anchored, same reason)");
  requireMatch("CLAUDE-OPERATING-PROFILE.md", /INHERIT THE STANCE/, "subagent rule 1 is the load-bearing one -- assert content, not just the heading");
  // MUST be the @-import form on its own line. A markdown link satisfies a bare substring match
  // but loads NOTHING — that exact false green shipped on 2026-08-21 and left the profile
  // loading in zero sessions while the parity check stayed green. Assert the mechanism.
  requireMatch("CLAUDE.md", /^@CLAUDE-OPERATING-PROFILE\.md$/m, "the adapter must IMPORT the profile (@ line), not merely link it — a link does not load");
  requireMatch("CLAUDE-OPERATING-PROFILE.md", /AGENTS\.md/, "the profile must defer to the canonical policy");
  requireThin("CLAUDE-OPERATING-PROFILE.md", 160);
}

// ── 4b · Canonical AGENTS.md files are capped too ──────────────────────────────
// Added 2026-08-21. Both root AGENTS.md and apps/nickstire/AGENTS.md PRINTED a line cap
// ("Cap: 200 lines, enforced by pnpm agent:parity" / "Cap: 150 lines") that nothing checked —
// requireThin was wired for every adapter but for none of the canonical files. Each had already
// drifted past its own stated number. A cap nobody measures is not a cap; it is a claim, and this
// repo's own rule is to assert the mechanism, not the mention.
{
  // 200 is the context-bloat threshold from the config-smell study (dos Santos et al.,
  // arXiv 2606.15828) and Anthropic's own <200-line guidance. Three of the four fit it.
  requireThin("apps/nickstire/AGENTS.md", 200);
  requireThin("apps/statenour/AGENTS.md", 200);
  requireThin("apps/worker/AGENTS.md", 200);
  // Root is NOT an exception any more: 200, the same cap as the per-app files, reached on
  // 2026-08-22 via 21 adversarially-verified relocations. Measured against origin/main, the only
  // baseline a reader can reproduce: 217 -> 200 lines, 15,036 -> 13,060 bytes. An earlier draft
  // of this comment cited "228 -> 200 / 15,941 -> 13,060"; 228 was an uncommitted mid-session
  // state present in no commit, so it was deleted rather than corrected — an unreproducible
  // receipt is worse than none. It was 240, then 220 — each time set just above whatever the
  // file happened to
  // measure. That is a rubber stamp, not a ratchet. The comment this replaces claimed
  // "reaching 199 required deleting rules, not prose"; true only because relocation had not
  // been exhausted — and never surfaced anywhere but this comment.
  // Lower this only by removing a rule you can name, or by relocating one to a destination
  // you have GREPPED and confirmed. Do NOT reflow to fit: forbidLongLine below exists
  // because a previous pass bought lines that way while the file grew.
  requireThin("AGENTS.md", 200);

  // EVERY requireThin-capped file that is clean at 140 is enforced here. The point is
  // the pairing: a line cap without a length check is evadable by reflow, so any file
  // with a cap and no length check is an open evasion path.
  //
  // An earlier version of this list was wrong in BOTH directions — it silently skipped
  // .antigravityrules and .cursor/rules/repo-core.mdc (both already clean, so free to
  // enforce), and its exemption note named AGENT-OPERATING-PROFILE.md, which carries no
  // requireThin cap at all and therefore was never an evasion path. Meanwhile
  // .github/copilot-instructions.md — capped at 60 lines, worst line 309 — went
  // unenforced AND undisclosed, which is precisely the hole this gate exists to close.
  for (const f of [
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    ".antigravityrules",
    ".cursor/rules/repo-core.mdc",
    "apps/nickstire/AGENTS.md",
    "apps/statenour/AGENTS.md",
    "apps/nickstire/CLAUDE.md",
    "apps/statenour/CLAUDE.md",
    "apps/worker/CLAUDE.md",
  ]) {
    forbidLongLine(f, 140);
  }
  // Capped but NOT length-checked, with the measured worst non-table line. Each is an
  // open reflow path until rewrapped; listed so the gap is reviewable rather than
  // invisible. Rewrap one and move its path into the loop above.
  //   .github/copilot-instructions.md   60-line cap, worst 309
  //   .cursor/rules/nickstire.mdc       60-line cap, worst 252
  //   .cursor/rules/statenour.mdc       60-line cap, worst 220
  //   apps/worker/AGENTS.md            200-line cap, worst 163
  //   CLAUDE-OPERATING-PROFILE.md      160-line cap, worst 601
}

// `.husky/pre-*` = a claim about where the hook lives (always wrong — lefthook).
// push-main.sh = a retired direct-main-push helper; mention is fine, prescription is not.
for (const f of [
  "AGENT-OPERATING-PROFILE.md",
  "CLAUDE-OPERATING-PROFILE.md",
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
