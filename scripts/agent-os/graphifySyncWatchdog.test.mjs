/**
 * Canary for the graphify sync watchdog (scripts/graphify-obsidian-sync.ps1, the `# >>> watchdog` block).
 * 2026-11-01: `graphify update .` hung 5 h with no ceiling. This extracts the REAL Invoke-Bounded from the script,
 * runs it in Windows PowerShell 5.1 (the scheduled task's shell) against a planted hang and a quick command, and
 * checks the wiring: step 1 must go through it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = readFileSync(join(ROOT, "scripts", "graphify-obsidian-sync.ps1"), "utf8");
const code = SRC.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
const block = SRC.match(/# >>> watchdog\r?\n([\s\S]*?)# <<< watchdog/)?.[1];
const win = process.platform === "win32" ? false : "the watchdog runs in Windows PowerShell";

test("wiring: step 1 runs graphify update through Invoke-Bounded, never bare", () => {
  assert.ok(block && /function Invoke-Bounded/.test(block), "the watchdog block is missing");
  assert.match(code, /Invoke-Bounded \$graphify @\('update', '\.'\)/);
  assert.doesNotMatch(code, /& \$graphify update/, "a bare `& $graphify update` has no ceiling");
});

/** Runs the extracted block plus `body` in powershell.exe; returns {out, log}. */
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

test("a planted hang is killed at its ceiling: returns 124, logs ERROR, the child is gone", { skip: win }, () => {
  const pidFile = join(mkdtempSync(join(tmpdir(), "graphify-watchdog-pid-")), "pid");
  const f = plant(`require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 120000);`);
  const t0 = Date.now();
  const r = harness(`$code = Invoke-Bounded '${process.execPath}' @('"${f}"') 0.05 'planted-hang'; "CODE=$code"`);
  const pid = Number(readFileSync(pidFile, "utf8"));
  let alive = true;
  try { process.kill(pid, 0); } catch { alive = false; }
  if (alive) try { process.kill(pid); } catch { /* raced */ }
  assert.match(r.out, /CODE=124$/m, r.err);
  assert.match(r.log, /ERROR: planted-hang hung past 0\.05 min/);
  assert.equal(alive, false, `the hung child (pid ${pid}) survived the watchdog`);
  assert.ok(Date.now() - t0 < 45000, "the ceiling did not fire near 3 s");
});

/** Runs a fixture copy of graphify-session-context.ps1 with a sync lock written `ageMin` minutes ago. */
function sessionContext(ageMin) {
  const root = mkdtempSync(join(tmpdir(), "graphify-ctx-"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "graphify-out"));
  copyFileSync(join(ROOT, "scripts", "graphify-session-context.ps1"), join(root, "scripts", "graphify-session-context.ps1"));
  writeFileSync(join(root, "graphify-out", "GRAPH_REPORT.md"), "# Graph Report\n\n## Summary\n- 5 nodes\n");
  const lock = join(root, "graphify-out", ".sync-running");
  writeFileSync(lock, "pid=4242 started=planted");
  const t = new Date(Date.now() - ageMin * 60000);
  utimesSync(lock, t, t);
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts", "graphify-session-context.ps1")], { encoding: "utf8", cwd: root, timeout: 60000 });
  return r.stdout;
}

test("session start says HUNG for a sync lock held 5 h, and stays quiet for a 5 min one", { skip: win }, () => {
  const hung = sessionContext(300);
  assert.match(hung, /=== CODE GRAPH/, "the fixture must reach the graph block (the scan located its subject)");
  assert.match(hung, /graph sync: HUNG - lock held 30\d min \(pid=4242 started=planted\)/);
  const fresh = sessionContext(5);
  assert.match(fresh, /=== CODE GRAPH/);
  assert.doesNotMatch(fresh, /HUNG/);
});

test("control: a quick command returns its own exit code and its output reaches the log", { skip: win }, () => {
  const f = plant(`console.log("hello-from-step"); process.exit(3);`);
  const r = harness(`$code = Invoke-Bounded '${process.execPath}' @('"${f}"') 1 'quick'; "CODE=$code"`);
  assert.match(r.out, /CODE=3$/m, r.err);
  assert.match(r.log, /hello-from-step/);
  assert.doesNotMatch(r.log, /ERROR/);
});
