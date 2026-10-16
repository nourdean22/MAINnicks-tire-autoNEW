/**
 * Daily Tutor (brain W2, 2026-10-16): one Telegram item per ET day that Nour
 * answers with one tap. The tap is graded into the outcome ledger; a decision
 * review tap closes an overdue DecisionReplay.
 *
 * Base rate that motivates it (W0 probe, FACT): 89 pushes shown since 09-18,
 * 0 decided, 2 rated; 29 decision replays, 0 reviewed, 9 overdue. Only a
 * one-tap item has a chance, so every path here is tap -> write -> one line.
 *
 * Stubs follow tests/brain/proactive-pushes.test.ts (prisma + telegram mocked,
 * the claim marker is the real claimPushSlot over a mocked create).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    decisionReplay: { findFirst: vi.fn(), updateMany: vi.fn() },
    intelligenceOutcome: { findMany: vi.fn(), findUnique: vi.fn() },
    brainMemory: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    approvalRequest: { count: vi.fn() },
  },
  recordShown: vi.fn(),
  recordDecision: vi.fn(),
  recordOutcomeResult: vi.fn(),
  markReplayed: vi.fn(),
  remember: vi.fn(),
  sendTelegram: vi.fn(),
  sendTelegramWithButtons: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/services/outcome-ledger", () => ({
  recordShown: h.recordShown,
  recordDecision: h.recordDecision,
  recordOutcomeResult: h.recordOutcomeResult,
}));
vi.mock("@/lib/services/decision-replay-coach", () => ({ markReplayed: h.markReplayed }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: h.remember } }));
vi.mock("@/lib/services/telegram", () => ({
  sendTelegram: h.sendTelegram,
  sendTelegramWithButtons: h.sendTelegramWithButtons,
}));
vi.mock("@/lib/brain/anticipated-questions", () => ({
  getTodaysAnticipated: async () => ({ questions: [{ question: "What is the target today?" }] }),
}));
vi.mock("@/lib/brain/session-distiller", () => ({ getNickCurrentConcerns: async () => ({ threads: [] }) }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: () => {}, warn: () => {}, error: () => {} }) },
}));

import {
  composeTutorItem,
  renderTutorMessage,
  handleTutorAnswer,
  fireTutorPush,
  spacedReviewStep,
  type TutorItem,
} from "@/lib/brain/tutor-pack";
import { fireSlotForCurrentHour } from "@/lib/brain/proactive-pushes";

const NOW = new Date("2026-10-16T08:05:00-04:00"); // 8am ET, the morning hour
const DAY = 86_400_000;

// Four wisdom rows: three "physics" (leverage/compound/momentum) and one
// psychology row, so a distractor from another discipline is available.
const WISDOM = [
  { id: "w1", content: "Leverage beats effort: pick the lever before you push.", createdAt: new Date("2026-10-15") },
  { id: "w2", content: "Compound small wins daily; momentum is the asset.", createdAt: new Date("2026-10-14") },
  { id: "w3", content: "Friction you do not remove becomes the system.", createdAt: new Date("2026-10-13") },
  { id: "w4", content: "Loss aversion makes a bad habit feel safe.", createdAt: new Date("2026-10-12") },
];

const REPLAY = {
  id: "rp_1",
  decisionId: 41,
  title: "Hire a second tech",
  choiceMade: "Hire Zach part-time first",
  reviewAt: new Date("2026-10-01T12:00:00Z"),
  createdAt: new Date("2026-09-01T12:00:00Z"),
};

function ledgerRow(over: Record<string, unknown> = {}) {
  return {
    id: "led_1",
    sourceEngine: "tutor:recall",
    decision: null,
    evidenceRefs: { correct: "B", memoryId: "w1", options: ["x", WISDOM[0].content, "y"] },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.decisionReplay.findFirst.mockResolvedValue(null);
  h.prisma.decisionReplay.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.intelligenceOutcome.findMany.mockResolvedValue([]);
  h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(null);
  h.prisma.brainMemory.findMany.mockImplementation(async (args: { where?: { category?: string } }) =>
    args?.where?.category === "wisdom" ? WISDOM : [],
  );
  h.prisma.brainMemory.findUnique.mockResolvedValue(null);
  h.prisma.brainMemory.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.brainMemory.create.mockResolvedValue({ id: "claim-1" });
  h.prisma.brainMemory.deleteMany.mockResolvedValue({ count: 1 });
  h.prisma.approvalRequest.count.mockResolvedValue(0);
  h.recordShown.mockResolvedValue("led_1");
  h.recordDecision.mockResolvedValue(true);
  h.recordOutcomeResult.mockResolvedValue("recorded");
  h.markReplayed.mockResolvedValue({ ok: true, replayId: "rp_1", lessonStored: true });
  h.remember.mockResolvedValue({ id: "sr_1" });
  h.sendTelegram.mockResolvedValue(true);
  h.sendTelegramWithButtons.mockResolvedValue({ ok: true, messageId: 9 });
});

describe("composeTutorItem priority", () => {
  it("an overdue decision review beats a recall question", async () => {
    h.prisma.decisionReplay.findFirst.mockResolvedValue(REPLAY);
    const item = await composeTutorItem(NOW);
    expect(item).toMatchObject({ kind: "decision", replayId: "rp_1", decisionId: 41, title: "Hire a second tech" });
    const where = h.prisma.decisionReplay.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ reviewed: false, decisionId: { not: null } });
    expect(where.reviewAt.lte).toEqual(NOW);
    expect(h.prisma.decisionReplay.findFirst.mock.calls[0][0].orderBy).toEqual({ reviewAt: "asc" });
  });

  it("a wisdom asked in the last 30 days is excluded", async () => {
    h.prisma.intelligenceOutcome.findMany.mockResolvedValue([{ evidenceRefs: { memoryId: "w1" } }]);
    const item = await composeTutorItem(NOW);
    expect(item?.kind).toBe("recall");
    expect(item && item.kind === "recall" ? item.memoryId : null).toBe("w2");
    const where = h.prisma.intelligenceOutcome.findMany.mock.calls[0][0].where;
    expect(where.sourceEngine).toBe("tutor:recall");
    expect(where.shownAt.gte.getTime()).toBe(NOW.getTime() - 30 * DAY);
  });

  it("a due spaced_review row re-asks its wisdom even inside the 30-day window", async () => {
    h.prisma.intelligenceOutcome.findMany.mockResolvedValue([{ evidenceRefs: { memoryId: "w1" } }]);
    h.prisma.brainMemory.findMany.mockImplementation(async (args: { where?: { category?: string } }) =>
      args?.where?.category === "wisdom"
        ? WISDOM
        : [
            {
              key: "tutor_w1",
              content: JSON.stringify({ memoryId: "w1", reviewAt: new Date(NOW.getTime() - DAY).toISOString(), streak: 0, completed: false }),
            },
          ],
    );
    const item = await composeTutorItem(NOW);
    expect(item && item.kind === "recall" ? item.memoryId : null).toBe("w1");
  });

  it("distractors come from OTHER wisdom rows and the correct letter points at the real one", async () => {
    const item = (await composeTutorItem(NOW)) as Extract<TutorItem, { kind: "recall" }>;
    expect(item.kind).toBe("recall");
    expect(item.options).toHaveLength(3);
    expect(new Set(item.options).size).toBe(3);
    const correctIdx = "ABC".indexOf(item.correct);
    expect(item.options[correctIdx]).toBe(WISDOM[0].content);
    const others = WISDOM.slice(1).map((w) => w.content);
    for (const [i, opt] of item.options.entries()) {
      if (i !== correctIdx) expect(others).toContain(opt);
    }
    // w1 is physics (leverage); the psychology row (loss aversion) is a better distractor.
    expect(item.options).toContain(WISDOM[3].content);
  });

  it("null when every wisdom was asked recently (silent day)", async () => {
    h.prisma.intelligenceOutcome.findMany.mockResolvedValue(WISDOM.map((w) => ({ evidenceRefs: { memoryId: w.id } })));
    expect(await composeTutorItem(NOW)).toBeNull();
  });

  it("null when fewer than three wisdom rows exist (no real choice)", async () => {
    h.prisma.brainMemory.findMany.mockResolvedValue(WISDOM.slice(0, 2));
    expect(await composeTutorItem(NOW)).toBeNull();
  });
});

describe("renderTutorMessage", () => {
  it("recall: three lettered lines of at most 120 chars and A/B/C/Skip buttons under 64 bytes", async () => {
    const item = (await composeTutorItem(NOW)) as TutorItem;
    const { text, buttons } = renderTutorMessage(item, "cmg1abcdefghijklmnopqrstuvw");
    expect(text.startsWith("Daily Tutor. Which of these is the principle you distilled about ")).toBe(true);
    for (const letter of ["A", "B", "C"]) {
      const line = text.split("\n").find((l) => l.startsWith(`${letter}. `));
      expect(line, letter).toBeDefined();
      expect(line!.length).toBeLessThanOrEqual(123);
    }
    expect(text).not.toMatch(/!/);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    const flat = buttons.flat();
    expect(flat.map((b) => b.text)).toEqual(["A", "B", "C", "Skip"]);
    expect(flat.map((b) => b.callback_data)).toEqual([
      "tut:cmg1abcdefghijklmnopqrstuvw:A",
      "tut:cmg1abcdefghijklmnopqrstuvw:B",
      "tut:cmg1abcdefghijklmnopqrstuvw:C",
      "tut:cmg1abcdefghijklmnopqrstuvw:S",
    ]);
    for (const b of flat) expect(Buffer.byteLength(b.callback_data ?? "")).toBeLessThanOrEqual(64);
  });

  it("decision: title, date, the choice, and Worked/Mixed/Didn't/Not yet buttons", async () => {
    h.prisma.decisionReplay.findFirst.mockResolvedValue(REPLAY);
    const item = (await composeTutorItem(NOW)) as TutorItem;
    const { text, buttons } = renderTutorMessage(item, "led_9");
    expect(text).toMatch(/^Decision review\. Hire a second tech \(2026-09-01\)\. You chose: Hire Zach part-time first\. How did it go\?$/);
    expect(buttons.flat().map((b) => [b.text, b.callback_data])).toEqual([
      ["Worked", "tut:led_9:W"],
      ["Mixed", "tut:led_9:M"],
      ["Didn't", "tut:led_9:D"],
      ["Not yet", "tut:led_9:N"],
    ]);
  });
});

describe("handleTutorAnswer: malformed input writes nothing", () => {
  it.each([
    ["", "A"],
    ["led_1", "Z"],
    ["led_1", ""],
    ["led 1", "A"],
  ])("ledgerId=%j choice=%j", async (ledgerId, choice) => {
    expect(await handleTutorAnswer(ledgerId, choice)).toEqual({ reply: "Malformed." });
    expect(h.recordDecision).not.toHaveBeenCalled();
    expect(h.recordOutcomeResult).not.toHaveBeenCalled();
  });

  it("a ledger id that names no row is malformed, not graded", async () => {
    expect(await handleTutorAnswer("led_missing", "A")).toEqual({ reply: "Malformed." });
    expect(h.recordDecision).not.toHaveBeenCalled();
  });

  it("a decision letter on a recall row is malformed", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    expect(await handleTutorAnswer("led_1", "W")).toEqual({ reply: "Malformed." });
    expect(h.recordDecision).not.toHaveBeenCalled();
  });
});

describe("handleTutorAnswer: recall grading", () => {
  it("correct -> accepted + useful true + a spaced_review row due in 1 day", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    const r = await handleTutorAnswer("led_1", "B");
    expect(r.reply).toBe("Right. Next ask in 1 day.");
    expect(h.recordDecision).toHaveBeenCalledWith(expect.objectContaining({ id: "led_1", decision: "accepted" }));
    expect(h.recordOutcomeResult).toHaveBeenCalledWith(expect.objectContaining({ id: "led_1", useful: true }));
    // No row yet: created through remember(), never prisma.brainMemory.create.
    expect(h.remember).toHaveBeenCalledTimes(1);
    const [category, key, content] = h.remember.mock.calls[0];
    expect(category).toBe("spaced_review");
    expect(key).toBe("tutor_w1");
    const parsed = JSON.parse(content);
    // The Learn tab (components/actions/mode-learn.tsx) reads these exact fields.
    expect(parsed).toMatchObject({ topic: expect.any(String), summary: expect.any(String), interval: 1, completed: false, streak: 1, memoryId: "w1" });
    expect(typeof parsed.reviewAt).toBe("string");
    expect(h.prisma.brainMemory.create).not.toHaveBeenCalled();
  });

  it("wrong -> useful false, the correct text in the reply, streak reset, due tomorrow", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    const prev = JSON.stringify({ topic: "physics", summary: WISDOM[0].content, reviewAt: NOW.toISOString(), interval: 7, completed: false, streak: 3, memoryId: "w1" });
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "sr_1", content: prev });
    const r = await handleTutorAnswer("led_1", "A");
    expect(r.reply).toBe(`Not this one. It was: ${WISDOM[0].content}. Again tomorrow.`);
    expect(h.recordOutcomeResult).toHaveBeenCalledWith(expect.objectContaining({ id: "led_1", useful: false }));
    const call = h.prisma.brainMemory.updateMany.mock.calls[0][0];
    // Compare-and-swap: the WHERE carries the previous streak+due (the whole prior content).
    expect(call.where).toMatchObject({ category: "spaced_review", key: "tutor_w1", content: prev });
    expect(JSON.parse(call.data.content)).toMatchObject({ streak: 0, interval: 1, completed: false });
    expect(h.remember).not.toHaveBeenCalled();
  });

  it("the spaced ladder by streak is 1 -> 3 -> 7 -> 30 and a miss resets to 1", () => {
    expect(spacedReviewStep(0, true)).toEqual({ streak: 1, days: 1 });
    expect(spacedReviewStep(1, true)).toEqual({ streak: 2, days: 3 });
    expect(spacedReviewStep(2, true)).toEqual({ streak: 3, days: 7 });
    expect(spacedReviewStep(3, true)).toEqual({ streak: 4, days: 30 });
    expect(spacedReviewStep(9, true)).toEqual({ streak: 10, days: 30 });
    expect(spacedReviewStep(3, false)).toEqual({ streak: 0, days: 1 });
  });

  it("skip -> dismissed, no grade, no spaced row", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    expect(await handleTutorAnswer("led_1", "S")).toEqual({ reply: "Skipped." });
    expect(h.recordDecision).toHaveBeenCalledWith(expect.objectContaining({ id: "led_1", decision: "dismissed" }));
    expect(h.recordOutcomeResult).not.toHaveBeenCalled();
    expect(h.remember).not.toHaveBeenCalled();
  });
});

describe("handleTutorAnswer: decision mapping", () => {
  const decisionRow = () =>
    ledgerRow({
      sourceEngine: "tutor:decision",
      evidenceRefs: { decisionId: 41, replayId: "rp_1", reviewAt: REPLAY.reviewAt.toISOString(), options: ["W", "M", "D", "N"] },
    });

  it.each([
    ["W", 5, "Worked"],
    ["M", 0, "Mixed"],
    ["D", -5, "Didn't"],
  ])("%s -> markReplayed score %d, outcome names the label", async (choice, score, label) => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(decisionRow());
    expect(await handleTutorAnswer("led_1", choice)).toEqual({ reply: "Logged." });
    expect(h.markReplayed).toHaveBeenCalledWith({ decisionId: 41, outcome: `telegram one-tap: ${label}`, outcomeScore: score });
    expect(h.recordDecision).toHaveBeenCalledWith(expect.objectContaining({ id: "led_1", decision: "accepted" }));
    expect(h.recordOutcomeResult).toHaveBeenCalledWith(expect.objectContaining({ id: "led_1", useful: true }));
  });

  it("Not yet -> dismissed, reviewAt pushed 7 days by compare-and-swap, never marked reviewed", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(decisionRow());
    expect(await handleTutorAnswer("led_1", "N")).toEqual({ reply: "Pushed a week." });
    expect(h.markReplayed).not.toHaveBeenCalled();
    expect(h.recordDecision).toHaveBeenCalledWith(expect.objectContaining({ id: "led_1", decision: "dismissed" }));
    const call = h.prisma.decisionReplay.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "rp_1", reviewed: false, reviewAt: REPLAY.reviewAt });
    expect(call.data.reviewed).toBeUndefined();
    expect(call.data.reviewAt.getTime()).toBe(REPLAY.reviewAt.getTime() + 7 * DAY);
  });

  it("a failed markReplayed is said, not folded into Logged.", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(decisionRow());
    h.markReplayed.mockResolvedValue({ ok: false, replayId: null, lessonStored: false });
    expect(await handleTutorAnswer("led_1", "W")).toEqual({ reply: "Could not record - try again." });
    expect(h.recordOutcomeResult).not.toHaveBeenCalled();
  });
});

describe("handleTutorAnswer: a redelivered tap is a no-op", () => {
  it("row already decided -> Already recorded. and no writes", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow({ decision: "accepted" }));
    expect(await handleTutorAnswer("led_1", "B")).toEqual({ reply: "Already recorded." });
    expect(h.recordDecision).not.toHaveBeenCalled();
    expect(h.recordOutcomeResult).not.toHaveBeenCalled();
    expect(h.remember).not.toHaveBeenCalled();
  });

  it("the claim loses the race -> re-read shows the winner -> Already recorded.", async () => {
    h.prisma.intelligenceOutcome.findUnique
      .mockResolvedValueOnce(ledgerRow())
      .mockResolvedValueOnce(ledgerRow({ decision: "accepted" }));
    h.recordDecision.mockResolvedValue(false);
    expect(await handleTutorAnswer("led_1", "B")).toEqual({ reply: "Already recorded." });
    expect(h.recordOutcomeResult).not.toHaveBeenCalled();
  });

  it("the claim fails and the row is still undecided -> Could not record, never Already", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    h.recordDecision.mockResolvedValue(false);
    expect(await handleTutorAnswer("led_1", "B")).toEqual({ reply: "Could not record - try again." });
    expect(h.recordOutcomeResult).not.toHaveBeenCalled();
  });

  it("CONTROL: two identical taps -> one grade (second answers Already recorded.)", async () => {
    let decided: string | null = null;
    h.prisma.intelligenceOutcome.findUnique.mockImplementation(async () => ledgerRow({ decision: decided }));
    h.recordDecision.mockImplementation(async ({ decision }: { decision: string }) => {
      if (decided) return false;
      decided = decision;
      return true;
    });
    expect((await handleTutorAnswer("led_1", "B")).reply).toBe("Right. Next ask in 1 day.");
    expect((await handleTutorAnswer("led_1", "B")).reply).toBe("Already recorded.");
    expect(h.recordOutcomeResult).toHaveBeenCalledTimes(1);
    expect(h.remember).toHaveBeenCalledTimes(1);
  });
});

describe("fireTutorPush", () => {
  it("dry run previews the text and never claims, ledgers or sends", async () => {
    const r = await fireTutorPush({ dryRun: true, now: NOW });
    expect(r.kind).toBe("preview");
    if (r.kind !== "preview") return;
    expect(r.slot).toBe("tutor");
    expect(r.wouldSend).toBe(true);
    expect(r.messageText).toMatch(/^Daily Tutor\./);
    expect(r.dedupKey).toBe("tutor_2026-10-16");
    expect(h.prisma.brainMemory.create).not.toHaveBeenCalled();
    expect(h.recordShown).not.toHaveBeenCalled();
    expect(h.sendTelegramWithButtons).not.toHaveBeenCalled();
  });

  it("live: claims tutor_<date>, ledgers with evidence, then sends buttons carrying the ledger id", async () => {
    const r = await fireTutorPush({ now: NOW });
    expect(r).toMatchObject({ kind: "live", slot: "tutor", fired: true, reason: "sent" });
    expect(h.prisma.brainMemory.create.mock.calls[0][0]).toMatchObject({
      data: { category: "proactive_push_sent", key: "tutor_2026-10-16" },
    });
    const shown = h.recordShown.mock.calls[0][0];
    expect(shown).toMatchObject({ kind: "suggestion", sourceEngine: "tutor:recall", shownSurface: "telegram" });
    expect(shown.evidenceRefs).toMatchObject({ correct: expect.stringMatching(/^[ABC]$/), memoryId: "w1" });
    expect(shown.evidenceRefs.options).toHaveLength(3);
    expect(shown.summary).toContain("2026-10-16");
    expect(shown.summary).toContain("w1");
    expect(h.recordShown.mock.invocationCallOrder[0]).toBeLessThan(h.sendTelegramWithButtons.mock.invocationCallOrder[0]);
    const [, buttons] = h.sendTelegramWithButtons.mock.calls[0];
    expect(buttons.flat()[0].callback_data).toBe("tut:led_1:A");
    expect(h.sendTelegram).not.toHaveBeenCalled();
    expect(h.prisma.brainMemory.deleteMany).not.toHaveBeenCalled();
  });

  it("a second tick the same day sends nothing (marker read)", async () => {
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "marker" });
    const r = await fireTutorPush({ now: NOW });
    expect(r).toMatchObject({ fired: false, reason: "already_pushed_today" });
    expect(h.sendTelegramWithButtons).not.toHaveBeenCalled();
    expect(h.recordShown).not.toHaveBeenCalled();
  });

  it("a second tick that races the first loses the claim (P2002) and sends nothing", async () => {
    h.prisma.brainMemory.create.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    const r = await fireTutorPush({ now: NOW });
    expect(r).toMatchObject({ fired: false, reason: "already_pushed_today" });
    expect(h.sendTelegramWithButtons).not.toHaveBeenCalled();
  });

  it("no ledger id -> nothing is sent (an ungradable item is noise) and the claim is released", async () => {
    h.recordShown.mockResolvedValue(null);
    const r = await fireTutorPush({ now: NOW });
    expect(r).toMatchObject({ fired: false, reason: "ledger_unavailable" });
    expect(h.sendTelegramWithButtons).not.toHaveBeenCalled();
    expect(h.sendTelegram).not.toHaveBeenCalled();
    expect(h.prisma.brainMemory.deleteMany).toHaveBeenCalledWith({
      where: { category: "proactive_push_sent", key: "tutor_2026-10-16" },
    });
  });

  it("nothing eligible -> silent day", async () => {
    h.prisma.brainMemory.findMany.mockResolvedValue([]);
    const r = await fireTutorPush({ now: NOW });
    expect(r).toMatchObject({ fired: false, reason: "nothing_eligible" });
    expect(h.prisma.brainMemory.create).not.toHaveBeenCalled();
  });

  it("quiet hours (3am ET) -> no send, same rule as the other slots", async () => {
    const r = await fireTutorPush({ now: new Date("2026-10-16T03:00:00-04:00") });
    expect(r).toMatchObject({ fired: false, reason: "quiet_hours_overnight" });
    expect(h.sendTelegramWithButtons).not.toHaveBeenCalled();
  });
});

describe("fireSlotForCurrentHour: the tutor rides the morning hour, after the morning push", () => {
  it("8am ET fires morning first, then the tutor; the morning result is still returned", async () => {
    const r = await fireSlotForCurrentHour({ now: NOW });
    expect(r).toMatchObject({ kind: "live", slot: "morning", fired: true });
    expect((r as { tutor?: { slot: string; fired: boolean } }).tutor).toMatchObject({ slot: "tutor", fired: true });
    // Morning (plain or buttons) was sent before the tutor's buttons.
    const morningOrder = h.sendTelegramWithButtons.mock.invocationCallOrder[0];
    const tutorOrder = h.sendTelegramWithButtons.mock.invocationCallOrder[1];
    expect(morningOrder).toBeLessThan(tutorOrder);
    const keys = h.prisma.brainMemory.create.mock.calls.map((c) => c[0].data.key);
    expect(keys).toEqual(["morning_2026-10-16", "tutor_2026-10-16"]);
  });

  it("the tutor still fires when the morning push was already sent today (independent claims)", async () => {
    h.prisma.brainMemory.findUnique.mockImplementation(async (args: { where: { category_key: { key: string } } }) =>
      args.where.category_key.key === "morning_2026-10-16" ? { id: "marker" } : null,
    );
    const r = await fireSlotForCurrentHour({ now: NOW });
    expect(r).toMatchObject({ slot: "morning", fired: false, reason: "already_pushed_today" });
    expect((r as { tutor?: { fired: boolean } }).tutor).toMatchObject({ fired: true });
  });

  it("2pm ET: no tutor", async () => {
    const r = await fireSlotForCurrentHour({ now: new Date("2026-10-16T14:00:00-04:00") });
    expect((r as { tutor?: unknown }).tutor).toBeUndefined();
    expect(h.recordShown).not.toHaveBeenCalledWith(expect.objectContaining({ sourceEngine: expect.stringMatching(/^tutor:/) }));
  });
});
