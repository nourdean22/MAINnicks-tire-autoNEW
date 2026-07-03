/**
 * TextMeQuote tracking regression — audit P0-1 guard.
 *
 * The quote widget is the highest-intent CTA on the homepage and every
 * service page. Before the fix it submitted leads with NO pixelEventId,
 * NO pixelUserData, and NO UTM spread — so GA4/Pixel saw nothing, the
 * server CAPI branch (lead.ts `if (input.pixelEventId)`) never fired,
 * and leads landed with utmSource=NULL. These tests pin the wiring so
 * a refactor can't silently sever the money funnel from analytics again.
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

const mockTrackLeadSubmission = vi.fn(() => "evt-test-123");
const mockGetUserDataForCAPI = vi.fn(() => ({
  client_user_agent: "vitest-ua",
  fbp: "fb.1.111.222",
  fbc: null,
}));
vi.mock("@/lib/metaPixel", () => ({
  trackLeadSubmission: (...args: unknown[]) => mockTrackLeadSubmission(...(args as [])),
  getUserDataForCAPI: () => mockGetUserDataForCAPI(),
}));

const mockGetUtmData = vi.fn(() => ({
  utmSource: "google",
  utmMedium: "cpc",
  utmCampaign: "brakes-july",
  utmTerm: undefined,
  utmContent: undefined,
  landingPage: "/brakes",
  referrer: undefined,
  gclid: undefined,
  sessionId: "sess-1",
}));
vi.mock("@/lib/utm", () => ({
  getUtmData: () => mockGetUtmData(),
}));

const mockTrackFormSubmission = vi.fn();
vi.mock("@/lib/ga4", () => ({
  trackFormSubmission: (...args: unknown[]) => mockTrackFormSubmission(...(args as [])),
}));

import TextMeQuote from "@/components/conversion/TextMeQuote";

function submitForm(container: HTMLElement) {
  fireEvent.change(screen.getByPlaceholderText("First name"), {
    target: { value: "Nour" },
  });
  const phoneInput = container.querySelector('input[type="tel"]');
  if (!phoneInput) throw new Error("tel input not rendered");
  fireEvent.change(phoneInput, { target: { value: "2168620005" } });
  fireEvent.click(screen.getByRole("button"));
}

describe("TextMeQuote tracking wiring (audit P0-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("fires Pixel Lead + GA4 and sends pixelEventId/pixelUserData/UTM in the mutation payload", () => {
    const { container } = render(<TextMeQuote serviceLabel="Brake Repair" />);
    submitForm(container);

    // Pixel Lead fired once with the widget's source bucket
    expect(mockTrackLeadSubmission).toHaveBeenCalledTimes(1);
    expect(mockTrackLeadSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ source: "sms_capture" })
    );

    // GA4 leg fired with the eventId chained through
    expect(mockTrackFormSubmission).toHaveBeenCalledWith(
      "lead",
      expect.objectContaining({ source: "sms_capture", eventId: "evt-test-123" })
    );

    // Server payload carries the CAPI dedup key + user data + UTM spread
    expect(mockMutate).toHaveBeenCalledTimes(1);
    const payload = mockMutate.mock.calls[0][0];
    expect(payload).toMatchObject({
      name: "Nour",
      phone: "2168620005",
      source: "sms_capture",
      pixelEventId: "evt-test-123",
      pixelUserData: { client_user_agent: "vitest-ua", fbp: "fb.1.111.222", fbc: null },
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "brakes-july",
      sessionId: "sess-1",
    });
    expect(payload.problem).toContain("Brake Repair");
  });

  it("does not fire any tracking when validation rejects the submit", () => {
    render(<TextMeQuote />);
    // Name filled, phone too short -> component-level validation error
    fireEvent.change(screen.getByPlaceholderText("First name"), {
      target: { value: "Nour" },
    });
    fireEvent.click(screen.getByRole("button"));

    expect(mockTrackLeadSubmission).not.toHaveBeenCalled();
    expect(mockTrackFormSubmission).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
