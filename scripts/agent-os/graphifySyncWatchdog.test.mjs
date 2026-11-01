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
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
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

/** Runs a fixture copy of graphify-session-context.ps1; `lock` is null (no lock) or {ageMin, pid}. */
function sessionContext(lock) {
  const root = mkdtempSync(join(tmpdir(), "graphify-ctx-"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "graphify-out"));
  copyFileSync(join(ROOT, "scripts", "graphify-session-context.ps1"), join(root, "scripts", "graphify-session-context.ps1"));
  writeFileSync(join(root, "graphify-out", "GRAPH_REPORT.md"), "# Graph Report\n\n## Summary\n- 5 nodes\n");
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
    assert.match(sessionContext({ ageMin: 300, pid: holder.pid }), new RegExp(`graph sync: HUNG - lock held 30\\d min \\(pid=${holder.pid} started=planted\\)`));
    const stale = sessionContext({ ageMin: 300, pid: dead });
    assert.match(stale, /graph sync: STALE LOCK - the sync died 30\d min ago/);
    assert.doesNotMatch(stale, /HUNG/);
    assert.doesNotMatch(sessionContext({ ageMin: 89, pid: holder.pid }), /graph sync:/);
    assert.doesNotMatch(sessionContext(null), /graph sync:/);
  } finally {
    holder.kill();
  }
});
