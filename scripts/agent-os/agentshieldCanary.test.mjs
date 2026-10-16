/**
 * Canary for the agentshield workflow (.github/workflows/agentshield.yml) and its
 * positive control (scripts/agent-os/agentshield-canary.mjs).
 *
 * The workflow trusts the advisory scan of the real `.claude/` only after a scan of a
 * PLANTED fixture flagged a curl-pipe-sh SessionStart hook. Three things can rot
 * without anyone noticing: the fixture gets "cleaned up" so the scanner has nothing
 * to find, the assert script starts passing on an empty report, or the workflow
 * quietly adds a flag that ships configs to a model. Each arm below breaks one of
 * them and asserts the break is seen. Offline: never runs the scanner itself.
 *
 * Run:  node --test scripts/agent-os/agentshieldCanary.test.mjs   (or: pnpm agent:verify)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED_RULE, PLANTED_COMMAND, parseReport, plantedHookCaught, run, summarize } from "./agentshield-canary.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const SCRIPT = join(HERE, "agentshield-canary.mjs");
const FIXTURE = join(HERE, "fixtures", "agentshield-canary", ".claude", "settings.json");
const WORKFLOW = join(REPO, ".github", "workflows", "agentshield.yml");

// The scanner's own detection regex (affaan-m/agentshield src/rules/hooks.ts, read 2026-10-16).
const SCANNER_REGEX = /\b(curl|wget)\b.*\|\s*(sh|bash|zsh|node|python)/i;

const report = (findings) => JSON.stringify({ timestamp: "t", targetPath: "x", findings, summary: {}, score: {} });
const expected = { id: EXPECTED_RULE, severity: "critical", category: "hooks", title: "SessionStart hook pipes a download into a shell", description: PLANTED_COMMAND, file: ".claude/settings.json" };

function tmpReport(text) {
  const dir = mkdtempSync(join(tmpdir(), "agentshield-canary-"));
  const file = join(dir, "report.json");
  writeFileSync(file, text);
  return file;
}
function spawnAssert(mode, file) {
  const r = spawnSync(process.execPath, [SCRIPT, mode, file], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

test("fixture: the planted SessionStart hook matches the scanner's curl-pipe-shell regex (the fixture cannot be sanitized silently)", () => {
  const json = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const cmds = (json.hooks?.SessionStart ?? []).flatMap((g) => g.hooks ?? []).map((h) => h.command);
  assert.ok(cmds.includes(PLANTED_COMMAND), `fixture must plant exactly ${PLANTED_COMMAND}; got ${JSON.stringify(cmds)}`);
  assert.match(PLANTED_COMMAND, SCANNER_REGEX);
  assert.ok(PLANTED_COMMAND.includes(".invalid"), "the planted host must be an RFC 2606 .invalid name so nothing can ever resolve it");
});

test("assert: a report carrying the expected rule passes (exit 0, end to end)", () => {
  const { code, out } = spawnAssert("assert", tmpReport(report([expected])));
  assert.equal(code, 0, out);
  assert.match(out, /agentshield-canary PASS/);
});

test("assert: an EMPTY report fails (exit 1) and names the planted hook — the gate breaks when the scanner goes blind", () => {
  const { code, out } = spawnAssert("assert", tmpReport(report([])));
  assert.equal(code, 1, out);
  assert.match(out, /agentshield-canary FAIL/);
  assert.ok(out.includes(EXPECTED_RULE), out);
});

test("assert: a report with findings that are NOT the planted hook fails — unrelated noise does not satisfy the control", () => {
  const noise = [{ id: "permissions-wildcard", severity: "high", category: "permissions", title: "Bash(*) allowed", description: "wildcard" }];
  const { code, out } = spawnAssert("assert", tmpReport(report(noise)));
  assert.equal(code, 1, out);
});

test("assert: a non-JSON report (scanner crashed, wrote nothing) fails, never passes", () => {
  const { code, out } = spawnAssert("assert", tmpReport("agentshield: TypeError at scan"));
  assert.equal(code, 1, out);
  assert.match(out, /not JSON/);
});

test("assert: a renamed rule still passes when a critical/high hooks finding names the curl command; a medium one does not", () => {
  const renamedCritical = [{ ...expected, id: "hooks-remote-download-v2" }];
  assert.equal(plantedHookCaught(renamedCritical), true);
  const renamedMedium = [{ ...expected, id: "hooks-remote-download-v2", severity: "medium" }];
  assert.equal(plantedHookCaught(renamedMedium), false);
  const wrongCategory = [{ ...expected, id: "other", category: "mcp" }];
  assert.equal(plantedHookCaught(wrongCategory), false);
});

test("summarize: counts by severity and lists ids; always exit 0 (advisory arm)", () => {
  const s = summarize([expected, { id: "b", severity: "low" }, { id: "b", severity: "low" }, { id: "c", severity: "bogus" }]);
  assert.deepEqual(s.bySeverity, { critical: 1, high: 0, medium: 0, low: 2, info: 0 });
  assert.deepEqual(s.ids, ["b", "c", EXPECTED_RULE]);
  assert.equal(s.total, 4);
  const { code } = spawnAssert("summarize", tmpReport(report([])));
  assert.equal(code, 0);
});

test("parseReport: unknown shapes mean no findings (so assert fails), never a crash", () => {
  assert.deepEqual(parseReport("[]").findings, []);
  assert.deepEqual(parseReport('{"findings":"nope"}').findings, []);
  assert.equal(parseReport("{").parseError, true);
});

test("run: bad usage exits 64 and prints usage", () => {
  const errs = [];
  assert.equal(run(["nope"], { log: () => {}, error: (m) => errs.push(m) }), 64);
  assert.match(errs.join("\n"), /usage:/);
});

test("workflow: pinned scanner version, canary gate BEFORE the advisory scan, advisory step is the only continue-on-error, no model or network flags", () => {
  const yml = readFileSync(WORKFLOW, "utf8");
  const pins = yml.match(/ecc-agentshield@\d+\.\d+\.\d+/g) ?? [];
  assert.ok(pins.length >= 2, "both scans must pin ecc-agentshield@<exact version>");
  assert.equal(new Set(pins).size, 1, `both scans must pin the SAME version: ${pins.join(", ")}`);
  assert.doesNotMatch(yml, /ecc-agentshield@latest|ecc-agentshield scan/, "an unpinned scanner is a supply-chain hole");
  // Mention vs execution (guard-red-team): the header may NAME a forbidden flag; only
  // non-comment lines (the run: scripts) are judged, so a comment cannot trip or mask it.
  const code = yml.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
  for (const flag of ["--opus", "--injection", "--supply-chain-online", "--fix", "--provider"]) {
    assert.ok(!code.includes(flag), `${flag} must never appear in a run step: it sends configs to a model, hits the network, or edits files`);
  }
  const canaryAt = yml.indexOf("agentshield-canary.mjs assert");
  const advisoryAt = yml.indexOf("--path .claude ");
  assert.ok(canaryAt > 0 && advisoryAt > 0, "both the canary assert and the real .claude scan must be present");
  assert.ok(canaryAt < advisoryAt, "the canary assert must run BEFORE the real scan");
  assert.equal((yml.match(/continue-on-error: true/g) ?? []).length, 1, "exactly one continue-on-error: the advisory scan, never the canary");
  assert.ok(yml.indexOf("continue-on-error: true") > canaryAt, "continue-on-error must sit on the step after the canary");
  for (const uses of yml.match(/uses: [^\s]+/g) ?? []) assert.match(uses, /@[0-9a-f]{40}/, `${uses} must be SHA-pinned`);
});
