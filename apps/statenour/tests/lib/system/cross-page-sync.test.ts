/**
 * Cross-page sync (2026-10-29 sync audit, findings 1-3): one shared reader per shared number.
 *
 *   1. Alerts: the /system tower and the hub tile count what /system/alerts lists (the 7 alert
 *      categories, dismissals and mutes applied), not coach drift-recovery events.
 *   2. Approvals: Home, the app badge and /system/actions count live decisions the same way
 *      (live requests + live autonomous actions; expired ones listed apart).
 *   3. Health: Home and the tower read one error-threshold table, so the same error count gives
 *      the same verdict on both pages.
 *
 * Each block failed on the code before this change (run red first, 2026-10-29).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ countOpenAlerts: vi.fn(), fail: false }));

vi.mock("@/lib/utils/cache", () => ({ cached: (_k: string, _t: number, fn: () => unknown) => fn() }));
vi.mock("@/lib/services/metrics", () => ({ getKpiSummary: () => Promise.resolve({}) }));
vi.mock("@/lib/inngest/functions", () => ({}));
// A plain rejecting function for the failure case: vitest reports an error thrown from inside a vi.fn as a test failure.
vi.mock("@/lib/services/brain-domain", () => ({
  countOpenAlerts: () => (h.fail ? Promise.reject(new Error("suppression read failed")) : h.countOpenAlerts()),
}));
vi.mock("@/lib/prisma", () => {
  const coachRow = { metadata: {} };
  const prisma = {
    task: { groupBy: () => Promise.resolve([]) },
    commitment: { count: () => Promise.resolve(0) },
    smartDevice: { groupBy: () => Promise.resolve([]) },
    // Two unacked drift-recovery coach events: the number the tower used to show.
    brainMemory: {
      findMany: () => Promise.resolve([coachRow, coachRow]),
      count: () => Promise.resolve(0),
      findUnique: () => Promise.resolve(null),
    },
    journalThread: { groupBy: () => Promise.resolve([]) },
    cronJobLog: { findFirst: () => Promise.resolve(null) },
  };
  return { prisma, checkDbConnection: () => Promise.resolve({ connected: true, latency_ms: 1 }) };
});

import { buildSystemHealth } from "@/lib/services/system-pages";
import { controlTower, type TowerDiagnostics } from "@/lib/system/control-tower";
import { homeHealthState } from "@/lib/home/health-state";
import { countLiveDecisions } from "@/lib/automation/live-decisions";
import { CARDS, type HubPayload } from "@/components/system/hub-cards";

const root = path.resolve(__dirname, "../../..");
const src = (p: string) => readFileSync(path.join(root, p), "utf8");

beforeEach(() => {
  h.countOpenAlerts.mockReset();
  h.fail = false;
});

describe("1 · alerts: tower and hub tile count what /system/alerts lists", () => {
  it("the health summary's alert count is the Alerts page reader's count, not drift-recovery coach events", async () => {
    h.countOpenAlerts.mockResolvedValue({ open: 5, priority: 2 });
    const health = await buildSystemHealth();
    expect(health.alerts).toMatchObject({ status: "ok", value: { unresolved: 5, priority: 2 } });
  });

  it("a failed Alerts read is unknown on the tower, never 0", async () => {
    h.fail = true;
    const health = await buildSystemHealth();
    expect(health.alerts.status).toBe("unavailable");
    expect(health.degradedSources).toContain("alerts");
  });

  it("the hub Alerts tile shows the same open count", () => {
    const card = CARDS.find((c) => c.href === "/system/alerts")!;
    const payload = { alerts: { open: 5, priority: 2, measured: true } } as unknown as HubPayload;
    expect(card.chip(payload).label).toBe("5 open · 2 priority");
    const unmeasured = { alerts: { open: 0, priority: 0, measured: false } } as unknown as HubPayload;
    expect(card.chip(unmeasured).severity).toBe("unknown");
  });
});

describe("2 · approvals: one live-decisions count", () => {
  it("counts live requests plus live autonomous actions; expired apart", () => {
    const requests = [{ expired: false }, { expired: true }, {}];
    const actions = [{ expired: false }, { expired: true }];
    expect(countLiveDecisions(requests, actions)).toEqual({ live: 3, expired: 2 });
  });

  it("Home, the badge and /system/actions all read the helper; the actions page no longer counts raw rows", () => {
    for (const f of [
      "lib/home/operator-brief.ts",
      "components/hud/app-badge.tsx",
      "app/(mastery)/system/actions/page.tsx",
    ]) {
      expect(src(f), f).toContain("countLiveDecisions");
    }
    expect(src("app/(mastery)/system/actions/page.tsx")).not.toMatch(/pendingCount\s*=\s*approvals\.length/);
  });
});

describe("3 · health: Home and the tower read one error-threshold table", () => {
  const diag = (n: number): TowerDiagnostics => ({
    db: { connected: true, latency_ms: 5 },
    kpis: { errors_24h: n, error_level_24h: n, requests_24h: 100, latency_24h: { avg_ms: 100, p95_ms: 200 } },
    devices: { online: 1, offline: 0, error: 0, notReporting: 0, total: 1 },
    integrations: [],
  });
  const home = (n: number) =>
    homeHealthState({
      crons: { declared: 10, silent: 0, measured: true },
      errors: { count24h: n, fatal24h: n, measured: true },
      devices: { offline: 0, measured: true },
    }).state;
  const tower = (n: number) => {
    const row = controlTower({ diagnostics: diag(n), health: null, diagnosticsReadFailed: false }).exceptions.find(
      (e) => e.key === "errors",
    );
    return row ? (row.tone === "rose" ? "broken" : "degraded") : "healthy";
  };

  it.each([0, 5, 19, 20, 39, 40, 120])("%i error rows in 24h: same verdict on Home and the tower", (n) => {
    expect(tower(n)).toBe(home(n));
  });

  it("CONTROL: an ordinary day (the ~12/day baseline) is healthy on both", () => {
    expect(home(12)).toBe("healthy");
    expect(tower(12)).toBe("healthy");
  });
});
