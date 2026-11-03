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
 * Output: ONE line through the gate's log, `GRAPH REBUILD queued: ...` | `already running` | `deferred to the daily
 * task (RAM N MB...)` (under MIN_FREE_MB free, or heavy.mjs's lease file present) | `not available here`.
 * heavy's own lines go to <primary>/graphify-out/.sync.log; the sync's record is graphify-out/obsidian-sync.log.
 * Canary: graphRebuild.test.mjs (plus the rebuild arms in mergeGate.test.mjs).
 */
import { spawn as nodeSpawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, statSync } from "node:fs";
import { freemem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lockDir } from "./heavy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCK_FRESH_MIN = 90;
const MAX_WAIT = "1800s";
// Manager ruling 2026-11-03: `graphify update .` is not incremental on this repo today (every code file re-extracted,
// 4.0 GB peak, 8 min 40 s), and 3-4 sessions share this laptop. A per-merge rebuild runs only when the machine can
// carry it: free RAM at or above MIN_FREE_MB and no heavy lease held or waited for. Otherwise it is deferred to the
// daily NOURCITY-Graphify-Sync task (the graph lags by one day instead of one merge).
const MIN_FREE_MB = 5000;
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

/** Free RAM in MB (HEAVY_FREE_MB injects a reading, as heavy.mjs's canaries do). */
const freeMb = () => (process.env.HEAVY_FREE_MB ? Number(process.env.HEAVY_FREE_MB) : Math.round(freemem() / 1024 / 1024));
/** True while heavy.mjs's lease file exists: a holder or a waiter is on the machine. */
const heavyBusy = () => existsSync(join(lockDir(), "heavy.lock"));

export async function queueGraphRebuild({ cwd = process.cwd(), primary = null, platform = process.platform, spawn = nodeSpawn, log = console.log, free = freeMb, busy = heavyBusy } = {}) {
  const root = primary ?? primaryRoot(cwd);
  const sync = join(root, "scripts", "graphify-obsidian-sync.ps1");
  const why = platform !== "win32" ? `this host is ${platform}` : !existsSync(sync) ? `${sync} is missing` : null;
  if (why) return log(`GRAPH REBUILD not available here (${why}); the daily NOURCITY-Graphify-Sync task rebuilds it`);
  const mb = free();
  if (!(mb >= MIN_FREE_MB) || busy()) {
    return log(`GRAPH REBUILD deferred to the daily task (RAM ${Number.isFinite(mb) ? mb : "unknown"} MB${busy() ? ", heavy lease in use" : ""}; needs ${MIN_FREE_MB} MB free and an idle lease)`);
  }
  const lock = join(root, "graphify-out", ".sync-running");
  let stale = "";
  if (existsSync(lock)) {
    const held = Math.round((Date.now() - statSync(lock).mtimeMs) / 60000);
    const pid = lockPid(lock);
    // A fresh lock means running only while its holder is alive: a reboot-killed sync must not block merges for 90 min.
    if (held < LOCK_FRESH_MIN && pid && alive(pid)) return log(`GRAPH REBUILD already running (lock held ${held} min, pid ${pid}); the next merge or the daily task picks up this one`);
    stale = pid && !alive(pid) ? `; dead lock (pid ${pid} gone, ${held} min) ignored` : `; stale lock (${held} min) ignored`;
  }
  mkdirSync(join(root, "graphify-out"), { recursive: true });
  const out = openSync(join(root, LOG), "a");
  const [cmd, ...args] = rebuildArgv(root);
  const child = spawn(cmd, args, { cwd: root, detached: true, stdio: ["ignore", out, out], windowsHide: true });
  if (!child.pid) return log(`GRAPH REBUILD not queued: spawn of ${cmd} returned no pid; run scripts/graphify-sync-launcher.ps1 in the primary`);
  child.on?.("error", (err) => log(`GRAPH REBUILD not queued: ${err.code || err.message}; run scripts/graphify-sync-launcher.ps1 in the primary`));
  child.unref();
  log(`GRAPH REBUILD queued: incremental graphify update on ${root} (pid ${child.pid}, heavy lease, log ${LOG.replaceAll("\\", "/")})${stale}`);
}

const lockPid = (lock) => { try { return Number(/pid=(\d+)/.exec(readFileSync(lock, "utf8"))?.[1]) || 0; } catch { return 0; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
