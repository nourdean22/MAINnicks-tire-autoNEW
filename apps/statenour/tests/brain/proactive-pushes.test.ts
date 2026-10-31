import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────

const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();
const mockCreate = vi.fn();
const mockDeleteMany = vi.fn();
const mockBodyTrackingFindUnique = vi.fn().mockResolvedValue(null);
const mockApprovalRequestCount = vi.fn().mockResolvedValue(0);
const mockAutonomousActionCount = vi.fn().mockResolvedValue(0);
const mockLogWarn = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findUnique: () => mockFindUnique(),
      upsert: () => mockUpsert(),
      create: (a: unknown) => mockCreate(a),
      deleteMany: (a: unknown) => mockDeleteMany(a),
    },
    bodyTracking: {
      findUnique: () => mockBodyTrackingFindUnique(),
    },
    approvalRequest: {
      count: () => mockApprovalRequestCount(),
    },
    autonomousAction: {
      count: () => mockAutonomousActionCount(),
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

// No ledger id, so sendRatablePush takes the plain sendTelegram path.
vi.mock("@/lib/services/outcome-ledger", () => ({ recordShown: async () => null }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({
      info: () => {},
      warn: (...a: unknown[]) => mockLogWarn(...a),
      error: () => {},
    }),
  },
}));

import {
  fireMorningPush,
  fireAfternoonPush,
  fireEveningPush,
  fireSlotForCurrentHour,
  checkAndNudgeApprovals,
} from "@/lib/brain/proactive-pushes";

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUnique.mockReset();
  mockUpsert.mockReset();
  mockCreate.mockReset().mockResolvedValue({ id: "claim-1" });
  mockDeleteMany.mockReset().mockResolvedValue({ count: 1 });
  mockBodyTrackingFindUnique.mockReset().mockResolvedValue(null);
  mockSendTelegram.mockReset();
  mockApprovalRequestCount.mockReset().mockResolvedValue(0);
  mockAutonomousActionCount.mockReset().mockResolvedValue(0);
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
      expect(src.href).toBe("/chat");
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
      expect(src.href).toBe("/stats?tab=body");
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

// 08-X1: the live path read the marker, sent, then wrote it. A failed read (or two
// racing runs) read "not sent" and both sent. The marker is now CLAIMED with a create
// on the (category, key) unique index BEFORE the send; P2002 means someone else has it.
describe("live push: claim before send", () => {
  const MORNING = new Date("2026-06-10T08:00:00-04:00");
  const p2002 = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

  it("a failed marker read on a slot already sent today does NOT send again", async () => {
    mockFindUnique.mockRejectedValue(new Error("db hiccup"));
    mockCreate.mockRejectedValue(p2002());
    mockSendTelegram.mockResolvedValue(true);
    const r = await fireMorningPush({ now: MORNING });
    expect(mockSendTelegram).not.toHaveBeenCalled();
    expect(r).toMatchObject({ kind: "live", fired: false });
  });

  it("a race: the read says not sent, the claim hits P2002 -> no send", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockRejectedValue(p2002());
    mockSendTelegram.mockResolvedValue(true);
    await fireMorningPush({ now: MORNING });
    expect(mockSendTelegram).not.toHaveBeenCalled();
  });

  it("the claim store is down -> no send (fail closed)", async () => {
    mockFindUnique.mockRejectedValue(new Error("db down"));
    mockCreate.mockRejectedValue(new Error("db down"));
    mockSendTelegram.mockResolvedValue(true);
    const r = await fireMorningPush({ now: MORNING });
    expect(mockSendTelegram).not.toHaveBeenCalled();
    expect(r).toMatchObject({ fired: false, reason: "dedupe_unavailable" });
  });

  it("a failed send releases the claim so the next tick can retry", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockSendTelegram.mockResolvedValue(false);
    await fireMorningPush({ now: MORNING });
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { category: "proactive_push_sent", key: "morning_2026-06-10" },
    });
  });

  it("CONTROL: an unclaimed slot claims once, sends once, keeps the claim", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockSendTelegram.mockResolvedValue(true);
    const r = await fireMorningPush({ now: MORNING });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ data: { category: "proactive_push_sent", key: "morning_2026-06-10" } });
    expect(mockSendTelegram).toHaveBeenCalledTimes(1);
    expect(mockDeleteMany).not.toHaveBeenCalled();
    expect(r).toMatchObject({ fired: true, reason: "sent" });
  });

  it("CONTROL: the dry-run preview still never claims", async () => {
    mockFindUnique.mockResolvedValue(null);
    await fireMorningPush({ dryRun: true, now: MORNING });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// home-pulse W3b (2026-10-31): one approvals message per tick. The hourly cron runs the morning slot and
// checkAndNudgeApprovals in the SAME tick, both from 06:00 ET, and both told him the approval count: two
// Telegrams for one fact. The governance nudge is the dedicated, fuller message (autonomous + tool
// approvals), so it owns the count; the morning push carries only Nick's pick.
describe("W3b · approvals reach him once per tick", () => {
  const SIX_AM = new Date("2026-06-10T06:00:00-04:00");

  it("the morning push no longer repeats the approval count", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockSendTelegram.mockResolvedValue(true);
    mockApprovalRequestCount.mockResolvedValue(3);
    await fireMorningPush({ now: SIX_AM });
    expect(mockSendTelegram).toHaveBeenCalledTimes(1);
    expect(String(mockSendTelegram.mock.calls[0][0])).not.toMatch(/approval/i);
  });

  it("with only approvals waiting, the morning push stays silent and the nudge carries the count", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockSendTelegram.mockResolvedValue(true);
    mockAnticipatedQuestions = [];
    mockApprovalRequestCount.mockResolvedValue(3);
    const morning = await fireMorningPush({ now: SIX_AM });
    expect(morning).toMatchObject({ fired: false, reason: "no_anticipated_set" });
    await checkAndNudgeApprovals({ now: SIX_AM });
    const texts = mockSendTelegram.mock.calls.map((c) => String(c[0]));
    expect(texts.filter((t) => /approval/i.test(t))).toHaveLength(1);
    expect(texts[0]).toContain("<b>3</b> tool execution(s) pending approval");
  });
});

// A failed count read is UNKNOWN, never zero (empty-vs-error). Before: autonomousAction.count had no catch,
// so one throw failed the hourly check-nudges step twice and that hour's approval count never reached him;
// approvalRequest.count mapped a failure to 0, so the nudge skipped as "no_pending_actions" with no signal.
describe("approvals nudge · an unreadable count is unknown, never zero", () => {
  const SIX_AM = new Date("2026-06-10T06:00:00-04:00");
  const unreadable = /could not read the (autonomous action|tool approval) count/i;
  const sent = () => mockSendTelegram.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    mockFindUnique.mockResolvedValue(null);
    mockSendTelegram.mockResolvedValue(true);
  });

  it("autonomousAction.count rejects: the tool-approval half is still sent, the gap is said, and a warn is logged", async () => {
    mockAutonomousActionCount.mockRejectedValue(new Error("connection reset"));
    mockApprovalRequestCount.mockResolvedValue(3);
    const r = await checkAndNudgeApprovals({ now: SIX_AM });
    expect(r).toMatchObject({ kind: "live", fired: true, reason: "sent" });
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toContain("<b>3</b> tool execution(s) pending approval");
    expect(sent()[0]).toMatch(/could not read the autonomous action count/i);
    expect(sent()[0]).not.toMatch(/\bautonomous action\(s\) pending/);
    expect(mockLogWarn).toHaveBeenCalledTimes(1);
  });

  it("autonomousAction.count throwing synchronously is handled the same way", async () => {
    mockAutonomousActionCount.mockImplementation(() => {
      throw new Error("client not ready");
    });
    mockApprovalRequestCount.mockResolvedValue(3);
    const r = await checkAndNudgeApprovals({ now: SIX_AM });
    expect(r).toMatchObject({ kind: "live", fired: true });
    expect(sent()[0]).toContain("<b>3</b> tool execution(s) pending approval");
    expect(mockLogWarn).toHaveBeenCalledTimes(1);
  });

  it("approvalRequest.count rejects while actions wait: the action count is sent and the tool-approval gap is said", async () => {
    mockAutonomousActionCount.mockResolvedValue(2);
    mockApprovalRequestCount.mockRejectedValue(new Error("connection reset"));
    const r = await checkAndNudgeApprovals({ now: SIX_AM });
    expect(r).toMatchObject({ kind: "live", fired: true });
    expect(sent()[0]).toContain("<b>2</b> autonomous action(s) pending approval");
    expect(sent()[0]).toMatch(/could not read the tool approval count/i);
    expect(mockLogWarn).toHaveBeenCalledTimes(1);
  });

  it("both reads fail: skips as approval_count_unreadable (not no_pending_actions), sends nothing, warns twice", async () => {
    mockAutonomousActionCount.mockRejectedValue(new Error("down"));
    mockApprovalRequestCount.mockRejectedValue(new Error("down"));
    const r = await checkAndNudgeApprovals({ now: SIX_AM });
    expect(r).toMatchObject({ kind: "skip", reason: "approval_count_unreadable" });
    expect(mockSendTelegram).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledTimes(2);
  });

  it("one read fails and the other reads zero: still unreadable, not 'no pending actions'", async () => {
    mockAutonomousActionCount.mockResolvedValue(0);
    mockApprovalRequestCount.mockRejectedValue(new Error("down"));
    expect(await checkAndNudgeApprovals({ now: SIX_AM })).toMatchObject({ kind: "skip", reason: "approval_count_unreadable" });
    mockAutonomousActionCount.mockReset().mockRejectedValue(new Error("down"));
    mockApprovalRequestCount.mockReset().mockResolvedValue(0);
    expect(await checkAndNudgeApprovals({ now: SIX_AM })).toMatchObject({ kind: "skip", reason: "approval_count_unreadable" });
    expect(mockSendTelegram).not.toHaveBeenCalled();
  });

  it("a dry run with an unreadable count previews instead of throwing", async () => {
    mockAutonomousActionCount.mockRejectedValue(new Error("down"));
    mockApprovalRequestCount.mockResolvedValue(3);
    const r = await checkAndNudgeApprovals({ now: SIX_AM, dryRun: true });
    expect(r).toMatchObject({ kind: "preview", wouldSend: true });
    expect(mockSendTelegram).not.toHaveBeenCalled();
  });

  it("CONTROL: both reads succeed with zero: skips as no_pending_actions and logs no warn", async () => {
    const r = await checkAndNudgeApprovals({ now: SIX_AM });
    expect(r).toMatchObject({ kind: "skip", reason: "no_pending_actions" });
    expect(mockLogWarn).not.toHaveBeenCalled();
  });

  it("CONTROL: both reads succeed: both counts are sent, no gap line, no warn", async () => {
    mockAutonomousActionCount.mockResolvedValue(2);
    mockApprovalRequestCount.mockResolvedValue(3);
    await checkAndNudgeApprovals({ now: SIX_AM });
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toContain("<b>2</b> autonomous action(s) pending approval");
    expect(sent()[0]).toContain("<b>3</b> tool execution(s) pending approval");
    expect(sent()[0]).not.toMatch(unreadable);
    expect(mockLogWarn).not.toHaveBeenCalled();
  });
});
