/**
 * read-pr-body.mjs: the PR-body gates must see the body as it is NOW, not as it was when the event fired.
 *
 * A re-run of a workflow job reuses the original event payload, so a citation added to the PR body after
 * the first run never reached check-source-citation (PR 3194, 2026-10-21). The script asks the API first and
 * falls back to the payload copy; these arms pin both halves and the thing that must never happen: a
 * fallback that writes an empty file over a body that exists.
 *
 * Run:  node --test scripts/agent-os/readPrBody.test.mjs   (or: pnpm agent:verify)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolvePrBody } from "./read-pr-body.mjs";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "read-pr-body.mjs");
const OLD = "stale body from the event payload";
const NEW = "edited body\nSource: https://example.org/changelog (2026-10-21)";

test("live body wins over the frozen payload (the 3194 case)", () => {
  const calls = [];
  const r = resolvePrBody({ repo: "o/r", number: "7", eventBody: OLD, runGh: (a) => { calls.push(a); return `${NEW}\n`; } });
  assert.equal(r.source, "live-api");
  assert.equal(r.body, NEW, "the trailing newline gh/jq adds must not leak into the body");
  assert.deepEqual(calls, [["api", "repos/o/r/pulls/7", "--jq", '.body // ""']]);
});

test("a null live body is an empty string, not the stale payload (the author cleared it)", () => {
  const r = resolvePrBody({ repo: "o/r", number: "7", eventBody: OLD, runGh: () => "\n" });
  assert.equal(r.source, "live-api");
  assert.equal(r.body, "");
});

test("an API failure falls back to the event body, never to an empty file, and says so", () => {
  const r = resolvePrBody({ repo: "o/r", number: "7", eventBody: OLD, runGh: () => { throw new Error("HTTP 403: Resource not accessible"); } });
  assert.equal(r.source, "event-payload");
  assert.equal(r.body, OLD);
  assert.match(r.note, /live read failed.*403/);
});

test("missing repo or number falls back to the event body without calling gh", () => {
  let called = 0;
  const runGh = () => { called++; return ""; };
  for (const o of [{ repo: "o/r" }, { number: "7" }, {}]) {
    const r = resolvePrBody({ ...o, eventBody: OLD, runGh });
    assert.equal(r.source, "event-payload");
    assert.equal(r.body, OLD);
  }
  assert.equal(called, 0);
});

test("the CLI writes the file and prints the source: gh unreachable -> event body", () => {
  const dir = mkdtempSync(join(tmpdir(), "prbody-"));
  try {
    const out = join(dir, "pr-body.txt");
    // Empty PATH dir: `gh` cannot be found, the same failure shape as a revoked token or an API outage.
    const r = spawnSync(process.execPath, [SCRIPT, "--out", out], {
      encoding: "utf8",
      env: { PATH: dir, PR_REPO: "o/r", PR_NUMBER: "7", PR_BODY: OLD },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(out, "utf8"), OLD);
    assert.match(r.stdout, /PR body source: event-payload/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CLI refuses to run without --out (exit 2), so a step cannot silently skip the write", () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env: { PATH: "" } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});
