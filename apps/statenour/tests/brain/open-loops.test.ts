/**
 * Upgrade 9 (follow up on open loops), 2026-11-01. When Nour writes an explicit first-person
 * future commitment with a date or weekday ("I'll call him Tuesday"), Nick asks about it once
 * after that date, in the dailyPulse reply. Never inferred, never a push, one ask, then drop.
 * Every ask is an outcome-ledger row whose evidenceRefs say why it fired, so the kill read
 * (1 in 3 answered within 14 days, by 2026-12-01) counts asks against answers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  chatMessageFindMany: vi.fn(),
  outcomeFindMany: vi.fn(),
  outcomeFindFirst: vi.fn(),
  recordShown: vi.fn(),
  recordDecision: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: { findMany: db.chatMessageFindMany },
    intelligenceOutcome: { findMany: db.outcomeFindMany, findFirst: db.outcomeFindFirst },
  },
}));
vi.mock("@/lib/services/outcome-ledger", () => ({
  recordShown: db.recordShown,
  recordDecision: db.recordDecision,
}));

import { answerOpenLoop, detectOpenLoops, nextOpenLoopAsk } from "@/lib/brain/open-loops";

// Mon 2026-11-02 14:00 ET (19:00Z, EST).
const MONDAY = new Date("2026-11-02T19:00:00Z");

describe("detectOpenLoops · explicit first-person commitments with a date only", () => {
  it.each([
    ["I'll call him Tuesday", "2026-11-03", "weekday"],
    ["Ok I’ll email the landlord monday.", "2026-11-09", "weekday"], // curly apostrophe; Monday said on Monday = next Monday
    ["I will send Mike the estimate on Friday", "2026-11-06", "weekday"],
    ["I'm going to order the tires tomorrow", "2026-11-03", "tomorrow"],
    ["I'll pay the parts invoice by 11/15", "2026-11-15", "date"],
    ["I'll finish the CRM plan by Nov 20th", "2026-11-20", "date"],
    ["I'll call the insurance guy today", "2026-11-02", "today"],
  ])("%s -> due %s (%s)", (text, dueOn, rule) => {
    const loops = detectOpenLoops(text, MONDAY);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toMatchObject({ dueOn, rule, saidOn: "2026-11-02" });
  });

  it.each([
    "Will I call him Tuesday?",
    "Should I call him Tuesday?",
    "I'll probably call him Tuesday",
    "Maybe I'll call him Tuesday",
    "If it rains I'll close Friday",
    "I won't call him Tuesday",
    "Mike will call me Tuesday",
    "I called him Tuesday",
    "I'll call him later",
    "You'll call him Tuesday",
    "We'll go Friday",
    "I'll be honest with you",
    "I might call him Tuesday",
    "Unless it rains I'll close Friday",
    "I'll could call him Tuesday",
    "Perhaps I'll call him Tuesday",
    "I'll possibly call him Tuesday",
    "I would call him Tuesday but I will not",
    "I will not call him Tuesday",
    "I'll never call him Tuesday",
    // Second reader 2026-11-01: tire talk and fractions are not dates.
    "I'll grab the 1/2 inch lug nuts",
    "I'll mark 3 done",
    "I'll decline 2 of them",
    // A due date before the day it was said is a reference, not a promise.
    "I'll pay the 10/25 invoice",
    "I'll pay it by 10/25", // said 11-02: the date is behind him
    "I'll pay it on Oct 30",
    // Someone else's words, quoted or reported.
    'He texted "I\'ll come by Tuesday"',
    "> I'll come by Tuesday",
    "Mike said I'll get paid Friday",
    // States, not things to do.
    "I'll be off Friday",
    "I'm going to be busy tomorrow",
  ])("ignores %s", (text) => {
    expect(detectOpenLoops(text, MONDAY)).toEqual([]);
  });

  it("an impossible calendar date is dropped, never rolled into the next month", () => {
    expect(detectOpenLoops("I'll pay it by 2/31", MONDAY)).toEqual([]);
    expect(detectOpenLoops("I'll pay it by Feb 30", MONDAY)).toEqual([]);
  });

  it("a weekday said at 23:30 ET counts from the ET day, not the UTC one", () => {
    // Mon 2026-11-02 23:30 ET = Tue 04:30Z. "Wednesday" is 2 days out, not 1.
    const loops = detectOpenLoops("I'll call him Wednesday", new Date("2026-11-03T04:30:00Z"));
    expect(loops[0]).toMatchObject({ saidOn: "2026-11-02", dueOn: "2026-11-04" });
  });

  it("a number in the sentence does not beat 'tomorrow'", () => {
    const loops = detectOpenLoops("I'll call him tomorrow about the 1/2 payment", MONDAY);
    expect(loops[0]).toMatchObject({ dueOn: "2026-11-03", rule: "tomorrow" });
  });

  it("'next Tuesday' is never read as the nearer Tuesday (asking late beats asking early)", () => {
    // Said Sun 2026-11-01: "Tuesday" is 11-03, "next Tuesday" is 11-10.
    const sunday = new Date("2026-11-01T19:00:00Z");
    expect(detectOpenLoops("I'll call him next Tuesday", sunday)[0]).toMatchObject({ dueOn: "2026-11-10" });
  });

  it("the same weekday said before 05:00 ET means that day (Nour up late)", () => {
    // Tue 2026-11-03 01:00 ET = 06:00Z.
    const loops = detectOpenLoops("I'll call him Tuesday", new Date("2026-11-03T06:00:00Z"));
    expect(loops[0]).toMatchObject({ saidOn: "2026-11-03", dueOn: "2026-11-03" });
  });

  it("'tomorrow' said at 23:30 ET is the next ET day", () => {
    const loops = detectOpenLoops("I'll call him tomorrow", new Date("2026-11-03T04:30:00Z"));
    expect(loops[0]).toMatchObject({ saidOn: "2026-11-02", dueOn: "2026-11-03" });
  });

  it("a month/day said late in December means next year", () => {
    const loops = detectOpenLoops("I'll pay the tire vendor by 1/5", new Date("2026-12-28T17:00:00Z"));
    expect(loops[0]).toMatchObject({ saidOn: "2026-12-28", dueOn: "2027-01-05" });
  });

  it("keeps the sentence that holds the commitment, not the whole message", () => {
    const loops = detectOpenLoops("Long day at the shop. I'll call Mash Thursday about the lift. Anyway.", MONDAY);
    expect(loops).toEqual([
      expect.objectContaining({ quote: "I'll call Mash Thursday about the lift.", dueOn: "2026-11-05" }),
    ]);
  });
});

const msg = (id: string, content: string, iso: string) => ({ id, conversationId: `c-${id}`, content, createdAt: new Date(iso) });

describe("nextOpenLoopAsk · one ask, after the date, never twice", () => {
  // Thu 2026-11-05 15:00 ET.
  const THURSDAY = new Date("2026-11-05T20:00:00Z");

  beforeEach(() => {
    vi.clearAllMocks();
    db.outcomeFindMany.mockResolvedValue([]);
    db.recordShown.mockResolvedValue("row-1");
  });

  it("asks about a loop whose date has passed and stores why it fired", async () => {
    db.chatMessageFindMany.mockResolvedValue([msg("m1", "I'll call him Tuesday", "2026-11-02T19:00:00Z")]);
    const ask = await nextOpenLoopAsk(THURSDAY);
    expect(ask).toMatchObject({ state: "ask", id: "row-1", quote: "I'll call him Tuesday", saidOn: "2026-11-02", dueOn: "2026-11-03" });
    const shown = db.recordShown.mock.calls[0][0];
    expect(shown.sourceEngine).toBe("open-loop");
    expect(shown.shownSurface).toBe("chat:dailyPulse");
    expect(shown.conversationId).toBe("c-m1");
    expect(shown.evidenceRefs).toMatchObject({
      loopKey: "m1#0",
      messageId: "m1",
      quote: "I'll call him Tuesday",
      saidOn: "2026-11-02",
      dueOn: "2026-11-03",
      rule: "weekday",
    });
    expect(String(shown.evidenceRefs.firedBecause)).toMatch(/due 2026-11-03 passed/);
  });

  it("does not ask on or before the due date", async () => {
    db.chatMessageFindMany.mockResolvedValue([msg("m1", "I'll call him Thursday", "2026-11-02T19:00:00Z")]);
    await expect(nextOpenLoopAsk(THURSDAY)).resolves.toEqual({ state: "none" });
    expect(db.recordShown).not.toHaveBeenCalled();
  });

  it("never asks the same loop twice", async () => {
    db.chatMessageFindMany.mockResolvedValue([msg("m1", "I'll call him Tuesday", "2026-11-02T19:00:00Z")]);
    db.outcomeFindMany.mockResolvedValue([{ shownAt: new Date("2026-11-04T15:00:00Z"), evidenceRefs: { loopKey: "m1#0" } }]);
    await expect(nextOpenLoopAsk(THURSDAY)).resolves.toEqual({ state: "none" });
  });

  it("a promise repeated in a second message is still one ask", async () => {
    db.chatMessageFindMany.mockResolvedValue([msg("m2", "I'll call him Tuesday", "2026-11-02T20:00:00Z")]);
    db.outcomeFindMany.mockResolvedValue([
      { shownAt: new Date("2026-11-04T15:00:00Z"), evidenceRefs: { loopKey: "m1#0", quote: "I'll call him Tuesday" } },
    ]);
    await expect(nextOpenLoopAsk(THURSDAY)).resolves.toEqual({ state: "none" });
  });

  it("asks at most once a day, even with more loops waiting", async () => {
    db.chatMessageFindMany.mockResolvedValue([msg("m1", "I'll call him Tuesday", "2026-11-02T19:00:00Z")]);
    db.outcomeFindMany.mockResolvedValue([{ shownAt: new Date("2026-11-05T14:00:00Z"), evidenceRefs: { loopKey: "m9#0" } }]);
    await expect(nextOpenLoopAsk(THURSDAY)).resolves.toEqual({ state: "none" });
  });

  it("drops a loop more than 14 days past due (stale asks read as nagging)", async () => {
    db.chatMessageFindMany.mockResolvedValue([msg("m1", "I'll call him Tuesday", "2026-10-12T19:00:00Z")]); // due 10-13
    await expect(nextOpenLoopAsk(THURSDAY)).resolves.toEqual({ state: "none" });
  });

  it("skips long pasted messages (a quoted email is not Nour's promise)", async () => {
    db.chatMessageFindMany.mockResolvedValue([msg("m1", `I'll call him Tuesday. ${"x".repeat(1600)}`, "2026-11-02T19:00:00Z")]);
    await expect(nextOpenLoopAsk(THURSDAY)).resolves.toEqual({ state: "none" });
  });

  it("asks the most recently due loop first", async () => {
    db.chatMessageFindMany.mockResolvedValue([
      msg("m1", "I'll call him Monday", "2026-10-30T19:00:00Z"), // due 11-02
      msg("m2", "I'll send the quote Wednesday", "2026-11-02T19:00:00Z"), // due 11-04
    ]);
    await expect(nextOpenLoopAsk(THURSDAY)).resolves.toMatchObject({ state: "ask", dueOn: "2026-11-04" });
  });

  it("a ledger write that fails is an error, never a silent ask (it could not be counted or kept from repeating)", async () => {
    db.chatMessageFindMany.mockResolvedValue([msg("m1", "I'll call him Tuesday", "2026-11-02T19:00:00Z")]);
    db.recordShown.mockResolvedValue(null);
    await expect(nextOpenLoopAsk(THURSDAY)).rejects.toThrow(/ledger/);
  });

  it("a failed read throws (the caller shows UNKNOWN, not 'nothing open')", async () => {
    db.chatMessageFindMany.mockRejectedValue(new Error("db down"));
    await expect(nextOpenLoopAsk(THURSDAY)).rejects.toThrow(/db down/);
  });

  it("reads only Nour's own messages from the last 21 days, newest first (a cap must drop the oldest)", async () => {
    db.chatMessageFindMany.mockResolvedValue([]);
    await nextOpenLoopAsk(THURSDAY);
    const q = db.chatMessageFindMany.mock.calls[0][0];
    expect(q.where.role).toBe("user");
    expect(q.where.createdAt.gte.toISOString()).toBe(new Date(THURSDAY.getTime() - 21 * 86_400_000).toISOString());
    expect(q.orderBy).toEqual({ createdAt: "desc" });
    expect(q.take).toBe(2000);
  });

  it("checks only open-loop rows from the last 60 days for 'already asked'", async () => {
    db.chatMessageFindMany.mockResolvedValue([]);
    await nextOpenLoopAsk(THURSDAY);
    const where = db.outcomeFindMany.mock.calls[0][0].where;
    expect(where.sourceEngine).toBe("open-loop");
    expect(where.shownAt.gte.toISOString()).toBe(new Date(THURSDAY.getTime() - 60 * 86_400_000).toISOString());
  });

  it("an ask yesterday evening ET does not block today's ask", async () => {
    db.chatMessageFindMany.mockResolvedValue([msg("m2", "I'll send the quote Wednesday", "2026-11-02T19:00:00Z")]);
    // Wed 20:00 ET = Thu 01:00Z: a UTC day boundary would call this "today".
    db.outcomeFindMany.mockResolvedValue([{ shownAt: new Date("2026-11-05T01:00:00Z"), evidenceRefs: { loopKey: "m1#0", quote: "other" } }]);
    await expect(nextOpenLoopAsk(THURSDAY)).resolves.toMatchObject({ state: "ask", dueOn: "2026-11-04" });
  });

  it("at 21:00 ET on the due day it does not ask yet (the ET day, not the UTC one)", async () => {
    db.chatMessageFindMany.mockResolvedValue([msg("m2", "I'll send the quote Wednesday", "2026-11-02T19:00:00Z")]);
    await expect(nextOpenLoopAsk(new Date("2026-11-05T02:00:00Z"))).resolves.toEqual({ state: "none" });
  });

  it("asks a loop exactly 14 days past due, not 15", async () => {
    // THURSDAY = 2026-11-05: 14 days back is 10-22.
    db.chatMessageFindMany.mockResolvedValue([msg("m1", "I'll call him Thursday", "2026-10-21T19:00:00Z")]); // due 10-22
    await expect(nextOpenLoopAsk(THURSDAY)).resolves.toMatchObject({ state: "ask", dueOn: "2026-10-22" });
    vi.clearAllMocks();
    db.outcomeFindMany.mockResolvedValue([]);
    db.recordShown.mockResolvedValue("row-2");
    db.chatMessageFindMany.mockResolvedValue([msg("m1", "I'll call him Wednesday", "2026-10-20T19:00:00Z")]); // due 10-21
    await expect(nextOpenLoopAsk(THURSDAY)).resolves.toEqual({ state: "none" });
  });

  it("reads a message of exactly 1500 chars, skips 1501", async () => {
    const at = (n: number) => `I'll call him Tuesday.${" ".repeat(n - 22)}`;
    db.chatMessageFindMany.mockResolvedValue([msg("m1", at(1500), "2026-11-02T19:00:00Z")]);
    await expect(nextOpenLoopAsk(THURSDAY)).resolves.toMatchObject({ state: "ask" });
    vi.clearAllMocks();
    db.outcomeFindMany.mockResolvedValue([]);
    db.chatMessageFindMany.mockResolvedValue([msg("m1", at(1501), "2026-11-02T19:00:00Z")]);
    await expect(nextOpenLoopAsk(THURSDAY)).resolves.toEqual({ state: "none" });
  });
});

describe("answerOpenLoop · records the answer on the ask's own row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.recordDecision.mockResolvedValue(true);
  });

  it.each([
    ["done", "accepted", null],
    ["not_yet", "dismissed", "dismiss:timing"],
    ["dropped", "dismissed", "dismiss:alternative"],
  ] as const)("%s -> %s (%s)", async (answer, decision, resultRef) => {
    db.outcomeFindFirst.mockResolvedValue({ id: "row-1", decision: null });
    await expect(answerOpenLoop("row-1", answer)).resolves.toBe("recorded");
    expect(db.recordDecision).toHaveBeenCalledWith({ id: "row-1", decision, resultRef });
  });

  it("an already answered ask says so and writes nothing", async () => {
    db.outcomeFindFirst.mockResolvedValue({ id: "row-1", decision: "accepted" });
    await expect(answerOpenLoop("row-1", "done")).resolves.toBe("already_answered");
    expect(db.recordDecision).not.toHaveBeenCalled();
  });

  it("a write that fails throws (an outage must not read as a bad id)", async () => {
    db.outcomeFindFirst.mockResolvedValue({ id: "row-1", decision: null });
    db.recordDecision.mockResolvedValue(false);
    await expect(answerOpenLoop("row-1", "done")).rejects.toThrow(/not recorded/);
  });

  it("refuses a row that is not an open-loop ask", async () => {
    db.outcomeFindFirst.mockResolvedValue(null);
    await expect(answerOpenLoop("other-row", "done")).resolves.toBe("not_found");
    expect(db.recordDecision).not.toHaveBeenCalled();
    expect(db.outcomeFindFirst.mock.calls[0][0].where).toEqual({ id: "other-row", sourceEngine: "open-loop" });
  });
});
