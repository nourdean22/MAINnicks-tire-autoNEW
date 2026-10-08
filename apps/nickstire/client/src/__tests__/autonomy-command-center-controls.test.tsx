/**
 * Autonomy control's editable settings reach the server as ONE change (2026-10-08).
 *
 * Before: Save on a limit published the policy the screen held — the command
 * center's partial copy — and the server's shape check refused it, so the
 * Generation budget could not be changed from the phone. Now a limit goes to
 * setAutonomyLimit as { key, value }, and the new Paid repairs switch goes to
 * setAutonomyPaidRepair. Allowing paid repairs opens the in-DOM confirm (never
 * window.confirm, which iOS PWA standalone suppresses); stopping them is one tap.
 * Arming a kill switch is the positive control that the harness sees a mutate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { DEFAULT_AUTONOMY_POLICY } from "@/lib/autonomyPolicy";

const h = vi.hoisted(() => ({
  limitMutate: vi.fn(),
  paidMutate: vi.fn(),
  killMutate: vi.fn(),
  confirmDialog: vi.fn(),
  confirmAnswer: false,
  paid: "approval_required" as "auto" | "approval_required",
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: h.confirmDialog }));

const snapshot = () => ({
  policy: {
    version: 5,
    operatingMode: "produce" as const,
    source: "storage" as const,
    emergencyControls: DEFAULT_AUTONOMY_POLICY.emergencyControls,
    limits: { ...DEFAULT_AUTONOMY_POLICY.limits, maxGenerationCostPerDayUsd: 12 },
    paidBeatRegeneration: h.paid,
  },
  spend: { available: true, todayUsd: 0.25, capUsd: 12, isEstimate: true as const },
  reservations: { available: true, rows: [] },
  auditTail: { available: true, rows: [] },
  recentJobs: { available: true, rows: [] },
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    contentAdmin: {
      getCommandCenter: { useQuery: () => ({ data: snapshot(), isLoading: false, refetch: vi.fn() }) },
      getShadowPlan: { useQuery: () => ({ data: undefined, isLoading: false }) },
      setAutonomyLimit: { useMutation: () => ({ mutate: h.limitMutate, isPending: false }) },
      setAutonomyPaidRepair: { useMutation: () => ({ mutate: h.paidMutate, isPending: false }) },
      setAutonomyKillSwitch: { useMutation: () => ({ mutate: h.killMutate, isPending: false }) },
    },
  },
}));

import AutonomyCommandCenter from "../components/admin/AutonomyCommandCenter";

beforeEach(() => {
  h.limitMutate.mockClear();
  h.paidMutate.mockClear();
  h.killMutate.mockClear();
  h.confirmDialog.mockReset();
  h.confirmDialog.mockImplementation(async () => h.confirmAnswer);
  h.confirmAnswer = false;
  h.paid = "approval_required";
});
afterEach(() => cleanup());

const automatic = () => screen.getByRole("button", { name: "Automatic" });
const askFirst = () => screen.getByRole("button", { name: "Ask me first" });

describe("Autonomy control: one change per tap, to the server", () => {
  it("positive control: arming a kill switch mutates on its tap", () => {
    render(<AutonomyCommandCenter />);
    fireEvent.click(screen.getAllByRole("button", { name: /arm/i })[0]);
    expect(h.killMutate).toHaveBeenCalledWith({ scope: "global", on: true });
  });

  it("Save on the Generation budget sends that one limit, not a policy", () => {
    render(<AutonomyCommandCenter />);
    fireEvent.click(screen.getByRole("button", { name: "12$/day" }));
    fireEvent.change(screen.getByLabelText("Generation budget ($/day)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(h.limitMutate).toHaveBeenCalledWith({ key: "maxGenerationCostPerDayUsd", value: 0 });
  });

  it("a count limit cannot be saved as a fraction; a whole number can (Codex on #2933)", () => {
    render(<AutonomyCommandCenter />);
    fireEvent.click(screen.getByRole("button", { name: "2/day" }));
    const box = screen.getByLabelText("Feed posts (/day)");
    fireEvent.change(box, { target: { value: "1.5" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    // CONTROL: the same box accepts a whole number.
    fireEvent.change(box, { target: { value: "1" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("an empty budget field cannot be saved as $0", () => {
    render(<AutonomyCommandCenter />);
    fireEvent.click(screen.getByRole("button", { name: "12$/day" }));
    fireEvent.change(screen.getByLabelText("Generation budget ($/day)"), { target: { value: " " } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Paid repairs switch", () => {
  it("Automatic opens the in-DOM confirm and changes nothing on cancel", async () => {
    const nativeConfirm = vi.spyOn(window, "confirm");
    try {
      render(<AutonomyCommandCenter />);
      expect(askFirst().getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(automatic());
      await waitFor(() => expect(h.confirmDialog).toHaveBeenCalledTimes(1));
      expect(h.paidMutate).not.toHaveBeenCalled();
      expect(nativeConfirm).not.toHaveBeenCalled();
    } finally {
      nativeConfirm.mockRestore();
    }
  });

  it("a confirmed Automatic publishes auto, once", async () => {
    h.confirmAnswer = true;
    render(<AutonomyCommandCenter />);
    fireEvent.click(automatic());
    await waitFor(() => expect(h.paidMutate).toHaveBeenCalledTimes(1));
    // The limits the dialog showed travel with the consent (Codex on #2933): the
    // server refuses them if the stored policy has moved since.
    expect(h.paidMutate).toHaveBeenCalledWith({
      permission: "auto",
      confirmedLimits: { maxGenerationCostPerDayUsd: 12, maxRepairAttemptsPerAsset: DEFAULT_AUTONOMY_POLICY.limits.maxRepairAttemptsPerAsset },
    });
  });

  it("Ask me first stops paid repairs in one tap, with no confirm", () => {
    h.paid = "auto";
    render(<AutonomyCommandCenter />);
    expect(automatic().getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(askFirst());
    expect(h.paidMutate).toHaveBeenCalledWith({ permission: "approval_required" });
    expect(h.confirmDialog).not.toHaveBeenCalled();
  });

  it("tapping the setting already in force publishes nothing", () => {
    h.paid = "auto";
    render(<AutonomyCommandCenter />);
    fireEvent.click(automatic());
    expect(h.confirmDialog).not.toHaveBeenCalled();
    expect(h.paidMutate).not.toHaveBeenCalled();
  });

  it("both choices are 48px touch targets", () => {
    render(<AutonomyCommandCenter />);
    expect(automatic().className).toMatch(/\bmin-h-\[48px\]/);
    expect(askFirst().className).toMatch(/\bmin-h-\[48px\]/);
  });
});
