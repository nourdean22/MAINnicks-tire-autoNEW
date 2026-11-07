#!/usr/bin/env node
/**
 * machine-sync: keep this PC at origin/main and repaired without anyone asking (job 2026-11-07-machine-sync-task).
 * Nour, 2026-11-07: "make sync automatic instead of asked ... a Windows scheduled task on every machine that pulls main
 * and runs the machine check at login and every hour ... you never ask again".
 *
 *   node scripts/agent-os/machine-sync.mjs            pull main (ff-only, clean main only), run bootstrap-machine.mjs in
 *                                                     repair mode, write the receipt, print one line; exit 1 when not in sync
 *   node scripts/agent-os/machine-sync.mjs --check    no pull; bootstrap --check only (a dry run); the receipt still lands
 *   node scripts/agent-os/machine-sync.mjs --status   print the last receipt, run nothing
 *   --repo <dir> --state-dir <dir> --bootstrap <script>   test seams (the primary checkout, %LOCALAPPDATA%/nourcity, the real script)
 *
 * Schedule: scripts/register-machine-sync-task.ps1 (task NOURCITY-Machine-Sync, at logon and every hour; listed in
 * config/agent-os/local-services.json so session-health reports it MISSING or FAILED on the PC that serves the graph).
 * The pull never touches a checkout that has uncommitted changes or sits on another branch: it records why and exits 1.
 * Receipt: <state-dir>/machine-sync.json {at, host, sha, pulled, pullSkipped, bootstrap: {mode, exit, state}, versions, ok}.
 * Canary: machineSync.test.mjs.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toolVersions } from "./bootstrap-machine.mjs";
import { stripGitLocalEnv } from "./gitLocalEnv.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV = stripGitLocalEnv();

const flag = (argv, name) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : null; };

/** The primary checkout, so a worktree's removal never strands the task. */
function primaryRepo() {
  const repo = resolve(HERE, "..", "..");
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: repo, encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "ignore"] }).trim();
    return dirname(common);
  } catch {
    return repo;
  }
}

const git = (cwd, args, timeout = 20_000) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: ENV, timeout, windowsHide: true });
  if (r.status !== 0) throw new Error((r.stderr || r.error?.message || `git ${args[0]} failed`).trim().split("\n")[0]);
  return r.stdout.trim();
};

/** Pull origin/main into a clean main checkout; anything else is recorded and left as it is. */
export function pullMain(repo) {
  const branch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main") return { pulled: false, pullSkipped: `on ${branch}, not main` };
  if (git(repo, ["status", "--porcelain", "--untracked-files=no"])) return { pulled: false, pullSkipped: "uncommitted changes in the checkout" };
  const before = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["pull", "--ff-only", "origin", "main"], 120_000);
  return { pulled: git(repo, ["rev-parse", "HEAD"]) !== before, pullSkipped: null };
}

/** Run bootstrap-machine.mjs; its last "[bootstrap] ..." line is the state (clean | N item(s) to fix | refused ...). */
export function runBootstrap(script, check) {
  const r = spawnSync(process.execPath, [script, ...(check ? ["--check"] : [])], { encoding: "utf8", env: ENV, timeout: 180_000, windowsHide: true });
  const lines = `${r.stdout ?? ""}`.split(/\r?\n/).filter((l) => l.startsWith("[bootstrap]"));
  const changed = lines.filter((l) => /^\[bootstrap\] (installed|updated)/.test(l)).length;
  const last = lines.at(-1)?.replace(/^\[bootstrap\]\s*/, "") ?? (r.error?.message || `no output${r.stderr?.trim() ? `: ${r.stderr.trim().split(/\r?\n/)[0]}` : ""}`);
  const state = check || r.status !== 0 ? last.replace(/: run without --check$/, "") : changed ? `repaired ${changed} item(s)` : "clean";
  return { mode: check ? "check" : "repair", exit: r.status, state };
}

export const line = (rec) => `[machine-sync] main ${rec.sha ? rec.sha.slice(0, 7) : "unknown"}${rec.pulled ? " (pulled)" : rec.pullSkipped ? ` (not pulled: ${rec.pullSkipped})` : ""} | bootstrap ${rec.bootstrap?.state ?? "not run"} | node ${rec.versions?.node ?? "?"} git ${rec.versions?.git ?? "?"} claude ${rec.versions?.claude ?? "not on PATH"}${rec.ok ? "" : " | NOT IN SYNC"}`;

function main(argv) {
  const repo = flag(argv, "--repo") ?? primaryRepo();
  const stateDir = flag(argv, "--state-dir") ?? join(process.env.LOCALAPPDATA || join(homedir(), ".local", "state"), "nourcity");
  const file = join(stateDir, "machine-sync.json");
  if (argv.includes("--status")) {
    if (!existsSync(file)) { process.stdout.write("[machine-sync] never ran on this PC (no receipt)\n"); return 1; }
    const rec = JSON.parse(readFileSync(file, "utf8"));
    process.stdout.write(`${line(rec)} | at ${rec.at}\n`);
    return rec.ok ? 0 : 1;
  }
  const check = argv.includes("--check");
  const rec = { at: new Date().toISOString(), host: (process.env.COMPUTERNAME || hostname()).toUpperCase(), sha: null, pulled: false, pullSkipped: null, bootstrap: null, versions: null, ok: false, error: null };
  try {
    if (!check) Object.assign(rec, pullMain(repo));
    rec.sha = git(repo, ["rev-parse", "HEAD"]);
    rec.bootstrap = runBootstrap(flag(argv, "--bootstrap") ?? join(HERE, "bootstrap-machine.mjs"), check);
    rec.versions = toolVersions();
    rec.ok = rec.bootstrap.exit === 0 && (check || rec.pullSkipped === null);
  } catch (err) {
    rec.error = String(err?.message || err).split("\n")[0];
  }
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(file, JSON.stringify(rec, null, 2));
  process.stdout.write(`${line(rec)}${rec.error ? ` | error: ${rec.error}` : ""}\n`);
  return rec.ok ? 0 : 1;
}

if (process.argv[1] && basename(process.argv[1]) === "machine-sync.mjs") process.exitCode = main(process.argv.slice(2));
