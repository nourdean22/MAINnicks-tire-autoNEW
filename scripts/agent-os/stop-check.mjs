#!/usr/bin/env node
/**
 * Stop hook — Agent OS v1 (2026-08-04).
 *
 * Runs when Claude tries to end its turn. ONE precise invariant, deliberately narrow:
 *
 *   If the session's working tree is ON `main` AND carries uncommitted changes,
 *   block the stop and tell the agent to move the work to a named branch.
 *
 * That is the repo's hardest rule (AGENTS.md > Branching: NEVER commit to main) caught
 * at the exact moment it is about to be violated-by-default: an agent that edited files
 * while on main and is now wrapping up will otherwise either commit to main next session
 * or leave a mess for the sibling sessions sharing the tree.
 *
 * Everything else (tests-were-run receipts, evidence gates) is deliberately NOT here —
 * a Stop hook that blocks routine turns trains the operator to disable it. Widen only
 * with a canary proving the new rule's false-positive rate is ~zero.
 *
 * Failure posture: same as pretool.mjs — own bugs fail OPEN (exit 0 + stderr warning);
 * the matched invariant fails CLOSED (exit 2, stderr reason shown to the model).
 * stop_hook_active guards the loop: if our own block triggered this stop attempt,
 * allow it through rather than ping-ponging forever.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function git(args, cwd) {
  // 5 s per call: two sequential calls must finish inside the hook's 15 s budget
  // with headroom (a hook timeout is fail-open — the worst place to spend it).
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 5000 }).trim();
}

try {
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    process.exit(0); // manual run / malformed payload — not our problem to block on
  }

  // If a previous Stop block already fired in this chain, let the turn end.
  if (payload.stop_hook_active) process.exit(0);

  const cwd = payload.cwd || process.cwd();

  let branch = "";
  let dirty = "";
  try {
    branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    dirty = git(["status", "--porcelain"], cwd);
  } catch {
    process.exit(0); // not a git checkout (or git unavailable) — nothing to enforce
  }

  if (branch === "main" && dirty.length > 0) {
    process.stderr.write(
      [
        "BLOCKED by repo policy: uncommitted work on `main`.",
        "",
        "AGENTS.md > Branching: NEVER commit to main. Before ending the turn:",
        "  1. git checkout -b <nickstire|statenour|docs|chore>/<task>",
        "  2. git add <your files by explicit path>   (never -A)",
        "  3. commit, push the branch, open a PR (gh pr create).",
        "If these changes are NOT yours, say so in your report instead of committing them —",
        "a sibling session may own them. Do not clean them up destructively.",
      ].join("\n") + "\n",
    );
    process.exit(2);
  }

  process.exit(0);
} catch (err) {
  process.stderr.write(`[agent-os] stop hook error (allowing stop): ${err?.message ?? err}\n`);
  process.exit(0);
}
