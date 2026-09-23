#!/usr/bin/env node
/**
 * SessionStart lease-awareness line (Session Authority · 2026-09-23). One
 * informational line, once per session, before any tool call — deliberately
 * minimal: lease-check.mjs already covers the ongoing PreToolUse signal (throttled);
 * this just gives the earliest possible one at session start. Never blocks —
 * SessionStart hooks inform, they don't gate.
 */
import { readLocalMarker } from "./local-lease-marker.mjs";

function main() {
  const cwd = process.cwd();
  const marker = readLocalMarker(cwd);
  if (!marker) {
    console.log("[agent-os] no Session Authority lease held for this worktree yet (run agent-start.mjs if this branch is shared).");
    return;
  }
  const expired = !marker.expiresAt || Date.parse(marker.expiresAt) <= Date.now();
  console.log(
    expired
      ? `[agent-os] Session Authority lease for "${marker.branch}" EXPIRED at ${marker.expiresAt} — consider re-running agent-start.mjs.`
      : `[agent-os] Session Authority lease held for "${marker.branch}" until ${marker.expiresAt}.`,
  );
}

main();
