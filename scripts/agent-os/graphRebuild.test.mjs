// Canary for the graph rebuild on every merge (job 2026-11-03-graphify-always-on): scripts/agent-os/graph-rebuild.mjs
// queues `graphify update` on the PRIMARY checkout, detached under heavy.mjs, through the existing sync script's new
// -GraphOnly door; merge-gate.mjs calls it exactly once per MERGED (see the rebuild arms in mergeGate.test.mjs); the
// SessionStart graph line says "rebuild queued" while the sync lock is fresh. The daily task stays the fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { queueGraphRebuild, rebuildArgv } from "./graph-rebuild.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SYNC = readFileSync(join(ROOT, "scripts", "graphify-obsidian-sync.ps1"), "utf8");
const win = process.platform === "win32" ? false : "the sync runs in Windows PowerShell";

function primary(label, { lockAgeMin = null, sync = true, lockPid = process.pid } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `graph-rebuild-${label}-`));
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "graphify-out"));
  if (sync) writeFileSync(join(dir, "scripts", "graphify-obsidian-sync.ps1"), "# fixture");
  if (lockAgeMin !== null) {
    const f = join(dir, "graphify-out", ".sync-running");
    writeFileSync(f, `pid=${lockPid} started=planted`);
    const t = new Date(Date.now() - lockAgeMin * 60000);
    utimesSync(f, t, t);
  }
  return dir;
}
// Every arm below runs with the machine "able": 8 GB free and no heavy lease, unless it tests the gate itself.
const ABLE = { free: () => 8000, busy: () => false };
const fakeSpawn = () => {
  const calls = [];
  const spawn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { pid: 4242, on() {}, unref() { calls.at(-1).unref = true; } }; };
  return { spawn, calls };
};

test("queues exactly one detached heavy run of the sync script's -GraphOnly door on the primary, logs it, exit stays with the caller", async () => {
  const dir = primary("queue");
  const { spawn, calls } = fakeSpawn();
  const logs = [];
  await queueGraphRebuild({ primary: dir, platform: "win32", spawn, log: (m) => logs.push(m), ...ABLE });
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].cmd, ...calls[0].args], rebuildArgv(dir));
  assert.equal(calls[0].cmd, process.execPath);
  assert.ok(calls[0].args.includes("--max-wait") && calls[0].args.includes("1800s"), "bounded wait on the heavy lease");
  assert.ok(calls[0].args.at(-1) === "-GraphOnly" && calls[0].args.at(-2).endsWith(join("scripts", "graphify-obsidian-sync.ps1")), JSON.stringify(calls[0].args));
  assert.equal(calls[0].opts.detached, true);
  assert.equal(calls[0].unref, true, "the gate must not wait on the rebuild");
  assert.match(logs.join("\n"), /^GRAPH REBUILD queued: incremental graphify update on .* \(pid 4242, heavy lease, log graphify-out\/\.sync\.log\)$/m, JSON.stringify(logs));
});

test("a fresh sync lock (the daily task or an earlier merge is mid-run): nothing spawned, says already running", async () => {
  const dir = primary("fresh-lock", { lockAgeMin: 5 });
  const { spawn, calls } = fakeSpawn();
  const logs = [];
  await queueGraphRebuild({ primary: dir, platform: "win32", spawn, log: (m) => logs.push(m), ...ABLE });
  assert.equal(calls.length, 0);
  assert.match(logs.join("\n"), new RegExp(`GRAPH REBUILD already running \\(lock held 5 min, pid ${process.pid}\\); the next merge or the daily task picks up this one`));
});

test("a fresh lock whose pid is gone (reboot-killed sync) does not block: spawned, dead lock named", async () => {
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  const dir = primary("dead-lock", { lockAgeMin: 5, lockPid: dead });
  const { spawn, calls } = fakeSpawn();
  const logs = [];
  await queueGraphRebuild({ primary: dir, platform: "win32", spawn, log: (m) => logs.push(m), ...ABLE });
  assert.equal(calls.length, 1);
  assert.match(logs.join("\n"), new RegExp(`dead lock \\(pid ${dead} gone, 5 min\\) ignored`), JSON.stringify(logs));
});

test("a child that emits 'error' after spawn is logged as not queued (the listener is real, not a no-op)", async () => {
  const dir = primary("spawn-error");
  const logs = [];
  const handlers = {};
  const child = { pid: 77, on(ev, fn) { handlers[ev] = fn; }, unref() {} };
  await queueGraphRebuild({ primary: dir, platform: "win32", spawn: () => child, log: (m) => logs.push(m), ...ABLE });
  assert.ok(handlers.error, "no error listener attached");
  handlers.error(Object.assign(new Error("spawn EACCES"), { code: "EACCES" }));
  assert.match(logs.join("\n"), /GRAPH REBUILD not queued: EACCES; run scripts\/graphify-sync-launcher\.ps1/);
});

test("a spawn that returns no pid is logged as not queued with the manual command", async () => {
  const dir = primary("no-pid");
  const logs = [];
  await queueGraphRebuild({ primary: dir, platform: "win32", spawn: () => ({ pid: undefined, on() {}, unref() {} }), log: (m) => logs.push(m), ...ABLE });
  assert.match(logs.join("\n"), /GRAPH REBUILD not queued: spawn .* returned no pid; run scripts\/graphify-sync-launcher\.ps1/);
});

test("a stale lock (over 90 min, the sync died) does not mute the rebuild: spawned, and the lock age is logged", async () => {
  const dir = primary("stale-lock", { lockAgeMin: 300 });
  const { spawn, calls } = fakeSpawn();
  const logs = [];
  await queueGraphRebuild({ primary: dir, platform: "win32", spawn, log: (m) => logs.push(m), ...ABLE });
  assert.equal(calls.length, 1);
  assert.match(logs.join("\n"), /stale lock \(300 min\) ignored/);
});

test("not on Windows, or no sync script in the primary: nothing spawned, one honest line naming the daily task as the fallback", async () => {
  for (const [dir, platform] of [[primary("linux"), "linux"], [primary("no-sync", { sync: false }), "win32"]]) {
    const { spawn, calls } = fakeSpawn();
    const logs = [];
    await queueGraphRebuild({ primary: dir, platform, spawn, log: (m) => logs.push(m), ...ABLE });
    assert.equal(calls.length, 0);
    assert.match(logs.join("\n"), /GRAPH REBUILD not available here \(.*\); the daily NOURCITY-Graphify-Sync task rebuilds it/);
  }
});

// Manager ruling 2026-11-03: the update is not incremental on this repo (4 GB, 8 min 40 s per run), so a merge rebuild
// runs only on a machine that can carry it; otherwise the daily task does it, one day late instead of one merge late.
test("RAM gate: under 5000 MB free, or a heavy lease in use, nothing is spawned and the line says deferred with the number", async () => {
  for (const [free, busy, expect] of [[4999, false, /deferred to the daily task \(RAM 4999 MB; needs 5000 MB free and an idle lease\)/], [8000, true, /deferred to the daily task \(RAM 8000 MB, heavy lease in use; needs 5000 MB/], [NaN, false, /RAM unknown MB/]]) {
    const dir = primary("gate");
    const { spawn, calls } = fakeSpawn();
    const logs = [];
    await queueGraphRebuild({ primary: dir, platform: "win32", spawn, log: (m) => logs.push(m), free: () => free, busy: () => busy });
    assert.equal(calls.length, 0, `spawned with free=${free} busy=${busy}`);
    assert.match(logs.join("\n"), expect, JSON.stringify(logs));
  }
  const dir = primary("gate-open");
  const { spawn, calls } = fakeSpawn();
  await queueGraphRebuild({ primary: dir, platform: "win32", spawn, log: () => {}, free: () => 5000, busy: () => false });
  assert.equal(calls.length, 1, "exactly 5000 MB free and an idle lease runs");
});

test("RAM gate defaults: the real readers are os.freemem (HEAVY_FREE_MB injects) and heavy.mjs's lock file", async () => {
  const dir = primary("gate-real");
  const lock = join(mkdtempSync(join(tmpdir(), "graph-rebuild-lock-")));
  const { spawn, calls } = fakeSpawn();
  const logs = [];
  const prev = { ...process.env };
  try {
    process.env.HEAVY_LOCK_DIR = lock;
    process.env.HEAVY_FREE_MB = "9000";
    await queueGraphRebuild({ primary: dir, platform: "win32", spawn, log: (m) => logs.push(m) });
    assert.equal(calls.length, 1, "9000 MB free, no lock file: runs");
    writeFileSync(join(lock, "heavy.lock"), "{}");
    await queueGraphRebuild({ primary: dir, platform: "win32", spawn, log: (m) => logs.push(m) });
    assert.equal(calls.length, 1, "a heavy lease file defers");
    assert.match(logs.at(-1), /heavy lease in use/);
  } finally {
    process.env.HEAVY_LOCK_DIR = prev.HEAVY_LOCK_DIR; process.env.HEAVY_FREE_MB = prev.HEAVY_FREE_MB;
    if (prev.HEAVY_LOCK_DIR === undefined) delete process.env.HEAVY_LOCK_DIR;
    if (prev.HEAVY_FREE_MB === undefined) delete process.env.HEAVY_FREE_MB;
  }
});

test("wiring: merge-gate.mjs passes a rebuild built from graph-rebuild.mjs, imported only after a merge (a broken module cannot stop a merge)", () => {
  // Comment lines are dropped first: a commented-out wiring must not satisfy this (round-3 reader, mutant M8).
  const src = readFileSync(join(HERE, "merge-gate.mjs"), "utf8").split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.match(src, /rebuild: async \(log\) => \(await import\("\.\/graph-rebuild\.mjs"\)\)\.queueGraphRebuild\(/, "merge-gate.mjs must wire graph-rebuild.mjs lazily");
});

test("the sync script has the -GraphOnly door: label, render, vault, rotation and ingest are skipped; update, lock and receipt stay", () => {
  assert.match(SYNC, /\[switch\]\$GraphOnly/, "param missing");
  const code = SYNC.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
  // Each skipped step sits inside the GraphOnly guard; the update and the receipt do not.
  assert.match(code, /if \(\$GraphOnly\) \{[\s\S]*?Log "graph-only run/);
  assert.match(code, /Invoke-Bounded \$graphify @\('update', '\.'\)/);
  for (const step of ["graphify-render-communities.py", "graphify-obsidian-sync.py", "obsidian-backup-", "obsidian:ingest", "graphify label"]) {
    const at = code.indexOf(step);
    assert.ok(at > 0, `${step} not found`);
    assert.ok(code.lastIndexOf("if (-not $GraphOnly)", at) > code.indexOf("Invoke-Bounded $graphify"), `${step} is not under a -not GraphOnly guard after the update`);
  }
  assert.ok(code.indexOf("graphify-governance-receipt.mjs") > 0, "the receipt must still be written, or the session line reads RECEIPT MISMATCH");
});

test("the sync script still parses in Windows PowerShell 5.1 after the edit", { skip: win }, () => {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${join(ROOT, "scripts", "graphify-obsidian-sync.ps1")}', [ref]$null, [ref]$e); if ($e) { $e | ForEach-Object { $_.Message }; exit 1 }; 'parse ok'`], { encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
