/**
 * Wave C functions cleanup (2026-10-24): the manifest and the fan-out describe
 * what runs.
 *
 *   · approval-sweeper ran every 5 minutes for 14 days and did work 0 times
 *     (approval_requests holds 4 rows ever). It now ticks hourly. The manifest
 *     schedule and the Inngest trigger that really fires it must agree, because
 *     the silence detector derives its grace window from the manifest.
 *   · dossier-autodraft and greene-law-tag-refresh ran daily in the morning
 *     fan-out and skipped "not Monday" 12 of 14 times. They ride the weekly
 *     fan-out now, which only runs on the Sunday-night (ET) evening slot.
 *   · semantic-link wrote about 22 edges a day that only an unused route reads.
 *     The writer is parked (dormant); the table and the route stay.
 *
 * Run against the REAL manifest, job lists and Inngest function, not copies.
 */
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ cfg: null as null | { id: string; triggers?: Array<{ cron?: string }> } }));
vi.mock("@/lib/inngest/client", () => ({
  getInngest: () => ({
    createFunction: (cfg: { id: string; triggers?: Array<{ cron?: string }> }) => {
      captured.cfg = cfg;
      return { cfg };
    },
  }),
}));
vi.mock("@/lib/inngest/on-failure", () => ({ onInngestFailure: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/tools/guardian", () => ({ executeApprovedToolAsync: vi.fn() }));
vi.mock("@/lib/automation/approval-queue", () => ({ recoverStuckDecisions: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { CRONS } from "@/config/crons";
import { ALL_MEGA_JOBS, MORNING_JOBS, WEEKLY_JOBS } from "@/lib/inngest/jobs";
import "@/lib/inngest/functions/approval-sweeper";

const manifest = (name: string) => CRONS.find((c) => c.name === name);

describe("approval-sweeper ticks hourly, in the manifest AND in the trigger that fires it", () => {
  it("manifest schedule is hourly", () => {
    expect(manifest("approval-sweeper")?.schedule).toBe("0 * * * *");
  });
  it("the Inngest function's own cron trigger matches the manifest", () => {
    expect(captured.cfg?.id).toBe("approval-sweeper");
    expect(captured.cfg?.triggers?.[0]?.cron).toBe(manifest("approval-sweeper")?.schedule);
  });
});

describe("the two Monday crons ride the weekly fan-out, not the daily morning one", () => {
  it.each(["dossier-autodraft", "greene-law-tag-refresh"])("%s", (name) => {
    const path = `/api/cron/${name}`;
    expect(WEEKLY_JOBS).toContain(path);
    expect(MORNING_JOBS).not.toContain(path);
    // Monday 03:00 UTC is Sunday night ET, and the routes self-gate on getUTCDay()===1.
    expect(manifest(name)?.schedule).toBe("0 3 * * 1");
  });
  it("CONTROL: a cron that really is daily stays in the morning fan-out", () => {
    expect(MORNING_JOBS).toContain("/api/cron/kept-word-scan");
    expect(WEEKLY_JOBS).toContain("/api/cron/reflect-categories");
  });
});

describe("semantic-link is parked with a reason, and nothing fires it", () => {
  it("is in no fan-out list", () => {
    expect(ALL_MEGA_JOBS).not.toContain("/api/cron/semantic-link");
  });
  it("is dormant in the manifest, with a dated one-line reason", () => {
    const c = manifest("semantic-link");
    expect(c?.mode).toBe("dormant");
    expect(c?.description).toMatch(/2026-10-24/);
  });
  it("CONTROL: brain-bus-drain, which works, is untouched", () => {
    expect(manifest("brain-bus-drain")).toMatchObject({ mode: "active", schedule: "*/15 * * * *", worker: true });
  });
});
