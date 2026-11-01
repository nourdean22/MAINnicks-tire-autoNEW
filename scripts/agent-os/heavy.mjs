#!/usr/bin/env node
/**
 * heavy: a machine-wide lease for heavy runs (job 2026-10-16-session-workflow-upgrade, mechanism B).
 *
 * Why: five sessions on one machine ran agent-os verify and app suites at the same time and free RAM fell to
 * 44-340 MB at least 6 times (OOM-shaped false reds; the reels session could not mount a Chrome page). The only
 * coordination was hand-sent "MACHINE HOLD" chat messages. This turns that into a lock file every session obeys.
 *
 *   node scripts/agent-os/heavy.mjs run -- <cmd...>      wait for the lease, run, release (exit code passed through)
 *   node scripts/agent-os/heavy.mjs run --max-wait 90s -- <cmd...>   hook form: after 90 s, exit 1 and run nothing (retry the commit)
 *   node scripts/agent-os/heavy.mjs run --slot chrome -- <cmd...>
 *   node scripts/agent-os/heavy.mjs take --slot chrome   hold the chrome slot (no pid: expires after 30 min)
 *   node scripts/agent-os/heavy.mjs release --slot chrome
 *   node scripts/agent-os/heavy.mjs status
 *
 * Lock files live OUTSIDE the repo (%LOCALAPPDATA%/nourcity/<slot>.lock), one JSON record each:
 * {token, pid, childPid, upMs, session, command, started, startedMs, acquiredMs}. A heavy run waits (never runs in
 * parallel, never kills anyone) while: the chrome slot is held, free RAM is under 1500 MB, or another heavy run holds the lease.
 * A `run` lease lives exactly as long as its holder (2026-10-31: a 1,371 s typecheck outlived the old 20 min TTL, a waiter
 * started a second 2.9 GB tsc on top, and the machine rebooted). It is taken over only when the wrapper pid AND the child pid
 * are both dead, when it was written before the machine last booted, or past the 45 min hard ceiling (a hung holder).
 * A pid-less `take` record keeps its expiry (heavy 20 min, chrome 30 min).
 * A command started under a held lease (HEAVY_LEASE_HELD in its env) runs nested calls directly.
 * Exit 3 = gave up waiting (HEAVY_MAX_WAIT_MS, default 35 min). Its own infrastructure errors (an unwritable lock dir)
 * fail OPEN: `run` warns and runs the command unleased. A signal kills the child before the lease is released.
 * Canary: heavy.test.mjs.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { freemem, homedir, uptime } from "node:os";
import { basename, join } from "node:path";
import { randomBytes } from "node:crypto";

const EXPIRY_MS = { heavy: 20 * 60_000, chrome: 30 * 60_000 };
const HARD_CEILING_MS = 45 * 60_000; // about 2x the slowest live holder seen (1,371 s): only a hung holder gets here
// Old copies of this script (worktrees cut before 2026-10-31) still expire a lease by on-disk startedMs at 20 min, so the
// holder rewrites startedMs every few minutes; acquiredMs keeps the real start.
const REFRESH_MS = Number(process.env.HEAVY_REFRESH_MS) || 5 * 60_000;
const MIN_FREE_MB = 1500;
const LOG_EVERY_MS = 30_000;
const POLL_MS = Number(process.env.HEAVY_POLL_MS) || 2000;
const MAX_WAIT_MS = Number(process.env.HEAVY_MAX_WAIT_MS) || 35 * 60_000;

export const lockDir = () =>
  process.env.HEAVY_LOCK_DIR || join(process.env.LOCALAPPDATA || join(homedir(), ".local", "state"), "nourcity");
const lockPath = (slot) => join(lockDir(), `${slot}.lock`);
const sessionName = () => process.env.CLAUDE_SESSION_ID || basename(process.cwd());

/** Free physical RAM in MB. HEAVY_FREE_MB / HEAVY_FREE_MB_FILE inject a reading (canaries only). */
export function readFreeMb() {
  if (process.env.HEAVY_FREE_MB) return Number(process.env.HEAVY_FREE_MB);
  if (process.env.HEAVY_FREE_MB_FILE) return Number(readFileSync(process.env.HEAVY_FREE_MB_FILE, "utf8").trim());
  return Math.round(freemem() / 1024 / 1024);
}

/** Milliseconds since this boot. Monotonic (it never steps with the wall clock), so it only goes backwards across a reboot. */
export const upMs = () => Math.round(uptime() * 1000);

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/** The current record, or null when free. A record that cannot be parsed counts as held for its first 5 s (mid-write). */
export function readLock(slot) {
  const p = lockPath(slot);
  let text;
  try {
    text = readFileSync(p, "utf8");
  } catch {
    return null;
  }
  let rec = null;
  try {
    rec = JSON.parse(text);
  } catch {}
  // Anything but an object (unparseable, null, a number, an array) is corrupt: a mid-write lock for its first 5 s.
  if (rec && typeof rec === "object" && !Array.isArray(rec)) {
    if (rec.acquiredMs) rec.startedMs = rec.acquiredMs; // on disk startedMs is the refresh stamp for old copies (REFRESH_MS)
    return Object.defineProperty(rec, "raw", { value: text });
  }
  let young = false;
  try {
    young = Date.now() - statSync(p).mtimeMs < 5000;
  } catch {}
  return Object.defineProperty({ token: null, corrupt: true, startedMs: young ? Date.now() : 0 }, "raw", { value: text });
}

/** Why a record no longer holds its slot ("corrupt", "expired", "dead pid", "machine rebooted", the ceiling), or null while live. */
export function staleReason(rec, slot, now = Date.now()) {
  if (rec.corrupt) return now - rec.startedMs >= 5000 ? "corrupt" : null;
  // Nothing written before the last boot still runs; a live-looking pid from then is a reused number, not our holder. Uptime,
  // not Date.now(): a wall-clock step read a live holder as rebooted (red-team 2026-10-31). shortcut: a reboot whose new uptime
  // already passed the record's goes unseen here; the dead-pid check still reclaims it, and a reused pid waits for the ceiling.
  if (rec.upMs && upMs() + 1000 < rec.upMs) return "machine rebooted";
  const age = now - Number(rec.startedMs || 0);
  if (!rec.pid) return age > EXPIRY_MS[slot] ? "expired" : null; // a `take` record: only its expiry ends it
  if (!pidAlive(rec.pid) && !pidAlive(rec.childPid)) return "dead pid";
  if (age > HARD_CEILING_MS) return `past the ${HARD_CEILING_MS / 60_000} min ceiling, holder hung`;
  return null;
}

/** Rewrite OUR record in place (atomic rename), never one a sibling has taken over. Best effort: the next refresh retries. */
function restamp(slot, token, fields) {
  const cur = readLock(slot);
  if (!cur || cur.token !== token) return;
  const tmp = `${lockPath(slot)}.${token}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify({ ...JSON.parse(cur.raw), ...fields }));
    renameSync(tmp, lockPath(slot));
  } catch {
  } finally {
    rmSync(tmp, { force: true });
  }
}

function tryCreate(slot, rec) {
  mkdirSync(lockDir(), { recursive: true });
  try {
    writeFileSync(lockPath(slot), JSON.stringify(rec), { flag: "wx" });
    return true;
  } catch (err) {
    if (err.code === "EEXIST") return false;
    throw err;
  }
}

/** Move a stale record aside, but only if it is still the record we judged (claim-before-act on its exact bytes). */
export function takeOver(slot, judged, mine) {
  const aside = `${lockPath(slot)}.${mine}`;
  try {
    renameSync(lockPath(slot), aside);
  } catch {
    return false; // someone else moved or released it first
  }
  let moved = null;
  try {
    moved = readFileSync(aside, "utf8");
  } catch {}
  // Compare bytes, corrupt or not: two waiters that both judged one corrupt file must not both take it over.
  if (moved !== judged.raw) {
    // shortcut: a sibling replaced the lock between our read and our rename; put theirs back. A third racer in that
    // same millisecond window could still slip in; acceptable for a coordination lock, not a security boundary.
    try {
      renameSync(aside, lockPath(slot));
    } catch {}
    return false;
  }
  rmSync(aside, { force: true });
  return true;
}

const describe = (rec) =>
  rec.corrupt ? "an unreadable lock" : `${rec.command} held by ${rec.session} since ${new Date(rec.startedMs).toISOString()}`;

/**
 * Wait until `slot` is ours. Returns the record written, or null after MAX_WAIT_MS.
 * For the heavy slot it also waits on the chrome slot and on free RAM.
 */
export async function acquire(slot, command, { pid = process.pid, maxWaitMs = MAX_WAIT_MS, log = (l) => process.stderr.write(`${l}\n`) } = {}) {
  const token = randomBytes(8).toString("hex");
  const started = Date.now();
  let lastReason = "";
  let lastLog = 0;
  const say = (reason) => {
    const now = Date.now();
    if (reason !== lastReason || now - lastLog >= LOG_EVERY_MS) {
      log(`[heavy] ${reason}`);
      lastReason = reason;
      lastLog = now;
    }
  };
  while (Date.now() - started < maxWaitMs) {
    let reason = null;
    if (slot === "heavy") {
      const chrome = readLock("chrome");
      if (chrome && !staleReason(chrome, "chrome")) reason = `waiting: the chrome slot is held (${describe(chrome)})`;
      if (!reason) {
        const free = readFreeMb();
        if (free < MIN_FREE_MB) reason = `waiting: free RAM ${free} MB is under ${MIN_FREE_MB} MB`;
      }
    }
    if (!reason) {
      const now = Date.now();
      const rec = { token, pid, upMs: upMs(), session: sessionName(), command, started: new Date(now).toISOString(), startedMs: now, acquiredMs: now };
      if (tryCreate(slot, rec)) return rec;
      const held = readLock(slot);
      if (held) {
        const stale = staleReason(held, slot);
        if (stale && takeOver(slot, held, token)) {
          log(`[heavy] took over the ${slot} lease from ${describe(held)} (${stale})`);
          continue;
        }
        reason = `waiting for ${describe(held)}`;
      }
    }
    if (reason) say(reason);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  log(`[heavy] gave up after ${Math.round(maxWaitMs / 1000)} s: ${lastReason}`);
  return null;
}

export function release(slot, token) {
  const rec = readLock(slot);
  if (rec && (token === undefined || rec.token === token)) rmSync(lockPath(slot), { force: true });
}

const quote = (a) => (/^[\w./:=@%+,\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);

function runChild(argv, env, holder = {}) {
  return new Promise((resolve) => {
    const start = (useShell) => {
      const child = (holder.child = useShell
        ? spawn(argv.map(quote).join(" "), { stdio: "inherit", env, shell: true })
        : spawn(argv[0], argv.slice(1), { stdio: "inherit", env }));
      if (child.pid) holder.onSpawn?.(child.pid);
      child.on("error", (err) => {
        // pnpm, npx and other .cmd shims need a shell on Windows; the error fires before anything ran.
        if (!useShell && (err.code === "ENOENT" || err.code === "EINVAL")) start(true);
        else resolve(127);
      });
      child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    };
    start(false);
  });
}

function parseDuration(s) {
  const m = /^(\d+)(ms|s|m)?$/.exec(String(s ?? ""));
  if (!m) throw new Error(`--max-wait wants a duration like 90s or 2m, got ${s}`);
  return Number(m[1]) * ({ ms: 1, s: 1000, m: 60_000 }[m[2] ?? "s"]);
}

function slotArg(args) {
  const i = args.indexOf("--slot");
  const slot = i >= 0 ? args[i + 1] : "heavy";
  if (!EXPIRY_MS[slot]) throw new Error(`unknown slot ${slot} (heavy or chrome)`);
  return slot;
}

async function main(args) {
  const verb = args[0];
  if (verb === "status") {
    for (const slot of Object.keys(EXPIRY_MS)) {
      const rec = readLock(slot);
      const stale = rec && staleReason(rec, slot);
      const age = rec && Math.max(0, Math.round((Date.now() - rec.startedMs) / 1000));
      const held = rec && `held by ${rec.session} since ${new Date(rec.startedMs).toISOString()} (age ${Math.floor(age / 60)}m ${age % 60}s)`;
      console.log(`${slot}: ${!rec ? "free" : stale ? `free (stale: ${describe(rec)}, ${stale})` : `${held} (${rec.command}), pid ${rec.pid ?? "none"}${rec.childPid ? `, child pid ${rec.childPid}` : ""}`}`);
    }
    console.log(`free RAM: ${readFreeMb()} MB (heavy runs wait under ${MIN_FREE_MB})`);
    return 0;
  }
  if (verb === "release") {
    release(slotArg(args));
    return 0;
  }
  if (verb === "take") {
    const slot = slotArg(args);
    const rec = await acquire(slot, `take --slot ${slot}`, { pid: null });
    if (!rec) return 3;
    console.log(`[heavy] ${slot} slot held by ${rec.session} until released or ${EXPIRY_MS[slot] / 60_000} min pass`);
    return 0;
  }
  if (verb === "run") {
    const dash = args.indexOf("--");
    const argv = dash >= 0 ? args.slice(dash + 1) : [];
    if (!argv.length) throw new Error("usage: heavy.mjs run [--slot chrome] -- <cmd...>");
    const opts = args.slice(0, dash);
    const slot = slotArg(opts);
    if (process.env.HEAVY_LEASE_HELD) return runChild(argv, process.env); // nested: our parent holds the lease
    // --max-wait <90s|2m>: the hook form. A git hook is killed by the caller long before 35 min, so after a short wait
    // it FAILS the hook (exit 1, no child) and the session retries the commit. Without it: the long wait, then exit 3.
    const mw = opts.indexOf("--max-wait");
    const short = mw >= 0 ? parseDuration(opts[mw + 1]) : null;
    let rec = null;
    try {
      rec = await acquire(slot, argv.join(" "), short ? { maxWaitMs: short } : {});
    } catch (err) {
      // Fail OPEN on our own infrastructure errors (unwritable lock dir, ENOTDIR): a broken lease must never block work.
      process.stderr.write(`[heavy] lease unavailable (${err.message}): running unleased\n`);
      return runChild(argv, process.env);
    }
    if (!rec && !short) return 3;
    if (!rec) {
      // 2026-10-19: running unleased here let four hooks that gave up together start four ~3.6 GB tsc runs at once (free RAM 8 MB,
      // git "Out of memory"). Fail the hook instead; the session retries the commit. Never a bypass.
      process.stderr.write("[heavy] heavy lease busy: retry the commit (the hook did not run its command; do not bypass the hook)\n");
      return 1;
    }
    const free = () => {
      try {
        release(slot, rec.token);
      } catch {}
    };
    // The child's pid keeps the lease if this wrapper is killed hard and the child lives on (a tool timeout that kills
    // only the top process); startedMs is refreshed for old copies of this script (REFRESH_MS).
    const holder = { onSpawn: (childPid) => restamp(slot, rec.token, { childPid }) };
    const refresh = setInterval(() => restamp(slot, rec.token, { startedMs: Date.now() }), REFRESH_MS);
    refresh.unref();
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      process.on(sig, () => {
        try {
          holder.child?.kill(sig); // the command must not outlive the lease
        } catch {}
        free();
        process.exit(130);
      });
    }
    try {
      return await runChild(argv, { ...process.env, HEAVY_LEASE_HELD: rec.token }, holder);
    } finally {
      clearInterval(refresh);
      free();
    }
  }
  console.error("usage: heavy.mjs run [--slot chrome] -- <cmd...> | take --slot chrome | release --slot chrome | status");
  return 2;
}

if (process.argv[1] && basename(process.argv[1]) === "heavy.mjs") {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`[heavy] ${err.message}`);
      process.exit(2);
    },
  );
}
