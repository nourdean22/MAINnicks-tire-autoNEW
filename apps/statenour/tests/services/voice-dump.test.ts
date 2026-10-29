/**
 * Voice brain dump service (2026-10-29, task upgrades phase 2). Fixtures only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  task: { findFirst: vi.fn(), findMany: vi.fn() },
  relationshipLedger: { findFirst: vi.fn() },
  createTask: vi.fn(),
  resolveInboxMissionId: vi.fn(async () => "inbox-1"),
  tracedAiChat: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { task: m.task, relationshipLedger: m.relationshipLedger } }));
vi.mock("@/lib/services/tasks", () => ({ createTask: m.createTask }));
vi.mock("@/lib/services/missions", () => ({ resolveInboxMissionId: m.resolveInboxMissionId }));
vi.mock("@/lib/ai/traced-aichat", () => ({ tracedAiChat: m.tracedAiChat }));

import { splitBrainDump, saveBrainDump } from "@/lib/services/voice-dump";

beforeEach(() => {
  vi.clearAllMocks();
  m.createTask.mockImplementation(async (p: { title: string }) => ({ id: `new-${p.title}`, title: p.title, status: "READY" }));
});


describe("voice brain dump", () => {
  it("splits a transcript into rows, keeping the speaker's deadline words for the phone to read", async () => {
    m.tracedAiChat.mockResolvedValue({
      provider: "groq",
      content: '[{"title":"Order the brake pads by friday"},{"title":"Text the landlord"}]',
    });
    const res = await splitBrainDump("order the brake pads by friday and text the landlord");
    expect(res.items).toEqual([{ title: "Order the brake pads by friday" }, { title: "Text the landlord" }]);
  });

  it("provider down or unparseable output is an error, not an empty list", async () => {
    m.tracedAiChat.mockResolvedValue({ provider: "emergency", content: "" });
    await expect(splitBrainDump("anything")).rejects.toMatchObject({ status: 503 });
    m.tracedAiChat.mockResolvedValue({ provider: "groq", content: "sure! here you go" });
    await expect(splitBrainDump("anything")).rejects.toMatchObject({ status: 502 });
  });

  it("an empty transcript never calls the model", async () => {
    await expect(splitBrainDump("   ")).resolves.toEqual({ items: [] });
    expect(m.tracedAiChat).not.toHaveBeenCalled();
  });

  it("caps rows at 20 and drops blank titles", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ title: i === 0 ? " " : `Row ${i}` }));
    m.tracedAiChat.mockResolvedValue({ provider: "groq", content: JSON.stringify(many) });
    const res = await splitBrainDump("lots");
    expect(res.items).toHaveLength(20);
    expect(res.items[0].title).toBe("Row 1");
  });

  it("one Save creates every reviewed row in the Inbox, in order", async () => {
    const res = await saveBrainDump([
      { title: "First", dueDate: null },
      { title: "Second", dueDate: "2026-10-31T00:00:00.000Z" },
    ]);
    expect(m.createTask.mock.calls.map((c) => c[0].title)).toEqual(["First", "Second"]);
    expect(m.createTask.mock.calls[0][0]).toMatchObject({ missionId: "inbox-1", status: "INBOX" });
    expect(m.createTask.mock.calls[1][0].dueDate).toEqual(new Date("2026-10-31T00:00:00.000Z"));
    expect(res).toEqual({ created: 2, ids: ["new-First", "new-Second"] });
  });
});
