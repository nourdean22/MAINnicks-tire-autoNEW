// Canary for the scheduled-task register scripts: a repeat duration of [TimeSpan]::MaxValue serialises as
// P99999999DT23H59M59S, which Register-ScheduledTask rejects (HRESULT 0x80041318, seen live on NATTYNOUR 2026-11-07),
// so the 10-minute watchdog never registered. REGISTER_TEST_ROOT points the test at another tree for the red run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.REGISTER_TEST_ROOT ?? join(import.meta.dirname, "..", "..");
const scripts = ["scripts/register-local-mcp-task.ps1", "scripts/register-graph-forward-task.ps1"];

for (const rel of scripts) {
  test(`${rel}: repeat duration is a bounded TimeSpan, never MaxValue`, () => {
    const ps1 = readFileSync(join(root, rel), "utf8");
    assert.doesNotMatch(ps1, /\[TimeSpan\]::MaxValue/, "MaxValue serialises out of range for Task Scheduler");
    assert.match(ps1, /-RepetitionInterval \(New-TimeSpan -Minutes 10\)/, "the 10-minute watchdog repeat");
    assert.match(ps1, /-RepetitionDuration \(New-TimeSpan -Days \d+\)/, "a bounded duration");
  });
}
