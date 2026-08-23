/**
 * buildSystemHub must say WHICH sections were actually read.
 *
 * Every sub-rollup is safeQuery'd/caught, so a crashed scan or an open
 * quota circuit used to resolve to fallback zeros that are byte-identical
 * to a genuinely quiet system — and both hub-grid chips and the HOME
 * health chip rendered the word "healthy" off them (registered in the
 * 2026-08-04 false-green sweep). Each section now carries `measured`,
 * true only when its read produced a result.
 *
 * Producer pins, per the repo lesson: the pure consumers are pinned in
 * tests/components/*, and this file proves the SERVICE actually emits the
 * flags they branch on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scanCronHealth: vi.fn(),
  scanStaleData: vi.fn(),
  getPowerSettings: vi.fn(),
  safeQuery: vi.fn(),
}));

vi.mock("@/lib/system/cron-diagnostics", () => ({ scanCronHealth: mocks.scanCronHealth }));
vi.mock("@/lib/system/stale-data-scanner", () => ({ scanStaleData: mocks.scanStaleData }));
vi.mock("@/lib/services/power-panel", () => ({ getPowerSettings: mocks.getPowerSettings }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/db/safe-prisma", () => ({ safeQuery: mocks.safeQuery }));

import { buildSystemHub } from "@/lib/services/system-hub";

/** Canned per-label results; a label absent here resolves to the fallback (null). */
let queryResults: Record<string, unknown>;

beforeEach(() => {
  queryResults = {
    "hub.errors": { count24h: 5, fatal24h: 0 },
    "hub.brain": { totalMemories: 100, permanent: 10, avgConfidence: 0.8 },
    "hub.devices": { online: 2, offline: 1, total: 3 },
    "hub.ai": { calls24h: 40, costCents7d: 1234 },
    "hub.pulse": 2,
    "hub.governance": 1,
  };
  mocks.scanCronHealth.mockResolvedValue({
    summary: {
      declaredActiveCrons: 12,
      silentDeclaredCrons: 0,
      totalLogRowsLast48h: 300,
      killedIndividually: 0,
    },
  });
  mocks.scanStaleData.mockResolvedValue({ totalStaleRows: 10, categories: [{ count: 10 }] });
  mocks.getPowerSettings.mockResolvedValue({ pauseAllCrons: false });
  mocks.safeQuery.mockImplementation(
    async (_fn: unknown, fallback: unknown, opts?: { label?: string }) =>
      opts?.label && opts.label in queryResults ? queryResults[opts.label] : fallback,
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("buildSystemHub measured flags", () => {
  it("every section reports measured: true when its read produced a result", async () => {
    const hub = await buildSystemHub();
    // `pulse` is deliberately absent from this list — see the dedicated test
    // below. It is not "a section that failed to read"; it has no source to
    // read from any more, which is a different and permanent claim.
    for (const key of [
      "crons",
      "errors",
      "stale",
      "brain",
      "devices",
      "ai",
      "power",
      "governance",
    ] as const) {
      expect(hub[key].measured, `${key}.measured`).toBe(true);
    }
    expect(hub.errors.count24h).toBe(5);
    expect(hub.devices.total).toBe(3);
  });

  it("pulse is PERMANENTLY unmeasured — its table was dropped, so 0 is filler", async () => {
    // 2026-08-23. `drift_alerts` no longer exists; the un-typechecked raw query
    // that still read it threw 42P01 814 times over a month and failed the whole
    // hub payload. The query is gone, and the section now reports honestly.
    //
    // This is a STRONGER assertion than the loop it was removed from: it pins
    // both halves of the contract, so a 0 can never again be rendered as an
    // all-clear. If someone re-points pulse at the BrainMemory-backed store
    // (getUnresolvedAlerts), this test fails and forces them to say so
    // deliberately rather than flipping a flag by accident.
    const hub = await buildSystemHub();
    expect(hub.pulse.measured, "no source exists to measure").toBe(false);
    expect(hub.pulse.priorityCount, "shape filler, never a reading").toBe(0);
  });

  it("pulse stays unmeasured even when every OTHER read succeeds", async () => {
    // Independence control: proves the false above comes from the section having
    // no source, not from some ambient failure in the fixture.
    const hub = await buildSystemHub();
    expect(hub.crons.measured).toBe(true);
    expect(hub.errors.measured).toBe(true);
    expect(hub.pulse.measured).toBe(false);
  });

  it("a section whose read fell to the fallback is measured: false — its zeros are filler", async () => {
    delete queryResults["hub.errors"];
    delete queryResults["hub.devices"];

    const hub = await buildSystemHub();

    expect(hub.errors.measured).toBe(false);
    expect(hub.errors.count24h).toBe(0); // shape filler, flagged as such
    expect(hub.devices.measured).toBe(false);
    // Independence: the sections that DID read stay measured.
    expect(hub.crons.measured).toBe(true);
    expect(hub.ai.measured).toBe(true);
  });

  it("a crashed scan (cron/stale/power) is measured: false, not a quiet system", async () => {
    mocks.scanCronHealth.mockRejectedValue(new Error("scan crashed"));
    mocks.getPowerSettings.mockRejectedValue(new Error("nope"));

    const hub = await buildSystemHub();

    expect(hub.crons.measured).toBe(false);
    expect(hub.crons.silent).toBe(0); // filler — the exact value that painted "healthy"
    expect(hub.power.measured).toBe(false);
    expect(hub.stale.measured).toBe(true);
  });
});
