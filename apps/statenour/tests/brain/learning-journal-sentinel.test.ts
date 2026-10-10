/**
 * Audit 2026-10-10 sentinel sweep (Task 2b): the nightly learning journal
 * stored the outage apology as the brain's "self-assessment" (BrainMemory
 * learning_journal row + its metadata, read by /journal). A sentinel must
 * take the same metric-only fallback a thrown call takes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () => (...a: unknown[]) => mockChat(...a),
}));
vi.mock("@/lib/prisma", () => {
  const model = () => ({
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
  });
  const models: Record<string, ReturnType<typeof model>> = {};
  return { prisma: new Proxy({}, { get: (_t, k: string) => (models[k] ??= model()) }) };
});
const remember = vi.fn();
vi.mock("@/lib/brain/memory-manager", () => ({
  brainMemory: { remember: (...a: unknown[]) => remember(...a) },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { generateLearningJournal } from "@/lib/brain/learning-journal";

const SENTINEL = {
  content: "I'm having trouble connecting to my AI providers right now. try again in a moment.",
  provider: "emergency",
  model: "none",
};

beforeEach(() => {
  mockChat.mockReset();
  remember.mockReset().mockResolvedValue({ id: "mem1" });
});

describe("generateLearningJournal - provider sentinel", () => {
  it("stores the metric fallback, not the outage text", async () => {
    mockChat.mockResolvedValue(SENTINEL);
    const entry = await generateLearningJournal();
    expect(entry.selfAssessment).not.toContain("trouble connecting");
    expect(entry.selfAssessment).toContain("Created 0 memories");
    expect(String(remember.mock.calls[0][2])).not.toContain("trouble connecting");
  });

  it("control: a real self-assessment is stored", async () => {
    mockChat.mockResolvedValue({ content: "Quiet day: no new memories.", provider: "ollama", model: "m" });
    const entry = await generateLearningJournal();
    expect(entry.selfAssessment).toBe("Quiet day: no new memories.");
  });
});
