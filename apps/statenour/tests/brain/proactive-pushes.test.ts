import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────

const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();
const mockBodyTrackingFindUnique = vi.fn().mockResolvedValue(null);
const mockApprovalRequestCount = vi.fn().mockResolvedValue(0);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findUnique: () => mockFindUnique(),
      upsert: () => mockUpsert(),
    },
    bodyTracking: {
      findUnique: () => mockBodyTrackingFindUnique(),
    },
    approvalRequest: {
      count: () => mockApprovalRequestCount(),
    },
  },
}));

const mockSendTelegram = vi.fn();
vi.mock("@/lib/services/telegram", () => ({
  sendTelegram: (text: string) => mockSendTelegram(text),
}));

let mockAnticipatedQuestions: any[] = [{ question: "What is Nour's target today?" }];
vi.mock("@/lib/brain/anticipated-questions", () => ({
  getTodaysAnticipated: async () => ({
    questions: mockAnticipatedQuestions,
  }),
}));

let mockCurrentConcerns: any = {
  threads: [{ text: "Resolve memory leak check", sourceLastAt: new Date().toISOString(), kind: "question" }],
};
vi.mock("@/lib/brain/session-distiller", () => ({
  getNickCurrentConcerns: async () => mockCurrentConcerns,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({
      info: () => {},
      warn: () => {},
      error: () => {},
    }),
  },
}));

import {
  fireMorningPush,
  fireAfternoonPush,
  fireEveningPush,
  fireSlotForCurrentHour,
} from "@/lib/brain/proactive-pushes";

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUnique.mockReset();
  mockUpsert.mockReset();
  mockBodyTrackingFindUnique.mockReset().mockResolvedValue(null);
  mockSendTelegram.mockReset();
  mockApprovalRequestCount.mockReset().mockResolvedValue(0);
  mockAnticipatedQuestions = [{ question: "What is Nour's target today?" }];
  mockCurrentConcerns = {
    threads: [{ text: "Resolve memory leak check", sourceLastAt: new Date().toISOString(), kind: "question" }],
  };
});

describe("Proactive Pushes Dry-Run Logic", () => {
  it("Morning push returns PushPreview structure in dry-run mode and never sends or writes", async () => {
    mockFindUnique.mockResolvedValue(null); // No duplicate
    
    // Simulate morning hour (e.g. 8am ET)
    const now = new Date("2026-06-10T08:00:00-04:00");
    const result = await fireMorningPush({ dryRun: true, now });

    expect(result.kind).toBe("preview");
    expect(result.slot).toBe("morning");
    expect(result.wouldSend).toBe(true);
    expect(result.wouldSkip).toBe(false);
    expect(result.dedupBlocked).toBe(false);
    expect(result.quietHoursBlocked).toBe(false);
    expect(result.riskFlags).toContain("preview_only");
    expect(result.riskFlags).toContain("live_send_disabled");

    expect(mockSendTelegram).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("Morning push returns wouldSkip if duplicate exists (dedup logic works)", async () => {
    mockFindUnique.mockResolvedValue({ id: "marker-123" }); // Duplicate exists
    
    const now = new Date("2026-06-10T08:00:00-04:00");
    const result = await fireMorningPush({ dryRun: true, now });

    expect(result.kind).toBe("preview");
    expect(result.wouldSend).toBe(false);
    expect(result.wouldSkip).toBe(true);
    expect(result.dedupBlocked).toBe(true);
    expect(result.reason).toBe("already_pushed_today");
    expect(result.riskFlags).toContain("already_sent_today");

    expect(mockSendTelegram).not.toHaveBeenCalled();
  });

  it("Afternoon push returns PushPreview and does not trigger side-effects", async () => {
    mockFindUnique.mockResolvedValue(null);
    
    const now = new Date("2026-06-10T14:00:00-04:00");
    const result = await fireAfternoonPush({ dryRun: true, now });

    expect(result.kind).toBe("preview");
    expect(result.slot).toBe("afternoon");
    expect(result.wouldSend).toBe(true);
    expect(result.messageText).toContain("Resolve memory leak check");

    expect(mockSendTelegram).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("Evening push respects sleep and energy tracking flags", async () => {
    mockFindUnique.mockResolvedValue(null);
    
    const now = new Date("2026-06-10T21:00:00-04:00");
    const result = await fireEveningPush({ dryRun: true, now });

    expect(result.kind).toBe("preview");
    expect(result.slot).toBe("evening");
    expect(result.wouldSend).toBe(true);

    expect(mockSendTelegram).not.toHaveBeenCalled();
  });

  describe("fireSlotForCurrentHour mapping", () => {
    it("maps 8am ET (morning hour) to morning slot", async () => {
      mockFindUnique.mockResolvedValue(null);
      const now = new Date("2026-06-10T08:00:00-04:00"); // 8am ET
      const result = await fireSlotForCurrentHour({ dryRun: true, now });
      expect(result.slot).toBe("morning");
    });

    it("maps 2pm ET (afternoon hour) to afternoon slot", async () => {
      mockFindUnique.mockResolvedValue(null);
      const now = new Date("2026-06-10T14:00:00-04:00"); // 2pm ET
      const result = await fireSlotForCurrentHour({ dryRun: true, now });
      expect(result.slot).toBe("afternoon");
    });

    it("maps 9pm ET (evening hour) to evening slot", async () => {
      mockFindUnique.mockResolvedValue(null);
      const now = new Date("2026-06-10T21:00:00-04:00"); // 9pm ET
      const result = await fireSlotForCurrentHour({ dryRun: true, now });
      expect(result.slot).toBe("evening");
    });

    it("identifies overnight hours as quietHoursBlocked and skips", async () => {
      mockFindUnique.mockResolvedValue(null);
      const now = new Date("2026-06-10T03:00:00-04:00"); // 3am ET
      const result = await fireSlotForCurrentHour({ dryRun: true, now });
      expect(result.wouldSend).toBe(false);
      expect(result.wouldSkip).toBe(true);
      expect(result.quietHoursBlocked).toBe(true);
      expect(result.riskFlags).toContain("quiet_hours_overnight");
    });
  });

  describe("Memory Source Attribution", () => {
    it("Morning preview attaches anticipated question source when available", async () => {
      mockFindUnique.mockResolvedValue(null);
      const now = new Date("2026-06-10T08:00:00-04:00");
      const result = await fireMorningPush({ dryRun: true, now });

      expect(result.kind).toBe("preview");
      expect(result.sources).toHaveLength(1);
      const src = result.sources[0];
      expect(src.category).toBe("anticipated_question");
      expect(src.title).toBe("Anticipated Question");
      expect(src.summary).toContain("What is Nour's target today?");
      expect(src.confidence).toBe("high");
      expect(src.href).toBe("/brain?tab=board");
      expect(src.summary.length).toBeLessThan(150);
    });

    it("Morning preview attaches system_context fallback when questions are missing", async () => {
      mockFindUnique.mockResolvedValue(null);
      mockAnticipatedQuestions = []; // clear questions
      const now = new Date("2026-06-10T08:00:00-04:00");
      const result = await fireMorningPush({ dryRun: true, now });

      expect(result.kind).toBe("preview");
      expect(result.sources).toHaveLength(1);
      const src = result.sources[0];
      expect(src.category).toBe("system_context");
      expect(src.title).toBe("Anticipated Question Fallback");
      expect(src.confidence).toBe("medium");
      expect(src.summary.length).toBeLessThan(150);
    });

    it("Afternoon preview attaches concern source with deep link when concerns are available", async () => {
      mockFindUnique.mockResolvedValue(null);
      mockCurrentConcerns = {
        threads: [{
          text: "Resolve memory leak check",
          sourceLastAt: new Date().toISOString(),
          kind: "question",
          sourceConversationId: "conv-123",
        }],
      };
      const now = new Date("2026-06-10T14:00:00-04:00");
      const result = await fireAfternoonPush({ dryRun: true, now });

      expect(result.kind).toBe("preview");
      expect(result.sources).toHaveLength(1);
      const src = result.sources[0];
      expect(src.category).toBe("concern");
      expect(src.title).toBe("Active Concern Thread");
      expect(src.summary).toContain("Resolve memory leak");
      expect(src.confidence).toBe("high");
      expect(src.href).toBe("/chat?cid=conv-123");
      expect(src.summary.length).toBeLessThan(150);
    });

    it("Afternoon preview attaches system_context fallback when concerns are missing", async () => {
      mockFindUnique.mockResolvedValue(null);
      mockCurrentConcerns = { threads: [] };
      const now = new Date("2026-06-10T14:00:00-04:00");
      const result = await fireAfternoonPush({ dryRun: true, now });

      expect(result.kind).toBe("preview");
      expect(result.sources).toHaveLength(1);
      const src = result.sources[0];
      expect(src.category).toBe("system_context");
      expect(src.title).toBe("Concern Thread Fallback");
      expect(src.confidence).toBe("medium");
      expect(src.summary.length).toBeLessThan(150);
    });

    it("Evening preview attaches body source with stats and link when body tracking is present", async () => {
      mockFindUnique.mockResolvedValue(null);
      mockBodyTrackingFindUnique.mockResolvedValue({
        id: 42,
        sleepHours: 7.5,
        energy: 8,
      });
      const now = new Date("2026-06-10T21:00:00-04:00");
      const result = await fireEveningPush({ dryRun: true, now });

      expect(result.kind).toBe("preview");
      expect(result.sources).toHaveLength(1);
      const src = result.sources[0];
      expect(src.category).toBe("body");
      expect(src.title).toBe("Daily Health Check-in");
      expect(src.summary).toContain("7.5h sleep");
      expect(src.summary).toContain("energy 8/10");
      expect(src.confidence).toBe("high");
      expect(src.href).toBe("/stats#body");
      expect(src.id).toBe("42");
      expect(src.summary.length).toBeLessThan(150);
    });

    it("Evening preview attaches system_context fallback when body tracking is missing", async () => {
      mockFindUnique.mockResolvedValue(null);
      mockBodyTrackingFindUnique.mockResolvedValue(null);
      const now = new Date("2026-06-10T21:00:00-04:00");
      const result = await fireEveningPush({ dryRun: true, now });

      expect(result.kind).toBe("preview");
      expect(result.sources).toHaveLength(1);
      const src = result.sources[0];
      expect(src.category).toBe("system_context");
      expect(src.title).toBe("Evening Review Ritual");
      expect(src.confidence).toBe("medium");
      expect(src.summary.length).toBeLessThan(150);
    });

    it("Overnight dispatcher attaches overnight quiet hours system_context source", async () => {
      mockFindUnique.mockResolvedValue(null);
      const now = new Date("2026-06-10T03:00:00-04:00"); // 3am ET
      const result = await fireSlotForCurrentHour({ dryRun: true, now });

      expect(result.kind).toBe("preview");
      expect(result.sources).toHaveLength(1);
      const src = result.sources[0];
      expect(src.category).toBe("system_context");
      expect(src.title).toBe("Overnight Quiet Hours");
      expect(src.confidence).toBe("high");
    });
  });
});

