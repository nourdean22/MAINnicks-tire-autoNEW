/**
 * Home's "SYSTEM DEGRADED: 17 DEVICES OFFLINE" (2026-10-30): buildSystemHub counted every
 * OFFLINE smart_devices row, so cameras and Tuya plugs last heard from in April 2026 re-alarmed
 * the Home hero every day. system-pulse.ts already split offline by last-contact age (program
 * D11, classifyDevices); the hub never adopted it. These pin the hub to the same rule:
 * `offline` = offline with contact inside the 7-day window, long-offline and RETIRED leave it.
 * Control: a recently-silent device still counts, so the alarm is narrowed, not disabled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as unknown[], findMany: vi.fn(), devicesFail: false }));

vi.mock("@/lib/system/cron-diagnostics", () => ({ scanCronHealth: vi.fn(async () => null) }));
vi.mock("@/lib/system/stale-data-scanner", () => ({ scanStaleData: vi.fn(async () => null) }));
vi.mock("@/lib/prisma", () => ({ prisma: { smartDevice: { findMany: h.findMany } } }));
// Only the devices sub-rollup runs its real body; every other section falls back.
// devicesFail: the device read itself fails (safeQuery hands back its fallback, as on a quota error).
vi.mock("@/lib/db/safe-prisma", () => ({
  safeQuery: async (fn: () => Promise<unknown>, fallback: unknown, opts?: { label?: string }) =>
    opts?.label === "hub.devices" && !h.devicesFail ? fn() : fallback,
}));

import { buildSystemHub } from "@/lib/services/system-hub";
import { homeHealthState } from "@/lib/home/health-state";

const NOW = new Date("2026-10-30T17:40:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const dev = (status: string, lastSeenDaysAgo: number | null, createdDaysAgo = 300) => ({
  status,
  lastSeenAt: lastSeenDaysAgo === null ? null : day(lastSeenDaysAgo),
  createdAt: day(createdDaysAgo),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  h.findMany.mockImplementation(async () => h.rows);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  h.devicesFail = false;
});

// Three states for the chip the hub feeds (empty-vs-error): measured trouble, measured clear, unknown.
const MEASURED_REST = {
  crons: { declared: 10, silent: 0, measured: true },
  errors: { count24h: 1, fatal24h: 0, measured: true },
};
describe("the Home health chip reads the device rollup in three states", () => {
  it("a failed device read is unknown: never healthy, never '0 offline'", async () => {
    h.devicesFail = true;
    const hub = await buildSystemHub();
    expect(hub.devices.measured).toBe(false);
    const chip = homeHealthState({ ...MEASURED_REST, devices: hub.devices });
    expect(chip.state).toBe("unknown");
    expect(chip.detail).not.toMatch(/0 devices? offline/);
  });

  it("control: a measured all-clear read is healthy", async () => {
    h.rows = [dev("ONLINE", 0), dev("OFFLINE", 200)];
    const hub = await buildSystemHub();
    expect(homeHealthState({ ...MEASURED_REST, devices: hub.devices }).state).toBe("healthy");
  });

  it("control: a recent outage is degraded and named", async () => {
    h.rows = [dev("OFFLINE", 1)];
    const chip = homeHealthState({ ...MEASURED_REST, devices: (await buildSystemHub()).devices });
    expect(chip.state).toBe("degraded");
    expect(chip.detail).toMatch(/1 device offline/);
  });
});

describe("buildSystemHub devices: offline means recently offline", () => {
  it("the 2026-10-30 prod shape: 15 April relics + 2 recent → offline counts only the recent", async () => {
    h.rows = [
      ...Array.from({ length: 15 }, () => dev("OFFLINE", 200)),
      dev("OFFLINE", 7.5), // 10-23: just outside 7 days → long-offline
      dev("OFFLINE", 3), // inside the window → a real, current outage
      ...Array.from({ length: 5 }, () => dev("ONLINE", 0)),
    ];
    const hub = await buildSystemHub();
    expect(hub.devices.offline, "April relics re-alarmed Home").toBe(1);
    expect(hub.devices.offlineLong).toBe(16);
    expect(hub.devices.online).toBe(5);
    expect(hub.devices.measured).toBe(true);
  });

  it("RETIRED rows leave every count", async () => {
    h.rows = [dev("RETIRED", 200), dev("RETIRED", 1), dev("ONLINE", 0)];
    const hub = await buildSystemHub();
    expect(hub.devices.offline).toBe(0);
    expect(hub.devices.offlineLong).toBe(0);
    expect(hub.devices.total).toBe(1);
    expect(hub.devices.retired).toBe(2);
  });

  it("control: a device that went silent yesterday still counts as offline", async () => {
    h.rows = [dev("OFFLINE", 1)];
    expect((await buildSystemHub()).devices.offline).toBe(1);
  });
});
