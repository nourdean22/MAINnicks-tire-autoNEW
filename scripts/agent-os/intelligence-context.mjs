#!/usr/bin/env node
/**
 * SessionStart intelligence receipt.
 *
 * Root CLAUDE.md already imports NOUR-COMMAND.md, so this stays deliberately small.
 * It proves the framework is active and gives one cheap local repo-state receipt.
 * Informational only. Never blocks session start.
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function git(args) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
  return execFileSync("git", ["-C", ROOT, ...args], {
    env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 4000,
  }).trim();
}
function main() {
  try {
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
    const head = git(["rev-parse", "--short=10", "HEAD"]);
    const origin = git(["rev-parse", "--short=10", "origin/main"]);
    const dirty = git(["status", "--porcelain"]).length > 0 ? "dirty" : "clean";

    console.log([
      "[nour-intelligence] ACTIVE — NOUR-COMMAND + Universal Operator default.",
      "[nour-intelligence] branch=" + branch + " head=" + head + " origin/main(local-ref)=" + origin + " tree=" + dirty + ".",
      "[nour-intelligence] Before consequential work: refresh remote truth, route the smallest relevant modes, reuse before rebuilding, falsify success, and prove completion.",
      "[nour-intelligence] Compact constrained-runtime kernel: docs/agent-os/NOUR-RUNTIME-KERNEL.md",
    ].join("\n"));
  } catch (err) {
    console.log("[nour-intelligence] ACTIVE, repo-state receipt unavailable (" + (err?.message ?? err) + "). " +
      "NOUR-COMMAND remains authoritative; do not treat this missing receipt as an all-clear.");
  }
}

main();