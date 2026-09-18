/**
 * The silo derivation must be WIRED, not merely correct.
 *
 * WHY THIS FILE EXISTS. tests/brain/journal-silo-derive.test.ts proves
 * `deriveJournalSilos` behaves — and every one of its 19 cases stays GREEN if
 * the call is deleted from `ingestJournal`, because it never loads the
 * pipeline. That is the orphaned-subject shape this repo has paid for before:
 * `hard-delete-guard` had excellent unit tests and no proof the destructive
 * caller consulted it, and the OTel mapper and recall-corpus-builder both
 * shipped built-tested-and-unwired.
 *
 * So this asserts the CALLER: that ingestJournal invokes the derivation, with
 * the dump's own id and the classified entryType — the two inputs that decide
 * whether a row is written and which silo it lands in.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  derive: vi.fn(),
  aiChat: vi.fn(),
  dumpFindFirst: vi.fn(),
  dumpCreate: vi.fn(),
  dumpUpdate: vi.fn(),
}));

// The subject under test. Mocked so this file proves the WIRING only; the
// behaviour is pinned separately in journal-silo-derive.test.ts.
vi.mock("@/lib/brain/journal-silo-derive", () => ({
  deriveJournalSilos: m.derive,
}));

vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () => m.aiChat,
}));

vi.mock("@/lib/prisma", () => {
  const generic = () => ({
    create: vi.fn().mockResolvedValue({ id: "x" }),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    upsert: vi.fn().mockResolvedValue({}),
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  });
  const brainDump = {
    findFirst: (...a: unknown[]) => m.dumpFindFirst(...a),
    create: (...a: unknown[]) => m.dumpCreate(...a),
    update: (...a: unknown[]) => m.dumpUpdate(...a),
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    upsert: vi.fn().mockResolvedValue({}),
  };
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, p: string) => {
          if (p === "brainDump") return brainDump;
          if (p === "$queryRaw" || p === "$queryRawUnsafe") return () => Promise.resolve([]);
          if (p === "$executeRaw" || p === "$executeRawUnsafe") return () => Promise.resolve(0);
          if (p === "$transaction") return async (fn: unknown) =>
            typeof fn === "function" ? (fn as (t: unknown) => unknown)({}) : [];
          return generic();
        },
      },
    ),
  };
});

// Collaborators the pipeline fires on the way past. None of them decide whether
// the derivation runs, so they are stubbed to the quietest useful shape.
vi.mock("@/lib/journal/settings", () => ({
  getJournalSettings: vi.fn(async () => ({ autoTask: false, autoCommitment: false })),
}));
vi.mock("@/lib/brain/journal-fanout", () => ({ dispatchJournalFanout: vi.fn() }));
vi.mock("@/lib/brain/memory-manager", () => ({
  brainMemory: { remember: vi.fn(), recall: vi.fn(async () => []) },
}));
vi.mock("@/lib/services/tasks", () => ({ createTask: vi.fn() }));
vi.mock("@/lib/services/missions", () => ({ resolveInboxMissionId: vi.fn(async () => "m-inbox") }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn() }));
vi.mock("@/lib/mastery/credit-signal", () => ({ creditFromSignal: vi.fn() }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitBrainDumpFinalized: vi.fn() }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));

import { ingestJournal } from "@/lib/brain/journal-ingest";

const LONG =
  "Looking back on the week, the tire pricing call was the thing that actually moved revenue.";

beforeEach(() => {
  vi.clearAllMocks();
  m.derive.mockResolvedValue({});
  m.dumpFindFirst.mockResolvedValue(null); // not a duplicate submit
  m.dumpCreate.mockResolvedValue({ id: "bd-wired" });
  m.dumpUpdate.mockResolvedValue({});
  m.aiChat.mockResolvedValue({
    content: JSON.stringify({
      summary: "Pricing call moved revenue.",
      entryType: "reflection",
      insights: [],
      tasks: [],
      commitments: [],
      concerns: [],
      wins: [],
    }),
  });
});

describe("ingestJournal actually consults the silo derivation", () => {
  it("BREAKS: deleting the call leaves this red — the derivation is invoked", async () => {
    await ingestJournal(LONG, "telegram");
    expect(m.derive, "ingestJournal must invoke deriveJournalSilos").toHaveBeenCalled();
  });

  it("passes the dump's OWN id and the classified entryType", async () => {
    await ingestJournal(LONG, "telegram");
    const arg = m.derive.mock.calls[0][0] as { brainDumpId: string; entryType: string; text: string };
    // These two decide whether a row is written and which silo it lands in.
    expect(arg.brainDumpId).toBe("bd-wired");
    expect(arg.entryType).toBe("reflection");
    // Guards against the `rawThoughts` vs `rawText` slip this very wiring had
    // before typecheck caught it.
    expect(arg.text).toBe(LONG);
  });

  it("surfaces the derived id on the result, so callers can see it happened", async () => {
    m.derive.mockResolvedValue({ reflectionId: "r-99" });
    const out = await ingestJournal(LONG, "telegram");
    expect(out.reflectionId).toBe("r-99");
  });

  it("CANARY: a derivation that writes nothing leaves the result clean, not undefined-y", async () => {
    m.derive.mockResolvedValue({ skipped: "entryType maps to no silo" });
    const out = await ingestJournal(LONG, "telegram");
    expect(out.reflectionId).toBeUndefined();
    expect(out.decisionReplayId).toBeUndefined();
    expect(out.brainDumpId).toBe("bd-wired");
  });
});
