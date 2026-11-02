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
import { etCalendarParts, hourET, startOfDayET } from "@/lib/utils/datetime";

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

// An action verb must follow: "I'll be off Friday" and "I'm going to be busy" are states, not things to do.
const FUTURE = /\b(?:i['’]ll|i will|i['’]m going to|i am going to|i['’]m gonna|i am gonna)\s+(?!be\b)\w/i;
const HEDGE =
  /\b(?:maybe|might|probably|possibly|perhaps|if|unless|should|could|would)\b|\bi(?:['’]ll| will) (?:never|not)\b|\bwon['’]t\b/i;
/** Someone else's words: quoted, a "> " reply line, or reported speech. */
const NOT_HIS = /["“”]|^>|\b(?:said|says|told me|texted|wrote|asked)\b/i;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY = /\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;
const TOMORROW = /\b(?:tomorrow|tmrw)\b/i;
const TODAY = /\b(?:today|tonight)\b/i;
// A bare "1/2" is a fraction (lug nuts, half a payment): a numeric date needs "by / on / before / until / due".
const NUMERIC_DATE = /\b(?:by|on|before|until|due)\s+(?:the\s+)?(1[0-2]|0?[1-9])\/(3[01]|[12]\d|0?[1-9])\b/i;
// Whole month names or their exact short forms only: "mark 3" and "decline 2" are not dates.
const MONTH_DATE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(3[01]|[12]\d|0?[1-9])(?:st|nd|rd|th)?\b/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** YYYY-MM-DD for an ET calendar date; Date.UTC normalizes day overflow across months. */
function ymd(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/** A month/day said near a year boundary means the coming one ("1/5" said in December). Null for 2/31. */
function calendarDue(said: { year: number; month: number; day: number }, month: number, day: number): string | null {
  if (new Date(Date.UTC(said.year, month - 1, day)).getUTCDate() !== day) return null;
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
    if (!quote || quote.endsWith("?") || !FUTURE.test(quote) || HEDGE.test(quote) || NOT_HIS.test(quote)) continue;
    const numeric = NUMERIC_DATE.exec(quote);
    const named = MONTH_DATE.exec(quote);
    const weekday = WEEKDAY.exec(quote);
    let due: { dueOn: string | null; rule: OpenLoop["rule"] } | null = null;
    if (numeric) due = { dueOn: calendarDue(said, Number(numeric[1]), Number(numeric[2])), rule: "date" };
    else if (named) due = { dueOn: calendarDue(said, MONTHS.indexOf(named[1].slice(0, 3).toLowerCase()) + 1, Number(named[2])), rule: "date" };
    else if (TOMORROW.test(quote)) due = { dueOn: ymd(said.year, said.month, said.day + 1), rule: "tomorrow" };
    else if (TODAY.test(quote)) due = { dueOn: saidOn, rule: "today" };
    else if (weekday) {
      let ahead = (WEEKDAYS.indexOf(weekday[2].toLowerCase()) - said.weekday + 7) % 7;
      // "Tuesday" said on a Tuesday is next week's, unless he is still up from the night before.
      if (ahead === 0 && hourET(saidAt) >= 5) ahead = 7;
      // "next Tuesday" said 1-3 days before a Tuesday is ambiguous; take the later one (asking late beats asking early).
      if (weekday[1] && ahead <= 3) ahead += 7;
      due = { dueOn: ymd(said.year, said.month, said.day + ahead), rule: "weekday" };
    }
    // A date before the day it was said ("by 10/25" on 11/1) is a reference, not a promise.
    if (due?.dueOn && due.dueOn >= saidOn) loops.push({ quote: quote.slice(0, 280), saidOn, dueOn: due.dueOn, rule: due.rule });
  }
  return loops;
}

function normalizeQuote(quote: string): string {
  return quote.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
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
  const refs = asked.map((r) => (r.evidenceRefs ?? {}) as { loopKey?: unknown; quote?: unknown });
  const askedKeys = new Set(refs.map((r) => r.loopKey));
  // The same promise written twice is one ask (and recordShown would hand back the old row).
  const askedQuotes = new Set(refs.map((r) => normalizeQuote(String(r.quote ?? ""))));

  const messages = await prisma.chatMessage.findMany({
    where: { role: "user", createdAt: { gte: new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS) } },
    select: { id: true, conversationId: true, content: true, createdAt: true },
    // Newest first, so the cap drops the oldest messages, never the freshest promises.
    orderBy: { createdAt: "desc" },
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
      if (askedQuotes.has(normalizeQuote(loop.quote))) return;
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

/**
 * Decide an ask's own row. Throws when the write fails: recordDecision folds a DB error into
 * false, and an outage must not read as "no such question".
 */
export async function answerOpenLoop(
  id: string,
  answer: OpenLoopAnswer,
): Promise<"recorded" | "already_answered" | "not_found"> {
  const row = await prisma.intelligenceOutcome.findFirst({
    where: { id, sourceEngine: SOURCE_ENGINE },
    select: { id: true, decision: true },
  });
  if (!row) return "not_found";
  if (row.decision) return "already_answered";
  const ok = await recordDecision({
    id,
    decision: answer === "done" ? "accepted" : "dismissed",
    resultRef: answer === "done" ? null : answer === "not_yet" ? "dismiss:timing" : "dismiss:alternative",
  });
  if (!ok) throw new Error("open-loop answer not recorded (ledger write failed)");
  return "recorded";
}
