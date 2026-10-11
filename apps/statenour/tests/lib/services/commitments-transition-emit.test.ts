/**
 * Every live commitment status writer publishes commitment.transition.
 *
 * THE DEFECT (audit 2026-10-10, report 13). The only producer of
 * `commitment.transition` was the legacy REST route app/api/commitments,
 * which no client calls. The live writers (this service, behind tRPC, and the
 * chat tools) flipped status without publishing, so the bus handler that
 * records the transition arc had nothing to consume.
 *
 * Each status change publishes exactly once, through the same publisher the
 * legacy route uses (emitCommitmentTransition). A no-op (lost race, wrong
 * status) publishes nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  updateMany: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  emit: vi.fn(async () => "evt-1"),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    commitment: {
      updateMany: h.updateMany,
      update: h.update,
      create: h.create,
      findUnique: h.findUnique,
      findFirst: h.findFirst,
    },
  },
}));
vi.mock("@/lib/db/brain-bus-emit", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/brain-bus-emit")>()),
  emitCommitmentTransition: h.emit,
}));
vi.mock("@/lib/services/commitment-conditions", () => ({ captureCommitmentConditions: vi.fn() }));
vi.mock("@/lib/db/entity-audit", () => ({ logCreate: vi.fn() }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));

import {
  acceptCommitment,
  dismissProposed,
  verifyCommitment,
  completeActiveCommitment,
  abandonActiveCommitment,
} from "@/lib/services/commitments";
import { tasksTools } from "@/lib/ai/tools/tasks";

const ROW = { description: "call the supplier", toWhom: "Nick", domain: "shop" };

beforeEach(() => {
  for (const f of [h.updateMany, h.update, h.create, h.findUnique, h.findFirst, h.emit]) f.mockReset();
  h.emit.mockResolvedValue("evt-1");
  h.updateMany.mockResolvedValue({ count: 1 });
  h.findUnique.mockImplementation(async (a: { select?: Record<string, boolean> }) =>
    a.select?.status ? { status: "active", ...ROW } : { ...ROW },
  );
  h.findFirst.mockResolvedValue({ status: "active", ...ROW });
  h.update.mockResolvedValue({ id: 7, ...ROW, status: "x" });
});

const only = () => {
  expect(h.emit).toHaveBeenCalledTimes(1);
  return (h.emit.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
};

describe("lib/services/commitments · status writers publish once", () => {
  it.each([
    ["completeActiveCommitment", () => completeActiveCommitment(7), "active", "completed"],
    ["abandonActiveCommitment", () => abandonActiveCommitment(7), "active", "abandoned"],
    ["acceptCommitment", () => acceptCommitment(7), "proposed", "active"],
    ["dismissProposed", () => dismissProposed(7), "proposed", "abandoned"],
    ["verifyCommitment", () => verifyCommitment(7), "active", "verified"],
  ] as const)("%s", async (_n, run, oldStatus, newStatus) => {
    await expect(run()).resolves.toBe(true);
    expect(only()).toMatchObject({ commitmentId: 7, oldStatus, newStatus, ...ROW });
  });

  it("a no-op flip (count 0) publishes nothing", async () => {
    h.updateMany.mockResolvedValue({ count: 0 });
    await expect(completeActiveCommitment(7)).resolves.toBe(false);
    expect(h.emit).not.toHaveBeenCalled();
  });

  it("a failed detail read still publishes the flip (the event records the fact)", async () => {
    h.findUnique.mockRejectedValue(new Error("neon blip"));
    await expect(completeActiveCommitment(7)).resolves.toBe(true);
    expect(only()).toMatchObject({ commitmentId: 7, oldStatus: "active", newStatus: "completed" });
  });

  it("verify pins the swap to the status it read (claim-before-act)", async () => {
    h.findFirst.mockResolvedValue({ status: "accepted", ...ROW });
    await verifyCommitment(7);
    expect(h.updateMany.mock.calls[0][0].where).toMatchObject({ id: 7, status: "accepted", deletedAt: null });
    expect(only()).toMatchObject({ oldStatus: "accepted", newStatus: "verified" });
  });
});

type Exec = { execute: (args: unknown, opts?: unknown) => Promise<unknown> };
const tool = (name: string) => (tasksTools as unknown as Record<string, Exec>)[name];

describe("chat tools · status writers publish once", () => {
  it("completeCommitment", async () => {
    await tool("completeCommitment").execute({ commitmentId: 7, outcome: "done" }, {});
    expect(only()).toMatchObject({ commitmentId: 7, oldStatus: "active", newStatus: "completed", ...ROW });
  });

  it("markCommitmentBroken", async () => {
    await tool("markCommitmentBroken").execute({ commitmentId: 7, reason: "ran out of time" }, {});
    expect(only()).toMatchObject({ commitmentId: 7, oldStatus: "active", newStatus: "broken" });
  });

  it("updateCommitment", async () => {
    await tool("updateCommitment").execute({ commitmentId: 7, status: "kept" }, {});
    expect(only()).toMatchObject({ commitmentId: 7, oldStatus: "active", newStatus: "kept" });
  });

  it("a re-save with the same status publishes nothing", async () => {
    h.findUnique.mockImplementation(async () => ({ status: "kept", ...ROW }));
    await tool("updateCommitment").execute({ commitmentId: 7, status: "kept" }, {});
    expect(h.emit).not.toHaveBeenCalled();
  });
});
