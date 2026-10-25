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

// The session-start fields rule `session-dispatch-brief` requires (2026-10-25); shop-data arms carry them so only
// the shop block decides the verdict.
const SESSION_FIELDS = { model: "claude-sonnet-5-5", effort: "high" };
const SESSION_BRIEF = "Your brief: C:\\Users\\x\\scratchpad\\decline-scout-brief.md\nMODEL / EFFORT: sonnet / high";

test("shop data arm 4: non-lane agents and started sessions are judged too", () => {
  shopDenied(judge("Agent", { subagent_type: "general-purpose", prompt: `For Nick's Tire: ${SHOP_TASK}` }), "general-purpose agent");
  shopDenied(judge("mcp__ccd_session__start_session", { initiation: "user_asked", title: "Decline scout", prompt: SHOP_TASK, background: "Nour wants to know how often customers walk." }), "start_session");
  assert.equal(
    judge("mcp__ccd_session__start_session", { initiation: "user_asked", title: "Decline scout", ...SESSION_FIELDS, prompt: `${SESSION_BRIEF}\n${SHOP_TASK}`, background: SHOP_BLOCK }).code,
    0,
    "the block in `background` counts when its line STARTS with SHOP DATA:",
  );
  assert.equal(judge("mcp__ccd_session__start_session", { proposal_id: "task_ab12cd34" }).code, 0, "starting an existing proposal carries no brief to judge");
});

test("shop data, no false positives: work that does not read shop records is not judged", () => {
  for (const [tool, input] of [
    ["Agent", { subagent_type: "lane-statenour", model: "sonnet", prompt: "Brief: C:/x/ui-brief.md\nMODEL / EFFORT: sonnet / high\nRestyle the brain page cards." }],
    ["Agent", { subagent_type: "Explore", prompt: "find where the Stripe invoice webhook for bdnick.info lives" }],
    ["mcp__ccd_session__start_session", { initiation: "user_asked", title: "Hook fix", ...SESSION_FIELDS, prompt: `${SESSION_BRIEF}\nFix the board hook timeout in scripts/agent-os.`, background: "x".repeat(90) }],
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

// -- Skeptic pass 2026-10-22 (evals/skeptic.md of monorepo-manager): each exact input below passed or was denied wrongly --
test("skeptic: shop-data bypasses are denied now", () => {
  const dir = mkdtempSync(join(tmpdir(), "shop-skeptic-"));
  const job = join(dir, "job7-brief.md");
  const task = join(dir, "retention-task.md");
  writeFileSync(job, `LANE: nickstire server\n${SHOP_TASK}\n`);
  writeFileSync(task, `${SHOP_TASK}\n`);
  shopDenied(
    judge("Agent", { subagent_type: "lane-nickstire-server", model: "sonnet", prompt: `Shape: .agents/core/templates/subagent-brief.md. Your brief: ${job}\nMODEL / EFFORT: sonnet / high` }),
    "a second brief file is read too, not only the first",
  );
  shopDenied(judge("Agent", { subagent_type: "general-purpose", prompt: "Count Nick\u2019s Tire invoices and the estimates with no invoice." }), "a curly apostrophe");
  shopDenied(judge("Agent", { subagent_type: "general-purpose", prompt: "Pull last month nickstire repair orders from TiDB and say how many customers came back." }), "synonyms");
  shopDenied(judge("Agent", { subagent_type: "general-purpose", prompt: `Follow the task file ${task}` }), "a task file not named brief");
  shopDenied(judge("mcp__ccd_session__start_session", { initiation: "user_asked", title: "Retention", prompt: `Follow ${task}`, background: "x".repeat(90) }), "start_session with a task file");
  shopDenied(laneBrief("SHOP DATA: none needed.\nGOAL: count nickstire estimates with no matching invoice"), "the block ends at the next field");
});

test("skeptic: briefs that read no shop records are not denied", () => {
  const dir = mkdtempSync(join(tmpdir(), "shop-skeptic-ok-"));
  const ui = join(dir, "retention-brief.md");
  writeFileSync(ui, "LANE: nickstire client\nGOAL: fix the header spacing on the tire page.\n");
  for (const [label, tool, input] of [
    ["estimate as a verb", "Agent", { subagent_type: "lane-nickstire-client", model: "sonnet", prompt: "Brief: C:/x/b-brief.md\nMODEL / EFFORT: sonnet / high\nGOAL: estimate the bundle size change for the nickstire client" }],
    ["a prompt that mentions bookings", "Agent", { subagent_type: "general-purpose", prompt: "Review the nickstire voice receptionist prompt so it stops offering bookings." }],
    ["a shop word only in the brief's file name", "Agent", { subagent_type: "lane-nickstire-client", model: "sonnet", prompt: `Brief: ${ui}\nMODEL / EFFORT: sonnet / high` }],
    // The same with a reading cue in the prompt: only the file-name strip keeps "retention" out (mutant B9).
    ["a shop word only in a file name, with a cue", "Agent", { subagent_type: "lane-nickstire-client", model: "sonnet", prompt: `Brief: ${ui}\nMODEL / EFFORT: sonnet / high\nReport the spacing fix.` }],
  ]) {
    const r = judge(tool, input);
    assert.equal(r.code, 0, `${label}: ${r.out}`);
  }
});

test("producer and consumer agree: the real USER.md shop data meanings, pasted after SHOP DATA:, satisfy the rule", () => {
  const user = readFileSync(join(ROOT, ".agents", "core", "USER.md"), "utf8");
  const meanings = user.match(/^- Shop data meanings:[\s\S]*?(?=\n- |\n\n)/m)?.[0];
  assert.ok(meanings, "USER.md must keep its 'Shop data meanings' bullet (PR 3226); the rule's fix text points at it");
  assert.equal(laneBrief(`${SHOP_TASK}\nSHOP DATA: ${meanings}`).code, 0, "the canonical text must pass the rule it is pasted to satisfy");
});

test("every named brief file is read: a harmless first file does not hide a shop brief named second", () => {
  const dir = mkdtempSync(join(tmpdir(), "shop-two-"));
  const first = join(dir, "style-brief.md");
  const second = join(dir, "job8-brief.md");
  writeFileSync(first, "GOAL: restyle the cards.\n");
  writeFileSync(second, `${SHOP_TASK}\n`);
  shopDenied(judge("Agent", { subagent_type: "lane-nickstire-server", model: "sonnet", prompt: `Example: ${first}\nYour brief: ${second}\nMODEL / EFFORT: sonnet / high` }), "the second file");
});

// -- session-dispatch-brief (2026-10-25, job session-rules-mechanical) -----------------------------------------------
// Nour, 2026-10-25: "WHY EVERY SESSION STARTING IN FABLE?". start_session inherits the parent's model and effort when
// they are omitted, and the manager omitted them on four sessions in a row. A started session is judged like a lane:
// `model` and `effort` set, a brief FILE named in prompt or background, a MODEL / EFFORT line in prompt or background.

const START = "mcp__ccd_session__start_session";
const SESSION_OK = {
  initiation: "user_asked",
  title: "Hook fix",
  ...SESSION_FIELDS,
  prompt: "Your whole brief is this file: C:\\Users\\x\\scratchpad\\hook-fix-brief.md\nMODEL / EFFORT: sonnet / high",
  background: "Platform job. The board hook times out under load; the brief file holds the design and receipts wanted.",
};
const sessionDenied = (r, why) => {
  assert.equal(r.code, 2, `${why}: expected a deny, got exit ${r.code}\n${r.out}`);
  assert.match(r.out, /session-dispatch-brief/, `${why}: the deny must name the rule`);
};
const start = (over) => judge(START, { ...SESSION_OK, ...over });

test("session start, positive control: model, effort, a brief file and a MODEL / EFFORT line pass", () => {
  const r = start({});
  assert.equal(r.code, 0, r.out);
});

test("session start arm 1: model missing (effort set), blank or a bare dash is denied", () => {
  sessionDenied(start({ model: undefined }), "no model");
  sessionDenied(start({ model: "  " }), "blank model");
  sessionDenied(start({ model: "-" }), "a dash is not a model");
});

test("session start arm 2: effort missing (model set) or blank is denied", () => {
  sessionDenied(start({ effort: undefined }), "no effort");
  sessionDenied(start({ effort: "" }), "empty effort");
});

test("session start arm 3: both set but no brief FILE (prose, a URL) is denied", () => {
  sessionDenied(start({ prompt: "Fix the board hook timeout. The brief is in the background.\nMODEL / EFFORT: sonnet / high" }), "prose brief");
  sessionDenied(start({ prompt: "Brief at https://example.com/hook-brief.md\nMODEL / EFFORT: sonnet / high" }), "a URL is not a brief file");
});

test("session start arm 4: no MODEL / EFFORT line in prompt or background is denied", () => {
  sessionDenied(start({ prompt: "Your brief: C:\\x\\hook-fix-brief.md" }), "no MODEL / EFFORT line");
});

test("session start: a brief file or the MODEL / EFFORT line named only in background counts", () => {
  assert.equal(
    start({ prompt: "Fix the board hook timeout; MODEL / EFFORT: sonnet / high", background: `Full brief: C:\\x\\hook-fix-brief.md. ${"x".repeat(80)}` }).code,
    0,
    "brief named only in background",
  );
  assert.equal(start({ prompt: "Your brief: C:\\x\\hook-fix-brief.md", background: `MODEL / EFFORT: sonnet / high. ${"x".repeat(80)}` }).code, 0, "MODEL / EFFORT only in background");
});

test("session start: a fork still needs model and effort (a fork carries no background)", () => {
  const fork = { context: "fork", background: undefined };
  sessionDenied(start({ ...fork, model: undefined, effort: undefined }), "fork, nothing set");
  sessionDenied(start({ ...fork, effort: undefined }), "fork, effort missing");
  assert.equal(start(fork).code, 0, "fork with model, effort, brief file and the line passes");
});

test("session start: a proposal_id-only start and a title-only offer carry no brief and pass; a proposal_id WITH a brief is judged", () => {
  assert.equal(judge(START, { proposal_id: "task_ab12cd34" }).code, 0, "own_initiative card started by id: the brief was judged when proposed");
  assert.equal(judge(START, { initiation: "offer", title: "Hook fix" }).code, 0, "an offer card is a title alone; the brief follows with proposal_id");
  sessionDenied(judge(START, { proposal_id: "task_ab12cd34", prompt: SESSION_OK.prompt, background: SESSION_OK.background }), "accepted offer, brief sent without model and effort");
  assert.equal(judge(START, { proposal_id: "task_ab12cd34", ...SESSION_FIELDS, prompt: SESSION_OK.prompt, background: SESSION_OK.background }).code, 0, "accepted offer with every field");
});

test("session start: own_initiative proposals are judged at proposal time", () => {
  sessionDenied(start({ initiation: "own_initiative", model: undefined }), "a proposal card without a model");
});

test("session start: the deny says exactly what to pass", () => {
  const r = start({ model: undefined, effort: undefined });
  sessionDenied(r, "nothing set");
  for (const word of ["`model`", "`effort`", "brief.md", "MODEL / EFFORT:", "SHOP DATA:"]) assert.ok(r.out.includes(word), `the Do: text must name ${word}\n${r.out}`);
});

test("shop data: a SHOP DATA label mid-paragraph in background is denied, and the deny says the line must START with it", () => {
  const r = start({ prompt: `${SESSION_OK.prompt}\n${SHOP_TASK}`, background: `Nour wants decline rates. Carry the SHOP DATA: invoice is a closed job, estimate without invoice is a walk. ${"x".repeat(40)}` });
  shopDenied(r, "mid-paragraph label");
  assert.match(r.out, /START/, `the brief-shop-data Do: text must say the line STARTS with SHOP DATA:\n${r.out}`);
});

test("the lane summary line is byte-identical to the 2026-10-16 shape; the session line carries the new fields", async () => {
  const { agentDispatchCall } = await import("./policy.mjs");
  const lane = agentDispatchCall("Agent", { subagent_type: "lane-platform", model: "opus", prompt: BRIEF }, ROOT).command;
  assert.equal(lane, "lane-dispatch type=lane-platform model=opus brief=C:\\Users\\x\\scratchpad\\workflow-upgrade-AB-brief.md model-effort-line=yes shop-data=n/a");
  const session = agentDispatchCall(START, SESSION_OK, ROOT).command;
  assert.equal(session, "session-start model=claude-sonnet-5-5 effort=high brief=C:\\Users\\x\\scratchpad\\hook-fix-brief.md model-effort-line=yes shop-data=n/a");
  assert.equal(agentDispatchCall(START, { proposal_id: "task_ab12cd34" }, ROOT), null);
});
