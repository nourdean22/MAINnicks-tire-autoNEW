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
mod.gatewayDeps.runInteractiveAdapter = async () => {
  runnerCalls++;
  await new Promise(r => setTimeout(r, 400));
  return { status: "completed", result: { output: "stub", laneId: "stub" } };
};
function send(port, { origin, contentType = "application/json", model = "nour-research", method = "POST", path = "/v1/chat/completions" }) {
  return new Promise((resolve, reject) => {
    const body = method === "POST"
      ? JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] })
      : null;
    const headers = {};
    if (origin !== undefined) headers.origin = origin;
    if (body) {
      headers["content-type"] = contentType;
      headers["content-length"] = Buffer.byteLength(body);
    }
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, res => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
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
        env = {
            "PATH": __import__("os").environ.get("PATH", ""),
            "USERPROFILE": str(home),
            "HOME": str(home),
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


if __name__ == "__main__":
    unittest.main()
