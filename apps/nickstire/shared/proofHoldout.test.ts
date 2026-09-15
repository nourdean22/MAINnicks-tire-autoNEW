/**
 * Hidden holdout — the parts that decide what leaves the runner (2026-09-15).
 *
 * Three surfaces, each a leak or a lie if wrong:
 *   · the runner's labels (tests/episodes/schema.ts): a holdout's task text and
 *     oracle values must not reach a title, an assertion label or a failure record;
 *   · the summary (scripts/proof/holdout-summary.mjs): ids + counts only, and
 *     an absent holdout is UNMEASURED — never a pass;
 *   · the id rule: HO-xxx is accepted by the schema, and only HO-xxx counts.
 * Real symbols imported and mutated, never re-implemented.
 */
import { describe, expect, it } from "vitest";
import { assertEpisode, episodeTitle, failureErrorText, isHoldoutId, oracleLabel } from "../tests/episodes/schema";
import { HOLDOUT_ID, holdoutEvent, summarizeHoldout } from "../scripts/proof/holdout-summary.mjs";

const ep = { id: "HO-001", task: "From /secret-route reach the hidden oracle in one tap." };

describe("holdout labels withhold the oracle", () => {
  it("POSITIVE CONTROL: outside holdout mode the title and labels carry the task and the value", () => {
    expect(episodeTitle(ep, false)).toBe("HO-001 · From /secret-route reach the hidden oracle in one tap.");
    expect(oracleLabel("visible text", "/find your tires/i", false)).toBe("visible text: /find your tires/i");
    expect(failureErrorText(new Error("locator.click: getByRole('link', { name: /hidden/i })"), false)).toMatch(/hidden/);
  });

  it("in holdout mode the title is the id only, the label names only the KIND, and the error is a fixed phrase", () => {
    expect(episodeTitle(ep, true)).toBe("HO-001 · holdout");
    expect(episodeTitle(ep, true)).not.toMatch(/secret-route|oracle/);
    expect(oracleLabel("visible text", "/find your tires/i", true)).toBe("holdout visible text");
    expect(oracleLabel("url", "/\\/tires/", true)).not.toMatch(/tires/);
    const text = failureErrorText(new Error("locator.click: getByRole('link', { name: /hidden/i })"), true);
    expect(text).not.toMatch(/hidden|getByRole/);
    expect(text).toMatch(/withheld/);
  });

  it("the schema accepts HO-xxx ids, still rejects anything else, and isHoldoutId separates the two", () => {
    const base = { version: 1, origin: "synthetic_probe", triggeringEvents: [], task: "A task long enough to pass.", startPath: "/x", viewport: { width: 390, height: 844 }, budget: { taps: 1, ms: 20000 }, steps: [], success: { visibleText: ["x"] }, guardrails: [] };
    expect(() => assertEpisode({ ...base, id: "HO-001" }, "f")).not.toThrow();
    expect(() => assertEpisode({ ...base, id: "EP-001" }, "f")).not.toThrow();
    expect(() => assertEpisode({ ...base, id: "XX-001" }, "f")).toThrow(/id must look like/);
    expect(isHoldoutId("HO-001")).toBe(true);
    expect(isHoldoutId("EP-001")).toBe(false);
    expect(HOLDOUT_ID.test("HO-001")).toBe(true);
    expect(HOLDOUT_ID.test("EP-001")).toBe(false);
  });
});

const report = (specs: Array<{ title: string; statuses: string[] }>, stats = {}) => ({
  stats: { expected: 2, unexpected: 1, flaky: 0, skipped: 3, ...stats },
  suites: [{ suites: [{ specs: specs.map((s) => ({ title: s.title, tests: s.statuses.map((status) => ({ status })) })) }] }],
});

describe("summarizeHoldout", () => {
  it("reduces a Playwright report to ids + counts; a spec that failed after every retry is failed, a flaky one is not", () => {
    const s = summarizeHoldout(
      report([
        { title: "HO-001 · holdout", statuses: ["expected"] },
        { title: "HO-002 · holdout", statuses: ["unexpected", "unexpected"] },
        { title: "HO-003 · holdout", statuses: ["flaky"] }, // Playwright's FINAL per-test status: retried and passed
      ]),
    );
    expect(s).toEqual({ measured: true, expected: 2, unexpected: 1, flaky: 0, skipped: 3, total: 3, failedIds: ["HO-002"] });
  });

  it("ignores specs that are not holdout ids (a stray EP title cannot be counted as a holdout)", () => {
    const s = summarizeHoldout(report([{ title: "EP-003 · From the home page…", statuses: ["unexpected"] }]));
    expect(s.total).toBe(0);
    expect(s.failedIds).toEqual([]);
  });

  it("survives an empty or malformed report", () => {
    expect(summarizeHoldout({})).toEqual({ measured: true, expected: 0, unexpected: 0, flaky: 0, skipped: 0, total: 0, failedIds: [] });
    expect(summarizeHoldout(null)).toMatchObject({ total: 0 });
  });
});

describe("holdoutEvent", () => {
  const ctx = { liveCommit: "abc1234", wantCommit: "abc1234", runUrl: "https://ci/run/1", now: "2026-09-15T12:00:00.000Z" };

  it("BREAKS: no summary is UNMEASURED with its reason — never a pass, never absent", () => {
    const e = holdoutEvent({ summary: null, outcome: "skipped", reason: "no holdout secret", ...ctx });
    expect(e.eventType).toBe("proof.holdout");
    expect(e.payload).toMatchObject({ outcome: "unmeasured", measured: false, reason: "no holdout secret" });
    expect(e.payload.outcome).not.toBe("success");
  });

  it("a measured run carries ids + counts and judges success only when nothing failed", () => {
    const summary = { measured: true, expected: 3, unexpected: 0, flaky: 0, skipped: 0, total: 3, failedIds: [] };
    const ok = holdoutEvent({ summary, outcome: "success", ...ctx });
    expect(ok.payload).toMatchObject({ outcome: "success", measured: true, total: 3, failedIds: [], judgedRequestedCommit: true });
    expect(ok.objects).toEqual(expect.arrayContaining([{ type: "commit", id: "abc1234", role: "judged" }, { type: "holdout", id: "nickstire-episodes" }]));
    const bad = holdoutEvent({ summary: { ...summary, unexpected: 1, failedIds: ["HO-002"] }, outcome: "failure", ...ctx });
    expect(bad.payload).toMatchObject({ outcome: "failure", unexpected: 1, failedIds: ["HO-002"] });
  });

  it("a playwright failure outcome with zero unexpected specs is still a failure (the runner may have died before judging)", () => {
    const summary = { measured: true, expected: 0, unexpected: 0, flaky: 0, skipped: 0, total: 0, failedIds: [] };
    expect(holdoutEvent({ summary, outcome: "failure", ...ctx }).payload.outcome).toBe("failure");
  });

  it("never carries an oracle: the payload is ids and numbers only", () => {
    const summary = { measured: true, expected: 0, unexpected: 1, flaky: 0, skipped: 0, total: 1, failedIds: ["HO-009", "EP-001"] };
    const e = holdoutEvent({ summary, outcome: "failure", ...ctx });
    expect(e.payload.failedIds).toEqual(["HO-009"]); // a non-holdout id is dropped even if a report smuggled it in
    for (const v of Object.values(e.payload)) expect(typeof v === "string" ? v.length : 0).toBeLessThan(80);
  });
});
