/**
 * journal-fanout · durable-fanout wave (audit 2026-07-15).
 *
 * Pins:
 *   1. dispatchJournalFanout sends ONE journal/entry.captured event
 *   2. event-send failure degrades to the inline fanout (never throws)
 *   3. runJournalFanout loads text by silo and runs enrich→embed→join
 *   4. short entries skip the embedding stage (40-char floor)
 *   5. missing rows no-op cleanly
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.fn();
vi.mock("@/lib/inngest/client", () => ({
  getInngest: () => ({ send: (evt: unknown) => mockSend(evt) }),
}));

const mockBrainDumpFindUnique = vi.fn();
const mockSituationFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainDump: { findUnique: (args: unknown) => mockBrainDumpFindUnique(args) },
    reflection: { findUnique: vi.fn() },
    situationLog: { findUnique: (args: unknown) => mockSituationFindUnique(args) },
    decisionReplay: { findUnique: vi.fn() },
  },
}));

const mockEnrich = vi.fn();
vi.mock("@/lib/brain/journal-brain", () => ({
  enrichJournalEntry: (...a: unknown[]) => mockEnrich(...a),
}));

const mockEmbed = vi.fn();
vi.mock("@/lib/brain/embedding-utils", () => ({
  storeGenericEmbedding: (...a: unknown[]) => mockEmbed(...a),
}));

const mockJoin = vi.fn();
vi.mock("@/lib/services/journal-threads", () => ({
  tryJoinActiveThreads: (...a: unknown[]) => mockJoin(...a),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
  },
}));

import { dispatchJournalFanout, runJournalFanout } from "@/lib/brain/journal-fanout";

const LONG_TEXT = "Nour is weighing building a custom POS instead of using the vendor system because the vendor fees compound.";

beforeEach(() => {
  vi.clearAllMocks();
  mockSend.mockResolvedValue({ ids: ["evt-1"] });
  mockEnrich.mockResolvedValue(undefined);
  mockEmbed.mockResolvedValue(undefined);
  mockJoin.mockResolvedValue(undefined);
  mockBrainDumpFindUnique.mockResolvedValue({ rawThoughts: LONG_TEXT });
});

describe("dispatchJournalFanout", () => {
  it("sends one journal/entry.captured event", async () => {
    await dispatchJournalFanout("brain_dump", "d-1", { notifyTelegram: true });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0]).toEqual({
      name: "journal/entry.captured",
      data: { silo: "brain_dump", entryId: "d-1", notifyTelegram: true },
    });
    // Durable path — no inline work fired.
    expect(mockEnrich).not.toHaveBeenCalled();
  });

  it("falls back to the inline fanout when the event send fails", async () => {
    mockSend.mockRejectedValue(new Error("inngest down"));

    await dispatchJournalFanout("brain_dump", "d-1");
    // Inline fallback is fire-and-forget — flush microtasks.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockEnrich).toHaveBeenCalledTimes(1);
    expect(mockEmbed).toHaveBeenCalledTimes(1);
    expect(mockJoin).toHaveBeenCalledTimes(1);
  });
});

describe("runJournalFanout", () => {
  it("loads text by silo and runs enrich → embed → thread-join", async () => {
    mockSituationFindUnique.mockResolvedValue({
      situation: "Vendor tried to renegotiate mid-contract after we committed volume.",
      context: "negotiation",
    });

    const r = await runJournalFanout("situation_log", "s-1");

    expect(r.ran).toBe(true);
    expect(mockEnrich).toHaveBeenCalledWith(
      "situation_log",
      "s-1",
      expect.stringContaining("[situation negotiation]"),
      { notifyTelegram: undefined },
    );
    expect(mockEmbed).toHaveBeenCalled();
    expect(mockJoin).toHaveBeenCalled();
  });

  it("skips the embedding stage for entries under 40 chars", async () => {
    mockBrainDumpFindUnique.mockResolvedValue({ rawThoughts: "short but real note" });

    const r = await runJournalFanout("brain_dump", "d-2");

    expect(r.ran).toBe(true);
    expect(mockEnrich).toHaveBeenCalled();
    expect(mockEmbed).not.toHaveBeenCalled();
    expect(mockJoin).toHaveBeenCalled();
  });

  it("no-ops cleanly when the row is gone", async () => {
    mockBrainDumpFindUnique.mockResolvedValue(null);

    const r = await runJournalFanout("brain_dump", "d-404");

    expect(r.ran).toBe(false);
    expect(mockEnrich).not.toHaveBeenCalled();
  });
});
