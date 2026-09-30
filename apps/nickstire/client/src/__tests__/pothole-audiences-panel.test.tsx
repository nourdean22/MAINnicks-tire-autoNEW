/**
 * Q-53 · Ad Studio "Pothole Map" panel. A failed 311 read must render as an
 * error, never as "no potholes"; a real answer renders ranked wards with the
 * ODbL notice and a copy-only draft (no post/launch control).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

type Q = { data: unknown; isLoading: boolean; error: { message: string } | null; refetch: () => void };

const h = vi.hoisted(() => ({
  q: { data: undefined, isLoading: false, error: null, refetch: () => {} } as Q,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: { adStudio: { potholeAudiences: { useQuery: () => h.q } } },
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { PotholeAudiences } from "@/components/admin/PotholeAudiences";

const ATTRIBUTION =
  "Contains information from City of Cleveland 311 Service Requests, made available under the Open Database License (ODbL).";

const ward = (n: number, requests: number) => ({
  ward: n,
  wardName: `Ward ${n}`,
  requests,
  priorRequests: 2,
  change: requests - 2,
  neighborhoods: [{ name: "Glenville", requests }],
  center: { lat: 41.53, lng: -81.6 },
  milesFromShop: n === 15 ? 15.6 : 3.4,
  inServiceArea: n !== 15,
  latestRequestAt: "2026-09-29T00:00:00.000Z",
  draft: {
    headline: `Hit a pothole around Glenville?`,
    body: `Cleveland 311 logged ${requests} pothole repair requests in Ward ${n} in the last 30 days.`,
    targeting: `1 mi radius around 41.5300, -81.6000 (Ward ${n})`,
    attribution: ATTRIBUTION,
  },
});

const report = {
  status: "draft",
  generatedAt: "2026-09-30T00:00:00.000Z",
  window: { from: "2026-08-31T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z", days: 30 },
  priorWindow: { from: "2026-08-01T00:00:00.000Z", to: "2026-08-31T00:00:00.000Z" },
  totalRequests: 20,
  priorTotalRequests: 4,
  unassignedRequests: 1,
  wards: [ward(9, 12), ward(8, 7), ward(15, 16)],
  source: {
    url: "https://www.arcgis.com/home/item.html?id=7ed7b5f316fc40e99b10dbcffde4ebbe",
    license: "ODbL-1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    attribution: ATTRIBUTION,
  },
};

describe("PotholeAudiences panel", () => {
  beforeEach(() => {
    h.q = { data: undefined, isLoading: false, error: null, refetch: () => {} };
  });

  it("renders a failed read as an error, not as an empty list", () => {
    h.q = { ...h.q, error: { message: "Cleveland 311 data could not be read right now." } };
    render(<PotholeAudiences days={30} onDaysChange={() => {}} />);
    expect(screen.getByText("Cleveland 311 could not be read")).toBeTruthy();
    expect(screen.queryByText(/logged no pothole requests/)).toBeNull();
    expect(screen.queryByText(/Ward 9/)).toBeNull();
  });

  it("renders ranked wards, the unassigned count, the ODbL notice and copy-only drafts", () => {
    h.q = { ...h.q, data: report };
    render(<PotholeAudiences days={30} onDaysChange={() => {}} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain("Ward 9 · 12 requests");
    expect(items[1].textContent).toContain("Ward 8 · 7 requests");
    expect(items[2].textContent).toContain("outside the service area");
    expect(items[0].textContent).not.toContain("outside the service area");
    expect(screen.getByText(/20 requests in the last 30 days \(previous 30: 4\) · 1 with no ward/)).toBeTruthy();
    expect(screen.getByText(new RegExp(ATTRIBUTION.replace(/[()]/g, "\\$&")))).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy Ward 9 ad draft" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /post|launch|publish|schedule/i })).toBeNull();
  });

  it("says so plainly when 311 answered with zero requests", () => {
    h.q = { ...h.q, data: { ...report, totalRequests: 0, unassignedRequests: 0, wards: [] } };
    render(<PotholeAudiences days={30} onDaysChange={() => {}} />);
    expect(screen.getByText(/answered, and logged no pothole requests/)).toBeTruthy();
  });
});
