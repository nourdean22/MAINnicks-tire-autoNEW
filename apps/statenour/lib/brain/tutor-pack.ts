/**
 * Daily Tutor (brain W2, 2026-10-16). One Telegram item per ET day, sent in
 * the morning hour right after the morning push, answered with ONE TAP.
 *
 * Why one tap: W0 measured 89 pushes and briefs shown since 09-18, 0 decided,
 * 2 rated; 29 decision replays, 0 ever reviewed, 9 overdue. Anything that
 * costs more than a tap has a base rate of zero here.
 *
 * Priority: an overdue decision review (DecisionReplay reviewAt <= now,
 * reviewed=false, oldest first) beats a 3-option retrieval question built
 * from a `wisdom` memory. Retrieval beats re-reading; a scored decision beats
 * journaling (Harvard RCT 2025).
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
import { today } from "@/lib/utils/datetime";
import {
  alreadyPushed,
  sendClaimed,
  type PushPreview,
  type PushResult,
  type PushSource,
} from "@/lib/brain/proactive-pushes";

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
/** The spacing ladder 1/3/7/30 is copied from mode-learn.tsx on purpose: same consumer, same cadence. */
const SPACED_LADDER = [1, 3, 7, 30];
const RECALL_CHOICES = new Set(["A", "B", "C", "S"]);
const DECISION_CHOICES = new Set(["W", "M", "D", "N"]);
const DECISION_LABELS: Record<string, { label: string; score: number }> = {
  W: { label: "Worked", score: 5 },
  M: { label: "Mixed", score: 0 },
  D: { label: "Didn't", score: -5 },
};

const et = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 3).trimEnd()}...`);

/** Streak-driven next review: correct climbs the ladder, a miss resets to tomorrow. */
export function spacedReviewStep(prevStreak: number, correct: boolean): { streak: number; days: number } {
  if (!correct) return { streak: 0, days: 1 };
  const streak = Math.max(0, prevStreak) + 1;
  return { streak, days: SPACED_LADDER[Math.min(streak, SPACED_LADDER.length) - 1] };
}

type SpacedReview = {
  topic: string;
  summary: string;
  reviewAt: string;
  interval: number;
  completed: boolean;
  streak: number;
  memoryId: string;
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
  const row = await prisma.decisionReplay
    .findFirst({
      where: { reviewed: false, reviewAt: { lte: now }, decisionId: { not: null } },
      orderBy: { reviewAt: "asc" },
      select: { id: true, decisionId: true, title: true, choiceMade: true, reviewAt: true, createdAt: true },
    })
    .catch((err) => {
      logError("brain.tutor-pack", err, { fn: "pickOverdueDecision" }, "warn");
      return null;
    });
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
      take: 120,
    }),
  ]);
  if (wisdom.length < 3) return null;

  const askedIds = new Set(
    asked.map((r) => (r.evidenceRefs as { memoryId?: unknown } | null)?.memoryId).filter((v): v is string => typeof v === "string"),
  );
  // A due spaced_review row re-asks its wisdom even inside the 30-day window:
  // that is how "Again tomorrow" and the 1/3/7/30 ladder come true.
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
  const discipline = tagMungerDisciplines(target.content)[0];
  const others = wisdom.filter((w) => w.id !== target.id && w.content !== target.content);
  const foreign = others.filter((w) => tagMungerDisciplines(w.content)[0] !== discipline);
  const distractors = [...foreign, ...others.filter((w) => !foreign.includes(w))].slice(0, 2);
  if (distractors.length < 2) return null;

  // Deterministic correct position from the id, so the answer is not always A.
  const pos = [...target.id].reduce((n, c) => n + c.charCodeAt(0), 0) % 3;
  const options = [distractors[0].content, distractors[1].content] as string[];
  options.splice(pos, 0, target.content);
  return {
    kind: "recall",
    memoryId: target.id,
    topic: discipline === "uncategorized" ? "your work" : discipline.replace("-", " "),
    options: options as [string, string, string],
    correct: "ABC"[pos] as "A" | "B" | "C",
  };
}

/** Priority: overdue decision review, else a recall question, else null (silent day). */
export async function composeTutorItem(now: Date = new Date()): Promise<TutorItem | null> {
  return (await pickOverdueDecision(now)) ?? (await pickRecall(now));
}

/** Nour's voice: direct, calm, no emojis, no exclamation marks. HTML parse mode, so escape. */
export function renderTutorMessage(item: TutorItem, ledgerId: string): { text: string; buttons: InlineButton[][] } {
  const btn = (text: string, choice: string): InlineButton => ({ text, callback_data: `tut:${ledgerId}:${choice}` });
  if (item.kind === "recall") {
    const lines = item.options.map((o, i) => `${"ABC"[i]}. ${escapeHtml(clip(o, 120))}`);
    return {
      text: `Daily Tutor. Which of these is the principle you distilled about ${escapeHtml(item.topic)}?\n\n${lines.join("\n")}`,
      buttons: [[btn("A", "A"), btn("B", "B"), btn("C", "C"), btn("Skip", "S")]],
    };
  }
  return {
    text: `Decision review. ${escapeHtml(item.title)} (${item.date}). You chose: ${escapeHtml(clip(item.chosen, 120))}. How did it go?`,
    buttons: [[btn("Worked", "W"), btn("Mixed", "M"), btn("Didn't", "D"), btn("Not yet", "N")]],
  };
}

function evidenceFor(item: TutorItem): Record<string, unknown> {
  return item.kind === "recall"
    ? { correct: item.correct, memoryId: item.memoryId, options: item.options }
    : { decisionId: item.decisionId, replayId: item.replayId, reviewAt: item.reviewAt.toISOString(), options: ["W", "M", "D", "N"] };
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
  const item = await composeTutorItem(now);
  const skipReason = isDup ? "already_pushed_today" : quietHoursBlocked ? "quiet_hours_overnight" : !item ? "nothing_eligible" : "";

  if (options?.dryRun) {
    const text = item ? renderTutorMessage(item, "preview").text : undefined;
    const riskFlags = ["preview_only", "live_send_disabled"];
    if (isDup) riskFlags.push("already_sent_today");
    if (!item) riskFlags.push("empty_message");
    if (quietHoursBlocked) riskFlags.push("quiet_hours_overnight");
    const sources: PushSource[] = item
      ? [
          item.kind === "recall"
            ? { id: item.memoryId, category: "system_context", title: "Wisdom recall", summary: `3-option retrieval on a wisdom row (${item.topic})`, confidence: "high", reason: "Not asked in 30 days, or its spaced review is due.", href: "/brain/wisdom" }
            : { id: item.replayId, category: "system_context", title: "Overdue decision review", summary: `${item.title} (${item.date})`, confidence: "high", reason: "DecisionReplay reviewAt passed and reviewed=false.", href: "/journal" },
        ]
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
      nextSafeStep: "Verify the question reads as one tap.",
      sources,
    };
  }

  if (skipReason || !item) return { kind: "live", slot: "tutor", fired: false, reason: skipReason || "nothing_eligible" };

  let failReason: string | null = null;
  let sentText: string | undefined;
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
    if (res.ok) sentText = text;
    return res.ok;
  });
  return { kind: "live", slot: "tutor", fired, reason: failReason ?? reason, text: sentText };
}

/** Compare-and-swap on the previous row content (streak + due), never an update by id. */
async function scheduleSpacedReview(memoryId: string, topic: string, summary: string, correct: boolean, now: Date): Promise<number> {
  const key = `tutor_${memoryId}`;
  const existing = await prisma.brainMemory.findUnique({
    where: { category_key: { category: SPACED_REVIEW_CATEGORY, key } },
    select: { content: true },
  });
  const prev = existing ? parseSpaced(existing.content) : null;
  const step = spacedReviewStep(typeof prev?.streak === "number" ? prev.streak : 0, correct);
  const next: SpacedReview = {
    topic,
    summary: clip(summary, 300),
    reviewAt: new Date(now.getTime() + step.days * DAY_MS).toISOString(),
    interval: step.days,
    completed: false,
    streak: step.streak,
    memoryId,
  };
  if (!existing) {
    await brainMemory.remember(SPACED_REVIEW_CATEGORY, key, JSON.stringify(next), "tutor", { memoryId });
  } else {
    const res = await prisma.brainMemory.updateMany({
      where: { category: SPACED_REVIEW_CATEGORY, key, content: existing.content },
      data: { content: JSON.stringify(next), lastSeen: now },
    });
    if (res.count !== 1) logError("brain.tutor-pack", new Error("spaced_review swap lost"), { fn: "scheduleSpacedReview", key }, "warn");
  }
  return step.days;
}

/**
 * Grade one tap. The ledger row's `decision` is the claim: recordDecision
 * updates `where: { id, decision: null }`, so a redelivered tap loses the
 * swap and answers "Already recorded." without writing anything else.
 */
export async function handleTutorAnswer(ledgerId: string, choice: string): Promise<{ reply: string }> {
  const malformed = { reply: "Malformed." };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(ledgerId) || !(RECALL_CHOICES.has(choice) || DECISION_CHOICES.has(choice))) return malformed;

  const row = await prisma.intelligenceOutcome.findUnique({
    where: { id: ledgerId },
    select: { sourceEngine: true, decision: true, evidenceRefs: true },
  });
  if (!row) return malformed;
  const kind = row.sourceEngine === "tutor:recall" ? "recall" : row.sourceEngine === "tutor:decision" ? "decision" : null;
  if (!kind || !(kind === "recall" ? RECALL_CHOICES : DECISION_CHOICES).has(choice)) return malformed;
  if (row.decision) return { reply: "Already recorded." };
  const ev = (row.evidenceRefs ?? {}) as Record<string, unknown>;
  const now = new Date();

  const dismiss = choice === "S" || choice === "N";
  const claimed = await recordDecision({ id: ledgerId, decision: dismiss ? "dismissed" : "accepted", resultRef: `tutor:${choice}` });
  if (!claimed) {
    const winner = await prisma.intelligenceOutcome.findUnique({ where: { id: ledgerId }, select: { decision: true } });
    return { reply: winner?.decision ? "Already recorded." : "Could not record - try again." };
  }

  if (choice === "S") return { reply: "Skipped." };

  if (kind === "recall") {
    const correct = choice === ev.correct;
    const outcome = await recordOutcomeResult({ id: ledgerId, useful: correct, resultRef: `tutor:${choice}` });
    if (outcome === "failed") return { reply: "Could not record - try again." };
    const options = Array.isArray(ev.options) ? (ev.options as string[]) : [];
    const answer = options["ABC".indexOf(String(ev.correct))] ?? "";
    const memoryId = typeof ev.memoryId === "string" ? ev.memoryId : null;
    let days = correct ? 1 : 1;
    if (memoryId) {
      days = await scheduleSpacedReview(memoryId, tagMungerDisciplines(answer)[0], answer, correct, now).catch((err) => {
        logError("brain.tutor-pack", err, { fn: "handleTutorAnswer.spaced", ledgerId }, "warn");
        return correct ? spacedReviewStep(0, true).days : 1;
      });
    }
    return { reply: correct ? `Right. Next ask in ${days} day${days === 1 ? "" : "s"}.` : `Not this one. It was: ${clip(answer, 100)}. Again tomorrow.` };
  }

  const replayId = typeof ev.replayId === "string" ? ev.replayId : null;
  if (choice === "N") {
    const prevReviewAt = typeof ev.reviewAt === "string" ? new Date(ev.reviewAt) : null;
    if (replayId && prevReviewAt) {
      await prisma.decisionReplay.updateMany({
        where: { id: replayId, reviewed: false, reviewAt: prevReviewAt },
        data: { reviewAt: new Date(prevReviewAt.getTime() + 7 * DAY_MS) },
      });
    }
    return { reply: "Pushed a week." };
  }

  const { label, score } = DECISION_LABELS[choice];
  const decisionId = typeof ev.decisionId === "number" ? ev.decisionId : NaN;
  const marked = Number.isFinite(decisionId)
    ? await markReplayed({ decisionId, outcome: `telegram one-tap: ${label}`, outcomeScore: score })
    : { ok: false, replayId: null };
  if (!marked.ok) return { reply: "Could not record - try again." };
  // markReplayed upserts by its own idempotency key; if the overdue row carried another key, close it too.
  if (replayId && marked.replayId !== replayId) {
    await prisma.decisionReplay
      .updateMany({ where: { id: replayId, reviewed: false }, data: { reviewed: true, reviewedAt: now, outcome: `telegram one-tap: ${label}`, outcomeScore: score } })
      .catch((err) => logError("brain.tutor-pack", err, { fn: "handleTutorAnswer.closeReplay", replayId }, "warn"));
  }
  await recordOutcomeResult({ id: ledgerId, useful: true, resultRef: `tutor:${choice}` });
  return { reply: "Logged." };
}
