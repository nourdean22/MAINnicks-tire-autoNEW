/**
 * NHTSA panel, Q-50 phase 2b (ADR-0021 §7, §9 2b): the manufacturer-program block's three §7.3
 * states, the related-model label, the always-on eligibility footer, no coverage wording, a name
 * NHTSA does not know, and phase 1's two untested panel cases (park-outside badge, a complaints
 * `{ ok: false }` value).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: { message: string } | null; refetch: () => void };
const ok = (data: unknown): Q => ({ data, isLoading: false, isError: false, error: null, refetch: () => {} });

const h = vi.hoisted(() => ({
  recalls: undefined as unknown as Q,
  complaints: undefined as unknown as Q,
  warranty: undefined as unknown as Q,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    vehicleData: {
      recalls: { useQuery: () => h.recalls },
      complaints: { useQuery: () => h.complaints },
      warrantyExtensions: { useQuery: () => h.warranty },
    },
  },
}));

import NhtsaVehiclePanel from "@/pages/admin/money/NhtsaVehiclePanel";

const car = { year: "2015", make: "Chevy", model: "Silverado" };
const recallsEmpty = { ok: true, source: "NHTSA", fetchedAt: "x", year: "2015", make: "CHEVROLET", model: "Silverado", aliased: true, recallCount: 0, recalls: [], disclaimer: "Recall awareness only." };
const complaintsEmpty = { ok: true, source: "NHTSA", fetchedAt: "x", year: "2015", make: "CHEVROLET", model: "Silverado", aliased: true, complaintCount: 0, crashCount: 0, fireCount: 0, injuryCount: 0, topComponents: [], disclaimer: "Unverified reports." };
const FOOTER = "Eligibility depends on VIN, mileage, in-service date and sometimes state. Confirm with a dealer before quoting this repair.";
const warrantyOk = (over: Record<string, unknown> = {}) => ({
  ok: true, source: "NHTSA", year: "2015", make: "CHEVROLET", model: "Silverado", aliased: true,
  freshness: { lastSuccessAt: "2026-10-08T13:52:00.000Z", stale: false },
  matchCount: 0, matches: [], truncated: false, disclaimer: FOOTER, ...over,
});
const program = (over: Record<string, unknown> = {}) => ({
  nhtsaId: 11013460, documentId: "N232400380", signal: "summary_text", mfrDate: "2024-03-01", components: "ENGINE",
  summary: "Special coverage adjustment for the engine thermostat on certain trucks.", match: "exact", nhtsaModels: [], yearStated: true, ...over,
});

beforeEach(() => {
  h.recalls = ok(recallsEmpty);
  h.complaints = ok(complaintsEmpty);
  h.warranty = ok(warrantyOk());
});

const text = () => document.body.textContent ?? "";

describe("manufacturer programs: empty vs error (§7.3)", () => {
  it("an ingest that never finished, a missing table or a thrown read shows unavailable with Retry, never 'none listed'", () => {
    for (const w of [
      ok({ ok: false, source: "NHTSA", reason: "never_ingested", error: "the NHTSA warranty list has not been downloaded yet" }),
      ok({ ok: false, source: "NHTSA", reason: "not_installed", error: "migration 0138_nhtsa_mfr_warranty is not applied" }),
      { data: undefined, isLoading: false, isError: true, error: { message: "timeout" }, refetch: () => {} },
    ]) {
      h.warranty = w;
      const { unmount } = render(<NhtsaVehiclePanel vehicle={car} />);
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/manufacturer program list unavailable — this is NOT the same as "none on file"/);
      expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
      expect(text()).not.toMatch(/None listed by NHTSA/);
      unmount();
    }
  });

  it("a fresh, empty list says none listed, with the update date and the footer", () => {
    render(<NhtsaVehiclePanel vehicle={car} />);
    expect(screen.getByText(/None listed by NHTSA under 2015 CHEVROLET Silverado\./)).toBeTruthy();
    expect(screen.getByText(/NHTSA list last updated Oct 8, 2026\./)).toBeTruthy();
    expect(screen.getByText(FOOTER)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a stale list still shows its programs, and says it may be out of date", () => {
    h.warranty = ok(warrantyOk({ freshness: { lastSuccessAt: "2026-10-01T13:52:00.000Z", stale: true }, matchCount: 1, matches: [program()] }));
    render(<NhtsaVehiclePanel vehicle={car} />);
    expect(screen.getByText(/NHTSA list last updated Oct 1, 2026, may be out of date\./)).toBeTruthy();
    expect(screen.getByText("N232400380")).toBeTruthy();
  });
});

describe("manufacturer programs: what each item says", () => {
  it("labels the signal, a related model and an unstated year, and keeps the footer", () => {
    h.warranty = ok(warrantyOk({
      matchCount: 3,
      matches: [
        program({ nhtsaId: 1, documentId: "TYPED", signal: "nhtsa_type" }),
        program({ nhtsaId: 2, documentId: "RELATED", match: "related", nhtsaModels: ["SILVERADO 1500"] }),
        program({ nhtsaId: 3, documentId: "NOYEAR", yearStated: false }),
      ],
    }));
    render(<NhtsaVehiclePanel vehicle={car} />);
    expect(screen.getByText(/Manufacturer warranty programs \(may apply\)/)).toBeTruthy();
    expect(screen.getByText("NHTSA: warranty program")).toBeTruthy();
    expect(screen.getAllByText("found by summary wording")).toHaveLength(2);
    expect(screen.getByText("listed for SILVERADO 1500")).toBeTruthy();
    expect(screen.getByText("model year not stated by the manufacturer")).toBeTruthy();
    expect(screen.getByText(FOOTER)).toBeTruthy();
  });

  it("never words a program as covered, free or paid for by the manufacturer", () => {
    h.warranty = ok(warrantyOk({ matchCount: 1, matches: [program()], truncated: true }));
    render(<NhtsaVehiclePanel vehicle={car} />);
    expect(text()).not.toMatch(/\bcovered\b|\bfree\b|will pay/i);
    expect(text()).toMatch(/may apply/);
  });

  it("collapses a long summary to two lines until asked, with a 48px target; a short one has no toggle", () => {
    const long = "Special coverage adjustment for the engine thermostat on certain trucks. " + "The thermostat may stick open and the engine may run cold. ".repeat(3);
    h.warranty = ok(warrantyOk({ matchCount: 2, matches: [program({ summary: long }), program({ nhtsaId: 2, documentId: "SHORT", summary: "Short note." })] }));
    render(<NhtsaVehiclePanel vehicle={car} />);
    const summary = screen.getByText(/thermostat on certain trucks/);
    expect(summary.className).toMatch(/line-clamp-2/);
    const toggle = screen.getByRole("button", { name: "Show full summary" });
    expect(toggle.className).toMatch(/min-h-12/);
    fireEvent.click(toggle);
    expect(summary.className).not.toMatch(/line-clamp-2/);
    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("button", { name: /Show (full summary|less)/ })).toHaveLength(1);
    expect(screen.getByText("Short note.").className).not.toMatch(/line-clamp/);
  });

  it("says when more programs exist than are shown, and when the list may be incomplete", () => {
    h.warranty = ok(warrantyOk({ matchCount: 30, matches: [program()], truncated: true }));
    render(<NhtsaVehiclePanel vehicle={car} />);
    expect(screen.getByText(/newest 1 of 30 shown/)).toBeTruthy();
    expect(screen.getByText(/this view may be incomplete/)).toBeTruthy();
  });
});

describe("names NHTSA does not know (phase 1 carry-over)", () => {
  it("says so plainly without a Retry that could never succeed — and still not 'none on file'", () => {
    const unknown = { ok: false, source: "NHTSA", reason: "unknown_vehicle", error: 'NHTSA has no vehicle named "Ford F150" for 2018.' };
    h.recalls = ok(unknown);
    h.complaints = ok(unknown);
    render(<NhtsaVehiclePanel vehicle={{ year: "2018", make: "Ford", model: "F150" }} />);
    const notes = screen.getAllByRole("status");
    expect(notes).toHaveLength(2);
    expect(notes[0].textContent).toMatch(/recall lookup: NHTSA has no vehicle named "Ford F150" for 2018\. This is NOT the same as "none on file"\./);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    expect(text()).not.toMatch(/No recall campaigns|No owner complaints/);
  });

  it("shows the spelling NHTSA was asked for when the shop's make was aliased", () => {
    render(<NhtsaVehiclePanel vehicle={car} />);
    expect(screen.getByText("Looked up as NHTSA spells it: CHEVROLET Silverado")).toBeTruthy();
  });
});

describe("phase 1 panel cases the review found untested", () => {
  it("shows the park-outside badge", () => {
    h.recalls = ok({ ...recallsEmpty, recallCount: 1, recalls: [{ campaign: "20V003000", component: "ENGINE", summary: "fire risk", reportedDate: "01/12/2020", remedy: null, parkIt: false, parkOutside: true }] });
    render(<NhtsaVehiclePanel vehicle={car} />);
    expect(screen.getByText("Maker says: park outside until repaired")).toBeTruthy();
    expect(screen.queryByText(/do not drive until repaired/)).toBeNull();
  });

  it("a complaints { ok: false } value renders unavailable instead of crashing on its missing counts", () => {
    h.complaints = ok({ ok: false, source: "NHTSA", error: "NHTSA 503" });
    render(<NhtsaVehiclePanel vehicle={car} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/complaint lookup unavailable.*NHTSA 503/);
    expect(text()).not.toMatch(/owner complaints? filed/);
  });
});
