import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = readFileSync(join(REPO, ".railway", "railway.ts"), "utf8");

function serviceBlock(name) {
  const start = SRC.indexOf(`service("${name}"`);
  assert.notEqual(start, -1, `missing Railway service ${name}`);
  const next = SRC.indexOf('service("', start + 10);
  return SRC.slice(start, next === -1 ? undefined : next);
}

test("Wait for CI stays a dashboard-only operator setting", () => {
  for (const name of ["statenour-worker", "MAINnicks-tire-auto", "statenour-web"]) {
    assert.doesNotMatch(serviceBlock(name), /checkSuites\s*:/);
  }
});

test("worker is private-facing and colocated with StateNour web", () => {
  const worker = serviceBlock("statenour-worker");
  assert.match(worker, /replicas:\s*\{\s*"us-east4-eqdc4a":\s*1\s*\}/);
  assert.doesNotMatch(worker, /\bdomains\s*:/);
});

test("Redis stays private until the 2FA retirement cutover", () => {
  assert.match(SRC, /\bredis\("Redis"/);
  assert.match(SRC, /privateNetworkEndpoint:\s*"redis"/);
  assert.doesNotMatch(SRC, /tcpProxies\s*:/);
  assert.match(serviceBlock("statenour-web"), /\bREDIS_URL\s*:\s*preserve\(\)/);
});

test("live Nick variables are protected from IaC deletion", () => {
  const nick = serviceBlock("MAINnicks-tire-auto");
  for (const name of [
    "HIGGSFIELD_WORKSPACE_ID",
    "PHOTO_ASSESS_PROVIDER",
    "RAILWAY_DEPLOYMENT_DRAINING_SECONDS",
  ]) {
    assert.match(nick, new RegExp(`\\b${name}:\\s*preserve\\(\\)`));
  }
});
