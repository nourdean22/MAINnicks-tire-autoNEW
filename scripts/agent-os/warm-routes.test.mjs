/**
 * Canary for scripts/ci/warm-routes.sh — the e2e route-warm probe.
 *
 * WHY IT LIVES HERE. verify.mjs auto-discovers every scripts/agent-os/*.test.mjs
 * and `pnpm agent:verify` runs in agent-policy.yml on every PR. That is the only
 * lane where a script-level canary is guaranteed to execute. The probe it guards
 * belongs to statenour's e2e workflow — the job that was failing — so a canary
 * that ran only inside that job would be no canary at all. Same reasoning, and
 * same shape, as wait-for-dev-server.test.mjs next door.
 *
 * WHAT IT EXISTS TO CATCH. The loop this script replaced conflated two opposite
 * conditions and printed one message for both:
 *
 *   curl rc=7 / 000   the server is GONE
 *   curl rc=28        the server did not ANSWER IN TIME — and in 4 of 4 sampled
 *                     failures (2026-08-28 runs 33203747058, 33200855271,
 *                     33192651269, 33115876891) it was alive the whole time,
 *                     with one route's Turbopack compile wedged. Its heartbeat
 *                     kept answering 200.
 *
 * So DISTINGUISHES below is the load-bearing case: a re-conflating rewrite still
 * exits nonzero on a wedge and would pass an exit-code-only assertion. It fails
 * here because it cannot produce the words that only the correct diagnosis
 * yields, and because it must NOT produce the dead-server wording.
 *
 * Every case drives the real script against a synthetic server. Nothing reads CI
 * config, and no case can pass because a file merely exists.
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
const SCRIPT = join(ROOT, "scripts", "ci", "warm-routes.sh");
const DIR = mkdtempSync(join(tmpdir(), "warm-"));

/** Forward slashes for every path handed to bash — backslashes read as escapes. */
const sh = (p) => p.split("\\").join("/");

/**
 * A stand-in for `next dev`.
 *
 * /health always answers 200 — that is the point. Every wedge mode below models
 * a server that is unambiguously ALIVE while one route refuses to return, which
 * is precisely the state the sampled CI failures were in and precisely the state
 * the old loop reported as "stopped answering".
 *
 *   healthy      every path 200.
 *   wedge-retry  /wedge never responds on the FIRST request, 200 after. Models a
 *                transient wedge the per-route retry can clear.
 *   wedge-boot   /wedge never responds while this is boot 1; 200 from boot 2 on.
 *                Only a RESTART clears it.
 *   wedge-stuck  /wedge never responds, ever. Nothing clears it; the script must
 *                give up loudly and name the real condition.
 *   dies         the process exits on /wedge without replying. The genuinely
 *                dead server — the one case the old message was right about.
 *
 * `hang` means: never call res.end(). curl reaches -m and returns rc=28. A fake
 * that replied 500 instead would exercise a different branch entirely and prove
 * nothing about the wedge.
 */
const FAKE = sh(join(DIR, "fake-server.cjs"));
writeFileSync(
  FAKE,
  `const http=require("http"),fs=require("fs");
const mode=process.env.MODE,marker=process.env.MARKER,port=Number(process.env.PORT);
const boots=(fs.existsSync(marker)?Number(fs.readFileSync(marker,"utf8")):0)+1;
fs.writeFileSync(marker,String(boots));
let hits=0;
const srv=http.createServer((q,r)=>{
  if(q.url==="/health"){r.writeHead(200);r.end("ok");return;}
  if(q.url==="/__exit"){r.writeHead(200);r.end("bye");srv.close();setTimeout(()=>process.exit(0),50);return;}
  if(q.url!=="/wedge"){r.writeHead(200);r.end("ok");return;}
  hits++;
  if(mode==="dies"){r.socket.destroy();process.exit(1);return;}
  const hang=(mode==="wedge-stuck")||(mode==="wedge-boot"&&boots<2)||(mode==="wedge-retry"&&hits<2);
  if(hang)return; // never res.end() -> curl hits -m and returns rc=28
  r.writeHead(200);r.end("ok");
});
srv.listen(port);
`,
);

/** Detached launcher, so the process tree matches a real `nohup ... &` server. */
const BOOT = sh(join(DIR, "boot.sh"));
writeFileSync(
  BOOT,
  `#!/usr/bin/env bash\nnohup node "${FAKE}" >/dev/null 2>&1 &\nexit 0\n`,
);

// Below Linux's client-port range (32768 up), which the old 33700 window sat
// inside (free-port.mjs). wait-for-dev-server.test.mjs uses 20000-22399.
let nextPort = 24000 + (process.pid % 2000);

/**
 * A port a fake can listen on. Without this the suite is not hermetic: a fake left
 * listening by an earlier run answers 200 on the first probe, so a wedge case
 * would see a healthy server and report a defect that does not exist.
 *
 * It used to mean "a port nothing answers on", which also passed a port a client
 * held; the GIVES UP case then got a first boot that never listened, the script
 * saw a dead server and did not restart, and the case failed on 1 boot of 2
 * (run 36701020197, 2026-09-30).
 */
function freePort() {
  for (let i = 0; i < 400; i++) {
    const p = nextPort++;
    if (canListen(p)) return p;
  }
  throw new Error("no free port in range");
}

function run(mode, { retries = 1, withRestart = false, maxRestarts = 1 } = {}) {
  const port = freePort();
  const marker = sh(join(DIR, `boots-${mode}-${port}`));
  const startEnv = `env MODE=${mode} MARKER=${marker} PORT=${port}`;

  // Launch the first instance the way the workflow's earlier step does, then
  // hand the already-running server to the warm script.
  spawnSync("bash", ["-c", `${startEnv} bash ${BOOT}`], { timeout: 20_000 });
  for (let i = 0; i < 100; i++) {
    const r = spawnSync("curl", ["-s", "-o", NULL_DEV, "-m", "1", `http://localhost:${port}/health`]);
    if (r.status === 0) break;
    spawnSync("bash", ["-c", "sleep 0.1"]);
  }

  const env = {
    ...process.env,
    BASE_URL: `http://localhost:${port}`,
    HEALTH_PATH: "/health",
    LOG_FILE: sh(join(DIR, `log-${port}`)),
    ROUTES: "/ok\n/wedge",
    ROUTE_TIMEOUT: "2",
    HEALTH_TIMEOUT: "2",
    RETRIES: String(retries),
    MAX_RESTARTS: String(maxRestarts),
    // Restarting means: stop the old instance, start a fresh one. The boots
    // marker makes "did it actually restart?" observable rather than asserted
    // from a log line the script prints before doing the work.
    RESTART_CMD: withRestart
      ? `curl -s -o /dev/null -m 2 http://localhost:${port}/__exit || true; sleep 1; ${startEnv} bash ${BOOT}; sleep 1`
      : "",
  };

  // Capture to a FILE, never a pipe: the fake server survives the script and
  // would inherit a pipe, blocking spawnSync until its timeout.
  const outPath = sh(join(DIR, `out-${port}`));
  const fd = openSync(outPath, "w");
  let r;
  try {
    r = spawnSync("bash", [SCRIPT], { env, stdio: ["ignore", fd, fd], timeout: 120_000 });
  } finally {
    closeSync(fd);
  }
  spawnSync("curl", ["-s", "-o", NULL_DEV, "-m", "2", `http://localhost:${port}/__exit`]);
  return {
    status: r.status,
    out: readFileSync(outPath, "utf8"),
    boots: existsSync(marker) ? Number(readFileSync(marker, "utf8")) : 0,
  };
}

test("bash + curl are available — this canary must not silently self-disable", () => {
  assert.equal(
    (spawnSync("bash", ["-c", "echo ok"], { encoding: "utf8" }).stdout ?? "").trim(),
    "ok",
    "no bash: the canary cannot run, which is a failure, not a skip",
  );
  assert.equal(spawnSync("curl", ["--version"]).status, 0, "no curl: the canary cannot run");
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

test("POSITIVE CONTROL: every route answers -> exit 0, no retry, no restart", () => {
  const r = run("healthy");
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /warm \/wedge -> 200/);
  assert.match(r.out, /server healthy/, "the post-warm liveness gate must still run");
  assert.doesNotMatch(r.out, /retry|restart/i, "a healthy run must not pay for the recovery path");
  assert.equal(r.boots, 1, "no restart on a healthy run");
});

test("DISTINGUISHES a wedged route from a dead server — the whole point", () => {
  // The load-bearing case. A rewrite that re-conflates the two conditions still
  // exits nonzero here, so exit code alone proves nothing. These three
  // assertions are what only the correct diagnosis can satisfy.
  const r = run("wedge-stuck", { retries: 0 });
  assert.notEqual(r.status, 0, "must fail rather than hand an unwarmed route to Playwright");
  assert.match(r.out, /server is ALIVE and this route's compile is wedged/);
  assert.match(r.out, /\/wedge/, "must name the route that wedged");
  assert.doesNotMatch(
    r.out,
    /stopped answering/,
    "the dead-server wording must NEVER appear while the heartbeat is answering 200 — that is the exact lie this script exists to stop telling",
  );
});

test("DEAD SERVER still gets the dead-server message — the distinction cuts both ways", () => {
  const r = run("dies", { retries: 0 });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /stopped answering while warming \/wedge/);
  assert.doesNotMatch(
    r.out,
    /server is ALIVE/,
    "a genuinely dead server must not be reported as a live one with a wedged route",
  );
});

test("RECOVERS in-place: a transient wedge is cleared by the per-route retry", () => {
  const r = run("wedge-retry", { retries: 1 });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /retry 1\/1/, "must announce the retry rather than silently re-requesting");
  assert.match(r.out, /warm \/wedge -> 200/, "the route must actually have warmed");
  assert.equal(r.boots, 1, "a retry must not cost a restart");
});

test("RECOVERS by restart: a wedge the retry cannot clear triggers exactly one", () => {
  const r = run("wedge-boot", { retries: 0, withRestart: true });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /restart 1\/1/, "must announce the restart");
  assert.equal(r.boots, 2, "the server must actually have been started a second time");
  assert.match(r.out, /warm \/wedge -> 200/);
});

test("GIVES UP loudly and bounded when no restart can clear the wedge", () => {
  const r = run("wedge-stuck", { retries: 0, withRestart: true });
  assert.notEqual(r.status, 0, "must not hand a half-warm server to Playwright");
  assert.equal(r.boots, 2, "exactly one restart at MAX_RESTARTS=1");
  assert.match(r.out, /Turbopack dev-compile wedge, not a test failure and not a dead server/);
});

/**
 * The workflow's RESTART_CMD, executed for real against a port it must free.
 *
 * WHAT IT CAUGHT, on the first draft of that very line: it was written as
 * `WFDS_LIB=1 . wait-for-dev-server.sh && kill_port`. Bash removes an
 * assignment PREFIX once the builtin returns, and unwinding restores the
 * variable to its prior state — unset — clobbering the `PORT="${PORT:-3001}"`
 * the sourced script had just done. kill_port then died on `set -u` before
 * touching the port, so the restart would have launched onto a port the wedged
 * server still held: EADDRINUSE, and every probe after that answering from the
 * ORIGINAL wedged server while the log said the restart succeeded.
 *
 * Nothing else in this suite could see it. The canary's own restart cases use a
 * synthetic RESTART_CMD, so they prove warm-routes.sh drives A restart — not
 * that THE restart the workflow passes it does anything. This reads the real
 * command out of the workflow and runs its teardown half, which is the only
 * assertion that fails when that line regresses.
 */
test("the workflow's own RESTART_CMD frees a held port — not just any restart", () => {
  const wf = readFileSync(join(ROOT, ".github", "workflows", "e2e-statenour.yml"), "utf8");
  const m = wf.match(/export RESTART_CMD='(.+)'\s*$/m);
  assert.ok(m, "RESTART_CMD not found in e2e-statenour.yml — if it was renamed, retarget this canary rather than deleting it");
  const teardown = m[1].match(/^\((.+?)\)/);
  assert.ok(teardown, "RESTART_CMD must open with a ( ... ) teardown subshell that frees the port before relaunching");

  const port = freePort();
  // 2026-09-22 · was `& sleep 2`. On the CI runner the holder twice in one day
  // (#2483 run 35750817314, #2484 run 35755601715) had not bound within the
  // fixed 2s — curl exit 7, connection refused — while the same spawn binds in
  // ~90ms on a workstation, so the canary reported a runner's scheduling as a
  // teardown regression. Poll for readiness with a bound instead: a holder that
  // never binds still fails here, loudly, with its exit code.
  const holder = spawnSync("bash", ["-c",
    `nohup node -e 'require("http").createServer((_q,r)=>r.end("x")).listen(${port})' >/dev/null 2>&1 &
     for i in $(seq 1 60); do curl -s -o /dev/null -m 1 http://localhost:${port}/ && exit 0; sleep 0.25; done; exit 7`],
    { timeout: 30_000 });
  assert.equal(holder.status, 0, `the holder must be listening within 15s, or this proves nothing (exit ${holder.status})`);
  assert.equal(
    spawnSync("curl", ["-s", "-o", NULL_DEV, "-m", "2", `http://localhost:${port}/`]).status,
    0,
    "the holder must be listening, or this proves nothing",
  );

  // Same cwd the workflow gives it (working-directory: apps/statenour), so the
  // ../../scripts relative path is exercised exactly as written.
  const cmd = teardown[1].replace(/PORT=3001/g, `PORT=${port}`);
  const r = spawnSync("bash", ["-c",
    `( ${cmd} ); sleep 1; curl -s -o /dev/null -m 2 http://localhost:${port}/ && echo HELD || echo FREE`],
    { cwd: join(ROOT, "apps", "statenour"), encoding: "utf8", timeout: 60_000 });
  assert.match(r.stdout ?? "", /FREE/, `the workflow's teardown did not free port ${port}: ${r.stdout}${r.stderr}`);
});

test("ROUTES is required — no silent empty warm", () => {
  // An empty ROUTES would make every case above pass by warming nothing.
  const fd = openSync(sh(join(DIR, "out-noroutes")), "w");
  const r = spawnSync("bash", [SCRIPT], {
    env: { ...process.env, ROUTES: "" },
    stdio: ["ignore", fd, fd],
    timeout: 30_000,
  });
  closeSync(fd);
  assert.equal(r.status, 2);
  assert.match(readFileSync(sh(join(DIR, "out-noroutes")), "utf8"), /ROUTES is required/);
});
