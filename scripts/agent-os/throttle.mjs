#!/usr/bin/env node
/**
 * A tiny per-worktree, per-reason warning throttle (Session Authority · 2026-09-23).
 * Used by lease-check.mjs so a non-blocking warning fires at most once per
 * `minutes` window instead of on every one of dozens of tool calls per session —
 * unthrottled repeat noise is exactly what this repo's skill-fire-audit found gets
 * an operator to disable the check entirely, which would guard nothing.
 */
import { existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

function sentinelDir(cwd) {
  const gitDir = execSync("git rev-parse --git-dir", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const abs = gitDir.startsWith("/") || /^[A-Za-z]:[\\/]/.test(gitDir) ? gitDir : join(cwd, gitDir);
  return join(abs, "agent-os-warn-throttle");
}

/** True if a warning for `key` has NOT fired in the last `minutes`, in this
 * worktree. Fails open to true (warn) if the sentinel itself can't be checked —
 * a throttle that silently suppresses forever on error is worse than an extra line. */
export function shouldWarn(cwd, key, minutes) {
  try {
    const p = join(sentinelDir(cwd), `${key}.marker`);
    if (!existsSync(p)) return true;
    const ageMs = Date.now() - statSync(p).mtimeMs;
    return ageMs > minutes * 60 * 1000;
  } catch {
    return true;
  }
}

export function touchThrottle(cwd, key) {
  try {
    const dir = sentinelDir(cwd);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${key}.marker`), String(Date.now()));
  } catch {
    // best-effort only — worst case, the next call warns again
  }
}
