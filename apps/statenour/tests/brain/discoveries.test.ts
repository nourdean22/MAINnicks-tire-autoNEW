/**
 * Discoveries service · lib/brain/discoveries.ts (2026-08-16).
 *
 * Pins the two invariants that make this surface worth having:
 *   1. It orders by RECENCY, never confidence. Ordering by confidence is the
 *      exact bias it exists to undo — confidence is a re-sighting count, and
 *      a one-off surprising finding is never re-sighted.
 *   2. Rating writes to the outcome ledger, not just the row. That ledger
 *      write is the only thing that ever populates `decision`, which is what
 *      `outcomesNeedingReview()` harvests into recall-eval cases.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  recordShown: vi.fn(),
  recordDecision: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: mocks.brainMemory } }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/services/outcome-ledger", () => ({
  recordShown: mocks.recordShown,
  recordDecision: mocks.recordDecision,
}));

import {
  listDiscoveries,
  rateDiscovery,
  DISCOVERY_CATEGORIES,
} from "@/lib/brain/discoveries";

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "d1",
  category: "hidden_correlation",
  key: "corr_a_b",
  content: "A moves with B",
  source: "correlation-finder",
  createdAt: new Date("2026-08-15T00:00:00Z"),
  metadata: {},
  ...over,
});

describe("listDiscoveries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordShown.mockResolvedValue("ledger-1");
    mocks.recordDecision.mockResolvedValue(true);
  });

  it("covers exactly the four nightly creative engines", () => {
    expect([...DISCOVERY_CATEGORIES].sort()).toEqual([
      "blind_spot",
      "counter_intuitive",
      "hidden_correlation",
      "teaching_moment",
    ]);
  });

  it("orders by recency, NOT confidence — the bias it exists to undo", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([row()]);
    await listDiscoveries();
    const args = mocks.brainMemory.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(JSON.stringify(args.orderBy)).not.toContain("confidence");
  });

  it("excludes soft-deleted rows — this pool is the most GC-exposed there is", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([]);
    await listDiscoveries();
    expect(mocks.brainMemory.findMany.mock.calls[0][0].where.deletedAt).toBeNull();
  });

  it("hides already-judged discoveries by default and counts the unrated", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      row({ id: "unjudged" }),
      row({ id: "judged", metadata: { discoveryVerdict: "known" } }),
    ]);
    const res = await listDiscoveries();
    expect(res.items.map((d) => d.id)).toEqual(["unjudged"]);
    expect(res.unrated).toBe(1);
  });

  it("includes judged ones on request, unjudged first", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      row({ id: "judged", metadata: { discoveryVerdict: "noise" } }),
      row({ id: "unjudged" }),
    ]);
    const res = await listDiscoveries({ includeRated: true });
    expect(res.items.map((d) => d.id)).toEqual(["unjudged", "judged"]);
  });

  it("ignores a garbage verdict in metadata rather than trusting it", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      row({ metadata: { discoveryVerdict: "lol" } }),
    ]);
    const res = await listDiscoveries();
    expect(res.items[0].verdict).toBeNull();
  });
});

describe("rateDiscovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordShown.mockResolvedValue("ledger-1");
    mocks.recordDecision.mockResolvedValue(true);
  });

  it('maps "known" to a ledger DISMISSAL — the novelty signal', async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(row());
    mocks.brainMemory.update.mockResolvedValueOnce({});

    const res = await rateDiscovery("d1", "known");

    expect(res.ok).toBe(true);
    expect(mocks.brainMemory.update.mock.calls[0][0].data.metadata.discoveryVerdict).toBe("known");
    expect(mocks.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ledger-1", decision: "dismissed" }),
    );
    // The verdict itself must survive into the ledger — "already knew" and
    // "noise" both dismiss, and collapsing them would destroy the only
    // distinction between a novelty defect and an accuracy defect.
    expect(mocks.recordDecision.mock.calls[0][0].resultRef).toBe("discovery_verdict:known");
  });

  it('maps "investigate" to an acceptance', async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(row());
    mocks.brainMemory.update.mockResolvedValueOnce({});
    await rateDiscovery("d1", "investigate");
    expect(mocks.recordDecision.mock.calls[0][0].decision).toBe("accepted");
  });

  it("refuses to rate a row outside the discovery categories", async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(row({ category: "wisdom" }));
    const res = await rateDiscovery("d1", "noise");
    expect(res.ok).toBe(false);
    expect(mocks.brainMemory.update).not.toHaveBeenCalled();
  });

  it("refuses a soft-deleted row", async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(row({ deletedAt: new Date() }));
    expect((await rateDiscovery("d1", "noise")).ok).toBe(false);
  });

  it("keeps the operator's verdict even when the ledger write fails", async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(row());
    mocks.brainMemory.update.mockResolvedValueOnce({});
    mocks.recordShown.mockRejectedValueOnce(new Error("ledger down"));

    const res = await rateDiscovery("d1", "known");

    expect(res.ok).toBe(true);
    expect(mocks.brainMemory.update).toHaveBeenCalledOnce();
  });

  it("preserves existing metadata instead of clobbering it", async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(
      row({ metadata: { provenance: "correlation-finder", dataPoints: 9 } }),
    );
    mocks.brainMemory.update.mockResolvedValueOnce({});
    await rateDiscovery("d1", "investigate");
    const meta = mocks.brainMemory.update.mock.calls[0][0].data.metadata;
    expect(meta.provenance).toBe("correlation-finder");
    expect(meta.dataPoints).toBe(9);
    expect(meta.discoveryVerdict).toBe("investigate");
  });
});
