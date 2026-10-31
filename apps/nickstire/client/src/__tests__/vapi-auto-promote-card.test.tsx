/**
 * The self-learning card in the VAPI panel (self-learning W3, 2026-10-31).
 *
 * The nightly experiment now promotes its own gated winners to the live
 * receptionist. Nour's side: see what is live and its canary, pause it, and
 * undo it with one confirmed tap. Behaviour asserted: the undo and the pause are
 * two-tap in-DOM confirms (confirmDialog, never window.confirm, which iOS PWA
 * standalone suppresses); a cancel changes nothing; an unreadable status says
 * unknown, never "nothing is live".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

type Status = {
  armed: boolean;
  paused: boolean | null;
  open: null | { versionId: string; at: string; candidateHash: string | null; baseHash: string };
  recent: null | Array<{ at: string; status: string; reason: string | null; candidateHash: string | null }>;
};

const h = vi.hoisted(() => ({
  undoMutate: vi.fn(),
  pauseMutate: vi.fn(),
  status: null as unknown as Status,
  query: { loading: false, error: false },
  confirmAnswer: false,
  confirmDialog: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: h.confirmDialog }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ vapi: { status: { invalidate: vi.fn() }, autoPromoteStatus: { invalidate: vi.fn() }, promptEvolutionStatus: { invalidate: vi.fn() } } }),
    vapi: {
      status: { useQuery: () => ({ data: { connected: true, assistantCount: 1, assistants: [{ id: "asst_1", name: "Receptionist" }] }, isLoading: false }) },
      recentCalls: { useQuery: () => ({ data: { calls: [] } }) },
      assistantRouting: { useQuery: () => ({ data: undefined }) },
      promptLessons: { useQuery: () => ({ data: [] }) },
      createAssistant: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      updateAssistant: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      updateFollowUpAssistant: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      promptEvolutionStatus: { useQuery: () => ({ data: { active: null, last: null, latest: { state: "ok", latest: null } }, isLoading: false, isError: false, error: null }) },
      runPromptEvolutionNow: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      autoPromoteStatus: {
        useQuery: () => ({
          data: h.query.loading || h.query.error ? undefined : h.status,
          isLoading: h.query.loading,
          isError: h.query.error,
          error: h.query.error ? { message: "UNAUTHORIZED (test)" } : null,
        }),
      },
      undoAutoPromotion: { useMutation: () => ({ mutate: h.undoMutate, isPending: false }) },
      setAutoPromotePaused: { useMutation: () => ({ mutate: h.pauseMutate, isPending: false }) },
    },
  },
}));

import VapiPanel from "../pages/admin/settings/VapiPanel";

const OPEN: Status = {
  armed: true,
  paused: false,
  open: { versionId: "v1", at: "2026-11-03T05:30:00.000Z", candidateHash: "abcd1234ffff0000aaaa1111", baseHash: "0123456789ab0123456789ab" },
  recent: [{ at: "2026-11-03T05:30:00.000Z", status: "promoted", reason: null, candidateHash: "abcd1234ffff0000aaaa1111" }],
};

beforeEach(() => {
  h.undoMutate.mockClear();
  h.pauseMutate.mockClear();
  h.status = OPEN;
  h.query = { loading: false, error: false };
  h.confirmDialog.mockReset();
  h.confirmDialog.mockImplementation(async () => h.confirmAnswer);
});
afterEach(() => cleanup());

const card = () => screen.getByTestId("auto-promote");

describe("the self-learning card", () => {
  it("names the live learned edit by hash and says its canary is open", () => {
    render(<VapiPanel />);
    expect(card().textContent).toMatch(/abcd1234/);
    expect(card().textContent).toMatch(/canary open/i);
  });

  it("undo is a two-tap confirm: the first tap undoes nothing, a cancel undoes nothing, never window.confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    try {
      h.confirmAnswer = false;
      render(<VapiPanel />);
      fireEvent.click(screen.getByRole("button", { name: /undo learned edit/i }));
      await waitFor(() => expect(h.confirmDialog).toHaveBeenCalledTimes(1));
      expect(h.undoMutate).not.toHaveBeenCalled();
      expect(confirmSpy).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("a confirmed undo runs exactly once", async () => {
    h.confirmAnswer = true;
    render(<VapiPanel />);
    fireEvent.click(screen.getByRole("button", { name: /undo learned edit/i }));
    await waitFor(() => expect(h.undoMutate).toHaveBeenCalledTimes(1));
  });

  it("nothing live: no undo button, and it says so", () => {
    h.status = { ...OPEN, open: null, recent: [] };
    render(<VapiPanel />);
    expect(screen.queryByRole("button", { name: /undo learned edit/i })).toBeNull();
    expect(card().textContent).toMatch(/no learned edit is live/i);
  });

  it("paused: the switch offers resume, and a confirmed tap sends paused false", async () => {
    h.status = { ...OPEN, paused: true };
    h.confirmAnswer = true;
    render(<VapiPanel />);
    fireEvent.click(screen.getByRole("button", { name: /resume self-learning/i }));
    await waitFor(() => expect(h.pauseMutate).toHaveBeenCalledWith({ paused: false }));
  });

  it("running: a confirmed pause sends paused true", async () => {
    h.confirmAnswer = true;
    render(<VapiPanel />);
    fireEvent.click(screen.getByRole("button", { name: /pause self-learning/i }));
    await waitFor(() => expect(h.pauseMutate).toHaveBeenCalledWith({ paused: true }));
  });

  it("a failed status read says unknown, not empty, and offers no undo", () => {
    h.query = { loading: false, error: true };
    render(<VapiPanel />);
    expect(card().textContent).toMatch(/unknown, not empty/i);
    expect(screen.queryByRole("button", { name: /undo learned edit/i })).toBeNull();
  });

  it("an unreadable history or pause row says unknown, never 'nothing is live'", () => {
    h.status = { ...OPEN, paused: null, open: null, recent: null };
    render(<VapiPanel />);
    expect(card().textContent).toMatch(/history could not be read/i);
    expect(card().textContent).not.toMatch(/no learned edit is live/i);
  });

  it("the undo and pause buttons are 48px touch targets", () => {
    render(<VapiPanel />);
    for (const name of [/undo learned edit/i, /pause self-learning/i]) {
      expect(screen.getByRole("button", { name }).className).toMatch(/min-h-\[48px\]/);
    }
  });
});
