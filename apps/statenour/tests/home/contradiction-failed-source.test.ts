/**
 * A failed contradictions count must put "contradictions" in the brief's failedSources, so Home
 * says "State unknown" instead of showing no row (2026-10-23, lens B test gap). Deleting the
 * push in operator-brief.ts turns this red.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/outcome-ledger", () => ({ recordShownBounded: vi.fn() }));
const h = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock("@/lib/services/contradictions", () => ({ countUnresolvedContradictions: h.count }));

import { __testInternals } from "@/lib/home/operator-brief";

const OK = { contradictions: [], proposals: [], followUps: [], pendingActions: [], approvalRequests: [] };

describe("collectFailedSources", () => {
  it("control: every source read -> nothing failed", () => {
    expect(__testInternals.collectFailedSources(OK)).toEqual([]);
  });

  it("a null (failed) contradictions read is named", () => {
    expect(__testInternals.collectFailedSources({ ...OK, contradictions: null })).toEqual(["contradictions"]);
  });

  it("WIRING · a rejected count goes through the brief's guarded loader into failedSources", async () => {
    h.count.mockRejectedValue(new Error("db down"));
    const contradictions = await __testInternals.loadContradictionsGuarded();
    expect(contradictions).toBeNull();
    expect(__testInternals.collectFailedSources({ ...OK, contradictions })).toEqual(["contradictions"]);
  });

  it("WIRING · a measured zero is an empty list, not a failure", async () => {
    h.count.mockResolvedValue(0);
    const contradictions = await __testInternals.loadContradictionsGuarded();
    expect(contradictions).toEqual([]);
    expect(__testInternals.collectFailedSources({ ...OK, contradictions })).toEqual([]);
  });

  it("a measured empty list is NOT a failure", () => {
    expect(__testInternals.collectFailedSources({ ...OK, contradictions: [] })).not.toContain("contradictions");
  });
});
