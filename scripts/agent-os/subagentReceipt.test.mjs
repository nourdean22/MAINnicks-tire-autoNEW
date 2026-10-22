/**
 * Canaries for the lane receipt check (scripts/agent-os/subagent-receipt-check.mjs, SubagentStop, 2026-10-22, job
 * manager-skill-best; asked for by the manager session from its setup benchmark: the hooks docs list SubagentStop as able
 * to block, and the 2026-10-15 replay row j found lane claims arriving "in the same confident register as facts").
 *
 * A lane's final report must carry evidence: a receipt line (a command and its exit code), a commit SHA, or a diff. A
 * report with none is sent back to the lane ONCE. Drives the REAL script with SubagentStop stdin (fields per the hooks
 * docs, read 2026-10-22: agent_type, agent_id, last_assistant_message, stop_hook_active). Blocks are asserted with the
 * hook's own `[receipt-check]` line; each block case has a pass control; one arm plants a break in a copy of the script
 * and proves the must-block report then goes through, so a gate that silently stops checking turns this file red.
 *
 * Run: node --test scripts/agent-os/subagentReceipt.test.mjs   (pnpm agent:verify discovers it)
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(HERE, "subagent-receipt-check.mjs");

let seq = 0;
function run(message, extra = {}, script = SCRIPT) {
  const { raw, ...rest } = extra;
  const state = mkdtempSync(join(tmpdir(), "receipt-state-"));
  const payload = { session_id: "sess-1", hook_event_name: "SubagentStop", stop_hook_active: false, agent_id: `agent-${seq++}`, agent_type: "lane-platform", last_assistant_message: message, ...rest };
  const r = spawnSync(process.execPath, [script], { input: raw ?? JSON.stringify(payload), env: { ...process.env, RECEIPT_CHECK_DIR: state }, encoding: "utf8" });
  return { code: r.status, err: r.stderr, out: r.stdout, state, payload };
}

const BARE = "1. Status: DONE\n2. Files changed: scripts/agent-os/x.mjs (the fix)\n3. Verification: all tests pass and the hook works.\n4. Self-audit: none found.";
const WITH_RECEIPT = BARE.replace("all tests pass and the hook works.", "`node --test scripts/agent-os/x.test.mjs` -> 12 passed, exit 0 (FACT)");

test("a lane report with no receipt, no SHA and no diff is sent back once, by the hook's own line", () => {
  const r = run(BARE);
  assert.equal(r.code, 2, r.err);
  assert.match(r.err, /\[receipt-check\]/);
  assert.match(r.err, /exit code/);
  assert.equal(r.out, "");
});

test("control: each kind of evidence passes on its own", () => {
  for (const [label, msg] of [
    ["a receipt line (command + exit code)", WITH_RECEIPT],
    ["a receipt with an exit status word", BARE.replace("all tests pass and the hook works.", "pnpm exec vitest run a.test.ts: 3 passed, exit status 0")],
    ["a commit SHA", BARE.replace("all tests pass and the hook works.", "committed a2163a869 on chore/x")],
    ["a diff", `${BARE}\n\ndiff --git a/x.mjs b/x.mjs\n@@ -1 +1 @@`],
    ["a diffstat", `${BARE}\n 2 files changed, 14 insertions(+), 3 deletions(-)`],
  ]) {
    const r = run(msg);
    assert.equal(r.code, 0, `${label}: ${r.err}`);
  }
});

test("look-alikes are not evidence: an exit code with no command, a hex-letter word, an all-digit number", () => {
  for (const msg of [
    BARE.replace("all tests pass and the hook works.", "it ran fine, exit 0"),
    BARE.replace("all tests pass and the hook works.", "the defaced cafebabe value is fixed"),
    BARE.replace("all tests pass and the hook works.", "ticket 20261022 closed"),
  ]) {
    assert.equal(run(msg).code, 2, msg.split("\n")[2]);
  }
});

test("the read-only research lane may cite file:line or a URL instead; writer lanes may not", () => {
  const cited = "1. Status: DONE\n2. Findings: the cap is 200 at scripts/agent-os/policy.mjs:178 (FACT, read); docs: https://code.claude.com/docs/en/hooks (read 2026-10-22).";
  assert.equal(run(cited, { agent_type: "lane-research" }).code, 0, "a research report with citations passes");
  assert.equal(run(cited, { agent_type: "lane-platform" }).code, 2, "a writer lane still needs a receipt, a SHA or a diff");
  assert.equal(run(BARE, { agent_type: "lane-research" }).code, 2, "a research report with no citation at all is still sent back");
});

test("only lane agents are judged: another agent type, an empty type, and a plugin agent pass", () => {
  for (const agent_type of ["general-purpose", "Explore", "", "my-plugin:lane-reviewer"]) {
    const r = run(BARE, { agent_type });
    assert.equal(r.code, 0, `${agent_type}: ${r.err}`);
  }
  assert.equal(run(BARE, { agent_type: "lane-research" }).code, 2, "the research lane is a lane too");
});

test("one-shot per agent: stop_hook_active passes, and a second stop of the same agent passes", () => {
  assert.equal(run(BARE, { stop_hook_active: true }).code, 0);
  const first = run(BARE, { agent_id: "same-agent" });
  assert.equal(first.code, 2);
  const again = spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify(first.payload), env: { ...process.env, RECEIPT_CHECK_DIR: first.state }, encoding: "utf8" });
  assert.equal(again.status, 0, "the second stop of the same agent goes through");
});

test("fails OPEN: garbage stdin, no agent id, an unwritable state dir and a missing message all exit 0", () => {
  assert.equal(run("", { raw: "{not json" }).code, 0);
  assert.equal(run(BARE, { agent_id: "" }).code, 0);
  assert.equal(run(undefined, { last_assistant_message: undefined }).code, 0, "no report text: nothing to judge");
  const blocked = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify({ agent_id: "x", agent_type: "lane-worker", last_assistant_message: BARE }),
    env: { ...process.env, RECEIPT_CHECK_DIR: SCRIPT }, // a file, not a directory: the one-shot cannot be written
    encoding: "utf8",
  });
  assert.equal(blocked.status, 0, "a block it cannot remember would loop: never block blind");
});

test("BREAKS: a copy of the gate with its evidence test planted always-true lets the bare report through", () => {
  const src = readFileSync(SCRIPT, "utf8");
  const needle = 'export function hasEvidence(text, agentType = "") {\n';
  assert.equal(src.split(needle).length, 2, "the planted break must target exactly one live line");
  const dir = mkdtempSync(join(tmpdir(), "receipt-broken-"));
  const broken = join(dir, "subagent-receipt-check.mjs");
  writeFileSync(broken, src.replace(needle, `${needle}  return true;\n`));
  assert.equal(run(BARE, {}, broken).code, 0, "the broken copy passes the bare report, so the first arm of this file would go red on it");
  assert.equal(run(BARE).code, 2, "control: the real gate still blocks it");
});

test("wiring: a SubagentStop matcher sends lane agents to the script, and not other agents", () => {
  const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
  const groups = settings.hooks.SubagentStop ?? [];
  const routes = (type) => groups.some((g) => new RegExp(g.matcher).test(type) && g.hooks.some((h) => h.command.includes("scripts/agent-os/subagent-receipt-check.mjs")));
  for (const t of ["lane-platform", "lane-nickstire-server", "lane-research"]) assert.ok(routes(t), `${t} is not routed`);
  assert.ok(!routes("general-purpose"), "a non-lane agent must not be routed");
});
