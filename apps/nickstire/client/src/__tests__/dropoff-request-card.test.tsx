/**
 * DropOffRequestCard (feat/home-v2 Wave B) — the "I'm heading over"
 * heads-up form. Pins: FCFS-safe copy (a heads-up, never a reservation),
 * validation, the callback.submit payload contract (context prefix +
 * sourcePage capture marker), and the success state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  mutate: vi.fn(),
  onSuccessRef: { current: undefined as undefined | (() => void) },
  trackEvent: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    callback: {
      submit: {
        useMutation: (opts: { onSuccess?: () => void }) => {
          h.onSuccessRef.current = opts?.onSuccess;
          return { mutate: h.mutate, isPending: false };
        },
      },
    },
  },
}));

vi.mock("@/components/SEO", () => ({
  trackEvent: (...a: unknown[]) => h.trackEvent(...a),
}));

vi.mock("@/lib/utm", () => ({
  getUtmData: () => ({ utmSource: "test-src", utmMedium: null, utmCampaign: null, referrer: null }),
}));

vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => h.toastError(...a), success: vi.fn() },
}));

import DropOffRequestCard from "@/components/DropOffRequestCard";

describe("DropOffRequestCard — FCFS heads-up form", () => {
  beforeEach(() => {
    h.mutate.mockClear();
    h.trackEvent.mockClear();
    h.toastError.mockClear();
    window.history.pushState({}, "", "/");
  });
  afterEach(cleanup);

  it("renders with explicitly non-reservation copy", () => {
    render(React.createElement(DropOffRequestCard));
    expect(screen.getByText(/Heading over\? Give us a heads-up\./i)).toBeTruthy();
    expect(screen.getByText(/This isn't a reservation/i)).toBeTruthy();
    // The submit CTA must never be reservation-framed ("RESERVE" /
    // "HOLD MY SPOT" were the exact violations UrgencyWidget shipped).
    expect(screen.getByRole("button", { name: /LET THE SHOP KNOW/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /reserve|hold my spot/i })).toBeNull();
  });

  it("rejects a short phone without submitting", () => {
    render(React.createElement(DropOffRequestCard));
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Sam" } });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "216555" } });
    fireEvent.click(screen.getByRole("button", { name: /LET THE SHOP KNOW/i }));
    expect(h.mutate).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalled();
  });

  it("submits the callback payload with the drop-off context + capture marker + UTM", () => {
    render(React.createElement(DropOffRequestCard));
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Sam Rivera" } });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "(216) 555-1234" } });
    fireEvent.change(screen.getByLabelText("Car and what it needs (optional)"), { target: { value: "2014 Civic, brakes" } });
    fireEvent.click(screen.getByRole("button", { name: /LET THE SHOP KNOW/i }));
    expect(h.mutate).toHaveBeenCalledWith(expect.objectContaining({
      name: "Sam Rivera",
      phone: "(216) 555-1234",
      context: "Drop-off heads-up — 2014 Civic, brakes",
      sourcePage: "/?capture=dropoff-request",
      utmSource: "test-src",
    }));
  });

  it("success state confirms FCFS ('first come, first served') and fires form_completed", async () => {
    render(React.createElement(DropOffRequestCard));
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Sam" } });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "2165551234" } });
    fireEvent.click(screen.getByRole("button", { name: /LET THE SHOP KNOW/i }));
    await act(async () => { h.onSuccessRef.current?.(); });
    expect(screen.getByText(/the desk knows you're coming/i)).toBeTruthy();
    expect(screen.getByText(/first come, first served/i)).toBeTruthy();
    expect(h.trackEvent).toHaveBeenCalledWith("form_completed", { type: "dropoff_request" });
  });
});
