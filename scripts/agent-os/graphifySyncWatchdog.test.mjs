/**
 * Canary for the graphify sync watchdog (scripts/graphify-obsidian-sync.ps1, the `# >>> watchdog` block) and the
 * session-start HUNG line (scripts/graphify-session-context.ps1).
 * 2026-11-01: `graphify update .` hung 5 h with no ceiling. This extracts the REAL Invoke-Bounded from the script,
 * runs it in Windows PowerShell 5.1 (the scheduled task's shell) against a planted hang and a quick command, and
 * checks the wiring: step 1 must go through it, and a failed step 1 must stop the run before the vault write.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = readFileSync(join(ROOT, "scripts", "graphify-obsidian-sync.ps1"), "utf8");
const code = SRC.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
const block = SRC.match(/# >>> watchdog\r?\n([\s\S]*?)# <<< watchdog/)?.[1];
const win = process.platform === "win32" ? false : "the watchdog runs in Windows PowerShell";

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === "ESRCH") return false; throw e; } };
const end = (pid) => { try { process.kill(pid); } catch { /* already gone */ } };

test("wiring: step 1 runs graphify update through Invoke-Bounded, never bare, and a failure exits before the vault write", () => {
  assert.ok(block && /function Invoke-Bounded/.test(block), "the watchdog block is missing");
  assert.match(code, /Invoke-Bounded \$graphify @\('update', '\.'\)/);
  assert.doesNotMatch(code, /& \$graphify update/, "a bare `& $graphify update` has no ceiling");
  assert.match(code, /\$updateExit = Invoke-Bounded[\s\S]{0,120}if \(\$updateExit -ne 0\)[\s\S]{0,200}exit 1/, "a timed-out update must abort the run");
});

/** Runs the extracted block plus `body` in powershell.exe; returns {out, err, log}. */
function harness(body) {
  const dir = mkdtempSync(join(tmpdir(), "graphify-watchdog-"));
  const log = join(dir, "sync.log");
  const ps1 = join(dir, "h.ps1");
  writeFileSync(ps1, `$log = '${log}'\nfunction Log($m) { "[t] $m" | Add-Content -Path $log }\n${block}\n${body}\n`);
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1], { encoding: "utf8", timeout: 60000 });
  return { out: r.stdout.trim(), err: r.stderr, log: (() => { try { return readFileSync(log, "utf8"); } catch { return ""; } })() };
}

/** A .cjs plant file (an inline -e script does not survive Start-Process's argument joining). */
function plant(src) {
  const f = join(mkdtempSync(join(tmpdir(), "graphify-watchdog-plant-")), "plant.cjs");
  writeFileSync(f, src);
  return f;
}

test("a planted hang is killed at its ceiling with its child (graphify.exe launches python): 124, ERROR, both gone", { skip: win }, () => {
  const dir = mkdtempSync(join(tmpdir(), "graphify-watchdog-pid-"));
  const pidFile = join(dir, "pid"), kidFile = join(dir, "kid");
  const kid = plant(`require("fs").writeFileSync(${JSON.stringify(kidFile)}, String(process.pid)); setTimeout(() => {}, 120000);`);
  const f = plant(`const fs = require("fs"); fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
require("child_process").spawn(process.execPath, [${JSON.stringify(kid)}], { stdio: "ignore" }); setTimeout(() => {}, 120000);`);
  const t0 = Date.now();
  const r = harness(`$code = Invoke-Bounded '${process.execPath}' @('"${f}"') 0.05 'planted-hang'; "CODE=$code"`);
  const pid = Number(readFileSync(pidFile, "utf8")), kidPid = Number(readFileSync(kidFile, "utf8"));
  const [a, b] = [alive(pid), alive(kidPid)];
  end(pid); end(kidPid);
  assert.match(r.out, /CODE=124$/m, r.err);
  assert.match(r.log, /ERROR: planted-hang hung past 0\.05 min - killed pid/);
  assert.equal(a, false, `the hung step (pid ${pid}) survived the watchdog`);
  assert.equal(b, false, `the hung step's child (pid ${kidPid}) survived: the kill must take the tree`);
  assert.ok(Date.now() - t0 < 45000, "the ceiling did not fire near 3 s");
});

test("control: a quick command returns its own exit code, and its stdout and stderr reach the log", { skip: win }, () => {
  const f = plant(`console.log("hello-from-step"); console.error("warn-from-step"); process.exit(3);`);
  const r = harness(`$code = Invoke-Bounded '${process.execPath}' @('"${f}"') 1 'quick'; "CODE=$code"`);
  assert.match(r.out, /CODE=3$/m, r.err);
  assert.match(r.log, /hello-from-step/);
  assert.match(r.log, /warn-from-step/);
  assert.doesNotMatch(r.log, /ERROR/);
});

/** Runs a fixture copy of graphify-session-context.ps1; `lock` is null (no lock) or {ageMin, pid}; `last` plants .sync-last.json. */
function sessionContext(lock, last = null) {
  const root = mkdtempSync(join(tmpdir(), "graphify-ctx-"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "graphify-out"));
  copyFileSync(join(ROOT, "scripts", "graphify-session-context.ps1"), join(root, "scripts", "graphify-session-context.ps1"));
  writeFileSync(join(root, "graphify-out", "GRAPH_REPORT.md"), "# Graph Report\n\n## Summary\n- 5 nodes\n");
  if (last) writeFileSync(join(root, "graphify-out", ".sync-last.json"), JSON.stringify(last));
  if (lock) {
    const file = join(root, "graphify-out", ".sync-running");
    writeFileSync(file, `pid=${lock.pid} started=planted`);
    const t = new Date(Date.now() - lock.ageMin * 60000);
    utimesSync(file, t, t);
  }
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts", "graphify-session-context.ps1")], { encoding: "utf8", cwd: root, timeout: 60000 });
  assert.match(r.stdout, /=== CODE GRAPH/, "the fixture must reach the graph block (the scan located its subject)");
  return r.stdout;
}

test("session start: HUNG for a live sync held 5 h, STALE LOCK for a dead one, quiet at 89 min and with no lock", { skip: win }, () => {
  const holder = spawn("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep 120"], { stdio: "ignore" });
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  try {
    const hung = sessionContext({ ageMin: 300, pid: holder.pid });
    assert.match(hung, new RegExp(`graph sync: HUNG - lock held 30\\d min \\(pid=${holder.pid} started=planted\\)`));
    assert.doesNotMatch(hung, /rebuild queued/, "a 300 min lock is a hang, never a rebuild underway (round-3 mutant M9)");
    const stale = sessionContext({ ageMin: 300, pid: dead });
    assert.match(stale, /graph sync: STALE LOCK - the sync died 30\d min ago/);
    assert.doesNotMatch(stale, /HUNG/);
    assert.doesNotMatch(sessionContext({ ageMin: 89, pid: holder.pid }), /graph sync:/);
    assert.doesNotMatch(sessionContext(null), /graph sync:/);
  } finally {
    holder.kill();
  }
});

// Rebuild on merge (job 2026-11-03-graphify-always-on): while a sync holds a FRESH lock the graph line says so, so a
// session reading "N commits ahead" knows the rebuild is already underway instead of launching another.
test("session start: a fresh lock (5 min) with a LIVE pid adds `rebuild queued`; 89 min too; a fresh lock with a DEAD pid reads STALE LOCK, never queued; no lock says nothing", { skip: win }, () => {
  const holder = spawn("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep 120"], { stdio: "ignore" });
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  try {
    assert.match(sessionContext({ ageMin: 5, pid: holder.pid }), /graph freshness: [^\n]* - rebuild queued \(sync lock held 5 min, pid \d+\)/);
    assert.match(sessionContext({ ageMin: 89, pid: holder.pid }), /rebuild queued \(sync lock held 89 min/);
    const deadOut = sessionContext({ ageMin: 5, pid: dead });
    assert.doesNotMatch(deadOut, /rebuild queued/, "a reboot-killed sync is not a rebuild underway");
    assert.match(deadOut, /graph sync: STALE LOCK - the sync died 5 min ago/);
    assert.doesNotMatch(sessionContext(null), /rebuild queued|STALE LOCK|HUNG/);
  } finally { holder.kill(); }
});

test("session start: a failed last rebuild (.sync-last.json exit 1) is on the freshness line; exit 0 says nothing", { skip: win }, () => {
  assert.match(sessionContext(null, { exit: 1, at: "2026-11-03T15:00:00Z", error: "graphify update exited 124" }), /graph freshness: [^\n]* - last rebuild FAILED \(2026-11-03T15:00:00Z: graphify update exited 124; read graphify-out\/obsidian-sync\.log\)/);
  assert.doesNotMatch(sessionContext(null, { exit: 0, at: "x", error: "" }), /last rebuild/);
});

// Round-3 reader: the source arm proves guard TEXT precedes each step, not that the step is inside the guard. Run the real
// script with -GraphOnly against a stub `graphify` on PATH and read what it did.
test("a REAL -GraphOnly run (stub graphify on PATH): update runs, no label, no render, no vault write, no backup rotation, no ingest; .sync-last.json exit 0", { skip: win }, () => {
  const root = mkdtempSync(join(tmpdir(), "graphify-graphonly-"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "graphify-out"));
  mkdirSync(join(root, "graphify-out", "obsidian-backup-2020-01-01"));
  for (let i = 2; i <= 9; i++) mkdirSync(join(root, "graphify-out", `obsidian-backup-2020-01-0${i}`));
  copyFileSync(join(ROOT, "scripts", "graphify-obsidian-sync.ps1"), join(root, "scripts", "graphify-obsidian-sync.ps1"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  // The stub records every invocation and exits 0; a `label` call would be a slipped guard.
  writeFileSync(join(bin, "graphify.cmd"), `@echo off\r\necho %* >> "${join(root, "graphify-calls.txt")}"\r\nexit /b 0\r\n`);
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts", "graphify-obsidian-sync.ps1"), "-RepoRoot", root, "-GraphOnly"], { encoding: "utf8", env: { ...process.env, PATH: `${bin};${process.env.PATH}` }, timeout: 120000 });
  const log = readFileSync(join(root, "graphify-out", "obsidian-sync.log"), "utf8");
  const calls = existsSync(join(root, "graphify-calls.txt")) ? readFileSync(join(root, "graphify-calls.txt"), "utf8") : "";
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}\n${log}`);
  assert.match(calls, /^update \./m, `graphify update must run:\n${calls}`);
  assert.doesNotMatch(calls, /label/, `graphify label ran on a graph-only run:\n${calls}`);
  assert.match(log, /graph-only run \(merge rebuild\)/);
  for (const forbidden of ["rotated out", "labeling communities", "community render", "obsidian sync exited", "ingesting vault"]) assert.doesNotMatch(log, new RegExp(forbidden), `${forbidden} on a graph-only run:\n${log}`);
  assert.equal(readdirSync(join(root, "graphify-out")).filter((d) => d.startsWith("obsidian-backup-")).length, 9, "the backup rotation must not touch the vault backups");
  const last = JSON.parse(readFileSync(join(root, "graphify-out", ".sync-last.json"), "utf8"));
  assert.equal(last.exit, 0);
  assert.equal(last.graphOnly, true);
  assert.match(log, /=== sync done \(labels: skipped \(graph-only\)\) ===/);
});

test("the sync script refuses to overlap a live sync (fresh lock + live pid) and writes .sync-last.json on every exit path; the daily launcher goes through heavy.mjs", () => {
  const code = SRC.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.match(code, /if \(\$heldMin -lt 90 -and \$heldProc\) \{[\s\S]{0,200}exit 0/, "a live fresh lock must make the sync exit before the graph is touched");
  assert.ok(code.indexOf("another sync holds the lock") < code.indexOf('Set-Content -Path $script:lockFile'), "the overlap check runs before the lock is written");
  assert.equal((code.match(/Write-LastResult /g) ?? []).length, 3, "update failure, vault failure and success each record a result");
  const launcher = readFileSync(join(ROOT, "scripts", "graphify-sync-launcher.ps1"), "utf8");
  assert.match(launcher, /heavy\.mjs/, "the daily launcher must take the heavy lease");
  assert.match(launcher, /'--max-wait', '1800s'/);
});
