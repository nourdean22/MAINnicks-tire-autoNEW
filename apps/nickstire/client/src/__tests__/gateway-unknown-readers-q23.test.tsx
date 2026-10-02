/**
 * Q-23 phase 10 · the last three readers of `sms.gatewayHealth.online`.
 *
 * Phase 9 gave the resolver an additive `readable` field: false when the
 * Capevace API did not answer, so the phone's state is UNKNOWN. GatewayPill and
 * the Data freshness card honour it. MorningBrief, OutreachBrief and the
 * Settings status hook did not: a vendor outage still printed "F25e OFFLINE",
 * "offline (Twilio fallback active)" and raised a red "gateway offline" alert,
 * blaming a phone nobody had been able to ask about.
 *
 * Each case below pairs the vendor-failure assertion with a control: a phone
 * that really stopped checking in must still read as offline.
 *
 * Also here: the phase 9 survivor. Removing <DataFreshness /> from Intelligence
 * HQ failed no test.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook, screen } from "@testing-library/react";

type Slice = { data: unknown; isLoading: boolean; isError: boolean };
const blank = (): Slice => ({ data: undefined, isLoading: false, isError: false });

const h = vi.hoisted(() => {
  const q = {} as Record<string, { data: unknown; isLoading: boolean; isError: boolean }>;
  const proc = (key: string) => ({ useQuery: () => q[key] ?? { data: undefined, isLoading: false, isError: false } });
  return { q, proc };
});


vi.mock("@/lib/trpc", () => ({
  trpc: {
    adminDashboard: { stats: h.proc("adminDashboard.stats") },
    vapi: { recentCalls: h.proc("vapi.recentCalls"), status: h.proc("vapi.status") },
    sms: { gatewayHealth: h.proc("sms.gatewayHealth"), status: h.proc("sms.status") },
    reviewRequests: { stats: h.proc("reviewRequests.stats") },
    campaigns: { stats: h.proc("campaigns.stats") },
    shopdriver: { declinedRecoveryStatus: h.proc("shopdriver.declinedRecoveryStatus") },
    featureFlags: { list: h.proc("featureFlags.list") },
    trafficFunnel: { overview: h.proc("trafficFunnel.overview") },
    autoLabor: { status: h.proc("autoLabor.status") },
    nickActions: { cronHealth: h.proc("nickActions.cronHealth") },
    lot: { health: h.proc("lot.health") },
    intelligence: {
      masterReport: h.proc("intelligence.masterReport"),
      recentDecisions: h.proc("intelligence.recentDecisions"),
    },
  },
}));

// Intelligence HQ's children are stubbed: the mount test is about the parent
// rendering the Data freshness card, not about each card's own queries.
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("../pages/admin/today/DataFreshness", () => ({ DataFreshness: () => <div data-testid="data-freshness-card" /> }));
vi.mock("../pages/admin/today/LaneHealthStrip", () => ({ LaneHealthStrip: () => <div data-testid="lane-health-card" /> }));
vi.mock("../pages/admin/today/TopMoneyMoves", () => ({ TopMoneyMoves: () => null }));
vi.mock("../pages/admin/today/TodaysMoneyRisks", () => ({ TodaysMoneyRisks: () => null }));
vi.mock("../pages/admin/today/TodaysRealNumbers", () => ({ TodaysRealNumbers: () => null }));
vi.mock("../pages/admin/today/NextBestActions", () => ({ NextBestActions: () => null }));
vi.mock("../pages/admin/intelligence/AIHealthPanel", () => ({ AIHealthPanel: () => null }));
vi.mock("../pages/admin/intelligence/LlmSpendPanel", () => ({ LlmSpendPanel: () => null }));
vi.mock("../pages/admin/intelligence/CustomerIntelligence", () => ({ CustomerIntelligence: () => null }));
vi.mock("../pages/admin/intelligence/LeadSLAMonitor", () => ({ LeadSLAMonitor: () => null }));
vi.mock("../pages/admin/intelligence/MarketIntelligence", () => ({ MarketIntelligence: () => null }));
vi.mock("../pages/admin/intelligence/ContentWarRoom", () => ({ ContentWarRoom: () => null }));

import { gatewayState } from "../lib/gatewayState";
import { MorningBrief } from "../pages/admin/today/MorningBrief";
import { OutreachBrief } from "../pages/admin/outreach/OutreachBrief";
import { useSettingsStatus } from "../pages/admin/settings/useSettingsStatus";
import SettingsStatusTab from "../pages/admin/settings/SettingsStatusTab";
import IntelligenceHQSection from "../pages/admin/intelligence/IntelligenceHQSection";

const set = (key: string, data: unknown, isError = false) => {
  h.q[key] = { ...blank(), data, isError };
};

afterEach(() => {
  cleanup();
  for (const k of Object.keys(h.q)) delete h.q[k];
});

/** What sms.gatewayHealth returns when Capevace answered 503 (services.ts). */
const VENDOR_DOWN = { configured: true, readable: false, online: false, lastSeen: null, deviceName: null, error: "Capevace /device returned 503" };
/** A phone that really stopped checking in: the API answered, the phone is stale. */
const PHONE_SILENT = { configured: true, readable: true, online: false, lastSeen: "2026-10-01T10:00:00Z", ageMinutes: 300, deviceName: "F25e", deviceId: "d1" };
const PHONE_LIVE = { configured: true, readable: true, online: true, lastSeen: "2026-10-01T14:58:00Z", ageMinutes: 2, deviceName: "F25e", deviceId: "d1" };

describe("gatewayState", () => {
  it("names the five states and never turns a failed read into offline", () => {
    expect(gatewayState(VENDOR_DOWN)).toBe("unknown");
    expect(gatewayState(undefined, true)).toBe("unknown");
    expect(gatewayState(undefined)).toBe("checking");
    expect(gatewayState({ configured: false, online: false, readable: true })).toBe("not_configured");
    expect(gatewayState(PHONE_SILENT)).toBe("offline");
    expect(gatewayState(PHONE_LIVE)).toBe("online");
  });

  it("a failed background refetch keeps the last good read instead of flipping to unknown", () => {
    expect(gatewayState(PHONE_LIVE, true)).toBe("online");
    expect(gatewayState(PHONE_SILENT, true)).toBe("offline");
    expect(gatewayState(VENDOR_DOWN, true)).toBe("unknown");
  });

  it("a payload from before phase 9 (no readable field) keeps its online value", () => {
    expect(gatewayState({ configured: true, online: false })).toBe("offline");
    expect(gatewayState({ configured: true, online: true })).toBe("online");
  });
});

describe("MorningBrief", () => {
  const recentCall = { startedAt: new Date().toISOString(), structuredData: { outcome: "booked" } };

  it("a vendor failure after a night with calls says 'status unknown', not OFFLINE", () => {
    set("sms.gatewayHealth", VENDOR_DOWN);
    set("vapi.recentCalls", { calls: [recentCall] });
    const { container } = render(<MorningBrief priorityQueueLength={0} urgentLeads={0} />);
    expect(container.textContent).toMatch(/F25e status unknown/);
    expect(container.textContent).not.toMatch(/OFFLINE/);
  });

  it("a vendor failure on a quiet night is said, not hidden and not OFFLINE", () => {
    set("sms.gatewayHealth", VENDOR_DOWN);
    set("vapi.recentCalls", { calls: [] });
    const { container } = render(<MorningBrief priorityQueueLength={0} urgentLeads={0} />);
    expect(container.textContent).toMatch(/gateway status unknown/i);
    expect(container.textContent).not.toMatch(/OFFLINE/);
  });

  it("control: a silent phone on a quiet night still reads OFFLINE", () => {
    set("sms.gatewayHealth", PHONE_SILENT);
    set("vapi.recentCalls", { calls: [] });
    const { container } = render(<MorningBrief priorityQueueLength={0} urgentLeads={0} />);
    expect(container.textContent).toMatch(/F25e SMS gateway OFFLINE/);
  });

  it("control: a live phone after a night with calls reads live", () => {
    set("sms.gatewayHealth", PHONE_LIVE);
    set("vapi.recentCalls", { calls: [recentCall] });
    const { container } = render(<MorningBrief priorityQueueLength={0} urgentLeads={0} />);
    expect(container.textContent).toMatch(/F25e live/);
  });
});

describe("OutreachBrief", () => {
  const loadOutreach = () => {
    set("reviewRequests.stats", { pending: 0, sent: 3 });
    set("campaigns.stats", { activeCampaigns: 0, totalCampaigns: 0, totalSent: 0 });
    set("shopdriver.declinedRecoveryStatus", { dryRun: false, recoverableDollars: 0, eligible: 0 });
  };

  it("a vendor failure says the gateway status is unknown, not offline", () => {
    loadOutreach();
    set("sms.gatewayHealth", VENDOR_DOWN);
    const { container } = render(<OutreachBrief onRecoveryAction={() => {}} />);
    expect(container.textContent).toMatch(/F25e shop gateway status unknown/);
    expect(container.textContent).not.toMatch(/offline/i);
  });

  it("a failed gateway query says unknown, not offline", () => {
    loadOutreach();
    set("sms.gatewayHealth", undefined, true);
    const { container } = render(<OutreachBrief onRecoveryAction={() => {}} />);
    expect(container.textContent).toMatch(/status unknown/);
    expect(container.textContent).not.toMatch(/offline/i);
  });

  it("control: a silent phone still reads offline", () => {
    loadOutreach();
    set("sms.gatewayHealth", PHONE_SILENT);
    const { container } = render(<OutreachBrief onRecoveryAction={() => {}} />);
    expect(container.textContent).toMatch(/F25e shop gateway offline/);
  });
});

describe("useSettingsStatus", () => {
  const configured = () => set("sms.status", { shopGateway: { configured: true } });

  it("a vendor failure is a check that could not run, not a red 'gateway offline' alert", () => {
    configured();
    set("sms.gatewayHealth", VENDOR_DOWN);
    const { result } = renderHook(() => useSettingsStatus());
    expect(result.current.openIssues.map((i) => i.key)).not.toContain("f25e-offline");
    expect(result.current.failedChecks).toContain("SMS gateway health");
    // Same check, so the "N of 8 checks could not run" banner still counts it once.
    expect(result.current.failedChecks.filter((c) => /SMS gateway/.test(c))).toHaveLength(1);
  });

  it("control: a silent phone still raises the offline alert and is not a failed check", () => {
    configured();
    set("sms.gatewayHealth", PHONE_SILENT);
    const { result } = renderHook(() => useSettingsStatus());
    expect(result.current.openIssues.map((i) => i.key)).toContain("f25e-offline");
    expect(result.current.failedChecks).not.toContain("SMS gateway health");
  });

  // 2026-10-02 · the tab said "All clear" while the sign camera was CAMERA_OFFLINE.
  it("an offline commissioned camera is an open alert, so 'All clear' cannot render", () => {
    set("lot.health", {
      ok: true,
      cameras: [
        { camera: "sign", label: "Shop sign", state: "CAMERA_OFFLINE", commissioned: true, registered: true, conversation: null },
        { camera: "inside", label: "Inside", state: "NEVER_INGESTED", commissioned: false, registered: true, conversation: null },
      ],
    });
    const { result } = renderHook(() => useSettingsStatus());
    const cams = result.current.openIssues.filter((i) => i.key.startsWith("camera-"));
    expect(cams.map((i) => [i.key, i.severity])).toEqual([["camera-sign", "alert"]]);
  });

  it("an unreadable camera health is a check that could not run, never 'cameras fine'", () => {
    set("lot.health", { ok: false, reason: "camera_runtime health read failed" });
    const { result } = renderHook(() => useSettingsStatus());
    expect(result.current.failedChecks).toContain("camera health");
    expect(result.current.openIssues.some((i) => i.key.startsWith("camera-"))).toBe(false);
  });
});

describe("SettingsStatusTab connection pill", () => {
  it("a vendor failure reads 'status unknown', not 'offline · check device'", () => {
    set("sms.status", { shopGateway: { configured: true } });
    set("sms.gatewayHealth", VENDOR_DOWN);
    const { container } = render(<SettingsStatusTab />);
    expect(container.textContent).toMatch(/status unknown · the gateway service did not answer/);
    expect(container.textContent).not.toMatch(/offline · check device/);
  });

  it("control: a silent phone still reads 'offline · check device'", () => {
    set("sms.status", { shopGateway: { configured: true } });
    set("sms.gatewayHealth", PHONE_SILENT);
    const { container } = render(<SettingsStatusTab />);
    expect(container.textContent).toMatch(/offline · check device/);
  });
});

describe("Intelligence HQ", () => {
  it("mounts the Data freshness card on the default Battlefield tab", () => {
    render(<IntelligenceHQSection />);
    expect(screen.getByTestId("data-freshness-card")).toBeTruthy();
  });
});
