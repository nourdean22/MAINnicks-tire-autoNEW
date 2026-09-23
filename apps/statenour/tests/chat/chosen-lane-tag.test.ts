/**
 * Canaries for the `lane` tag on `tool.chosen`.
 *
 * WHY THIS FILE EXISTS. `alternate-paths.ts` routes a turn to one of several
 * mutually-exclusive lanes or falls through to the tool-capable streaming path,
 * and NOTHING recorded which one ran. So "could this turn have called a tool at
 * all?" was unanswerable from the database — and a session (this one) tried to
 * infer it from the `mode` tag instead, which is the BUDGET mode and gates
 * nothing. That inference reached a PR body, agent memory and a spawned task
 * before review refuted it.
 *
 * ⚠ THE FAILURE MODE THIS GUARDS IS A CONSTANT. A `lane` tag that is always the
 * same string looks perfectly healthy in every row and silently restores the
 * gap. So the assertions below are DIFFERENTIAL: the tag must VARY with the
 * input, not merely be present.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordToolInvocation, recordMetric, recordMetricStrict } = vi.hoisted(() => ({
  recordToolInvocation: vi.fn().mockResolvedValue(undefined),
  recordMetric: vi.fn().mockResolvedValue(undefined),
  recordMetricStrict: vi.fn().mockResolvedValue({ id: "metric-row-1" }),
}));

vi.mock("@/lib/ai/tool-telemetry", () => ({
  recordToolInvocation,
  isConfigurationError: () => false,
}));
vi.mock("@/lib/services/metrics", () => ({ recordMetric, recordMetricStrict }));

import { walkToolTelemetry } from "@/lib/services/chat/tool-telemetry-walk";

/**
 * Pull the tags of the `tool.chosen` row this walk wrote.
 *
 * ⚠ `recordMetricStrict` is POSITIONAL — `(metric, value, { tags })`. Reading
 * `calls[0].tags` as though arg 0 were an options object returns undefined, and
 * every differential assertion below would then pass vacuously comparing
 * `undefined` to `undefined`. The positive control caught exactly that while
 * this helper was being written.
 *
 * Selecting by metric NAME matters too: this walk also writes
 * `operation.integrity_shadow` with a conversationId tag of its own, so a
 * conversation-only filter can return the wrong row.
 */
async function chosenTags(args: Record<string, unknown>) {
  recordMetricStrict.mockClear();
  walkToolTelemetry({ convId: "c1", traceId: "t1", ...args } as never);
  // The writes are fire-and-forget behind a memoized dynamic import.
  await new Promise((r) => setTimeout(r, 0));
  const call = recordMetricStrict.mock.calls.find((c) => c[0] === "tool.chosen");
  return (call?.[2] as { tags?: Record<string, unknown> } | undefined)?.tags;
}

/** A turn with no steps at all — the shape every alternate lane hands over. */
const NO_STEPS = { ev: { text: "hi", finishReason: "stop" } };

beforeEach(() => {
  recordMetricStrict.mockClear();
  recordMetric.mockClear();
});

describe("tool.chosen · lane tag", () => {
  // POSITIVE CONTROL — if the row stops being written, every differential
  // assertion below passes vacuously on `undefined`.
  it("writes a tool.chosen row at all", async () => {
    const tags = await chosenTags(NO_STEPS);
    expect(tags).toBeDefined();
    expect(tags).toHaveProperty("lane");
  });

  it("defaults to streaming when no lane declared itself", async () => {
    expect((await chosenTags(NO_STEPS))?.lane).toBe("streaming");
  });

  it("records the lane it was given", async () => {
    expect((await chosenTags({ ...NO_STEPS, lane: "self-consistency" }))?.lane).toBe(
      "self-consistency",
    );
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // A constant tag is the failure that hides itself: every row looks fine
  // while the question stays unanswerable. Two different inputs MUST produce
  // two different tags.
  it("CANARY — the lane tag VARIES with input, it is not a constant", async () => {
    const seen = new Set<unknown>();
    for (const lane of ["multi-agent", "deep", "regen", "self-consistency", "preflush"]) {
      seen.add((await chosenTags({ ...NO_STEPS, lane }))?.lane);
    }
    seen.add((await chosenTags(NO_STEPS))?.lane); // the streaming default
    expect(seen.size).toBe(6);
  });

  // The lane is an IDENTITY, not a capability claim. Whether a lane could call
  // a tool is read from the code; deriving it from a tag is the mistake that
  // produced a retracted finding, so the two fields must stay independent.
  it("lane is independent of observed — a named lane can still be blind", async () => {
    const tags = await chosenTags({ ...NO_STEPS, lane: "deep" });
    expect(tags?.lane).toBe("deep");
    expect(tags?.observed).toBe(false);
    expect(tags?.source).toBe("blind");
  });

  it("a lane that supplied receipts is observed, and still carries its identity", async () => {
    const tags = await chosenTags({
      ...NO_STEPS,
      lane: "regen",
      laneToolNames: ["getTasks"],
      laneReceiptsAvailable: true,
    });
    expect(tags?.lane).toBe("regen");
    expect(tags?.observed).toBe(true);
    expect(tags?.source).toBe("lane");
    expect(tags?.tools).toEqual(["getTasks"]);
  });
});
