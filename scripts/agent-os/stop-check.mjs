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
 * ── 2026-08-24 · SECOND INVARIANT: unpushed commits ─────────────────────────
 *
 * THE BUG THIS CLOSES. A session stopping with work outstanding was
 * indistinguishable, from outside, from a session that had finished. Idle and
 * done produced the identical signal — silence — and the operator was catching it
 * by polling and re-prodding. That is a human patch over a missing control, and
 * it is the blind-instrument shape: an instrument that cannot separate two very
 * different states.
 *
 * WHAT IS CHECKED, and why only this. Commits that exist locally and are not on
 * the remote. That is unambiguous: someone made them and did not push them, and
 * nothing else in the repo will notice. Deliberately NOT checked:
 *
 *   · uncommitted working-tree changes on a feature branch. This checkout is
 *     SHARED with sibling sessions (AGENTS.md > Branching), so dirty files
 *     routinely belong to someone else. Blocking on them would fire constantly
 *     for another session's work — exactly the false-positive rate the note
 *     above forbids widening into.
 *   · a pushed branch with no PR. `gh` is not reliably authenticated in the
 *     agent sandbox (statenour AGENTS.md §5), so the check would fail open at
 *     random and its silence would mean nothing.
 *
 * WHY EXIT 2 IS NOT A HARD BLOCK HERE. `stop_hook_active` short-circuits at the
 * top: the first stop attempt is interrupted with the message, and a second one
 * passes straight through. So this is a ONE-SHOT loud interrupt, not a gate that
 * can trap a session in a loop — which is what makes it compatible with the
 * doctrine above rather than a violation of it. "STOPPING WITH N COMMIT(S)
 * UNPUSHED" is a different signal from silence, and silence is what was failing.
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
  // Same GIT-env hygiene as the canary (see stop-check.test.mjs sh()):
  // an inherited GIT_DIR would make this read some OTHER repo's state
  // and answer the main-with-uncommitted-changes question about the
  // wrong tree. cwd must be the only thing that picks the repo.
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
  return execFileSync("git", args, { cwd, env, encoding: "utf8", timeout: 5000 }).trim();
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

  // ── Invariant 2 · unpushed commits (one-shot, loud) ──────────────────────
  // Runs BEFORE the main check only in the sense of being independent; the main
  // branch case below is still the harder rule and is evaluated on its own.
  if (branch && branch !== "main" && branch !== "HEAD") {
    let ahead = "";
    try {
      // Compare against the remote-tracking ref directly rather than @{u}: a
      // branch created locally often has no upstream configured, and `@{u}`
      // throws there — which would make this check silently do nothing on
      // exactly the branches most likely to hold unpushed work.
      const remoteRef = `refs/remotes/origin/${branch}`;
      let hasRemote = true;
      try {
        git(["rev-parse", "--verify", "--quiet", remoteRef], cwd);
      } catch {
        hasRemote = false;
      }
      // ONLY branches that exist on the remote. A never-pushed local branch is
      // genuinely ambiguous here and the first version of this check got it
      // wrong on its very first run: it counted `origin/main..HEAD`, which
      // reported "1 commit unpushed" for a branch that had been SQUASH-MERGED
      // weeks earlier. A squash merge rewrites the commit, so the original is
      // never an ancestor of main and every stale merged branch in this
      // checkout looks like outstanding work. (Recorded in agent memory as
      // git-squash-merge-freezes-at-merged-commit.)
      //
      // Distinguishing "never pushed, real work" from "squash-merged, stale"
      // needs a content comparison this hook cannot afford inside its 15s
      // budget. So it does not guess: no remote ref, no opinion. That misses
      // the never-pushed case, and missing it is the correct trade against a
      // check that cries wolf on every old branch and gets disabled.
      ahead = hasRemote ? git(["rev-list", "--count", `${remoteRef}..HEAD`], cwd) : "0";
    } catch {
      ahead = ""; // own-bug fail-open: never block on a git question we could not ask
    }

    const n = Number(ahead);
    if (Number.isFinite(n) && n > 0) {
      let subjects = "";
      try {
        subjects = git(["log", "--oneline", "--max-count=5", `-${Math.min(n, 5)}`], cwd);
      } catch {
        subjects = "";
      }
      process.stderr.write(
        [
          `STOPPING WITH ${n} COMMIT(S) UNPUSHED on \`${branch}\`.`,
          "",
          "Idle and finished look identical from outside. This is the one-shot",
          "interrupt that tells them apart — a second stop attempt will pass.",
          "",
          subjects ? subjects.split("\n").map((l) => `  ${l}`).join("\n") : "  (could not list commits)",
          "",
          "Either push and open/refresh the PR, or state plainly in your report that",
          "you are stopping with work outstanding and what remains. Do not end the",
          "turn silently — that is the exact failure this exists to catch.",
        ].join("\n") + "\n",
      );
      process.exit(2);
    }
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
