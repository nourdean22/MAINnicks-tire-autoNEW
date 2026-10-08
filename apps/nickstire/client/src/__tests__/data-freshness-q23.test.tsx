/**
 * Q-23 phase 9 · Intelligence HQ says how old its inputs are.
 *
 * Estate plan §9 item 4: last ShopDriver sync and SMS channel status, next to
 * the money numbers they feed. The "Data freshness" card reads three existing
 * queries. What it must never do is the failure this whole arc removes: draw a
 * failed read as healthy, or as the device being down.
 *
 * GatewayPill is here too: it showed "Gateway offline" whenever its query or
 * the vendor API failed, on every Outreach tab and on Tire Orders.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const q = () => ({ data: undefined as unknown, isLoading: false, isError: false });
const h = vi.hoisted(() => ({
  probe: { data: undefined as unknown, isLoading: false, isError: false },
  pulse: { data: undefined as unknown, isLoading: false, isError: false },
  gateway: { data: undefined as unknown, isLoading: false, isError: false },
  smsStatus: { data: undefined as unknown, isLoading: false, isError: false },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    adminSecurity: { integrationFreshness: { useQuery: () => h.probe } },
    controlCenter: { todayPulse: { useQuery: () => h.pulse } },
    sms: {
      gatewayHealth: { useQuery: () => h.gateway },
      status: { useQuery: () => h.smsStatus },
    },
    // Q-50 phase 3's NHTSA row, held loading so it is quiet; its cases are in data-freshness-nhtsa-q50.test.tsx.
    vehicleData: { warrantyIngestFreshness: { useQuery: () => ({ data: undefined, isLoading: true, isError: false }) } },
  },
}));

import { DataFreshness } from "../pages/admin/today/DataFreshness";
import GatewayPill from "../components/admin/GatewayPill";
import {
  invoiceMirrorRow,
  shopDriverRow,
  smsGatewayRow,
} from "../pages/admin/today/freshnessRows";

afterEach(() => {
  cleanup();
  Object.assign(h.probe, q());
  Object.assign(h.pulse, q());
  Object.assign(h.gateway, q());
  Object.assign(h.smsStatus, q());
});

const NOW = new Date("2026-10-01T15:00:00Z");
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

describe("shopDriverRow", () => {
  it("a recent successful probe is fresh and MEASURED", () => {
    const r = shopDriverRow({ data: { readable: true, connected: true, lastSuccessfulAt: minsAgo(12) }, isError: false }, NOW);
    expect(r.provenance).toBe("MEASURED");
    expect(r.loud).toBe(false);
    expect(r.status).toMatch(/fresh/i);
  });

  it("a failed query is UNMEASURED 'unknown', never fresh or down", () => {
    const r = shopDriverRow({ data: undefined, isError: true }, NOW);
    expect(r.provenance).toBe("UNMEASURED");
    expect(r.status).toBe("unknown");
    expect(r.loud).toBe(true);
  });

  it("an unreadable probe log is UNMEASURED, not 'never connected'", () => {
    const r = shopDriverRow({ data: { readable: false, connected: null }, isError: false }, NOW);
    expect(r.provenance).toBe("UNMEASURED");
    expect(r.status).toBe("unknown");
  });

  it("live auth failures outrank a recent success", () => {
    const r = shopDriverRow({
      data: { readable: true, connected: true, lastSuccessfulAt: minsAgo(5), failuresSinceLastSuccess: 3, lastAttemptOutcome: "auth_failed" },
      isError: false,
    }, NOW);
    expect(r.status).toMatch(/auth failing/i);
    expect(r.loud).toBe(true);
    expect(r.provenance).toBe("MEASURED");
  });

  it("no success in 24h is stale and loud", () => {
    const r = shopDriverRow({ data: { readable: true, connected: true, lastSuccessfulAt: minsAgo(26 * 60) }, isError: false }, NOW);
    expect(r.status).toMatch(/stale/i);
    expect(r.loud).toBe(true);
  });

  it("no successful login ever is 'never connected'", () => {
    const r = shopDriverRow({ data: { readable: true, connected: false }, isError: false }, NOW);
    expect(r.status).toBe("never connected");
    expect(r.loud).toBe(true);
  });

  it("while loading there is no tag and no claim", () => {
    const r = shopDriverRow({ data: undefined, isError: false }, NOW);
    expect(r.provenance).toBeNull();
    expect(r.loud).toBe(false);
  });
});

describe("invoiceMirrorRow", () => {
  const pulse = (throughDate: Date | string | null) => ({ available: true as const, revenue: { throughDate } });

  it("through yesterday is normal and quiet", () => {
    const r = invoiceMirrorRow({ data: pulse(new Date(NOW.getTime() - 30 * 3_600_000)), isError: false }, NOW);
    expect(r.status).toBe("through yesterday");
    expect(r.loud).toBe(false);
    expect(r.provenance).toBe("MEASURED");
  });

  it("five days behind is loud and says revenue is understated", () => {
    const r = invoiceMirrorRow({ data: pulse(new Date(NOW.getTime() - 5 * 86_400_000)), isError: false }, NOW);
    expect(r.status).toBe("5 days behind");
    expect(r.loud).toBe(true);
    expect(r.detail).toMatch(/understated/);
  });

  it("an unavailable pulse is UNMEASURED, not 'no invoices synced'", () => {
    const r = invoiceMirrorRow({ data: { available: false }, isError: false }, NOW);
    expect(r.provenance).toBe("UNMEASURED");
    expect(r.status).toBe("unknown");
  });

  it("a failed query is UNMEASURED", () => {
    const r = invoiceMirrorRow({ data: undefined, isError: true }, NOW);
    expect(r.provenance).toBe("UNMEASURED");
  });

  it("a read that found no invoice is a measured, loud finding", () => {
    const r = invoiceMirrorRow({ data: pulse(null), isError: false }, NOW);
    expect(r.status).toBe("no invoices synced");
    expect(r.provenance).toBe("MEASURED");
    expect(r.loud).toBe(true);
  });

  it("an ISO string date is accepted; an invalid one is UNMEASURED", () => {
    expect(invoiceMirrorRow({ data: pulse(NOW.toISOString()), isError: false }, NOW).status).toBe("current");
    expect(invoiceMirrorRow({ data: pulse("not a date"), isError: false }, NOW).provenance).toBe("UNMEASURED");
  });
});

describe("smsGatewayRow", () => {
  it("online is quiet and MEASURED, with the check-in age", () => {
    const r = smsGatewayRow({ data: { configured: true, readable: true, online: true, lastSeen: minsAgo(12), ageMinutes: 12 }, isError: false });
    expect(r.status).toBe("online · seen 12m ago");
    expect(r.loud).toBe(false);
    expect(r.provenance).toBe("MEASURED");
  });

  it("a vendor API failure is UNMEASURED 'unknown', not offline", () => {
    const r = smsGatewayRow({ data: { configured: true, readable: false, online: false, lastSeen: null, error: "Capevace /device returned 503" }, isError: false });
    expect(r.provenance).toBe("UNMEASURED");
    expect(r.status).toBe("unknown");
    expect(r.status).not.toMatch(/offline/);
    expect(r.detail).toContain("503");
  });

  it("a failed query is UNMEASURED 'unknown', not offline", () => {
    const r = smsGatewayRow({ data: undefined, isError: true });
    expect(r.provenance).toBe("UNMEASURED");
    expect(r.status).toBe("unknown");
  });

  it("a phone that stopped checking in is offline, MEASURED and loud", () => {
    const r = smsGatewayRow({ data: { configured: true, readable: true, online: false, lastSeen: minsAgo(180), ageMinutes: 180 }, isError: false });
    expect(r.status).toBe("offline · seen 3h ago");
    expect(r.provenance).toBe("MEASURED");
    expect(r.loud).toBe(true);
  });

  it("no device registered is offline with the reason", () => {
    const r = smsGatewayRow({ data: { configured: true, readable: true, online: false, lastSeen: null, error: "No devices registered" }, isError: false });
    expect(r.status).toBe("offline");
    expect(r.detail).toBe("No devices registered");
  });

  it("a gateway quiet for 3 days reads in days", () => {
    const r = smsGatewayRow({ data: { configured: true, readable: true, online: false, lastSeen: minsAgo(3 * 24 * 60), ageMinutes: 3 * 24 * 60 }, isError: false });
    expect(r.status).toBe("offline · seen 3d ago");
  });

  it("not configured is loud", () => {
    const r = smsGatewayRow({ data: { configured: false, readable: true, online: false }, isError: false });
    expect(r.status).toBe("not configured");
    expect(r.loud).toBe(true);
  });
});

const rowTag = (c: HTMLElement, key: string) =>
  c.querySelector(`[data-freshness-row="${key}"] [data-provenance]`)?.getAttribute("data-provenance") ?? null;
const rowText = (c: HTMLElement, key: string) =>
  c.querySelector(`[data-freshness-row="${key}"]`)?.textContent ?? "";

describe("DataFreshness card", () => {
  it("renders all three rows even when every read failed", () => {
    h.probe.isError = true;
    h.pulse.isError = true;
    h.gateway.isError = true;
    const { container } = render(<DataFreshness />);
    for (const key of ["shopdriver", "invoices", "sms"]) {
      expect(rowTag(container, key)).toBe("UNMEASURED");
      expect(rowText(container, key)).toMatch(/unknown/);
    }
    expect(container.querySelector("[data-freshness-summary]")?.textContent).toBe("3 need a look");
  });

  it("healthy inputs render quiet and MEASURED with no summary", () => {
    h.probe.data = { readable: true, connected: true, lastSuccessfulAt: new Date(Date.now() - 10 * 60_000).toISOString() };
    h.pulse.data = { available: true, revenue: { throughDate: new Date() } };
    h.gateway.data = { configured: true, readable: true, online: true, lastSeen: new Date().toISOString(), ageMinutes: 3 };
    const { container } = render(<DataFreshness />);
    expect(rowTag(container, "shopdriver")).toBe("MEASURED");
    expect(rowTag(container, "invoices")).toBe("MEASURED");
    expect(rowTag(container, "sms")).toBe("MEASURED");
    expect(rowText(container, "sms")).toContain("online");
    expect(container.querySelector("[data-freshness-summary]")).toBeNull();
  });

  it("while loading, rows say 'checking' and carry no tag", () => {
    const { container } = render(<DataFreshness />);
    expect(rowText(container, "sms")).toContain("checking");
    expect(rowTag(container, "sms")).toBeNull();
  });
});

describe("GatewayPill", () => {
  it("a vendor read failure says 'status unknown', not offline", () => {
    h.smsStatus.data = { shopGateway: { configured: true } };
    h.gateway.data = { configured: true, readable: false, online: false, lastSeen: null, error: "Capevace /device returned 503" };
    const { container } = render(<GatewayPill />);
    expect(container.textContent).toContain("Gateway status unknown");
    expect(container.textContent).not.toContain("Gateway offline");
  });

  it("a failed query says 'status unknown', not offline", () => {
    h.smsStatus.data = { shopGateway: { configured: true } };
    h.gateway.isError = true;
    const { container } = render(<GatewayPill />);
    expect(container.textContent).toContain("Gateway status unknown");
  });

  it("a phone that stopped checking in still says offline", () => {
    h.smsStatus.data = { shopGateway: { configured: true } };
    h.gateway.data = { configured: true, readable: true, online: false, lastSeen: new Date().toISOString(), ageMinutes: 90 };
    const { container } = render(<GatewayPill />);
    expect(container.textContent).toContain("Gateway offline");
  });

  it("online says Live", () => {
    h.smsStatus.data = { shopGateway: { configured: true } };
    h.gateway.data = { configured: true, readable: true, online: true, lastSeen: new Date().toISOString(), ageMinutes: 2 };
    const { container } = render(<GatewayPill />);
    expect(container.textContent).toContain("Live");
  });
});
