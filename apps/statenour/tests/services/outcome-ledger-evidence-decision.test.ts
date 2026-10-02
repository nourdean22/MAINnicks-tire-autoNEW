/**
 * recordDecisionFromEvidence · 2026-10-02 · census E11 fold
 *
 * A chat chip tap holds only the row id; the producer put the task the chip is
 * about on the row's evidence. Pinned: the decision carries `resultRef
 * task:<id>` when the evidence names a task, none when it does not, and a
 * failed evidence read still records the decision.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, updateMany } = vi.hoisted(() => ({ findUnique: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { intelligenceOutcome: { findUnique, updateMany } } }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { recordDecisionFromEvidence } from "@/lib/services/outcome-ledger";

beforeEach(() => {
  findUnique.mockReset();
  updateMany.mockReset();
  updateMany.mockResolvedValue({ count: 1 });
});

describe("recordDecisionFromEvidence", () => {
  it("carries the evidence task as the resultRef", async () => {
    findUnique.mockResolvedValue({ evidenceRefs: { suggestionId: "broken-promise-t9", taskId: "t9" } });
    expect(await recordDecisionFromEvidence("row1", "accepted")).toBe(true);
    const data = updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ decision: "accepted", resultRef: "task:t9" });
  });

  it("no task on the evidence → decision without a resultRef", async () => {
    findUnique.mockResolvedValue({ evidenceRefs: { suggestionId: "overdue-pile" } });
    await recordDecisionFromEvidence("row2", "dismissed");
    const data = updateMany.mock.calls[0][0].data;
    expect(data.decision).toBe("dismissed");
    expect(data.resultRef).toBeUndefined();
  });

  it("a failed evidence read still records the decision", async () => {
    findUnique.mockRejectedValue(new Error("db down"));
    expect(await recordDecisionFromEvidence("row3", "accepted")).toBe(true);
    expect(updateMany).toHaveBeenCalledOnce();
  });
});
