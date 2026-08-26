/**
 * The capacity block states counts, and the model never gets to soften them.
 *
 * WHAT THIS WIRES. `lib/brain/task-signals.ts` had ZERO consumers — one of seven
 * `lib` modules the clock work touched that nothing calls. It is not broken:
 * probed against prod 2026-08-26 it returned in 131ms with
 * `{openCount:16, lateCount:0, staleCount:3, capacityRemainingMin:80,
 * allocatedMin:350}`. Correct facts, computed every call, thrown away.
 *
 * THE CONTRACT IT JOINS. compose-daily-brief already established it, in its own
 * words: a deterministic block is counted BEFORE the model and prepended
 * VERBATIM, so the model "cannot round 20 to 'several', drop the section for
 * space, or soften a level". This block joins that contract rather than the
 * prompt — which is why the last test here asserts the composer does NOT pass it
 * to `generateText`.
 *
 * WHY THAT SEPARATION IS LOAD-BEARING HERE. MEASURED 2026-08-25: 26 of the last
 * 32 briefs (81.3%) carry CRITICAL, and the marker is INVERTED at both extremes
 * — it fired on both days with zero cron failures and stayed silent on the day
 * with 6,039 of 60,519 runs failing. Anything routed through that composer
 * inherits the problem. Counts rendered beside it do not.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderCapacityBlock, type CapacityInput } from "@/lib/intelligence/capacity-block";

const BASE: CapacityInput = {
  openCount: 16,
  lateCount: 0,
  staleCount: 3,
  doneToday: 0,
  capacityRemainingMin: 80,
  allocatedMin: 350,
};

describe("renderCapacityBlock · counts survive verbatim", () => {
  it("prints the real numbers, not adjectives", () => {
    // The whole reason this is rendered rather than prompted. "16" must appear
    // as "16" — a brief that says "several open" is a brief you cannot act on.
    const out = renderCapacityBlock(BASE);
    expect(out).toContain("16");
    expect(out).toContain("3");
    expect(out).toMatch(/5h 50m/); // 350 minutes, phone-readable
    expect(out).toMatch(/1h 20m/); // 80 minutes remaining
  });

  it("THE UNMEASURED CASE: null is not zero, and says so", () => {
    // A failed read must not render as a quiet day. This is the same distinction
    // the EmptyState provenance work put on every panel.
    const out = renderCapacityBlock(null);
    expect(out).toContain("UNMEASURED");
    expect(out).toMatch(/not a claim that/i);
    expect(out).not.toMatch(/\b0 open\b/);
  });

  it("says the remainder is GONE when it is, rather than printing 0m", () => {
    // "0m left" reads like a rounding artefact. The operator needs to know that
    // anything new today displaces something already promised.
    const out = renderCapacityBlock({ ...BASE, capacityRemainingMin: 0, allocatedMin: 420 });
    expect(out).toMatch(/gone/i);
    expect(out).toMatch(/displaces/i);
  });

  it("stays quiet about zeroes — a section of noughts trains the eye to skip it", () => {
    const clean = renderCapacityBlock({ ...BASE, lateCount: 0, staleCount: 0 });
    expect(clean).not.toMatch(/past due/);
    expect(clean).not.toMatch(/untouched/);
    // ...but the moment either is real, it earns a line.
    const dirty = renderCapacityBlock({ ...BASE, lateCount: 2, staleCount: 5 });
    expect(dirty).toMatch(/2 past due/);
    expect(dirty).toMatch(/5 untouched/);
  });

  it("POSITIVE CONTROL: a healthy render is substantial, not an empty heading", () => {
    // Without this, a renderer that returned just "## Capacity" would satisfy
    // every "does not contain" assertion above while saying nothing at all.
    const out = renderCapacityBlock(BASE);
    expect(out.split("\n").filter((l) => l.trim().length > 0).length).toBeGreaterThan(2);
    expect(out).toContain("## Capacity");
  });
});

describe("the wiring · rendered beside the model, never through it", () => {
  const composer = () => readFileSync("lib/intelligence/compose-daily-brief.ts", "utf8");

  it("the composer actually renders it — an unwired block is the shape we just removed", () => {
    const src = composer();
    expect(src).toContain("renderCapacityBlock");
    expect(src).toContain("gatherTaskSignals");
    expect(src, "must reach the returned text").toMatch(/\$\{capacityBlock\}/);
  });

  it("THE CONTRACT: capacityBlock is NOT handed to generateText", () => {
    // The load-bearing assertion. If this block ever moves into promptText, the
    // model can round it, soften it, or drop it for space — which is precisely
    // what the queue block's own comment says must never happen. The counts stop
    // being counts the moment they become prompt input.
    const src = composer();
    const promptStart = src.indexOf("const promptText =");
    const promptEnd = src.indexOf("const queue = await loadOperatorQueue()");
    expect(promptStart, "promptText assignment must exist").toBeGreaterThan(-1);
    expect(promptEnd, "queue load must follow the prompt").toBeGreaterThan(promptStart);
    const promptRegion = src.slice(promptStart, promptEnd);
    expect(promptRegion).not.toContain("capacityBlock");
    expect(promptRegion).not.toContain("gatherTaskSignals");
  });

  it("a generation failure cannot take the block with it", () => {
    // The queue block learned this the hard way (its own P1 comment): counting
    // first is worthless if the return path can still discard it. The capacity
    // read is caught separately so a provider outage keeps the counts.
    const src = composer();
    const at = src.indexOf("capacityBlock = renderCapacityBlock(await gatherTaskSignals())");
    expect(at, "the call must exist").toBeGreaterThan(-1);
    const around = src.slice(Math.max(0, at - 200), at + 400);
    expect(around, "must be wrapped").toMatch(/try\s*\{/);
    expect(around, "and degrade to UNMEASURED").toMatch(/renderCapacityBlock\(null\)/);
  });
});
