/**
 * Apple Health sync staleness probe (2026-10-29; first-day rule 2026-11-01).
 *
 * The phone stopped posting on 2026-08-03 and nothing noticed for 87 days:
 * the ingest route only speaks when a request arrives, so silence was
 * invisible. This probe joins the daily data-source canary; a failed probe
 * raises the "Data feeder down" coach event in the cron route.
 *
 * 2026-11-01: failing every day filed data-source-health red every run from
 * 10-30 and the heartbeat paged "failing every run". The probe now fails on the
 * first ET day that sees the outage, decided from its own stored verdict of an
 * earlier day, then reads empty (rowCount 0) with the phone step.
 */
import { describe, it, expect, vi } from "vitest";

// Plain stubs, not vi.fn: a spy whose async impl rejects is reported by vitest as an error even when the caller catches it.
let nextBatch: () => Promise<unknown> = async () => null;
let priorRow: () => Promise<unknown> = async () => null;
const priorQueries: unknown[] = [];
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      upsert: vi.fn().mockResolvedValue({ id: "mock" }),
      findFirst: (args: unknown) => {
        priorQueries.push(args);
        return priorRow();
      },
    },
    healthIngestBatch: { findFirst: () => nextBatch() },
  },
}));

import { runHealthProbes, getProbeSpecs } from "@/lib/contracts/data-source-health";

const NAME = "personal.appleHealthSync";
const probeResult = async () => (await runHealthProbes()).results.find((r) => r.name === NAME);
const OUTAGE = async () => ({ receivedAt: new Date("2026-08-03T12:32:55Z") });
const row = (v: object) => async () => ({ content: JSON.stringify({ probe: NAME, ...v }) });

describe("Apple Health sync staleness probe", () => {
  it("is registered as a personal probe on the daily canary", () => {
    expect(getProbeSpecs().find((s) => s.name === NAME)?.kind).toBe("personal");
  });

  it("FAILS on the first day that sees the outage (an earlier day's row still saw data)", async () => {
    nextBatch = async () => ({ receivedAt: new Date(Date.now() - 60 * 3_600_000) });
    priorRow = row({ ok: true, rowCount: 1 });
    const r = await probeResult();
    expect(r?.ok).toBe(false);
    expect(r?.rowCount).toBe(0);
    expect(r?.reason).toMatch(/no Apple Health data since \d{4}-\d{2}-\d{2} \(2d\), phone step owed/);
  });

  it("a missed run cannot skip the alert: day 5 with the last row from day 1 (data) still FAILS", async () => {
    nextBatch = async () => ({ receivedAt: new Date(Date.now() - 5 * 24 * 3_600_000) });
    priorRow = row({ ok: true, rowCount: 1 });
    expect((await probeResult())?.ok).toBe(false);
  });

  it("the real outage (since 2026-08-03), already reported on an earlier day, reads EMPTY with its phone step", async () => {
    nextBatch = OUTAGE;
    priorRow = row({ ok: false, rowCount: 0, reason: "last Apple Health sync 89d ago" });
    const r = await probeResult();
    expect(r?.ok).toBe(true);
    expect(r?.rowCount).toBe(0);
    expect(r?.reason).toMatch(/^no Apple Health data since 2026-08-03 \(\d+d\), phone step owed: open Health Auto Export/);
  });

  it("the prior-row read excludes today's own row (a same-day re-run is not an earlier day)", async () => {
    nextBatch = OUTAGE;
    priorRow = row({ ok: false, rowCount: 0 });
    priorQueries.length = 0;
    await probeResult();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    expect(priorQueries[0]).toMatchObject({
      where: { category: "data_source_probe", key: { startsWith: `${NAME}_`, not: `${NAME}_${today}` }, deletedAt: null },
    });
  });

  it("no prior row, or an unreadable one, fails toward alerting", async () => {
    nextBatch = OUTAGE;
    priorRow = async () => null;
    expect((await probeResult())?.ok).toBe(false);
    priorRow = async () => ({ content: "a prose rewrite, not JSON" });
    expect((await probeResult())?.ok).toBe(false);
  });

  it("never received: alerts once, then reads empty with the phone step (UNMEASURED with its unlock)", async () => {
    nextBatch = async () => null;
    priorRow = async () => null;
    expect((await probeResult())?.ok).toBe(false);
    priorRow = row({ ok: false, rowCount: 0 });
    const r = await probeResult();
    expect(r?.ok).toBe(true);
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
