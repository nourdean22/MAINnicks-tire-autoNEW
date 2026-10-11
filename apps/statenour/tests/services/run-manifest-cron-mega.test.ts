/**
 * A manual mega run goes through Inngest, not the legacy route (audit 03-F15, 2026-10-11).
 *
 * runManifestCron('mega') fetched /api/cron/mega?slot=morning: a raw route with no
 * cronHandler, so the slot kill switch was skipped and no lifecycle row was written.
 * The mega slots are scheduled on Inngest (mega-fanout.ts, triggers 'mega/fire.morning'
 * and 'mega/fire.evening'); sending that event runs the same function the schedule
 * runs, behind the middleware kill switch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/inngest/client", () => ({ getInngest: () => ({ send: h.send }) }));

import { runManifestCron } from "@/lib/services/cron-control";

const fetchSpy = vi.fn(async () => new Response("ok", { status: 200 }));

beforeEach(() => {
  h.send.mockReset();
  h.send.mockResolvedValue({ ids: ["evt-1"] });
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  process.env.CRON_SECRET = "s3cret";
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runManifestCron: mega slots", () => {
  it("mega sends mega/fire.morning and never fetches the legacy route", async () => {
    const r = await runManifestCron("mega");
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][0]).toMatchObject({ name: "mega/fire.morning" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r).toMatchObject({ jobName: "mega", ok: true, status: 202, body: "queued mega/fire.morning" });
  });

  it("mega-evening sends mega/fire.evening", async () => {
    const r = await runManifestCron("mega-evening");
    expect(h.send.mock.calls[0][0]).toMatchObject({ name: "mega/fire.evening" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, status: 202, body: "queued mega/fire.evening" });
  });

  it("a failed send is ok:false with the error, never a throw", async () => {
    h.send.mockRejectedValueOnce(new Error("event key missing"));
    const r = await runManifestCron("mega");
    expect(r).toMatchObject({ ok: false, status: 0, error: "event key missing" });
  });

  it("CONTROL: a route cron still fetches its path", async () => {
    const anyRoute = (await import("@/config/crons")).CRONS.find(
      (c) => c.mode !== "retired" && c.path && !c.name.startsWith("mega"),
    );
    expect(anyRoute).toBeTruthy();
    await runManifestCron(anyRoute!.name);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(h.send).not.toHaveBeenCalled();
  });
});
