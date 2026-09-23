/**
 * The E3 pre-flush shadow replays the ROUTING-TIME toolsExpected (review on #2509, P1).
 *
 * Live routing decides "buffer or stream" BEFORE generation with
 *   toolsExpected = actionIntent || webSearchIntent || webSearchRecency   (app/api/ai/chat/route.ts)
 * while the stored shadow recomputed it AFTER generation as `capturedToolCalls.length > 0`
 * (lib/services/chat/persist-assistant-turn.ts). A web-search turn whose expected tool never
 * fired was therefore stamped "would have buffered" when the live lane would have streamed it,
 * and an unexpected tool call produced the inverse - so the displayed flag-on cost was not the
 * live lane's cost. The routing-time value now rides persistBase into the shadow, and each shadow
 * says which input it replayed (`toolsExpectedSource: "routing" | "recomputed"`), so the reader can
 * separate the two cohorts instead of averaging them.
 *
 * Positive control (recorded): against the pre-change tree every case here is red - the source
 * contracts on the expression, and the reader's `toolsExpectedSource` split is absent.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { assembleBufferShadow, type GateTurn } from "@/lib/observability/evidence-gate-calibration";

const root = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const SHADOW = "2026-09-15T17:29:16.000Z";
const at = (n: number) => new Date(Date.parse(SHADOW) + (n + 1) * 60_000);
const LOOKUP = "factual lookup with no tool expected to fire";

const turn = (n: number, source: "routing" | "recomputed" | undefined, buffer = true): GateTurn => ({
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
});

describe("persist-assistant-turn · the shadow replays the routing-time toolsExpected", () => {
  it("reads toolsExpected off the persist deps and only recomputes it when routing supplied none", () => {
    const src = strip(read("lib/services/chat/persist-assistant-turn.ts"));
    expect(src).toMatch(/toolsExpected\?: boolean/);
    // The routing-time value wins; the post-hoc recompute is the fallback for callers that
    // never routed (nothing else may feed the classifier a fresh `capturedToolCalls.length > 0`).
    expect(src).toMatch(/typeof deps\.toolsExpected === "boolean"/);
    expect(src.match(/toolsExpected:\s*capturedToolCalls\.length > 0/g) ?? []).toHaveLength(0);
    expect(src).toMatch(/toolsExpectedSource/);
  });

  it("route.ts computes toolsExpected ONCE and hands the same value to routing and to persistBase", () => {
    const src = strip(read("app/api/ai/chat/route.ts"));
    expect(src).toMatch(/const __toolsExpected\s*=\s*Boolean\(__actionIntent\)\s*\|\|\s*__webSearchIntent\s*\|\|\s*__webSearchRecency/);
    const persistBase = /const persistBase = \{[\s\S]*?\n {2}\};/.exec(src)?.[0] ?? "";
    expect(persistBase).toMatch(/toolsExpected: __toolsExpected/);
    // No second, drifting spelling of the expression remains at the routing call.
    expect(src.match(/Boolean\(__actionIntent\)\s*\|\|\s*__webSearchIntent\s*\|\|\s*__webSearchRecency/g) ?? []).toHaveLength(1);
  });
});

describe("assembleBufferShadow · splits shadows by which toolsExpected they replayed", () => {
  it("counts routing-replayed and recomputed shadows separately and names the recomputed cohort in the caveat", () => {
    const turns = [
      ...Array.from({ length: 25 }, (_, i) => turn(i, "routing")),
      ...Array.from({ length: 10 }, (_, i) => turn(25 + i, "recomputed", false)),
      ...Array.from({ length: 5 }, (_, i) => turn(35 + i, undefined, false)), // pre-change rows: no source stamp
    ];
    const out = assembleBufferShadow(turns);
    expect(out.withShadow).toBe(40);
    expect(out.toolsExpectedSource).toEqual({ routing: 25, recomputed: 15 });
    expect(out.caveat).toContain("15 of 40 shadows recomputed toolsExpected after generation");
  });

  it("CONTROL: when every shadow replayed the routing input, the caveat says so and no recompute cohort is named", () => {
    const out = assembleBufferShadow(Array.from({ length: 40 }, (_, i) => turn(i, "routing", i % 2 === 0)));
    expect(out.toolsExpectedSource).toEqual({ routing: 40, recomputed: 0 });
    expect(out.caveat).toContain("every shadow replayed the routing-time toolsExpected");
    expect(out.caveat).not.toContain("recomputed toolsExpected after generation");
  });
});
