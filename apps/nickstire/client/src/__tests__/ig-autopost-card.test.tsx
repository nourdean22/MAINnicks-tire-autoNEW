/**
 * Image autopost card on Instagram > Pipeline health (contract autopostLaneStatus v1).
 *
 * The image lane posts unattended. This card is the consumer of three server
 * writers: the lane status read, the run-now door and the inverted pause flag.
 * Three states, never two: a failed read says "state unknown, not empty" and
 * never renders "0 posted". Run now and Resume go through the in-DOM
 * confirmDialog (window.confirm is suppressed in the iOS standalone PWA);
 * Pause is one tap, because pausing is the safe direction.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

type Status = Record<string, unknown> | undefined;

const h = vi.hoisted(() => ({
  status: undefined as Status,
  isError: false,
  isLoading: false,
  refetch: vi.fn(),
  runMutate: vi.fn(),
  toggleMutate: vi.fn(),
  confirmDialog: vi.fn(),
  confirmAnswer: false,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: h.confirmDialog }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    instagramAdmin: {
      // The reel half of the view reads as UNKNOWN here; the image card must render anyway.
      reelPipelineHealth: {
        useQuery: () => ({ data: { available: false, reason: "reel read off in this test" }, isLoading: false, refetch: vi.fn() }),
      },
      autopostLaneStatus: {
        useQuery: () => ({ data: h.status, isError: h.isError, isLoading: h.isLoading, refetch: h.refetch }),
      },
    },
    nickActions: {
      fireIgAutopostNow: { useMutation: () => ({ mutate: h.runMutate, isPending: false }) },
    },
    featureFlags: {
      toggle: { useMutation: () => ({ mutate: h.toggleMutate, isPending: false }) },
    },
  },
}));

import { Pipeline } from "../pages/admin/instagram/Pipeline";

const ERROR_STATUS = { available: false, reason: "Autopost history could not be read: connection reset" };
const UNMEASURED_STATUS = {
  available: true, paused: false, live: true, lastPosted: null, today: [], recent: [],
  counts7d: { posted: 0, failed: 0, aborted: 0, dryrun: 0, runs: 0 },
};
const measured = (over: Record<string, unknown> = {}) => ({
  available: true,
  paused: false,
  live: true,
  lastPosted: { id: 41, slot: "midday", slotDate: "2026-10-15", igPostId: "17900000000000001", createdAt: new Date("2026-10-15T17:07:00Z") },
  today: [{ slot: "morning", status: "aborted", createdAt: new Date("2026-10-16T12:07:00Z"), error: "judge score 5.1 below the 7.0 bar" }],
  recent: [
    { id: 42, slot: "morning", slotDate: "2026-10-16", status: "aborted", source: "cron", igPostId: null, error: "judge score 5.1 below the 7.0 bar", overallScore: 5.1, createdAt: new Date("2026-10-16T12:07:00Z") },
    // A Date may arrive as a string; the card must still render it.
    { id: 41, slot: "midday", slotDate: "2026-10-15", status: "posted", source: "cron", igPostId: "17900000000000001", error: null, overallScore: 8.4, createdAt: "2026-10-15T17:07:00.000Z" },
  ],
  counts7d: { posted: 13, failed: 0, aborted: 10, dryrun: 0, runs: 23 },
  ...over,
});

const runNow = () => screen.getByRole("button", { name: "Run a slot now" });

let nativeConfirm: MockInstance<typeof window.confirm>;
beforeEach(() => {
  h.status = undefined;
  h.isError = false;
  h.isLoading = false;
  h.refetch.mockClear();
  h.runMutate.mockClear();
  h.toggleMutate.mockClear();
  h.confirmDialog.mockReset();
  h.confirmDialog.mockImplementation(async () => h.confirmAnswer);
  h.confirmAnswer = false;
  nativeConfirm = vi.spyOn(window, "confirm");
});
afterEach(() => {
  expect(nativeConfirm).not.toHaveBeenCalled();
  nativeConfirm.mockRestore();
  cleanup();
});

describe("Image autopost card: three states, never two", () => {
  it("(a) a failed read says state unknown, not empty, and never renders 0 posted", () => {
    h.status = ERROR_STATUS;
    render(<Pipeline />);
    expect(screen.getByText("Image autopost state could not be read, state unknown, not empty")).toBeTruthy();
    expect(screen.getByText(/connection reset/)).toBeTruthy();
    expect(screen.queryByText(/posted of/)).toBeNull();
    expect(screen.queryByText(/No autopost run recorded yet/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it("(a) a transport error (isError, no data) is the same ERROR card, not UNMEASURED", () => {
    h.isError = true;
    render(<Pipeline />);
    expect(screen.getByText("Image autopost state could not be read, state unknown, not empty")).toBeTruthy();
    expect(screen.queryByText(/No autopost run recorded yet/)).toBeNull();
  });

  it("loading renders no counts", () => {
    h.isLoading = true;
    render(<Pipeline />);
    expect(screen.getByText("Image autopost")).toBeTruthy();
    expect(screen.queryByText(/posted of/)).toBeNull();
  });

  it("(b) a successful read with no runs is UNMEASURED, not a zero", () => {
    h.status = UNMEASURED_STATUS;
    render(<Pipeline />);
    expect(screen.getByText(/No autopost run recorded yet\. The next slot window is 8:07, 13:07 or 20:07 ET\./)).toBeTruthy();
    expect(screen.queryByText(/0 posted of 0 runs/)).toBeNull();
  });

  it("(c) measured: 7-day counts carry their denominator, and the run list renders a string date", () => {
    h.status = measured();
    render(<Pipeline />);
    expect(screen.getByText("13 posted of 23 runs (0 failed, 10 aborted, 0 dry runs)")).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    fireEvent.click(screen.getByText("Last 20 runs"));
    expect(screen.getAllByText(/8\.4/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });
});

describe("Run a slot now", () => {
  it("(d) cancel in the confirm sends nothing", async () => {
    h.status = measured();
    h.confirmAnswer = false;
    render(<Pipeline />);
    fireEvent.click(runNow());
    await waitFor(() => expect(h.confirmDialog).toHaveBeenCalledTimes(1));
    expect(h.runMutate).not.toHaveBeenCalled();
  });

  it("(d) confirm sends exactly one run with {}, and the live text says it posts", async () => {
    h.status = measured();
    h.confirmAnswer = true;
    render(<Pipeline />);
    fireEvent.click(runNow());
    await waitFor(() => expect(h.runMutate).toHaveBeenCalledTimes(1));
    expect(h.runMutate.mock.calls[0][0]).toEqual({});
    const msg = String(h.confirmDialog.mock.calls[0][0].message);
    expect(msg).toContain("This posts to Instagram and the Facebook Page now.");
    expect(msg).toContain("The lane's pause does not stop a manual run.");
  });

  it("(d) when the lane is a dry run the confirm says nothing is posted", async () => {
    h.status = measured({ live: false });
    render(<Pipeline />);
    fireEvent.click(runNow());
    await waitFor(() => expect(h.confirmDialog).toHaveBeenCalledTimes(1));
    expect(String(h.confirmDialog.mock.calls[0][0].message)).toContain("nothing is posted");
  });
});

describe("Pause and resume", () => {
  it("(e) pause is one tap: no dialog, flag set to true", () => {
    h.status = measured({ paused: false });
    render(<Pipeline />);
    fireEvent.click(screen.getByRole("button", { name: "Pause lane" }));
    expect(h.confirmDialog).not.toHaveBeenCalled();
    expect(h.toggleMutate).toHaveBeenCalledWith({ key: "ig_autopost_paused", value: true });
  });

  it("(e) resume asks first; cancel changes nothing, confirm clears the flag", async () => {
    h.status = measured({ paused: true });
    render(<Pipeline />);
    expect(screen.getByText("Paused")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume lane" }));
    await waitFor(() => expect(h.confirmDialog).toHaveBeenCalledTimes(1));
    expect(String(h.confirmDialog.mock.calls[0][0].message)).toContain(
      "Resuming lets the cron post to Instagram and the Facebook Page unattended at the next slot (8:07, 13:07 or 20:07 ET).",
    );
    expect(h.toggleMutate).not.toHaveBeenCalled();

    h.confirmAnswer = true;
    fireEvent.click(screen.getByRole("button", { name: "Resume lane" }));
    await waitFor(() => expect(h.toggleMutate).toHaveBeenCalledWith({ key: "ig_autopost_paused", value: false }));
  });

  it("(f) an unreadable pause flag shows Unknown and disables the switch", () => {
    h.status = measured({ paused: null });
    render(<Pipeline />);
    expect(screen.getByText("Unknown")).toBeTruthy();
    const toggle = screen.getByRole("button", { name: /pause lane|resume lane/i }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    fireEvent.click(toggle);
    expect(h.toggleMutate).not.toHaveBeenCalled();
  });
});
