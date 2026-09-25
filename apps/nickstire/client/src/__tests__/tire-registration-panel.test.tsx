/**
 * Tire registration panel (Q-47): an unread order must never paint as "0 tires", an order with
 * missing DOT codes must read INCOMPLETE, and a TIN is captured per position without any native
 * dialog (iOS PWA standalone suppresses window.prompt/confirm).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

type QueryResult = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void };

const h = vi.hoisted(() => ({
  reg: { data: undefined, isLoading: false, isError: false, error: null, refetch: () => {} } as QueryResult,
  captures: [] as unknown[],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      workOrders: {
        tireRegistration: { invalidate: () => {} },
        tireRegistrationForm: { fetch: async () => ({ html: "<p>form</p>" }) },
      },
    }),
    workOrders: {
      tireRegistration: { useQuery: () => h.reg },
      captureTireTin: { useMutation: () => ({ mutate: (v: unknown) => { h.captures.push(v); }, isPending: false }) },
      removeTirePosition: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
      recordTireRegistration: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
    },
  },
}));

import TireRegistrationPanel from "@/pages/admin/money/TireRegistrationPanel";

const ok = (data: unknown): QueryResult => ({ data, isLoading: false, isError: false, error: null, refetch: () => {} });

describe("TireRegistrationPanel", () => {
  beforeEach(() => { h.captures = []; });

  it("a failed read renders an error with retry — never '0 tires'", () => {
    h.reg = { data: undefined, isLoading: false, isError: true, error: { message: "db down" }, refetch: () => {} };
    render(<TireRegistrationPanel workOrderId="wo-1" />);
    expect(screen.getByRole("alert").textContent).toMatch(/NOT the same as "no tires"/);
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/0 of|No tire lines/);
  });

  it("an order with missing DOT codes is visibly INCOMPLETE", () => {
    h.reg = ok({
      workOrderId: "wo-1", expected: 4,
      rows: [{ position: "LF", tin: "3D1A7B2C42324", tinStatus: "valid", tinWeek: 23, tinYear: 2024, tireBrand: "Hankook", tireCondition: "new", registrationMethod: "pending" }],
      summary: { state: "incomplete", expected: 4, captured: 1, missingTins: 3, invalidPositions: [], pendingPositions: ["LF"] },
    });
    render(<TireRegistrationPanel workOrderId="wo-1" />);
    expect(screen.getByText(/INCOMPLETE · 1 of 4 DOT codes/)).toBeTruthy();
    expect(screen.getByText(/3 tire\(s\) sold on this order still need a DOT code/)).toBeTruthy();
    // The form cannot be produced while TINs are missing.
    expect((screen.getByRole("button", { name: /capture every DOT code first/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("captures a TIN for the chosen position inline, with no native dialog", () => {
    const promptSpy = vi.spyOn(window, "prompt");
    const confirmSpy = vi.spyOn(window, "confirm");
    h.reg = ok({
      workOrderId: "wo-1", expected: 4, rows: [],
      summary: { state: "incomplete", expected: 4, captured: 0, missingTins: 4, invalidPositions: [], pendingPositions: [] },
    });
    render(<TireRegistrationPanel workOrderId="wo-1" />);
    fireEvent.click(screen.getByRole("button", { name: "RR" }));
    fireEvent.change(screen.getByPlaceholderText(/3D1 A7B2C4 2324/), { target: { value: "dot 3d1 a7b2c4 2324" } });
    expect(screen.getByText(/made week 23 of 2024/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Save RR/ }));
    expect(h.captures).toEqual([{ workOrderId: "wo-1", position: "RR", tin: "dot 3d1 a7b2c4 2324", brand: undefined, condition: "new" }]);
    expect(promptSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  it("an invalid TIN is refused client-side and never sent", () => {
    h.reg = ok({
      workOrderId: "wo-1", expected: 4, rows: [],
      summary: { state: "incomplete", expected: 4, captured: 0, missingTins: 4, invalidPositions: [], pendingPositions: [] },
    });
    render(<TireRegistrationPanel workOrderId="wo-1" />);
    fireEvent.change(screen.getByPlaceholderText(/3D1 A7B2C4 2324/), { target: { value: "3D1AOB2C42324" } });
    fireEvent.click(screen.getByRole("button", { name: /Save LF/ }));
    expect(h.captures).toEqual([]);
  });
});
