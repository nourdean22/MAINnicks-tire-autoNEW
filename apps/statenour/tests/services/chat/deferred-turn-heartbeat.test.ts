/**
 * Live-wiring contract for the deferred-turn heartbeat (`chat.deferred_turn`).
 *
 * The heartbeat is the denominator the three conditional shadows on the
 * deferred path never had; the reader side is unit-tested in
 * tests/lib/observability/instrument-liveness.test.ts. This pins the WRITER at
 * its one call site — runDeferredBackgroundWork, a ~700-line function with no
 * harness — on comment-stripped source, with a mutation canary per pattern:
 *
 *   · it is written AFTER parseActions (so actionCount is real) and BEFORE the
 *     zero-action Done-shadow arm (so it runs on every turn, both arms);
 *   · it dedupes by traceId through the shared reader (the outbox replays);
 *   · it uses the STRICT writer — a dead heartbeat must read as FAILING;
 *   · its catch logs under the LITERAL instrument scope the producer canary
 *     scans for.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFERRED_TURN_INSTRUMENT, KNOWN_INSTRUMENTS } from "@/lib/observability/instrument-failures";
import { CONDITIONAL_INSTRUMENTS } from "@/lib/observability/instrument-liveness";

const WIRING = fileURLToPath(new URL("../../../lib/services/chat/deferred-background-work.ts", import.meta.url));

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const code = stripComments(readFileSync(WIRING, "utf8"));

const HEARTBEAT =
  /if\s*\(\s*!\s*\(\s*await metricRecordedForTrace\(\s*DEFERRED_TURN_INSTRUMENT\s*,\s*traceId\s*\)\s*\)\s*\)\s*\{\s*await recordMetricStrict\(\s*DEFERRED_TURN_INSTRUMENT\s*,\s*1\s*,/;

describe("deferred-turn heartbeat · live wiring", () => {
  it("is registered, unconditional, and named the same everywhere", () => {
    expect(DEFERRED_TURN_INSTRUMENT).toBe("chat.deferred_turn");
    expect(KNOWN_INSTRUMENTS).toContain(DEFERRED_TURN_INSTRUMENT);
    expect(CONDITIONAL_INSTRUMENTS[DEFERRED_TURN_INSTRUMENT]).toBeUndefined();
  });

  it("writes once per turn, deduped by traceId, through the STRICT writer", () => {
    expect(code).toMatch(HEARTBEAT);
    // canary: dropping the dedupe read must fail the pattern
    const noDedupe = code.replace(/if\s*\(\s*!\s*\(\s*await metricRecordedForTrace\(\s*DEFERRED_TURN_INSTRUMENT\s*,\s*traceId\s*\)\s*\)\s*\)\s*\{/, "{");
    expect(noDedupe).not.toMatch(HEARTBEAT);
    // canary: the fail-soft writer must not be wired
    const softened = code.replace(/recordMetricStrict\(\s*DEFERRED_TURN_INSTRUMENT/, "recordMetric(DEFERRED_TURN_INSTRUMENT");
    expect(softened).not.toMatch(HEARTBEAT);
  });

  it("sits after parseActions and before the zero-action Done-shadow arm, so both arms are counted", () => {
    const parse = code.indexOf("const actions = parseActions(text);");
    const beat = code.search(HEARTBEAT);
    const zeroArm = code.indexOf("if (actions.length === 0 && traceId)");
    expect(parse).toBeGreaterThan(-1);
    expect(beat).toBeGreaterThan(parse);
    expect(zeroArm).toBeGreaterThan(beat);
  });

  it("carries the denominator's context — the trace, the conversation and the action count", () => {
    const block = code.slice(code.search(HEARTBEAT), code.search(HEARTBEAT) + 700);
    expect(block).toMatch(/traceId,/);
    expect(block).toMatch(/conversationId:\s*convId \?\? null/);
    expect(block).toMatch(/actionCount:\s*actions\.length/);
  });

  it("fails under the LITERAL instrument scope, so the producer canary and the failures reader can see it", () => {
    expect(code).toMatch(/logError\(\s*instrumentScope\("chat\.deferred_turn"\)/);
  });
});
