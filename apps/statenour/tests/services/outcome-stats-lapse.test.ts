/**
 * Audit 2026-10-10 06-H5: the fleet "undecided" count grew forever. Rating-only
 * kinds (briefs, pushes, predictions) can never carry a decision, and a
 * suggestion nobody acted on for 48h has lapsed. Read-side split, no sweep.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { intelligenceOutcome: { findMany: m.findMany } } }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { outcomeStats } from "@/lib/services/outcome-ledger";

const ago = (ms: number) => new Date(Date.now() - ms);
const H = 3_600_000;

beforeEach(() => m.findMany.mockReset());

describe("outcomeStats undecided vs lapsed vs rating-only", () => {
  it("splits a brief, a 3-day-old suggestion and a 1-hour-old suggestion", async () => {
    m.findMany.mockResolvedValueOnce([
      { kind: "daily_brief", decision: null, outcomeUseful: null, shownAt: ago(0) },
      { kind: "suggestion", decision: null, outcomeUseful: null, shownAt: ago(72 * H) },
      { kind: "suggestion", decision: null, outcomeUseful: null, shownAt: ago(1 * H) },
    ]);
    const s = await outcomeStats(7);
    expect(s).toMatchObject({ shown: 3, undecided: 1, lapsed: 1, ratingOnly: 1 });
  });

  it("INVARIANT: the four buckets add back up to shown", async () => {
    m.findMany.mockResolvedValueOnce([
      { kind: "suggestion", decision: "accepted", outcomeUseful: null, shownAt: ago(100 * H) },
      { kind: "proactive_push", decision: null, outcomeUseful: true, shownAt: ago(100 * H) },
      { kind: "prediction", decision: null, outcomeUseful: false, shownAt: ago(1 * H) },
      { kind: "suggestion", decision: null, outcomeUseful: null, shownAt: ago(47 * H) },
    ]);
    const s = (await outcomeStats(7))!;
    expect(s).toMatchObject({ decided: 1, undecided: 1, lapsed: 0, ratingOnly: 2 });
    expect(s.decided + s.undecided + s.lapsed + s.ratingOnly).toBe(s.shown);
  });

  it("selects kind and shownAt so the split has its inputs", async () => {
    m.findMany.mockResolvedValueOnce([]);
    await outcomeStats(7);
    expect(m.findMany.mock.calls[0][0].select).toMatchObject({ kind: true, shownAt: true });
  });
});
