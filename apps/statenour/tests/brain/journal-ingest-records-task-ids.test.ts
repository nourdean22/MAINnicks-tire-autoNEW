/**
 * The writer half of W3b (job 2026-10-30-goals-system): ingestJournal records the ids of the
 * tasks it creates in the entry's extractedItems JSON, which is what lets a later goal link
 * reach those tasks (lib/brain/journal-task-link.ts). Without this the link step reads no ids
 * and silently does nothing, which is how the first W3b design failed.
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
  return { prisma, aiChat: vi.fn(), createTask: vi.fn() };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => h.aiChat }));
vi.mock("@/lib/services/tasks", () => ({ createTask: h.createTask }));
vi.mock("@/lib/services/missions", () => ({ resolveInboxMissionId: vi.fn(async () => "m-inbox") }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn(async () => undefined) }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitBrainDumpFinalized: vi.fn() }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: new Proxy({}, { get: () => vi.fn(async () => null) }) }));
vi.mock("@/lib/mastery/credit-signal", () => ({ creditFromSignal: vi.fn(async () => undefined) }));
vi.mock("@/lib/journal/settings", () => ({ getJournalSettings: vi.fn(async () => ({})) }));
vi.mock("@/lib/brain/journal-fanout", () => ({ dispatchJournalFanout: vi.fn(async () => undefined) }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { ingestJournal } from "@/lib/brain/journal-ingest";

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.brainDump.update.mockImplementation(async (args: { where: { id: string } }) => ({ id: args.where.id, createdAt: new Date() }));
  h.aiChat.mockResolvedValue({
    content: JSON.stringify({
      entryType: "planning",
      summary: "I planned the week.",
      actionItems: [{ title: "Call the supplier" }, { title: "Book the dyno slot" }],
    }),
  });
  h.createTask.mockResolvedValueOnce({ id: "t1" }).mockResolvedValueOnce({ id: "t2" });
});

describe("ingestJournal · records the tasks it made", () => {
  it("writes createdTaskIds into the entry's extractedItems, keeping what the journal stored", async () => {
    await ingestJournal("Plan: call the supplier and book the dyno slot", "chat", { reuseDumpId: "d1" });
    expect(h.createTask).toHaveBeenCalledTimes(2);
    const writes = h.prisma.brainDump.update.mock.calls
      .map(([a]: [{ data?: { extractedItems?: string } }]) => a.data?.extractedItems)
      .filter((x: unknown): x is string => typeof x === "string");
    const last = JSON.parse(writes[writes.length - 1]);
    expect(last.createdTaskIds).toEqual(["t1", "t2"]);
    expect(last.actionItems).toHaveLength(2);
    expect(last.entryType).toBe("planning");
  });

  it("a task that failed to create is not recorded", async () => {
    h.createTask.mockReset();
    h.createTask.mockRejectedValueOnce(new Error("db")).mockResolvedValueOnce({ id: "t2" });
    await ingestJournal("Plan: call the supplier and book the dyno slot", "chat", { reuseDumpId: "d1" });
    const writes = h.prisma.brainDump.update.mock.calls
      .map(([a]: [{ data?: { extractedItems?: string } }]) => a.data?.extractedItems)
      .filter((x: unknown): x is string => typeof x === "string");
    expect(JSON.parse(writes[writes.length - 1]).createdTaskIds).toEqual(["t2"]);
  });
});
