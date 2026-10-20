/**
 * Comment responder card on Instagram > Controls (contract commentResponderStatus v1).
 *
 * The reel comment responder posts public replies to Instagram comments, unattended.
 * This card is the consumer of the server's status read and the inverted pause flag
 * reel_comment_responder_paused. Three states, never two: a failed read says "state
 * unknown, not empty", keeps the Pause / Resume switch, and never renders "0 posted".
 * Resume goes through the in-DOM confirmDialog (window.confirm is suppressed in the
 * iOS standalone PWA); Pause is one tap, because pausing is the safe direction.
 * Rendered through Controls so the test also proves the card is mounted.
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
  toggleMutate: vi.fn(),
  confirmDialog: vi.fn(),
  confirmAnswer: false,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: h.confirmDialog }));
// Controls also mounts the kill switch screen; it has its own test and must not add buttons here.
vi.mock("@/components/admin/AutonomyCommandCenter", () => ({ default: () => null }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    instagramAdmin: {
      reelPipelineHealth: {
        useQuery: () => ({ data: { available: false, reason: "reel read off in this test" }, isLoading: false, refetch: vi.fn() }),
      },
      // The image card stays in its loading state so its buttons never compete with this card's.
      autopostLaneStatus: { useQuery: () => ({ data: undefined, isError: false, isLoading: true, refetch: vi.fn(), dataUpdatedAt: 0 }) },
      startAutopostRun: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      // The send switches card stays loading so its buttons never compete with this card's.
      sendSwitchesStatus: { useQuery: () => ({ data: undefined, isError: false, isLoading: true, refetch: vi.fn() }) },
      commentResponderStatus: {
        useQuery: () => ({ data: h.status, isError: h.isError, isLoading: h.isLoading, refetch: h.refetch }),
      },
    },
    featureFlags: {
      toggle: { useMutation: () => ({ mutate: h.toggleMutate, isPending: false }) },
    },
  },
}));

import { Controls } from "../pages/admin/instagram/Controls";

const FLAG = "reel_comment_responder_paused";
const ERROR_TEXT = "Comment responder state could not be read, state unknown, not empty";
const RESUME_MESSAGE =
  "Resuming lets the responder post public replies to Instagram comments on recent reels, unattended, on the next pulse (every 15 minutes). Nothing is queued.";

const FAILURE = { available: false, reason: "Autopost history could not be read: boom", paused: false, enabled: true, live: true };
const LIVE_SUMMARY = "kill switch: replies drafted, not posted; 3 comments seen, 0 replied";
const UNMEASURED = {
  available: true, enabled: true, live: true, paused: false,
  lastRun: { startedAt: new Date("2026-10-16T14:00:00Z"), status: "success", details: LIVE_SUMMARY },
  recentReplies: [],
  counts7d: { posted: 0, failed: 0, dryRun: 0 },
};
const measured = (over: Record<string, unknown> = {}) => ({
  available: true, enabled: true, live: true, paused: false,
  lastRun: { startedAt: new Date("2026-10-16T14:15:00Z"), status: "success", details: "2 comments seen, 1 replied" },
  recentReplies: [
    {
      id: "aud_2", occurredAt: new Date("2026-10-16T14:15:00Z"), decision: "POSTED", mediaId: "m1", commentId: "c1",
      replyId: "r1", tone: "warm", replyText: "Thanks for watching. Stop by any day, walk-ins welcome.", error: null,
    },
    // A Date may arrive as a string; the card must still render it.
    {
      id: "aud_1", occurredAt: "2026-10-16T13:00:00.000Z", decision: "FAILED", mediaId: "m1", commentId: "c2",
      replyId: null, tone: null, replyText: null, error: "Graph API 400: comment no longer exists",
    },
  ],
  counts7d: { posted: 5, failed: 1, dryRun: 0 },
  ...over,
});

let nativeConfirm: MockInstance<typeof window.confirm>;
beforeEach(() => {
  h.status = undefined;
  h.isError = false;
  h.isLoading = false;
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

const pauseBtn = () => screen.getByRole("button", { name: "Pause replies" });
const resumeBtn = () => screen.getByRole("button", { name: "Resume replies" });

describe("Comment responder card: three states, never two", () => {
  it("ERROR: the amber text, the reason, Retry, the pause switch, and never 0 posted", () => {
    h.status = FAILURE;
    render(<Controls />);
    expect(screen.getByText(ERROR_TEXT)).toBeTruthy();
    expect(screen.getByText(/boom/)).toBeTruthy();
    expect((pauseBtn() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/posted,/)).toBeNull();
    expect(screen.queryByText(/No reply attempt recorded yet/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it("ERROR: a transport error (isError, no data) is the same card, with the switch disabled and its reason", () => {
    h.isError = true;
    render(<Controls />);
    expect(screen.getByText(ERROR_TEXT)).toBeTruthy();
    expect((pauseBtn() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Pause state unknown until a refresh reads it.")).toBeTruthy();
    expect(screen.queryByText(/No reply attempt recorded yet/)).toBeNull();
  });

  it("loading renders no counts and no empty line", () => {
    h.isLoading = true;
    render(<Controls />);
    expect(screen.getByText("Comment responder")).toBeTruthy();
    expect(screen.queryByText(/posted,/)).toBeNull();
    expect(screen.queryByText(/No reply attempt recorded yet/)).toBeNull();
  });

  it("UNMEASURED: no reply attempt yet, not a zero, and the last run details verbatim", () => {
    h.status = UNMEASURED;
    render(<Controls />);
    expect(screen.getByText(/No reply attempt recorded yet/)).toBeTruthy();
    expect(screen.queryByText(/0 posted/)).toBeNull();
    expect(screen.getByText(LIVE_SUMMARY)).toBeTruthy();
  });

  it("measured: the counts line, the chips, and the reply list with a string date", () => {
    h.status = measured();
    render(<Controls />);
    expect(screen.getByText("5 posted, 1 failed, 0 dry runs in 7 days")).toBeTruthy();
    expect(screen.getByText("Enabled")).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.queryByText("Paused")).toBeNull();
    fireEvent.click(screen.getByText("Last 20 reply attempts"));
    expect(screen.getByText("Thanks for watching. Stop by any day, walk-ins welcome.")).toBeTruthy();
    expect(screen.getByText(/warm/)).toBeTruthy();
    expect(screen.getByText("Graph API 400: comment no longer exists")).toBeTruthy();
    expect(screen.getAllByText(/^posted/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^failed/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it("chips: Disabled, Dry run and Paused come from the read", () => {
    h.status = measured({ enabled: false, live: false, paused: true });
    render(<Controls />);
    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.getByText("Dry run")).toBeTruthy();
    expect(screen.getByText("Paused")).toBeTruthy();
  });
});

describe("Pause and resume", () => {
  it("pause is one tap: no dialog, and the flag goes to true", () => {
    h.status = measured();
    render(<Controls />);
    fireEvent.click(pauseBtn());
    expect(h.confirmDialog).not.toHaveBeenCalled();
    expect(h.toggleMutate).toHaveBeenCalledTimes(1);
    expect(h.toggleMutate.mock.calls[0][0]).toEqual({ key: FLAG, value: true });
  });

  it("resume asks through confirmDialog with the unattended-replies message, then sets the flag to false", async () => {
    h.status = measured({ paused: true });
    h.confirmAnswer = true;
    render(<Controls />);
    fireEvent.click(resumeBtn());
    await waitFor(() => expect(h.toggleMutate).toHaveBeenCalledTimes(1));
    expect(h.confirmDialog).toHaveBeenCalledTimes(1);
    expect(h.confirmDialog.mock.calls[0][0].message).toBe(RESUME_MESSAGE);
    expect(h.toggleMutate.mock.calls[0][0]).toEqual({ key: FLAG, value: false });
  });

  it("cancel on the resume dialog sends nothing", async () => {
    h.status = measured({ paused: true });
    h.confirmAnswer = false;
    render(<Controls />);
    fireEvent.click(resumeBtn());
    await waitFor(() => expect(h.confirmDialog).toHaveBeenCalledTimes(1));
    expect(h.toggleMutate).not.toHaveBeenCalled();
  });

  it("ERROR with paused true still offers Resume, through the dialog", async () => {
    h.status = { ...FAILURE, paused: true };
    h.confirmAnswer = true;
    render(<Controls />);
    fireEvent.click(resumeBtn());
    await waitFor(() => expect(h.toggleMutate).toHaveBeenCalledTimes(1));
    expect(h.confirmDialog).toHaveBeenCalledTimes(1);
  });

  it("paused null disables the switch, says why, and a click sends nothing", () => {
    h.status = measured({ paused: null });
    render(<Controls />);
    expect((pauseBtn() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Pause state unknown until a refresh reads it.")).toBeTruthy();
    expect(screen.getByText("Unknown")).toBeTruthy();
    fireEvent.click(pauseBtn());
    expect(h.toggleMutate).not.toHaveBeenCalled();
    expect(h.confirmDialog).not.toHaveBeenCalled();
  });
});
