/**
 * Q-23 phase 12 · one rule for every reader of `sms.gatewayHealth`.
 *
 * Phase 10 put the rule in `lib/gatewayState.ts`, but two readers kept their own
 * copies, and the copies disagreed on one case: a failed BACKGROUND refetch
 * while react-query still holds the last good read.
 *
 *   - gatewayState (MorningBrief, OutreachBrief, Settings) trusts the cached
 *     read. `main.tsx` sets `retry: 0`, so one failed refetch on tab-back would
 *     otherwise flip every badge to "unknown".
 *   - GatewayPill and the Data freshness row said "unknown" instead.
 *
 * Settled here: every surface shows the cached read, and the Data freshness row
 * says that the latest refresh failed. "Could the check run?" is a different
 * question, and the Settings "N of 8 checks could not run" banner answers it
 * from the query error, as it already does for its 7 sibling checks.
 *
 * Also here: the Settings F25e pill with a failed query and nothing cached (no
 * test pinned it), and the "Twilio fallback" claims. `server/sms.ts` queues
 * every text while a configured gateway is offline; it never falls back to
 * Twilio on that path.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook } from "@testing-library/react";

const h = vi.hoisted(() => {
  const q = {} as Record<string, { data: unknown; isLoading: boolean; isError: boolean }>;
  const proc = (key: string) => ({ useQuery: () => q[key] ?? { data: undefined, isLoading: false, isError: false } });
  return { q, proc };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    adminDashboard: { stats: h.proc("adminDashboard.stats") },
    vapi: { status: h.proc("vapi.status") },
    sms: { gatewayHealth: h.proc("sms.gatewayHealth"), status: h.proc("sms.status") },
    reviewRequests: { stats: h.proc("reviewRequests.stats") },
    campaigns: { stats: h.proc("campaigns.stats") },
    shopdriver: { declinedRecoveryStatus: h.proc("shopdriver.declinedRecoveryStatus") },
    featureFlags: { list: h.proc("featureFlags.list") },
    trafficFunnel: { overview: h.proc("trafficFunnel.overview") },
    autoLabor: { status: h.proc("autoLabor.status") },
    nickActions: { cronHealth: h.proc("nickActions.cronHealth") },
    lot: { health: h.proc("lot.health") },
  },
}));

import GatewayPill from "../components/admin/GatewayPill";
import { smsGatewayRow } from "../pages/admin/today/freshnessRows";
import { OutreachBrief } from "../pages/admin/outreach/OutreachBrief";
import { useSettingsStatus } from "../pages/admin/settings/useSettingsStatus";
import SettingsStatusTab from "../pages/admin/settings/SettingsStatusTab";

const set = (key: string, data: unknown, isError = false) => {
  h.q[key] = { data, isLoading: false, isError };
};

afterEach(() => {
  cleanup();
  for (const k of Object.keys(h.q)) delete h.q[k];
});

const PHONE_LIVE = { configured: true, readable: true, online: true, lastSeen: "2026-10-01T14:58:00Z", ageMinutes: 2, deviceName: "F25e", deviceId: "d1" };
const PHONE_SILENT = { configured: true, readable: true, online: false, lastSeen: "2026-10-01T10:00:00Z", ageMinutes: 300, deviceName: "F25e", deviceId: "d1" };
const VENDOR_DOWN = { configured: true, readable: false, online: false, lastSeen: null, deviceName: null, error: "Capevace /device returned 503" };

describe("GatewayPill follows gatewayState", () => {
  const configured = () => set("sms.status", { shopGateway: { configured: true } });

  it("a failed refetch with a cached live read still says Live", () => {
    configured();
    set("sms.gatewayHealth", PHONE_LIVE, true);
    const { container } = render(<GatewayPill />);
    expect(container.textContent).toContain("Live");
    expect(container.textContent).not.toContain("unknown");
  });

  it("a failed refetch with a cached silent-phone read still says offline", () => {
    configured();
    set("sms.gatewayHealth", PHONE_SILENT, true);
    const { container } = render(<GatewayPill />);
    expect(container.textContent).toContain("Gateway offline");
  });

  it("the first read in flight is not 'offline'", () => {
    configured();
    const { container } = render(<GatewayPill />);
    expect(container.textContent).not.toContain("offline");
    expect(container.textContent).toMatch(/checking/i);
  });

  it("a still-loading sms.status is not 'not configured'", () => {
    set("sms.gatewayHealth", PHONE_LIVE);
    const { container } = render(<GatewayPill />);
    expect(container.textContent).toContain("Live");
    expect(container.textContent).not.toContain("not configured");
  });

  it("control: a status read that says unconfigured is still 'not configured'", () => {
    set("sms.status", { shopGateway: { configured: false } });
    set("sms.gatewayHealth", PHONE_LIVE);
    const { container } = render(<GatewayPill />);
    expect(container.textContent).toContain("Gateway: not configured");
  });

  it("control: a failed query with nothing cached is still unknown", () => {
    configured();
    set("sms.gatewayHealth", undefined, true);
    const { container } = render(<GatewayPill />);
    expect(container.textContent).toContain("Gateway status unknown");
  });
});

describe("smsGatewayRow follows gatewayState", () => {
  it("a failed refetch with a cached live read shows the read and says the refresh failed", () => {
    const r = smsGatewayRow({ data: PHONE_LIVE, isError: true });
    expect(r.status).toBe("online · seen 2m ago");
    expect(r.provenance).toBe("MEASURED");
    expect(r.detail).toMatch(/latest refresh failed/);
    expect(r.loud).toBe(true);
  });

  it("a failed refetch with a cached vendor failure stays unknown", () => {
    const r = smsGatewayRow({ data: VENDOR_DOWN, isError: true });
    expect(r.status).toBe("unknown");
    expect(r.provenance).toBe("UNMEASURED");
  });

  it("control: a clean live read carries no refresh note", () => {
    const r = smsGatewayRow({ data: PHONE_LIVE, isError: false });
    expect(r.detail).toBeNull();
    expect(r.loud).toBe(false);
  });
});

describe("Settings 'checks could not run' banner", () => {
  const configured = () => set("sms.status", { shopGateway: { configured: true } });

  it("a failed refetch with cached data counts as a check that could not run, like its siblings", () => {
    configured();
    set("featureFlags.list", [], true);
    set("sms.gatewayHealth", PHONE_LIVE, true);
    const { result } = renderHook(() => useSettingsStatus());
    expect(result.current.failedChecks).toEqual(["feature flags", "SMS gateway health"]);
    // The state itself is still the cached read.
    expect(result.current.smsGwState).toBe("online");
  });

  it("a vendor failure with a failed refetch is listed once", () => {
    configured();
    set("sms.gatewayHealth", VENDOR_DOWN, true);
    const { result } = renderHook(() => useSettingsStatus());
    expect(result.current.failedChecks.filter((c) => /SMS gateway/.test(c))).toHaveLength(1);
  });

  it("control: a clean read is not a failed check", () => {
    configured();
    set("sms.gatewayHealth", PHONE_LIVE);
    const { result } = renderHook(() => useSettingsStatus());
    expect(result.current.failedChecks).not.toContain("SMS gateway health");
  });
});

describe("Settings F25e connection pill", () => {
  it("a failed query with nothing cached reads 'status unknown', not 'offline · check device'", () => {
    set("sms.status", { shopGateway: { configured: true } });
    set("sms.gatewayHealth", undefined, true);
    const { container } = render(<SettingsStatusTab />);
    expect(container.textContent).toMatch(/status unknown · the status read failed/);
    expect(container.textContent).not.toMatch(/offline · check device/);
  });
});

describe("no Twilio fallback claim", () => {
  it("OutreachBrief: an offline phone says texts queue, not that Twilio is sending", () => {
    set("reviewRequests.stats", { pending: 0, sent: 3 });
    set("campaigns.stats", { activeCampaigns: 0, totalCampaigns: 0, totalSent: 0 });
    set("shopdriver.declinedRecoveryStatus", { dryRun: false, recoverableDollars: 0, eligible: 0 });
    set("sms.gatewayHealth", PHONE_SILENT);
    const { container } = render(<OutreachBrief onRecoveryAction={() => {}} />);
    expect(container.textContent).toMatch(/F25e shop gateway offline/);
    expect(container.textContent).toMatch(/texts queue/);
    expect(container.textContent).not.toMatch(/Twilio/);
  });

  it("Settings: the gateway-offline alert says texts are held, not that they fall through to Twilio", () => {
    set("sms.status", { shopGateway: { configured: true } });
    set("sms.gatewayHealth", PHONE_SILENT);
    const { result } = renderHook(() => useSettingsStatus());
    const alert = result.current.openIssues.find((i) => i.key === "f25e-offline");
    expect(alert).toBeDefined();
    expect(alert!.detail).not.toMatch(/Twilio/);
    expect(alert!.detail).toMatch(/queue/);
  });
});
