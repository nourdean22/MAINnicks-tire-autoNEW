/**
 * lib/brain/decision-forecast.ts · brain W3 Socratic decision mode (2026-10-17)
 *
 * Turns a decision chat turn into a calibrated forecast:
 *   1. ASK   — a decision turn with no forecast stored for the conversation gets
 *              the DECISION_MODE_ASK block (lib/ai/prompt/policy/decision-mode.ts).
 *   2. STORE — Nour's reply to that ask, carrying a probability and a review date,
 *              is written once as MasteryDecision + DecisionReplay.
 *   3. SCORE — the review (markReplayed, the reviewDecisionReplay tool) computes
 *              Brier from the stored probability: decisionBrier().
 *
 * Where the probability lives: DecisionReplay has no probability field and no
 * JSON column, so it goes in MasteryDecision.predictedOutcome as "p=0.7" on the
 * decision the replay links to (decisionId), with reviewDate beside it. Brier is
 * not stored: it is a pure function of predictedOutcome and the replay's
 * outcomeScore, both durable. No schema change.
 *
 * Idempotency: the replay's idempotencyKey ("soc:<convId>:<hash of the ask and
 * the reply>") has a partial UNIQUE index (decision_replays_idempotency_key_uniq).
 * Both rows are created in one transaction, so a retried or doubled turn that
 * hits P2002 rolls its MasteryDecision back and writes nothing.
 *
 * shortcut: one forecast per conversation (a second decision in the same chat is
 * not asked); upgrade to a per-decision key if Nour runs several decisions in one chat.
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { buildResponseContract } from "@/lib/ai/response-contract";
import { classifyTurn } from "@/lib/ai/turn-intelligence";
import {
  DECISION_MODE_ASK,
  DECISION_STORE_FAILED,
  decisionMissingBlock,
  decisionStoredBlock,
} from "@/lib/ai/prompt/policy/decision-mode";
import { extractText } from "@/lib/ai/chat/gate";
import { brierScore } from "@/lib/brain/calibration";
import { getFlag } from "@/lib/feature-flags";
import { today } from "@/lib/utils/datetime";
import { logError } from "@/lib/utils/error-log";

const SKIP = /\bjust (answer|tell me|give me the answer)\b/i;
const DAY_MS = 86_400_000;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
/** A word that marks the number beside it as Nour's confidence, not a price or a rate. */
const CONFIDENCE_WORD = /\b(sure|confident|confidence|chance|probab\w*|likely|odds)\b/gi;
/** Ephemeral and failed-persist turns share these placeholder ids (route.ts persist-user-turn fallbacks). */
const PLACEHOLDER_CONV_IDS = new Set(["private", "temp"]);

/**
 * An explicit decision cue in Nour's own words. The turn label alone is too wide:
 * classifyTurn marks any message with "or " / "vs" / "either" as a decision
 * ("check the logs or the deploy"). Bare "do I", "which one", "go with" and
 * "pick between" were dropped in round 3: "what do I have on Monday", "which one
 * is cheaper" and "what size tires go with this rim" are questions, not decisions.
 */
const DECISION_CUE = /\b(should (i|we)|worth it|(decide|deciding) between|which should (i|we))\b/i;

/**
 * Ask-worthy decision turn: an explicit cue, and the turn's own contract (the
 * same one the chat route builds: text + classifyTurn) either labels it
 * "decision" or left it at the default "direct_answer". The default is allowed
 * because "is it worth it" or "I'm deciding between" carry no decision label
 * today; any MORE specific mode (brainstorm, audit, ranked list, correction, a
 * coder prompt...) wins and gets no ask. A finalized decision ("just do it",
 * "my decision is final") is never re-opened.
 */
function isDecisionTurn(text: string): boolean {
  if (!DECISION_CUE.test(text)) return false;
  const c = buildResponseContract(text, classifyTurn(text));
  // shouldAskClarifying is false when Nour said "don't ask": the ask would contradict the contract.
  return (c.answerMode === "decision" || c.answerMode === "direct_answer") && c.shouldAskClarifying && !c.executeFinalized;
}

const toProbability = (raw: string, percent: boolean): number | null => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (percent) return n >= 0 && n <= 100 ? n / 100 : null;
  return n >= 0 && n <= 1 ? n : n <= 100 ? n / 100 : null;
};

/**
 * Nour's probability. Of several "N%" in the message, the one nearest a
 * confidence word (sure, confident, chance, probability, likely, odds), else the
 * LAST one: "raise prices 5% or hold. 70% hold works" is 0.7, not 0.05. A bare
 * "0.7" or "70" counts only right after a confidence word ("chance 0.7"); "p=0.7"
 * counts anywhere. Out of range or absent -> null.
 */
export function parseProbability(text: string): number | null {
  const words = [...text.matchAll(CONFIDENCE_WORD)].map((w) => ({ start: w.index ?? 0, end: (w.index ?? 0) + w[0].length }));
  const pcts = [...text.matchAll(/(?<![\d.])(\d{1,3}(?:\.\d+)?)\s?%/g)];
  if (pcts.length > 0) {
    let pick = pcts[pcts.length - 1];
    if (words.length > 0) {
      const dist = (m: RegExpMatchArray) => {
        const s = m.index ?? 0;
        const e = s + m[0].length;
        return Math.min(...words.map((w) => (w.start >= e ? w.start - e : s >= w.end ? s - w.end : 0)));
      };
      pick = pcts.reduce((best, m) => (dist(m) < dist(best) ? m : best));
    }
    return toProbability(pick[1], true);
  }
  const after = text.match(/\b(?:sure|confident|confidence|chance|probab\w*|likely|odds)\b(?:\s+(?:is|are|of|at|about|around|=))?[\s:]*(\d{1,3}(?:\.\d+)?)\b(?!\s?%|\/)/i);
  if (after) return toProbability(after[1], false);
  const p = text.match(/\bp\s*=\s*(\d(?:\.\d+)?)\b/i);
  return p ? toProbability(p[1], false) : null;
}

const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Calendar date from parts; null when it does not exist or is in the past. A year-less date takes its next occurrence. */
function calendarDate(month: number, day: number, year: number | null, base: number): string | null {
  const years = year !== null ? [year] : [new Date(base).getUTCFullYear(), new Date(base).getUTCFullYear() + 1];
  for (const y of years) {
    const ms = Date.UTC(y, month, day);
    const d = new Date(ms);
    if (month < 0 || month > 11 || d.getUTCMonth() !== month || d.getUTCDate() !== day) return null;
    if (ms >= base) return isoOf(ms);
  }
  return null;
}

const yearOf = (raw: string | undefined) => (raw ? (raw.length === 2 ? 2000 + Number(raw) : Number(raw)) : null);

/**
 * The review date: ISO, "Dec 1st" / "December 1, 2027", "1 Dec", "12/1" (M/D,
 * optional /YYYY), or "in N days|weeks|months" unless that follows a payment
 * word (net, terms, invoice, due: "invoice due in 30 days" is not a review
 * date). An explicit year is honoured; a past date or none -> null.
 */
export function parseReviewDate(text: string, todayIso: string = today()): string | null {
  const base = Date.parse(`${todayIso}T00:00:00Z`);
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return calendarDate(Number(iso[2]) - 1, Number(iso[3]), Number(iso[1]), base);
  const md = text.match(new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(20\\d{2})\\b)?`, "i"));
  if (md) return calendarDate(MONTHS.indexOf(md[1].slice(0, 3).toLowerCase()), Number(md[2]), yearOf(md[3]), base);
  const dm = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\b\\.?(?:,?\\s+(20\\d{2})\\b)?`, "i"));
  if (dm) return calendarDate(MONTHS.indexOf(dm[2].slice(0, 3).toLowerCase()), Number(dm[1]), yearOf(dm[3]), base);
  const slash = text.match(/(?<![\d/.])(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?(?![\d/])/);
  if (slash) return calendarDate(Number(slash[1]) - 1, Number(slash[2]), yearOf(slash[3]), base);
  for (const rel of text.matchAll(/\bin\s+(\d{1,3})\s+(day|week|month)s?\b/gi)) {
    const before = text.slice(Math.max(0, (rel.index ?? 0) - 24), rel.index ?? 0);
    if (/\b(net|terms|invoice|due)\W*$/i.test(before)) continue;
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    if (unit === "month") {
      const d = new Date(base);
      d.setUTCMonth(d.getUTCMonth() + n);
      return isoOf(d.getTime());
    }
    return isoOf(base + n * (unit === "week" ? 7 : 1) * DAY_MS);
  }
  return null;
}

type Turn = { role: string; content: string };

export type DecisionTurnPlan =
  | { kind: "none" }
  | { kind: "skip" }
  | { kind: "ask" }
  | { kind: "partial"; missing: Array<"probability" | "review date"> }
  | { kind: "store"; decision: string; ask: string; reply: string; probability: number; reviewDate: string };

/**
 * Pure: what this turn should do. `messages` is the history the chat route
 * hands buildBrainContext: v6 UIMessages with `parts` in production, legacy
 * `{ role, content }` in older callers. Text comes out through gate.ts
 * extractText (both shapes). The history ends with the current user turn;
 * that tail is dropped before reading it.
 */
export function planDecisionTurn(input: {
  userContent: string;
  messages: ReadonlyArray<unknown>;
  todayIso?: string;
}): DecisionTurnPlan {
  const { userContent } = input;
  const turns: Turn[] = input.messages
    .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
    .map((m) => ({ role: String(m.role ?? ""), content: extractText(m) }))
    .filter((t) => t.content);
  const last = turns[turns.length - 1];
  if (last && last.role === "user" && last.content === userContent) turns.pop();

  // The ask, if one was made, sits in the last assistant turn; the decision is the user turn before it.
  let a = turns.length - 1;
  while (a >= 0 && turns[a].role !== "assistant") a--;
  let u = a - 1;
  while (u >= 0 && turns[u].role !== "user") u--;
  const replyToAsk = a >= 0 && u >= 0 && isDecisionTurn(turns[u].content);
  const decisionNow = isDecisionTurn(userContent);

  const skipNow = SKIP.test(userContent);
  const skipped = skipNow || turns.some((t) => t.role === "user" && SKIP.test(t.content));
  // decisionSkip counts only on a decision exchange: a decision turn, or the reply to the ask.
  // The skip phrase itself reads as executeFinalized, so judge the turn without it.
  const decisionApartFromSkip = skipNow ? isDecisionTurn(userContent.replace(new RegExp(SKIP.source, "gi"), " ")) : decisionNow;
  if (skipped) return decisionApartFromSkip || (replyToAsk && skipNow) ? { kind: "skip" } : { kind: "none" };

  if (replyToAsk) {
    const probability = parseProbability(userContent);
    const reviewDate = parseReviewDate(userContent, input.todayIso);
    if (probability !== null && reviewDate) {
      return { kind: "store", decision: turns[u].content, ask: turns[a].content, reply: userContent, probability, reviewDate };
    }
    if (probability !== null || reviewDate) {
      return { kind: "partial", missing: probability === null ? ["probability"] : ["review date"] };
    }
  }
  return decisionNow ? { kind: "ask" } : { kind: "none" };
}

export interface DecisionTurnResult {
  /** System-prompt block for this turn; "" when none. */
  block: string;
  /** Persisted into ChatMessage.tokenUsage.contextBlocks (the kill-criterion metric). */
  fired: {
    decisionAsk?: true;
    decisionSkip?: true;
    decisionPartial?: true;
    decisionStored?: true;
    decisionStoreFailed?: true;
  };
}

const NOTHING: DecisionTurnResult = { block: "", fired: {} };
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 3)}...`);
const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === "P2002";

async function storeForecast(
  plan: Extract<DecisionTurnPlan, { kind: "store" }>,
  idempotencyKey: string,
): Promise<"stored" | "already" | "failed"> {
  const title = clip(plan.decision.replace(/\s+/g, " ").trim(), 200);
  try {
    const replay = await prisma.$transaction(async (tx) => {
      const decision = await tx.masteryDecision.create({
        data: {
          date: today(),
          title,
          context: plan.decision,
          chosen: clip(plan.reply, 2000),
          predictedOutcome: `p=${plan.probability}`,
          reviewDate: plan.reviewDate,
          createdBy: "nick_socratic",
          updatedBy: "nick_socratic",
        },
        select: { id: true },
      });
      return tx.decisionReplay.create({
        data: {
          decisionId: decision.id,
          title,
          context: plan.decision,
          choiceMade: clip(plan.reply, 2000),
          reviewAt: new Date(`${plan.reviewDate}T12:00:00Z`),
          idempotencyKey,
        },
        select: { id: true },
      });
    });
    // Same enrich/embed fan-out journalDecision runs for its replay stub; best effort.
    void import("@/lib/brain/journal-fanout")
      .then((m) => m.dispatchJournalFanout("decision_replay", replay.id))
      .catch(() => {});
    return "stored";
  } catch (err) {
    if (isUniqueViolation(err)) return "already";
    logError("brain.decision-forecast", err, { fn: "storeForecast" }, "warn");
    return "failed";
  }
}

/**
 * The chat-turn entry point (called from buildBrainContext). Never throws.
 * No real conversation (Private Lab: no convId; ephemeral or failed-persist
 * turns: the shared "private" / "temp" placeholders) means no ask and no write:
 * a probability asked for there could never be stored against this chat.
 */
export async function runDecisionTurn(input: {
  convId?: string;
  userContent: string;
  messages: ReadonlyArray<unknown>;
  todayIso?: string;
}): Promise<DecisionTurnResult> {
  // Kill switch (default ON). Off: no ask, no store; stored forecasts still score at review.
  if (!getFlag("NICK_DECISION_MODE")?.isOn) return NOTHING;
  if (!input.convId || PLACEHOLDER_CONV_IDS.has(input.convId)) return NOTHING;
  const plan = planDecisionTurn(input);
  if (plan.kind === "none") return NOTHING;
  if (plan.kind === "skip") return { block: "", fired: { decisionSkip: true } };

  const prefix = `soc:${input.convId.slice(0, 40)}:`;
  // A failed read is UNKNOWN, not "nothing stored": proceed, and let the unique key guard the write.
  const existing = await prisma.decisionReplay
    .findFirst({ where: { idempotencyKey: { startsWith: prefix } }, select: { idempotencyKey: true } })
    .catch((err) => {
      logError("brain.decision-forecast", err, { fn: "runDecisionTurn.findFirst" }, "warn");
      return null;
    });

  if (plan.kind === "ask") return existing ? NOTHING : { block: DECISION_MODE_ASK, fired: { decisionAsk: true } };
  if (plan.kind === "partial") {
    return existing ? NOTHING : { block: decisionMissingBlock(plan.missing), fired: { decisionPartial: true } };
  }

  const key = prefix + createHash("sha256").update(`${plan.ask}\n${plan.reply}`).digest("hex").slice(0, 16);
  if (existing && existing.idempotencyKey !== key) return NOTHING;
  const outcome = existing ? "already" : await storeForecast(plan, key);
  if (outcome === "failed") return { block: DECISION_STORE_FAILED, fired: { decisionStoreFailed: true } };
  return { block: decisionStoredBlock(plan.probability, plan.reviewDate), fired: { decisionStored: true } };
}

/** "p=0.7" (written by storeForecast) -> 0.7. Any other text -> null. */
export function forecastProbability(predictedOutcome: string | null | undefined): number | null {
  const m = predictedOutcome?.match(/^p=(\d(?:\.\d+)?)$/);
  if (!m) return null;
  const p = Number(m[1]);
  return p >= 0 && p <= 1 ? p : null;
}

/**
 * Brier at review. outcomeScore is the replay's -10..10 scale (the tutor taps
 * write Worked 5, Mixed 0, Didn't -5): above 0 -> worked (1), 0 -> mixed (0.5),
 * below 0 -> didn't (0). No probability or no outcome -> null, never 0.
 */
export function decisionBrier(
  predictedOutcome: string | null | undefined,
  outcomeScore: number | null | undefined,
): number | null {
  const p = forecastProbability(predictedOutcome);
  if (p === null || typeof outcomeScore !== "number" || !Number.isFinite(outcomeScore)) return null;
  return brierScore(p, outcomeScore > 0 ? 1 : outcomeScore < 0 ? 0 : 0.5);
}
