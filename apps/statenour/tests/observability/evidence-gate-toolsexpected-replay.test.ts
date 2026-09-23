/**
 * The E3 pre-flush shadow replays the ROUTING-TIME toolsExpected (review on #2509, P1; #2560 P1s).
 *
 * Live routing decides "buffer or stream" BEFORE generation with
 *   toolsExpected = actionIntent || webSearchIntent || webSearchRecency   (app/api/ai/chat/route.ts)
 * while the stored shadow recomputed it AFTER generation as `capturedToolCalls.length > 0`
 * (lib/services/chat/persist-assistant-turn.ts). A web-search turn whose expected tool never
 * fired was therefore stamped "would have buffered" when the live lane would have streamed it,
 * and an unexpected tool call produced the inverse. The routing-time value now rides persistBase
 * into the shadow, and each shadow says which input it replayed (`toolsExpectedSource`).
 *
 * The READER side (this file): only a routing-sourced shadow answers "what would the live lane
 * have done", so every rate - withShadow, wouldBuffer, wouldBufferPct, the reasons, the banner
 * recall and the sufficiency floor - is computed over routing shadows alone. Legacy shadows
 * (recomputed, or unstamped rows from before 2026-09-23) are counted in `legacy` and named in the
 * caveat, never averaged in. The WRITER side is exercised behaviourally through the real
 * buildOnFinish in tests/services/persist-turn-risk-shadow.test.ts; the one source contract kept
 * here pins route.ts, which cannot be driven in a unit test, to computing the value once.
 *
 * Positive control (recorded): against the tree that only COUNTED the two cohorts, the legacy cases
 * here are red - 25 routing buffers + 15 recomputed streams displayed 62.5% "sufficient" where the
 * live-lane cohort is 25/25 and below the 40-turn floor.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { assembleBufferShadow, MIN_SAMPLE, type GateTurn } from "@/lib/observability/evidence-gate-calibration";

const root = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const SHADOW = "2026-09-15T17:29:16.000Z";
const at = (n: number) => new Date(Date.parse(SHADOW) + (n + 1) * 60_000);
const LOOKUP = "factual lookup with no tool expected to fire";

const turn = (
  n: number,
  source: "routing" | "recomputed" | undefined,
  buffer = true,
  over: Partial<GateTurn> = {},
): GateTurn => ({
  createdAt: at(n),
  gate: {
    verdict: "pass",
    turnRisk: {
      buffer,
      risk: buffer ? "high" : "low",
      register: "coaching",
      reasons: buffer ? [LOOKUP] : [],
      toolsFired: 0,
      ...(source ? { toolsExpected: false, toolsExpectedSource: source } : {}),
    },
  },
  excerpt: "reply",
  ...over,
});

describe("route.ts · toolsExpected is computed once and handed to routing AND persistBase", () => {
  it("one __toolsExpected, used by the routing call and carried in persistBase", () => {
    const src = strip(read("app/api/ai/chat/route.ts"));
    expect(src).toMatch(/const __toolsExpected\s*=\s*Boolean\(__actionIntent\)\s*\|\|\s*__webSearchIntent\s*\|\|\s*__webSearchRecency/);
    const persistBase = /const persistBase = \{[\s\S]*?\n {2}\};/.exec(src)?.[0] ?? "";
    expect(persistBase).toMatch(/toolsExpected: __toolsExpected/);
    // No second, drifting spelling of the expression remains at the routing call.
    expect(src.match(/Boolean\(__actionIntent\)\s*\|\|\s*__webSearchIntent\s*\|\|\s*__webSearchRecency/g) ?? []).toHaveLength(1);
  });
});

describe("assembleBufferShadow · every rate is over routing-sourced shadows only", () => {
  it("BREAKS (pre-#2560 reader): legacy shadows are excluded from the denominator, the rate and the floor", () => {
    const turns = [
      ...Array.from({ length: 25 }, (_, i) => turn(i, "routing")),
      ...Array.from({ length: 10 }, (_, i) => turn(25 + i, "recomputed", false)),
      ...Array.from({ length: 5 }, (_, i) => turn(35 + i, undefined, false)), // unstamped pre-change rows
    ];
    const out = assembleBufferShadow(turns);
    expect(out.turns).toBe(40);
    // The live-lane cohort is the 25 routing shadows - all buffers - and it is below the floor.
    expect(out.withShadow).toBe(25);
    expect(out.wouldBuffer).toBe(25);
    expect(out.wouldStream).toBe(0);
    expect(out.sufficient).toBe(false);
    expect(out.wouldBufferPct).toBeNull();
    // The 15 legacy rows are counted, not averaged in.
    expect(out.legacy).toEqual({ withShadow: 15, wouldBuffer: 0, wouldStream: 15 });
    expect(out.caveat).toContain("15 legacy shadow(s) recomputed toolsExpected after generation");
    expect(out.caveat).toContain("excluded from every rate");
  });

  it("legacy shadows do not feed the reason rows or the banner recall", () => {
    const turns = [
      ...Array.from({ length: MIN_SAMPLE }, (_, i) => turn(i, "routing", i % 2 === 0)),
      // Ten legacy buffered banner turns: on the old reader they would have inflated the recall.
      ...Array.from({ length: 10 }, (_, i) => turn(MIN_SAMPLE + i, "recomputed", true, { verifierBanner: true, bannerCause: "l2_action_claim" })),
      // Two routing banner turns, one buffered, one streamed - the only recall that counts.
      turn(MIN_SAMPLE + 10, "routing", true, { verifierBanner: true, bannerCause: "l2_action_claim" }),
      turn(MIN_SAMPLE + 11, "routing", false, { verifierBanner: true, bannerCause: "l2_action_claim" }),
    ];
    const out = assembleBufferShadow(turns);
    expect(out.withShadow).toBe(MIN_SAMPLE + 2);
    expect(out.sufficient).toBe(true);
    expect(out.byReason.find((r) => r.reason === LOOKUP)?.buffered).toBe(MIN_SAMPLE / 2 + 1);
    expect(out.byReason.find((r) => r.reason === LOOKUP)?.bannered).toBe(1);
    expect(out.banner.turns).toBe(12);
    expect(out.banner.wouldHaveBuffered).toBe(1);
    expect(out.banner.wouldHaveStreamed).toBe(1);
    expect(out.banner.legacyShadow).toBe(10);
    expect(out.banner.byCause.find((c) => c.cause === "l2_action_claim")?.legacyShadow).toBe(10);
    expect(out.caveat).toContain("including 10 banner turn(s)");
  });

  it("CONTROL: an all-routing cohort reads exactly as before, and the caveat says so", () => {
    const out = assembleBufferShadow(Array.from({ length: MIN_SAMPLE }, (_, i) => turn(i, "routing", i % 4 === 0)));
    expect(out.withShadow).toBe(MIN_SAMPLE);
    expect(out.wouldBuffer).toBe(MIN_SAMPLE / 4);
    expect(out.wouldBufferPct).toBe(25);
    expect(out.sufficient).toBe(true);
    expect(out.legacy).toEqual({ withShadow: 0, wouldBuffer: 0, wouldStream: 0 });
    expect(out.caveat).toContain("every shadow replayed the routing-time toolsExpected");
    expect(out.caveat).not.toContain("legacy shadow");
  });
});
