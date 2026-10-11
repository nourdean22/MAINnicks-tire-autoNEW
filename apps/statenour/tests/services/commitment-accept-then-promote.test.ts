/**
 * R3-17 #4: accepting a journal-derived commitment records `accepted` with a
 * null resultRef; a later promote of the same next action asked recordDecision
 * for `task:<id>`, but recordDecision only swaps rows whose decision is null,
 * so the task ref never landed and the task's completion could not close the row.
 *
 * Real commitments + journal-promote + outcome-ledger over an in-memory ledger.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; contentHash: string; shownAt: Date; decision: string | null; decidedAt?: Date; resultRef: string | null };
const h = vi.hoisted(() => ({ rows: [] as Row[] }));

// Every where-key must equal the row's value (shownAt carries a range and is skipped).
const matches = (r: Row, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => k === "shownAt" || (r as Record<string, unknown>)[k] === v);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    commitment: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => ({ description: "Call Sam", sourceRef: "journal-take:e1", toWhom: "self", domain: null })),
    },
    brainMemory: {
      findUnique: vi.fn(async () => ({ id: "bm-1", content: JSON.stringify({ nextAction: { action: "Call Sam" } }) })),
      update: vi.fn(async () => ({})),
    },
    intelligenceOutcome: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const hit = h.rows.filter((r) => matches(r, where)).sort((a, b) => +b.shownAt - +a.shownAt)[0];
        return hit ? { id: hit.id } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = h.rows.filter((r) => matches(r, where));
        for (const r of hit) for (const [k, v] of Object.entries(data)) if (v !== undefined) (r as Record<string, unknown>)[k] = v;
        return { count: hit.length };
      }),
    },
  },
}));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitCommitmentTransition: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/db/entity-audit", () => ({ logCreate: vi.fn() }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/services/tasks", () => ({ createTask: vi.fn(async () => ({ id: "task-9" })) }));
vi.mock("@/lib/services/missions", () => ({
  resolveInboxMissionId: vi.fn(async () => "m-inbox"),
  resolveGeneralAnchorId: vi.fn(async () => null),
}));

import { acceptCommitment, dismissProposed } from "@/lib/services/commitments";
import { journalNextActionSummary, promoteJournalTake } from "@/lib/services/journal-promote";
import { outcomeContentHash } from "@/lib/services/outcome-ledger";

const row = () => h.rows[0]!;

beforeEach(() => {
  h.rows = [{ id: "o1", contentHash: outcomeContentHash(journalNextActionSummary("Call Sam")), shownAt: new Date(), decision: null, resultRef: null }];
});

describe("accept a journal commitment, then promote the same next action", () => {
  it("the promote attaches task:<id> to the row the accept already decided", async () => {
    await acceptCommitment(7);
    await vi.waitFor(() => expect(row().decision).toBe("accepted"));
    expect(row().resultRef).toBeNull();

    await promoteJournalTake("e1", "nextAction");
    await vi.waitFor(() => expect(row().resultRef).toBe("task:task-9"));
    expect(row().decision).toBe("accepted");
  });

  it("CONTROL: promote with no prior accept decides and attaches in one step", async () => {
    await promoteJournalTake("e1", "nextAction");
    await vi.waitFor(() => expect(row().resultRef).toBe("task:task-9"));
    expect(row().decision).toBe("accepted");
  });

  it("a DISMISSED row is never given a task ref (a dismissed row must not be closed as useful)", async () => {
    await dismissProposed(7);
    await vi.waitFor(() => expect(row().decision).toBe("dismissed"));
    await promoteJournalTake("e1", "nextAction");
    await new Promise((r) => setTimeout(r, 50));
    expect(row().resultRef).toBeNull();
  });

  it("an accepted row that already has a resultRef keeps it (compare-and-set on null)", async () => {
    Object.assign(row(), { decision: "accepted", resultRef: "task:older" });
    await promoteJournalTake("e1", "nextAction");
    await new Promise((r) => setTimeout(r, 50));
    expect(row().resultRef).toBe("task:older");
  });
});
