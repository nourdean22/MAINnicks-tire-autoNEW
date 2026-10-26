/**
 * parseObserverDetails reads the string runCronFailureObserver writes into cron_log.details, so Settings can
 * show the stuck queues and the lane shapes the observer already measured (2026-10-25: a 16-day-old reminder
 * queue and "3 actionable of 7 judged" sat inside one details string nobody parsed).
 *
 * Positive control: the first fixture is the REAL production string, verbatim. A parser that matched nothing
 * would return empty arrays for it, so the stuck queue and the three shapes are asserted by name.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseObserverDetails } from "./observerSummary";

const PRODUCTION =
  "scanned: 0 failing jobs; telegram messages sent: 0; suppressed (recent): 4; quiet-deferred: 0; resolved: 0; root-db: no; " +
  "shapes: 3 actionable of 7 judged (sms-response-jobs=missing, outbound-sms-queue=missing, declined-work-recovery=dormant); " +
  "undeclared loops: 118; queue-age: reminder-queue=stuck(23664m>1440m), followup-cadence=empty, reel-pipeline=empty, reel-pipeline:publish=empty";

describe("parseObserverDetails", () => {
  it("reads the real production string: the stuck queue, the three shapes, the undeclared count", () => {
    expect(parseObserverDetails(PRODUCTION)).toEqual({
      failing: 0,
      shapesJudged: 7,
      shapes: [
        { job: "sms-response-jobs", shape: "missing" },
        { job: "outbound-sms-queue", shape: "missing" },
        { job: "declined-work-recovery", shape: "dormant" },
      ],
      undeclaredLoops: 118,
      queuesStuck: [{ loop: "reminder-queue", ageMinutes: 23664, maxAgeMinutes: 1440 }],
      raw: PRODUCTION,
    });
  });

  it("a failing count above zero is read as written", () => {
    const out = parseObserverDetails(PRODUCTION.replace("scanned: 0 failing jobs", "scanned: 5 failing jobs"));
    expect(out.failing).toBe(5);
  });

  it("two stuck queues are both listed, a loop name may carry a colon, and non-stuck tokens are ignored", () => {
    const out = parseObserverDetails(
      "scanned: 1 failing jobs; root-db: no; shapes: 0 actionable of 7 judged (all in-spec); undeclared loops: 3; " +
        "queue-age: reminder-queue=stuck(100m>60m), reel-pipeline:publish=stuck(61m>30m), followup-cadence=ok(5m), " +
        "x=unknown(read_failed timeout, retry), y=skipped(no table)",
    );
    expect(out.queuesStuck).toEqual([
      { loop: "reminder-queue", ageMinutes: 100, maxAgeMinutes: 60 },
      { loop: "reel-pipeline:publish", ageMinutes: 61, maxAgeMinutes: 30 },
    ]);
    expect(out.shapes).toEqual([]);
    expect(out.shapesJudged).toBe(7);
  });

  it("the inhibited forms give empty arrays and keep the raw text", () => {
    const inhibited =
      "scanned: 3 failing jobs; telegram messages sent: 1; suppressed (recent): 0; quiet-deferred: 0; resolved: 0; root-db: yes; " +
      "shapes: inhibited by database dependency incident; queue-age: inhibited by database dependency incident";
    expect(parseObserverDetails(inhibited)).toEqual({
      failing: 3,
      shapesJudged: null,
      shapes: [],
      undeclaredLoops: null,
      queuesStuck: [],
      raw: inhibited,
    });
    const unavailable = "scanned: 0 failing jobs; root-db: no; shapes: unavailable; queue-age: reminder-queue=empty";
    expect(parseObserverDetails(unavailable)).toMatchObject({ failing: 0, shapes: [], undeclaredLoops: null, queuesStuck: [] });
  });

  it("a string that is not the observer's format never throws, keeps raw, and says unknown (null), not zero", () => {
    for (const odd of ["", "Cannot connect to database", "shapes: ERROR boom; queue-age: ", "scanned: nope"]) {
      expect(parseObserverDetails(odd)).toEqual({
        failing: null,
        shapesJudged: null,
        shapes: [],
        undeclaredLoops: null,
        queuesStuck: [],
        raw: odd,
      });
    }
  });

  it("the observer still emits the tokens this parser reads (source pin, so the two cannot drift apart)", () => {
    const src = readFileSync(new URL("./observer.ts", import.meta.url), "utf8");
    for (const literal of [
      "`scanned: ${failing.length} failing jobs; ",
      "`shapes: ${shape.findings.length} actionable of ${shape.judged} judged (` +",
      "`${shape.findings.map((f) => `${f.loop}=${f.verdict}`).join(\", \") || \"all in-spec\"}); ` +",
      "`undeclared loops: ${shape.coverageGaps.length}`",
      "`${decl.loop}=stuck(${Math.round(ageMinutes)}m>${decl.maxAgeMinutes}m)`",
      "`queue-age: ${tokens.join(\", \")}`",
    ]) {
      expect(src, `observer.ts no longer contains ${literal}`).toContain(literal);
    }
  });
});
