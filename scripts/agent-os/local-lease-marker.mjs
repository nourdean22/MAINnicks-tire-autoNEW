#!/usr/bin/env node
/**
 * The LOCAL mirror of a lease (Session Authority · 2026-09-23) — written by
 * agent-start.mjs on acquire, cleared by agent-finish.mjs on release, read by
 * lease-check.mjs's fast PreToolUse tripwire. This is the ONLY thing lease-check.mjs
 * reads — pure filesystem, zero network calls per tool call (see lease-check.mjs's
 * header for why: the authoritative mutual-exclusion guarantee is the ref CAS at
 * agent-start time; this is a best-effort local nudge for "did I forget to run it."
 *
 * Lives inside the git directory itself (`git rev-parse --git-dir`, which resolves
 * correctly for a worktree too — each worktree gets its OWN git-dir under
 * .git/worktrees/<name>, so this marker is naturally per-worktree) — never inside
 * the tracked working tree, so it needs no .gitignore entry; git never tracks its
 * own metadata directory's contents.
 */
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { sh } from "./cli-common.mjs";

export function markerPath(cwd) {
  const gitDir = sh("git rev-parse --git-dir", cwd);
  const abs = gitDir.startsWith("/") || /^[A-Za-z]:[\\/]/.test(gitDir) ? gitDir : join(cwd, gitDir);
  return join(abs, "agent-os-lease.json");
}

export function writeLocalMarker(cwd, record) {
  writeFileSync(markerPath(cwd), `${JSON.stringify(record, null, 2)}\n`);
}

/** Parsed marker, or null if absent OR unreadable/corrupt — a bad marker must never
 * crash the caller; it is treated the same as "no marker," which is already the
 * safe (warn, not block) default. */
export function readLocalMarker(cwd) {
  const p = markerPath(cwd);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function clearLocalMarker(cwd) {
  const p = markerPath(cwd);
  if (existsSync(p)) rmSync(p);
}
