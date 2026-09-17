/**
 * cron-heartbeat · the outcome lane. A job that RUNS and FAILS is not silent.
 *
 * THE INCIDENT THIS ENCODES, with receipts.
 * `ingest-reviews` failed at 0 ms, four times a day, from 2026-08-04 to 08-19 —
 * 64 runs and 64 failures - a measured 4/day for 16 days, a 100% failure rate - each filed with status "failed". In those
 * sixteen days the operator received 31 brief pushes and exactly ONE cron alert,
 * which named five OTHER jobs, every one of them "(never)" run. ingest-reviews was
 * absent from that alert precisely BECAUSE it was running.
 *
 * The mechanism was one missing WHERE clause. The silence check read
 * MAX(createdAt) with no status filter, so a "failed" row counted as a run:
 *
 *     the more thoroughly a job broke, the healthier it scored.
 *
 * A job that runs and fails looked better than one that never ran at all.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifySilence, FAILURE_IS_STEADY_STATE } from "@/lib/inngest/functions/cron-heartbeat";

const H = 3_600_000;
const NOW = Date.parse("2026-08-19T12:00:00Z");
const DAILY = 26;

describe("classifySilence · the failing lane", () => {
  it("reproduces ingest-reviews: running, never succeeding, and INVISIBLE to the old rule", () => {
    const expected = [{ name: "ingest-reviews", maxAgeH: DAILY }];
    const lastAny = new Map([["ingest-reviews", NOW - 3 * H]]); // ran 3h ago
    const lastOk = new Map([["ingest-reviews", null]]); // never succeeded
    const firstSeen = new Map([["ingest-reviews", NOW - 30 * 24 * H]]);

    // The OLD rule — four args, no outcome data. This is what shipped for 16 days.
    const old = classifySilence(expected, lastAny, firstSeen, NOW);
    expect(old.silent, "the old rule saw a healthy job — this is the defect").toEqual([]);
    expect(old.failing, "omitting the 5th arg must leave the lane inert").toEqual([]);

    // The NEW rule, same inputs plus outcome data.
    const now = classifySilence(expected, lastAny, firstSeen, NOW, lastOk);
    expect(now.silent, "it IS running, so it must never be reported as silent").toEqual([]);
    expect(now.failing).toEqual([{ name: "ingest-reviews", lastOkAgeH: null, maxAgeH: DAILY }]);
  });

  it("stays lit for sixteen consecutive days — an alert that fires once then goes quiet is the same bug", () => {
    const expected = [{ name: "ingest-reviews", maxAgeH: DAILY }];
    const firstSeen = new Map([["ingest-reviews", Date.parse("2026-07-04T12:00:00Z")]]);
    for (let day = 0; day < 16; day++) {
      const now = Date.parse("2026-08-04T12:00:00Z") + day * 24 * H;
      const v = classifySilence(
        expected,
        new Map([["ingest-reviews", now - 3 * H]]),
        firstSeen,
        now,
        new Map([["ingest-reviews", null]]),
      );
      expect(v.failing, `day ${day + 1} must still report failing`).toHaveLength(1);
    }
  });

  it("does NOT page on one bad night — the nine jobs that legitimately resolve ok:false", () => {
    // data-source-health and friends file status "failed" by design when a probe
    // is down. One degraded night inside the 2x grace must stay quiet.
    const v = classifySilence(
      [{ name: "data-source-health", maxAgeH: DAILY }],
      new Map([["data-source-health", NOW - 2 * H]]),
      new Map([["data-source-health", NOW - 30 * 24 * H]]),
      NOW,
      new Map([["data-source-health", NOW - 30 * H]]), // succeeded 30h ago, < 52h grace
    );
    expect(v.failing).toEqual([]);
    expect(v.silent).toEqual([]);
  });

  it("pages once the grace is genuinely exhausted", () => {
    const v = classifySilence(
      [{ name: "data-source-health", maxAgeH: DAILY }],
      new Map([["data-source-health", NOW - 2 * H]]),
      new Map([["data-source-health", NOW - 30 * 24 * H]]),
      NOW,
      new Map([["data-source-health", NOW - 60 * H]]), // > 52h
    );
    expect(v.failing).toHaveLength(1);
    expect(v.failing[0].lastOkAgeH).toBeCloseTo(60, 0);
  });

  it("a job whose only runs are 'partial' counts as WORKING — pins the vocabulary", () => {
    // The query filters `not: "failed"`, never `equals: "success"`. mega-fanout
    // writes "partial" as a live third status; an equals-filter would start
    // false-paging the day any expected job reports it. If someone "simplifies"
    // that WHERE clause, this test is what fails.
    const v = classifySilence(
      [{ name: "mega", maxAgeH: DAILY }],
      new Map([["mega", NOW - 2 * H]]),
      new Map([["mega", NOW - 30 * 24 * H]]),
      NOW,
      new Map([["mega", NOW - 2 * H]]), // its partial row IS its last non-failed run
    );
    expect(v.failing).toEqual([]);
  });

  it("a job whose steady state is failure is EXCLUDED — it cannot regress, so the lane must not speak", () => {
    // ollama-model-liveness: 23 non-failed of 2,333 runs over 30 days, longest
    // unbroken failure streak 2,308. Without this exclusion the first draft of
    // the lane would have paged on ~97% of days within a week of merge — muting
    // the P0 this change exists to make audible.
    const v = classifySilence(
      [{ name: "ollama-model-liveness", maxAgeH: DAILY }],
      new Map([["ollama-model-liveness", NOW - 3 * H]]),
      new Map([["ollama-model-liveness", NOW - 30 * 24 * H]]),
      NOW,
      new Map([["ollama-model-liveness", null]]), // never succeeded
    );
    expect(v.failing).toEqual([]);
    expect(v.silent).toEqual([]);
  });

  it("the exclusion is NOT universal — an ordinary job with no success still pages", () => {
    // The control that stops FAILURE_IS_STEADY_STATE from becoming a mute button:
    // identical inputs, a name that is not excluded, must still page.
    const v = classifySilence(
      [{ name: "ingest-reviews", maxAgeH: DAILY }],
      new Map([["ingest-reviews", NOW - 3 * H]]),
      new Map([["ingest-reviews", NOW - 30 * 24 * H]]),
      NOW,
      new Map([["ingest-reviews", null]]),
    );
    expect(v.failing).toHaveLength(1);
  });

  it("every excluded job carries a measured justification — the set cannot grow silently", () => {
    const src = readFileSync(
      resolve(process.cwd(), "lib/inngest/functions/cron-heartbeat.ts"),
      "utf8",
    );
    const block = src.slice(
      src.indexOf("Jobs whose STEADY STATE is failure"),
      src.indexOf("export function classifySilence("),
    );
    for (const name of FAILURE_IS_STEADY_STATE) {
      expect(
        block,
        `${name} is excluded from the failing lane with no measured rate beside it. ` +
          "An exclusion without a number is a mute button.",
      ).toContain(name);
      // the rationale block must state a run count for each — a bare name is not a reason
      expect(block).toMatch(new RegExp(`${name}[\\s\\S]{0,200}?of [\\d,]+ runs`));
    }
    expect(FAILURE_IS_STEADY_STATE.size).toBeLessThanOrEqual(
      4,
      "if this set is growing, the jobs are broken and the fix is to repair them, not to widen the exclusion",
    );
  });

  it("a silent job is still silent, and is never double-reported as failing", () => {
    const v = classifySilence(
      [{ name: "task-resurface", maxAgeH: DAILY }],
      new Map([["task-resurface", NOW - 90 * H]]),
      new Map([["task-resurface", NOW - 30 * 24 * H]]),
      NOW,
      new Map([["task-resurface", null]]),
    );
    expect(v.silent).toHaveLength(1);
    expect(v.failing, "silent and failing are different runbooks; a job is one or the other").toEqual([]);
  });
});

/**
 * THE WIRING CANARY.
 *
 * Everything above can be perfect and the operator still gets nothing. The
 * function's early return read `if (silent.length === 0)`, so a run with zero
 * silent jobs and one failing job would compute the verdict correctly and then
 * return "heartbeat_ok" without alerting anybody. That is this repo's
 * BUILT-TESTED-UNWIRED pattern — found four times in the statenour deep-upgrade
 * gate alone — and it is invisible to every behavioural test above.
 *
 * There is no Inngest test harness here (no test in tests/inngest/ constructs a
 * fake `step`), so this asserts the wiring at the source level rather than
 * pretending to drive the function. It catches the exact regression: reverting
 * the gate, or composing an alert body that never mentions the failing lane.
 */
describe("cron-heartbeat · the failing lane is actually wired to the alert", () => {
  const src = readFileSync(
    resolve(process.cwd(), "lib/inngest/functions/cron-heartbeat.ts"),
    "utf8",
  );

  it("the early return is gated on BOTH lanes", () => {
    expect(
      src,
      "with only `silent.length === 0` here the failing lane ships inert: the verdict " +
        "is computed, logged as heartbeat_ok, and nobody is told",
    ).toContain("if (silent.length === 0 && failing.length === 0)");
  });

  it("the alert body names the failing lane", () => {
    expect(src).toContain("failingLine");
    expect(src).toMatch(/Running but FAILING every run/);
    expect(src, "the body must be composed from both lines").toContain("${silentLine}${failingLine}");
  });

  it("the outcome query accepts partial but NOT started", async () => {
    // ⚠ THIS ASSERTION USED TO READ `expect(src).toContain('status: { not: "failed" }')`.
    // The invariant it protected is unchanged and still asserted below: an
    // equals-"success" filter false-pages every job that legitimately reports
    // `partial`. What changed on 2026-09-17 is that the literal stopped being a
    // safe way to express it.
    //
    // ★ A NEGATIVE PREDICATE SILENTLY ADMITS EVERY STATUS INVENTED AFTER IT.
    // When `started` — proof-of-invocation, outcome not yet known — was added,
    // `not: "failed"` began counting a cron that fired and crashed as HEALTHY,
    // without anyone editing this query. So the test now pins the positive list
    // that replaced it, which cannot be widened by someone else's new status.
    const { TERMINAL_OK_STATUSES } = await import("../../lib/inngest/cron-lifecycle");
    expect(TERMINAL_OK_STATUSES).toContain("partial");
    expect(
      TERMINAL_OK_STATUSES,
      "counting `started` as a good outcome is the false green this lane exists to catch",
    ).not.toContain("started");

    // Scope the negative assertion to the QUERY block only, as before.
    const queryBlock = src.slice(
      src.indexOf("const [anyRows, okRows]"),
      src.indexOf("const lastByName"),
    );
    expect(queryBlock.length).toBeGreaterThan(0);
    expect(queryBlock).toContain("TERMINAL_OK_STATUSES");
    expect(
      queryBlock.includes('status: "success"') || queryBlock.includes('equals: "success"'),
      "an equals-success filter false-pages every job that legitimately reports partial",
    ).toBe(false);
  });

  it("the ORIGINAL unfiltered query survives — the absence signal must not be repurposed", () => {
    // Filtering the first query instead of adding a second would render a
    // running-but-failing job as "(never)", and two of those escalate the body to
    // "the mega fan-out itself may be down" — a worse lie than the silence.
    const firstQuery = src.slice(src.indexOf("const [anyRows, okRows]"));
    expect(firstQuery).toContain("where: { jobName: { in: names } },");
  });
});
