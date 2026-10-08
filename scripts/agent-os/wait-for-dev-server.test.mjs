/**
 * Canary for scripts/ci/wait-for-dev-server.sh — the e2e readiness probe.
 *
 * WHY IT LIVES HERE. verify.mjs auto-discovers every scripts/agent-os/*.test.mjs
 * and `pnpm agent:verify` runs in agent-policy.yml on every PR. That is the only
 * lane in this repo where a script-level canary is guaranteed to execute. The
 * probe it guards belongs to statenour's e2e workflow, but a canary that runs
 * only inside the job it protects is no canary at all — the e2e job is exactly
 * the thing that was failing.
 *
 * WHAT IT CAUGHT. The first draft of the restart path was a control that
 * reported success while doing nothing: it killed $SERVER_PID, but `next dev`
 * spawns children, so the port stayed held, the restarted server aborted with
 * EADDRINUSE, and every later probe kept reading the ORIGINAL broken server's
 * 404s. The log said `restart 1/1` and `boots=2` — it looked like it worked.
 * Without the RECOVERS case below, that would have shipped as a repair that
 * repaired nothing, which is the same defect class as the flake it was fixing.
 *
 * Every case drives the real script against a synthetic server. Nothing here
 * reads CI config, and no case can pass because a file merely exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { canListen, holdAsClient } from "./free-port.mjs";

// Spawned straight from Node (no bash, so no MSYS path rewrite) curl cannot open /dev/null on
// Windows and exits 23 before it reports any status. Bash-side probes keep /dev/null on purpose.
const NULL_DEV = process.platform === "win32" ? "NUL" : "/dev/null";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts", "ci", "wait-for-dev-server.sh");
const DIR = mkdtempSync(join(tmpdir(), "wfds-"));

/**
 * Forward slashes for every path handed to bash. On Windows `join` yields
 * backslashes, and bash reads those as escapes inside START_CMD, so the fake
 * server never launched and `boots` read 0 — a canary that fails for the wrong
 * reason is as useless as one that passes for the wrong reason.
 */
const sh = (p) => p.split("\\").join("/");

/**
 * A stand-in for the dev server.
 *  healthy  — 200 immediately.
 *  latched  — 404 on the first boot, 200 on the second. Models the observed
 *             Turbopack behaviour: a route that exists resolves to not-found
 *             and the resolution is cached, so only a restart clears it.
 *  stuck    — 404 on every boot. No restart can help; the script must say so.
 *
 * It is launched through a WRAPPER that holds the server as a child and waits,
 * so the process tree matches `pnpm exec next dev` (shell -> package runner ->
 * node). That shape is the whole point: killing only the PID the script started
 * leaves the grandchild holding the port. A single-process fake cannot express
 * the defect, and an earlier version of this canary passed with `kill_port`
 * deleted — it was testing recovery in general while blind to the one failure
 * it exists to catch.
 */
const FAKE = sh(join(DIR, "fake-server.cjs"));
writeFileSync(
  FAKE,
  `const http=require("http"),fs=require("fs");
const mode=process.env.MODE,marker=process.env.MARKER,port=Number(process.env.PORT);
let healthy=mode==="healthy";
if(mode!=="healthy"){const n=fs.existsSync(marker)?Number(fs.readFileSync(marker,"utf8")):0;
fs.writeFileSync(marker,String(n+1));healthy=mode==="latched"&&n+1>=2;}
http.createServer((_q,r)=>{r.writeHead(healthy?200:404);r.end(healthy?"ok":"nf");}).listen(port);
`,
);

const BOOT = sh(join(DIR, "boot.sh"));
// The wrapper starts the server DETACHED and exits immediately, so the PID the
// script captured is dead while the port stays held by a process it never knew
// about. That is the shape of `pnpm exec next dev` (and of any `nohup ... &`
// launcher), and it is the only shape under which killing the captured PID is
// demonstrably insufficient — on Windows a plain child dies with its parent, so
// a naive fake cannot express the defect at all.
writeFileSync(BOOT, `#!/usr/bin/env bash
nohup node "$FAKE_PATH" >/dev/null 2>&1 &
exit 0
`.replace("$FAKE_PATH", FAKE));

// Below Linux's client-port range (32768 up), which the old 31700 window reached
// into (free-port.mjs). warm-routes.test.mjs starts at 24000, so they never meet.
let nextPort = 20000 + (process.pid % 2000);

/**
 * A port a fake can listen on. Without this the suite is not hermetic: a fake
 * left listening by an earlier run answered 200 on the first probe, so the
 * RECOVERS case saw a healthy server, never restarted, and failed — a test
 * reporting a real defect that did not exist.
 *
 * It used to mean "a port nothing answers on", which also passed a port a
 * client held; the GIVES UP case then got a fake that never listened, and
 * failed for it (#2843, 2026-10-01).
 */
function freePort() {
  for (let i = 0; i < 400; i++) {
    const p = nextPort++;
    if (canListen(p)) return p;
  }
  throw new Error("no free port in range");
}

function run(mode, { maxRestarts = 1 } = {}) {
  const port = freePort();
  const marker = sh(join(DIR, `boots-${mode}-${port}`));
  const env = {
    ...process.env,
    PORT: String(port),
    HEALTH_PATH: "/",
    WORK_DIR: sh(DIR),
    LOG_FILE: sh(join(DIR, `log-${port}`)),
    CLEAR_DIR: "",
    TAIL_LOG: "0",
    LISTEN_WAIT: "4",
    SERVE_WAIT: "2",
    MAX_RESTARTS: String(maxRestarts),
    START_CMD: `env MODE=${mode} MARKER=${marker} PORT=${port} bash ${BOOT}`,
    MODE: mode,
    MARKER: marker,
  };
  // Capture to a FILE, never a pipe. On success the script deliberately leaves
  // the server running (the workflow's later steps need it), and a surviving
  // child inherits spawnSync's stdout pipe — so a piped call blocks until the
  // timeout even though bash exited. That alone was 40s per case.
  const outPath = sh(join(DIR, `out-${port}`));
  const fd = openSync(outPath, "w");
  let r;
  try {
    r = spawnSync("bash", [SCRIPT], { env, stdio: ["ignore", fd, fd], timeout: 120_000 });
  } finally {
    closeSync(fd);
  }
  const out = readFileSync(outPath, "utf8");
  return {
    status: r.status,
    out,
    boots: existsSync(marker) ? Number(readFileSync(marker, "utf8")) : 0,
  };
}

test("bash is available — this canary must not silently self-disable", () => {
  const r = spawnSync("bash", ["-c", "echo ok"], { encoding: "utf8" });
  assert.equal((r.stdout ?? "").trim(), "ok", "no bash: the canary cannot run, which is a failure, not a skip");
  assert.ok(existsSync(SCRIPT), `missing ${SCRIPT}`);
});

test("freePort skips a port only a CLIENT holds, the hole behind this file's flake", async (t) => {
  // A port held as the local end of a connection answers nothing, so the old
  // curl probe called it free, and the fake started there died on EADDRINUSE
  // (free-port.mjs). Hold the very next candidate that way and require a skip.
  if (process.platform !== "linux") return t.skip("Linux-only: pins the agent-policy runner's bind rules for a client-held port");
  const held = freePort();
  nextPort = held; // rewind: `held` is the very next candidate again
  const release = await holdAsClient(held);
  try {
    assert.notEqual(freePort(), held, "a client-held port is not free: the fake would never listen there");
  } finally {
    release();
  }
});

test("POSITIVE CONTROL: a healthy server is accepted, with no restart", () => {
  const r = run("healthy");
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /serving/);
  assert.doesNotMatch(r.out, /restart/, "a healthy run must not pay for the recovery path");
});

test("RECOVERS: a latched server is restarted and then serves", () => {
  // The case that caught the dead restart. `boots` is the load-bearing
  // assertion: exit 0 alone would also pass if the script never restarted and
  // the server had healed on its own — it cannot, by construction.
  const r = run("latched");
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /restart 1\/1/, "must announce the restart");
  assert.match(r.out, /serving/);
  assert.equal(r.boots, 2, "the server must actually have been started a second time");
});

test("GIVES UP loudly, bounded, and names the REAL condition", () => {
  // One run, three assertions, because each `stuck` run costs real seconds and
  // a canary nobody will wait for gets disabled. The message matters as much as
  // the exit code: the old loop printed "server never came up" for a server
  // that had come up and answered 199 requests — the single most misleading
  // line in the whole failure, and the reason this took five runs to diagnose.
  const r = run("stuck");
  assert.notEqual(r.status, 0, "must fail rather than hand a broken server to Playwright");
  assert.equal(r.boots, 2, "exactly one restart at MAX_RESTARTS=1");
  assert.match(r.out, /LISTENING but/);
  assert.match(r.out, /waiting cannot clear it/);
  assert.doesNotMatch(r.out, /never came up/);
});

test("MAX_RESTARTS is honoured, not hard-coded", () => {
  const r = run("stuck", { maxRestarts: 2 });
  assert.notEqual(r.status, 0);
  assert.equal(r.boots, 3, "two restarts means three boots");
});

test("kill_port frees a port held by a process the script never started", () => {
  // The teardown has NO honest end-to-end mutation on this OS: Windows reaps a
  // process tree with its parent, so deleting kill_port still lets the restart
  // succeed here. On Linux — where `pnpm exec next dev` leaves node running
  // after its parent dies — it does not. Rather than ship a canary that claims
  // coverage it does not have, this calls the function DIRECTLY against a
  // listener started outside the script, which is exactly the case the captured
  // PID cannot reach. It is the one assertion that fails if kill_port is gutted.
  const port = freePort();
  const holder = spawnSync("bash", ["-c",
    `nohup node -e 'require("http").createServer((_q,r)=>r.end("x")).listen(${port})' >/dev/null 2>&1 & sleep 2`]);
  assert.equal(holder.status, 0);

  const alive = spawnSync("curl", ["-s", "-o", NULL_DEV, "-m", "2", `http://localhost:${port}/`]);
  assert.equal(alive.status, 0, "the holder must be listening, or this proves nothing");

  const r = spawnSync("bash", ["-c",
    // `export` as its own statement, NOT an assignment prefix: bash removes
    // prefix assignments once the builtin returns, so `PORT=x source f` left
    // PORT unset and kill_port died on `set -u` before touching the port.
    `export WFDS_LIB=1 PORT=${port}; source ${sh(SCRIPT)}; kill_port; sleep 1; ` +
    `curl -s -o /dev/null -m 2 http://localhost:${port}/ && echo HELD || echo FREE`],
    { encoding: "utf8", timeout: 30_000 });
  assert.match(r.stdout ?? "", /FREE/, `port ${port} was not freed: ${r.stdout}${r.stderr}`);
});

test("START_CMD is required — no silent default", () => {
  const r = spawnSync("bash", [SCRIPT], {
    env: { ...process.env, START_CMD: "" },
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(r.status, 2);
  assert.match(`${r.stdout ?? ""}${r.stderr ?? ""}`, /START_CMD is required/);
});
