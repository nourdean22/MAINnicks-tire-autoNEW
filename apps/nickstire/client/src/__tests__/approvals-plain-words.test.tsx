/**
 * Approvals in plain words (admin tabs job, 2026-10-27).
 *
 * The queue used to print the raw executor payload as JSON on every card, said nothing when it was
 * empty, hid the shop's own turn-down rate, and gave the owner a blank box for the reason, so 56 of 71
 * proposals were rejected with nobody able to learn why. These tests pin the card in words, the
 * one-tap reasons, the 30-day summary (read from proposals.decisionSummary: data, unavailable and
 * errored states) and the empty state.
 *
 * No real names or phones: "Caller" and 216-555-0100 style numbers only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  confirm: vi.fn(async (_opts: Record<string, unknown>) => false),
  approve: vi.fn(),
  reject: vi.fn(),
  summaryRefetch: vi.fn(),
  /** Inputs of every proposals.list read: the filtered queue is the only one left. */
  inputs: [] as Array<Record<string, unknown> | undefined>,
  /** Input and options of every proposals.decisionSummary read. */
  summaryCalls: [] as Array<{ input: unknown; opts: unknown }>,
  rows: [] as unknown[],
  summary: { data: undefined as unknown } as { data: unknown },
  summaryState: { isLoading: false, isError: false },
}));
vi.mock("@/lib/trpc", () => {
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery")
          return (input?: Record<string, unknown>, opts?: unknown) => {
            if (path === "proposals.decisionSummary") {
              h.summaryCalls.push({ input, opts });
              return { data: h.summary.data, ...h.summaryState, error: null, refetch: h.summaryRefetch };
            }
            if (path !== "proposals.list") return { data: [], isLoading: false, isError: false, error: null, refetch: () => {} };
            h.inputs.push(input);
            return { data: h.rows, isLoading: false, isError: false, error: null, refetch: () => {} };
          };
        if (key === "useMutation")
          return () => ({
            mutate: path === "proposals.approve" ? h.approve : path === "proposals.reject" ? h.reject : () => {},
            isPending: false,
          });
        if (key === "invalidate") return async () => {};
        return node(path ? `${path}.${String(key)}` : String(key));
      },
    });
  return {
    trpc: new Proxy({}, {
      get(_t, key) {
        if (key === "useUtils" || key === "useContext") return () => node("utils");
        return node(String(key));
      },
    }),
  };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: h.confirm, default: () => null }));
import ApprovalsSection from "@/pages/admin/ApprovalsSection";
import { PROPOSAL_REASON_CHIPS } from "@shared/proposalReasons";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

function row(over: Record<string, unknown> = {}) {
  const createdAt = (over.createdAt as Date | undefined) ?? ago(1);
  return {
    id: "p-1", source: "nick_receptionist", actor: "nick-receptionist", actionType: "create_booking_request",
    entityType: null, entityId: null, title: "Booking request: Caller", payloadJson: {}, contextJson: null,
    confidence: null, status: "pending_review", reviewedBy: null, reviewedAt: null, reviewNote: null,
    executedAt: null, executionResultJson: null, idempotencyKey: null, createdAt, updatedAt: createdAt,
    downstream: null, ...over,
  };
}

const BOOKING_PAYLOAD = {
  name: "Caller",
  note: "Brakes grinding, wants them looked at",
  phone: "+12165550100",
  preferredDate: "2026-10-25",
  service: "Brake and rotor check",
};

/** The text of the line a label sits on, e.g. line("Wants:") -> "Wants: Brake and rotor check". */
const line = (label: string) => screen.getByText(label).parentElement?.textContent;

/** A decisionSummary answer that worked: empty unless the test says otherwise. */
const summary = (over: Record<string, unknown>) => ({
  available: true, days: 30, since: "2026-09-27T00:00:00.000Z", byType: [], topReasons: [], lastDecision: null, ...over,
});

beforeEach(() => {
  h.rows = [];
  h.summary = { data: summary({}) };
  h.summaryState = { isLoading: false, isError: false };
  h.inputs.length = 0;
  h.summaryCalls.length = 0;
});
afterEach(() => {
  cleanup();
  h.confirm.mockClear();
  h.approve.mockClear();
  h.reject.mockClear();
  h.summaryRefetch.mockClear();
});

describe("the card in words", () => {
  const bookingCard = () =>
    row({
      payloadJson: BOOKING_PAYLOAD,
      contextJson: { callId: "call-1" },
      createdAt: new Date("2026-10-24T15:00:00.000Z"), // Sat Oct 24, 11:00 AM in America/New_York
    });
  // "today" and "tomorrow" are read against the clock the owner looks at the card on, so pin Date only.
  const viewedAt = (iso: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  };
  afterEach(() => vi.useRealTimers());

  it("states a booking request as labelled lines, with the date as weekday and day", () => {
    viewedAt("2026-10-24T16:00:00.000Z"); // Sat Oct 24, 12:00 PM shop time
    h.rows = [bookingCard()];
    render(<ApprovalsSection />);
    expect(line("Wants:")).toBe("Wants: Brake and rotor check");
    expect(line("When:")).toBe("When: tomorrow (Sun Oct 25)");
    expect(line("Note:")).toBe("Note: Brakes grinding, wants them looked at");
    expect(line("Phone:")).toBe("Phone: (216) 555-0100");
  });

  it("hides the placeholder name 'Caller' and shows a real one", () => {
    h.rows = [bookingCard()];
    const { unmount } = render(<ApprovalsSection />);
    expect(screen.queryByText("Name:")).toBeNull();
    unmount();
    h.rows = [row({ payloadJson: { ...BOOKING_PAYLOAD, name: "Test Person" } })];
    render(<ApprovalsSection />);
    expect(line("Name:")).toBe("Name: Test Person");
  });

  it("says 'today' when the date is the shop date now, and the plain date for a later day", () => {
    viewedAt("2026-10-24T16:00:00.000Z");
    h.rows = [row({ payloadJson: { ...BOOKING_PAYLOAD, preferredDate: "2026-10-24" }, createdAt: new Date("2026-10-24T15:00:00.000Z") })];
    const { unmount } = render(<ApprovalsSection />);
    expect(line("When:")).toBe("When: today (Sat Oct 24)");
    unmount();
    h.rows = [row({ payloadJson: { ...BOOKING_PAYLOAD, preferredDate: "2026-10-30" }, createdAt: new Date("2026-10-24T15:00:00.000Z") })];
    render(<ApprovalsSection />);
    expect(line("When:")).toBe("When: Fri Oct 30");
  });

  it("reads 'tomorrow' against the day it is viewed, not the day the request was made", () => {
    viewedAt("2026-10-27T16:00:00.000Z"); // Tue Oct 27 shop time
    // Made Monday Oct 26 for Wednesday Oct 28: a day after the view, two after creation.
    h.rows = [row({ payloadJson: { ...BOOKING_PAYLOAD, preferredDate: "2026-10-28" }, createdAt: new Date("2026-10-26T15:00:00.000Z") })];
    render(<ApprovalsSection />);
    expect(line("When:")).toBe("When: tomorrow (Wed Oct 28)");
  });

  it("marks a date that has gone by as passed instead of calling it tomorrow", () => {
    viewedAt("2026-10-28T16:00:00.000Z"); // Wed Oct 28 shop time
    // Made Monday Oct 26 for Tuesday Oct 27: it said "tomorrow" when made, but that day is over.
    h.rows = [row({ payloadJson: { ...BOOKING_PAYLOAD, preferredDate: "2026-10-27" }, createdAt: new Date("2026-10-26T15:00:00.000Z") })];
    render(<ApprovalsSection />);
    expect(line("When:")).toBe("When: Tue Oct 27 (passed)");
  });

  it("keeps the raw payload and context JSON inside one closed Technical details fold, and nowhere else", () => {
    h.rows = [bookingCard()];
    const { container } = render(<ApprovalsSection />);
    const pres = Array.from(container.querySelectorAll("pre"));
    expect(pres.length).toBe(2); // payload and context, both kept
    for (const pre of pres) {
      const fold = pre.closest("details");
      expect(fold, "a <pre> outside a <details> fold is raw JSON on the card").not.toBeNull();
      expect((fold as HTMLDetailsElement).open).toBe(false);
    }
    expect(container.querySelectorAll("details").length).toBe(1);
    const fold = container.querySelector("details") as HTMLDetailsElement;
    expect(within(fold).getByText("Technical details")).toBeTruthy();
    expect(fold.textContent).toContain('"preferredDate": "2026-10-25"');
    expect(fold.textContent).toContain('"callId": "call-1"');
  });

  it("states a callback request in words", () => {
    h.rows = [
      row({
        actionType: "create_callback",
        payloadJson: { name: "Caller", phone: "216-555-0100", reason: "Asked for a call about used tires", sourcePage: "/tires" },
      }),
    ];
    render(<ApprovalsSection />);
    expect(line("Reason:")).toBe("Reason: Asked for a call about used tires");
    expect(line("Phone:")).toBe("Phone: (216) 555-0100");
    expect(line("From page:")).toBe("From page: /tires");
    expect(screen.queryByText("Name:")).toBeNull();
  });

  it("puts each top-level string or number of an unknown action type on a line and leaves objects in the fold", () => {
    h.rows = [row({ actionType: "send_thing", payloadJson: { preferredSlot: "morning", seat_count: 2, extra: { a: 1 } } })];
    const { container } = render(<ApprovalsSection />);
    expect(line("Preferred slot:")).toBe("Preferred slot: morning");
    expect(line("Seat count:")).toBe("Seat count: 2");
    expect(screen.queryByText("Extra:")).toBeNull();
    expect(container.querySelector("details")?.textContent).toContain('"extra"');
  });

  it("says where it came from in words and drops the email domain from decided lines", () => {
    h.rows = [
      row({ id: "p-1", status: "rejected", reviewedBy: "owner@example.com", reviewNote: "Duplicate" }),
      row({ id: "p-2", status: "rejected", reviewedBy: "owner@example.com", reviewNote: null }),
      row({ id: "p-3", status: "executed", reviewedBy: "owner@example.com", executedAt: ago(1) }),
    ];
    const { container } = render(<ApprovalsSection />);
    expect(screen.getByText("Turned down by owner: Duplicate")).toBeTruthy();
    expect(screen.getByText("Turned down by owner: no reason given")).toBeTruthy();
    expect(screen.getByText(/^Approved by owner( |$)/)).toBeTruthy();
    expect(container.textContent).not.toContain("example.com");
    expect(container.textContent).toContain("from the receptionist");
    expect(container.textContent).not.toContain("by nick-receptionist");
  });
});

describe("reject with one-tap reasons", () => {
  const open = () => {
    h.rows = [row({ payloadJson: BOOKING_PAYLOAD })];
    render(<ApprovalsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
  };

  it("offers the five reasons as 48px buttons that start unpressed", () => {
    open();
    // The texts come from shared/proposalReasons.ts, the list the server counts reasons by.
    expect(PROPOSAL_REASON_CHIPS.length).toBe(5);
    for (const label of PROPOSAL_REASON_CHIPS) {
      const chip = screen.getByRole("button", { name: label });
      expect(chip.getAttribute("aria-pressed")).toBe("false");
      expect(chip.className).toContain("min-h-12");
      expect(chip.className).toContain("min-w-12");
    }
  });

  it("makes Confirm reject and Keep 48px targets (apps/nickstire/AGENTS.md)", () => {
    open();
    for (const name of ["Confirm reject", "Keep"]) {
      const cls = screen.getByRole("button", { name }).className;
      expect(cls, name).toContain("min-h-12");
      expect(cls, name).toContain("min-w-12");
    }
  });

  it("sends the tapped reason as the note, and nothing until Confirm reject", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Walk-in, no booking needed" }));
    expect(screen.getByRole("button", { name: "Walk-in, no booking needed" }).getAttribute("aria-pressed")).toBe("true");
    expect(h.reject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm reject" }));
    expect(h.reject).toHaveBeenCalledTimes(1);
    expect(h.reject).toHaveBeenCalledWith({ id: "p-1", note: "Walk-in, no booking needed" });
  });

  it("adds typed detail after the reason", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    fireEvent.change(screen.getByLabelText("Add detail (optional)"), { target: { value: "same caller twice" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm reject" }));
    expect(h.reject).toHaveBeenCalledWith({ id: "p-1", note: "Duplicate · same caller twice" });
  });

  it("tapping the chosen reason again clears it; typed text alone still goes through; no reason sends no note", () => {
    open();
    const chip = () => screen.getByRole("button", { name: "Other" });
    fireEvent.click(chip());
    fireEvent.click(chip());
    expect(chip().getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Confirm reject" }));
    expect(h.reject).toHaveBeenLastCalledWith({ id: "p-1", note: undefined });
    fireEvent.change(screen.getByLabelText("Add detail (optional)"), { target: { value: "wrong shop" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm reject" }));
    expect(h.reject).toHaveBeenLastCalledWith({ id: "p-1", note: "wrong shop" });
  });

  it("Keep closes the form without sending anything", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(h.reject).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Confirm reject" })).toBeNull();
  });
});

describe("the last 30 days summary (proposals.decisionSummary)", () => {
  const B = "create_booking_request";
  const C = "create_callback";

  it("shows approved and turned down per type, and the top reasons exactly as the server counted them", () => {
    h.summary.data = summary({
      byType: [
        { actionType: B, approved: 2, turnedDown: 4 },
        { actionType: C, approved: 1, turnedDown: 2 },
      ],
      topReasons: [
        { reason: "Walk-in, no booking needed", count: 2 },
        { reason: "No reason given", count: 2 },
        { reason: "Duplicate", count: 1 },
      ],
    });
    render(<ApprovalsSection />);
    expect(screen.getByText("Last 30 days")).toBeTruthy();
    expect(screen.getByText("Booking requests: 2 approved, 4 turned down")).toBeTruthy();
    expect(screen.getByText("Callback requests: 1 approved, 2 turned down")).toBeTruthy();
    expect(screen.getByText("Walk-in, no booking needed · 2")).toBeTruthy();
    expect(screen.getByText("No reason given · 2")).toBeTruthy();
    expect(screen.getByText("Duplicate · 1")).toBeTruthy();
    // The server read has no row cap, so no hedging copy is left.
    expect(document.body.textContent).not.toMatch(/at least|read stopped|may be low/i);
  });

  it("falls back to the raw action type for a type it has no words for", () => {
    h.summary.data = summary({ byType: [{ actionType: "send_thing", approved: 0, turnedDown: 1 }], topReasons: [{ reason: "Duplicate", count: 1 }] });
    render(<ApprovalsSection />);
    expect(screen.getByText("send_thing: 0 approved, 1 turned down")).toBeTruthy();
  });

  it("says there were no decisions when the read worked and the window is empty", () => {
    h.summary.data = summary({});
    render(<ApprovalsSection />);
    expect(screen.getByText("No decisions in the last 30 days.")).toBeTruthy();
  });

  it("says the number is not known, not zero, when the server says the read was unavailable, and the list still renders", () => {
    h.summary.data = { available: false, reason: "error", message: "The decision history could not be read." };
    h.rows = [row({ payloadJson: BOOKING_PAYLOAD })];
    render(<ApprovalsSection />);
    expect(screen.getByText("Last 30 days: not known (the read failed).")).toBeTruthy();
    expect(screen.queryByText("No decisions in the last 30 days.")).toBeNull();
    expect(screen.queryByText(/approved,/)).toBeNull();
    expect(screen.getByRole("button", { name: "Approve & execute" })).toBeTruthy();
    const again = screen.getByRole("button", { name: "Read again" });
    expect(again.className).toContain("min-h-12");
    expect(again.className).toContain("min-w-12");
    fireEvent.click(again);
    expect(h.summaryRefetch).toHaveBeenCalledTimes(1);
  });

  it("says the same when the query itself errors", () => {
    h.summaryState = { isLoading: false, isError: true };
    h.summary.data = undefined;
    h.rows = [row({ payloadJson: BOOKING_PAYLOAD })];
    render(<ApprovalsSection />);
    expect(screen.getByText("Last 30 days: not known (the read failed).")).toBeTruthy();
    expect(screen.queryByText("No decisions in the last 30 days.")).toBeNull();
    expect(screen.getByRole("button", { name: "Approve & execute" })).toBeTruthy();
  });

  it("says it is reading while the first answer is on its way", () => {
    h.summaryState = { isLoading: true, isError: false };
    h.summary.data = undefined;
    render(<ApprovalsSection />);
    expect(screen.getByText("Last 30 days: reading…")).toBeTruthy();
  });

  it("asks for 30 days and refreshes every 5 minutes, only while the page is in view", () => {
    render(<ApprovalsSection />);
    expect(h.summaryCalls.length).toBeGreaterThan(0);
    for (const call of h.summaryCalls) {
      expect(call.input).toEqual({ days: 30 });
      expect(call.opts).toEqual({ refetchInterval: 300_000, refetchIntervalInBackground: false });
    }
  });

  it("no longer reads decided proposals through proposals.list", () => {
    render(<ApprovalsSection />);
    expect(h.inputs.length).toBeGreaterThan(0);
    for (const input of h.inputs) {
      expect(input?.limit).toBe(100);
      expect(JSON.stringify(input?.statuses)).not.toMatch(/executed|rejected/);
    }
  });
});

describe("the empty Needs-decision state", () => {
  const last = (over: Record<string, unknown>) => ({ at: "2026-10-24T19:30:00.000Z", decision: "turned_down", actionType: "create_booking_request", ...over }); // 3:30 PM EDT

  it("says nothing is waiting and names the last decision on the shop clock", () => {
    h.summary.data = summary({ lastDecision: last({}) });
    render(<ApprovalsSection />);
    expect(screen.getByText("Nothing waiting for you.")).toBeTruthy();
    expect(screen.getByText("Last decision: Sat Oct 24, 3:30 PM, turned down (booking request)")).toBeTruthy();
  });

  it("names an approval and a callback in words", () => {
    h.summary.data = summary({ lastDecision: last({ decision: "approved", actionType: "create_callback" }) });
    render(<ApprovalsSection />);
    expect(screen.getByText("Last decision: Sat Oct 24, 3:30 PM, approved (callback request)")).toBeTruthy();
  });

  it("drops the type when the server does not know it", () => {
    h.summary.data = summary({ lastDecision: last({ decision: "approved", actionType: null }) });
    render(<ApprovalsSection />);
    expect(screen.getByText("Last decision: Sat Oct 24, 3:30 PM, approved")).toBeTruthy();
  });

  it("shows the last decision even when nothing was decided in the 30 days", () => {
    h.summary.data = summary({ lastDecision: last({ at: "2026-08-01T15:00:00.000Z" }) });
    render(<ApprovalsSection />);
    expect(screen.getByText("No decisions in the last 30 days.")).toBeTruthy();
    expect(screen.getByText("Last decision: Sat Aug 1, 11:00 AM, turned down (booking request)")).toBeTruthy();
  });

  it("says 'No decisions yet.' when the read worked and there has never been one", () => {
    render(<ApprovalsSection />);
    expect(screen.getByText("Nothing waiting for you.")).toBeTruthy();
    expect(screen.getByText("No decisions yet.")).toBeTruthy();
  });

  it("adds nothing about decisions when the read was unavailable", () => {
    h.summary.data = { available: false, reason: "no_db", message: "no database" };
    render(<ApprovalsSection />);
    expect(screen.getByText("Nothing waiting for you.")).toBeTruthy();
    expect(screen.queryByText(/Last decision/)).toBeNull();
    expect(screen.queryByText("No decisions yet.")).toBeNull();
  });

  it("adds nothing about decisions when the query errored", () => {
    h.summaryState = { isLoading: false, isError: true };
    h.summary.data = undefined;
    render(<ApprovalsSection />);
    expect(screen.queryByText(/Last decision/)).toBeNull();
    expect(screen.queryByText("No decisions yet.")).toBeNull();
  });
});

describe("page chrome", () => {
  it("states the subtitle in plain words", () => {
    render(<ApprovalsSection />);
    expect(
      screen.getByText("Requests the receptionist and one-tap actions want to run. Nothing here runs until you approve it."),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("Autonomy ladder");
  });

  it("makes every filter chip a 48px target", () => {
    render(<ApprovalsSection />);
    for (const label of ["Needs decision", "Executed", "Rejected", "Failed / stuck", "All"]) {
      const cls = screen.getByRole("button", { name: label }).className;
      expect(cls, label).toContain("min-h-12");
      expect(cls, label).toContain("min-w-12");
    }
  });

  it("makes Approve and Reject 48px targets", () => {
    h.rows = [row({ payloadJson: BOOKING_PAYLOAD })];
    render(<ApprovalsSection />);
    for (const name of ["Approve & execute", "Reject"]) {
      const cls = screen.getByRole("button", { name }).className;
      expect(cls, name).toContain("min-h-12");
      expect(cls, name).toContain("min-w-12");
      expect(cls, name).not.toContain("min-h-[44px]");
    }
  });

  it("makes Retry, Resume and the two ambiguous-outcome buttons 48px targets", () => {
    h.rows = [
      row({ id: "f", status: "failed" }),
      row({ id: "a", status: "approved" }),
      row({ id: "x", status: "execution_ambiguous" }),
    ];
    render(<ApprovalsSection />);
    for (const name of ["Retry execution", "Resume execution", "It DID happen", "It never happened"]) {
      const cls = screen.getByRole("button", { name }).className;
      expect(cls, name).toContain("min-h-12");
      expect(cls, name).toContain("min-w-12");
    }
  });

  it("makes the Technical details summary a 48px target", () => {
    h.rows = [row({ payloadJson: BOOKING_PAYLOAD })];
    const { container } = render(<ApprovalsSection />);
    const cls = container.querySelector("details > summary")?.className ?? "";
    expect(cls).toContain("min-h-12");
    expect(cls).toContain("min-w-12");
  });
});
