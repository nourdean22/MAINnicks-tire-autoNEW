/**
 * Fleet truth · the learning tables get producer-freshness probes (audit 2026-10-10,
 * 01-F1 / 06-F4 / 08-F15).
 *
 * The outcome ledger wrote ZERO rows 2026-10-03 -> 10-08 and nothing alerted: its
 * failure was a warn log no reader matched, and STATENOUR_ARTIFACT_PROBES had no probe
 * for `intelligence_outcomes`. Same class explained a 3-day `reality_events` outage.
 * inngest-liveness already pages on any stale / never_produced artifact, so a probe
 * here is the whole alarm.
 *
 * Every probe gets a STALE case that must go red and a FRESH control, plus the
 * empty-vs-error split: no row -> never_produced, a thrown read -> unknown.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const intelligenceOutcomeFindFirst = vi.fn();
const realityEventFindFirst = vi.fn();
const registeredSourceFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    intelligenceOutcome: { findFirst: (a: unknown) => intelligenceOutcomeFindFirst(a) },
    realityEvent: { findFirst: (a: unknown) => realityEventFindFirst(a) },
    // The pre-existing probes read these; answer "fresh" so they stay out of the way.
    registeredSource: { findFirst: (a: unknown) => registeredSourceFindFirst(a) },
    cronJobLog: { findFirst: async () => ({ createdAt: new Date() }) },
  },
}));
vi.mock("@/lib/observability/worker-freshness", () => ({
  getLatestWorkerSuccessAt: async () => new Date(),
}));

import { STATENOUR_ARTIFACT_PROBES, statenourArtifacts } from "@/lib/observability/fleet-truth";

const H = 3_600_000;
const hoursAgo = (h: number) => new Date(Date.now() - h * H);

async function stateOf(capability: string) {
  const all = await statenourArtifacts();
  const row = all.find((a) => a.capability === capability);
  expect(row, `${capability} is not in STATENOUR_ARTIFACT_PROBES`).toBeDefined();
  return row!;
}

beforeEach(() => {
  intelligenceOutcomeFindFirst.mockReset();
  realityEventFindFirst.mockReset();
  registeredSourceFindFirst.mockReset();
  intelligenceOutcomeFindFirst.mockResolvedValue({ shownAt: hoursAgo(1) });
  realityEventFindFirst.mockResolvedValue({ createdAt: hoursAgo(1) });
  registeredSourceFindFirst.mockResolvedValue({ lastFetched: hoursAgo(1) });
});

describe("intelligence-outcomes probe (outcome ledger)", () => {
  it("is registered with a 30h window", () => {
    const p = STATENOUR_ARTIFACT_PROBES.find((a) => a.capability === "intelligence-outcomes");
    expect(p?.maxAgeH).toBe(30);
  });

  it("RED CASE: newest shownAt older than 30h reads STALE — the 2026-10-03 outage shape", async () => {
    intelligenceOutcomeFindFirst.mockResolvedValue({ shownAt: hoursAgo(31) });
    expect((await stateOf("intelligence-outcomes")).state).toBe("stale");
  });

  it("CONTROL: a row written an hour ago reads FRESH", async () => {
    intelligenceOutcomeFindFirst.mockResolvedValue({ shownAt: hoursAgo(1) });
    expect((await stateOf("intelligence-outcomes")).state).toBe("fresh");
  });

  it("reads the newest row by shownAt", async () => {
    await stateOf("intelligence-outcomes");
    expect(intelligenceOutcomeFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { shownAt: "desc" }, select: { shownAt: true } }),
    );
  });

  it("an empty table is never_produced, not fresh", async () => {
    intelligenceOutcomeFindFirst.mockResolvedValue(null);
    expect((await stateOf("intelligence-outcomes")).state).toBe("never_produced");
  });

  it("a thrown read is UNKNOWN, never healthy", async () => {
    intelligenceOutcomeFindFirst.mockRejectedValue(new Error("relation does not exist"));
    const row = await stateOf("intelligence-outcomes");
    expect(row.state).toBe("unknown");
    expect(row.ageH).toBeNull();
  });
});

describe("reality-events probe (reality ledger)", () => {
  it("is registered with a 72h window (its senders have an irregular cadence)", () => {
    const p = STATENOUR_ARTIFACT_PROBES.find((a) => a.capability === "reality-events");
    expect(p?.maxAgeH).toBe(72);
  });

  it("RED CASE: newest row older than 72h reads STALE — the 3-day outage shape", async () => {
    realityEventFindFirst.mockResolvedValue({ createdAt: hoursAgo(73) });
    expect((await stateOf("reality-events")).state).toBe("stale");
  });

  it("CONTROL: a row 71h old is still FRESH — one quiet weekend must not page", async () => {
    realityEventFindFirst.mockResolvedValue({ createdAt: hoursAgo(71) });
    expect((await stateOf("reality-events")).state).toBe("fresh");
  });

  it("reads the ARRIVAL clock (createdAt), not the sender-supplied observedAt", async () => {
    // observedAt is caller-supplied (reality-ledger.ts keeps it only for legacy
    // readers), so a batch of back-dated events would read stale while the
    // pipeline is alive. createdAt is the insert time and has its own index.
    await stateOf("reality-events");
    expect(realityEventFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    );
  });

  it("an empty table is never_produced; a thrown read is UNKNOWN", async () => {
    realityEventFindFirst.mockResolvedValue(null);
    expect((await stateOf("reality-events")).state).toBe("never_produced");
    realityEventFindFirst.mockRejectedValue(new Error("timeout"));
    expect((await stateOf("reality-events")).state).toBe("unknown");
  });
});

describe("intelligence-ingest probe (replaced daily-brief, 2026-10-18)", () => {
  it("is registered with a 30h window and the brief probe is gone", () => {
    expect(STATENOUR_ARTIFACT_PROBES.find((a) => a.capability === "intelligence-ingest")?.maxAgeH).toBe(30);
    expect(STATENOUR_ARTIFACT_PROBES.some((a) => a.capability === "daily-brief")).toBe(false);
  });

  it("CONTROL: a source fetched an hour ago reads fresh", async () => {
    expect((await stateOf("intelligence-ingest")).state).toBe("fresh");
  });

  it("RED CASE: the newest last_fetched older than 30h reads STALE", async () => {
    registeredSourceFindFirst.mockResolvedValue({ lastFetched: hoursAgo(31) });
    expect((await stateOf("intelligence-ingest")).state).toBe("stale");
  });

  it("EMPTY is never healthy: no fetched source reads never_produced", async () => {
    registeredSourceFindFirst.mockResolvedValue(null);
    expect((await stateOf("intelligence-ingest")).state).toBe("never_produced");
  });

  it("a thrown read is UNKNOWN, never healthy", async () => {
    registeredSourceFindFirst.mockRejectedValue(new Error("db down"));
    expect((await stateOf("intelligence-ingest")).state).toBe("unknown");
  });

  it("reads the newest fetch of any source (ignores never-fetched rows)", async () => {
    await stateOf("intelligence-ingest");
    expect(registeredSourceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { lastFetched: { not: null } }, orderBy: { lastFetched: "desc" } }),
    );
  });
});