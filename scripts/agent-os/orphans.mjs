#!/usr/bin/env node
/**
 * orphans: list (and with --kill, end) agent-os script processes left running after their parent died.
 *
 * Why: on 2026-11-01 the machine sat at 100% CPU on all 8 cores. 34 node processes, up to 28 h old, were each spinning a
 * planted `for (;;) {}` from promptSharpen.test.mjs: on Windows a spawnSync timeout kills cmd.exe, not the node under it,
 * so every test run left one busy loop behind. Nothing reported it; sessions just got slow and speed canaries went red.
 *
 *   node scripts/agent-os/orphans.mjs                 list orphans; KILLABLE rows are the leak shape below
 *   node scripts/agent-os/orphans.mjs --kill          end the KILLABLE rows only
 *   node scripts/agent-os/orphans.mjs --json [--min-age <minutes>]
 *
 * KILLABLE = parent process gone AND a node process AND its command line runs a scripts/agent-os/ file from under the OS
 * temp dir (a test fixture copy, never the real checkout) AND older than --min-age (default 10 min, so a sibling
 * session's test that is running right now is never touched). Every other orphan is listed, never killed.
 * Canary: orphans.test.mjs.
 */
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename } from "node:path";

const norm = (s) => String(s ?? "").replaceAll("\\", "/").toLowerCase();

/** Process table as [{pid, ppid, name, ageS, cmd}]. Throws when the table cannot be read (never an empty list). */
export function readProcesses() {
  if (process.platform === "win32") {
    const ps = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine," +
      "@{n='ageS';e={[int]((Get-Date)-$_.CreationDate).TotalSeconds}} | ConvertTo-Json -Compress";
    const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", maxBuffer: 64 << 20 });
    if (r.status !== 0 || !r.stdout.trim()) throw new Error(`process table unreadable: exit ${r.status} ${r.stderr ?? ""}`.trim());
    return JSON.parse(r.stdout).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name, ageS: p.ageS, cmd: p.CommandLine ?? "" }));
  }
  const r = spawnSync("ps", ["-eo", "pid=,ppid=,etimes=,comm=,args="], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0 || !r.stdout.trim()) throw new Error(`process table unreadable: exit ${r.status}`);
  return r.stdout.trim().split("\n").map((line) => {
    const [, pid, ppid, ageS, name, cmd] = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/) ?? [];
    return { pid: Number(pid), ppid: Number(ppid), ageS: Number(ageS), name, cmd };
  }).filter((p) => p.pid);
}

/** Orphans with a verdict. shortcut: Windows-shaped (parent pid gone); Linux reparents orphans to pid 1, extend if the leak appears there. */
export function classify(procs, { minAgeS = 600, tmp = tmpdir() } = {}) {
  const alive = new Set(procs.map((p) => p.pid));
  const t = norm(tmp);
  return procs
    .filter((p) => p.ppid !== 0 && !alive.has(p.ppid))
    .map((p) => {
      const c = norm(p.cmd);
      const fixture = /^node(\.exe)?$/i.test(p.name) && c.includes(t) && c.includes("scripts/agent-os/");
      return { ...p, killable: fixture && p.ageS >= minAgeS };
    });
}

function main(argv) {
  const kill = argv.includes("--kill");
  const i = argv.indexOf("--min-age");
  const minAgeS = i >= 0 ? Number(argv[i + 1]) * 60 : 600;
  if (!Number.isFinite(minAgeS)) throw new Error("--min-age takes minutes");
  const rows = classify(readProcesses(), { minAgeS });
  const killed = [];
  if (kill) for (const r of rows.filter((x) => x.killable)) {
    try { process.kill(r.pid); killed.push(r.pid); } catch (e) { r.error = e.code ?? String(e); }
  }
  if (argv.includes("--json")) return void process.stdout.write(JSON.stringify({ orphans: rows, killed }) + "\n");
  const k = rows.filter((r) => r.killable);
  process.stdout.write(`[orphans] ${rows.length} orphan process(es), ${k.length} KILLABLE (agent-os fixture copies older than ${minAgeS / 60} min)` +
    (kill ? `, killed ${killed.length}` : k.length ? " - run with --kill to end them" : "") + "\n");
  for (const r of k) process.stdout.write(`  KILLABLE pid ${r.pid} age ${(r.ageS / 3600).toFixed(1)} h :: ${r.cmd.slice(0, 140)}\n`);
}

if (process.argv[1] && basename(process.argv[1]) === "orphans.mjs") {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`[orphans] ${e.message}\n`); process.exitCode = 1; }
}
