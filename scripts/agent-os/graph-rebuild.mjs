#!/usr/bin/env node
/**
 * graph-rebuild: queue an incremental rebuild of the repo graph on the PRIMARY checkout after a merge to main, so the
 * graph the MCP serves is fresh to the last merge instead of to the last 04:00 run (job 2026-11-03-graphify-always-on).
 *
 * Called by merge-gate.mjs once a PR reads MERGED (imported lazily there, so a broken module cannot stop a merge). It
 * spawns, DETACHED and unreferenced, `node heavy.mjs run --max-wait 1800s -- powershell ... graphify-obsidian-sync.ps1
 * -GraphOnly`: the sync script's own lock, watchdog (45 min ceiling), log and `graphify update .` step, with the label,
 * render, vault, rotation and ingest steps skipped (that door is -GraphOnly). heavy.mjs holds the machine-wide lease
 * (the update peaks near 4 GB RAM, measured 2026-11-03: 7,381 files, 8 min 40 s) and waits up to 30 min for it.
 * A FRESH sync lock (under LOCK_FRESH_MIN) means a rebuild is already running: nothing is spawned and the line says
 * so; the next merge or the daily NOURCITY-Graphify-Sync task (still registered, the fallback) picks up the rest.
 * A stale lock is the sync that died; the sync script overwrites it, so the rebuild runs. The MCP hot-reloads
 * graph.json by mtime (graphify serve.py), so no restart follows; graph-ensure-mcp.mjs restarts it at the next
 * SessionStart if the reload killed it (seen once, 2026-11-03).
 * Output: ONE line through the gate's log, `GRAPH REBUILD queued: ...` | `already running` | `not available here`.
 * heavy's own lines go to <primary>/graphify-out/.sync.log; the sync's record is graphify-out/obsidian-sync.log.
 * Canary: graphRebuild.test.mjs (plus the rebuild arms in mergeGate.test.mjs).
 */
import { spawn as nodeSpawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCK_FRESH_MIN = 90;
const MAX_WAIT = "1800s";
export const LOG = join("graphify-out", ".sync.log");

/** The primary checkout from any worktree: the parent of the ONE .git every worktree shares. */
export function primaryRoot(cwd) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const common = execFileSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"] }).trim();
  return dirname(resolve(common));
}

export const rebuildArgv = (primary) => [
  process.execPath, join(HERE, "heavy.mjs"), "run", "--max-wait", MAX_WAIT, "--",
  "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(primary, "scripts", "graphify-obsidian-sync.ps1"), "-GraphOnly",
];

export async function queueGraphRebuild({ cwd = process.cwd(), primary = null, platform = process.platform, spawn = nodeSpawn, log = console.log } = {}) {
  const root = primary ?? primaryRoot(cwd);
  const sync = join(root, "scripts", "graphify-obsidian-sync.ps1");
  const why = platform !== "win32" ? `this host is ${platform}` : !existsSync(sync) ? `${sync} is missing` : null;
  if (why) return log(`GRAPH REBUILD not available here (${why}); the daily NOURCITY-Graphify-Sync task rebuilds it`);
  const lock = join(root, "graphify-out", ".sync-running");
  let stale = "";
  if (existsSync(lock)) {
    const held = Math.round((Date.now() - statSync(lock).mtimeMs) / 60000);
    if (held < LOCK_FRESH_MIN) return log(`GRAPH REBUILD already running (lock held ${held} min); the next merge or the daily task picks up this one`);
    stale = `; stale lock (${held} min) ignored`;
  }
  mkdirSync(join(root, "graphify-out"), { recursive: true });
  const out = openSync(join(root, LOG), "a");
  const [cmd, ...args] = rebuildArgv(root);
  const child = spawn(cmd, args, { cwd: root, detached: true, stdio: ["ignore", out, out], windowsHide: true });
  child.unref();
  log(`GRAPH REBUILD queued: incremental graphify update on ${root} (pid ${child.pid}, heavy lease, log ${LOG.replaceAll("\\", "/")})${stale}`);
}
