/**
 * /diagnose — symptom-checker regression pins.
 *
 * Every test here fails against the pre-2026-07-16 page for a reason a customer
 * would have felt:
 *
 *  1. HONEST FAILURE — the old catch block built a complete, confident-looking
 *     DiagnosisResult and rendered it exactly like a real answer. The most
 *     common trigger was the customer's own detailed description tripping a
 *     200-char server cap, so the people who followed the "be specific"
 *     instruction were the most likely to get a fabricated card. Nothing may
 *     render as a diagnosis unless the model actually returned one.
 *  2. NO BORROWED AUTHORITY — "SCAN MY CAR" / "Scanning your vehicle" on a page
 *     that never touches the vehicle. It reads typed text.
 *  3. NO AUTO-RUN — `?symptom=` used to fire the rate-limited AI call on mount,
 *     so crawlers, link previews and refreshes burned quota nobody read.
 *  4. RED FLAGS SURVIVE — they're matched server-side in code, so they must
 *     render even when the AI came back unavailable.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const mockMutateAsync = vi.fn();
const mockLeadMutateAsync = vi.fn();

vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: (_t, prop) => React.forwardRef((props: any, ref: any) => {
    const { initial, animate, exit, transition, whileInView, whileHover, whileTap, variants, viewport, drag, dragConstraints, layout, layoutId, ...rest } = props;
    return React.createElement(typeof prop === "string" ? prop : "div", { ...rest, ref });
  }) }),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
  useInView: () => true,
  useAnimation: () => ({ start: vi.fn(), set: vi.fn() }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    diagnose: { analyze: { useMutation: () => ({ mutateAsync: mockMutateAsync }) } },
    lead: { submit: { useMutation: () => ({ mutateAsync: mockLeadMutateAsync }) } },
  },
}));

const mockTrackEvent = vi.fn();
vi.mock("@/components/SEO", () => ({
  SEOHead: () => null,
  Breadcrumbs: () => null,
  trackPhoneClick: vi.fn(),
  trackEvent: (...args: unknown[]) => mockTrackEvent(...(args as [])),
}));

vi.mock("@/components/PageLayout", () => ({
  default: ({ children }: any) => React.createElement("div", null, children),
}));
vi.mock("@/components/ResponsivePhoto", () => ({ default: () => null }));
vi.mock("@/components/LocalBusinessSchema", () => ({ default: () => null }));
vi.mock("@/components/FadeIn", () => ({
  default: ({ children }: any) => React.createElement("div", null, children),
}));
vi.mock("@/lib/shopHours", () => ({ getOpenStatus: () => ({ isOpen: true, label: "Open until 6pm" }) }));
vi.mock("@/lib/utm", () => ({
  getUtmData: () => ({ landingPage: "/diagnose", sessionId: "sess-diag-1", referrer: null }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import DiagnosePage from "@/pages/DiagnosePage";

/** A well-formed analyzed result, matching the router's "ai" branch. */
function analyzed(overrides: Record<string, unknown> = {}) {
  return {
    status: "ai",
    urgency: "high",
    urgencyScore: 4,
    title: "Brake Wear Is The Likely Cause",
    summary: "Grinding while braking usually means the pads are down to the backing plate.",
    likelyCauses: [
      { cause: "Worn Brake Pads", explanation: "Metal-on-metal contact with the rotor.", likelihood: "high" },
      { cause: "Scored Rotors", explanation: "Driving on worn pads scores the rotor face.", likelihood: "medium" },
    ],
    recommendedService: "Brakes",
    costNote: "Free quick check · written quote before any work",
    safetyNote: "Have the brakes looked at before more driving.",
    nextSteps: ["Call the shop", "Avoid heavy braking"],
    redFlags: [],
    ...overrides,
  };
}

/** The textarea, whichever placeholder it's currently showing. */
function symptomBox() {
  return document.querySelector("textarea") as HTMLTextAreaElement;
}

function typeSymptom(text: string) {
  const box = symptomBox();
  fireEvent.change(box, { target: { value: text } });
  return box;
}

function pickSymptom(label: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: label }));
}

function pressCheck() {
  fireEvent.click(screen.getByRole("button", { name: /CHECK MY SYMPTOMS/i }));
}

beforeEach(() => {
  window.history.replaceState({}, "", "/diagnose");
  mockMutateAsync.mockReset();
  mockLeadMutateAsync.mockReset().mockResolvedValue({ success: true });
  mockTrackEvent.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("/diagnose · honest about what it is", () => {
  it("asks to check symptoms, and never claims to scan the car", () => {
    render(<DiagnosePage />);

    expect(screen.getByRole("button", { name: /CHECK MY SYMPTOMS/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /SCAN MY CAR/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/scanning your vehicle/i);
  });

  it("discloses it is not an OBD scan before the customer uses it", () => {
    render(<DiagnosePage />);
    expect(document.body.textContent).toMatch(/not an OBD-II scan/i);
  });
});

describe("/diagnose · the 200-char silent failure", () => {
  it("sends a long, detailed description instead of dropping it", async () => {
    mockMutateAsync.mockResolvedValue(analyzed());
    render(<DiagnosePage />);

    // A zone prefill (151-186 chars) plus one sentence of real detail — the
    // exact shape the page asks for, and the shape that used to blow the cap.
    const detailed =
      "Brakes / Tires: I'm experiencing brake or tire issues — squealing or grinding when braking, uneven tire wear, vibration, pulling to one side, or TPMS light. " +
      "It started about a week ago and it's getting worse, especially going downhill.";
    expect(detailed.length).toBeGreaterThan(200);

    typeSymptom(detailed);
    pressCheck();

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockMutateAsync.mock.calls[0][0].symptoms[0]).toBe(detailed);
  });

  it("shows a live character count against the real limit", () => {
    render(<DiagnosePage />);
    typeSymptom("grinding noise");
    expect(screen.getByText("14/2000")).toBeTruthy();
  });
});

describe("/diagnose · honest failure", () => {
  it("does NOT fabricate a diagnosis when the request throws", async () => {
    mockMutateAsync.mockRejectedValue(new Error("Failed to fetch"));
    render(<DiagnosePage />);

    typeSymptom("grinding when I brake");
    pressCheck();

    await waitFor(() => expect(screen.getByText(/WE COULDN'T CHECK THIS ONE/i)).toBeTruthy());
    // The old fabricated card's exact copy — must never appear again.
    expect(document.body.textContent).not.toMatch(/We Need to Take a Closer Look/i);
    // Query the rendered headings, not body.textContent: the JSON-LD script
    // legitimately contains the phrase "possible causes" in its description.
    expect(screen.queryByText("POSSIBLE CAUSES")).toBeNull();
    expect(screen.queryByText("RECOMMENDED NEXT STEPS")).toBeNull();
  });

  it("explains a rate-limit in words a customer understands", async () => {
    mockMutateAsync.mockRejectedValue(new Error("TOO_MANY_REQUESTS"));
    render(<DiagnosePage />);

    typeSymptom("weird noise");
    pressCheck();

    await waitFor(() => expect(document.body.textContent).toMatch(/we've paused for a minute/i));
  });

  it("renders the server's 'unavailable' branch as a dead end, not a result", async () => {
    mockMutateAsync.mockResolvedValue({
      status: "unavailable",
      reason: "ai_error",
      redFlags: [],
      costNote: "Free quick check · written quote before any work",
    });
    render(<DiagnosePage />);

    typeSymptom("something feels off");
    pressCheck();

    await waitFor(() => expect(screen.getByText(/WE COULDN'T CHECK THIS ONE/i)).toBeTruthy());
    expect(screen.queryByText(/POSSIBLE CAUSES/i)).toBeNull();
  });

  it("still offers the way in when it could not check", async () => {
    mockMutateAsync.mockRejectedValue(new Error("boom"));
    render(<DiagnosePage />);

    typeSymptom("noise");
    pressCheck();

    await waitFor(() => expect(screen.getByText(/LET NICK'S CONFIRM IT/i)).toBeTruthy());
    expect(screen.getByText(/DIRECTIONS/i)).toBeTruthy();
  });
});

describe("/diagnose · red flags survive an AI outage", () => {
  it("shows the stop-driving warning even when the check is unavailable", async () => {
    mockMutateAsync.mockResolvedValue({
      status: "unavailable",
      reason: "ai_error",
      redFlags: [{ id: "brake-failure", label: "Possible brake failure", guidance: "Stop driving it. Have it towed." }],
      costNote: "Free quick check · written quote before any work",
    });
    render(<DiagnosePage />);

    typeSymptom("brakes went to the floor");
    pressCheck();

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/Possible brake failure/i)).toBeTruthy();
    expect(screen.getByText(/Stop driving it\. Have it towed\./i)).toBeTruthy();
  });
});

describe("/diagnose · no auto-run from the URL", () => {
  it("prefills ?symptom= but does not spend an AI call until asked", async () => {
    window.history.replaceState({}, "", "/diagnose?symptom=my+brakes+are+grinding");
    render(<DiagnosePage />);

    await waitFor(() => expect(symptomBox().value).toBe("my brakes are grinding"));

    // The regression: this used to have fired on mount for every crawler,
    // link-preview fetch and refresh of a shared link.
    expect(mockMutateAsync).not.toHaveBeenCalled();

    pressCheck();
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
  });
});

describe("/diagnose · result presentation", () => {
  it("words likelihood honestly instead of faking calibrated confidence", async () => {
    mockMutateAsync.mockResolvedValue(analyzed());
    render(<DiagnosePage />);

    typeSymptom("grinding when braking");
    pressCheck();

    await waitFor(() => expect(screen.getByText(/Common possibility/i)).toBeTruthy());
    expect(screen.getByText(/Also possible/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/HIGH LIKELIHOOD/i);
  });

  it("never shows an invented dollar figure", async () => {
    mockMutateAsync.mockResolvedValue(analyzed());
    render(<DiagnosePage />);

    typeSymptom("grinding when braking");
    pressCheck();

    await waitFor(() => expect(screen.getByText(/What it costs to find out/i)).toBeTruthy());
    // Scope to the cost card: the hero trust strip states the same offer, and
    // both saying it is the point — they must not disagree.
    // The label sits in an icon+text flex row; the card is its grandparent.
    const costCard = screen.getByText(/What it costs to find out/i).closest("div")?.parentElement;
    expect(costCard?.textContent).toMatch(/Free quick check · written quote before any work/i);
    expect(document.body.textContent).not.toMatch(/Estimated Cost Range/i);
  });

  it("routes the result to booking, not the contact form", async () => {
    mockMutateAsync.mockResolvedValue(analyzed());
    render(<DiagnosePage />);

    typeSymptom("grinding when braking");
    pressCheck();

    await waitFor(() => expect(screen.getByText(/LET NICK'S CONFIRM IT/i)).toBeTruthy());
    const booking = screen.getByText(/LET NICK'S CONFIRM IT/i).closest("a");
    expect(booking?.getAttribute("href")).toBe("/booking");
    // Per-cause "BOOK THIS REPAIR" links sold work nobody had verified.
    expect(screen.queryByText(/BOOK THIS REPAIR/i)).toBeNull();
  });
});

describe("/diagnose · lead attribution", () => {
  it("sends session attribution with the lead — /diagnose used to send none", async () => {
    mockMutateAsync.mockResolvedValue(analyzed());
    render(<DiagnosePage />);

    typeSymptom("grinding when braking");
    pressCheck();
    await waitFor(() => expect(screen.getByText(/WANT US TO LOOK AT IT\?/i)).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText(/Your name/i), { target: { value: "Sam" } });
    fireEvent.change(screen.getByPlaceholderText(/Phone number/i), { target: { value: "2165550123" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));

    await waitFor(() => expect(mockLeadMutateAsync).toHaveBeenCalledTimes(1));
    const payload = mockLeadMutateAsync.mock.calls[0][0];
    expect(payload.landingPage).toBe("/diagnose");
    expect(payload.sessionId).toBe("sess-diag-1");
    // Canonical source (enum member added by drizzle/0082) — the old
    // "[/diagnose symptom check]" problem-prefix stopgap is retired with it.
    expect(payload.source).toBe("diagnose");
    expect(payload.problem).not.toMatch(/\[\/diagnose symptom check\]/);
  });
});

describe("/diagnose · vehicle data does not go stale", () => {
  it("offers next model year without a code change", () => {
    render(<DiagnosePage />);
    const nextYear = String(new Date().getFullYear() + 1);
    expect(screen.getByRole("option", { name: nextYear })).toBeTruthy();
  });

  it("offers an escape hatch for pre-list vehicles, and its value fits the server cap", async () => {
    // Shipped dead in the P0 wave: the constant existed but no <option> ever
    // rendered it. And the label ("Older / not listed", 18 chars) would blow
    // the server's vehicleYear cap — so the submitted VALUE must stay short.
    mockMutateAsync.mockResolvedValue(analyzed());
    render(<DiagnosePage />);

    const option = screen.getByRole("option", { name: /Older \/ not listed/i }) as HTMLOptionElement;
    expect(option).toBeTruthy();
    expect(option.value.length).toBeLessThanOrEqual(24);

    fireEvent.change(document.querySelector("select") as HTMLSelectElement, { target: { value: option.value } });
    typeSymptom("makes a knocking sound");
    pressCheck();

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockMutateAsync.mock.calls[0][0].vehicleYear).toBe(option.value);
  });
});

describe("/diagnose · symptom-first entry", () => {
  it("leads with what the car is doing, not with car anatomy", () => {
    render(<DiagnosePage />);

    // Words customers use...
    for (const label of [/Won't start/i, /Warning light/i, /Shaking or vibration/i, /Strange noise/i]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    // ...instead of asking them to locate the fault first.
    expect(document.body.textContent).not.toMatch(/TAP THE PROBLEM AREA/i);
  });

  it("exposes the chips as real pressable controls", () => {
    render(<DiagnosePage />);
    const chip = screen.getByRole("button", { name: /Won't start/i });
    expect(chip.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(chip);
    expect(screen.getByRole("button", { name: /Won't start/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("aims the follow-up question instead of pre-filling the customer's box", () => {
    render(<DiagnosePage />);
    pickSymptom(/Won't start/i);

    // The old flow dumped ~180 chars of boilerplate into the textarea.
    expect(symptomBox().value).toBe("");
    expect(symptomBox().placeholder).toMatch(/crank, click, or do nothing/i);
  });

  it("sends the category as a frame in front of the customer's own words", async () => {
    mockMutateAsync.mockResolvedValue(analyzed());
    render(<DiagnosePage />);

    pickSymptom(/Brakes/i);
    typeSymptom("grinding when I slow down");
    pressCheck();

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockMutateAsync.mock.calls[0][0].symptoms[0]).toBe("Brakes: grinding when I slow down");
  });

  it("accepts a chip on its own — 'Won't start' is a real report", async () => {
    mockMutateAsync.mockResolvedValue(analyzed());
    render(<DiagnosePage />);

    pickSymptom(/Won't start/i);
    const btn = screen.getByRole("button", { name: /CHECK MY SYMPTOMS/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    pressCheck();
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockMutateAsync.mock.calls[0][0].symptoms[0]).toBe("The car won't start.");
  });

  it("lets a chip be un-picked", () => {
    render(<DiagnosePage />);
    pickSymptom(/Won't start/i);
    expect(screen.getByRole("button", { name: /Won't start/i }).getAttribute("aria-pressed")).toBe("true");
    pickSymptom(/Won't start/i);
    expect(screen.getByRole("button", { name: /Won't start/i }).getAttribute("aria-pressed")).toBe("false");
  });

  it("does nothing when there is neither a chip nor a description", () => {
    render(<DiagnosePage />);
    const btn = screen.getByRole("button", { name: /CHECK MY SYMPTOMS/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("keeps the car illustration out of the a11y tree — the chips are the control", () => {
    const { container } = render(<DiagnosePage />);
    const svg = container.querySelector('svg[viewBox="0 0 800 320"]');
    expect(svg).toBeTruthy();
    // It used to be the ONLY way in: <g> elements with mouse handlers, not
    // focusable, no accessible name. Now it mirrors the buttons.
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("deep-links a category from a GBP/Instagram post without auto-running", async () => {
    window.history.replaceState({}, "", "/diagnose?category=overheating");
    render(<DiagnosePage />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Running hot/i }).getAttribute("aria-pressed")).toBe("true"),
    );
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("ignores an unknown ?category= instead of breaking", () => {
    window.history.replaceState({}, "", "/diagnose?category=bogus-value");
    render(<DiagnosePage />);
    expect(screen.getByRole("button", { name: /Won't start/i }).getAttribute("aria-pressed")).toBe("false");
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });
});

describe("/diagnose · the verdict", () => {
  it("answers 'can I drive it' in plain words, per urgency", async () => {
    const cases: [string, RegExp][] = [
      ["critical", /Don't drive it/i],
      ["high", /Don't sit on this one/i],
      ["moderate", /next week or two/i],
      ["low", /Safe to drive/i],
    ];
    for (const [urgency, expected] of cases) {
      mockMutateAsync.mockResolvedValue(analyzed({ urgency, urgencyScore: 3 }));
      render(<DiagnosePage />);
      typeSymptom("something is off");
      pressCheck();
      await waitFor(() => expect(document.body.textContent).toMatch(expected));
      cleanup();
    }
  });

  it("no longer collapses 'book it this week' and 'do not drive this' into one banner", async () => {
    mockMutateAsync.mockResolvedValue(analyzed({ urgency: "high", urgencyScore: 4 }));
    render(<DiagnosePage />);
    typeSymptom("grinding");
    pressCheck();
    await waitFor(() => expect(screen.getByText("GET IT CHECKED TODAY")).toBeTruthy());
    // Exact, not /regex/i: the symptom guide below legitimately uses the words
    // "stop driving it" in its prose. We're pinning the BADGE here.
    expect(screen.queryByText("STOP DRIVING IT")).toBeNull();
  });
});
