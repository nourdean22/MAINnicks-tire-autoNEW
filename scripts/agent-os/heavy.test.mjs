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
import { tmpdir } from "node:os";
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

test("an expired lock (over 20 minutes) is taken over", async () => {
  const dir = mkdtempSync(join(tmpdir(), "heavy-"));
  plantLock(dir, { pid: process.pid, startedMs: Date.now() - 21 * 60_000 });
  const r = await runAsync(dir, ["run", "--", process.execPath, "-e", "0"], { HEAVY_MAX_WAIT_MS: "3000" });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /took over .*expired/);
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
