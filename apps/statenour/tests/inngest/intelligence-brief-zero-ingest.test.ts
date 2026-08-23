/**
 * A brief wearing today's date, built on last week's backlog, is not a good day.
 *
 * THE DEFECT, 2026-08-23. `intelligence-daily-brief`'s ingestion loop caught
 * every per-source error, logged it, and returned normally. A source returning
 * `{ success: false }` was not logged at all. So if all seven feeds failed — one
 * expired credential is enough — the run reported `sourcesIngested: 0` and
 * Inngest marked it SUCCEEDED.
 *
 * WHAT ACTUALLY SHIPPED ON SUCH A DAY, corrected under review: not an empty
 * brief. `composeDailyExecutiveBrief` has no date filter on any of its queries,
 * so a total outage produces a brief built on the standing BACKLOG under today's
 * date with no staleness marker. Stale content dated today reads as fresh, which
 * is worse than visibly empty.
 *
 * WHY THIS FILE IS BEHAVIOURAL. The first version asserted that
 * `ingestionFailure(` and `throw new Error(fatal)` appeared in the source text.
 * Both assertions survive swapping the arguments at the call site —
 * `sourcesAttempted: ingestedCount, sourcesIngested: activeSources.length` —
 * which INVERTS the gate: it fires when all seven sources succeed and stays
 * silent when all seven fail. That mutation passed 10 of 10 tests in review. The
 * loop now takes its ingester as a parameter, so these drive it instead.
 */
import { describe, it, expect, vi } from "vitest";
import {
  ingestAllSources,
  ingestionFailure,
} from "@/lib/inngest/functions/intelligence-brief";

type Res = { success: boolean; claimsCount: number; message: string };

const sources = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `Source ${i}` }));

const ok = (claims = 3): Res => ({ success: true, claimsCount: claims, message: "fine" });
const soft = (message: string): Res => ({ success: false, claimsCount: 0, message });

describe("ingestAllSources · driven, not grepped", () => {
  it("THE DEFECT: every feed fails and the rollup says so", async () => {
    const r = await ingestAllSources(sources(7), async () => soft("401 unauthorized"));
    expect(r.sourcesAttempted).toBe(7);
    expect(r.sourcesIngested).toBe(0);
    expect(r.failures).toHaveLength(7);
    expect(r.failures[0]).toContain("401 unauthorized");
  });

  it("THE MUTATION THAT USED TO SURVIVE: attempted and ingested cannot be swapped", async () => {
    // With the counts transposed this rollup reads 0 attempted / 7 ingested, and
    // ingestionFailure returns null on a total outage while firing on a perfectly
    // healthy day. Pinning both fields by value is what kills it.
    const allFail = await ingestAllSources(sources(7), async () => soft("down"));
    expect(allFail.sourcesAttempted).toBe(7);
    expect(allFail.sourcesIngested).toBe(0);
    expect(ingestionFailure(allFail)).not.toBeNull();

    const allWork = await ingestAllSources(sources(7), async () => ok());
    expect(allWork.sourcesAttempted).toBe(7);
    expect(allWork.sourcesIngested).toBe(7);
    expect(ingestionFailure(allWork)).toBeNull();
  });

  it("a soft failure is recorded — it used to be neither counted nor logged", async () => {
    const softLog = vi.fn();
    const r = await ingestAllSources(sources(2), async () => soft("invalid_grant"), { soft: softLog });
    expect(softLog).toHaveBeenCalledTimes(2);
    expect(r.failures.every((f) => f.includes("invalid_grant"))).toBe(true);
  });

  it("a THROWN failure is caught, recorded, and does not abort the remaining sources", async () => {
    let n = 0;
    const r = await ingestAllSources(sources(3), async () => {
      n++;
      if (n === 1) throw new Error("connection reset");
      return ok(2);
    });
    expect(r.sourcesAttempted).toBe(3);
    expect(r.sourcesIngested).toBe(2);
    expect(r.totalClaims).toBe(4);
    expect(r.failures[0]).toContain("connection reset");
  });

  it("claims are summed across sources, not counted per source", async () => {
    const r = await ingestAllSources(sources(3), async () => ok(5));
    expect(r.totalClaims).toBe(15);
  });

  it("no sources registered is a clean empty rollup, not an error", async () => {
    const r = await ingestAllSources([], async () => ok());
    expect(r).toEqual({ sourcesAttempted: 0, sourcesIngested: 0, totalClaims: 0, failures: [] });
  });
});

describe("ingestionFailure · the verdict", () => {
  it("THE DEFECT: zero ingested is a failure and names the reason first", async () => {
    const r = await ingestAllSources(sources(7), async () => soft("401 unauthorized"));
    const msg = ingestionFailure(r);
    expect(msg).not.toBeNull();
    expect(msg).toContain("0/7");
    // Reasons FIRST: on-failure.ts truncates the error to 240 chars before
    // sending, so anything behind a preamble is cut off. 240 is the budget the
    // actionable half has to survive, so it is asserted inside that budget.
    expect(msg!.slice(0, 240)).toContain("401 unauthorized");
  });

  it("THE MISSED CASE: all sources succeed and ZERO claims come out", () => {
    // extractClaimsFromText returns [] on a JSON parse failure and on any thrown
    // error, so one provider change empties every source at once. The first
    // version of this gate counted SOURCES and missed it entirely — a likelier
    // single point of failure than seven independent credential expiries.
    const msg = ingestionFailure({ sourcesAttempted: 7, sourcesIngested: 7, totalClaims: 0 });
    expect(msg).not.toBeNull();
    expect(msg).toContain("ZERO claims");
    expect(msg).toMatch(/extractor/i);
  });

  it("says so explicitly when no reason was captured", () => {
    const msg = ingestionFailure({ sourcesAttempted: 3, sourcesIngested: 0 });
    expect(msg).toContain("no per-source reason captured");
  });

  it("POSITIVE CONTROL: a healthy run returns null", () => {
    // Without this, a function hardcoded to return a string would satisfy every
    // assertion above while failing the brief every single morning.
    expect(ingestionFailure({ sourcesAttempted: 7, sourcesIngested: 7, totalClaims: 21 })).toBeNull();
  });

  it("POSITIVE CONTROL: partial degradation does not page", () => {
    // A gate that fired on one flaky feed would be muted, taking the total-outage
    // signal with it. Partial failure is logged, not paged.
    expect(
      ingestionFailure({ sourcesAttempted: 7, sourcesIngested: 1, totalClaims: 2, failures: ["six down"] }),
    ).toBeNull();
  });

  it("THE GUARD: no sources registered means ingesting nothing is CORRECT", () => {
    // Without this branch an empty configuration becomes a permanent daily alarm
    // — the failure-is-steady-state trap that gets a gate muted.
    expect(ingestionFailure({ sourcesAttempted: 0, sourcesIngested: 0, totalClaims: 0 })).toBeNull();
  });

  it("totalClaims undefined does not trip the extractor branch", () => {
    // Only an explicit 0 is a claim about extraction. An absent field is not.
    expect(ingestionFailure({ sourcesAttempted: 7, sourcesIngested: 7 })).toBeNull();
  });
});

describe("the gate is wired at the END of the function, not inside the step", () => {
  const src = readSource();

  it("the verdict is computed from the rollup and thrown", () => {
    expect(src).toMatch(/const fatal = ingestionFailure\(ingestionReport\)/);
    expect(src).toMatch(/throw new Error\(fatal\)/);
  });

  it("the throw is NOT inside the ingestion step — retries must replay, not re-ingest", () => {
    // Inngest memoizes completed steps and replays them on retry "without
    // re-executing the step's code". Throwing inside step 1 meant each of the
    // three attempts re-ran all seven connector fetches and re-spent the scrape
    // budget on the day things were already broken, and skipped the six
    // downstream steps — no briefing_logs row, no push, no drift scan.
    const stepStart = src.indexOf('step.run("ingest-active-sources"');
    const stepEnd = src.indexOf('step.run("synthesize-opportunities"');
    const stepBody = src.slice(stepStart, stepEnd);
    expect(stepBody.length).toBeGreaterThan(0);
    expect(stepBody, "the gate must not throw inside the ingestion step").not.toMatch(/throw new Error/);
    expect(stepBody).toContain("ingestAllSources");
  });

  it("the throw comes after dispatch-push, so the brief still ships", () => {
    expect(src.indexOf("throw new Error(fatal)")).toBeGreaterThan(
      src.indexOf('step.run("dispatch-push"'),
    );
  });
});

function readSource(): string {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { resolve } = require("node:path") as typeof import("node:path");
  return readFileSync(resolve(process.cwd(), "lib/inngest/functions/intelligence-brief.ts"), "utf8");
}
