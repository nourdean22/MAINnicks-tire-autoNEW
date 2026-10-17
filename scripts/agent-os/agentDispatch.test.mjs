/**
 * Canaries for the lane-dispatch rule (policy.json `lane-dispatch-brief`, job 2026-10-16-session-workflow-upgrade H).
 *
 * Nour, 2026-10-16: sibling sessions dispatched lanes from prose briefs with the model unspecified. A lane
 * dispatch (Agent tool, subagent_type lane-*) must set `model` and its prompt must name a brief FILE and carry
 * the MODEL / EFFORT line. Every probe goes through the REAL pretool.mjs binary and asserts the exit code AND
 * the rule id (a nonzero exit alone can be a crash). The wiring arm proves the configured matcher reaches Agent.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const PRETOOL = join(HERE, "pretool.mjs");

const BRIEF = "Your whole brief is this file: C:\\Users\\x\\scratchpad\\workflow-upgrade-AB-brief.md\nMODEL / EFFORT: opus / high.";

function judge(toolName, toolInput) {
  const r = spawnSync(process.execPath, [PRETOOL], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput, cwd: ROOT }),
    encoding: "utf8",
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const denied = (r, why) => {
  assert.equal(r.code, 2, `${why}: expected a deny, got exit ${r.code}\n${r.out}`);
  assert.match(r.out, /lane-dispatch-brief/, `${why}: the deny must name the rule`);
};

test("positive control: a lane dispatch with a model, a brief file and a MODEL / EFFORT line passes", () => {
  const r = judge("Agent", { subagent_type: "lane-platform", model: "opus", prompt: BRIEF, description: "PR 1" });
  assert.equal(r.code, 0, r.out);
});

test("arm 1: a lane dispatch without `model` is denied", () => {
  denied(judge("Agent", { subagent_type: "lane-platform", prompt: BRIEF }), "no model");
  denied(judge("Agent", { subagent_type: "lane-platform", model: "  ", prompt: BRIEF }), "blank model");
});

test("arm 2: a prose-only prompt (no brief file path) is denied", () => {
  denied(
    judge("Agent", { subagent_type: "lane-platform", model: "opus", prompt: "Fix the board hook. MODEL / EFFORT: opus / high." }),
    "prose brief",
  );
});

test("arm 3: a brief path without the MODEL / EFFORT line is denied", () => {
  denied(judge("Agent", { subagent_type: "lane-statenour", model: "sonnet", prompt: "Read C:/tmp/x-brief.md and do it." }), "no MODEL / EFFORT");
});

test("bypass shapes: the Task alias, a cased or padded lane name, a brief named only in prose", () => {
  denied(judge("Task", { subagent_type: "lane-worker", prompt: BRIEF }), "Task alias");
  denied(judge("Agent", { subagent_type: "Lane-Platform", prompt: BRIEF }), "cased lane name");
  denied(judge("Agent", { subagent_type: " lane-platform", prompt: BRIEF }), "padded lane name");
  denied(
    judge("Agent", { subagent_type: "lane-platform", model: "opus", prompt: "the brief is in the brief file. MODEL / EFFORT: opus / high" }),
    "the word brief is not a file path",
  );
});

test("non-lane agents are not judged by this rule", () => {
  assert.equal(judge("Agent", { subagent_type: "Explore", prompt: "find the board hook" }).code, 0);
  assert.equal(judge("Agent", { prompt: "general purpose, no type" }).code, 0);
});

test("wiring: a configured PreToolUse matcher sends Agent and Task calls to pretool.mjs", () => {
  const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
  for (const tool of ["Agent", "Task"]) {
    const hit = settings.hooks.PreToolUse.some(
      (g) => g.matcher && new RegExp(`^(?:${g.matcher})$`).test(tool) && g.hooks.some((h) => h.command.includes("pretool.mjs")),
    );
    assert.ok(hit, `no PreToolUse matcher routes ${tool} to pretool.mjs`);
  }
});
