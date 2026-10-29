/**
 * Apple Health sync staleness probe (2026-10-29).
 *
 * The phone stopped posting on 2026-08-03 and nothing noticed for 87 days:
 * the ingest route only speaks when a request arrives, so silence was
 * invisible. This probe joins the daily data-source canary; a failed probe
 * already raises the "Data feeder down" coach event in the cron route.
 */
import { describe, it, expect, vi } from "vitest";

// A plain stub, not vi.fn: a spy whose async impl rejects is reported by vitest as an error even when the caller catches it.
let nextBatch: () => Promise<unknown> = async () => null;
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { upsert: vi.fn().mockResolvedValue({ id: "mock" }) },
    healthIngestBatch: { findFirst: () => nextBatch() },
  },
}));

import { runHealthProbes, getProbeSpecs } from "@/lib/contracts/data-source-health";

const NAME = "personal.appleHealthSync";
const probeResult = async () => (await runHealthProbes()).results.find((r) => r.name === NAME);

describe("Apple Health sync staleness probe", () => {
  it("is registered as a personal probe on the daily canary", () => {
    expect(getProbeSpecs().find((s) => s.name === NAME)?.kind).toBe("personal");
  });

  it("FAILS on a planted stale sync (last batch 2026-08-03, the real outage)", async () => {
    nextBatch = async () => ({ receivedAt: new Date("2026-08-03T12:32:55Z") });
    const r = await probeResult();
    expect(r?.ok).toBe(false);
    expect(r?.reason).toMatch(/last Apple Health sync \d+d ago/);
  });

  it("FAILS when no sync was ever received", async () => {
    nextBatch = async () => null;
    const r = await probeResult();
    expect(r?.ok).toBe(false);
    expect(r?.reason).toMatch(/no Apple Health sync ever received/);
  });

  it("passes on a sync inside the 48h window", async () => {
    nextBatch = async () => ({ receivedAt: new Date(Date.now() - 20 * 3_600_000) });
    const r = await probeResult();
    expect(r?.ok).toBe(true);
    expect(r?.rowCount).toBe(1);
  });

  it("a failed read is a failed probe, not a pass", async () => {
    nextBatch = async () => {
      throw new Error("db down");
    };
    const r = await probeResult();
    expect(r?.ok).toBe(false);
    expect(r?.reason).toBe("db down");
  });
});
