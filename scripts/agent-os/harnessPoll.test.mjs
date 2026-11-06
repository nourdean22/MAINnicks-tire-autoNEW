/**
 * harness-poll + harness-run canaries (job 2026-11-06-harness-control-nick-node).
 * The round trips run the REAL poller as a child process against a stub of bdnick's doors that is its
 * own process too: an in-process server would deadlock under the poller's synchronous child run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { localDecision, loadAllowlist, trimOutput } from "./harness-poll.mjs";
import { checkLocally, parseArgs, run } from "./harness-run.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const POLL = join(HERE, "harness-poll.mjs");
const KEY = "control-key-for-tests-0123456789abcdef";
const allowlist = loadAllowlist();

const STUB = `
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
const claim = JSON.parse(process.env.STUB_CLAIM);
let given = false;
createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    appendFileSync(process.env.STUB_LOG, JSON.stringify({ path: req.url, key: req.headers["x-harness-control-key"], body: JSON.parse(body || "{}") }) + "\\n");
    res.setHeader("content-type", "application/json");
    if (req.headers["x-harness-control-key"] !== process.env.STUB_KEY) { res.statusCode = 401; return res.end('{"ok":false,"error":"Unauthorized"}'); }
    if (req.url.endsWith("/claim")) { const a = given ? null : claim; given = true; return res.end(JSON.stringify({ ok: true, data: { action: a } })); }
    res.end('{"ok":true,"data":{"ok":true}}');
  });
}).listen(0, "127.0.0.1", function () { console.log(this.address().port); });
`;

async function withStub(claim, fn, { key = KEY } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "harness-poll-"));
  const stubFile = join(dir, "stub.mjs");
  const log = join(dir, "calls.jsonl");
  writeFileSync(stubFile, STUB);
  const child = spawn(process.execPath, [stubFile], { env: { ...process.env, STUB_CLAIM: JSON.stringify(claim), STUB_LOG: log, STUB_KEY: KEY }, stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise((ok) => child.stdout.once("data", (d) => ok(Number(String(d).trim()))));
  try {
    const r = spawnSync(process.execPath, [POLL], {
      env: { ...process.env, HARNESS_URL: `http://127.0.0.1:${port}`, HARNESS_CONTROL_KEY: key, HARNESS_PC: "nattynour", LOCALAPPDATA: dir },
      encoding: "utf8",
      timeout: 60_000,
    });
    const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    return await fn({ r, calls });
  } finally {
    child.kill();
  }
}

test("POSITIVE CONTROL round trip: the poller claims pc-status, runs ITS argv, and posts the result", async () => {
  await withStub({ id: "ha_1", action: "pc-status", argv: ["calc.exe"], command: "calc.exe" }, ({ r, calls }) => {
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(calls.map((c) => c.path), ["/api/devices/harness/actions/claim", "/api/devices/harness/actions/result"]);
    const result = calls[1].body;
    assert.equal(result.id, "ha_1");
    assert.equal(result.pc, "nattynour");
    assert.equal(result.exitCode, 0);
    assert.equal(result.error, null);
    assert.match(result.output, /free RAM: .*\nuptime: /);
    assert.ok(!JSON.stringify(result).includes(KEY), "the control key never leaves in a result");
    assert.equal(calls[0].key, KEY);
  });
});

test("an action this PC's allowlist does not name is refused here, never run, and the refusal is posted", async () => {
  await withStub({ id: "ha_2", action: "format-disk" }, ({ r, calls }) => {
    assert.equal(r.status, 0, r.stderr);
    const result = calls.find((c) => c.path.endsWith("/result")).body;
    assert.equal(result.exitCode, null);
    assert.equal(result.output, "");
    assert.match(result.error, /refused here: "format-disk" is not in this PC's allowlist/);
  });
});

test("nothing queued: one claim, no result post", async () => {
  await withStub(null, ({ r, calls }) => {
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(calls.map((c) => c.path), ["/api/devices/harness/actions/claim"]);
  });
});

test("a refused key stops the poll at the claim and exits 1", async () => {
  await withStub({ id: "ha_3", action: "pc-status" }, ({ r, calls }) => {
    assert.equal(r.status, 1);
    assert.match(r.stderr, /HTTP 401/);
    assert.equal(calls.length, 1);
  }, { key: "wrong-key-0123456789abcdef0123456789" });
});

test("the local decision: known name on its PC runs; prototype names, needsGo and an off-list PC are refused", () => {
  assert.equal(localDecision(allowlist, "nattynour", "pc-status").ok, true);
  assert.equal(localDecision(allowlist, "nicksmax", "pc-status").maxOutputBytes, 8192);
  for (const name of ["constructor", "__proto__", "toString", "", null]) assert.equal(localDecision(allowlist, "nattynour", name).ok, false, String(name));
  assert.equal(localDecision(allowlist, "laptop", "pc-status").ok, false);
  const gated = { ...allowlist, actions: { x: { argv: ["node", "a.mjs"], pcs: ["nattynour"], needsGo: true } } };
  assert.match(localDecision(gated, "nattynour", "x").reason, /needs Nour's go/);
});

test("output: the key, token shapes and paths come out, SHAs stay, and the cap keeps the tail", () => {
  const sha = "10f7860c70e1a2b3c4d5e6f708192a3b4c5d6e7f";
  const text = `key ${KEY} gh ghp_abcdefghijklmnopqrstuvwxyz0123 at C:\\Users\\nourd\\x.txt sha ${sha}`;
  const out = trimOutput(text, 16_384, [KEY]);
  assert.ok(!out.includes(KEY));
  assert.ok(!out.includes("ghp_"));
  assert.ok(!out.includes("nourd"));
  assert.ok(out.includes(sha));
  const long = trimOutput(`${"a".repeat(20_000)}THE END`, 1000);
  assert.ok(Buffer.byteLength(long) <= 1000);
  assert.ok(long.endsWith("THE END"));
});

test("harness-run: a typo fails before anything is sent", () => {
  assert.equal(checkLocally(allowlist, "nattynour", "pc-status"), null);
  assert.match(checkLocally(allowlist, "nattynour", "pc-statuss"), /unknown action/);
  assert.match(checkLocally(allowlist, "laptop", "pc-status"), /unknown PC/);
  assert.deepEqual(parseArgs(["--pc", "nattynour", "--action", "pc-status", "--wait"]), { pc: "nattynour", action: "pc-status", wait: 180 });
  assert.throws(() => parseArgs(["--command", "calc"]), /unknown argument/);
});

test("harness-run: queues with the key and a fresh request id, then waits for the result", async () => {
  const seen = [];
  const states = ["QUEUED", "CLAIMED", "DONE"];
  const doFetch = async (url, init) => {
    seen.push({ url, method: init.method, key: init.headers["x-harness-control-key"], body: init.body && JSON.parse(init.body) });
    const state = states[Math.min(seen.length - 1, 2)];
    return { ok: true, status: 200, json: async () => ({ ok: true, data: { action: { id: "ha_9", pc: "nattynour", action: "pc-status", state, exitCode: state === "DONE" ? 0 : null, output: state === "DONE" ? "free RAM: 1 MB" : null, expiresAt: "x" } } }) };
  };
  const text = await run(
    { pc: "nattynour", action: "pc-status", wait: 60 },
    { config: { key: KEY, url: "http://stub", pc: "nattynour" }, allowlist, doFetch, sleep: async () => {} },
  );
  assert.equal(seen[0].method, "POST");
  assert.equal(seen[0].key, KEY);
  assert.match(seen[0].body.requestKey, /^rk_[0-9a-f]{32}$/);
  assert.equal(seen[0].body.from, "nattynour");
  assert.ok(!("argv" in seen[0].body) && !("command" in seen[0].body));
  assert.match(text, /DONE/);
  assert.match(text, /free RAM: 1 MB/);
});
