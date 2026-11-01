/**
 * Canaries for the machine-wide heavy-run lease (scripts/agent-os/heavy.mjs, 2026-10-16).
 *
 * Every test spawns the REAL CLI (process.execPath) against a private lock dir, so the
 * behaviour under test is the one lefthook and the briefs reach, not an imported helper.
 * Each gate has its positive control: a fresh lock held by a live pid must NOT be taken over.
 */
import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir, uptime } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HEAVY = join(dirname(fileURLToPath(import.meta.url)), "heavy.mjs");

function env(dir, extra = {}) {
  const e = { ...process.env, HEAVY_LOCK_DIR: dir, HEAVY_POLL_MS: "100", HEAVY_FREE_MB: "99999", ...extra };
  delete e.HEAVY_LEASE_HELD;
  return e;
}

function runAsync(dir, args, extra) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HEAVY, ...args], { env: env(dir, extra) });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

// A child command that stamps its start and end times into a file.
const stamp = (file, ms) =>
  `require('fs').appendFileSync(${JSON.stringify(file)},'start '+Date.now()+'\\n');setTimeout(()=>require('fs').appendFileSync(${JSON.stringify(file)},'end '+Date.now()+'\\n'),${ms})`;

const lockFile = (dir, slot = "heavy") => join(dir, `${slot}.lock`);
const plantLock = (dir, rec, slot = "heavy") =>
  writeFileSync(lockFile(dir, slot), JSON.stringify({ token: "planted", command: "planted cmd", session: "sib", ...rec }));

test("two concurrent runs serialize: the second starts only after the first exits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  const a = join(dir, "a.txt");
  const b = join(dir, "b.txt");
  const first = runAsync(dir, ["run", "--", process.execPath, "-e", stamp(a, 1200)]);
  await new Promise((r) => setTimeout(r, 400));
  const second = runAsync(dir, ["run", "--", process.execPath, "-e", stamp(b, 10)]);
  const [ra, rb] = await Promise.all([first, second]);
  assert.equal(ra.code, 0, ra.out);
  assert.equal(rb.code, 0, rb.out);
  const aEnd = Number(/end (\d+)/.exec(readFileSync(a, "utf8"))[1]);
  const bStart = Number(/start (\d+)/.exec(readFileSync(b, "utf8"))[1]);
  assert.ok(bStart >= aEnd, `second run started at ${bStart}, before the first ended at ${aEnd}`);
  assert.match(rb.out, /waiting for .* held by/);
  assert.ok(!existsSync(lockFile(dir)), "the lock must be released after the run");
});

test("positive control: a fresh lock held by a live pid is NOT taken over", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  plantLock(dir, { pid: process.pid, startedMs: Date.now() });
  const marker = join(dir, "ran.txt");
  const r = await runAsync(dir, ["run", "--", process.execPath, "-e", stamp(marker, 0)], { HEAVY_MAX_WAIT_MS: "1200" });
  assert.equal(r.code, 3, r.out);
  assert.ok(!existsSync(marker), "the command must not run while a live owner holds the lock");
  assert.match(r.out, /gave up/);
});

// 2026-10-31: three reboots. A typecheck ran 1,371 s, past the old 20 min TTL, while its tsc was still alive; the next waiter
// took the "expired" lease, started its own 2.9 GB tsc on top and free RAM fell to 559 MB. A run's lease now lives as long as
// its holder. bootMs is this boot's, so the record is also the positive control for the reboot check below.
const thisBoot = () => Math.round(Date.now() - uptime() * 1000);

test("a lease past the old 20 min TTL whose holder pid is ALIVE still blocks the waiter (no overlap)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  plantLock(dir, { pid: process.pid, startedMs: Date.now() - 21 * 60_000, bootMs: thisBoot() });
  const marker = join(dir, "ran.txt");
  const r = await runAsync(dir, ["run", "--", process.execPath, "-e", stamp(marker, 0)], { HEAVY_MAX_WAIT_MS: "1200" });
  assert.equal(r.code, 3, r.out);
  assert.ok(!existsSync(marker), "a waiter must not start while the holder's pid is alive, however old the lease");
  assert.doesNotMatch(r.out, /took over/);
});

test("the wrapper's pid is dead but the child it spawned is alive: the lease still holds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]).stdout.toString();
  plantLock(dir, { pid: Number(dead), childPid: process.pid, startedMs: Date.now() });
  const marker = join(dir, "ran.txt");
  const r = await runAsync(dir, ["run", "--", process.execPath, "-e", stamp(marker, 0)], { HEAVY_MAX_WAIT_MS: "1200" });
  assert.equal(r.code, 3, r.out);
  assert.ok(!existsSync(marker), "the 3 GB child is what overlaps; its pid keeps the lease");
});

test("a hung holder past the 45 min hard ceiling is reclaimed, and the takeover is logged", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  plantLock(dir, { pid: process.pid, startedMs: Date.now() - 46 * 60_000, bootMs: thisBoot() });
  const r = await runAsync(dir, ["run", "--", process.execPath, "-e", "0"], { HEAVY_MAX_WAIT_MS: "3000" });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /took over the heavy lease from planted cmd .*45 min ceiling/);
});

test("a lease written before a reboot is reclaimed at once, even when its pid number is alive again", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  plantLock(dir, { pid: process.pid, startedMs: Date.now(), bootMs: Date.now() - 30 * 86_400_000 });
  const r = await runAsync(dir, ["run", "--", process.execPath, "-e", "0"], { HEAVY_MAX_WAIT_MS: "3000" });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /took over .*rebooted/);
  const take = mkdtempSync(join(tmpdir(), "heavy-"));
  plantLock(take, { pid: null, startedMs: Date.now(), bootMs: Date.now() - 30 * 86_400_000 });
  const r2 = await runAsync(take, ["run", "--", process.execPath, "-e", "0"], { HEAVY_MAX_WAIT_MS: "3000" });
  assert.equal(r2.code, 0, r2.out);
  assert.match(r2.out, /took over .*rebooted/, "a pid-less `take` from before the reboot must not hold the slot for its full expiry");
});

test("a pid-less `take` record still ends at its expiry (over 20 minutes)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  plantLock(dir, { pid: null, startedMs: Date.now() - 21 * 60_000 });
  const r = await runAsync(dir, ["run", "--", process.execPath, "-e", "0"], { HEAVY_MAX_WAIT_MS: "3000" });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /took over .*expired/);
});

const intervals = (files) =>
  files.map((f) => {
    const t = readFileSync(f, "utf8");
    return [Number(/start (\d+)/.exec(t)[1]), Number(/end (\d+)/.exec(t)[1])];
  });
const assertDisjoint = (iv) => {
  const s = [...iv].sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < s.length; i++) assert.ok(s[i][0] >= s[i - 1][1], `runs overlapped: ${JSON.stringify(s)}`);
};

test("four runs racing for a FREE lease: exactly one holds it at a time (claim-before-act)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  const files = [0, 1, 2, 3].map((i) => join(dir, `r${i}.txt`));
  const rs = await Promise.all(files.map((f) => runAsync(dir, ["run", "--", process.execPath, "-e", stamp(f, 300)])));
  for (const r of rs) assert.equal(r.code, 0, r.out);
  assertDisjoint(intervals(files));
});

test("three runs racing to take over one DEAD holder's lease: exactly one wins at a time", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]).stdout.toString();
  plantLock(dir, { pid: Number(dead), startedMs: Date.now() });
  const files = [0, 1, 2].map((i) => join(dir, `r${i}.txt`));
  const rs = await Promise.all(files.map((f) => runAsync(dir, ["run", "--", process.execPath, "-e", stamp(f, 300)])));
  for (const r of rs) assert.equal(r.code, 0, r.out);
  assertDisjoint(intervals(files));
  assert.equal(rs.filter((r) => /took over/.test(r.out)).length, 1, "only one waiter may take over the dead lease");
});

test("status prints the holder pid, child pid and age", () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  plantLock(dir, { pid: process.pid, childPid: process.pid, startedMs: Date.now() - 95_000, bootMs: thisBoot() });
  const out = spawnSync(process.execPath, [HEAVY, "status"], { env: env(dir) }).stdout.toString();
  assert.match(out, new RegExp(`heavy: held by sib since \\S+ \\(age 1m 3[5-9]s\\) \\(planted cmd\\), pid ${process.pid}, child pid ${process.pid}`));
});

// Old copies of heavy.mjs in other worktrees judge only the on-disk startedMs against 20 min. The holder refreshes it, so those
// copies keep waiting too; acquiredMs keeps the real start, and readLock reports it as startedMs (status, board, the ceiling).
test("a running holder records its child pid and refreshes startedMs; readLock still reports the real start", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  const p = runAsync(dir, ["run", "--", process.execPath, "-e", "setTimeout(()=>{},1500)"], { HEAVY_REFRESH_MS: "200" });
  await new Promise((r) => setTimeout(r, 1000));
  const disk = JSON.parse(readFileSync(lockFile(dir), "utf8"));
  assert.equal(typeof disk.childPid, "number", JSON.stringify(disk));
  assert.notEqual(disk.childPid, disk.pid);
  assert.ok(disk.startedMs > disk.acquiredMs, `startedMs ${disk.startedMs} was not refreshed past acquiredMs ${disk.acquiredMs}`);
  process.env.HEAVY_LOCK_DIR = dir;
  try {
    const { readLock } = await import("./heavy.mjs");
    assert.equal(readLock("heavy").startedMs, disk.acquiredMs);
  } finally {
    delete process.env.HEAVY_LOCK_DIR;
  }
  assert.equal((await p).code, 0);
});

test("a holder whose lease a sibling took over never rewrites or releases the sibling's record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  const p = runAsync(dir, ["run", "--", process.execPath, "-e", "setTimeout(()=>{},1500)"], { HEAVY_REFRESH_MS: "100", HEAVY_MAX_WAIT_MS: "3000" });
  // Plant the sibling only once the holder has its lease (first draft planted on a timer and raced a slow holder start).
  for (let i = 0; i < 100 && !existsSync(lockFile(dir)); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(existsSync(lockFile(dir)), "the holder never took the lease");
  const now = Date.now();
  const sibling = JSON.stringify({ token: "sibling", pid: process.pid, bootMs: thisBoot(), session: "sib", command: "c", startedMs: now, acquiredMs: now });
  writeFileSync(lockFile(dir), sibling);
  assert.equal((await p).code, 0);
  assert.equal(readFileSync(lockFile(dir), "utf8"), sibling, "the sibling's record must survive the old holder's refresh and release");
});

test("a lock whose pid is dead is taken over", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]).stdout.toString();
  plantLock(dir, { pid: Number(dead), startedMs: Date.now() });
  const r = await runAsync(dir, ["run", "--", process.execPath, "-e", "0"], { HEAVY_MAX_WAIT_MS: "3000" });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /took over .*dead/);
});

test("low free RAM: the run waits, then starts once RAM recovers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  const ramFile = join(dir, "ram.txt");
  writeFileSync(ramFile, "400");
  const marker = join(dir, "ran.txt");
  const p = runAsync(dir, ["run", "--", process.execPath, "-e", stamp(marker, 0)], { HEAVY_FREE_MB: "", HEAVY_FREE_MB_FILE: ramFile });
  await new Promise((r) => setTimeout(r, 800));
  assert.ok(!existsSync(marker), "must not start under 1500 MB free");
  writeFileSync(ramFile, "4000");
  const r = await p;
  assert.equal(r.code, 0, r.out);
  assert.ok(existsSync(marker));
  assert.match(r.out, /free RAM 400 MB/);
});

test("a held chrome slot makes a heavy run wait; status prints both slots", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  const take = spawnSync(process.execPath, [HEAVY, "take", "--slot", "chrome"], { env: env(dir, { CLAUDE_SESSION_ID: "reels" }) });
  assert.equal(take.status, 0, String(take.stderr));
  const status = spawnSync(process.execPath, [HEAVY, "status"], { env: env(dir) }).stdout.toString();
  assert.match(status, /heavy: free/);
  assert.match(status, /chrome: held by reels/);
  const marker = join(dir, "ran.txt");
  const r = await runAsync(dir, ["run", "--", process.execPath, "-e", stamp(marker, 0)], { HEAVY_MAX_WAIT_MS: "1000" });
  assert.equal(r.code, 3, r.out);
  assert.ok(!existsSync(marker));
  spawnSync(process.execPath, [HEAVY, "release", "--slot", "chrome"], { env: env(dir) });
  const r2 = await runAsync(dir, ["run", "--", process.execPath, "-e", stamp(marker, 0)], { HEAVY_MAX_WAIT_MS: "1000" });
  assert.equal(r2.code, 0, r2.out);
  assert.ok(existsSync(marker));
});

test("a nested run inside a held lease runs directly instead of deadlocking on itself", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  const inner = `${JSON.stringify(process.execPath)} ${JSON.stringify(HEAVY)} run -- ${JSON.stringify(process.execPath)} -e 0`;
  const r = await runAsync(dir, ["run", "--", process.execPath, "-e", `process.exit(require('child_process').spawnSync(${JSON.stringify(inner)},{shell:true,stdio:'inherit'}).status)`], {
    HEAVY_MAX_WAIT_MS: "2000",
  });
  assert.equal(r.code, 0, r.out);
});

test("fails OPEN on its own errors: a lock dir under a regular file (ENOTDIR) runs the child unleased with its exit code", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  const file = join(dir, "plain-file");
  writeFileSync(file, "x");
  const r = await runAsync(join(file, "locks"), ["run", "--", process.execPath, "-e", "process.exit(7)"]);
  assert.equal(r.code, 7, r.out);
  assert.match(r.out, /running unleased/);
});

// 2026-10-19: four sibling commit hooks each waited 90 s and then ran tsc anyway (3.6 GB each), so the lease protected nothing once
// every waiter gave up together and git itself hit "Out of memory". The hook form now FAILS the hook; the session retries the commit.
test("--max-wait (the lefthook form): a held lease or low RAM waits briefly, then FAILS the hook (exit 1) and spawns no child", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  plantLock(dir, { pid: process.pid, startedMs: Date.now() });
  const marker = join(dir, "ran.txt");
  const r = await runAsync(dir, ["run", "--max-wait", "1s", "--", process.execPath, "-e", stamp(marker, 0)], { HEAVY_MAX_WAIT_MS: "4000" });
  assert.equal(r.code, 1, r.out);
  assert.ok(!existsSync(marker), "the command must NOT run unleased after the short wait");
  assert.match(r.out, /heavy lease busy: retry the commit/);
  assert.doesNotMatch(r.out, /proceeding unleased/);
  const ram = mkdtempSync(join(tmpdir(), "heavy-"));
  const ramMarker = join(ram, "ran.txt");
  const r2 = await runAsync(ram, ["run", "--max-wait", "1s", "--", process.execPath, "-e", stamp(ramMarker, 0)], { HEAVY_FREE_MB: "300", HEAVY_MAX_WAIT_MS: "4000" });
  assert.equal(r2.code, 1, r2.out);
  assert.ok(!existsSync(ramMarker), "low RAM must not run the command either");
  assert.match(r2.out, /free RAM 300 MB[\s\S]*heavy lease busy: retry the commit/);
});

test("--max-wait with a FREE lease still runs the command and passes its exit code (control: the new refusal is not a blanket failure)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  const marker = join(dir, "ran.txt");
  const r = await runAsync(dir, ["run", "--max-wait", "1s", "--", process.execPath, "-e", `require('fs').appendFileSync(${JSON.stringify(marker)},'x');process.exit(5)`], { HEAVY_MAX_WAIT_MS: "4000" });
  assert.equal(r.code, 5, r.out);
  assert.ok(existsSync(marker), "a free lease must run the command");
});

test("a lock file whose JSON is not an object (null) is corrupt: taken over once old, not waited on forever", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  writeFileSync(lockFile(dir), "null");
  const old = new Date(Date.now() - 60_000);
  utimesSync(lockFile(dir), old, old);
  const r = await runAsync(dir, ["run", "--", process.execPath, "-e", "0"], { HEAVY_MAX_WAIT_MS: "3000" });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /took over .*corrupt/);
});

test("corrupt takeover re-checks what it moved: a sibling's fresh lock written after our read is put back, not deleted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  process.env.HEAVY_LOCK_DIR = dir;
  try {
    const { readLock, takeOver } = await import("./heavy.mjs");
    writeFileSync(lockFile(dir), "{not json");
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockFile(dir), old, old);
    const judged = readLock("heavy");
    assert.ok(judged.corrupt);
    const sibling = JSON.stringify({ token: "sibling", pid: process.pid, session: "sib", command: "c", startedMs: Date.now() });
    writeFileSync(lockFile(dir), sibling); // the sibling took it over between our read and our rename
    assert.equal(takeOver("heavy", judged, "me"), false);
    assert.equal(readFileSync(lockFile(dir), "utf8"), sibling, "the sibling's lock must survive");
  } finally {
    delete process.env.HEAVY_LOCK_DIR;
  }
});

test("a signal to heavy kills the child before the lease is released", { skip: process.platform === "win32" ? "Windows has no catchable SIGTERM from process.kill; CI (Linux) runs this" : false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  const pidFile = join(dir, "child.pid");
  const child = spawn(process.execPath, [HEAVY, "run", "--", process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setTimeout(()=>{},30000)`], { env: env(dir) });
  for (let i = 0; i < 50 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 100));
  const childPid = Number(readFileSync(pidFile, "utf8"));
  child.kill("SIGTERM");
  await new Promise((r) => child.on("close", r));
  await new Promise((r) => setTimeout(r, 300));
  let alive = true;
  try {
    process.kill(childPid, 0);
  } catch {
    alive = false;
  }
  assert.equal(alive, false, "the command must not outlive the lease");
  assert.ok(!existsSync(lockFile(dir)));
});

test("the child's exit code is passed through", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  const r = await runAsync(dir, ["run", "--", process.execPath, "-e", "process.exit(7)"]);
  assert.equal(r.code, 7, r.out);
  assert.ok(!existsSync(lockFile(dir)), "a failing command still releases the lock");
});
