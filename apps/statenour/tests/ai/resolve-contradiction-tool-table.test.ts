/**
 * Nick closes a claim-vs-record row from chat (2026-10-23).
 *
 * The CLAIM VS RECORD and ONE OPEN CONTRADICTION blocks hand Nick a `tbl:<id>`
 * key. When Nour picks an answer ("the record is right", "that's outdated",
 * "ignore it") Nick calls the existing resolveContradiction tool, which must
 * close the TABLE row through the same owner as the /brain panel
 * (lib/services/contradictions.ts) instead of looking for a BrainMemory row
 * that does not exist. The second half pins REACHABILITY: those plain replies
 * must attach the tool, measured against the real pruner.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  contradiction: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  brainMemory: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), upsert: vi.fn(), create: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: { contradiction: h.contradiction, brainMemory: h.brainMemory } }));

import { brainTools } from "@/lib/ai/tools/brain";
import { pruneTools } from "@/lib/ai/chat-mode";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

type Exec = { execute: (input: unknown, opts?: unknown) => Promise<Record<string, unknown>> };
const resolveTool = brainTools.resolveContradiction as unknown as Exec;

const CLOSED = {
  id: "ck_9",
  date: "2026-10-18",
  claim: "I walk the dog twice a day",
  reality: "The walk log shows one walk a day",
  gap: "Stated twice, logged once",
  category: "habit",
  severity: "mild",
  resolved: true,
  resolvedHow: "outdated",
  createdAt: new Date("2026-10-18T12:00:00Z"),
  updatedAt: new Date("2026-10-22T12:00:00Z"),
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("resolveContradiction tool · tbl: keys", () => {
  it("closes the table row through the service CAS and reports resolvedHow", async () => {
    h.contradiction.updateMany.mockResolvedValue({ count: 1 });
    h.contradiction.findFirst.mockResolvedValue(CLOSED);

    const out = await resolveTool.execute({ contradictionKey: "tbl:ck_9", side: "old_wins" });

    expect(out.ok).toBe(true);
    expect(out.resolvedHow).toBe("outdated");
    const arg = h.contradiction.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: "ck_9", resolved: false });
    expect(arg.data).toEqual({ resolved: true, resolvedHow: "outdated" });
    // It never looks for a BrainMemory contradiction row for a table key.
    expect(h.brainMemory.findUnique).not.toHaveBeenCalled();
  });

  it("after a lost race the tool reports the STORED side, and the requested one separately", async () => {
    h.contradiction.updateMany.mockResolvedValue({ count: 0 });
    h.contradiction.findFirst.mockResolvedValue({ ...CLOSED, resolvedHow: "ignore" });

    const out = await resolveTool.execute({ contradictionKey: "tbl:ck_9", side: "old_wins" });

    expect(out).toMatchObject({ ok: true, alreadyResolved: true, side: "dismissed", requestedSide: "old_wins", resolvedHow: "ignore" });
  });

  it("both_valid on a table row is refused, and nothing is written", async () => {
    const out = await resolveTool.execute({ contradictionKey: "tbl:ck_9", side: "both_valid" });
    expect(out.ok).toBe(false);
    expect(h.contradiction.updateMany).not.toHaveBeenCalled();
  });

  it("an unknown table id is not_found, not a thrown error", async () => {
    h.contradiction.updateMany.mockResolvedValue({ count: 0 });
    h.contradiction.findFirst.mockResolvedValue(null);
    const out = await resolveTool.execute({ contradictionKey: "tbl:missing", side: "dismissed" });
    expect(out).toMatchObject({ ok: false, error: "contradiction_not_found" });
  });
});

function allTools(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of TOOL_CATALOG) out[(t as { name: string }).name] = {};
  return out;
}
async function offered(prompt: string, contradictionAskPending = false): Promise<string[]> {
  return Object.keys(
    (await pruneTools("standard" as never, allTools(), prompt, undefined, { contradictionAskPending })) as Record<string, unknown>,
  );
}

describe("resolveContradiction is attached whenever an ask is pending, whatever the words", () => {
  it.each([
    "that's outdated",
    "ignore that one",
    "honestly that one is out of date now",
    "the record\u2019s right", // iPhone curly apostrophe
    "the claim was wrong",
    "things moved on",
    "ignore",
    "drop it",
    "the record is accurate",
  ])("pending ask, attached for: %s", async (prompt) => {
    expect(await offered(prompt, true)).toContain("resolveContradiction");
  });
});

describe("with NO pending ask, only record-specific wording attaches it", () => {
  it.each(["the record is right, I was off", "yeah the record\u2019s right", "the claim was wrong", "the record is accurate"])(
    "attached for: %s",
    async (prompt) => {
      expect(await offered(prompt)).toContain("resolveContradiction");
    },
  );

  it.each(["ignore this file please", "docs are out of date", "what are my tasks today"])(
    "NOT attached for: %s",
    async (prompt) => {
      expect(await offered(prompt)).not.toContain("resolveContradiction");
    },
  );
});

describe("resolveContradiction tool · honest result fields", () => {
  it("an auto-expired row reports side expired, not dismissed", async () => {
    h.contradiction.updateMany.mockResolvedValue({ count: 0 });
    h.contradiction.findFirst.mockResolvedValue({ ...CLOSED, resolvedHow: "Auto-resolved after 30 days without action" });
    const out = await resolveTool.execute({ contradictionKey: "tbl:ck_9", side: "dismissed" });
    expect(out).toMatchObject({ ok: true, side: "expired", alreadyResolved: true });
  });

  it("a note or current belief on a table row is reported as not stored", async () => {
    h.contradiction.updateMany.mockResolvedValue({ count: 1 });
    h.contradiction.findFirst.mockResolvedValue(CLOSED);
    const out = await resolveTool.execute({
      contradictionKey: "tbl:ck_9",
      side: "old_wins",
      note: "moved on in spring",
      currentBelief: "I walk the dog once a day now",
    });
    expect(String(out.notStored)).toMatch(/not stored for table rows/);
  });

  it("CONTROL · no note, no notice", async () => {
    h.contradiction.updateMany.mockResolvedValue({ count: 1 });
    h.contradiction.findFirst.mockResolvedValue(CLOSED);
    const out = await resolveTool.execute({ contradictionKey: "tbl:ck_9", side: "old_wins" });
    expect(out.notStored).toBeUndefined();
  });
});
