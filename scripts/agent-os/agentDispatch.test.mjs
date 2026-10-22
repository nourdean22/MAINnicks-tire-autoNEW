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
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

test("brief files are recognised by basename: brief-3100.md, lane-brief-v2.md, a Windows path; a URL and prose are not", () => {
  const ok = (prompt) => judge("Agent", { subagent_type: "lane-platform", model: "opus", prompt: `${prompt}\nMODEL / EFFORT: opus / high` });
  for (const p of ["Brief: C:\\Users\\x\\scratchpad\\brief-3100.md", "read lane-brief-v2.md first", "(see ./briefs/statenour-brief.v3.md)"]) {
    assert.equal(ok(p).code, 0, `${p} must pass: ${ok(p).out}`);
  }
  denied(ok("brief at https://example.com/brief.md"), "a URL is not a brief file");
  denied(ok("the brief is attached above"), "prose");
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

// -- brief-shop-data (2026-10-22, job manager-skill-best) ------------------------------------------------------------
// The upgrade scout reported "0 declines ever captured" because its brief carried none of the shop's data meanings
// (an estimate with no invoice IS the decline). A brief that reads Nick's Tire records must carry the SHOP DATA block:
// a line starting "SHOP DATA:" whose text names invoices and estimates (the meanings in .agents/core/USER.md).

const SHOP_BLOCK =
  "SHOP DATA: a ShopDriver counter invoice is a closed job (a sale), and its payment status means nothing (separate register);\n" +
  "an estimate with no matching invoice most likely means the customer walked (declined work) but stays an inference. Key follow-ups to invoices.";
const SHOP_TASK = "Count how many estimates in apps/nickstire turned into invoices last month and report the decline rate.";
const shopDenied = (r, why) => {
  assert.equal(r.code, 2, `${why}: expected a deny, got exit ${r.code}\n${r.out}`);
  assert.match(r.out, /brief-shop-data/, `${why}: the deny must name the rule`);
};
const laneBrief = (body, extra = {}) =>
  judge("Agent", { subagent_type: "lane-nickstire-server", model: "sonnet", prompt: `Brief: C:/x/retention-brief.md\nMODEL / EFFORT: sonnet / high\n${body}`, ...extra });

test("shop data, positive control: a nickstire lane brief WITH the SHOP DATA block passes", () => {
  const r = laneBrief(`${SHOP_TASK}\n${SHOP_BLOCK}`);
  assert.equal(r.code, 0, r.out);
});

test("shop data arm 1: a brief that reads estimates and invoices without the SHOP DATA block is denied", () => {
  shopDenied(laneBrief(SHOP_TASK), "no SHOP DATA line");
  shopDenied(laneBrief("Count the estimates that never became invoices."), "a nickstire lane needs no place word: the lane type is the place");
  assert.equal(
    judge("Agent", { subagent_type: "lane-statenour", model: "sonnet", prompt: "Brief: C:/x/s-brief.md\nMODEL / EFFORT: sonnet / high\nCount the estimates that never became invoices." }).code,
    0,
    "control: the same words in a statenour lane with no shop place word are not shop data",
  );
});

test("shop data arm 2: a hollow SHOP DATA line (no meanings) is denied; the label mentioned inside prose does not count", () => {
  shopDenied(laneBrief(`${SHOP_TASK}\nSHOP DATA: n/a`), "hollow line");
  shopDenied(laneBrief(`${SHOP_TASK} Remember the SHOP DATA rules about invoice and estimate.`), "mention, not a line");
  shopDenied(laneBrief(`${SHOP_TASK} See the SHOP DATA: line in USER.md for invoice and estimate meanings.`), "a mid-line label is a pointer, not the pasted block");
});

test("shop data arm 3: the brief FILE is read: meanings missing there are denied, present there pass", () => {
  const dir = mkdtempSync(join(tmpdir(), "shop-brief-"));
  const bare = join(dir, "bare-brief.md");
  const full = join(dir, "full-brief.md");
  writeFileSync(bare, `LANE: nickstire server\n${SHOP_TASK}\n`);
  writeFileSync(full, `LANE: nickstire server\n${SHOP_TASK}\n${SHOP_BLOCK}\n`);
  const viaFile = (file) => judge("Agent", { subagent_type: "lane-nickstire-server", model: "sonnet", prompt: `Your brief is ${file}\nMODEL / EFFORT: sonnet / high` });
  shopDenied(viaFile(bare), "meanings missing in the file");
  assert.equal(viaFile(full).code, 0, "the block inside the file counts");
  assert.equal(viaFile(join(dir, "missing-brief.md")).code, 0, "an unreadable brief file is not judged for shop data (fail open on the file)");
});

test("shop data arm 4: non-lane agents and started sessions are judged too", () => {
  shopDenied(judge("Agent", { subagent_type: "general-purpose", prompt: `For Nick's Tire: ${SHOP_TASK}` }), "general-purpose agent");
  shopDenied(judge("mcp__ccd_session__start_session", { initiation: "user_asked", title: "Decline scout", prompt: SHOP_TASK, background: "Nour wants to know how often customers walk." }), "start_session");
  assert.equal(
    judge("mcp__ccd_session__start_session", { initiation: "user_asked", title: "Decline scout", prompt: SHOP_TASK, background: SHOP_BLOCK }).code,
    0,
    "the block in `background` counts",
  );
  assert.equal(judge("mcp__ccd_session__start_session", { proposal_id: "task_ab12cd34" }).code, 0, "starting an existing proposal carries no brief to judge");
});

test("shop data, no false positives: work that does not read shop records is not judged", () => {
  for (const [tool, input] of [
    ["Agent", { subagent_type: "lane-statenour", model: "sonnet", prompt: "Brief: C:/x/ui-brief.md\nMODEL / EFFORT: sonnet / high\nRestyle the brain page cards." }],
    ["Agent", { subagent_type: "Explore", prompt: "find where the Stripe invoice webhook for bdnick.info lives" }],
    ["mcp__ccd_session__start_session", { initiation: "user_asked", title: "Hook fix", prompt: "Fix the board hook timeout in scripts/agent-os.", background: "x".repeat(90) }],
  ]) {
    const r = judge(tool, input);
    assert.equal(r.code, 0, `${tool} ${JSON.stringify(input).slice(0, 80)}: ${r.out}`);
  }
});

test("shop data wiring: a configured PreToolUse matcher sends start_session calls to pretool.mjs", () => {
  const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
  const tool = "mcp__ccd_session__start_session";
  const hit = settings.hooks.PreToolUse.some(
    (g) => g.matcher && new RegExp(`^(?:${g.matcher})$`).test(tool) && g.hooks.some((h) => h.command.includes("pretool.mjs")),
  );
  assert.ok(hit, `no PreToolUse matcher routes ${tool} to pretool.mjs`);
});
