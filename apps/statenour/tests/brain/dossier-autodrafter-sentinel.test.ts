/**
 * Audit 2026-10-10 08-F5: the aiChat outage sentinel came back as a
 * non-empty "draft" and was offered as the person's dossier. A sentinel is a
 * failed draft: draftDossierFor returns null so the caller skips the profile.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  tracedAiChat: (...a: unknown[]) => mockChat(...a),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    personProfile: {
      findFirst: vi.fn().mockResolvedValue({
        id: "p1",
        name: "Sam",
        role: "mentor",
        dossierMd: null,
        behavioralFingerprint: null,
      }),
    },
    chatMessage: { findMany: vi.fn().mockResolvedValue([]) },
    relationshipLedger: { findMany: vi.fn().mockResolvedValue([]) },
    brainMemory: { findMany: vi.fn().mockResolvedValue([]) },
    aiGeneration: { groupBy: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/lib/services/people/contact-rows", () => ({
  contactRowsOnly: (rows: unknown[]) => rows,
}));

import { draftDossierFor } from "@/lib/brain/dossier-autodrafter";

beforeEach(() => {
  mockChat.mockReset();
});

describe("draftDossierFor - provider sentinel", () => {
  it("returns null on the emergency sentinel", async () => {
    mockChat.mockResolvedValue({
      content: "I'm having trouble connecting to my AI providers right now. try again in a moment.",
      provider: "emergency",
      model: "none",
    });
    await expect(draftDossierFor("p1")).resolves.toBeNull();
  });

  it("control: returns a real draft", async () => {
    mockChat.mockResolvedValue({ content: "- Sam is a mentor.", provider: "ollama", model: "m" });
    await expect(draftDossierFor("p1")).resolves.toBe("- Sam is a mentor.");
  });
});
