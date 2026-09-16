/**
 * The `node` job's memory sampler must be able to report on the failure it
 * exists to explain.
 *
 * WHY THIS EXISTS. `.github/workflows/test.yml` has carried a memory sampler
 * since 2026-07-28, added with the comment "The sampler makes the next run
 * decisive: if `min avail` stays high, memory is refuted." It was never once
 * decisive, because its verdict `echo` sat INSIDE the same `run:` block as the
 * turbo sweep. A runner death kills that step before the echo runs, so the
 * instrument printed on SUCCESS and went silent on FAILURE — backwards for a
 * failure diagnostic. On 2026-09-16 the job died three times (5 successful /
 * 8 total at 5m10s, 5m23s, 7m11s) and produced ZERO readings between them.
 * The numbers that finally settled the question exist only because a fourth
 * run happened to pass:
 *
 *   samples: 136 · min avail: 319MB · max avail: 7000MB
 *
 * 4.5% headroom on a GREEN run. Memory confirmed, not refuted. Measured peak
 * RSS locally: `next build` 4962MB, `tsc --noEmit` 2733MB — 7695MB of demand
 * against a 7000MB box whenever the two cluster, which is what `--concurrency=2`
 * permitted and what `--concurrency=1` does not.
 *
 * SO THIS FILE GUARDS FOUR THINGS, each of which was or could be the defect:
 *   1. the summary is NOT inside the sweep step (the original bug);
 *   2. it IS a separate step carrying `if: always()` (the fix);
 *   3. the sampler still runs inside the sweep (a "fix" that deleted the
 *      sampler would satisfy 1 and 2 while measuring nothing);
 *   4. the sweep still passes `--concurrency=1` (the death itself).
 *
 * HOW IT IS ITSELF PROVEN. `scanNodeJob()` is pure — text in, findings out —
 * so the same code runs against deliberately corrupted copies of the real
 * workflow. One test asserts the live file is clean; four mutate one thing
 * each and assert THAT finding appears; a last one asserts the scanner
 * actually located both steps, so "clean" can never come from a scanner that
 * matched nothing at all.
 *
 * Run:  node --test scripts/agent-os/ciMemorySampler.test.mjs   (or: pnpm agent:verify)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = join(HERE, "..", "..", ".github", "workflows", "test.yml");

const readWorkflow = () => readFileSync(WORKFLOW, "utf8");

/** The `node:` job's text, from its key to the next job at the same indent. */
export function nodeJobBlock(src) {
  const start = src.indexOf("\n  node:\n");
  if (start < 0) return null;
  const rest = src.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[A-Za-z_][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** Steps of a job block, as `{ name, body }`, split on the 6-space `- name:`. */
export function jobSteps(block) {
  const parts = block.split(/\n {6}- name: /);
  return parts.slice(1).map((p) => {
    const nl = p.indexOf("\n");
    return { name: nl < 0 ? p.trim() : p.slice(0, nl).trim(), body: nl < 0 ? "" : p.slice(nl + 1) };
  });
}

/**
 * Comments are not code. The sweep step's own comment block quotes the
 * measured verdict line (`min avail: 319MB`) so the next reader knows what the
 * numbers were; without this, the scanner would flag that documentation as the
 * defect and the only way to green would be to delete the explanation. Same
 * shape, same reason, as `stripComments` in
 * apps/statenour/tests/repo/honest-counter-consumers.test.ts.
 *
 * Deliberately conservative: only lines whose first non-space character is `#`
 * are dropped. That covers YAML comments and shell comments inside `run:`
 * blocks, and cannot touch a `#` inside a quoted string.
 */
export function stripYamlComments(src) {
  return src
    .split("\n")
    .map((line) => (/^\s*#/.test(line) ? "" : line))
    .join("\n");
}

/** The line that prints the verdict. Matched by content, not by step name. */
const SUMMARY_MARK = /min avail:/;
/** The sampler's append. Matched by the file it writes, not by the loop shape. */
const SAMPLER_MARK = /mem-samples\.txt/;
/** The sweep itself. */
const SWEEP_MARK = /turbo run check lint test build/;

/**
 * Findings as short stable slugs, so a test can assert WHICH defect fired
 * rather than merely that something did.
 */
export function scanNodeJob(rawSrc) {
  const block = nodeJobBlock(stripYamlComments(rawSrc));
  if (block === null) return ["node-job-missing"];
  const steps = jobSteps(block);
  const sweep = steps.find((s) => SWEEP_MARK.test(s.body));
  if (!sweep) return ["sweep-step-missing"];

  const out = [];

  // 1 · the original defect: the verdict inside the step that gets killed.
  if (SUMMARY_MARK.test(sweep.body)) out.push("summary-inside-sweep");

  // 2 · the fix: a separate step, and it must run on failure.
  const summary = steps.find((s) => s !== sweep && SUMMARY_MARK.test(s.body));
  if (!summary) {
    out.push("summary-step-missing");
  } else if (!/^\s*if:\s*always\(\)\s*$/m.test(summary.body)) {
    out.push("summary-step-not-always");
  }

  // 3 · the instrument must still be taking readings.
  if (!SAMPLER_MARK.test(sweep.body)) out.push("sampler-missing-from-sweep");

  // 4 · the death itself: two heavy tasks do not fit on this runner.
  const conc = sweep.body.match(/--concurrency=(\d+)/);
  if (!conc) out.push("concurrency-flag-missing");
  else if (conc[1] !== "1") out.push(`concurrency-is-${conc[1]}`);

  return out;
}

test("the live workflow reports memory on a killed run", () => {
  assert.deepEqual(
    scanNodeJob(readWorkflow()),
    [],
    "the node job's memory sampler cannot report on the failure it exists to explain",
  );
});

test("mutation · folding the summary back into the sweep step is caught", () => {
  // The exact 2026-07-28 shape: the echo inside the `run:` that gets killed.
  const broken = readWorkflow().replace(
    "          kill \"$(cat /tmp/mem-sampler.pid)\" 2>/dev/null || true",
    "          kill \"$(cat /tmp/mem-sampler.pid)\" 2>/dev/null || true\n" +
      "          echo \"  samples: $(wc -l < /tmp/mem-samples.txt) · min avail: $(sort -n /tmp/mem-samples.txt | head -1)MB\"",
  );
  assert.notEqual(broken, readWorkflow(), "the mutation must actually change the file");
  assert.ok(scanNodeJob(broken).includes("summary-inside-sweep"), scanNodeJob(broken).join(","));
});

test("mutation · dropping `if: always()` from the summary step is caught", () => {
  const broken = readWorkflow().replace("      - name: Runner memory during the sweep\n        if: always()\n", "      - name: Runner memory during the sweep\n");
  assert.notEqual(broken, readWorkflow(), "the mutation must actually change the file");
  assert.ok(scanNodeJob(broken).includes("summary-step-not-always"), scanNodeJob(broken).join(","));
});

test("mutation · raising concurrency back to 2 is caught", () => {
  // Target the COMMAND, not the first `--concurrency=1` in the file — that one
  // is in the comment recording this change, and String.replace takes the
  // first match. Mutating documentation and watching the scanner stay green
  // proves the stripper works, not that the rule does.
  const live = "build --affected --output-logs=errors-only --concurrency=1";
  const workflow = readWorkflow();
  assert.equal(workflow.split(live).length - 1, 1, "expected exactly one live turbo command");
  const broken = workflow.replace(live, live.replace("=1", "=2"));
  assert.notEqual(broken, workflow, "the mutation must actually change the file");
  assert.ok(scanNodeJob(broken).includes("concurrency-is-2"), scanNodeJob(broken).join(","));
});

test("mutation · deleting the sampler while keeping the summary step is caught", () => {
  // A summary step with `always()` and nothing feeding it would otherwise
  // satisfy every other assertion here while measuring nothing.
  const broken = readWorkflow().replace(
    "              free -m | awk '/^Mem:/ {print $7}' >> /tmp/mem-samples.txt",
    "              true",
  );
  assert.notEqual(broken, readWorkflow(), "the mutation must actually change the file");
  assert.ok(scanNodeJob(broken).includes("sampler-missing-from-sweep"), scanNodeJob(broken).join(","));
});

test("the scanner does not fire on the comment quoting the verdict", () => {
  // The sweep step's MEASURED block quotes `min avail: 319MB` on purpose. A
  // scanner that flagged its own documentation would make the next fix
  // undocumentable, which is how a control gets deleted instead of repaired.
  assert.equal(stripYamlComments("  # min avail: 319MB").trim(), "");
  assert.match(stripYamlComments('  echo "min avail: $x"'), /min avail/);
  // …and the live file is clean only because the stripper works, not because
  // the marker is absent: prove the marker really is in the comment too.
  assert.match(readWorkflow(), /#.*min avail: 319MB/);
});

test("the scanner located both steps in the real file (not scanning nothing)", () => {
  // A scanner that matched no steps reports a clean job exactly like a correct
  // one does, which is the defect shape this whole file is about.
  const block = nodeJobBlock(stripYamlComments(readWorkflow()));
  assert.ok(block, "the node job block was not found");
  const steps = jobSteps(block);
  assert.ok(steps.length > 5, `expected the node job to have several steps, saw ${steps.length}`);
  assert.equal(steps.filter((s) => SWEEP_MARK.test(s.body)).length, 1, "exactly one turbo sweep step");
  assert.equal(steps.filter((s) => SUMMARY_MARK.test(s.body)).length, 1, "exactly one memory summary step");
  // …and the block really is the node job, not the whole file.
  assert.ok(!/^ {2}e2e:/m.test(block), "nodeJobBlock leaked into a sibling job");
});
