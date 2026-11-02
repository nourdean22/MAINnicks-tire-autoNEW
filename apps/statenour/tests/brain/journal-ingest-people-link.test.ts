/**
 * W4 (job 2026-11-02-nour-os-interconnect) · the writer end: ingestJournal hands the people the extraction named to
 * linkJournalPeople with the entry's own id, its createdAt (the ledger date and the once-per-entry window) and his raw
 * words. Without this wiring the link service is a writer nobody calls (assert-the-consumer).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const model = () =>
    new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
      get(target, key: string) {
        if (!target[key]) target[key] = vi.fn(async () => (key.startsWith("findMany") ? [] : key === "count" ? 0 : null));
        return target[key];
      },
    });
  const prisma = new Proxy({} as Record<string, Record<string, ReturnType<typeof vi.fn>>>, {
    get(target, key: string) {
      if (!target[key]) target[key] = model();
      return target[key];
    },
  });
  return { prisma, aiChat: vi.fn(), link: vi.fn(), recordError: vi.fn() };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => h.aiChat }));
vi.mock("@/lib/services/tasks", () => ({ createTask: vi.fn(async () => null) }));
vi.mock("@/lib/services/missions", () => ({ resolveInboxMissionId: vi.fn(async () => "m-inbox") }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn(async () => undefined) }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitBrainDumpFinalized: vi.fn() }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: h.recordError }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: new Proxy({}, { get: () => vi.fn(async () => null) }) }));
vi.mock("@/lib/mastery/credit-signal", () => ({ creditFromSignal: vi.fn(async () => undefined) }));
vi.mock("@/lib/journal/settings", () => ({ getJournalSettings: vi.fn(async () => ({})) }));
vi.mock("@/lib/brain/journal-fanout", () => ({ dispatchJournalFanout: vi.fn(async () => undefined) }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/services/people/journal-link", async (orig) => ({
  ...(await orig<typeof import("@/lib/services/people/journal-link")>()),
  linkJournalPeople: h.link,
}));

import { ingestJournal } from "@/lib/brain/journal-ingest";

const createdAt = new Date("2026-11-02T14:00:00Z");
const text = "Talked to Dania about the move tonight.";

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.brainDump.update.mockImplementation(async (args: { where: { id: string } }) => ({ id: args.where.id, createdAt }));
  h.prisma.brainDump.create.mockImplementation(async () => ({ id: "dNew", createdAt }));
  h.link.mockResolvedValue({ personIds: ["p_dania"], recorded: 1, skipped: 0, failed: 0, rejected: 0 });
  h.aiChat.mockResolvedValue({
    content: JSON.stringify({
      entryType: "reflection",
      summary: "I talked to Dania about the move.",
      linkedTopics: ["Dania", "the move"],
      people: [{ name: "Dania", interacted: true }],
    }),
  });
});

describe("ingestJournal · links the people the entry names", () => {
  it("passes the entry id, its createdAt and his raw words to linkJournalPeople", async () => {
    await ingestJournal(text, "manual");
    expect(h.link).toHaveBeenCalledTimes(1);
    expect(h.link).toHaveBeenCalledWith({ dumpId: "dNew", createdAt, rawText: text, people: [{ name: "Dania", interacted: true }] });
  });

  it("a re-process (reuseDumpId) links against the ORIGINAL entry and its original createdAt", async () => {
    await ingestJournal(text, "chat", { reuseDumpId: "dOld" });
    expect(h.link.mock.calls[0][0]).toMatchObject({ dumpId: "dOld", createdAt });
  });

  it("the extraction prompt asks for people with an interacted flag", async () => {
    await ingestJournal(text, "manual");
    const system = h.aiChat.mock.calls[0][0][0].content as string;
    expect(system).toMatch(/"people"/);
    expect(system).toMatch(/interacted/);
  });

  it("a link failure never breaks the ingest, and it is recorded, not swallowed", async () => {
    h.link.mockRejectedValue(new Error("db down"));
    const r = await ingestJournal(text, "manual");
    expect(r.summary).toBe("I talked to Dania about the move.");
    expect(h.recordError).toHaveBeenCalledWith("brain:journal-ingest", expect.any(Error), expect.objectContaining({ phase: "people-link" }));
  });

  it("an extraction with no people still calls the link with an empty list (a re-process clears stale ids)", async () => {
    h.aiChat.mockResolvedValue({ content: JSON.stringify({ entryType: "raw", summary: "I am tired." }) });
    await ingestJournal("tired today", "manual");
    expect(h.link.mock.calls[0][0].people).toEqual([]);
  });
});
