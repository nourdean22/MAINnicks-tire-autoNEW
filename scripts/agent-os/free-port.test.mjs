/**
 * Canary for scripts/agent-os/free-port.mjs: what "a free port" has to mean for
 * the dev-server canaries, which start real fake servers on real ports.
 *
 * The old rule was "curl gets no answer". The HAZARD cases below are the two
 * ways a port refuses connections yet cannot be listened on, and each asserts
 * both halves: curl calls the port free, and canListen does not. Run against the
 * old rule, each of them would have handed the port to a fake that then died on
 * EADDRINUSE, which is how two "flakes" in the agent-policy gate happened (see
 * free-port.mjs).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { canListen, holdAsClient } from "./free-port.mjs";

// Spawned straight from Node (no bash, so no MSYS path rewrite) curl cannot open /dev/null on
// Windows and exits 23 before it reports any status. Bash-side probes keep /dev/null on purpose.
const NULL_DEV = process.platform === "win32" ? "NUL" : "/dev/null";

// The bind rules for a client-held port are the kernel's. These cases pin the
// runner the gate runs on (ubuntu-latest); elsewhere they say so and skip.
const LINUX_ONLY = "Linux-only: pins the agent-policy runner's bind rules for a client-held port";

/** What the old freePort() asked: does anything answer here? Nonzero means it called the port free. */
const curlProbe = (port) => spawnSync("curl", ["-s", "-o", NULL_DEV, "-m", "1", `http://localhost:${port}/`]).status;

// Below the client-port range and clear of both dev-server canaries' windows
// (20000+, 24000+), so a test here never races them or the kernel for a port.
let nextPort = 28000 + (process.pid % 2000);
function lowPort() {
  for (let i = 0; i < 400; i++) {
    const port = nextPort++;
    if (canListen(port)) return port;
  }
  throw new Error("no bindable port from 28000 up: canListen refuses everything");
}

/** A port the OS just handed out and nothing holds any more: an oracle independent of canListen. */
async function osPort() {
  const s = net.createServer().listen(0);
  await once(s, "listening");
  const { port } = s.address();
  s.close();
  await once(s, "close");
  return port;
}

test("POSITIVE CONTROL: a port nothing holds can be listened on", async () => {
  assert.equal(canListen(await osPort()), true, "canListen must not refuse everything, or every caller just walks its window");
});

test("a port a LISTENER holds is not free", async () => {
  const holder = net.createServer().listen(0);
  await once(holder, "listening");
  try {
    assert.equal(canListen(holder.address().port), false);
  } finally {
    holder.close();
  }
});

test("HAZARD: a port only a CLIENT holds is not free, though curl calls it free", async (t) => {
  if (process.platform !== "linux") return t.skip(LINUX_ONLY);
  const port = lowPort(); // bindable a moment ago
  const release = await holdAsClient(port);
  try {
    assert.notEqual(curlProbe(port), 0, "precondition: nothing answers there, so the old freePort() would have picked it");
    assert.equal(canListen(port), false, "a fake started here dies on EADDRINUSE");
  } finally {
    release();
  }
});

test("HAZARD, as CI met it: curl's own end after it talks to a fake and exits", async (t) => {
  if (process.platform !== "linux") return t.skip(LINUX_ONLY);
  const port = lowPort(); // bindable a moment ago; first, so a throw here leaves no server holding the loop open
  const fake = http.createServer((_q, r) => r.end("ok")).listen(0, "127.0.0.1");
  try {
    await once(fake, "listening");
    // Every probe in the dev-server canaries is a curl like this one. Its exit
    // closes the kept-alive connection from curl's side, so the TIME_WAIT lands
    // on curl's port, not the fake's.
    const curl = spawn("curl", ["-s", "-o", NULL_DEV, "-m", "5", "--local-port", String(port), `http://127.0.0.1:${fake.address().port}/`]);
    const [code] = await once(curl, "exit");
    assert.equal(code, 0, "precondition: curl must have completed a request from that port");
    assert.notEqual(curlProbe(port), 0, "precondition: nothing answers there, so the old freePort() would have picked it");
    assert.equal(canListen(port), false, "curl's TIME_WAIT holds the port for 60s; a fake started here dies on EADDRINUSE");
  } finally {
    fake.closeAllConnections();
    fake.close();
  }
});
