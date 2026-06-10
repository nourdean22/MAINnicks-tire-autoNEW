/**
 * Tests for shared/journey.ts buildSessionJourneys — the exact-key
 * visitor-journey join. Pins the truthfulness contracts:
 *  1. NULL sessionIds are never joined (counted as unattributed, not guessed)
 *  2. Joins happen ONLY on identical sessionId values
 *  3. Steps order chronologically; coverage numbers are honest
 */
import { describe, it, expect } from "vitest";
import { buildSessionJourneys, type JourneyRow } from "../shared/journey";

const row = (kind: string, id: number, sessionId: string | null, at: string): JourneyRow =>
  ({ kind, id, sessionId, at });

describe("buildSessionJourneys", () => {
  it("joins rows only on identical sessionId (exact key, no guessing)", () => {
    const { journeys } = buildSessionJourneys([
      row("call_click", 1, "s_a", "2026-06-10T10:00:00Z"),
      row("lead", 11, "s_a", "2026-06-10T10:05:00Z"),
      row("lead", 12, "s_b", "2026-06-10T10:06:00Z"),
    ]);
    expect(journeys).toHaveLength(2);
    const a = journeys.find(j => j.sessionId === "s_a")!;
    expect(a.steps.map(s => s.kind)).toEqual(["call_click", "lead"]);
    expect(a.kinds).toEqual(["call_click", "lead"]);
  });

  it("NEVER fabricates a join for null sessionIds — they count as unattributed", () => {
    const { journeys, coverage } = buildSessionJourneys([
      row("lead", 1, null, "2026-06-10T10:00:00Z"),
      row("lead", 2, null, "2026-06-10T10:01:00Z"),
      row("booking", 3, "s_x", "2026-06-10T10:02:00Z"),
    ]);
    expect(coverage).toEqual({ totalRows: 3, attributed: 1, unattributed: 2, multiStepJourneys: 0 });
    // the two null rows must NOT appear in any journey
    expect(journeys.flatMap(j => j.steps).map(s => s.id)).toEqual([3]);
  });

  it("orders steps chronologically regardless of input order", () => {
    const { journeys } = buildSessionJourneys([
      row("booking", 3, "s_a", "2026-06-10T12:00:00Z"),
      row("call_click", 1, "s_a", "2026-06-10T10:00:00Z"),
      row("lead", 2, "s_a", "2026-06-10T11:00:00Z"),
    ]);
    expect(journeys[0].steps.map(s => s.id)).toEqual([1, 2, 3]);
    expect(journeys[0].kinds).toEqual(["call_click", "lead", "booking"]);
  });

  it("counts multi-step journeys honestly (single-row sessions say nothing)", () => {
    const { coverage } = buildSessionJourneys([
      row("call_click", 1, "s_a", "2026-06-10T10:00:00Z"),
      row("lead", 2, "s_a", "2026-06-10T10:05:00Z"),
      row("lead", 3, "s_lone", "2026-06-10T10:06:00Z"),
    ]);
    expect(coverage.multiStepJourneys).toBe(1);
  });

  it("handles the empty case", () => {
    const { journeys, coverage } = buildSessionJourneys([]);
    expect(journeys).toEqual([]);
    expect(coverage).toEqual({ totalRows: 0, attributed: 0, unattributed: 0, multiStepJourneys: 0 });
  });
});
