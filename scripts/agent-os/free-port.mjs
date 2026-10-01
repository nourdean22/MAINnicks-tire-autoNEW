/**
 * Port helpers for the dev-server canaries (wait-for-dev-server.test.mjs,
 * warm-routes.test.mjs), which start real fake servers on real ports.
 *
 * WHY A BIND, NOT A CURL. Both canaries used to call a port free when curl got
 * no answer from it. A port can refuse connections and still be unbindable:
 * when curl finishes talking to a fake it closes first, so its OWN end of the
 * connection sits in TIME_WAIT for 60s on the port the kernel lent it, and a
 * listener cannot bind over that. The fake then dies on EADDRINUSE before it
 * listens, and the script under test reports a condition the test never made:
 *
 *   - #2843, 2026-10-01, wait-for-dev-server.test.mjs "GIVES UP": "port 32902
 *     never accepted a connection" on both boots, where the case needs a server
 *     that is LISTENING but wrong.
 *   - run 36701020197, 2026-09-30, warm-routes.test.mjs "GIVES UP": the first
 *     boot never listened, so the script saw a dead server rather than a wedge
 *     and did not restart: 1 boot where the case needs 2.
 *
 * Both re-ran green, which is why they read as flakes. Linux lends client ports
 * from net.ipv4.ip_local_port_range (32768-60999 by default), and the two port
 * windows (31700-33699 and 33700-35699) reached into it. The callers now start
 * below that range, and every candidate must pass an actual bind, so a holder of
 * any kind, listener or client, is skipped.
 */
import net from "node:net";
import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";

// Same call the fakes make (`listen(port)`, every interface), so "bindable"
// means bindable for them, not for some narrower address.
const BIND =
  'const s=require("net").createServer();' +
  's.once("error",()=>process.exit(1));' +
  's.listen(Number(process.argv[1]),()=>s.close(()=>process.exit(0)))';

/** True when a fake could listen on `port` right now. A child process, so the caller can stay synchronous. */
export function canListen(port) {
  return spawnSync(process.execPath, ["-e", BIND, String(port)], { timeout: 10_000 }).status === 0;
}

/**
 * Hold `port` the way the hazard does: as the LOCAL end of a curl connection,
 * with nothing listening on it. Resolves once a sink has accepted a connection
 * whose far end is exactly `port`, so the hold is observed, not assumed.
 * Returns a release function.
 */
export async function holdAsClient(port, { timeoutMs = 10_000 } = {}) {
  const accepted = [];
  const sink = net.createServer((s) => accepted.push(s)); // accepts, never answers
  sink.listen(0, "127.0.0.1");
  await once(sink, "listening");
  const curl = spawn(
    "curl",
    ["-s", "-o", "/dev/null", "-m", "30", "--local-port", String(port), `http://127.0.0.1:${sink.address().port}/`],
    { stdio: "ignore" },
  );
  let spawnError = null;
  curl.once("error", (e) => (spawnError = e));
  const release = () => {
    curl.kill("SIGKILL");
    for (const s of accepted) s.destroy();
    sink.close();
  };
  const deadline = Date.now() + timeoutMs;
  while (!accepted.some((s) => s.remotePort === port)) {
    if (spawnError || curl.exitCode !== null || Date.now() > deadline) {
      release();
      throw new Error(`curl could not hold port ${port} as a client (${spawnError?.code ?? `exit ${curl.exitCode}`})`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return release;
}
