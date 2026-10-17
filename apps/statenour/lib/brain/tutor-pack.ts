/**
 * Daily Tutor (brain W2, 2026-10-16). One Telegram item per ET day, sent in
 * the morning hour right after the morning push, answered with ONE TAP.
 *
 * Why one tap: W0 measured 89 pushes and briefs shown since 09-18, 0 decided,
 * 2 rated; 29 decision replays, 0 ever reviewed, 9 overdue. Anything that
 * costs more than a tap has a base rate of zero here.
 *
 * Priority: an overdue decision review (DecisionReplay reviewAt <= now,
 * reviewed=false, oldest first) beats a retrieval question built from a
 * `wisdom` memory. Retrieval beats re-reading; a scored decision beats
 * journaling (Harvard RCT 2025).
 *
 * Recall is free recall first (deep scout v2 item 9, 2026-10-17): multiple
 * choice measures recognition, FSRS rates recall. Step 1 asks for the principle
 * unaided: "I have it" (K) reveals it for a self-grade (R / X, unaided),
 * "Show options" (H) sends the 3 options (A/B/C, hinted). K and H write nothing.
 * resultRef carries the marker (`tutor:R:unaided`, `tutor:B:hint`). A hinted
 * answer schedules as a miss; the ledger's `useful` stays "answered correctly".
 * Limits: H then "I have it" can still record :unaided (H writes nothing by
 * design and the grade is self-reported); "write nothing" means no ledger, memory
 * or schedule write, since the webhook's ActionReceipt and update-claim rows are
 * written for every callback.
 *
 * The tap lands in the outcome ledger (kind "suggestion", sourceEngine
 * "tutor:recall" | "tutor:decision"), so the 14-day kill criterion is readable
 * from the ledger alone: shown vs decided vs outcomeUseful per sourceEngine.
 *
 * Pure composition (composeTutorItem, renderTutorMessage) is separated from
 * I/O (fireTutorPush, handleTutorAnswer) so tests stub prisma the way
 * tests/brain/proactive-pushes.test.ts does.
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { tagMungerDisciplines } from "@/lib/brain/wisdom-distiller";
import { brainMemory } from "@/lib/brain/memory-manager";
import { recordDecision, recordOutcomeResult, recordShown } from "@/lib/services/outcome-ledger";
import { markReplayed } from "@/lib/services/decision-replay-coach";
import type { InlineButton } from "@/lib/services/telegram";
import { escapeHtml } from "@/lib/utils/escape-html";
import { logError } from "@/lib/utils/error-log";
import { fsrsStateProblem, learnReviewRow, nextReview, ratingFor, readFsrsState, type FsrsState, type ReviewRating } from "@/lib/brain/fsrs-schedule";
import { logger as rootLogger } from "@/lib/logger";
import { today } from "@/lib/utils/datetime";
import {
  alreadyPushed,
  sendClaimed,
  type PushPreview,
  type PushResult,
  type PushSource,
} from "@/lib/brain/proactive-pushes";

const log = rootLogger.withSurface("brain.tutor-pack");

export type TutorItem =
  | {
      kind: "recall";
      memoryId: string;
      topic: string;
      options: [string, string, string];
      correct: "A" | "B" | "C";
    }
  | {
      kind: "decision";
      replayId: string;
      decisionId: number;
      title: string;
      date: string;
      chosen: string;
      reviewAt: Date;
    };

const DAY_MS = 86_400_000;
const RECALL_WINDOW_MS = 30 * DAY_MS;
/** Same category and content fields as components/actions/mode-learn.tsx, which lists these rows as due cards. */
const SPACED_REVIEW_CATEGORY = "spaced_review";
// K/H are read-only steps; R/X grade unaided; A/B/C grade hinted (also a pre-scout message's buttons).
const RECALL_CHOICES = new Set(["A", "B", "C", "S", "K", "H", "R", "X"]);
const UNAIDED = new Set(["R", "X"]);
const DECISION_CHOICES = new Set(["W", "M", "D", "N", "S"]);
const DECISION_LABELS: Record<string, { label: string; score: number }> = {
  W: { label: "Worked", score: 5 },
  M: { label: "Mixed", score: 0 },
  D: { label: "Didn't", score: -5 },
};

const et = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const clip = (raw: string, max: number) => {
  const s = raw.replace(/\s+/g, " ").trim();
  return s.length <= max ? s : `${s.slice(0, max - 3).trimEnd()}...`;
};
const hashOf = (s: string) => [...s].reduce((n, c) => n + c.charCodeAt(0), 0);
const rotate = <T,>(xs: T[], by: number): T[] => (xs.length ? [...xs.slice(by % xs.length), ...xs.slice(0, by % xs.length)] : xs);

type SpacedReview = {
  topic: string;
  summary: string;
  reviewAt: string;
  interval: number;
  completed: boolean;
  memoryId: string;
  /** FSRS card state (lib/brain/fsrs-schedule.ts). Legacy rows carry a `streak` instead and start as a new card. */
  fsrs: FsrsState;
};

function parseSpaced(content: string): Partial<SpacedReview> | null {
  try {
    const v = JSON.parse(content) as unknown;
    return v && typeof v === "object" ? (v as Partial<SpacedReview>) : null;
  } catch {
    return null;
  }
}

async function pickOverdueDecision(now: Date): Promise<TutorItem | null> {
  // Rows without a decisionId (journal-derived) cannot be closed by markReplayed: skip them.
  const rows = await prisma.decisionReplay.findMany({
    where: { reviewed: false, reviewAt: { lte: now }, decisionId: { not: null } },
    orderBy: { reviewAt: "asc" },
    select: { id: true, decisionId: true, title: true, choiceMade: true, reviewAt: true, createdAt: true },
    take: 10,
  });
  // A replay whose MasteryDecision was deleted can never be closed (markReplayed returns ok:false):
  // asking it every day would starve recall forever.
  const ids = rows.map((r) => r.decisionId).filter((v): v is number => v !== null);
  const live = ids.length
    ? new Set((await prisma.masteryDecision.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((d) => d.id))
    : new Set<number>();
  const row = rows.find((r) => r.decisionId !== null && live.has(r.decisionId));
  if (!row || row.decisionId === null) return null;
  return {
    kind: "decision",
    replayId: row.id,
    decisionId: row.decisionId,
    title: row.title,
    date: et(row.createdAt),
    chosen: row.choiceMade,
    reviewAt: row.reviewAt,
  };
}

/** One derivation for the topic, so step 1 and the Show options message name the same one. */
function topicOf(content: string): string {
  const discipline = tagMungerDisciplines(content)[0];
  return discipline === "uncategorized" ? "your work" : discipline.replace("-", " ");
}

async function pickRecall(now: Date): Promise<TutorItem | null> {
  const [asked, spaced, wisdom] = await Promise.all([
    prisma.intelligenceOutcome.findMany({
      where: { sourceEngine: "tutor:recall", shownAt: { gte: new Date(now.getTime() - RECALL_WINDOW_MS) } },
      select: { evidenceRefs: true },
      take: 200,
    }),
    prisma.brainMemory.findMany({
      where: { category: SPACED_REVIEW_CATEGORY, key: { startsWith: "tutor_" }, deletedAt: null },
      select: { key: true, content: true },
      take: 200,
    }),
    prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.WISDOM, deletedAt: null },
      select: { id: true, content: true },
      orderBy: { createdAt: "desc" },
      take: 400, // 281 live rows (2026-10-16); a due row for an older wisdom must still be found
    }),
  ]);
  if (wisdom.length < 3) return null;

  const askedIds = new Set(
    asked.map((r) => (r.evidenceRefs as { memoryId?: unknown } | null)?.memoryId).filter((v): v is string => typeof v === "string"),
  );
  // A due spaced_review row re-asks its wisdom even inside the 30-day window:
  // that is how the FSRS due dates come true.
  const due = spaced
    .map((r) => parseSpaced(r.content))
    .filter((p): p is Partial<SpacedReview> => !!p && !p.completed && typeof p.memoryId === "string" && typeof p.reviewAt === "string")
    .filter((p) => new Date(p.reviewAt as string).getTime() <= now.getTime())
    .sort((a, b) => new Date(a.reviewAt as string).getTime() - new Date(b.reviewAt as string).getTime())
    .map((p) => p.memoryId as string);
  const byId = new Map(wisdom.map((w) => [w.id, w]));
  const target = due.map((id) => byId.get(id)).find((w) => !!w) ?? wisdom.find((w) => !askedIds.has(w.id));
  if (!target) return null;

  // Distractors from a different discipline make the choice a real test, not a guess.
  // Rotated by the target id so each wisdom gets its own pair, not the two newest rows every day;
  // the ET date is mixed in so a re-asked wisdom does not keep its letter (memorising "B" is not recall).
  const discipline = tagMungerDisciplines(target.content)[0];
  const seed = hashOf(`${target.id}:${et(now)}`);
  const others = wisdom.filter((w) => w.id !== target.id && w.content !== target.content);
  const foreign = others.filter((w) => tagMungerDisciplines(w.content)[0] !== discipline);
  const same = others.filter((w) => !foreign.includes(w));
  const distractors = [...rotate(foreign, seed), ...rotate(same, seed)].slice(0, 2);
  if (distractors.length < 2) return null;

  // Deterministic correct position from id + date, so the answer is not always A.
  const pos = seed % 3;
  const options = [distractors[0].content, distractors[1].content] as string[];
  options.splice(pos, 0, target.content);
  return {
    kind: "recall",
    memoryId: target.id,
    topic: topicOf(target.content),
    options: options as [string, string, string],
    correct: "ABC"[pos] as "A" | "B" | "C",
  };
}

/**
 * Priority: overdue decision review, else a recall question, else null (silent day).
 * A failed read is logged and flagged `readFailed`, so the slot reports "read_failed",
 * never "nothing_eligible": an empty day and a broken read are different answers.
 */
async function composeWithStatus(now: Date): Promise<{ item: TutorItem | null; readFailed: boolean }> {
  let readFailed = false;
  const failed = (fn: string) => (err: unknown) => {
    readFailed = true;
    logError("brain.tutor-pack", err, { fn }, "warn");
    return null;
  };
  const item =
    (await pickOverdueDecision(now).catch(failed("pickOverdueDecision"))) ?? (await pickRecall(now).catch(failed("pickRecall")));
  return { item, readFailed: !item && readFailed };
}

export async function composeTutorItem(now: Date = new Date()): Promise<TutorItem | null> {
  return (await composeWithStatus(now)).item;
}

const tutorButton = (ledgerId: string) => (text: string, choice: string): InlineButton => ({ text, callback_data: `tut:${ledgerId}:${choice}` });

/** Step 2 of a recall item: K reveals the principle for a self-grade, H shows the 3 options. */
function renderRecallStep(step: "K" | "H", ledgerId: string, options: string[], answer: string): TutorNext {
  const btn = tutorButton(ledgerId);
  if (step === "K") {
    return {
      text: `Daily Tutor. The principle:\n\n${escapeHtml(clip(answer, 120))}\n\nDid you have it?`,
      buttons: [[btn("Got it", "R"), btn("Missed it", "X")]],
    };
  }
  const lines = options.map((o, i) => `${"ABC"[i]}. ${escapeHtml(clip(o, 120))}`);
  return {
    text: `Daily Tutor. Which of these is the principle you distilled about ${escapeHtml(topicOf(answer))}?\n\n${lines.join("\n")}`,
    buttons: [[btn("A", "A"), btn("B", "B"), btn("C", "C")]],
  };
}

export type TutorNext = { text: string; buttons: InlineButton[][] };

/** Nour's voice: direct, calm, no emojis, no exclamation marks. HTML parse mode, so escape. */
export function renderTutorMessage(item: TutorItem, ledgerId: string): { text: string; buttons: InlineButton[][] } {
  const btn = tutorButton(ledgerId);
  if (item.kind === "recall") {
    return {
      text: `Daily Tutor. Recall the principle you distilled about ${escapeHtml(item.topic)}, then tap.`,
      buttons: [[btn("I have it", "K"), btn("Show options", "H"), btn("Skip", "S")]],
    };
  }
  return {
    text: `Decision review. ${escapeHtml(clip(item.title, 200))} (${item.date}). You chose: ${escapeHtml(clip(item.chosen, 120))}. How did it go?`,
    buttons: [[btn("Worked", "W"), btn("Mixed", "M"), btn("Didn't", "D"), btn("Not yet", "N"), btn("Skip", "S")]],
  };
}

function evidenceFor(item: TutorItem): Record<string, unknown> {
  return item.kind === "recall"
    ? { correct: item.correct, memoryId: item.memoryId, options: item.options }
    : { decisionId: item.decisionId, replayId: item.replayId, reviewAt: item.reviewAt.toISOString(), options: ["W", "M", "D", "N", "S"] };
}

/**
 * Tutor slot. Same claim-before-act marker as the other slots (slot "tutor").
 * Unlike sendRatablePush there is NO plain-text fallback: an item without a
 * ledger id cannot be graded, so nothing is sent and the claim is released.
 */
export async function fireTutorPush(options?: { dryRun?: boolean; now?: Date }): Promise<PushResult | PushPreview> {
  const now = options?.now ?? new Date();
  const dateKey = options?.now ? et(options.now) : today();
  const etHour = parseInt(now.toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: "America/New_York" }), 10);
  const quietHoursBlocked = etHour >= 0 && etHour <= 5;

  const isDup = await alreadyPushed("tutor", dateKey);
  // Live ticks after the send (the morning hour spans 6-11 ET) skip the compose reads; a preview still shows the text.
  const { item, readFailed } = isDup && !options?.dryRun ? { item: null, readFailed: false } : await composeWithStatus(now);
  const skipReason = isDup
    ? "already_pushed_today"
    : quietHoursBlocked
      ? "quiet_hours_overnight"
      : !item
        ? readFailed
          ? "read_failed"
          : "nothing_eligible"
        : "";

  if (options?.dryRun) {
    const text = item ? renderTutorMessage(item, "preview").text : undefined;
    const riskFlags = ["preview_only", "live_send_disabled"];
    if (isDup) riskFlags.push("already_sent_today");
    if (!item) riskFlags.push("empty_message");
    if (quietHoursBlocked) riskFlags.push("quiet_hours_overnight");
    const sources: PushSource[] = item
      ? [
          item.kind === "recall"
            ? { id: item.memoryId, category: "system_context", title: "Wisdom recall", summary: `Free recall on a wisdom row, 3 options on request (${item.topic})`, confidence: "high", reason: "Not asked in 30 days, or its spaced review is due." }
            : { id: item.replayId, category: "system_context", title: "Overdue decision review", summary: `${item.title} (${item.date})`, confidence: "high", reason: "DecisionReplay reviewAt passed and reviewed=false.", href: "/journal" },
        ]
      : readFailed
        ? [{ category: "system_context", title: "Read failed", summary: "A tutor picker read threw; state unknown, not empty.", confidence: "low", reason: "See error_logs brain.tutor-pack." }]
        : [{ category: "system_context", title: "Nothing eligible", summary: "No overdue decision and no unasked wisdom.", confidence: "medium", reason: "Silent day by design." }];
    return {
      kind: "preview",
      slot: "tutor",
      nowIso: now.toISOString(),
      timezone: "America/New_York",
      dryRun: true,
      wouldSend: !skipReason,
      wouldSkip: !!skipReason,
      reason: skipReason || "eligible",
      messageText: text,
      messagePreviewSafe: text,
      dedupKey: `tutor_${dateKey}`,
      dedupBlocked: isDup,
      quietHoursBlocked,
      rateLimitBlocked: false,
      sourceFunction: "fireTutorPush",
      riskFlags,
      nextSafeStep: "Verify the question reads as one or two taps.",
      sources,
    };
  }

  if (skipReason || !item) return { kind: "live", slot: "tutor", fired: false, reason: skipReason || "nothing_eligible" };

  let failReason: string | null = null;
  const { fired, reason } = await sendClaimed("tutor", dateKey, async () => {
    const ledgerId = await recordShown({
      kind: "suggestion",
      sourceEngine: `tutor:${item.kind}`,
      summary: `${dateKey} tutor ${item.kind} ${item.kind === "recall" ? item.memoryId : item.replayId}: ${item.kind === "recall" ? item.options[("ABC".indexOf(item.correct))] : item.title}`,
      shownSurface: "telegram",
      evidenceRefs: evidenceFor(item),
    }).catch((err) => {
      logError("brain.tutor-pack", err, { fn: "fireTutorPush.recordShown" }, "warn");
      return null;
    });
    if (!ledgerId) {
      failReason = "ledger_unavailable";
      return false;
    }
    const { text, buttons } = renderTutorMessage(item, ledgerId);
    const { sendTelegramWithButtons } = await import("@/lib/services/telegram");
    const res = await sendTelegramWithButtons(text, buttons).catch((err) => {
      logError("brain.tutor-pack", err, { fn: "fireTutorPush.send", ledgerId });
      return { ok: false };
    });
    return res.ok;
  });
  // No `text` on a live result: it is logged by proactive-push.ts and stored as Inngest step output,
  // and decision and wisdom text is private. The preview path above is where the text is read.
  return { kind: "live", slot: "tutor", fired, reason: failReason ?? reason };
}

function readSpaced(key: string) {
  return prisma.brainMemory.findUnique({
    where: { category_key: { category: SPACED_REVIEW_CATEGORY, key } },
    select: { id: true, content: true, deletedAt: true, supersededById: true },
  });
}

export type SpacedGradeResult =
  | { status: "graded"; due: string; days: number }
  | { status: "cleared" }
  | { status: "missing" }
  | { status: "lost" }
  | { status: "unreadable" };

/** Content fields a card is built from: they seed a new row, or fill a field the stored row lacks. */
type SpacedSeed = { topic: string; summary: string; memoryId: string };

/** The schedule one review writes, for a new tutor card and a graded row alike. */
function scheduledFields(prevFsrs: unknown, rating: ReviewRating, now: Date) {
  // A legacy row (streak, no fsrs) or an unreadable state starts as a new card.
  const review = nextReview(readFsrsState(prevFsrs), rating, now);
  return {
    fields: { reviewAt: review.due.toISOString(), interval: review.state.scheduled_days, completed: false, fsrs: review.state },
    days: Math.round((review.due.getTime() - now.getTime()) / DAY_MS),
  };
}

/**
 * Grade one existing spaced_review row by key: the one writer of an existing row's
 * schedule, shared by the Daily Tutor below and the Learn tab's "Got it"
 * (brain.gradeSpacedReview). Compare-and-swap on the row's previous content with
 * deletedAt: null, never an update by id. Schedule fields only (reviewAt, interval,
 * completed, fsrs): topic, summary and memoryId stay as the row has them, and deletedAt
 * is never in the data. A cleared (soft-deleted) card stays cleared. Only "graded"
 * carries a date, because only then was it written.
 */
export async function gradeSpacedReview(key: string, rating: ReviewRating, now: Date, seed?: SpacedSeed): Promise<SpacedGradeResult> {
  const existing = await readSpaced(key);
  if (!existing) return { status: "missing" };
  if (existing.deletedAt) return { status: "cleared" };
  const prev = parseSpaced(existing.content);
  if (!prev && !seed) return { status: "unreadable" };
  const kept: Record<string, unknown> = { ...prev };
  delete kept.streak; // the legacy ladder's streak: FSRS state replaces it
  // A stored state that cannot be scheduled resets to a new card: say so once, never silently.
  const problem = prev && "fsrs" in prev ? fsrsStateProblem(prev.fsrs) : null;
  if (problem) log.info("spaced_review_fsrs_reset", { key, reason: problem });
  const { fields, days } = scheduledFields(prev?.fsrs, rating, now);
  const res = await prisma.brainMemory.updateMany({
    where: { id: existing.id, category: SPACED_REVIEW_CATEGORY, key, content: existing.content, deletedAt: null },
    data: { content: JSON.stringify({ ...seed, ...kept, ...fields }), lastSeen: now, expiresAt: null },
  });
  if (res.count !== 1) return { status: "lost" };
  return { status: "graded", due: fields.reviewAt, days };
}

export type EnsureLearnCardResult =
  | { status: "created" }
  | { status: "kept" }
  | { status: "legacy" }
  | { status: "reset" }
  | { status: "lost" };

const isUniqueViolation = (err: unknown) => !!err && typeof err === "object" && (err as { code?: string }).code === "P2002";

/**
 * The Learn tab's "learned it" write (brain.ensureLearnCard): make sure the topic has a
 * card without resetting one it already has. The key is learnReviewRow's, so it is the
 * row Learn has always used (the old ladder's rows were review_<topic>_d1/_d3/_d7/_d30).
 *  - no row: a new card (due +1 day) through brainMemory.remember, so admission applies;
 *    a concurrent first learn loses remember()'s create (P2002), re-reads the row, is `kept`;
 *  - soft-deleted or superseded row: a new card in its place, never the old state. One
 *    compare-and-swap pinned to the tombstone and supersededById read, which also clears
 *    both and validUntil, so the card is live again and shows in the Learn list;
 *  - live row with a readable fsrs state: schedule untouched; topic and summary refresh,
 *    compare-and-swap on the content read, so a grade landing in between wins;
 *  - live row with an `fsrs` key it cannot schedule, or content that is not JSON: reset to
 *    a new card (compare-and-swap on the content read) with one info line, as
 *    gradeSpacedReview does, so a corrupt row is repaired, not skipped (`reset`);
 *  - live JSON object with no `fsrs` key: untouched, nothing else written (`legacy`).
 * "lost" = a swap failed and nothing was written. No result carries a date.
 * Stated decisions: a revive does not restore the embedding the forget dropped (no
 * spaced_review consumer reads it), and re-learning a topic revives a card Nour forgot in
 * the inspector (learning it again is the instruction to schedule it again).
 * shortcut: two topics sharing their first 40 characters share a key (learnReviewRow), so
 * the later one refreshes the earlier one's card; the key format stays or existing cards orphan.
 */
export async function ensureLearnCard(topic: string, summary: string, now: Date): Promise<EnsureLearnCardResult> {
  const row = learnReviewRow(topic, summary, now);
  const existing = await readSpaced(row.key);
  if (!existing) {
    try {
      await brainMemory.remember(SPACED_REVIEW_CATEGORY, row.key, row.content, "learn_mode");
      return { status: "created" };
    } catch (err) {
      // A concurrent first learn won remember()'s create: its card is there, so this one is kept.
      if (!isUniqueViolation(err) || !(await readSpaced(row.key))) throw err;
      return { status: "kept" };
    }
  }
  // Compare-and-swap on the row as read: every field the decision used is in the WHERE.
  const swap = async (pinned: Record<string, unknown>, data: Record<string, unknown>) => {
    const where = { id: existing.id, category: SPACED_REVIEW_CATEGORY, key: row.key, content: existing.content, ...pinned };
    return (await prisma.brainMemory.updateMany({ where, data })).count === 1;
  };
  if (existing.deletedAt || existing.supersededById) {
    const won = await swap(
      { deletedAt: existing.deletedAt, supersededById: existing.supersededById },
      { content: row.content, deletedAt: null, supersededById: null, validUntil: null, lastSeen: now, expiresAt: null },
    );
    return won ? { status: "created" } : { status: "lost" };
  }
  const prev = parseSpaced(existing.content);
  if (prev && !("fsrs" in prev)) return { status: "legacy" };
  if (!prev || !readFsrsState(prev.fsrs)) {
    log.info("spaced_review_fsrs_reset", { key: row.key, reason: prev ? fsrsStateProblem(prev.fsrs) : "content is not JSON" });
    const won = await swap({ deletedAt: null, supersededById: null }, { content: row.content, lastSeen: now, expiresAt: null });
    return won ? { status: "reset" } : { status: "lost" };
  }
  const won = await swap(
    { deletedAt: null, supersededById: null },
    { content: JSON.stringify({ ...prev, topic, summary: summary.slice(0, 300) }), lastSeen: now },
  );
  return won ? { status: "kept" } : { status: "lost" };
}

/**
 * The tutor's schedule write: grade the existing row through gradeSpacedReview, or create
 * a new card when there is none. Returns "cleared" without writing when the card was
 * removed in Learn. Throws when the schedule was not written, so the reply never claims a
 * "Next ask in N days" that does not exist. Otherwise returns the whole days to the FSRS
 * due date, which the reply quotes.
 */
async function scheduleSpacedReview(
  memoryId: string,
  topic: string,
  summary: string,
  unaided: boolean,
  correct: boolean,
  now: Date,
): Promise<number | "cleared"> {
  const key = `tutor_${memoryId}`;
  const rating = ratingFor(unaided, correct);
  const seed: SpacedSeed = { topic, summary: clip(summary, 300), memoryId };
  const graded = await gradeSpacedReview(key, rating, now, seed);
  if (graded.status === "cleared") return "cleared";
  if (graded.status === "graded") return graded.days;
  if (graded.status !== "missing") throw new Error(`spaced_review ${graded.status}`);
  const { fields, days } = scheduledFields(undefined, rating, now);
  await brainMemory.remember(SPACED_REVIEW_CATEGORY, key, JSON.stringify({ ...seed, ...fields }), "tutor", { memoryId });
  // remember() gives spaced_review no TTL since 2026-10-17 (ONE_SHOT_RECORD_CATEGORIES +
  // category-ttl); this clear predates that and stays as a harmless second guard.
  await prisma.brainMemory.updateMany({ where: { category: SPACED_REVIEW_CATEGORY, key }, data: { expiresAt: null } });
  return days;
}

/** Skip on a due card: push it one day (compare-and-swap), or it stays due and is re-asked forever. */
async function deferSpacedReview(memoryId: string, now: Date): Promise<void> {
  const key = `tutor_${memoryId}`;
  const existing = await readSpaced(key);
  if (!existing || existing.deletedAt) return;
  const prev = parseSpaced(existing.content);
  if (!prev || prev.completed || typeof prev.reviewAt !== "string") return;
  const base = Math.max(now.getTime(), new Date(prev.reviewAt).getTime());
  const res = await prisma.brainMemory.updateMany({
    where: { id: existing.id, category: SPACED_REVIEW_CATEGORY, key, content: existing.content, deletedAt: null },
    data: { content: JSON.stringify({ ...prev, reviewAt: new Date(base + DAY_MS).toISOString() }), lastSeen: now, expiresAt: null },
  });
  if (res.count !== 1) logError("brain.tutor-pack", new Error("spaced_review defer swap lost"), { fn: "deferSpacedReview", key }, "warn");
}

/**
 * Grade one tap. The ledger row's `decision` is the claim: recordDecision
 * updates `where: { id, decision: null }`, so a redelivered tap loses the swap.
 * An ACCEPTED row with no outcome means a write after the won claim failed: the
 * next tap resumes the grade with the choice the claim recorded (resultRef
 * `tutor:<choice>`, plus `:unaided` / `:hint` on recall), and recordOutcomeResult's
 * own swap decides who finishes it.
 * A dismissed row (Skip, Not yet) never gets an outcome, so it is final.
 * K and H (recall step 2) are read-only: they return `next` for the webhook to
 * send and write nothing, so a repeated K just re-sends the reveal.
 */
export async function handleTutorAnswer(ledgerId: string, tapped: string): Promise<{ reply: string; next?: TutorNext }> {
  const malformed = { reply: "Malformed." };
  const again = { reply: "Could not record - try again." };
  const already = { reply: "Already recorded." };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(ledgerId) || !(RECALL_CHOICES.has(tapped) || DECISION_CHOICES.has(tapped))) return malformed;

  const row = await prisma.intelligenceOutcome.findUnique({
    where: { id: ledgerId },
    select: { sourceEngine: true, decision: true, resultRef: true, outcomeAt: true, evidenceRefs: true },
  });
  if (!row) return malformed;
  const kind = row.sourceEngine === "tutor:recall" ? "recall" : row.sourceEngine === "tutor:decision" ? "decision" : null;
  if (!kind) return malformed;
  const choices = kind === "recall" ? RECALL_CHOICES : DECISION_CHOICES;
  if (!choices.has(tapped)) return malformed;
  const ev = (row.evidenceRefs ?? {}) as Record<string, unknown>;
  const now = new Date();

  if (tapped === "K" || tapped === "H") {
    // Accepted with no outcome is a stranded grade: any grade button resumes it with the recorded choice.
    if (row.decision === "accepted" && !row.outcomeAt) return { reply: "Already answered - tap a grade button below to finish." };
    if (row.decision) return already;
    const options = Array.isArray(ev.options) ? (ev.options as string[]) : [];
    const answer = /^[ABC]$/.test(String(ev.correct)) ? options["ABC".indexOf(String(ev.correct))] : undefined;
    if (options.length !== 3 || typeof answer !== "string") return malformed;
    return { reply: "", next: renderRecallStep(tapped, ledgerId, options, answer) };
  }
  // The unaided marker rides on resultRef (no schema change): tutor:R:unaided, tutor:B:hint. Decision refs stay tutor:<choice>.
  const refOf = (c: string) => `tutor:${c}${kind === "recall" ? (UNAIDED.has(c) ? ":unaided" : ":hint") : ""}`;

  let choice = tapped;
  if (row.decision) {
    // Pre-scout claims recorded tutor:<letter> with no marker; a letter is always a hinted answer.
    const recorded = /^tutor:([A-Z])(?::(?:unaided|hint))?$/.exec(row.resultRef ?? "")?.[1];
    if (row.decision !== "accepted" || row.outcomeAt || !recorded || !choices.has(recorded)) return already;
    choice = recorded;
  } else {
    const dismiss = choice === "S" || choice === "N";
    // dismiss:timing: Skip and Not yet mean "not now", never a correction (CORRECTION_WHERE).
    const claimed = await recordDecision({
      id: ledgerId,
      decision: dismiss ? "dismissed" : "accepted",
      resultRef: dismiss ? "dismiss:timing" : refOf(choice),
    });
    if (!claimed) {
      const winner = await prisma.intelligenceOutcome.findUnique({ where: { id: ledgerId }, select: { decision: true } });
      return winner?.decision ? already : again;
    }
    if (choice === "S") {
      if (kind === "recall" && typeof ev.memoryId === "string") {
        await deferSpacedReview(ev.memoryId, now).catch((err) =>
          logError("brain.tutor-pack", err, { fn: "handleTutorAnswer.defer", ledgerId }, "warn"),
        );
      }
      return { reply: "Skipped." };
    }
  }

  if (kind === "recall") {
    const unaided = UNAIDED.has(choice);
    const correct = unaided ? choice === "R" : choice === ev.correct;
    const outcome = await recordOutcomeResult({ id: ledgerId, useful: correct, resultRef: refOf(choice) });
    if (outcome === "failed") return again;
    if (outcome === "already") return already;
    const options = Array.isArray(ev.options) ? (ev.options as string[]) : [];
    const answer = options["ABC".indexOf(String(ev.correct))] ?? "";
    const memoryId = typeof ev.memoryId === "string" ? ev.memoryId : null;
    // FSRS rates recall: an answer picked from the options schedules as a miss ("Again"),
    // while the ledger's `useful` above keeps "answered correctly" for the W2 kill criterion.
    const recalled = unaided && correct;
    const days = memoryId
      ? await scheduleSpacedReview(memoryId, tagMungerDisciplines(answer)[0], answer, unaided, correct, now).catch((err) => {
          logError("brain.tutor-pack", err, { fn: "handleTutorAnswer.spaced", ledgerId }, "warn");
          return null;
        })
      : null;
    // Only a wrong letter needs the answer: K already showed it before R or X.
    const lead = (s: string) => (!unaided && !correct ? `Not this one. It was: ${clip(answer, 100)}. ${s}` : s);
    if (days === "cleared") return { reply: lead("Logged. That card was cleared in Learn, so no new date.") };
    if (days === null) return { reply: lead("Logged, schedule failed.") };
    if (recalled) return { reply: `Right. Next ask in ${days} day${days === 1 ? "" : "s"}.` };
    // A lapse on a mature card can be days out, not tomorrow: quote the FSRS date.
    const nextAsk = days === 1 ? "Again tomorrow." : `Again in ${days} days.`;
    return { reply: lead(unaided ? `Logged. ${nextAsk}` : correct ? `Right, with the options. ${nextAsk}` : nextAsk) };
  }

  const replayId = typeof ev.replayId === "string" ? ev.replayId : null;
  if (choice === "N") {
    const prevReviewAt = typeof ev.reviewAt === "string" ? new Date(ev.reviewAt) : null;
    if (!replayId || !prevReviewAt) return { reply: "Noted. Could not move the review date." };
    // From now, not from the old date: a long-overdue review pushed from its old date comes back tomorrow.
    const base = Math.max(now.getTime(), prevReviewAt.getTime());
    const res = await prisma.decisionReplay
      .updateMany({ where: { id: replayId, reviewed: false, reviewAt: prevReviewAt }, data: { reviewAt: new Date(base + 7 * DAY_MS) } })
      .catch((err) => {
        logError("brain.tutor-pack", err, { fn: "handleTutorAnswer.notYet", replayId }, "warn");
        return null;
      });
    if (!res) return { reply: "Noted. Could not move the review date." };
    return { reply: res.count === 1 ? "Pushed a week." : "Noted. The review date had already moved." };
  }

  const { label, score } = DECISION_LABELS[choice];
  const decisionId = typeof ev.decisionId === "number" ? ev.decisionId : NaN;
  const marked = Number.isFinite(decisionId)
    ? await markReplayed({ decisionId, outcome: `telegram one-tap: ${label}`, outcomeScore: score })
    : { ok: false, replayId: null, brier: null };
  if (!marked.ok) return again;
  // markReplayed upserts by its own idempotency key; if the overdue row carried another key, close it too.
  if (replayId && marked.replayId !== replayId) {
    await prisma.decisionReplay
      .updateMany({ where: { id: replayId, reviewed: false }, data: { reviewed: true, reviewedAt: now, outcome: `telegram one-tap: ${label}`, outcomeScore: score } })
      .catch((err) => logError("brain.tutor-pack", err, { fn: "handleTutorAnswer.closeReplay", replayId }, "warn"));
  }
  const outcome = await recordOutcomeResult({ id: ledgerId, useful: true, resultRef: `tutor:${choice}` });
  if (outcome === "failed") return again;
  if (outcome === "already") return already;
  // Brain W3 · a Socratic forecast gets its score back at review: (p - outcome)^2.
  return { reply: typeof marked.brier === "number" ? `Logged. Brier ${marked.brier.toFixed(2)} (0 is perfect, 0.25 is a coin flip).` : "Logged." };
}
