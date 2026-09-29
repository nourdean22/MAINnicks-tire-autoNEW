#!/usr/bin/env node
/**
 * lease-check — PreToolUse TRIPWIRE for Session Authority (2026-09-23). Fires on
 * every Bash/PowerShell/Write/Edit/NotebookEdit call (same matcher as pretool.mjs).
 *
 * NOT the authoritative guarantee — that is the git-ref compare-and-swap at
 * agent-start.mjs time (lease.mjs). This is a fast, LOCAL-ONLY, zero-network check
 * of the marker agent-start.mjs writes on acquire (local-lease-marker.mjs): does
 * THIS worktree's marker say the CURRENT session holds a live lease for the CURRENT
 * branch. Deliberately not itself hitting the GitHub API on every tool call — that
 * would add a network round-trip (and this repo's fail-open-on-hook-error posture)
 * to every single call, so a network hiccup would make the "enforcement" decorative
 * exactly when least reliable. pretool.mjs's engine (config/agent-os/policy.json)
 * is a pure, red-teamed regex matcher (22 closed bypasses) with no file I/O or
 * clock-awareness by explicit design — this file follows stop-check.mjs's
 * precedent for hook logic that needs state instead, rather than becoming rule #18
 * of an engine that was specifically hardened as a pure matcher.
 *
 * WARN vs BLOCK, and why "foreign" is knowable with zero network calls: a marker
 * whose `sessionId` differs from THIS session's own id, sitting in THIS exact
 * worktree, means some OTHER session's marker was left here — a worktree reused or
 * handed off without a clean agent-finish, the precise collision risk this whole
 * system exists to catch. That comparison needs no GitHub call; the marker already
 * carries both identities.
 *   - no marker at all                         -> WARN, THROTTLED (rollout default;
 *                                                  see below)
 *   - marker for a DIFFERENT branch             -> WARN, THROTTLED (stale/irrelevant)
 *   - marker is MINE, expired                   -> WARN, THROTTLED
 *   - marker is MINE, unexpired                  -> silent ALLOW
 *   - marker is FOREIGN, expired                -> WARN, THROTTLED (low risk)
 *   - marker is FOREIGN, unexpired               -> BLOCK (exit 2), ALWAYS, never
 *                                                  throttled — this is the real
 *                                                  collision case
 *
 * Warnings are throttled per-reason (15 min) via a sentinel file next to the
 * marker: printing a line on every one of dozens of tool calls per session is
 * exactly the kind of automation this repo's own skill-fire-audit found gets
 * disabled by an annoyed operator, which would guard nothing. The one path that
 * must never be throttled is the actual block, and it is not.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { readLocalMarker } from "./local-lease-marker.mjs";
import { resolveSessionId, isMainModule } from "./cli-common.mjs";
import { shouldWarn, touchThrottle } from "./throttle.mjs";

const ALLOW = 0;
const BLOCK = 2;
const THROTTLE_MINUTES = 15;

function currentBranch(cwd) {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null; // not a git repo / detached in a way rev-parse dislikes / etc.
  }
}

function isExpired(marker) {
  if (!marker?.expiresAt) return true;
  return Date.parse(marker.expiresAt) <= Date.now();
}

/**
 * The ONE command a foreign live marker must let through: running agent-finish.mjs
 * itself, which the block message tells the session to run (audit item O — v1
 * blocked it too, so the only way out was hand-deleting the marker). It must be the
 * WHOLE command: `node` (or node.exe), then a path ending in
 * scripts/agent-os/agent-finish.mjs (bare, or wrapped in one pair of quotes), then
 * plain arguments. No chain operator, pipe, background `&`, redirection, subshell,
 * backtick, `$` expansion, parenthesis or newline anywhere, and no node flag before
 * the script — so nothing can ride along with the recovery. Probe set (chaining,
 * prefixes, look-alike names, PowerShell forms) in lease-check.test.mjs.
 *
 * The path may not START with "-", quoted or not (audit 2026-09-29 F6). Node reads
 * such a token as a flag, and a flag whose VALUE merely ends in the script path,
 * e.g. --import=data:text/javascript,<code>//scripts/agent-os/agent-finish.mjs,
 * matched the old pattern while running arbitrary code before any script.
 */
const SAFE = String.raw`[^\s;&|\`$<>()"'\n\r]`;
const SAFE_IN_QUOTES = String.raw`[^;&|\`$<>()"'\n\r]`;
const TAIL = String.raw`scripts[\\/]agent-os[\\/]agent-finish\.mjs`;
const NOT_A_FLAG = "(?!-)";
const RECOVERY_COMMAND = new RegExp(
  String.raw`^[ \t]*node(?:\.exe)?[ \t]+` +
    String.raw`(?:"${NOT_A_FLAG}(?:${SAFE_IN_QUOTES}*[\\/])?${TAIL}"|'${NOT_A_FLAG}(?:${SAFE_IN_QUOTES}*[\\/])?${TAIL}'|${NOT_A_FLAG}(?:${SAFE}*[\\/])?${TAIL})` +
    String.raw`(?:[ \t]+[^;&|\`$<>()\n\r]*)?[ \t]*$`,
);

export function isRecoveryCommand(command) {
  return typeof command === "string" && RECOVERY_COMMAND.test(command);
}

/** Pure decision function — no I/O, fully unit-testable. `command` is the Bash /
 * PowerShell command string (undefined for Write/Edit/NotebookEdit); `override` is
 * the value of AGENT_OS_LEASE_OVERRIDE, an explicit operator escape hatch whose
 * reason is echoed on every (throttled) warning. */
export function decide({ marker, branch, mySessionId, command, override }) {
  if (!marker) return { verdict: "warn", key: "no-marker", message: "no Session Authority lease marker found for this worktree — run `node scripts/agent-os/agent-start.mjs` if this branch is shared." };
  if (marker.branch !== branch) return { verdict: "warn", key: "wrong-branch", message: `lease marker is for branch "${marker.branch}", not the current "${branch}" — stale from a prior checkout.` };

  const mine = marker.sessionId === mySessionId;
  const expired = isExpired(marker);

  if (mine && !expired) return { verdict: "allow" };
  if (mine && expired) return { verdict: "warn", key: "self-expired", message: `your Session Authority lease for "${branch}" expired at ${marker.expiresAt} — re-run agent-start.mjs.` };
  if (!mine && expired) return { verdict: "warn", key: "foreign-expired", message: `a lease marker from another session (${marker.sessionId}) is present for "${branch}" but expired at ${marker.expiresAt} — likely a reused worktree; safe to ignore or re-run agent-start.mjs.` };

  // !mine && !expired — the real collision case.
  if (isRecoveryCommand(command)) return { verdict: "allow" };
  if (typeof override === "string" && override.trim()) {
    return {
      verdict: "warn",
      key: "override",
      message: `AGENT_OS_LEASE_OVERRIDE is set ("${override.trim()}") — allowing calls in a worktree whose live lease marker belongs to session ${marker.sessionId}, not this one.`,
    };
  }
  return {
    verdict: "block",
    message:
      `REFUSED: this worktree's lease marker for "${branch}" belongs to session ${marker.sessionId}, not this session, and has not expired (until ${marker.expiresAt}). ` +
      `This worktree may have been reused or handed off without releasing its lease — uncommitted work here may not be yours. ` +
      `Confirm with the operator, then release it with exactly this command, on its own (no ; && | or subshell): ` +
      `node scripts/agent-os/agent-finish.mjs --force-release-foreign "<why>" — or have the operator set AGENT_OS_LEASE_OVERRIDE="<why>" for this session.`,
  };
}

function main() {
  let cwd = process.cwd();
  let command;
  try {
    const raw = readFileSync(0, "utf8");
    if (raw.trim()) {
      const payload = JSON.parse(raw);
      if (typeof payload.cwd === "string") cwd = payload.cwd;
      if (typeof payload.tool_input?.command === "string") command = payload.tool_input.command;
    }
  } catch {
    // no/unparseable stdin (manual run) — fall back to process.cwd()
  }

  const branch = currentBranch(cwd);
  if (!branch) return ALLOW; // not resolvable — nothing to check, fail open silently

  const marker = readLocalMarker(cwd);
  const result = decide({ marker, branch, mySessionId: resolveSessionId(), command, override: process.env.AGENT_OS_LEASE_OVERRIDE });

  if (result.verdict === "allow") return ALLOW;

  if (result.verdict === "block") {
    process.stderr.write(`[lease-check] ${result.message}\n`);
    return BLOCK;
  }

  // warn — throttled per reason, per worktree.
  if (shouldWarn(cwd, result.key, THROTTLE_MINUTES)) {
    process.stderr.write(`[lease-check] ${result.message}\n`);
    touchThrottle(cwd, result.key);
  }
  return ALLOW;
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(main());
  } catch (err) {
    // Fail OPEN, but loudly — matches pretool.mjs's documented posture exactly.
    process.stderr.write(`[lease-check] hook error (allowing call): ${err?.message ?? err}\n`);
    process.exit(ALLOW);
  }
}
