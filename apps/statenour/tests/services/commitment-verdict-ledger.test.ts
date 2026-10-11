/**
 * Audit 2026-10-10 06-X5: a journal take's next action is ledgered as shown
 * ("next action: <action>") and proposed as a commitment, but the operator's
 * accept or dismiss on that commitment never reached intelligence_outcomes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  recordDecisionByContent: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { commitment: { updateMany: m.updateMany, findUnique: m.findUnique } },
}));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitCommitmentTransition: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/db/entity-audit", () => ({ logCreate: vi.fn() }));
vi.mock("@/lib/services/outcome-ledger", () => ({ recordDecisionByContent: m.recordDecisionByContent }));

import { acceptCommitment, dismissProposed } from "@/lib/services/commitments";
// Warm the dynamic import (1.8 s cold) so the "records nothing" controls watch a real window.
import "@/lib/services/journal-promote";

const settle = () => new Promise((r) => setTimeout(r, 50));

beforeEach(() => {
  vi.clearAllMocks();
  m.updateMany.mockResolvedValue({ count: 1 });
  m.findUnique.mockResolvedValue({ description: "Call Sam", sourceRef: "journal-take:e1", toWhom: "self", domain: null });
  m.recordDecisionByContent.mockResolvedValue(true);
});

describe("journal next-action verdicts reach the outcome ledger", () => {
  it("dismissProposed records 'dismissed' on the take's ledger row", async () => {
    expect(await dismissProposed(7)).toBe(true);
    await vi.waitFor(() => expect(m.recordDecisionByContent).toHaveBeenCalledWith("next action: Call Sam", "dismissed", null));
  });

  it("acceptCommitment records 'accepted'", async () => {
    expect(await acceptCommitment(7)).toBe(true);
    await vi.waitFor(() => expect(m.recordDecisionByContent).toHaveBeenCalledWith("next action: Call Sam", "accepted", null));
  });

  it("CONTROL: a commitment not proposed from a journal take records nothing", async () => {
    m.findUnique.mockResolvedValue({ description: "Call Sam", sourceRef: "chat:x", toWhom: "self", domain: null });
    await dismissProposed(7);
    await settle();
    expect(m.recordDecisionByContent).not.toHaveBeenCalled();
  });

  it("CONTROL: a lost race (count 0) records nothing", async () => {
    m.updateMany.mockResolvedValue({ count: 0 });
    expect(await dismissProposed(7)).toBe(false);
    await settle();
    expect(m.recordDecisionByContent).not.toHaveBeenCalled();
  });

  it("a ledger failure never fails the verdict", async () => {
    m.recordDecisionByContent.mockRejectedValue(new Error("ledger down"));
    expect(await dismissProposed(7)).toBe(true);
    await settle();
  });
});
