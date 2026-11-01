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

  it("FAILS once on the first day past 48h, so the outage raises one Data feeder down event", async () => {
    nextBatch = async () => ({ receivedAt: new Date(Date.now() - 60 * 3_600_000) });
    const r = await probeResult();
    expect(r?.ok).toBe(false);
    expect(r?.rowCount).toBe(0);
    expect(r?.reason).toMatch(/no Apple Health data since \d{4}-\d{2}-\d{2} \(2d\), phone step owed/);
  });

  it("a long outage (2026-08-03, the real one) reads EMPTY with its phone step, not a daily failure (2026-11-01)", async () => {
    // Failing daily filed data-source-health red every run from 10-30; the heartbeat paged "failing every run".
    nextBatch = async () => ({ receivedAt: new Date("2026-08-03T12:32:55Z") });
    const r = await probeResult();
    expect(r?.ok).toBe(true);
    expect(r?.rowCount).toBe(0);
    expect(r?.reason).toMatch(/^no Apple Health data since 2026-08-03 \(\d+d\), phone step owed: open Health Auto Export/);
  });

  it("no sync ever received is UNMEASURED (empty with its unlock), not a failure", async () => {
    nextBatch = async () => null;
    const r = await probeResult();
    expect(r?.ok).toBe(true);
    expect(r?.rowCount).toBe(0);
    expect(r?.reason).toMatch(/no Apple Health sync ever received, phone step owed/);
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
