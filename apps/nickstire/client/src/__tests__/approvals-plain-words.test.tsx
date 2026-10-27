/**
 * Approvals in plain words (admin tabs job, 2026-10-27).
 *
 * The queue used to print the raw executor payload as JSON on every card, said nothing when it was
 * empty, hid the shop's own turn-down rate, and gave the owner a blank box for the reason, so 56 of 71
 * proposals were rejected with nobody able to learn why. These tests pin the card in words, the
 * one-tap reasons, the 30-day summary (with its cap and failed-read states) and the empty state.
 *
 * No real names or phones: "Caller" and 216-555-0100 style numbers only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

type Summary = { data: unknown[] | undefined; isLoading: boolean; isError: boolean };
const h = vi.hoisted(() => ({
  confirm: vi.fn(async (_opts: Record<string, unknown>) => false),
  approve: vi.fn(),
  reject: vi.fn(),
  summaryRefetch: vi.fn(),
  inputs: [] as Array<Record<string, unknown> | undefined>,
  rows: [] as unknown[],
  summary: { data: [], isLoading: false, isError: false } as Summary,
}));
vi.mock("@/lib/trpc", () => {
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery")
          return (input?: Record<string, unknown>) => {
            if (path !== "proposals.list") return { data: [], isLoading: false, isError: false, error: null, refetch: () => {} };
            h.inputs.push(input);
            // The summary is the second read of the same procedure: the one with the 500-row limit.
            if (input?.limit === 500) return { ...h.summary, error: null, refetch: h.summaryRefetch };
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

beforeEach(() => {
  h.rows = [];
  h.summary = { data: [], isLoading: false, isError: false };
  h.inputs.length = 0;
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
    for (const label of ["Walk-in, no booking needed", "Not a real request", "Already handled", "Duplicate", "Other"]) {
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

describe("the last 30 days summary", () => {
  const decided = (id: string, actionType: string, status: string, days: number, reviewNote: string | null = null) =>
    row({ id, actionType, status, createdAt: ago(days), reviewedAt: ago(days), reviewNote, reviewedBy: "owner@example.com" });
  /** Created and decided on different days; decidedDaysAgo null is a legacy row with no reviewedAt. */
  const decidedLater = (id: string, status: string, createdDaysAgo: number, decidedDaysAgo: number | null, actionType = "create_booking_request") =>
    row({ id, actionType, status, createdAt: ago(createdDaysAgo), reviewedAt: decidedDaysAgo === null ? null : ago(decidedDaysAgo), reviewedBy: "owner@example.com" });
  const B = "create_booking_request";
  const C = "create_callback";

  it("counts approved and turned down per type, and the top three reasons, inside the 30 days only", () => {
    h.summary.data = [
      decided("b1", B, "executed", 5),
      decided("b2", B, "executed", 6),
      decided("b3", B, "rejected", 2, "Walk-in, no booking needed"),
      decided("b4", B, "rejected", 3, "Walk-in, no booking needed · phone was busy"),
      decided("b5", B, "rejected", 4, null),
      decided("b6", B, "rejected", 5, "Not a real request"),
      decided("c1", C, "executed", 1),
      decided("c2", C, "rejected", 1, "Duplicate"),
      decided("c3", C, "rejected", 2, "   "),
      decided("old1", B, "rejected", 40, "Duplicate"), // outside the window: must not count
      decided("old2", C, "executed", 45),
    ];
    render(<ApprovalsSection />);
    expect(screen.getByText("Last 30 days")).toBeTruthy();
    expect(screen.getByText("Booking requests: 2 approved, 4 turned down")).toBeTruthy();
    expect(screen.getByText("Callback requests: 1 approved, 2 turned down")).toBeTruthy();
    // A chip with typed detail still counts under the chip.
    expect(screen.getByText("Walk-in, no booking needed · 2")).toBeTruthy();
    // A missing or blank note is "No reason given".
    expect(screen.getByText("No reason given · 2")).toBeTruthy();
    expect(screen.getByText("Duplicate · 1")).toBeTruthy();
    // Four reasons exist; only the top three show, and the old Duplicate did not count.
    expect(screen.queryByText(/Not a real request · /)).toBeNull();
    expect(screen.queryByText(/at least/i)).toBeNull();
  });

  it("falls back to the raw action type for a type it has no words for", () => {
    h.summary.data = [decided("x1", "send_thing", "rejected", 2, "Duplicate")];
    render(<ApprovalsSection />);
    expect(screen.getByText("send_thing: 0 approved, 1 turned down")).toBeTruthy();
  });

  it("says 'at least' on every number when the read hit its 500-row cap, and says why", () => {
    h.summary.data = Array.from({ length: 500 }, (_, i) => decided(`r${i}`, B, "rejected", 1, "Duplicate"));
    render(<ApprovalsSection />);
    expect(screen.getByText("Booking requests: at least 0 approved, at least 500 turned down")).toBeTruthy();
    expect(screen.getByText("Duplicate · at least 500")).toBeTruthy();
    expect(screen.getByText("The read stopped at 500 requests, so these counts may be low.")).toBeTruthy();
  });

  it("cannot call a full read empty: older-created requests decided in the window may be past the cap", () => {
    h.summary.data = Array.from({ length: 500 }, (_, i) => decided(`o${i}`, B, "rejected", 60, "Duplicate"));
    render(<ApprovalsSection />);
    expect(screen.queryByText("No decisions in the last 30 days.")).toBeNull();
    expect(screen.getByText("No decisions found in the last 30 days. The read stopped at 500 requests, so there may be more.")).toBeTruthy();
  });

  it("counts every decided status the human said yes to as approved, not only executed", () => {
    h.summary.data = [
      decided("a1", B, "executed", 5),
      decided("a2", B, "failed", 4),
      decided("a3", B, "approved", 3),
      decided("a4", B, "executing", 2),
      decided("a5", B, "execution_ambiguous", 1),
      decided("t1", B, "rejected", 1, "Duplicate"),
      decided("n1", B, "pending_review", 1), // not decided yet: counts for neither
      decided("n2", B, "draft", 1),
    ];
    render(<ApprovalsSection />);
    expect(screen.getByText("Booking requests: 5 approved, 1 turned down")).toBeTruthy();
  });

  it("windows the 30 days by when it was decided, so an old proposal decided today counts", () => {
    h.summary.data = [
      decidedLater("late", "executed", 40, 0), // created 40 days ago, decided today
      decidedLater("early", "rejected", 10, 35), // created 10 days ago, decided 35 days ago
    ];
    render(<ApprovalsSection />);
    expect(screen.getByText("Booking requests: 1 approved, 0 turned down")).toBeTruthy();
  });

  it("falls back to the created time for a legacy row with no reviewedAt, and keeps it", () => {
    h.summary.data = [
      decidedLater("legacy-new", "rejected", 5, null),
      decidedLater("legacy-old", "rejected", 40, null),
    ];
    render(<ApprovalsSection />);
    expect(screen.getByText("Booking requests: 0 approved, 1 turned down")).toBeTruthy();
    expect(screen.getByText("No reason given · 1")).toBeTruthy();
  });

  it("says the number is not known, not zero, when the second read failed, and the list still renders", () => {
    h.summary = { data: undefined, isLoading: false, isError: true };
    h.rows = [row({ payloadJson: BOOKING_PAYLOAD })];
    render(<ApprovalsSection />);
    expect(screen.getByText("Last 30 days: not known (the read failed).")).toBeTruthy();
    expect(screen.queryByText("No decisions in the last 30 days.")).toBeNull();
    expect(screen.getByRole("button", { name: "Approve & execute" })).toBeTruthy();
    const again = screen.getByRole("button", { name: "Read again" });
    expect(again.className).toContain("min-h-12");
    expect(again.className).toContain("min-w-12");
    fireEvent.click(again);
    expect(h.summaryRefetch).toHaveBeenCalledTimes(1);
  });

  it("says there were no decisions when the read worked and the window is empty", () => {
    h.summary.data = [decided("old", B, "rejected", 40, "Duplicate")];
    render(<ApprovalsSection />);
    expect(screen.getByText("No decisions in the last 30 days.")).toBeTruthy();
  });

  it("reads the summary with a different query than the filtered list", () => {
    render(<ApprovalsSection />);
    const summaryRead = h.inputs.find((i) => i?.limit === 500);
    const listRead = h.inputs.find((i) => i?.limit === 100);
    expect(summaryRead).toEqual({
      statuses: ["executed", "rejected", "failed", "approved", "executing", "execution_ambiguous"],
      limit: 500,
    });
    expect(listRead).toBeDefined();
    expect(JSON.stringify(listRead)).not.toBe(JSON.stringify(summaryRead));
  });
});

describe("the empty Needs-decision state", () => {
  it("says nothing is waiting and names the last decision on the shop clock", () => {
    h.summary.data = [
      row({ id: "old", status: "executed", createdAt: new Date("2026-08-01T15:00:00.000Z"), reviewedAt: new Date("2026-08-01T15:00:00.000Z") }),
      row({
        id: "last", status: "rejected", actionType: "create_booking_request",
        createdAt: new Date("2026-10-24T18:00:00.000Z"), reviewedAt: new Date("2026-10-24T19:30:00.000Z"), // 3:30 PM EDT
      }),
    ];
    render(<ApprovalsSection />);
    expect(screen.getByText("Nothing waiting for you.")).toBeTruthy();
    expect(screen.getByText("Last decision: Sat Oct 24, 3:30 PM, turned down (booking request)")).toBeTruthy();
  });

  it("lets an approved-then-failed request be the last decision", () => {
    h.summary.data = [
      row({ id: "r", status: "rejected", createdAt: new Date("2026-10-23T15:00:00.000Z"), reviewedAt: new Date("2026-10-23T16:00:00.000Z") }),
      row({
        id: "f", status: "failed", actionType: "create_callback",
        createdAt: new Date("2026-10-22T15:00:00.000Z"), reviewedAt: new Date("2026-10-24T19:30:00.000Z"), // approved later, then failed
      }),
    ];
    render(<ApprovalsSection />);
    expect(screen.getByText("Last decision: Sat Oct 24, 3:30 PM, approved (callback request)")).toBeTruthy();
  });

  it("uses the created time as the decision time for a legacy row with no reviewedAt", () => {
    h.summary.data = [row({ id: "l", status: "rejected", createdAt: new Date("2026-10-24T19:30:00.000Z"), reviewedAt: null })];
    render(<ApprovalsSection />);
    expect(screen.getByText("Last decision: Sat Oct 24, 3:30 PM, turned down (booking request)")).toBeTruthy();
  });

  it("says 'No decisions yet.' when the read worked and found none", () => {
    render(<ApprovalsSection />);
    expect(screen.getByText("Nothing waiting for you.")).toBeTruthy();
    expect(screen.getByText("No decisions yet.")).toBeTruthy();
  });

  it("adds nothing about decisions when that read failed", () => {
    h.summary = { data: undefined, isLoading: false, isError: true };
    render(<ApprovalsSection />);
    expect(screen.getByText("Nothing waiting for you.")).toBeTruthy();
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
