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
    },
  },
}));

import VapiPanel from "../pages/admin/settings/VapiPanel";

beforeEach(() => {
  h.followUpMutate.mockClear();
  h.receptionistMutate.mockClear();
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
    h.confirmAnswer = false;
    render(<VapiPanel />);
    fireEvent.click(followUpButton());
    await waitFor(() => expect(h.confirmDialog).toHaveBeenCalledTimes(1));
    expect(h.followUpMutate).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
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
