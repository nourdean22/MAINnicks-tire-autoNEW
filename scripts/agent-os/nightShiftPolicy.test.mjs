/**
 * Night Shift capability canaries (2026-09-15).
 *
 * "Night Shift never merges" was a sentence in a prompt. These lock it as a
 * property of the machine: inside a .worktrees/night-shift-<date> cwd the
 * three night-shift-* rules deny merge/auto-merge/protection/secret/workflow
 * mutations, pushes to any other branch, and edits to every judge in
 * config/agent-os/evaluator-paths.json — and OUTSIDE that cwd the same
 * commands are untouched (a false positive here would be disabled by the
 * next frustrated session, and then it guards nothing).
 *
 * Three shapes, per guard-red-team:
 *   1. scope inversion — every night-shift denyExample passes in a normal cwd;
 *   2. drift — the pathPattern covers every evaluator-paths.json entry;
 *   3. end-to-end — the REAL pretool.mjs, stdin payload in, exit code and the
 *      "BLOCKED by repo policy: <id>" attribution out.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, loadPolicy } from "./policy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const policy = loadPolicy();
const NIGHT = "C:/Users/nourd/NOURCITY/.worktrees/night-shift-2026-09-15";
const NORMAL = "C:/Users/nourd/NOURCITY/.claude/worktrees/stack-architecture-research-02f76c";
const NIGHT_RULES = [
  "night-shift-no-merge",
  "night-shift-push-scope",
  "night-shift-no-judge-edits",
  "night-shift-no-judge-edits-shell",
];

const ruleById = (id) => {
  const r = policy.rules.find((x) => x.id === id);
  assert.ok(r, `rule ${id} missing from policy.json`);
  return r;
};

test("night-shift rules exist, are cwd-scoped, and carry the cwd their examples are judged under", () => {
  for (const id of NIGHT_RULES) {
    const r = ruleById(id);
    assert.match(r.onlyWhenCwdMatches ?? "", /night-shift-/, `${id} must be scoped to the night-shift worktree`);
    assert.ok(r.cwdExample && new RegExp(r.onlyWhenCwdMatches.replace(/\\\\/g, "/"), "i").test(r.cwdExample), `${id}: cwdExample must satisfy its own scope`);
  }
});

test("scope inversion: every night-shift denyExample is NOT denied by that rule in a normal cwd", () => {
  for (const id of NIGHT_RULES) {
    const r = ruleById(id);
    for (const sample of r.denyExamples) {
      const isPath = Boolean(r.pathPattern);
      const res = evaluate(
        { toolName: r.tools[0], command: isPath ? "" : sample, filePath: isPath ? sample : "", cwd: NORMAL },
        policy,
      );
      assert.notEqual(res.rule?.id, id, `${id} fired outside a night-shift cwd on ${JSON.stringify(sample)}`);
    }
  }
});

test("drift: the judge-edit rule covers EVERY path in evaluator-paths.json (plus the hook and lefthook configs)", () => {
  const ev = JSON.parse(readFileSync(resolve(ROOT, "config", "agent-os", "evaluator-paths.json"), "utf8"));
  const rule = ruleById("night-shift-no-judge-edits");
  const probe = (p) => evaluate({ toolName: "Edit", command: "", filePath: p, cwd: NIGHT }, policy);
  for (const entry of ev.evaluatorPaths) {
    const sample = entry.endsWith("/") ? `${entry}some-file.ts` : entry;
    const res = probe(sample);
    assert.equal(res.rule?.id, rule.id, `evaluator path not covered by ${rule.id}: ${entry}`);
  }
  for (const extra of [".claude/settings.json", "lefthook.yml"]) {
    assert.equal(probe(extra).rule?.id, rule.id, `${extra} must be a judge too`);
  }
  // positive control for the drift test itself: a product path is NOT covered
  assert.ok(!probe("apps/nickstire/client/src/pages/Home.tsx").denied, "a product file must stay editable");
});

test("drift (shell arm): a redirect INTO every evaluator path is denied; reading or running the same path is not", () => {
  // Codex #2335 P1: the Write/Edit rule never saw a shell write. The shell
  // arm is built from the same evaluator-paths.json list, so a new judge
  // added there without regenerating the arm shows up here, not in prod.
  const ev = JSON.parse(readFileSync(resolve(ROOT, "config", "agent-os", "evaluator-paths.json"), "utf8"));
  const rule = ruleById("night-shift-no-judge-edits-shell");
  const probe = (command) => evaluate({ toolName: "Bash", command, cwd: NIGHT }, policy);
  for (const entry of [...ev.evaluatorPaths, ".claude/settings.json", "lefthook.yml"]) {
    const sample = entry.endsWith("/") ? `${entry}some-file.ts` : entry;
    assert.equal(probe(`echo x > ${sample}`).rule?.id, rule.id, `shell write not covered: ${entry}`);
    assert.equal(probe(`printf x | tee ${sample}`).rule?.id, rule.id, `tee not covered: ${entry}`);
    assert.ok(!probe(`cat ${sample}`).denied, `reading a judge must stay allowed: ${entry}`);
    assert.ok(!probe(`git diff -- ${sample}`).denied, `diffing a judge must stay allowed: ${entry}`);
  }
  // The read-only skip used to swallow `cat x > judge` whole (starts with cat,
  // no chain character). A redirect is a write; it must reach the rules now.
  assert.equal(probe("cat evil.json > config/agent-os/policy.json").rule?.id, rule.id);
  // positive control: the same redirect into a product file is fine
  assert.ok(!probe("cat notes.txt > apps/nickstire/client/src/pages/Home.tsx").denied);
});

test("end-to-end through the real hook: exit 2 + attribution inside the night-shift cwd, exit 0 outside", () => {
  const hook = resolve(HERE, "pretool.mjs");
  // Strip GIT_* so a hook-spawned process can never touch the real repo state
  // (guard-red-team rule 5) — pretool.mjs runs no git, but the habit is the point.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const run = (tool_name, tool_input, cwd) =>
    spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_name, tool_input, cwd }), env, encoding: "utf8" });

  const merge = run("Bash", { command: "gh pr merge 2401 --squash" }, NIGHT);
  assert.equal(merge.status, 2, `expected exit 2, got ${merge.status}: ${merge.stderr}`);
  assert.match(merge.stderr, /BLOCKED by repo policy: night-shift-no-merge/);

  const push = run("Bash", { command: "git push -u origin chore/sneaky" }, NIGHT);
  assert.equal(push.status, 2);
  assert.match(push.stderr, /BLOCKED by repo policy: night-shift-push-scope/);

  const judge = run("Edit", { file_path: `${NIGHT}/apps/nickstire/goals/index.ts` }, NIGHT);
  assert.equal(judge.status, 2);
  assert.match(judge.stderr, /BLOCKED by repo policy: night-shift-no-judge-edits\b/);

  // The shell shapes Codex #2335 P1 showed slipping past the Write/Edit rule.
  for (const command of [
    "cat evil.json > config/agent-os/policy.json",
    "sed -i 's/night-shift-no-merge//' config/agent-os/policy.json",
    "Set-Content -Path .claude/settings.json -Value '{}'",
  ]) {
    const shell = run("Bash", { command }, NIGHT);
    assert.equal(shell.status, 2, `expected exit 2 for ${command}: ${shell.stderr}`);
    assert.match(shell.stderr, /BLOCKED by repo policy: night-shift-no-judge-edits-shell/);
  }
  const readJudge = run("Bash", { command: "cat config/agent-os/policy.json" }, NIGHT);
  assert.equal(readJudge.status, 0, `reading a judge must pass: ${readJudge.stderr}`);

  const ownBranch = run("Bash", { command: "git push -u origin night-shift/2026-09-15" }, NIGHT);
  assert.equal(ownBranch.status, 0, `own-branch push must pass: ${ownBranch.stderr}`);

  const prCreate = run("Bash", { command: 'gh pr create --head night-shift/2026-09-15 --base main --title "x" --body "y"' }, NIGHT);
  assert.equal(prCreate.status, 0, `gh pr create must pass: ${prCreate.stderr}`);

  const outside = run("Bash", { command: "gh pr merge 2401 --squash" }, NORMAL);
  assert.equal(outside.status, 0, `outside the night-shift cwd merge is not this rule's business: ${outside.stderr}`);
});
