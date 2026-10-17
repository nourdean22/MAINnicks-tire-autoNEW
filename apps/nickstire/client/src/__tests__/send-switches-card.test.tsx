/**
 * Send switches card on Instagram > Pipeline health (contract sendSwitchesStatus v1, C5.5).
 *
 * The five send_pause_<lane> flags stop unattended calls and texts by lane. This card is the
 * consumer of the server's status read and of featureFlags.toggle. TRUE = paused. Three chip
 * states, never two: a switch that could not be read is Unknown and is never rendered as Live,
 * and a failed toggle leaves the chip alone and says why in words. Pause is one tap (the safe
 * direction); Resume asks first through the in-DOM confirmDialog, because window.confirm is
 * suppressed in the iOS standalone PWA. Rendered through Pipeline so the test also proves the
 * card is mounted.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";

type Lane = { lane: string; paused: boolean | null; readable: boolean; failClass: "closed" | "open"; envArmed: boolean | null; heldQueued?: number | null };

const h = vi.hoisted(() => ({
  status: undefined as { lanes: Lane[] } | undefined,
  isError: false,
  isLoading: false,
  refetch: vi.fn(),
  toggleMutate: vi.fn(),
  toggleError: null as string | null,
  confirmDialog: vi.fn(),
  confirmAnswer: false,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: h.confirmDialog }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    instagramAdmin: {
      reelPipelineHealth: {
        useQuery: () => ({ data: { available: false, reason: "reel read off in this test" }, isLoading: false, refetch: vi.fn() }),
      },
      // The neighbouring cards stay loading so their buttons never compete with this card's.
      autopostLaneStatus: { useQuery: () => ({ data: undefined, isError: false, isLoading: true, refetch: vi.fn(), dataUpdatedAt: 0 }) },
      startAutopostRun: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      commentResponderStatus: { useQuery: () => ({ data: undefined, isError: false, isLoading: true, refetch: vi.fn() }) },
      sendSwitchesStatus: {
        useQuery: () => ({ data: h.status, isError: h.isError, isLoading: h.isLoading, refetch: h.refetch }),
      },
    },
    featureFlags: {
      toggle: {
        // Runs the card's own onSuccess / onError / onSettled, so the row state is the real one.
        useMutation: (opts?: {
          onSuccess?: (r: unknown) => void;
          onError?: (e: Error, vars: { key: string; value: boolean }) => void;
          onSettled?: () => void;
        }) => ({
          mutate: (vars: { key: string; value: boolean }) => {
            h.toggleMutate(vars);
            if (h.toggleError) opts?.onError?.(new Error(h.toggleError), vars);
            else opts?.onSuccess?.(vars);
            opts?.onSettled?.();
          },
          isPending: false,
        }),
      },
    },
  },
}));

import { Pipeline } from "../pages/admin/instagram/Pipeline";

const LABEL: Record<string, string> = {
  voice_outbound: "Outbound calls",
  customer_confirmations: "Order confirmations",
  declined_recovery: "Declined-work follow-ups",
  weather_sms: "Weather texts",
  missed_call_recovery: "Missed-call texts",
};
const LANES = Object.keys(LABEL);
const CLOSED_NOTE = "This switch could not be read, state unknown. A failed read holds this lane's automatic sends until it reads.";
const OPEN_NOTE = "This switch could not be read, state unknown. A failed read does not hold this lane, so confirmations keep sending.";

const lane = (name: string, over: Partial<Lane> = {}): Lane => ({
  lane: name,
  paused: false,
  readable: true,
  failClass: name === "customer_confirmations" ? "open" : "closed",
  envArmed: true,
  ...over,
});
const all = (over: Partial<Lane> = {}) => ({ lanes: LANES.map((n) => lane(n, over)) });

/** live, paused, unknown, live with env off, live with env unknown */
const MIXED = {
  lanes: [
    lane("voice_outbound"),
    lane("customer_confirmations", { paused: true }),
    lane("declined_recovery", { paused: null, readable: false }),
    lane("weather_sms", { envArmed: false }),
    lane("missed_call_recovery", { envArmed: null }),
  ],
};

const row = (name: string) => screen.getByText(LABEL[name]).closest("li") as HTMLElement;
const pause = (name: string) => screen.getByRole("button", { name: `Pause ${LABEL[name]}` });
const resume = (name: string) => screen.getByRole("button", { name: `Resume ${LABEL[name]}` });

let nativeConfirm: MockInstance<typeof window.confirm>;
beforeEach(() => {
  h.status = undefined;
  h.isError = false;
  h.isLoading = false;
  h.toggleError = null;
  h.refetch.mockClear();
  h.toggleMutate.mockClear();
  h.confirmDialog.mockReset();
  h.confirmDialog.mockImplementation(async () => h.confirmAnswer);
  h.confirmAnswer = false;
  nativeConfirm = vi.spyOn(window, "confirm");
});
afterEach(() => {
  expect(nativeConfirm).not.toHaveBeenCalled();
  nativeConfirm.mockRestore();
  vi.unstubAllGlobals();
  cleanup();
});

describe("Send switches card: three chip states, never two", () => {
  it("is mounted on Pipeline health and renders one row per lane with its state chip", () => {
    h.status = MIXED;
    render(<Pipeline />);
    expect(screen.getByText("Send switches")).toBeTruthy();
    expect(within(row("voice_outbound")).getByText("Live")).toBeTruthy();
    expect(within(row("customer_confirmations")).getByText("Paused")).toBeTruthy();
    expect(within(row("declined_recovery")).getByText("Unknown")).toBeTruthy();
    expect(within(row("weather_sms")).getByText("Live")).toBeTruthy();
    expect(within(row("missed_call_recovery")).getByText("Live")).toBeTruthy();
  });

  it("an unreadable switch renders the word Unknown and never Live", () => {
    h.status = MIXED;
    render(<Pipeline />);
    const r = row("declined_recovery");
    expect(within(r).queryByText("Live")).toBeNull();
    expect(within(r).queryByText("Paused")).toBeNull();
    expect(within(r).getByText(CLOSED_NOTE)).toBeTruthy();
  });

  it("readable false is Unknown even when the server sent paused false", () => {
    h.status = { lanes: [lane("voice_outbound", { paused: false, readable: false }), ...LANES.slice(1).map((n) => lane(n))] };
    render(<Pipeline />);
    expect(within(row("voice_outbound")).getByText("Unknown")).toBeTruthy();
    expect(within(row("voice_outbound")).queryByText("Live")).toBeNull();
  });

  it("an open-fail lane says a failed read does not hold it", () => {
    h.status = { lanes: [lane("customer_confirmations", { paused: null, readable: false }), ...LANES.filter((n) => n !== "customer_confirmations").map((n) => lane(n))] };
    render(<Pipeline />);
    expect(within(row("customer_confirmations")).getByText(OPEN_NOTE)).toBeTruthy();
  });

  it("shows the env line in words: armed, off, unknown", () => {
    h.status = MIXED;
    render(<Pipeline />);
    expect(within(row("voice_outbound")).getByText("env armed")).toBeTruthy();
    expect(within(row("weather_sms")).getByText("env off")).toBeTruthy();
    expect(within(row("missed_call_recovery")).getByText("env unknown")).toBeTruthy();
  });

  it("a lane missing from the response is Unknown, not Live, and still says what a failed read does", () => {
    h.status = { lanes: LANES.filter((n) => n !== "missed_call_recovery" && n !== "customer_confirmations").map((n) => lane(n)) };
    render(<Pipeline />);
    expect(within(row("missed_call_recovery")).getByText("Unknown")).toBeTruthy();
    expect(within(row("missed_call_recovery")).queryByText("Live")).toBeNull();
    expect(within(row("missed_call_recovery")).getByText(CLOSED_NOTE)).toBeTruthy();
    expect(within(row("customer_confirmations")).getByText(OPEN_NOTE)).toBeTruthy();
  });

  it("a failed query still says per row whether a failed read holds the lane (static fail class)", () => {
    h.isError = true;
    render(<Pipeline />);
    for (const n of LANES) {
      expect(within(row(n)).getByText(n === "customer_confirmations" ? OPEN_NOTE : CLOSED_NOTE)).toBeTruthy();
    }
  });

  it("a failed read of the whole card is five Unknown rows with Retry, and never Live", () => {
    h.isError = true;
    render(<Pipeline />);
    for (const n of LANES) {
      expect(within(row(n)).getByText("Unknown")).toBeTruthy();
      expect(within(row(n)).queryByText("Live")).toBeNull();
    }
    expect(screen.getByText("Send switch state could not be read, state unknown")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it("a failed read still lets the operator pause a lane", () => {
    h.isError = true;
    render(<Pipeline />);
    expect((pause("weather_sms") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(pause("weather_sms"));
    expect(h.toggleMutate).toHaveBeenCalledWith({ key: "send_pause_weather_sms", value: true });
  });

  it("loading renders no chips", () => {
    h.isLoading = true;
    render(<Pipeline />);
    expect(screen.getByText("Send switches")).toBeTruthy();
    expect(screen.queryByText("Live")).toBeNull();
    expect(screen.queryByText("Unknown")).toBeNull();
  });
});

describe("Pause and Resume", () => {
  it.each(LANES)("Pause %s is one tap: no dialog, the lane's own flag set to true", (n) => {
    h.status = all();
    render(<Pipeline />);
    fireEvent.click(pause(n));
    expect(h.confirmDialog).not.toHaveBeenCalled();
    expect(h.toggleMutate).toHaveBeenCalledTimes(1);
    expect(h.toggleMutate).toHaveBeenCalledWith({ key: `send_pause_${n}`, value: true });
  });

  it("Pause on an Unknown switch works and sets true", () => {
    h.status = MIXED;
    render(<Pipeline />);
    fireEvent.click(pause("declined_recovery"));
    expect(h.confirmDialog).not.toHaveBeenCalled();
    expect(h.toggleMutate).toHaveBeenCalledWith({ key: "send_pause_declined_recovery", value: true });
  });

  it.each(LANES)("Resume %s asks first with the flag policy copy, and toggles false only on confirm", async (n) => {
    h.status = all({ paused: true });
    render(<Pipeline />);
    fireEvent.click(resume(n));
    await waitFor(() => expect(h.confirmDialog).toHaveBeenCalledTimes(1));
    const opts = h.confirmDialog.mock.calls[0][0];
    expect(String(opts.title)).toContain(`send_pause_${n} OFF`);
    expect(opts.cancelLabel).toBe("Stay paused");
    expect(h.toggleMutate).not.toHaveBeenCalled();

    h.confirmAnswer = true;
    fireEvent.click(resume(n));
    await waitFor(() => expect(h.toggleMutate).toHaveBeenCalledWith({ key: `send_pause_${n}`, value: false }));
    expect(h.toggleMutate).toHaveBeenCalledTimes(1);
  });

  const QUEUE_LINE = "Texts queued before or during the pause send on resume.";
  const resumeMessage = async (over: Partial<Lane>) => {
    h.status = all({ paused: true, ...over });
    render(<Pipeline />);
    fireEvent.click(resume("weather_sms"));
    await waitFor(() => expect(h.confirmDialog).toHaveBeenCalledTimes(1));
    return String(h.confirmDialog.mock.calls[0][0].message);
  };

  it("the Resume dialog always carries the plain queued-texts line, after the policy copy", async () => {
    const msg = await resumeMessage({});
    expect(msg).toContain(QUEUE_LINE);
    expect(msg).toContain("Resuming lets weather-triggered texts go to lapsed customers again");
    expect(msg).not.toMatch(/will send now|queued count unknown/);
  });

  it("the Resume dialog shows the held count when the status row carries one", async () => {
    const msg = await resumeMessage({ heldQueued: 3 });
    expect(msg).toContain(QUEUE_LINE);
    expect(msg).toContain("3 queued texts will send now");
  });

  it("the Resume dialog says the queued count is unknown when heldQueued is null", async () => {
    const msg = await resumeMessage({ heldQueued: null });
    expect(msg).toContain(QUEUE_LINE);
    expect(msg).toContain("queued count unknown");
    expect(msg).not.toContain("will send now");
  });

  it("a cancelled Resume changes nothing", async () => {
    h.status = MIXED;
    render(<Pipeline />);
    fireEvent.click(resume("customer_confirmations"));
    await waitFor(() => expect(h.confirmDialog).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(h.toggleMutate).not.toHaveBeenCalled();
  });

  it("a successful toggle refetches the status", () => {
    h.status = all();
    render(<Pipeline />);
    fireEvent.click(pause("voice_outbound"));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it("a toggle refetches at once and again after 6 s, and never flips the chip before a read says so", () => {
    vi.useFakeTimers();
    try {
      h.status = all();
      render(<Pipeline />);
      fireEvent.click(pause("voice_outbound"));
      expect(h.refetch).toHaveBeenCalledTimes(1);
      expect(within(row("voice_outbound")).getByText("Live")).toBeTruthy();
      vi.advanceTimersByTime(5999);
      expect(h.refetch).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(h.refetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the 6 s refetch is cancelled when the card unmounts", () => {
    vi.useFakeTimers();
    try {
      h.status = all();
      const view = render(<Pipeline />);
      fireEvent.click(pause("voice_outbound"));
      view.unmount();
      vi.advanceTimersByTime(7000);
      expect(h.refetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a toggle error shows its text under that row and leaves the chip alone", () => {
    h.status = all();
    h.toggleError = "Operation failed";
    render(<Pipeline />);
    fireEvent.click(pause("voice_outbound"));
    const r = row("voice_outbound");
    expect(within(r).getByText("Pause failed: Operation failed")).toBeTruthy();
    expect(within(r).getByText("Live")).toBeTruthy();
    expect(within(r).queryByText("Paused")).toBeNull();
    expect(screen.queryAllByText(/failed: Operation failed/)).toHaveLength(1);
  });
});

describe("Phone layout (390 px)", () => {
  it("rows stack, wrap long text, and hold 48 px targets with no fixed widths", () => {
    h.status = MIXED;
    const { container } = render(<Pipeline />);
    // The shared Button and Badge carry whitespace-nowrap for their one-word labels; the card's own
    // text elements (labels, env line, notes, errors) must be free to wrap.
    const own = Array.from(row("voice_outbound").parentElement!.querySelectorAll("*")).filter((el) => !el.closest("[data-slot=button],[data-slot=badge]"));
    for (const el of own) expect(el.className).not.toMatch(/whitespace-nowrap|truncate|overflow-x/);
    const card = (screen.getByText("Send switches").closest("[class*='rounded']") as HTMLElement).innerHTML;
    expect(card).not.toMatch(/\bw-\[\d|\bmin-w-\[\d|overflow-x|\bw-(?:screen|\d{2,})\b/);
    for (const n of LANES) {
      const btn = row(n).querySelector("button") as HTMLButtonElement;
      expect(btn.className).toContain("min-h-12");
      expect(row(n).className).toContain("flex-col");
      expect(row(n).className).toContain("min-w-0");
    }
    expect(container.querySelectorAll("li").length).toBeGreaterThanOrEqual(5);
  });
});
