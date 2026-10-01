/**
 * Q-23 phase 11 · the "Customer lanes" card on Intelligence HQ.
 *
 * A failed query must be one "unknown" line, never eight lanes that read
 * "no run in 7d" and "0 sent". And Intelligence HQ must actually mount the card:
 * phase 9's first review found a card no test noticed missing.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  lane: { data: undefined as unknown, isLoading: false, isError: false },
  blank: { data: undefined as unknown, isLoading: false, isError: false },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    smsPerformance: { laneHealth: { useQuery: () => h.lane } },
    intelligence: {
      masterReport: { useQuery: () => h.blank },
      recentDecisions: { useQuery: () => h.blank },
    },
  },
}));

vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("../pages/admin/today/DataFreshness", () => ({ DataFreshness: () => null }));
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

import { LaneHealthStrip } from "../pages/admin/today/LaneHealthStrip";
import IntelligenceHQSection from "../pages/admin/intelligence/IntelligenceHQSection";
import { CUSTOMER_LANES } from "@shared/laneHealth";

afterEach(() => {
  cleanup();
  Object.assign(h.lane, { data: undefined, isLoading: false, isError: false });
});

const readable = {
  windowDays: 30,
  cron: {
    readable: true,
    runs: {
      "winback-auto-process": {
        latest: { status: "completed", startedAt: new Date().toISOString(), recordsProcessed: 2, details: "sent 2 of 2 pending", ageMinutes: 30 },
        latestCompleted: { status: "completed", startedAt: new Date().toISOString(), recordsProcessed: 2, details: null, ageMinutes: 30 },
      },
      "weather-intel": {
        latest: { status: "skipped", startedAt: new Date().toISOString(), recordsProcessed: 0, details: "requiresFlag:FEATURE_WEATHER (not set)", ageMinutes: 10 },
        latestCompleted: null,
      },
    },
  },
  sms: { readable: true, byVariant: [{ variantKey: "winback", attempted: 2, sent: 2 }] },
  holdout: { state: "read", byLane: [] },
  holdoutArmed: { winback: false },
};

describe("LaneHealthStrip", () => {
  it("a failed query is one 'unknown' line, not a list of idle lanes", () => {
    h.lane.isError = true;
    const { container } = render(<LaneHealthStrip />);
    expect(container.querySelector("[data-lane-health-error]")?.textContent).toMatch(/unknown, not idle/);
    expect(container.querySelector("[data-lane-health-error] [data-provenance]")?.getAttribute("data-provenance")).toBe("UNMEASURED");
    expect(container.querySelectorAll("[data-lane-row]")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/no run in 7d|0 in 30d/);
  });

  it("control: a readable payload draws one row per lane with its state and blocked reason", () => {
    h.lane.data = readable;
    const { container } = render(<LaneHealthStrip />);
    expect(container.querySelectorAll("[data-lane-row]")).toHaveLength(CUSTOMER_LANES.length);
    const winback = container.querySelector('[data-lane-row="winback"]')!;
    expect(winback.getAttribute("data-lane-state")).toBe("running");
    expect(winback.textContent).toMatch(/30m ago · processed 2/);
    expect(winback.textContent).toMatch(/holdout not armed/);
    expect(winback.querySelector("[data-lane-note]")?.textContent).toBe("last run said: sent 2 of 2 pending");
    const weather = container.querySelector('[data-lane-row="weather"]')!;
    expect(weather.getAttribute("data-lane-state")).toBe("blocked");
    expect(weather.querySelector("[data-lane-blocked]")?.textContent).toBe("flag FEATURE_WEATHER off (not set)");
    expect(container.querySelector("[data-lane-summary]")?.textContent).toBe(`${CUSTOMER_LANES.length - 1} need a look`);
  });

  it("while loading it claims nothing", () => {
    const { container } = render(<LaneHealthStrip />);
    expect(container.textContent).toMatch(/checking/);
    expect(container.querySelector("[data-provenance]")).toBeNull();
  });
});

describe("Intelligence HQ", () => {
  it("mounts the Customer lanes card on the default Battlefield tab", () => {
    h.lane.isError = true;
    render(<IntelligenceHQSection />);
    expect(document.querySelector('[data-card="lane-health"]')).toBeTruthy();
    expect(screen.getByText(/Customer lanes/i)).toBeTruthy();
  });
});
