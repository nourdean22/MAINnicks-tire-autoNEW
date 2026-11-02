/**
 * Canaries for merge-gate.mjs --retry-minutes (2026-11-02, job 2026-11-02-platform-forever-fixes).
 *
 * The manager's PowerShell wrapper (gate-chain.ps1) re-ran the gate every 90 s and read its OUTPUT with a case-insensitive
 * `-match 'MERGED:'`, so "nothing was merged:" counted as a merge twice (PR 3500, 2026-11-01) and a body-bar exit 8 went
 * unseen for 45 minutes. The retry now lives in the gate and decides on the EXIT CODE the gate itself returns; no text is
 * parsed. The decision table is the contract: a merge that may have happened (4, 6) is never retried.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { retryDecision, retryGate } from "./merge-gate.mjs";

const GATE = fileURLToPath(new URL("./merge-gate.mjs", import.meta.url));
const MIN = 60_000;

test("retryDecision: merged/ready, hard BLOCKED, an ambiguous merge and bad usage stop; held, not-ready, body bar and a pre-merge gh failure retry", () => {
  for (const code of [0, 2, 4, 6, 64]) assert.equal(retryDecision(code).retry, false, `exit ${code} must stop`);
  for (const code of [3, 5, 7, 8]) assert.equal(retryDecision(code).retry, true, `exit ${code} must retry`);
  assert.equal(retryDecision(99).retry, false, "an exit code this table does not know stops (fail closed)");
  assert.match(retryDecision(8).why, /body bar/i);
  assert.match(retryDecision(6).why, /may have happened/i);
});

async function drive(codes, minutes, over = {}) {
  let t = 0;
  const logs = [];
  const runs = [];
  const code = await retryGate({
    run: async () => {
      const c = codes[Math.min(runs.length, codes.length - 1)];
      runs.push(c);
      return c;
    },
    minutes,
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t,
    log: (m) => logs.push(m),
    ...over,
  });
  return { code, runs, logs, t };
}

test("retryGate re-runs every 90 s through not-ready and body-bar passes and returns the first stopping code", async () => {
  const r = await drive([7, 8, 7, 0], 30);
  assert.deepEqual(r.runs, [7, 8, 7, 0]);
  assert.equal(r.code, 0);
  assert.equal(r.t, 3 * 90_000, "three sleeps of 90 s between four passes");
  assert.equal(r.logs.filter((l) => /^RETRY/.test(l)).length, 3);
  assert.match(r.logs[1], /exit 8.*body bar/i, "the body-bar pass is named in the retry line so it is seen, not swallowed");
});

test("retryGate stops at once on a hard BLOCKED (2) and on a merge that may have happened (4, 6)", async () => {
  for (const stop of [2, 4, 6]) {
    const r = await drive([7, stop, 0], 30);
    assert.deepEqual(r.runs, [7, stop], `exit ${stop} ends the loop before the next pass`);
    assert.equal(r.code, stop);
  }
});

test("retryGate gives up at the deadline with the last code and says so; 0 minutes means a single pass", async () => {
  const r = await drive([7], 3);
  assert.equal(r.code, 7);
  assert.equal(r.runs.length, 3, "passes at 0 s, 90 s and 180 s; the deadline (180 s) stops the fourth");
  assert.match(r.logs.at(-1), /gave up after 3 min/i);
  const once = await drive([7], 0);
  assert.deepEqual(once.runs, [7]);
  assert.equal(once.logs.filter((l) => /^RETRY/.test(l)).length, 0);
});

test("the CLI refuses a non-numeric or valueless --retry-minutes (exit 64) and keeps the usage line current", () => {
  for (const argv of [["--retry-minutes", "--merge"], ["--merge", "--retry-minutes"], ["--retry-minutes", "ten"]]) {
    const r = spawnSync(process.execPath, [GATE, "1", "--sha", "a".repeat(40), ...argv], { encoding: "utf8" });
    assert.equal(r.status, 64, `${argv.join(" ")}: ${r.stderr}`);
    assert.match(r.stderr, /--retry-minutes/);
  }
  const usage = spawnSync(process.execPath, [GATE, "notanumber"], { encoding: "utf8" });
  assert.match(usage.stderr, /--retry-minutes/, "the usage line names the flag");
});

// Wiring: the real process must return what retryGate returns. With no `gh` on PATH every pass exits 5 (a gh call failed
// before the merge), which retries; with a 1-minute budget the second pass would start at 90 s, past the deadline, so the
// loop gives up at once and prints its line. A CLI that called mergeGate directly would exit 5 without that line.
test("CLI wiring: --retry-minutes drives retryGate (the gave-up line comes from the loop, not from mergeGate)", () => {
  const r = spawnSync(process.execPath, [GATE, "9999999", "--sha", "a".repeat(40), "--retry-minutes", "1"], {
    encoding: "utf8",
    env: { ...process.env, PATH: "", Path: "" },
  });
  assert.equal(r.status, 5, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /ERROR before any merge call, nothing was merged/);
  assert.match(r.stdout, /RETRY gave up after 1 min: the last pass exited 5/);
  const once = spawnSync(process.execPath, [GATE, "9999999", "--sha", "a".repeat(40)], { encoding: "utf8", env: { ...process.env, PATH: "", Path: "" } });
  assert.equal(once.status, 5);
  assert.doesNotMatch(once.stdout, /RETRY/, "without the flag there is one pass and no retry line");
});
