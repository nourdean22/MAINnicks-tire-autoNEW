/**
 * Canary for orphans.mjs. The unit arm pins each verdict; the Windows arm builds the REAL leak shape (a spawnSync
 * shell timeout that leaves node running under a dead cmd.exe), then proves the CLI lists it KILLABLE and --kill ends it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "./orphans.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = "C:\\Users\\x\\AppData\\Local\\Temp";
const p = (pid, ppid, ageS, cmd, name = "node.exe") => ({ pid, ppid, ageS, cmd, name });

test("classify: only a parentless, old node running an agent-os script from temp is KILLABLE", () => {
  const procs = [
    p(1, 0, 9e5, "System", "System"),
    p(10, 1, 9e5, "explorer.exe", "explorer.exe"),
    p(20, 999, 3600, `node "${TMP}\\sharpen-root-ab/scripts/agent-os/prompt-sharpen.mjs"`), // the leak
    p(21, 999, 60, `node "${TMP}\\sharpen-root-cd/scripts/agent-os/prompt-sharpen.mjs"`), // too young: a live sibling test
    p(22, 10, 3600, `node "${TMP}\\sharpen-root-ef/scripts/agent-os/prompt-sharpen.mjs"`), // parent alive
    p(23, 999, 3600, "node C:\\Users\\x\\repo\\scripts\\agent-os\\board.mjs refresh"), // real checkout, not temp
    p(24, 999, 3600, `bash "${TMP}\\x/scripts/agent-os/a.sh"`, "bash.exe"), // not node
  ];
  const rows = classify(procs, { minAgeS: 600, tmp: TMP });
  assert.deepEqual(rows.map((r) => [r.pid, r.killable]), [[20, true], [21, false], [23, false], [24, false]]);
});

test("Windows: the real spawnSync-timeout leak is listed KILLABLE and --kill ends it", { skip: process.platform !== "win32" && "leak shape is Windows-only (/bin/sh execs node)" }, () => {
  const root = mkdtempSync(join(tmpdir(), "orphans-root-"));
  mkdirSync(join(root, "scripts", "agent-os"), { recursive: true });
  const script = join(root, "scripts", "agent-os", "wait.mjs");
  const pidFile = join(root, "pid");
  writeFileSync(script, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 60000);`);
  spawnSync(`node "${script}"`, { shell: true, timeout: 2000 });
  const pid = Number(readFileSync(pidFile, "utf8"));
  const run = (...args) => JSON.parse(spawnSync(process.execPath, [join(HERE, "orphans.mjs"), "--json", "--min-age", "0", ...args], { encoding: "utf8" }).stdout);
  try {
    const listed = run().orphans.find((r) => r.pid === pid);
    assert.ok(listed, `the leaked pid ${pid} was not found as an orphan (the scanner must locate its subject)`);
    assert.equal(listed.killable, true);
    assert.ok(run("--kill").killed.includes(pid), "--kill did not end the leaked pid");
  } finally {
    try { process.kill(pid); } catch { /* ended by --kill */ }
  }
});
