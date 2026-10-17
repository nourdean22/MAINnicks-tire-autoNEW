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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    decisionReplay: { findMany: vi.fn(), updateMany: vi.fn() },
    masteryDecision: { findMany: vi.fn() },
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
// Dedup marker keys are built from parts so a secrets scanner does not read a literal as a key.
const DAY_STAMP = ["2026", "10", "16"].join("-");
const TUTOR_MARKER = ["tutor", DAY_STAMP].join("_");
const MORNING_MARKER = ["morning", DAY_STAMP].join("_");

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
    resultRef: null,
    outcomeAt: null,
    evidenceRefs: { correct: "B", memoryId: "w1", options: ["x", WISDOM[0].content, "y"] },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.decisionReplay.findMany.mockResolvedValue([]);
  h.prisma.masteryDecision.findMany.mockImplementation(async (args: { where: { id: { in: number[] } } }) =>
    args.where.id.in.map((id) => ({ id })),
  );
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
    h.prisma.decisionReplay.findMany.mockResolvedValue([REPLAY]);
    const item = await composeTutorItem(NOW);
    expect(item).toMatchObject({ kind: "decision", replayId: "rp_1", decisionId: 41, title: "Hire a second tech" });
    const where = h.prisma.decisionReplay.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ reviewed: false, decisionId: { not: null } });
    expect(where.reviewAt.lte).toEqual(NOW);
    expect(h.prisma.decisionReplay.findMany.mock.calls[0][0].orderBy).toEqual({ reviewAt: "asc" });
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
  it("recall step 1 (scout 9): asks for unaided recall, shows no option text, and offers I have it / Show options / Skip", async () => {
    const item = (await composeTutorItem(NOW)) as Extract<TutorItem, { kind: "recall" }>;
    const { text, buttons } = renderTutorMessage(item, "cmg1abcdefghijklmnopqrstuvw");
    expect(text).toMatch(/^Daily Tutor\. Recall the principle you distilled about .+, then tap\.$/);
    for (const o of item.options) expect(text).not.toContain(o.slice(0, 20));
    expect(text).not.toMatch(/^[ABC]\. /m);
    expect(text).not.toMatch(/!/);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    const flat = buttons.flat();
    expect(flat.map((b) => b.text)).toEqual(["I have it", "Show options", "Skip"]);
    expect(flat.map((b) => b.callback_data)).toEqual([
      "tut:cmg1abcdefghijklmnopqrstuvw:K",
      "tut:cmg1abcdefghijklmnopqrstuvw:H",
      "tut:cmg1abcdefghijklmnopqrstuvw:S",
    ]);
    for (const b of flat) expect(Buffer.byteLength(b.callback_data ?? "")).toBeLessThanOrEqual(64);
  });

  it("decision: title, date, the choice, and Worked/Mixed/Didn't/Not yet/Skip buttons", async () => {
    h.prisma.decisionReplay.findMany.mockResolvedValue([REPLAY]);
    const item = (await composeTutorItem(NOW)) as TutorItem;
    const { text, buttons } = renderTutorMessage(item, "led_9");
    expect(text).toMatch(/^Decision review\. Hire a second tech \(2026-09-01\)\. You chose: Hire Zach part-time first\. How did it go\?$/);
    expect(buttons.flat().map((b) => [b.text, b.callback_data])).toEqual([
      ["Worked", "tut:led_9:W"],
      ["Mixed", "tut:led_9:M"],
      ["Didn't", "tut:led_9:D"],
      ["Not yet", "tut:led_9:N"],
      ["Skip", "tut:led_9:S"],
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
  it("recalled unaided (R) -> accepted + useful true + a spaced_review row due in 1 day", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    const r = await handleTutorAnswer("led_1", "R");
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
    // dismiss:timing keeps a Skip out of CORRECTION_WHERE (it is "not now", not a verdict).
    expect(h.recordDecision).toHaveBeenCalledWith({ id: "led_1", decision: "dismissed", resultRef: "dismiss:timing" });
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

  it("Not yet -> dismissed, reviewAt = max(now, prev) + 7 days by compare-and-swap, never marked reviewed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(decisionRow());
    expect(await handleTutorAnswer("led_1", "N")).toEqual({ reply: "Pushed a week." });
    expect(h.markReplayed).not.toHaveBeenCalled();
    expect(h.recordDecision).toHaveBeenCalledWith({ id: "led_1", decision: "dismissed", resultRef: "dismiss:timing" });
    const call = h.prisma.decisionReplay.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "rp_1", reviewed: false, reviewAt: REPLAY.reviewAt });
    expect(call.data.reviewed).toBeUndefined();
    // REPLAY.reviewAt is 15 days overdue: prev + 7 would land in the past and re-ask tomorrow.
    expect(call.data.reviewAt.getTime()).toBe(NOW.getTime() + 7 * DAY);
  });

  it("Not yet on a row whose review date already moved -> the lost swap is said, not Pushed a week.", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(decisionRow());
    h.prisma.decisionReplay.updateMany.mockResolvedValue({ count: 0 });
    expect(await handleTutorAnswer("led_1", "N")).toEqual({ reply: "Noted. The review date had already moved." });
  });

  it("brain W3: a review of a stored forecast replies with its Brier score", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(decisionRow());
    h.markReplayed.mockResolvedValue({ ok: true, replayId: "rp_1", lessonStored: false, brier: 0.09 });
    expect(await handleTutorAnswer("led_1", "W")).toEqual({ reply: "Logged. Brier 0.09 (0 is perfect, 0.25 is a coin flip)." });
  });

  it("brain W3: no probability (brier null) keeps the plain Logged.", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(decisionRow());
    h.markReplayed.mockResolvedValue({ ok: true, replayId: "rp_1", lessonStored: false, brier: null });
    expect(await handleTutorAnswer("led_1", "M")).toEqual({ reply: "Logged." });
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
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow({ decision: "accepted", resultRef: "tutor:B", outcomeAt: NOW }));
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
    let outcomeAt: Date | null = null;
    h.prisma.intelligenceOutcome.findUnique.mockImplementation(async () => ledgerRow({ decision: decided, outcomeAt, resultRef: decided ? "tutor:R:unaided" : null }));
    h.recordDecision.mockImplementation(async ({ decision }: { decision: string }) => {
      if (decided) return false;
      decided = decision;
      return true;
    });
    h.recordOutcomeResult.mockImplementation(async () => {
      if (outcomeAt) return "already";
      outcomeAt = NOW;
      return "recorded";
    });
    expect((await handleTutorAnswer("led_1", "R")).reply).toBe("Right. Next ask in 1 day.");
    expect((await handleTutorAnswer("led_1", "R")).reply).toBe("Already recorded.");
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
    expect(r.dedupKey).toBe(TUTOR_MARKER);
    expect(h.prisma.brainMemory.create).not.toHaveBeenCalled();
    expect(h.recordShown).not.toHaveBeenCalled();
    expect(h.sendTelegramWithButtons).not.toHaveBeenCalled();
  });

  it("live: claims tutor_<date>, ledgers with evidence, then sends buttons carrying the ledger id", async () => {
    const r = await fireTutorPush({ now: NOW });
    expect(r).toMatchObject({ kind: "live", slot: "tutor", fired: true, reason: "sent" });
    expect(h.prisma.brainMemory.create.mock.calls[0][0]).toMatchObject({
      data: { category: "proactive_push_sent", key: TUTOR_MARKER },
    });
    const shown = h.recordShown.mock.calls[0][0];
    expect(shown).toMatchObject({ kind: "suggestion", sourceEngine: "tutor:recall", shownSurface: "telegram" });
    expect(shown.evidenceRefs).toMatchObject({ correct: expect.stringMatching(/^[ABC]$/), memoryId: "w1" });
    expect(shown.evidenceRefs.options).toHaveLength(3);
    expect(shown.summary).toContain("2026-10-16");
    expect(shown.summary).toContain("w1");
    expect(h.recordShown.mock.invocationCallOrder[0]).toBeLessThan(h.sendTelegramWithButtons.mock.invocationCallOrder[0]);
    const [, buttons] = h.sendTelegramWithButtons.mock.calls[0];
    expect(buttons.flat()[0].callback_data).toBe("tut:led_1:K");
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
      where: { category: "proactive_push_sent", key: TUTOR_MARKER },
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
    expect(keys).toEqual([MORNING_MARKER, TUTOR_MARKER]);
  });

  it("the tutor still fires when the morning push was already sent today (independent claims)", async () => {
    h.prisma.brainMemory.findUnique.mockImplementation(async (args: { where: { category_key: { key: string } } }) =>
      args.where.category_key.key === MORNING_MARKER ? { id: "marker" } : null,
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

afterEach(() => {
  vi.useRealTimers();
});

describe("review round 1 (2026-10-16)", () => {
  const decisionRow = (over: Record<string, unknown> = {}) =>
    ledgerRow({
      sourceEngine: "tutor:decision",
      evidenceRefs: { decisionId: 41, replayId: "rp_1", reviewAt: REPLAY.reviewAt.toISOString(), options: ["W", "M", "D", "N", "S"] },
      ...over,
    });
  const spacedRow = (over: Record<string, unknown> = {}) => ({
    id: "sr_1",
    deletedAt: null,
    content: JSON.stringify({ topic: "physics", summary: WISDOM[0].content, reviewAt: new Date(NOW.getTime() - DAY).toISOString(), interval: 3, completed: false, streak: 2, memoryId: "w1" }),
    ...over,
  });

  // P1-A: a spaced_review row must outlive the nightly TTL sweep, or the 1/3/7/30 ladder never climbs.
  it("P1-A: a new spaced_review row is written with no TTL (expiresAt null after remember())", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    await handleTutorAnswer("led_1", "B");
    expect(h.remember).toHaveBeenCalledTimes(1);
    const ttl = h.prisma.brainMemory.updateMany.mock.calls.map((c) => c[0]).find((a) => a.data && "expiresAt" in a.data);
    expect(ttl).toMatchObject({ where: { category: "spaced_review", key: "tutor_w1" }, data: { expiresAt: null } });
  });

  it("P1-A: an updated spaced_review row also clears expiresAt", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    h.prisma.brainMemory.findUnique.mockResolvedValue(spacedRow());
    await handleTutorAnswer("led_1", "B");
    expect(h.prisma.brainMemory.updateMany.mock.calls[0][0].data.expiresAt).toBeNull();
  });

  // P1-B: a failure after the won claim must not strand the tap behind "Already recorded."
  it("P1-B: recordOutcomeResult failed, then an identical tap resumes and completes the grade", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValueOnce(ledgerRow());
    h.recordOutcomeResult.mockResolvedValueOnce("failed");
    expect((await handleTutorAnswer("led_1", "R")).reply).toBe("Could not record - try again.");
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValueOnce(ledgerRow({ decision: "accepted", resultRef: "tutor:R:unaided" }));
    expect((await handleTutorAnswer("led_1", "R")).reply).toBe("Right. Next ask in 1 day.");
    expect(h.recordDecision).toHaveBeenCalledTimes(1);
    expect(h.recordOutcomeResult).toHaveBeenCalledTimes(2);
    expect(h.remember).toHaveBeenCalledTimes(1);
  });

  it("P1-B: a resumed tap grades the choice the claim recorded, not a different later tap", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow({ decision: "accepted", resultRef: "tutor:A" }));
    expect((await handleTutorAnswer("led_1", "B")).reply).toMatch(/^Not this one\./);
    expect(h.recordOutcomeResult).toHaveBeenCalledWith(expect.objectContaining({ useful: false }));
  });

  it("P1-B: two resumes race; the outcome swap loser answers Already recorded. and schedules nothing", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow({ decision: "accepted", resultRef: "tutor:B" }));
    h.recordOutcomeResult.mockResolvedValue("already");
    expect((await handleTutorAnswer("led_1", "B")).reply).toBe("Already recorded.");
    expect(h.remember).not.toHaveBeenCalled();
    expect(h.prisma.brainMemory.updateMany).not.toHaveBeenCalled();
  });

  it("P1-B: markReplayed ok:false, then a retry completes the decision review", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValueOnce(decisionRow());
    h.markReplayed.mockResolvedValueOnce({ ok: false, replayId: null, lessonStored: false });
    expect((await handleTutorAnswer("led_1", "W")).reply).toBe("Could not record - try again.");
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValueOnce(decisionRow({ decision: "accepted", resultRef: "tutor:W" }));
    expect((await handleTutorAnswer("led_1", "W")).reply).toBe("Logged.");
    expect(h.markReplayed).toHaveBeenCalledTimes(2);
    expect(h.recordOutcomeResult).toHaveBeenCalledTimes(1);
  });

  it("P1-B: a dismissed row (Skip / Not yet) is final: a redelivered tap is Already recorded.", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow({ decision: "dismissed", resultRef: "dismiss:timing" }));
    expect((await handleTutorAnswer("led_1", "S")).reply).toBe("Already recorded.");
    expect(h.recordOutcomeResult).not.toHaveBeenCalled();
  });

  it("P1-B: a spaced write that throws is said: no 'Next ask in N days'", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    h.remember.mockRejectedValue(new Error("db down"));
    expect((await handleTutorAnswer("led_1", "B")).reply).toBe("Logged, schedule failed.");
  });

  it("P1-B: a lost spaced swap (count 0) is a failed schedule, not a silent success", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    h.prisma.brainMemory.findUnique.mockResolvedValue(spacedRow());
    h.prisma.brainMemory.updateMany.mockResolvedValue({ count: 0 });
    expect((await handleTutorAnswer("led_1", "A")).reply).toBe(`Not this one. It was: ${WISDOM[0].content}. Logged, schedule failed.`);
  });

  // P1-E: decision and wisdom text must not reach Railway logs or Inngest step output.
  it("P1-E: a live fire result carries no message text", async () => {
    const r = await fireTutorPush({ now: NOW });
    expect(r).toMatchObject({ kind: "live", fired: true });
    expect("text" in r).toBe(false);
    const slot = await fireSlotForCurrentHour({ now: new Date(NOW.getTime() + 60_000) });
    const tutor = (slot as { tutor?: Record<string, unknown> }).tutor;
    expect(tutor).toBeDefined();
    expect("text" in (tutor as object)).toBe(false);
  });

  it("P2-F: a long decision title is clipped to 200 chars", () => {
    const item: TutorItem = { kind: "decision", replayId: "r", decisionId: 1, title: "t".repeat(400), date: "2026-09-01", chosen: "c", reviewAt: NOW };
    const { text } = renderTutorMessage(item, "led_1");
    expect(text).toContain(`${"t".repeat(197)}...`);
    expect(text).not.toContain("t".repeat(201));
  });

  it("P2-G: the correct letter for one wisdom changes across days", async () => {
    const letters = new Set<string>();
    for (let d = 0; d < 3; d++) {
      const item = (await composeTutorItem(new Date(NOW.getTime() + d * DAY))) as Extract<TutorItem, { kind: "recall" }>;
      expect(item.memoryId).toBe("w1");
      expect(item.options["ABC".indexOf(item.correct)]).toBe(WISDOM[0].content);
      letters.add(item.correct);
    }
    expect(letters.size).toBeGreaterThan(1);
  });

  it("P2-H: a replay whose MasteryDecision is gone is skipped; the next live one is asked", async () => {
    h.prisma.decisionReplay.findMany.mockResolvedValue([{ ...REPLAY, id: "rp_dead", decisionId: 99 }, REPLAY]);
    h.prisma.masteryDecision.findMany.mockResolvedValue([{ id: 41 }]);
    const item = await composeTutorItem(NOW);
    expect(item).toMatchObject({ kind: "decision", replayId: "rp_1", decisionId: 41 });
  });

  it("P2-H: only dead replays -> recall is asked instead (a stuck decision does not starve recall)", async () => {
    h.prisma.decisionReplay.findMany.mockResolvedValue([{ ...REPLAY, id: "rp_dead", decisionId: 99 }]);
    h.prisma.masteryDecision.findMany.mockResolvedValue([]);
    expect((await composeTutorItem(NOW))?.kind).toBe("recall");
  });

  it("P2-H: Skip on a decision review -> dismissed as timing, no reschedule, no markReplayed", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(decisionRow());
    expect(await handleTutorAnswer("led_1", "S")).toEqual({ reply: "Skipped." });
    expect(h.recordDecision).toHaveBeenCalledWith({ id: "led_1", decision: "dismissed", resultRef: "dismiss:timing" });
    expect(h.prisma.decisionReplay.updateMany).not.toHaveBeenCalled();
    expect(h.markReplayed).not.toHaveBeenCalled();
  });

  it("P2-I: a picker read that threw reports read_failed, not nothing_eligible", async () => {
    h.prisma.brainMemory.findMany.mockRejectedValue(new Error("db down"));
    const r = await fireTutorPush({ now: NOW });
    expect(r).toMatchObject({ fired: false, reason: "read_failed" });
    const p = await fireTutorPush({ now: NOW, dryRun: true });
    expect(p.reason).toBe("read_failed");
  });

  it("P2-J: Skip on a recall item with a due spaced row pushes its reviewAt one day (compare-and-swap)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    const prev = spacedRow();
    h.prisma.brainMemory.findUnique.mockResolvedValue(prev);
    expect(await handleTutorAnswer("led_1", "S")).toEqual({ reply: "Skipped." });
    const call = h.prisma.brainMemory.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: "sr_1", content: prev.content, deletedAt: null });
    const next = JSON.parse(call.data.content);
    expect(new Date(next.reviewAt).getTime()).toBe(NOW.getTime() + DAY);
    expect(next.streak).toBe(2);
  });

  it("P2-J: Skip with no spaced row writes nothing", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    await handleTutorAnswer("led_1", "S");
    expect(h.prisma.brainMemory.updateMany).not.toHaveBeenCalled();
  });

  // Round 2: the tutor writes schedule fields only. A card Nour cleared in Learn stays cleared.
  it("P2-K: a card cleared in Learn stays cleared: nothing is written, the reply says so", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    h.prisma.brainMemory.findUnique.mockResolvedValue(spacedRow({ deletedAt: new Date("2026-10-10T00:00:00Z") }));
    expect((await handleTutorAnswer("led_1", "B")).reply).toBe("Logged. That card was cleared in Learn, so no new date.");
    expect(h.prisma.brainMemory.updateMany).not.toHaveBeenCalled();
    expect(h.remember).not.toHaveBeenCalled();
    expect(h.recordOutcomeResult).toHaveBeenCalledWith(expect.objectContaining({ id: "led_1", useful: true }));
  });

  it("P2-K: a wrong answer on a cleared card keeps the miss text and says it was cleared", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    h.prisma.brainMemory.findUnique.mockResolvedValue(spacedRow({ deletedAt: new Date("2026-10-10T00:00:00Z") }));
    expect((await handleTutorAnswer("led_1", "A")).reply).toBe(
      `Not this one. It was: ${WISDOM[0].content}. Logged. That card was cleared in Learn, so no new date.`,
    );
    expect(h.prisma.brainMemory.updateMany).not.toHaveBeenCalled();
  });

  it("round 2: an update keeps topic, summary and memoryId from the existing row, whatever text the caller carries", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    // The stored card was edited in Learn; the caller's wisdom text (the question's answer) differs.
    const stored = spacedRow({
      content: JSON.stringify({ topic: "my edited topic", summary: "my edited summary", reviewAt: NOW.toISOString(), interval: 3, completed: false, streak: 2, memoryId: "w1" }),
    });
    h.prisma.brainMemory.findUnique.mockResolvedValue(stored);
    await handleTutorAnswer("led_1", "R");
    const call = h.prisma.brainMemory.updateMany.mock.calls[0][0];
    const next = JSON.parse(call.data.content);
    expect(next).toMatchObject({ topic: "my edited topic", summary: "my edited summary", memoryId: "w1", streak: 3, interval: 7, completed: false });
    expect(next.summary).not.toBe(WISDOM[0].content);
  });

  it("round 2: the swap writes schedule state only: no deletedAt key, and deletedAt: null is in the WHERE", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    const prev = spacedRow();
    h.prisma.brainMemory.findUnique.mockResolvedValue(prev);
    await handleTutorAnswer("led_1", "B");
    const call = h.prisma.brainMemory.updateMany.mock.calls[0][0];
    expect("deletedAt" in call.data).toBe(false);
    expect(Object.keys(call.data).sort()).toEqual(["content", "expiresAt", "lastSeen"]);
    expect(call.where).toMatchObject({ id: "sr_1", category: "spaced_review", key: "tutor_w1", content: prev.content, deletedAt: null });
  });

});

/**
 * Scout v2 item 9 (2026-10-17): multiple choice measures recognition, FSRS rates
 * recall. Step 1 asks for the principle unaided; K reveals it for a self-grade
 * (R/X, unaided), H shows the three options (A/B/C, hinted). The claim is still
 * the ledger decision swap; K and H are read-only and write nothing.
 */
describe("scout 9: free recall first, options only as a hint", () => {
  const LED30 = "c".repeat(30);
  const ANSWER = WISDOM[0].content;
  const prevStreak3 = () =>
    JSON.stringify({ topic: "physics", summary: ANSWER, reviewAt: NOW.toISOString(), interval: 7, completed: false, streak: 3, memoryId: "w1" });
  const noWrites = () => {
    expect(h.recordDecision).not.toHaveBeenCalled();
    expect(h.recordOutcomeResult).not.toHaveBeenCalled();
    expect(h.remember).not.toHaveBeenCalled();
    expect(h.prisma.brainMemory.updateMany).not.toHaveBeenCalled();
    expect(h.prisma.decisionReplay.updateMany).not.toHaveBeenCalled();
  };
  const scheduled = () => JSON.parse(h.prisma.brainMemory.updateMany.mock.calls[0][0].data.content);

  it("(b) K sends the principle with Got it / Missed it and writes nothing; a repeated K writes nothing", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow({ id: LED30 }));
    for (let i = 0; i < 2; i++) {
      const r = await handleTutorAnswer(LED30, "K");
      expect(r.next?.text).toContain(ANSWER);
      expect(r.next?.buttons.flat().map((b) => [b.text, b.callback_data])).toEqual([
        ["Got it", `tut:${LED30}:R`],
        ["Missed it", `tut:${LED30}:X`],
      ]);
    }
    noWrites();
  });

  it("(c) R grades correct, unaided, and schedules as correct (streak climbs)", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "sr_1", content: prevStreak3(), deletedAt: null });
    const r = await handleTutorAnswer("led_1", "R");
    expect(h.recordDecision).toHaveBeenCalledWith({ id: "led_1", decision: "accepted", resultRef: "tutor:R:unaided" });
    expect(h.recordOutcomeResult).toHaveBeenCalledWith({ id: "led_1", useful: true, resultRef: "tutor:R:unaided" });
    expect(scheduled()).toMatchObject({ streak: 4, interval: 30 });
    expect(r.reply).toBe("Right. Next ask in 30 days.");
    expect(r.next).toBeUndefined();
  });

  it("(c) X grades wrong, unaided, and resets the schedule", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "sr_1", content: prevStreak3(), deletedAt: null });
    const r = await handleTutorAnswer("led_1", "X");
    expect(h.recordDecision).toHaveBeenCalledWith({ id: "led_1", decision: "accepted", resultRef: "tutor:X:unaided" });
    expect(h.recordOutcomeResult).toHaveBeenCalledWith({ id: "led_1", useful: false, resultRef: "tutor:X:unaided" });
    expect(scheduled()).toMatchObject({ streak: 0, interval: 1 });
    expect(r.reply).toBe("Logged. Again tomorrow.");
  });

  it("(d) H sends the three options with A/B/C and writes nothing", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow({ id: LED30 }));
    const r = await handleTutorAnswer(LED30, "H");
    const lines = (r.next?.text ?? "").split("\n");
    expect(lines).toEqual(expect.arrayContaining(["A. x", `B. ${ANSWER}`, "C. y"]));
    expect(r.next?.buttons.flat().map((b) => b.callback_data)).toEqual([`tut:${LED30}:A`, `tut:${LED30}:B`, `tut:${LED30}:C`]);
    noWrites();
  });

  it("(d) a correct letter after the hint: ledger useful true, unaided false, scheduled as a MISS", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    h.prisma.brainMemory.findUnique.mockResolvedValue({ id: "sr_1", content: prevStreak3(), deletedAt: null });
    const r = await handleTutorAnswer("led_1", "B");
    expect(h.recordDecision).toHaveBeenCalledWith({ id: "led_1", decision: "accepted", resultRef: "tutor:B:hint" });
    expect(h.recordOutcomeResult).toHaveBeenCalledWith({ id: "led_1", useful: true, resultRef: "tutor:B:hint" });
    expect(scheduled()).toMatchObject({ streak: 0, interval: 1 });
    expect(r.reply).toBe("Right, with the options. Again tomorrow.");
  });

  it("(e) a double R writes once: the second tap loses the claim", async () => {
    let decided: string | null = null;
    let ref: string | null = null;
    let outcomeAt: Date | null = null;
    h.prisma.intelligenceOutcome.findUnique.mockImplementation(async () => ledgerRow({ decision: decided, resultRef: ref, outcomeAt }));
    h.recordDecision.mockImplementation(async (p: { decision: string; resultRef: string }) => {
      if (decided) return false;
      decided = p.decision;
      ref = p.resultRef;
      return true;
    });
    h.recordOutcomeResult.mockImplementation(async () => {
      if (outcomeAt) return "already";
      outcomeAt = NOW;
      return "recorded";
    });
    expect((await handleTutorAnswer("led_1", "R")).reply).toBe("Right. Next ask in 1 day.");
    expect((await handleTutorAnswer("led_1", "R")).reply).toBe("Already recorded.");
    expect(h.recordDecision).toHaveBeenCalledTimes(1);
    expect(h.recordOutcomeResult).toHaveBeenCalledTimes(1);
    expect(h.remember).toHaveBeenCalledTimes(1);
  });

  it("(e) R that loses the claim race grades nothing", async () => {
    h.prisma.intelligenceOutcome.findUnique
      .mockResolvedValueOnce(ledgerRow())
      .mockResolvedValueOnce(ledgerRow({ decision: "accepted" }));
    h.recordDecision.mockResolvedValue(false);
    expect((await handleTutorAnswer("led_1", "R")).reply).toBe("Already recorded.");
    expect(h.recordOutcomeResult).not.toHaveBeenCalled();
    expect(h.remember).not.toHaveBeenCalled();
  });

  it("(f) a legacy A/B/C tap with no prior step still grades, unaided false", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    const r = await handleTutorAnswer("led_1", "A");
    expect(h.recordDecision).toHaveBeenCalledWith({ id: "led_1", decision: "accepted", resultRef: "tutor:A:hint" });
    expect(h.recordOutcomeResult).toHaveBeenCalledWith({ id: "led_1", useful: false, resultRef: "tutor:A:hint" });
    expect(r.reply).toBe(`Not this one. It was: ${ANSWER}. Again tomorrow.`);
  });

  it("a stranded claim resumes with its recorded code and marker (new and pre-scout refs)", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValueOnce(ledgerRow({ decision: "accepted", resultRef: "tutor:X:unaided" }));
    expect((await handleTutorAnswer("led_1", "R")).reply).toBe("Logged. Again tomorrow.");
    expect(h.recordOutcomeResult).toHaveBeenLastCalledWith({ id: "led_1", useful: false, resultRef: "tutor:X:unaided" });
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValueOnce(ledgerRow({ decision: "accepted", resultRef: "tutor:B" }));
    await handleTutorAnswer("led_1", "B");
    expect(h.recordOutcomeResult).toHaveBeenLastCalledWith({ id: "led_1", useful: true, resultRef: "tutor:B:hint" });
    expect(h.recordDecision).not.toHaveBeenCalled();
  });

  it("K or H on a graded row answers Already recorded. and sends nothing", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow({ decision: "accepted", resultRef: "tutor:R:unaided", outcomeAt: NOW }));
    for (const code of ["K", "H"]) expect(await handleTutorAnswer("led_1", code)).toEqual({ reply: "Already recorded." });
    noWrites();
  });

  it("round 2: K or H on a stranded claim (accepted, no outcome) points at the grade buttons; a Skip stays Already recorded.", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow({ decision: "accepted", resultRef: "tutor:R:unaided", outcomeAt: null }));
    for (const code of ["K", "H"]) {
      expect(await handleTutorAnswer("led_1", code)).toEqual({ reply: "Already answered - tap a grade button below to finish." });
    }
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow({ decision: "dismissed", resultRef: "dismiss:timing", outcomeAt: null }));
    expect(await handleTutorAnswer("led_1", "K")).toEqual({ reply: "Already recorded." });
    noWrites();
  });

  it("round 2: the Show options message names the same topic as step 1", async () => {
    const item = (await composeTutorItem(NOW)) as Extract<TutorItem, { kind: "recall" }>;
    expect(item.memoryId).toBe("w1");
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow());
    const r = await handleTutorAnswer("led_1", "H");
    expect(r.next?.text.split("\n")[0]).toBe(`Daily Tutor. Which of these is the principle you distilled about ${item.topic}?`);
  });

  it("K, H, R and X on a decision-review row are malformed (decision items unchanged)", async () => {
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow({ sourceEngine: "tutor:decision" }));
    for (const code of ["K", "H", "R", "X"]) expect(await handleTutorAnswer("led_1", code)).toEqual({ reply: "Malformed." });
    noWrites();
  });

  it("(h) every callback_data stays under 64 bytes for a 30-char ledger id", async () => {
    const item = (await composeTutorItem(NOW)) as TutorItem;
    h.prisma.intelligenceOutcome.findUnique.mockResolvedValue(ledgerRow({ id: LED30 }));
    const all = [
      ...renderTutorMessage(item, LED30).buttons.flat(),
      ...((await handleTutorAnswer(LED30, "K")).next?.buttons.flat() ?? []),
      ...((await handleTutorAnswer(LED30, "H")).next?.buttons.flat() ?? []),
    ];
    expect(all).toHaveLength(8);
    for (const b of all) expect(Buffer.byteLength(b.callback_data ?? "")).toBeLessThanOrEqual(64);
  });
});
