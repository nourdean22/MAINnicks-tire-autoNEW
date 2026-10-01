/**
 * NHTSA panel (Q-50): a failed lookup must never paint as "no recalls", park-it recalls must be
 * visible, complaint counts must be framed as unverified, and an incomplete vehicle must not query.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: { message: string } | null; refetch: () => void };

const h = vi.hoisted(() => ({
  recalls: { data: undefined, isLoading: false, isError: false, error: null, refetch: () => {} } as Q,
  complaints: { data: undefined, isLoading: false, isError: false, error: null, refetch: () => {} } as Q,
  enabled: [] as boolean[],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    vehicleData: {
      recalls: { useQuery: (_i: unknown, o: { enabled: boolean }) => { h.enabled.push(o.enabled); return h.recalls; } },
      complaints: { useQuery: (_i: unknown, o: { enabled: boolean }) => { h.enabled.push(o.enabled); return h.complaints; } },
      // Q-50 phase 2b added a third query; a fresh, empty program list keeps these cases about recalls and complaints.
      warrantyExtensions: {
        useQuery: (_i: unknown, o: { enabled: boolean }) => {
          h.enabled.push(o.enabled);
          return {
            data: {
              ok: true, source: "NHTSA", year: "2018", make: "HONDA", model: "Accord", aliased: false,
              freshness: { lastSuccessAt: "2026-10-01T13:40:00.000Z", stale: false },
              matchCount: 0, matches: [], truncated: false, disclaimer: "Confirm with a dealer.",
            },
            isLoading: false, isError: false, error: null, refetch: () => {},
          };
        },
      },
    },
  },
}));

import NhtsaVehiclePanel from "@/pages/admin/money/NhtsaVehiclePanel";

const ok = (data: unknown): Q => ({ data, isLoading: false, isError: false, error: null, refetch: () => {} });
const car = { year: "2018", make: "HONDA", model: "Accord" };
const recallPayload = (recalls: unknown[], recallCount = recalls.length) => ({
  ok: true, source: "NHTSA", fetchedAt: "x", year: "2018", make: "HONDA", model: "Accord",
  recallCount, recalls, disclaimer: "Recall awareness only - not a diagnosis.",
});
const complaintPayload = {
  ok: true, source: "NHTSA", fetchedAt: "x", year: "2018", make: "HONDA", model: "Accord",
  complaintCount: 1882, crashCount: 12, fireCount: 3, injuryCount: 9,
  topComponents: [{ component: "ENGINE", count: 400 }],
  disclaimer: "Owner complaints are unverified reports filed with NHTSA - a pattern to ask about, not a diagnosis or a defect finding.",
};

describe("NhtsaVehiclePanel", () => {
  it("queries with a numeric year from the work order (DB rows may carry year as a number)", () => {
    h.recalls = ok(recallPayload([]));
    h.complaints = ok({ ...complaintPayload, complaintCount: 0, crashCount: 0, fireCount: 0, injuryCount: 0, topComponents: [] });
    h.enabled = [];
    render(<NhtsaVehiclePanel vehicle={{ year: 2018, make: " Ford ", model: "F-150" }} />);
    expect(h.enabled.length).toBeGreaterThan(0);
    expect(h.enabled.every((e) => e === true)).toBe(true);
    expect(screen.getByText(/No recall campaigns on file for 2018 Ford F-150/)).toBeTruthy();
  });

  beforeEach(() => { h.enabled = []; });

  it("an upstream failure returned as a value renders unavailable with retry — never 'no recalls'", () => {
    h.recalls = ok({ ok: false, error: "NHTSA 503", source: "NHTSA" });
    h.complaints = { data: undefined, isLoading: false, isError: true, error: { message: "timeout" }, refetch: () => {} };
    render(<NhtsaVehiclePanel vehicle={car} />);
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(2);
    expect(alerts[0].textContent).toMatch(/NOT the same as "none on file".*NHTSA 503/);
    expect(screen.getAllByRole("button", { name: /retry/i })).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/No recall campaigns|No owner complaints/);
  });

  it("shows park-it recalls and complaint counts as information", () => {
    h.recalls = ok(recallPayload([
      { campaign: "20V314000", component: "FUEL PUMP", summary: "may fail", reportedDate: "28/05/2020", remedy: "replace pump", parkIt: true, parkOutside: false },
    ], 6));
    h.complaints = ok(complaintPayload);
    render(<NhtsaVehiclePanel vehicle={car} />);
    expect(screen.getByText(/6 recall campaigns for 2018 HONDA Accord/)).toBeTruthy();
    expect(screen.getByText(/newest 1 shown/)).toBeTruthy();
    expect(screen.getByText(/do not drive until repaired/)).toBeTruthy();
    expect(screen.getByText(/1,882 owner complaints filed/)).toBeTruthy();
    expect(screen.getByText(/ENGINE · 400/)).toBeTruthy();
    expect(screen.getByText(/unverified reports/)).toBeTruthy();
    // Information, not a sales claim (Q-46 wording rule).
    expect(document.body.textContent).not.toMatch(/dangerous|necessary/i);
  });

  it("a confirmed empty result says so plainly", () => {
    h.recalls = ok(recallPayload([]));
    h.complaints = ok({ ...complaintPayload, complaintCount: 0, crashCount: 0, fireCount: 0, injuryCount: 0, topComponents: [] });
    render(<NhtsaVehiclePanel vehicle={car} />);
    expect(screen.getByText(/No recall campaigns on file for 2018 HONDA Accord/)).toBeTruthy();
    expect(screen.getByText(/No owner complaints on file/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not query NHTSA without a 4-digit year, make and model", () => {
    render(<NhtsaVehiclePanel vehicle={{ year: "18", make: "Honda", model: "" }} />);
    expect(h.enabled.every((e) => e === false)).toBe(true);
    expect(screen.getByText(/Add the 4-digit year, make and model/)).toBeTruthy();
  });
});
