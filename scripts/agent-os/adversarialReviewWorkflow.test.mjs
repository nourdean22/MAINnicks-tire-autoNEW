/**
 * Canary for .claude/workflows/adversarial-review.js (2026-10-15).
 *
 * The workflow cannot run in CI (it spawns agents), so its control flow is run here against stub agent/parallel/pipeline
 * with the same semantics the Workflow tool documents: a stage that throws gives null, parallel never rejects, a
 * schema agent returns an object. What is proven: a finding a majority of skeptics refute is dropped and logged, one
 * they do not refute survives, a lens whose agent dies is reported as NOT COVERED instead of read as "no findings",
 * the skeptics are asked to refute in different roles, and the context carries the worktree, the diff range, what the
 * change does and the accepted limits (the shape of a working five-lens review of the guard PRs, 2026-10-15).
 *
 * Run: node --test scripts/agent-os/adversarialReviewWorkflow.test.mjs   (pnpm agent:verify discovers it)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(fileURLToPath(new URL("../../.claude/workflows/adversarial-review.js", import.meta.url)), "utf8");
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

/** Run the script with stubs. `respond(prompt, opts)` plays every agent; returns { result, logs, prompts }. */
async function run(args, respond) {
  const logs = [];
  const prompts = [];
  const agent = async (prompt, opts) => {
    prompts.push({ prompt, opts });
    return respond(prompt, opts);
  };
  const parallel = async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)));
  const pipeline = async (items, ...stages) =>
    Promise.all(
      items.map(async (item, i) => {
        try {
          let prev = item;
          for (const stage of stages) prev = await stage(prev, item, i);
          return prev;
        } catch {
          return null;
        }
      }),
    );
  // `export const meta` is module syntax; the Workflow tool reads it, the body runs as an async function.
  const body = SOURCE.replace(/^export const meta =/m, "const meta =");
  const fn = new AsyncFunction("agent", "parallel", "pipeline", "phase", "log", "args", "budget", body);
  const result = await fn(agent, parallel, pipeline, () => {}, (m) => logs.push(m), args, { total: null });
  return { result, logs, prompts };
}

const LENSES = [
  { key: "bypass", task: "find bypasses" },
  { key: "scope", task: "find scope creep" },
];
const finding = (title) => ({ title, file: "scripts/x.mjs", line: 7, claim: "c", evidence: "e", repro: "node x", severity: "P1" });
const isFinder = (opts) => opts.label.startsWith("find:");

test("meta is a pure literal with the fields the Workflow tool reads", () => {
  const m = /export const meta = (\{[\s\S]*?\n\})\n/.exec(SOURCE);
  assert.ok(m, "meta block not found");
  const meta = new Function(`return (${m[1]})`)();
  assert.equal(meta.name, "adversarial-review");
  assert.ok(meta.description && meta.phases.map((p) => p.title).join() === "Review,Verify");
});

test("control: an unrefuted finding survives; one a majority refute is dropped and logged", async () => {
  const { result, logs } = await run({ lenses: LENSES, skeptics: 3 }, (prompt, opts) => {
    if (opts.label.startsWith("find:bypass")) return { findings: [finding("real defect"), finding("false alarm")], checked: "ran the hook" };
    if (isFinder(opts)) return { findings: [], checked: "read the diff" };
    const falseAlarm = prompt.includes("false alarm");
    return { refuted: falseAlarm, reason: falseAlarm ? "handled at line 3" : "reproduced", evidence: "e", severity_if_real: falseAlarm ? "none" : "P1" };
  });
  assert.deepEqual(result.confirmed.map((f) => f.title), ["real defect"]);
  assert.deepEqual(result.dropped.map((f) => f.title), ["false alarm"]);
  assert.equal(result.confirmed[0].refuted, 0);
  assert.equal(result.confirmed[0].skeptics.length, 3);
  assert.ok(logs.some((l) => /dropped \(3\/3 refuted\): \[bypass\] false alarm/.test(l)), JSON.stringify(logs));
  assert.deepEqual(result.failedLenses, []);
});

test("each lens reports what it checked, so an empty list is not mistaken for a lens that never ran", async () => {
  const { result, logs } = await run({ lenses: LENSES }, (prompt, opts) => (isFinder(opts) ? { findings: [], checked: `looked at ${opts.label}` } : null));
  assert.deepEqual(result.checked, [{ lens: "bypass", checked: "looked at find:bypass" }, { lens: "scope", checked: "looked at find:scope" }]);
  assert.ok(logs.some((l) => /bypass: 0 candidate\(s\)\. Checked: looked at find:bypass/.test(l)), JSON.stringify(logs));
});

test("a finding survives when only a minority of skeptics refute it (1 of 3), and drops at 2 of 3", async () => {
  for (const [refuting, survives] of [[1, true], [2, false]]) {
    let n = 0;
    const { result } = await run({ lenses: [LENSES[0]], skeptics: 3 }, (prompt, opts) => {
      if (isFinder(opts)) return { findings: [finding("edge")], checked: "x" };
      return { refuted: n++ < refuting, reason: "r", evidence: "e", severity_if_real: "P2" };
    });
    assert.equal(result.confirmed.length, survives ? 1 : 0, `${refuting} refuting`);
  }
});

test("with two skeptics a split vote keeps the finding (recall over precision) and a unanimous refutation drops it", async () => {
  for (const [first, second, survives] of [[true, false, true], [true, true, false], [false, false, true]]) {
    let n = 0;
    const { result } = await run({ lenses: [LENSES[0]] }, (prompt, opts) => (isFinder(opts) ? { findings: [finding("split")], checked: "x" } : { refuted: n++ === 0 ? first : second, reason: "r", evidence: "e", severity_if_real: "P2" }));
    assert.equal(result.confirmed.length, survives ? 1 : 0, `${first}/${second}`);
  }
});

test("a lens whose agent dies is reported NOT COVERED, never read as 'no findings'", async () => {
  const { result, logs } = await run({ lenses: LENSES, skeptics: 1 }, (prompt, opts) => (opts.label === "find:scope" ? null : { findings: [], checked: "x" }));
  assert.deepEqual(result.failedLenses, ["scope"]);
  assert.ok(logs.some((l) => /NOT COVERED: .*scope/.test(l)), JSON.stringify(logs));
});

test("a finding whose skeptics all died is kept, not silently dropped", async () => {
  const { result } = await run({ lenses: [LENSES[0]], skeptics: 2 }, (prompt, opts) => (isFinder(opts) ? { findings: [finding("orphan")], checked: "x" } : null));
  assert.equal(result.confirmed.length, 1);
  assert.equal(result.confirmed[0].votes, 0);
});

test("the context names the worktree, the diff range, what the change does and the accepted limits, and tells reviewers to stay read-only", async () => {
  const { prompts } = await run(
    { worktree: "C:/work/tree", base: "origin/main", head: "feature", change: "adds a gate", accepted: ["a shell cwd is stateless"], lenses: [LENSES[0]], skeptics: 1 },
    (prompt, opts) => (isFinder(opts) ? { findings: [finding("the title")], checked: "x" } : { refuted: false, reason: "r", evidence: "e", severity_if_real: "P1" }),
  );
  const finder = prompts.find((p) => isFinder(p.opts)).prompt;
  const skeptic = prompts.find((p) => p.opts.label.startsWith("refute:")).prompt;
  for (const p of [finder, skeptic]) {
    assert.match(p, /Worktree holding the branch: C:\/work\/tree/);
    assert.match(p, /git diff origin\/main\.\.\.feature/);
    assert.match(p, /What the change does: adds a gate/);
    assert.match(p, /ACCEPTED limits[\s\S]*a shell cwd is stateless/);
    assert.match(p, /READ-ONLY JOB/);
  }
  assert.match(finder, /find bypasses/);
  assert.match(skeptic, /"title": "the title"/);
  assert.match(skeptic, /Try to REFUTE it/);
  assert.match(skeptic, /Default to refuted=true if you cannot confirm it/);
});

test("skeptics play different roles: one reproduces, one argues it is not a defect, one reads the cited files", async () => {
  const { prompts } = await run({ lenses: [LENSES[0]], skeptics: 3 }, (prompt, opts) => (isFinder(opts) ? { findings: [finding("roles")], checked: "x" } : { refuted: false, reason: "r", evidence: "e", severity_if_real: "P2" }));
  const roles = prompts.filter((p) => p.opts.label.startsWith("refute:")).map((p) => p.prompt);
  assert.equal(roles.length, 3);
  assert.match(roles[0], /Reproduce it yourself/);
  assert.match(roles[1], /Argue it is NOT a real defect/);
  assert.match(roles[2], /Read the code and docs the finding cites/);
});

test("defaults: six lenses, two skeptics each, against origin/main, with no accepted-limits block", async () => {
  const { result, prompts } = await run(undefined, (prompt, opts) => (isFinder(opts) ? { findings: [finding(opts.label)], checked: "x" } : { refuted: false, reason: "r", evidence: "e", severity_if_real: "P2" }));
  assert.deepEqual(result.lensesRun, ["bypass", "silent-instrument", "consumer", "scope", "docs-vs-code", "names-and-facts"]);
  assert.equal(prompts.filter((p) => p.opts.label.startsWith("refute:")).length, 6 * 2);
  assert.equal(result.base, "origin/main");
  assert.ok(!prompts.some((p) => /ACCEPTED limits/.test(p.prompt)));
});
