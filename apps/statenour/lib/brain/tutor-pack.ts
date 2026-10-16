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
    topic: discipline === "uncategorized" ? "your work" : discipline.replace("-", " "),
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
            ? { id: item.memoryId, category: "system_context", title: "Wisdom recall", summary: `3-option retrieval on a wisdom row (${item.topic})`, confidence: "high", reason: "Not asked in 30 days, or its spaced review is due." }
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
      nextSafeStep: "Verify the question reads as one tap.",
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
    select: { id: true, content: true, deletedAt: true },
  });
}

/**
 * Compare-and-swap on the previous row (content = streak + due, and not soft-deleted),
 * never an update by id. On an existing row it writes schedule fields only: topic,
 * summary and memoryId stay as the row has them, and deletedAt is never in the data.
 * Returns "cleared" without writing when the card was removed in Learn. Throws when the
 * schedule was not written, so the reply never claims a "Next ask in N days" that does not exist.
 */
async function scheduleSpacedReview(
  memoryId: string,
  topic: string,
  summary: string,
  correct: boolean,
  now: Date,
): Promise<number | "cleared"> {
  const key = `tutor_${memoryId}`;
  const existing = await readSpaced(key);
  // A cleared card stays cleared: no write, no revive.
  if (existing?.deletedAt) return "cleared";
  const prev = existing ? parseSpaced(existing.content) : null;
  const step = spacedReviewStep(typeof prev?.streak === "number" ? prev.streak : 0, correct);
  const next: SpacedReview = {
    // The caller's text only seeds a new row, or fills a field an unreadable row lacks.
    topic: prev?.topic ?? topic,
    summary: prev?.summary ?? clip(summary, 300),
    reviewAt: new Date(now.getTime() + step.days * DAY_MS).toISOString(),
    interval: step.days,
    completed: false,
    streak: step.streak,
    memoryId: prev?.memoryId ?? memoryId,
  };
  if (!existing) {
    await brainMemory.remember(SPACED_REVIEW_CATEGORY, key, JSON.stringify(next), "tutor", { memoryId });
    // remember() stamps a 24h probation TTL on new rows; a schedule row must outlive it
    // (spaced_review is also in NEVER_HARD_DELETE_CATEGORIES).
    await prisma.brainMemory.updateMany({ where: { category: SPACED_REVIEW_CATEGORY, key }, data: { expiresAt: null } });
    return step.days;
  }
  const res = await prisma.brainMemory.updateMany({
    where: { id: existing.id, category: SPACED_REVIEW_CATEGORY, key, content: existing.content, deletedAt: null },
    data: { content: JSON.stringify(next), lastSeen: now, expiresAt: null },
  });
  if (res.count !== 1) throw new Error("spaced_review swap lost");
  return step.days;
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
 * `tutor:<choice>`), and recordOutcomeResult's own swap decides who finishes it.
 * A dismissed row (Skip, Not yet) never gets an outcome, so it is final.
 */
export async function handleTutorAnswer(ledgerId: string, tapped: string): Promise<{ reply: string }> {
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

  let choice = tapped;
  if (row.decision) {
    const recorded = /^tutor:([A-Z])$/.exec(row.resultRef ?? "")?.[1];
    if (row.decision !== "accepted" || row.outcomeAt || !recorded || !choices.has(recorded)) return already;
    choice = recorded;
  } else {
    const dismiss = choice === "S" || choice === "N";
    // dismiss:timing: Skip and Not yet mean "not now", never a correction (CORRECTION_WHERE).
    const claimed = await recordDecision({
      id: ledgerId,
      decision: dismiss ? "dismissed" : "accepted",
      resultRef: dismiss ? "dismiss:timing" : `tutor:${choice}`,
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
    const correct = choice === ev.correct;
    const outcome = await recordOutcomeResult({ id: ledgerId, useful: correct, resultRef: `tutor:${choice}` });
    if (outcome === "failed") return again;
    if (outcome === "already") return already;
    const options = Array.isArray(ev.options) ? (ev.options as string[]) : [];
    const answer = options["ABC".indexOf(String(ev.correct))] ?? "";
    const memoryId = typeof ev.memoryId === "string" ? ev.memoryId : null;
    const days = memoryId
      ? await scheduleSpacedReview(memoryId, tagMungerDisciplines(answer)[0], answer, correct, now).catch((err) => {
          logError("brain.tutor-pack", err, { fn: "handleTutorAnswer.spaced", ledgerId }, "warn");
          return null;
        })
      : null;
    const miss = `Not this one. It was: ${clip(answer, 100)}.`;
    if (days === "cleared") {
      const note = "Logged. That card was cleared in Learn, so no new date.";
      return { reply: correct ? note : `${miss} ${note}` };
    }
    if (days === null) return { reply: correct ? "Logged, schedule failed." : `${miss} Logged, schedule failed.` };
    return { reply: correct ? `Right. Next ask in ${days} day${days === 1 ? "" : "s"}.` : `${miss} Again tomorrow.` };
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
    : { ok: false, replayId: null };
  if (!marked.ok) return again;
  // markReplayed upserts by its own idempotency key; if the overdue row carried another key, close it too.
  if (replayId && marked.replayId !== replayId) {
    await prisma.decisionReplay
      .updateMany({ where: { id: replayId, reviewed: false }, data: { reviewed: true, reviewedAt: now, outcome: `telegram one-tap: ${label}`, outcomeScore: score } })
      .catch((err) => logError("brain.tutor-pack", err, { fn: "handleTutorAnswer.closeReplay", replayId }, "warn"));
  }
  const outcome = await recordOutcomeResult({ id: ledgerId, useful: true, resultRef: `tutor:${choice}` });
  if (outcome === "failed") return again;
  return outcome === "already" ? already : { reply: "Logged." };
}
