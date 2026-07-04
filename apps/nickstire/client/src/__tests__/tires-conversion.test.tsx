/**
 * Tires conversion reconstruction — regression pins.
 *
 * Guards the four new /tires conversion surfaces:
 *  1. AcimaEstimator — lease math (4%/wk · 52wk · 90-day EPO) and the
 *     VOCABULARY BOUNDARY: outside the verbatim Acima disclaimer, the
 *     component must never say financing/APR/loan/interest/down payment
 *     (Acima merchant terms prohibit presenting lease-to-own as credit).
 *  2. FrictionlessIntentPanel — plate-quote submissions ride
 *     trpc.lead.submit with a valid DB source enum + UTM spread, and
 *     NEVER touch window.prompt/confirm/alert (iOS PWA suppresses them
 *     silently — see nickstire-ios-pwa-primitives).
 *  3. UsedTireTrustProtocol — the 4 hard gates stay literally stated.
 *  4. FeeComparisonTable — $0 add-on column + the $89–$99+ chain total.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const mockMutate = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    lead: {
      submit: {
        useMutation: () => ({ mutate: mockMutate, isPending: false }),
      },
    },
  },
}));

const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...(args as [])),
    success: vi.fn(),
  },
}));

const mockTrackEvent = vi.fn();
vi.mock("@/components/SEO", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...(args as [])),
}));

vi.mock("@/lib/utm", () => ({
  getUtmData: () => ({
    utmSource: "google",
    utmMedium: "organic",
    utmCampaign: null,
    landingPage: "/tires",
    referrer: null,
    sessionId: "sess-tires-1",
  }),
}));

import AcimaEstimator, { estimateLease, ACIMA_DISCLAIMER } from "@/components/payments/AcimaEstimator";
import FrictionlessIntentPanel from "@/components/conversion/FrictionlessIntentPanel";
import UsedTireTrustProtocol from "@/components/conversion/UsedTireTrustProtocol";
import FeeComparisonTable from "@/components/conversion/FeeComparisonTable";

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("AcimaEstimator — lease math", () => {
  it("computes weekly, 52-week total, and 90-day early purchase for the $299 anchor", () => {
    const est = estimateLease(299);
    expect(est.weekly).toBe(12); // 299 * 0.04 ≈ $12/wk
    expect(est.fiftyTwoWeekTotal).toBe(624); // 12 * 52
    expect(est.ninetyDayPurchase).toBe(349); // 299 cash + $50 initial payment
  });

  it("renders the derived numbers from the default $299 price", () => {
    render(<AcimaEstimator />);
    expect(screen.getByTestId("acima-weekly").textContent).toContain("$12");
    expect(screen.getByTestId("acima-total").textContent).toContain("624");
    expect(screen.getByTestId("acima-epo").textContent).toContain("349");
  });

  it("recomputes when the price input changes", () => {
    render(<AcimaEstimator />);
    fireEvent.change(screen.getByLabelText(/tire set cash price/i), { target: { value: "500" } });
    expect(screen.getByTestId("acima-weekly").textContent).toContain("$20"); // 500*0.04
    expect(screen.getByTestId("acima-total").textContent).toContain("1,040");
    expect(screen.getByTestId("acima-epo").textContent).toContain("550");
  });

  it("keeps lending vocabulary out of everything except the verbatim disclaimer", () => {
    const { container } = render(<AcimaEstimator />);
    const disclaimer = screen.getByTestId("acima-disclaimer");
    expect(disclaimer.textContent).toContain(ACIMA_DISCLAIMER);

    const outsideDisclaimer = (container.textContent ?? "").replace(disclaimer.textContent ?? "", "");
    expect(outsideDisclaimer).not.toMatch(/financ/i);
    expect(outsideDisclaimer).not.toMatch(/\bAPR\b/i);
    expect(outsideDisclaimer).not.toMatch(/\bloan\b/i);
    expect(outsideDisclaimer).not.toMatch(/\binterest\b/i);
    expect(outsideDisclaimer).not.toMatch(/down payment/i);
    // Required lease-to-own vocabulary is present
    expect(outsideDisclaimer).toMatch(/Lease-to-Own/i);
    expect(outsideDisclaimer).toMatch(/Weekly Lease Payment/i);
    expect(outsideDisclaimer).toMatch(/Initial Payment/i);
  });
});

describe("FrictionlessIntentPanel — plate quote loop", () => {
  function fill(plate = "hxk4821", name = "Nour", phone = "2168620005") {
    fireEvent.change(screen.getByLabelText(/license plate/i), { target: { value: plate } });
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: name } });
    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: phone } });
  }

  it("submits through trpc.lead.submit with a DB-valid source, uppercased plate, and UTM spread", () => {
    const promptSpy = vi.spyOn(window, "prompt");
    const confirmSpy = vi.spyOn(window, "confirm");
    const alertSpy = vi.spyOn(window, "alert");

    render(<FrictionlessIntentPanel />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /text me my quote/i }));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const payload = mockMutate.mock.calls[0][0];
    expect(payload).toMatchObject({
      name: "Nour",
      phone: "2168620005",
      source: "popup", // must stay a member of the leads.source DB enum
      vehicle: "Plate: HXK4821",
      utmSource: "google",
      sessionId: "sess-tires-1",
    });
    expect(payload.problem).toMatch(/TIRE QUOTE/);
    expect(payload.problem).toMatch(/HXK4821/);

    // iOS-PWA regression: suppressed primitives must never be reached
    expect(promptSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("blocks submission without a plate and surfaces an in-DOM toast, not an alert", () => {
    const alertSpy = vi.spyOn(window, "alert");
    render(<FrictionlessIntentPanel />);
    fill(""); // no plate
    fireEvent.click(screen.getByRole("button", { name: /text me my quote/i }));

    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("offers the text-TIRE fast path pointed at the shop line", () => {
    render(<FrictionlessIntentPanel />);
    const smsLink = screen.getByRole("link", { name: /text .*TIRE/i });
    expect(smsLink.getAttribute("href")).toBe("sms:+12168620005?&body=TIRE");
  });
});

describe("UsedTireTrustProtocol — the 4 hard gates", () => {
  it("states all four inspection gates with their concrete thresholds", () => {
    render(<UsedTireTrustProtocol />);
    expect(screen.getByText(/Deep Tread/i)).toBeTruthy();
    expect(screen.getByText(/5\/32″ to 7\/32″/)).toBeTruthy();
    expect(screen.getByText(/Sidewall Scan/i)).toBeTruthy();
    expect(screen.getByText(/DOT Production Gate/i)).toBeTruthy();
    expect(screen.getByText(/older than 5 years/i)).toBeTruthy();
    expect(screen.getByText(/Internal Plug Integrity/i)).toBeTruthy();
    expect(screen.getByText(/No sidewall patches/i)).toBeTruthy();
  });
});

describe("FeeComparisonTable — anti-chain frame", () => {
  it("shows $0 for every Nick's add-on row and the $89–$99+ chain total", () => {
    render(<FeeComparisonTable />);
    // 8 fee rows + the totals row all show $0 on Nick's side
    expect(screen.getAllByText("$0").length).toBe(9);
    expect(screen.getByText("$89–$99+")).toBeTruthy();
    expect(screen.getByText(/Mavis, Mr\. Tire/)).toBeTruthy();
  });
});
