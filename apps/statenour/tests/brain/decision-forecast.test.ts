/**
 * tests/brain/decision-forecast.test.ts · brain W3 Socratic decision mode (2026-10-17)
 *
 * A decision turn asks for the decision, the alternatives, a probability and a
 * review date; the answer is stored once as a DecisionReplay (probability in
 * MasteryDecision.predictedOutcome); the review scores it with Brier.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  masteryDecision: { create: vi.fn(), findUnique: vi.fn() },
  decisionReplay: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  brainMemory: { create: vi.fn() },
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    masteryDecision: m.masteryDecision,
    decisionReplay: m.decisionReplay,
    brainMemory: m.brainMemory,
    // feature-flags.ts loads DB overrides from here; none in these tests.
    userPreference: { findMany: async () => [] },
    $transaction: m.transaction,
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/brain/journal-fanout", () => ({ dispatchJournalFanout: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/brain/embedding-utils", () => ({ storeGenericEmbedding: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/services/journal-threads", () => ({ tryJoinActiveThreads: vi.fn().mockResolvedValue(undefined) }));

import {
  decisionBrier,
  parseProbability,
  parseReviewDate,
  planDecisionTurn,
  runDecisionTurn,
} from "@/lib/brain/decision-forecast";
import { DECISION_MODE_ASK } from "@/lib/ai/prompt/policy/decision-mode";
import { markReplayed } from "@/lib/services/decision-replay-coach";
import { buildResponseContract } from "@/lib/ai/response-contract";
import { classifyTurn } from "@/lib/ai/turn-intelligence";
import { getFlag } from "@/lib/feature-flags";

const TODAY = "2026-10-17";
const CONV = "conv_1";
const DECISION = "Should I hire Manny full time or keep him part time?";
const ASK = "Before I weigh in: 1. the decision 2. the alternatives 3. your probability 4. a review date.";
const REPLY = "Full time. The alternative is keeping him part time. 70%, review 2026-12-01.";
const NON_DECISION = "What is the weather in Cleveland today";
/** Production shape: route.ts hands buildBrainContext v6 UIMessages with `parts`, not `content`. */
const msgs = (...turns: Array<[string, string]>) =>
  turns.map(([role, text]) => ({ role, parts: [{ type: "step-start" }, { type: "text", text }] }));
/** Legacy `{ role, content }` history (older callers). */
const legacy = (...turns: Array<[string, string]>) => turns.map(([role, content]) => ({ role, content }));

/** A tiny unique-index model of decision_replays.idempotency_key. */
function fakeReplayTable() {
  const keys = new Set<string>();
  m.decisionReplay.findFirst.mockImplementation(async ({ where }: { where: { idempotencyKey: { startsWith: string } } }) => {
    const hit = [...keys].find((k) => k.startsWith(where.idempotencyKey.startsWith));
    return hit ? { idempotencyKey: hit } : null;
  });
  m.decisionReplay.create.mockImplementation(async ({ data }: { data: { idempotencyKey: string } }) => {
    if (keys.has(data.idempotencyKey)) throw Object.assign(new Error("unique"), { code: "P2002" });
    keys.add(data.idempotencyKey);
    return { id: `rp_${keys.size}` };
  });
  return keys;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({ masteryDecision: m.masteryDecision, decisionReplay: m.decisionReplay }),
  );
  m.masteryDecision.create.mockResolvedValue({ id: 77 });
  m.decisionReplay.findFirst.mockResolvedValue(null);
});

describe("planDecisionTurn · when the ask fires", () => {
  it("a decision turn with no history plans the ask", () => {
    expect(planDecisionTurn({ userContent: DECISION, messages: msgs(["user", DECISION]), todayIso: TODAY }).kind).toBe("ask");
  });

  it("POSITIVE CONTROL: a non-decision turn plans nothing", () => {
    expect(planDecisionTurn({ userContent: NON_DECISION, messages: msgs(["user", NON_DECISION]), todayIso: TODAY }).kind).toBe("none");
  });

  it('"just answer" in the message skips it', () => {
    const text = `${DECISION} just answer`;
    expect(planDecisionTurn({ userContent: text, messages: msgs(["user", text]), todayIso: TODAY }).kind).toBe("skip");
  });

  it('a prior "just answer" turns it off for the rest of the conversation', () => {
    const plan = planDecisionTurn({
      userContent: DECISION,
      messages: msgs(["user", "Just answer, no questions today."], ["assistant", "Ok."], ["user", DECISION]),
      todayIso: TODAY,
    });
    expect(plan.kind).toBe("skip");
  });

  it("the reply to the ask, with probability + date, plans a store", () => {
    const plan = planDecisionTurn({
      userContent: REPLY,
      messages: msgs(["user", DECISION], ["assistant", ASK], ["user", REPLY]),
      todayIso: TODAY,
    });
    expect(plan).toMatchObject({ kind: "store", probability: 0.7, reviewDate: "2026-12-01", decision: DECISION });
  });

  it("a reply with a probability but no date plans a partial: say what is missing, store nothing", () => {
    const reply = "Full time, 70%.";
    const plan = planDecisionTurn({ userContent: reply, messages: msgs(["user", DECISION], ["assistant", ASK], ["user", reply]), todayIso: TODAY });
    expect(plan).toEqual({ kind: "partial", missing: ["review date"] });
  });

  it("a reply with a date but no probability plans a partial too", () => {
    const reply = "Full time. Review 2026-12-01.";
    const plan = planDecisionTurn({ userContent: reply, messages: msgs(["user", DECISION], ["assistant", ASK], ["user", reply]), todayIso: TODAY });
    expect(plan).toEqual({ kind: "partial", missing: ["probability"] });
  });

  it("legacy content-shaped history still plans the store", () => {
    const plan = planDecisionTurn({ userContent: REPLY, messages: legacy(["user", DECISION], ["assistant", ASK], ["user", REPLY]), todayIso: TODAY });
    expect(plan).toMatchObject({ kind: "store", probability: 0.7 });
  });

  it.each([
    `${DECISION} just tell me`,
    `just give me the answer: ${DECISION}`,
  ])("the widened skip phrases skip: %s", (text) => {
    expect(planDecisionTurn({ userContent: text, messages: msgs(["user", text]), todayIso: TODAY }).kind).toBe("skip");
  });

  it('decisionSkip only on a decision exchange: a bare "just answer" on a plain question plans nothing', () => {
    const text = "just answer: what time does the shop open";
    expect(planDecisionTurn({ userContent: text, messages: msgs(["user", text]), todayIso: TODAY }).kind).toBe("none");
  });

  it('"just answer" as the reply to the ask is the override: skip', () => {
    const text = "just answer";
    expect(planDecisionTurn({ userContent: text, messages: msgs(["user", DECISION], ["assistant", ASK], ["user", text]), todayIso: TODAY }).kind).toBe("skip");
  });

  it("a finalized decision is never re-opened (executeFinalized)", () => {
    const text = "Should I raise the labor rate? My decision is final, raising it.";
    expect(buildResponseContract(text, classifyTurn(text)).executeFinalized).toBe(true);
    expect(planDecisionTurn({ userContent: text, messages: msgs(["user", text]), todayIso: TODAY }).kind).toBe("none");
  });
});

describe("planDecisionTurn · round 2: the label AND an explicit decision cue", () => {
  const plan = (text: string) => planDecisionTurn({ userContent: text, messages: msgs(["user", text]), todayIso: TODAY }).kind;

  it('"check the logs or the deploy" -> no ask', () => {
    expect(plan("check the logs or the deploy")).toBe("none");
  });

  it.each([
    "should I hire Zach full time or keep him hybrid",
    "is it worth it to switch suppliers",
    "Should we go with Goodyear or Michelin for the fleet deal",
    "I'm deciding between two tire distributors",
  ])("decision cue: %s -> ask", (text) => {
    expect(plan(text)).toBe("ask");
  });

  // Each row carries the existing "decision" label (asserted, so the table really
  // exercises the cue check) and no explicit decision cue: none may ask.
  it.each([
    "check the logs or the deploy",
    "is the shop open Sunday or closed",
    "what is the price for 225/65 or 235/60 tires",
    "remind me tomorrow or Friday about the alignment rack",
    "compare revenue this week vs last week",
    "pull the invoice for car 12 or car 14",
  ])('non-decision "or" message: %s -> no ask', (text) => {
    expect(buildResponseContract(text, classifyTurn(text)).answerMode, "row must carry the decision label").toBe("decision");
    expect(plan(text)).toBe("none");
  });
});

describe("planDecisionTurn · round 3: questions that only look like decisions", () => {
  // Each phrase matched the round-2 cue. Its real contract label is asserted, so
  // the row cannot pass because the label changed.
  it.each([
    ["how do I reset the lift code", "direct_answer"],
    ["what do I have on Monday", "direct_answer"],
    ["where do I find the Michelin invoice", "direct_answer"],
    ["which one is cheaper", "decision"],
    ["what size tires go with this rim", "direct_answer"],
    ["help me decide what to post", "decision"],
  ])("%s (label %s) -> no ask", (text, label) => {
    expect(buildResponseContract(text, classifyTurn(text)).answerMode).toBe(label);
    expect(planDecisionTurn({ userContent: text, messages: msgs(["user", text]), todayIso: TODAY }).kind).toBe("none");
  });
});

describe("NICK_DECISION_MODE kill switch", () => {
  afterEach(() => {
    delete process.env.NICK_DECISION_MODE;
  });

  it("is registered default ON", () => {
    expect(getFlag("NICK_DECISION_MODE")?.isOn).toBe(true);
  });

  it("OFF: no ask, no store", async () => {
    process.env.NICK_DECISION_MODE = "0";
    const ask = await runDecisionTurn({ convId: CONV, userContent: DECISION, messages: msgs(["user", DECISION]), todayIso: TODAY });
    expect(ask).toEqual({ block: "", fired: {} });
    const store = await runDecisionTurn({
      convId: CONV,
      userContent: REPLY,
      messages: msgs(["user", DECISION], ["assistant", ASK], ["user", REPLY]),
      todayIso: TODAY,
    });
    expect(store).toEqual({ block: "", fired: {} });
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.decisionReplay.findFirst).not.toHaveBeenCalled();
  });

  it("OFF: an already stored forecast still scores at review", async () => {
    process.env.NICK_DECISION_MODE = "0";
    expect(decisionBrier("p=0.7", 5)).toBeCloseTo(0.09, 6);
  });

  it("ON (unset): the ask fires", async () => {
    const r = await runDecisionTurn({ convId: CONV, userContent: DECISION, messages: msgs(["user", DECISION]), todayIso: TODAY });
    expect(r.block).toBe(DECISION_MODE_ASK);
  });
});

describe("parsers", () => {
  it.each([
    ["70%", 0.7],
    ["about 70 % sure", 0.7],
    ["p=0.35", 0.35],
    ["raise prices 5% or hold. 70% hold works. Review 2026-11-15", 0.7],
    ["a 5% raise, and I am 70% sure it sticks", 0.7],
    ["I am 70% confident the 5% raise sticks", 0.7],
    ["chance 0.7", 0.7],
    ["odds are 70", 0.7],
    ["going with 70 dollars", null],
    ["0% chance", 0],
    ["150%", null],
    ["no number here", null],
  ])("parseProbability(%s) -> %s", (text, want) => {
    expect(parseProbability(text)).toBe(want);
  });

  it.each([
    ["review 2026-12-01", "2026-12-01"],
    ["check in 3 weeks", "2026-11-07"],
    ["in 2 months", "2026-12-17"],
    ["review on Dec 1st", "2026-12-01"],
    ["review December 1, 2027", "2027-12-01"],
    ["review 1 Dec", "2026-12-01"],
    ["review 12/1", "2026-12-01"],
    ["review 12/1/2027", "2027-12-01"],
    ["the invoice is due in 30 days", null],
    ["net terms in 30 days", null],
    ["invoice due in 30 days, review in 6 weeks", "2026-11-28"],
    ["by March 3", "2027-03-03"],
    ["review 2026-01-01", null],
    ["soon", null],
  ])("parseReviewDate(%s) -> %s", (text, want) => {
    expect(parseReviewDate(text, TODAY)).toBe(want);
  });
});

describe("runDecisionTurn · round 3: placeholder conversations and partial answers", () => {
  it.each(["private", "temp"])('convId "%s" (shared placeholder) neither asks nor writes', async (convId) => {
    const ask = await runDecisionTurn({ convId, userContent: DECISION, messages: msgs(["user", DECISION]), todayIso: TODAY });
    const store = await runDecisionTurn({
      convId,
      userContent: REPLY,
      messages: msgs(["user", DECISION], ["assistant", ASK], ["user", REPLY]),
      todayIso: TODAY,
    });
    expect([ask, store]).toEqual([{ block: "", fired: {} }, { block: "", fired: {} }]);
    expect(m.decisionReplay.findFirst).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("a partial answer injects the missing-piece block and writes nothing", async () => {
    const reply = "Full time, 70%.";
    const r = await runDecisionTurn({ convId: CONV, userContent: reply, messages: msgs(["user", DECISION], ["assistant", ASK], ["user", reply]), todayIso: TODAY });
    expect(r.fired).toEqual({ decisionPartial: true });
    expect(r.block).toMatch(/^## DECISION MODE: forecast not stored yet/);
    expect(r.block).toContain("review date");
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("a parts-shaped legacy-free history stores on turn 2 (the production shape)", async () => {
    fakeReplayTable();
    const history = msgs(["user", DECISION], ["assistant", ASK], ["user", REPLY]);
    expect("content" in history[0]).toBe(false);
    const r = await runDecisionTurn({ convId: CONV, userContent: REPLY, messages: history, todayIso: TODAY });
    expect(r.fired).toEqual({ decisionStored: true });
    expect(m.decisionReplay.create).toHaveBeenCalledTimes(1);
  });
});

describe("runDecisionTurn · block + store", () => {
  it("a decision turn with no stored replay gets the ask block", async () => {
    const r = await runDecisionTurn({ convId: CONV, userContent: DECISION, messages: msgs(["user", DECISION]), todayIso: TODAY });
    expect(r.block).toBe(DECISION_MODE_ASK);
    expect(r.fired).toEqual({ decisionAsk: true });
  });

  it("POSITIVE CONTROL: a non-decision turn gets no block and reads nothing", async () => {
    const r = await runDecisionTurn({ convId: CONV, userContent: NON_DECISION, messages: msgs(["user", NON_DECISION]), todayIso: TODAY });
    expect(r.block).toBe("");
    expect(r.fired).toEqual({});
    expect(m.decisionReplay.findFirst).not.toHaveBeenCalled();
  });

  it("a conversation that already stored a forecast is not asked again", async () => {
    m.decisionReplay.findFirst.mockResolvedValue({ idempotencyKey: `soc:${CONV}:abc` });
    const r = await runDecisionTurn({ convId: CONV, userContent: DECISION, messages: msgs(["user", DECISION]), todayIso: TODAY });
    expect(r.block).toBe("");
  });

  it('"just answer" suppresses the block and records the skip', async () => {
    const text = `${DECISION} Just answer.`;
    const r = await runDecisionTurn({ convId: CONV, userContent: text, messages: msgs(["user", text]), todayIso: TODAY });
    expect(r.block).toBe("");
    expect(r.fired).toEqual({ decisionSkip: true });
  });

  it("a Private Lab turn (no convId) neither asks nor writes", async () => {
    const r = await runDecisionTurn({ convId: undefined, userContent: DECISION, messages: msgs(["user", DECISION]), todayIso: TODAY });
    expect(r.block).toBe("");
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("a reply with probability + date writes ONE DecisionReplay with the probability", async () => {
    fakeReplayTable();
    const r = await runDecisionTurn({
      convId: CONV,
      userContent: REPLY,
      messages: msgs(["user", DECISION], ["assistant", ASK], ["user", REPLY]),
      todayIso: TODAY,
    });
    expect(m.decisionReplay.create).toHaveBeenCalledTimes(1);
    const replay = m.decisionReplay.create.mock.calls[0][0].data;
    expect(replay).toMatchObject({ decisionId: 77, choiceMade: REPLY, reviewAt: new Date("2026-12-01T12:00:00Z") });
    expect(replay.idempotencyKey.startsWith(`soc:${CONV}:`)).toBe(true);
    expect(replay.idempotencyKey.length).toBeLessThanOrEqual(64);
    expect(m.masteryDecision.create.mock.calls[0][0].data).toMatchObject({ predictedOutcome: "p=0.7", reviewDate: "2026-12-01" });
    expect(r.fired).toEqual({ decisionStored: true });
    expect(r.block).toContain("70%");
    expect(r.block).toContain("2026-12-01");
  });

  it("a retried turn writes once (sequential retry)", async () => {
    fakeReplayTable();
    const input = { convId: CONV, userContent: REPLY, messages: msgs(["user", DECISION], ["assistant", ASK], ["user", REPLY]), todayIso: TODAY };
    const a = await runDecisionTurn(input);
    const b = await runDecisionTurn(input);
    const writes = m.decisionReplay.create.mock.results.filter((x) => x.type === "return").length;
    expect(writes).toBe(1);
    expect(a.fired).toEqual({ decisionStored: true });
    expect(b.fired).toEqual({ decisionStored: true });
  });

  it("a retried turn writes once (two racers both read empty, the unique key decides)", async () => {
    const keys = fakeReplayTable();
    m.decisionReplay.findFirst.mockResolvedValue(null); // both racers read before either wrote
    const input = { convId: CONV, userContent: REPLY, messages: msgs(["user", DECISION], ["assistant", ASK], ["user", REPLY]), todayIso: TODAY };
    const [a, b] = await Promise.all([runDecisionTurn(input), runDecisionTurn(input)]);
    expect(keys.size).toBe(1);
    expect([a.fired, b.fired]).toEqual([{ decisionStored: true }, { decisionStored: true }]);
  });

  it("a failed write says NOT stored and never claims it was saved", async () => {
    m.transaction.mockRejectedValue(new Error("db down"));
    const r = await runDecisionTurn({
      convId: CONV,
      userContent: REPLY,
      messages: msgs(["user", DECISION], ["assistant", ASK], ["user", REPLY]),
      todayIso: TODAY,
    });
    expect(r.fired).toEqual({ decisionStoreFailed: true });
    expect(r.block).toMatch(/NOT stored/);
  });
});

describe("decisionBrier · the review score", () => {
  it.each([
    [5, 0.09], // Worked
    [-5, 0.49], // Didn't
    [0, 0.04], // Mixed
  ])("p=0.7 with outcomeScore %d -> %d", (score, want) => {
    expect(decisionBrier("p=0.7", score)).toBeCloseTo(want, 6);
  });

  it("no probability -> null, never 0", () => {
    expect(decisionBrier(null, 5)).toBeNull();
    expect(decisionBrier("Revenue should rise", 5)).toBeNull();
  });

  it("no outcome -> null", () => {
    expect(decisionBrier("p=0.7", null)).toBeNull();
    expect(decisionBrier("p=0.7", undefined)).toBeNull();
  });
});

describe("markReplayed · every review path scores the stored probability", () => {
  it("returns the Brier from MasteryDecision.predictedOutcome and closes the socratic row", async () => {
    m.masteryDecision.findUnique.mockResolvedValue({ id: 77, title: "t", chosen: "c", reasoning: null, predictedOutcome: "p=0.7" });
    m.decisionReplay.findFirst.mockResolvedValue({ id: "rp_soc" });
    m.decisionReplay.update.mockResolvedValue({ id: "rp_soc" });
    const r = await markReplayed({ decisionId: 77, outcome: "telegram one-tap: Didn't", outcomeScore: -5 });
    expect(r.replayId).toBe("rp_soc");
    expect(r.brier).toBeCloseTo(0.49, 6);
    const where = m.decisionReplay.findFirst.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain("soc:");
  });

  it("a decision with no probability reviews with brier null", async () => {
    m.masteryDecision.findUnique.mockResolvedValue({ id: 78, title: "t", chosen: "c", reasoning: null, predictedOutcome: null });
    m.decisionReplay.findFirst.mockResolvedValue({ id: "rp_old" });
    m.decisionReplay.update.mockResolvedValue({ id: "rp_old" });
    const r = await markReplayed({ decisionId: 78, outcome: "x", outcomeScore: 5 });
    expect(r.brier).toBeNull();
  });
});
