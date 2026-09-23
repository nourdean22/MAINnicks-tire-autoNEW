/**
 * The careers form sends what the screen shows (review of #2561, 2026-09-23).
 *
 *  - Lanes followed `hashchange` only. Tap "Talk privately" (#talk), pick the
 *    "Apply now" lane, tap "Talk privately" again: the hash was already #talk,
 *    nothing fired, and a confidential question went out on the apply route
 *    (shop inbox + owner push). In-page CTAs now call chooseCareersIntent.
 *  - "What would make you move?" chips picked on one lane were still sent
 *    after switching to a lane that hides them.
 *  - A filled honeypot is saved server-side and shown the ordinary success,
 *    but it must not count as a conversion or file a $300 referral claim.
 *
 * Mounts the real ApplicationForm; only the tRPC client, analytics and UTM
 * capture are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  submitted: [] as Array<Record<string, unknown>>,
  referrals: [] as Array<Record<string, unknown>>,
  events: [] as string[],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    candidates: {
      submit: {
        useMutation: (opts?: { onSuccess?: (d: { success: true; id: number }) => void }) => ({
          mutate: (v: Record<string, unknown>) => {
            h.submitted.push(v);
            opts?.onSuccess?.({ success: true, id: 5 });
          },
          isPending: false,
        }),
      },
    },
    technicianReferrals: {
      submit: { useMutation: () => ({ mutate: (v: Record<string, unknown>) => h.referrals.push(v), isPending: false }) },
    },
    reviews: { google: { useQuery: () => ({ data: undefined }) } },
  },
}));
vi.mock("@/lib/utm", () => ({ getUtmData: () => ({}) }));
vi.mock("@/components/SEO", () => ({
  SEOHead: () => null,
  Breadcrumbs: () => null,
  trackEvent: (name: string) => h.events.push(name),
  trackPhoneClick: () => {},
}));

import { ApplicationForm, chooseCareersIntent } from "@/pages/Careers";

const pressed = () => screen.getAllByRole("button", { pressed: true }).map((b) => b.textContent);

function fillRequired() {
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Sam Wrench" } });
  fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "2165550142" } });
}

beforeEach(() => {
  h.submitted.length = 0;
  h.referrals.length = 0;
  h.events.length = 0;
});

describe("careers form lanes", () => {
  it("a second tap on 'Talk privately' after choosing another lane switches back", () => {
    render(<ApplicationForm />);
    act(() => chooseCareersIntent("confidential"));
    expect(pressed()).toContain("Talk privately first");
    fireEvent.click(screen.getByRole("button", { name: "Apply now" }));
    expect(pressed()).toContain("Apply now");
    act(() => chooseCareersIntent("confidential"));
    expect(pressed()).toContain("Talk privately first");
    fillRequired();
    fireEvent.submit(screen.getByRole("button", { name: /send/i }).closest("form")!);
    expect(h.submitted[0].intent).toBe("confidential");
  });

  it("reasons chosen on a lane that shows them are not sent after switching to one that hides them", () => {
    render(<ApplicationForm />);
    act(() => chooseCareersIntent("talent_network"));
    fireEvent.click(screen.getByRole("button", { name: "Off flat rate" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply now" }));
    fillRequired();
    fireEvent.submit(screen.getByRole("button", { name: /submit application/i }).closest("form")!);
    expect(h.submitted[0]).toMatchObject({ intent: "apply", moveReasons: null });
  });
});

describe("a filled honeypot", () => {
  it("is not a conversion and files no referral claim", () => {
    render(<ApplicationForm />);
    fireEvent.change(screen.getByLabelText("Leave this field empty"), { target: { value: "http://spam.example" } });
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Referred by/), { target: { value: "Mike" } });
    fireEvent.submit(screen.getByRole("button", { name: /submit application/i }).closest("form")!);
    expect(h.submitted).toHaveLength(1);
    expect(h.events).not.toContain("careers_application_submitted");
    expect(h.referrals).toHaveLength(0);
  });

  it("control: an ordinary submission counts and files the referral", () => {
    render(<ApplicationForm />);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Referred by/), { target: { value: "Mike" } });
    fireEvent.submit(screen.getByRole("button", { name: /submit application/i }).closest("form")!);
    expect(h.events).toContain("careers_application_submitted");
    expect(h.referrals).toHaveLength(1);
  });
});
