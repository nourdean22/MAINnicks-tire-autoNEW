/**
 * Canary for .claude/workflows/adversarial-review.js (2026-10-15).
 *
 * The workflow cannot run in CI (it spawns agents), so its control flow is run here against stub agent/parallel/pipeline
 * with the same semantics the Workflow tool documents: a stage that throws gives null, parallel never rejects, a
 * schema agent returns an object. What is proven: a finding a majority of skeptics refute is dropped and logged, one
 * they do not refute survives, a lens whose agent dies is reported as NOT COVERED instead of read as "no findings",
 * and the skeptics are really asked to refute (their prompt carries the finding and says read-only).
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
  { key: "bypass", prompt: "find bypasses" },
  { key: "scope", prompt: "find scope creep" },
];
const finding = (title) => ({ title, file: "scripts/x.mjs", line: 7, claim: "c", evidence: "e", severity: "major" });

test("meta is a pure literal with the fields the Workflow tool reads", () => {
  const m = /export const meta = (\{[\s\S]*?\n\})\n/.exec(SOURCE);
  assert.ok(m, "meta block not found");
  const meta = new Function(`return (${m[1]})`)();
  assert.equal(meta.name, "adversarial-review");
  assert.ok(meta.description && meta.phases.map((p) => p.title).join() === "Find,Refute");
});

test("control: an unrefuted finding survives; one a majority refute is dropped and logged", async () => {
  const { result, logs } = await run({ lenses: LENSES, skeptics: 3 }, (prompt, opts) => {
    if (opts.label.startsWith("find:bypass")) return { findings: [finding("real defect"), finding("false alarm")] };
    if (opts.label.startsWith("find:")) return { findings: [] };
    const falseAlarm = prompt.includes("false alarm");
    return { refuted: falseAlarm, reason: falseAlarm ? "handled at line 3" : "reproduced" };
  });
  assert.deepEqual(result.confirmed.map((f) => f.title), ["real defect"]);
  assert.deepEqual(result.dropped.map((f) => f.title), ["false alarm"]);
  assert.equal(result.confirmed[0].refuted, 0);
  assert.ok(logs.some((l) => /dropped \(3\/3 refuted\): \[bypass\] false alarm/.test(l)), JSON.stringify(logs));
  assert.deepEqual(result.failedLenses, []);
});

test("a finding survives when only a minority of skeptics refute it (1 of 3), and drops at 2 of 3", async () => {
  for (const [refuting, survives] of [[1, true], [2, false]]) {
    let n = 0;
    const { result } = await run({ lenses: [LENSES[0]], skeptics: 3 }, (prompt, opts) => {
      if (opts.label.startsWith("find:")) return { findings: [finding("edge")] };
      return { refuted: n++ < refuting, reason: "r" };
    });
    assert.equal(result.confirmed.length, survives ? 1 : 0, `${refuting} refuting`);
  }
});

test("a lens whose agent dies is reported NOT COVERED, never read as 'no findings'", async () => {
  const { result, logs } = await run({ lenses: LENSES, skeptics: 1 }, (prompt, opts) => (opts.label === "find:scope" ? null : { findings: [] }));
  assert.deepEqual(result.failedLenses, ["scope"]);
  assert.ok(logs.some((l) => /NOT COVERED: .*scope/.test(l)), JSON.stringify(logs));
});

test("a finding whose skeptics all died is kept, not silently dropped", async () => {
  const { result } = await run({ lenses: [LENSES[0]], skeptics: 2 }, (prompt, opts) => (opts.label.startsWith("find:") ? { findings: [finding("orphan")] } : null));
  assert.equal(result.confirmed.length, 1);
  assert.equal(result.confirmed[0].votes, 0);
});

test("finder and skeptic prompts carry the diff range, the finding, and the read-only and refute instructions", async () => {
  const { prompts } = await run({ base: "origin/main", head: "feature", note: "adds a gate", lenses: [LENSES[0]], skeptics: 1 }, (prompt, opts) =>
    opts.label.startsWith("find:") ? { findings: [finding("the title")] } : { refuted: false, reason: "r" },
  );
  const finder = prompts.find((p) => p.opts.label.startsWith("find:")).prompt;
  const skeptic = prompts.find((p) => p.opts.label.startsWith("refute:")).prompt;
  assert.match(finder, /git diff origin\/main\.\.\.feature/);
  assert.match(finder, /adds a gate/);
  assert.match(finder, /Read-only/);
  assert.match(skeptic, /the title \[major\] at scripts\/x\.mjs:7/);
  assert.match(skeptic, /REFUTE/);
  assert.match(skeptic, /cannot confirm it from the real files/);
});

test("defaults: six lenses, three skeptics each, against origin/main", async () => {
  const { result, prompts } = await run(undefined, (prompt, opts) => (opts.label.startsWith("find:") ? { findings: [finding(opts.label)] } : { refuted: false, reason: "r" }));
  assert.deepEqual(result.lensesRun, ["bypass", "silent-instrument", "consumer", "scope", "docs-vs-code", "names-and-facts"]);
  assert.equal(prompts.filter((p) => p.opts.label.startsWith("refute:")).length, 6 * 3);
  assert.equal(result.base, "origin/main");
});
