/**
 * Open loops (upgrade 9, docs/research/chat-upgrades-2026-11-01.md): when Nour writes an
 * explicit first-person future commitment with a date or weekday ("I'll call him Tuesday"),
 * Nick asks about it once, after that date, in the dailyPulse reply. Never a push or SMS.
 *
 * Detection is a pure regex over Nour's own chat messages, read at ask time (no new table or
 * column): only "I'll / I will / I'm going to" plus a weekday, today/tomorrow or a calendar
 * date; hedged, conditional, negated and question sentences are dropped. Inferred commitments
 * are never asked.
 *
 * Each ask is an outcome-ledger row (sourceEngine "open-loop") whose evidenceRefs say why it
 * fired; answerOpenLoop decides that row. "not yet" and "dropped" are stored as
 * dismiss:timing / dismiss:alternative, which the ledger's correction predicate already
 * excludes. Kill read (2026-12-01): at least 1 in 3 asks decided within 14 days of shownAt.
 */
import { prisma } from "@/lib/prisma";
import { recordDecision, recordShown } from "@/lib/services/outcome-ledger";
import { etCalendarParts, startOfDayET } from "@/lib/utils/datetime";

const SOURCE_ENGINE = "open-loop";
const DAY_MS = 86_400_000;
/** How far back Nour's messages are read, and how stale a passed date may be before it is dropped. */
const LOOKBACK_DAYS = 21;
const MAX_DAYS_PAST_DUE = 14;
/** Longer messages are usually pasted text (an email, a quote), not Nour's own promise. */
const MAX_MESSAGE_CHARS = 1500;

export interface OpenLoop {
  quote: string;
  saidOn: string;
  dueOn: string;
  rule: "weekday" | "tomorrow" | "today" | "date";
}

const FUTURE = /\b(?:i['’]ll|i will|i['’]m going to|i am going to|i['’]m gonna|i am gonna)\b/i;
const HEDGE =
  /\b(?:maybe|might|probably|possibly|perhaps|if|unless|should|could|would)\b|\bi(?:['’]ll| will) (?:never|not)\b|\bwon['’]t\b/i;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;
const TOMORROW = /\b(?:tomorrow|tmrw)\b/i;
const TODAY = /\b(?:today|tonight)\b/i;
const NUMERIC_DATE = /\b(1[0-2]|0?[1-9])\/(3[01]|[12]\d|0?[1-9])\b/;
const MONTH_DATE =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(3[01]|[12]\d|0?[1-9])(?:st|nd|rd|th)?\b/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** YYYY-MM-DD for an ET calendar date; Date.UTC normalizes day overflow across months. */
function ymd(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/** A month/day said near a year boundary means the coming one ("1/5" said in December). */
function calendarDue(said: { year: number; month: number; day: number }, month: number, day: number): string {
  const sameYear = ymd(said.year, month, day);
  const saidOn = ymd(said.year, said.month, said.day);
  return Date.parse(sameYear) < Date.parse(saidOn) - 30 * DAY_MS ? ymd(said.year + 1, month, day) : sameYear;
}

export function detectOpenLoops(text: string, saidAt: Date): OpenLoop[] {
  const said = etCalendarParts(saidAt);
  const saidOn = ymd(said.year, said.month, said.day);
  const loops: OpenLoop[] = [];
  for (const raw of text.split(/(?<=[.!?])\s+|\n+/)) {
    const quote = raw.trim();
    if (!quote || quote.endsWith("?") || !FUTURE.test(quote) || HEDGE.test(quote)) continue;
    const numeric = NUMERIC_DATE.exec(quote);
    const named = MONTH_DATE.exec(quote);
    const weekday = WEEKDAY.exec(quote);
    let due: Pick<OpenLoop, "dueOn" | "rule"> | null = null;
    if (numeric) due = { dueOn: calendarDue(said, Number(numeric[1]), Number(numeric[2])), rule: "date" };
    else if (named) due = { dueOn: calendarDue(said, MONTHS.indexOf(named[1].toLowerCase()) + 1, Number(named[2])), rule: "date" };
    else if (TOMORROW.test(quote)) due = { dueOn: ymd(said.year, said.month, said.day + 1), rule: "tomorrow" };
    else if (TODAY.test(quote)) due = { dueOn: saidOn, rule: "today" };
    else if (weekday) {
      // "Tuesday" said on a Tuesday means next week's.
      const ahead = (WEEKDAYS.indexOf(weekday[1].toLowerCase()) - said.weekday + 7) % 7 || 7;
      due = { dueOn: ymd(said.year, said.month, said.day + ahead), rule: "weekday" };
    }
    if (due) loops.push({ quote: quote.slice(0, 280), saidOn, ...due });
  }
  return loops;
}

export type OpenLoopAsk =
  | { state: "ask"; id: string; quote: string; saidOn: string; dueOn: string }
  | { state: "none" };

/**
 * The one open loop to ask about now, ledgered as shown. "none" is a measured none: nothing
 * due, already asked today, or every due loop already asked once. A failed read or ledger
 * write THROWS, so the caller can say UNKNOWN; an ask that is not ledgered could be neither
 * counted nor kept from repeating.
 */
export async function nextOpenLoopAsk(now: Date = new Date()): Promise<OpenLoopAsk> {
  const asked = await prisma.intelligenceOutcome.findMany({
    where: { sourceEngine: SOURCE_ENGINE, shownAt: { gte: new Date(now.getTime() - 60 * DAY_MS) } },
    select: { shownAt: true, evidenceRefs: true },
  });
  // One ask a day, however often dailyPulse runs.
  const dayStart = startOfDayET(now);
  if (asked.some((r) => r.shownAt >= dayStart)) return { state: "none" };
  const askedKeys = new Set(asked.map((r) => (r.evidenceRefs as { loopKey?: unknown } | null)?.loopKey));

  const messages = await prisma.chatMessage.findMany({
    where: { role: "user", createdAt: { gte: new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS) } },
    select: { id: true, conversationId: true, content: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 2000,
  });

  const t = etCalendarParts(now);
  const todayOn = ymd(t.year, t.month, t.day);
  const oldestDue = ymd(t.year, t.month, t.day - MAX_DAYS_PAST_DUE);
  let pick: (OpenLoop & { loopKey: string; messageId: string; conversationId: string }) | null = null;
  for (const m of messages) {
    if (m.content.length > MAX_MESSAGE_CHARS) continue;
    detectOpenLoops(m.content, m.createdAt).forEach((loop, i) => {
      const loopKey = `${m.id}#${i}`;
      if (loop.dueOn >= todayOn || loop.dueOn < oldestDue || askedKeys.has(loopKey)) return;
      // The most recently due first: the freshest promise is the likeliest to get an answer.
      if (!pick || loop.dueOn >= pick.dueOn) pick = { ...loop, loopKey, messageId: m.id, conversationId: m.conversationId };
    });
  }
  if (!pick) return { state: "none" };
  const loop: OpenLoop & { loopKey: string; messageId: string; conversationId: string } = pick;

  const id = await recordShown({
    kind: "suggestion",
    sourceEngine: SOURCE_ENGINE,
    summary: `Open loop: ${loop.quote}`,
    shownSurface: "chat:dailyPulse",
    conversationId: loop.conversationId,
    evidenceRefs: {
      loopKey: loop.loopKey,
      messageId: loop.messageId,
      conversationId: loop.conversationId,
      quote: loop.quote,
      saidOn: loop.saidOn,
      dueOn: loop.dueOn,
      rule: loop.rule,
      firedBecause: `explicit first-person commitment with a ${loop.rule} date; due ${loop.dueOn} passed; not asked before`,
    },
  });
  if (!id) throw new Error("open-loop ask could not be written to the outcome ledger");
  return { state: "ask", id, quote: loop.quote, saidOn: loop.saidOn, dueOn: loop.dueOn };
}

export type OpenLoopAnswer = "done" | "not_yet" | "dropped";

/** Decide an ask's own row. False when the id is not an open-loop ask or it was already answered. */
export async function answerOpenLoop(id: string, answer: OpenLoopAnswer): Promise<boolean> {
  const row = await prisma.intelligenceOutcome.findFirst({ where: { id, sourceEngine: SOURCE_ENGINE } });
  if (!row) return false;
  return recordDecision({
    id,
    decision: answer === "done" ? "accepted" : "dismissed",
    resultRef: answer === "done" ? null : answer === "not_yet" ? "dismiss:timing" : "dismiss:alternative",
  });
}
