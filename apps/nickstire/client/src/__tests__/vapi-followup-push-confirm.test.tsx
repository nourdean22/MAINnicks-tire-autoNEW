/**
 * PUSH FOLLOW-UP ASSISTANT overwrites the prompt of the assistant that places
 * real outbound calls. It sat one tap away, ~23px tall, beside the receptionist
 * push, and front_desk can reach the panel. One mis-tap reached Vapi.
 *
 * WHAT THIS ASSERTS. Behaviour: the first tap opens the in-DOM confirm
 * (confirmDialog, never window.confirm, which iOS PWA standalone suppresses) and
 * pushes NOTHING; only a confirmed second tap mutates. A cancel pushes nothing.
 * The receptionist push is the positive control that the harness can see a
 * mutate at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  followUpMutate: vi.fn(),
  receptionistMutate: vi.fn(),
  evolutionMutate: vi.fn(),
  evolutionStatus: { active: null as null | { startedAt: string; elapsedMs: number; budgetMs: number }, last: null, latest: { state: "ok", latest: null } } as Record<string, unknown>,
  confirmAnswer: false,
  confirmDialog: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: h.confirmDialog }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ vapi: { status: { invalidate: vi.fn() } } }),
    vapi: {
      status: { useQuery: () => ({ data: { connected: true, assistantCount: 1, assistants: [{ id: "asst_1", name: "Receptionist" }] }, isLoading: false }) },
      recentCalls: { useQuery: () => ({ data: { calls: [] } }) },
      assistantRouting: { useQuery: () => ({ data: undefined }) },
      promptLessons: { useQuery: () => ({ data: [] }) },
      createAssistant: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      updateAssistant: { useMutation: () => ({ mutate: h.receptionistMutate, isPending: false }) },
      updateFollowUpAssistant: { useMutation: () => ({ mutate: h.followUpMutate, isPending: false }) },
      promptEvolutionStatus: { useQuery: () => ({ data: h.evolutionStatus }) },
      runPromptEvolutionNow: { useMutation: () => ({ mutate: h.evolutionMutate, isPending: false }) },
    },
  },
}));

import VapiPanel from "../pages/admin/settings/VapiPanel";

beforeEach(() => {
  h.followUpMutate.mockClear();
  h.receptionistMutate.mockClear();
  h.evolutionMutate.mockClear();
  h.evolutionStatus = { active: null, last: null, latest: { state: "ok", latest: null } };
  h.confirmDialog.mockReset();
  h.confirmDialog.mockImplementation(async () => h.confirmAnswer);
});
afterEach(() => cleanup());

const followUpButton = () => screen.getByRole("button", { name: /push follow-up assistant/i });

describe("PUSH FOLLOW-UP ASSISTANT is a two-tap confirm with a 48px target", () => {
  it("positive control: the receptionist push still mutates on its tap", () => {
    render(<VapiPanel />);
    fireEvent.click(screen.getByRole("button", { name: /push latest config/i }));
    expect(h.receptionistMutate).toHaveBeenCalledTimes(1);
  });

  it("the first tap opens the in-DOM confirm and pushes nothing; a cancel pushes nothing", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    try {
      h.confirmAnswer = false;
      render(<VapiPanel />);
      fireEvent.click(followUpButton());
      await waitFor(() => expect(h.confirmDialog).toHaveBeenCalledTimes(1));
      expect(h.followUpMutate).not.toHaveBeenCalled();
      expect(confirmSpy).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("a confirmed second tap pushes exactly once", async () => {
    h.confirmAnswer = true;
    render(<VapiPanel />);
    fireEvent.click(followUpButton());
    await waitFor(() => expect(h.followUpMutate).toHaveBeenCalledTimes(1));
  });

  it("the button is a 48px touch target", () => {
    render(<VapiPanel />);
    expect(followUpButton().className).toMatch(/\bmin-h-\[48px\]/);
  });
});

/**
 * RUN EXPERIMENT NOW starts a 25-minute offline replay that spends the week's
 * sealed confirmation seeds. Same contract as the follow-up push: in-DOM
 * confirm, a cancel starts nothing, one confirmed tap starts exactly once, 48px.
 */
const runButton = () => screen.getByRole("button", { name: /run experiment now/i });

describe("RUN EXPERIMENT NOW is a two-tap confirm that starts the manual run once", () => {
  it("the first tap opens the in-DOM confirm and starts nothing; a cancel starts nothing", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    try {
      h.confirmAnswer = false;
      render(<VapiPanel />);
      fireEvent.click(runButton());
      await waitFor(() => expect(h.confirmDialog).toHaveBeenCalledTimes(1));
      expect(h.confirmDialog.mock.calls[0][0]).toMatchObject({ title: expect.stringMatching(/prompt experiment/i) });
      expect(h.evolutionMutate).not.toHaveBeenCalled();
      expect(confirmSpy).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("a confirmed second tap starts exactly once, and the follow-up push is untouched", async () => {
    h.confirmAnswer = true;
    render(<VapiPanel />);
    fireEvent.click(runButton());
    await waitFor(() => expect(h.evolutionMutate).toHaveBeenCalledTimes(1));
    expect(h.followUpMutate).not.toHaveBeenCalled();
    expect(h.receptionistMutate).not.toHaveBeenCalled();
  });

  it("while a run is active the button is disabled and says RUNNING", () => {
    h.evolutionStatus = { active: { startedAt: "2026-10-09T14:00:00.000Z", elapsedMs: 180_000, budgetMs: 1_800_000 }, last: null, latest: { state: "ok", latest: null } };
    render(<VapiPanel />);
    const b = screen.getByRole("button", { name: /running/i });
    expect(b).toBeDisabled();
    expect(screen.getByText(/running for 3 min of a 30-minute budget/i)).toBeTruthy();
  });

  it("an unreadable latest row reads as unknown, never as no runs yet", () => {
    h.evolutionStatus = { active: null, last: null, latest: { state: "unavailable", reason: "db down" } };
    render(<VapiPanel />);
    expect(screen.getByText(/latest result unknown/i)).toBeTruthy();
    expect(screen.queryByText(/no experiment recorded yet/i)).toBeNull();
  });

  it("the button is a 48px touch target", () => {
    render(<VapiPanel />);
    expect(runButton().className).toMatch(/\bmin-h-\[48px\]/);
  });

  it("a candidate rejected before replay shows which invariants it broke; a scored one shows its train reading", () => {
    h.evolutionStatus = {
      active: null, last: null,
      latest: { state: "ok", latest: {
        ranAt: "2026-10-09T20:33:53.740Z", trigger: "manual", outcome: "rejected-train", promotionStage: "none", accepted: false, confirmed: false,
        candidateHash: null, baselinePromptHash: "06e0dbbded11a3754ef992f4", baselineParity: "identical", laneParity: false,
        experimentId: "prompt-evolution:a46f96a6a93ad384", receiptDelivered: true,
        seeds: { usable: 30, train: 14, holdout: 13, confirm: 8, success: 0 },
        gates: { holdout: null, success: null, confirmation: null }, durationMs: 319_090,
        candidates: [
          { promptHash: "deadbeef0001", train: "unscored", rejectedInvariants: ["clause-preservation"], trainMargin: null, trainUsable: null },
          { promptHash: "cand1234abcd", train: "9/14", rejectedInvariants: [], trainMargin: -2, trainUsable: true },
        ],
      } },
    };
    render(<VapiPanel />);
    expect(screen.getByText(/not replayed, broke clause-preservation/i)).toBeTruthy();
    expect(screen.getByText(/train 9\/14 \(margin -2\)/i)).toBeTruthy();
  });
});
