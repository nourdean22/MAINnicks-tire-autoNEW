"""HTTP-level guards on nour-local-gateway.js (audit fix for #2828).

Starts the real gateway module in a Node child on an ephemeral port with
NOUR_GATEWAY_NO_LISTEN=1 and a stubbed interactive adapter, so no model,
provider, backend or Python lane is ever called.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

GATEWAY = Path(__file__).with_name("nour-local-gateway.js")

HARNESS = r"""
const http = require("http");
const mod = require(process.env.GATEWAY_PATH);
if (!mod || !mod.server || !mod.gatewayDeps) {
  console.log(JSON.stringify({ error: "gateway does not export server/gatewayDeps" }));
  process.exit(0);
}
let runnerCalls = 0;
mod.gatewayDeps.runInteractiveAdapter = async request => {
  runnerCalls++;
  const prompt = String(request && request.prompt || "");
  if (prompt.includes("ADAPTER_BUSY")) {
    // What the worker returns when the OS research slot is held, for example by
    // a "nour-auto" run the worker promoted to research after the gateway let it in.
    const err = new Error("a research run is already in progress");
    err.code = "RESEARCH_BUSY";
    throw err;
  }
  if (prompt.includes("ADAPTER_FAIL")) throw new Error("adapter exploded");
  await new Promise(r => setTimeout(r, 400));
  return { status: "completed", result: { output: "stub", laneId: "stub" } };
};
mod.gatewayDeps.runLaneProbe = async () => ({ status: "ok", lanes: {} });
const inFlight = () => (typeof mod.gatewayState === "function" ? mod.gatewayState().researchInFlight : null);
function send(port, { origin, host, noHost = false, content = "hi", abortAfterMs, contentType = "application/json", model = "nour-research", method = "POST", path = "/v1/chat/completions" }) {
  return new Promise((resolve, reject) => {
    const body = method === "POST"
      ? JSON.stringify({ model, messages: [{ role: "user", content }] })
      : null;
    const headers = {};
    if (origin !== undefined) headers.origin = origin;
    if (host !== undefined) headers.host = host;
    if (body) {
      headers["content-type"] = contentType;
      headers["content-length"] = Buffer.byteLength(body);
    }
    const req = http.request({ host: "127.0.0.1", port, method, path, headers, setHost: !noHost }, res => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", err => (abortAfterMs !== undefined ? resolve("aborted") : reject(err)));
    if (body) req.write(body);
    req.end();
    if (abortAfterMs !== undefined) setTimeout(() => req.destroy(), abortAfterMs);
  });
}
(async () => {
  await new Promise(r => mod.server.listen(0, "127.0.0.1", r));
  const port = mod.server.address().port;
  const out = {};
  out.crossOrigin = await send(port, { origin: "https://evil.example" });
  out.nullOrigin = await send(port, { origin: "null" });
  out.rebindOrigin = await send(port, { origin: "http://attacker.example:11436" });
  out.lookalikeOrigin = await send(port, { origin: "http://localhost.evil.example" });
  out.crossOriginModels = await send(port, { origin: "https://evil.example", method: "GET", path: "/v1/models" });
  out.textPlain = await send(port, { contentType: "text/plain" });
  out.formUrlencoded = await send(port, { contentType: "application/x-www-form-urlencoded" });
  out.callsAfterRejects = runnerCalls;
  const first = send(port, {});
  await new Promise(r => setTimeout(r, 100));
  out.concurrentResearch = await send(port, {});
  out.concurrentOtherModel = await send(port, { model: "nour-auto" });
  out.firstResearch = await first;
  out.researchAfterRelease = await send(port, {});
  out.noOriginJson = await send(port, { model: "nour-auto" });
  out.localhostOriginJson = await send(port, { origin: "http://localhost:3000", model: "nour-auto" });
  out.loopbackIpOriginJson = await send(port, { origin: "http://127.0.0.1:8080", model: "nour-auto" });
  out.ipv6OriginJson = await send(port, { origin: "http://[::1]:3000", model: "nour-auto" });
  out.jsonWithCharset = await send(port, { contentType: "application/json; charset=utf-8", model: "nour-auto" });
  out.runnerCalls = runnerCalls;

  // Host allowlist: a DNS-rebinding page sends its own name as Host and no
  // cross-origin Origin, so only Host can tell it apart from a local caller.
  const rebind = "evil.example:11436";
  out.rebindHostModels = await send(port, { host: rebind, method: "GET", path: "/v1/models" });
  out.rebindHostLanes = await send(port, { host: rebind, method: "GET", path: "/health/lanes" });
  out.rebindHostHealth = await send(port, { host: rebind, method: "GET", path: "/health" });
  out.rebindHostChat = await send(port, { host: rebind, model: "nour-auto" });
  out.lookalikeHost = await send(port, { host: "localhost.evil.example:11436", method: "GET", path: "/v1/models" });
  out.loopbackSuffixHost = await send(port, { host: "127.0.0.1.nip.io:11436", method: "GET", path: "/v1/models" });
  out.missingHost = await send(port, { noHost: true, method: "GET", path: "/v1/models" });
  out.hostCallsAfterRejects = runnerCalls;
  out.loopbackHostModels = await send(port, { host: "127.0.0.1:11436", method: "GET", path: "/v1/models" });
  out.localhostHostModels = await send(port, { host: "localhost:11436", method: "GET", path: "/v1/models" });
  out.upperLocalhostHostModels = await send(port, { host: "LOCALHOST", method: "GET", path: "/v1/models" });
  out.ipv6HostModels = await send(port, { host: "[::1]:11436", method: "GET", path: "/v1/models" });
  out.loopbackHostLanes = await send(port, { host: "127.0.0.1:11436", method: "GET", path: "/health/lanes" });
  out.localhostHostChat = await send(port, { host: "localhost:11436", model: "nour-auto" });

  // Research cap: a worker-side RESEARCH_BUSY is a 429, and the gateway's own
  // counter is released on success, error and client abort alike.
  out.workerBusyAuto = await send(port, { model: "nour-auto", content: "ADAPTER_BUSY" });
  out.workerBusyResearch = await send(port, { model: "nour-research", content: "ADAPTER_BUSY" });
  out.inFlightAfterBusy = inFlight();
  out.adapterError = await send(port, { model: "nour-research", content: "ADAPTER_FAIL" });
  out.inFlightAfterError = inFlight();
  const aborted = send(port, { model: "nour-research", abortAfterMs: 100 });
  await new Promise(r => setTimeout(r, 50));
  out.inFlightDuringRun = inFlight();
  out.abortResult = await aborted;
  await new Promise(r => setTimeout(r, 600));
  out.inFlightAfterAbort = inFlight();
  out.researchAfterAbort = await send(port, {});
  out.inFlightAfterSuccess = inFlight();

  // Interactive adapter env: the runner secret never reaches a lane child.
  process.env.RUNNER_SHARED_SECRET = "runner-secret";
  process.env.NOUR_SAFE_VALUE = "kept";
  if (typeof mod.scrubbedInteractiveEnv === "function") {
    const env = mod.scrubbedInteractiveEnv();
    out.envHasRunnerSecret = Object.prototype.hasOwnProperty.call(env, "RUNNER_SHARED_SECRET");
    out.envSafeValue = env.NOUR_SAFE_VALUE || null;
  } else {
    out.envHasRunnerSecret = null;
    out.envSafeValue = null;
  }
  console.log(JSON.stringify(out));
  mod.server.close();
  process.exit(0);
})().catch(err => { console.log(JSON.stringify({ error: String(err && err.stack || err) })); process.exit(0); });
"""


@unittest.skipUnless(shutil.which("node"), "node is required for the gateway test")
class LocalGatewayGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        home = Path(tempfile.mkdtemp(prefix="nour-gateway-test-"))
        (home / "AI" / "config").mkdir(parents=True)
        (home / "AI" / "logs").mkdir(parents=True)
        (home / "AI" / "config" / "NOUR-RUNTIME-KERNEL.md").write_text("test kernel", encoding="utf-8")
        os_environ = __import__("os").environ
        env = {
            "PATH": os_environ.get("PATH", ""),
            "USERPROFILE": str(home),
            "HOME": str(home),
            # Windows Node needs the OS/runtime roots to initialize crypto.
            # Keep only platform plumbing; app/provider secrets stay excluded.
            **{
                key: os_environ[key]
                for key in ("SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP")
                if os_environ.get(key)
            },
            "NOUR_GATEWAY_NO_LISTEN": "1",
            "GATEWAY_PATH": str(GATEWAY),
        }
        proc = subprocess.run(
            ["node", "-e", HARNESS],
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        shutil.rmtree(home, ignore_errors=True)
        lines = [line for line in proc.stdout.splitlines() if line.startswith("{")]
        if not lines:
            raise AssertionError(f"harness produced no result: {proc.stdout!r} {proc.stderr!r}")
        cls.result = json.loads(lines[-1])
        if "error" in cls.result:
            raise AssertionError(cls.result["error"])

    def test_cross_origin_requests_are_forbidden(self) -> None:
        for key in ("crossOrigin", "nullOrigin", "rebindOrigin", "lookalikeOrigin", "crossOriginModels"):
            self.assertEqual(self.result[key], 403, key)

    def test_non_json_post_is_unsupported_media_type(self) -> None:
        self.assertEqual(self.result["textPlain"], 415)
        self.assertEqual(self.result["formUrlencoded"], 415)

    def test_rejected_requests_never_reach_the_runner(self) -> None:
        self.assertEqual(self.result["callsAfterRejects"], 0)

    def test_second_concurrent_research_run_is_busy(self) -> None:
        self.assertEqual(self.result["concurrentResearch"], 429)
        # The cap is research-only, and it releases when the run finishes.
        self.assertEqual(self.result["concurrentOtherModel"], 200)
        self.assertEqual(self.result["firstResearch"], 200)
        self.assertEqual(self.result["researchAfterRelease"], 200)

    def test_controls_local_callers_are_not_rejected(self) -> None:
        for key in (
            "noOriginJson",
            "localhostOriginJson",
            "loopbackIpOriginJson",
            "ipv6OriginJson",
            "jsonWithCharset",
        ):
            self.assertEqual(self.result[key], 200, key)
        # first research + concurrent other model + research after release + 5 controls
        self.assertEqual(self.result["runnerCalls"], 8)

    # --- follow-ups from the #2832 review ------------------------------------

    def test_rebinding_host_is_forbidden_on_every_route(self) -> None:
        for key in (
            "rebindHostModels",
            "rebindHostLanes",
            "rebindHostHealth",
            "rebindHostChat",
            "lookalikeHost",
            "loopbackSuffixHost",
        ):
            self.assertEqual(self.result[key], 403, key)
        # Node's HTTP/1.1 parser refuses a Host-less request (400) before the
        # handler runs; the handler's own check would answer 403.
        self.assertIn(self.result["missingHost"], (400, 403))
        self.assertEqual(self.result["hostCallsAfterRejects"], self.result["runnerCalls"])

    def test_controls_loopback_hosts_are_served(self) -> None:
        for key in (
            "loopbackHostModels",
            "localhostHostModels",
            "upperLocalhostHostModels",
            "ipv6HostModels",
            "loopbackHostLanes",
            "localhostHostChat",
        ):
            self.assertEqual(self.result[key], 200, key)

    def test_worker_research_busy_is_429_for_promoted_and_explicit_runs(self) -> None:
        self.assertEqual(self.result["workerBusyAuto"], 429)
        self.assertEqual(self.result["workerBusyResearch"], 429)
        self.assertEqual(self.result["inFlightAfterBusy"], 0)

    def test_research_counter_is_released_on_error_abort_and_success(self) -> None:
        self.assertEqual(self.result["adapterError"], 503)
        self.assertEqual(self.result["inFlightAfterError"], 0)
        # Positive control: the instrument reads a held slot while a run is live.
        self.assertEqual(self.result["inFlightDuringRun"], 1)
        self.assertEqual(self.result["abortResult"], "aborted")
        self.assertEqual(self.result["inFlightAfterAbort"], 0)
        self.assertEqual(self.result["researchAfterAbort"], 200)
        self.assertEqual(self.result["inFlightAfterSuccess"], 0)

    def test_runner_secret_is_scrubbed_from_interactive_adapter_env(self) -> None:
        # assertIs, not assertNotIn: a failure must not print the whole env.
        self.assertIs(self.result["envHasRunnerSecret"], False)
        self.assertEqual(self.result["envSafeValue"], "kept")


if __name__ == "__main__":
    unittest.main()
