/**
 * suggestion-loop · the supervised-signal capture for Nick suggestions.
 *
 * Why this exists (Ilya lens):
 *   The existing ChatMessage.feedbackScore (-1/null/+1) captures the
 *   operator's reaction to a Nick response · "was this good?" The
 *   existing `lib/brain/outcome-tracker.ts` handles predictions,
 *   recommendations, and graded decisions. Neither closes the loop
 *   for the proactive chat suggestions surfaced via:
 *     - /api/nick/suggest aggregator (NickSuggestions chip strip)
 *     - chat-side action chips
 *     - cron-pushed nudges
 *
 *   This module captures the three-stage chain for those:
 *     1. Suggestion surfaced  (caller writes to ChatMessage / nudge)
 *     2. Operator action      (acted · dismissed · modified · deferred)
 *     3. Outcome materialized (positive · negative · neutral · delayed)
 *
 *   The three signals share the same `suggestionId` so the loop can be
 *   walked downstream by improve-agent / future DPO data-prep:
 *     SELECT * FROM brain_memory
 *     WHERE category = 'suggestion_loop'
 *       AND key LIKE 'sugg:<id>:%'
 *
 * Why BrainMemory and not a new table:
 *   Additive · no schema migration · fits the existing decay + dedup
 *   model · improve-agent already reads brain_memory by category.
 *
 * Companion modules:
 *   - lib/brain/outcome-tracker.ts · prediction/recommendation/decision
 *     accuracy (different concept · scored against ground truth)
 *   - lib/brain/improve-agent.ts · consumes both signals to surface
 *     improvement hypotheses
 */

import { z } from "zod";
import { prisma } from "@/lib/prisma";
// 2026-05-23 · Wave H · M1 (Closed-Loop Calibrated Brain).
// Stamp every action + outcome row with the operator-state snapshot
// at fire-time. Lets downstream calibration analysis (e.g.
// /system/calibration) plot Nick's hit rate as a function of mood,
// capacity, drift, momentum. Pre-fix the loop had no state context ·
// downstream consumers couldn't disambiguate "Nick was good" from
// "Nick was good while operator was depleted" (very different signals
// for DPO data prep). LeCun-lens consolidation extending Wave 5.3.
import { currentOperatorState, type OperatorState } from "@/lib/services/operator-state";

// ─── Types ──────────────────────────────────────────────────────────

export const SuggestionKind = z.enum([
  "task",
  "goal",
  "sms",
  "research",
  "reflection",
  "decision",
  "purchase",
  "weak-axis",
  "stuck-task",
  "overdue",
  "stalled-goal",
  "pattern",
  "orphan-nudge",
  "contradiction",
  "drift",
  "unresolved-reflection",
  "broken-promise",
  "stale-pin",
  "other",
]);

export const OutcomePolarity = z.enum(["positive", "negative", "neutral"]);

export const ActionEvent = z.enum([
  "acted",
  "dismissed",
  "modified",
  "deferred",
]);

const SuggestionActionInput = z.object({
  suggestionId: z.string().min(1).max(128),
  suggestionKind: SuggestionKind,
  event: ActionEvent,
  delaySeconds: z.number().int().nonnegative().max(60 * 60 * 24 * 365).optional(),
  modifiedTo: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
});

const OutcomeObservationInput = z.object({
  suggestionId: z.string().min(1).max(128),
  suggestionKind: SuggestionKind,
  polarity: OutcomePolarity,
  delaySeconds: z.number().int().nonnegative().max(60 * 60 * 24 * 365).optional(),
  notes: z.string().max(4000).optional(),
});

export type SuggestionActionPayload = z.infer<typeof SuggestionActionInput>;
export type OutcomeObservationPayload = z.infer<typeof OutcomeObservationInput>;

// ─── Constants ──────────────────────────────────────────────────────

import { BRAIN_CATEGORIES } from "./categories";
const CATEGORY = BRAIN_CATEGORIES.SUGGESTION_LOOP;

/**
 * Confidence reflects how strong the signal is for downstream training.
 *
 * Action events:
 *   acted     · 0.7 — operator did the suggested thing
 *   dismissed · 0.6 — explicit no, also strong supervised signal
 *   modified  · 0.5 — related action but changed direction
 *   deferred  · 0.3 — intent without action, weakest signal
 *
 * Outcome polarity:
 *   positive  · 0.9 — strongest, validated by reality
 *   negative  · 0.9 — also strong, validated counterexample
 *   neutral   · 0.4 — ambiguous, weak training signal
 */
function actionConfidence(event: SuggestionActionPayload["event"]): number {
  switch (event) {
    case "acted":
      return 0.7;
    case "dismissed":
      return 0.6;
    case "modified":
      return 0.5;
    case "deferred":
      return 0.3;
    default:
      // TypeScript exhaustiveness · Zod already narrows to the four
      // string-literals above, so this is unreachable. Kept as a
      // belt-and-suspenders fallback for the linter.
      return 0.5;
  }
}

function outcomeConfidence(polarity: z.infer<typeof OutcomePolarity>): number {
  switch (polarity) {
    case "positive":
      return 0.9;
    case "negative":
      return 0.9;
    case "neutral":
      return 0.4;
    default:
      return 0.4;
  }
}

// ─── Writes ─────────────────────────────────────────────────────────

/**
 * Record that the operator acted on (or dismissed / modified / deferred)
 * a Nick suggestion. Idempotent per (suggestionId, event) via upsert.
 */
/**
 * 2026-05-23 · Wave H · M1 · best-effort operator-state capture.
 * Reads the current state snapshot (3 Prisma queries · ~60ms typical
 * · degrades to zero-confidence on DB error). Returns null on any
 * failure · suggestion-loop writes still succeed without the stamp.
 */
async function captureStateSnapshot(): Promise<OperatorState | null> {
  try {
    return await currentOperatorState();
  } catch {
    return null;
  }
}

/**
 * 2026-05-23 · Wave H · M1 · compact snapshot for embedding in
 * BrainMemory.metadata. Strips signals[] (heavy · not needed for
 * calibration math) · keeps the 5 dims + mood + confidence.
 */
function compactState(s: OperatorState | null): null | {
  focus: number;
  capacity: number;
  drift: number;
  momentum: number;
  mood: string;
  confidence: number;
  ranAt: string;
} {
  if (!s) return null;
  return {
    focus: s.focus,
    capacity: s.capacity,
    drift: s.drift,
    momentum: s.momentum,
    mood: s.mood,
    confidence: s.confidence,
    ranAt: s.ranAt,
  };
}

export async function trackSuggestionAction(input: unknown): Promise<{
  id: string;
  key: string;
}> {
  const parsed = SuggestionActionInput.parse(input);
  const key = `sugg:${parsed.suggestionId}:action:${parsed.event}`;
  const summary = `Operator ${parsed.event} on ${parsed.suggestionKind} suggestion ${parsed.suggestionId}${parsed.notes ? ` · ${parsed.notes.slice(0, 280)}` : ""}`;
  const operatorStateSnapshot = compactState(await captureStateSnapshot());

  const row = await prisma.brainMemory.upsert({
    where: { category_key: { category: CATEGORY, key } },
    create: {
      category: CATEGORY,
      key,
      content: summary,
      confidence: actionConfidence(parsed.event),
      source: "suggestion-loop",
      createdBy: "suggestion-loop",
      metadata: {
        suggestionId: parsed.suggestionId,
        suggestionKind: parsed.suggestionKind,
        event: parsed.event,
        delaySeconds: parsed.delaySeconds ?? null,
        modifiedTo: parsed.modifiedTo ?? null,
        notes: parsed.notes ?? null,
        operatorStateSnapshot,
      },
    },
    update: {
      lastSeen: new Date(),
      seenCount: { increment: 1 },
      content: summary,
      metadata: {
        suggestionId: parsed.suggestionId,
        suggestionKind: parsed.suggestionKind,
        event: parsed.event,
        delaySeconds: parsed.delaySeconds ?? null,
        modifiedTo: parsed.modifiedTo ?? null,
        notes: parsed.notes ?? null,
        operatorStateSnapshot,
      },
    },
  });

  return { id: row.id, key };
}

/**
 * Record the delayed outcome of a previously-actioned suggestion.
 *
 * Called by:
 *   - manual operator note ("that suggestion paid off")
 *   - downstream signal hooks (booking_confirmed · sms_replied · revenue)
 *   - future outcome-rollup cron that matches action signals against
 *     business events in the same window
 */
export async function recordSuggestionOutcome(input: unknown): Promise<{
  id: string;
  key: string;
}> {
  const parsed = OutcomeObservationInput.parse(input);
  const key = `sugg:${parsed.suggestionId}:outcome:${parsed.polarity}`;
  const summary = `Outcome of ${parsed.suggestionKind} suggestion ${parsed.suggestionId}: ${parsed.polarity}${parsed.notes ? ` · ${parsed.notes.slice(0, 280)}` : ""}`;
  const operatorStateSnapshot = compactState(await captureStateSnapshot());

  const row = await prisma.brainMemory.upsert({
    where: { category_key: { category: CATEGORY, key } },
    create: {
      category: CATEGORY,
      key,
      content: summary,
      confidence: outcomeConfidence(parsed.polarity),
      source: "suggestion-loop",
      createdBy: "suggestion-loop",
      metadata: {
        suggestionId: parsed.suggestionId,
        suggestionKind: parsed.suggestionKind,
        polarity: parsed.polarity,
        delaySeconds: parsed.delaySeconds ?? null,
        notes: parsed.notes ?? null,
        operatorStateSnapshot,
      },
    },
    update: {
      lastSeen: new Date(),
      seenCount: { increment: 1 },
      content: summary,
      metadata: {
        suggestionId: parsed.suggestionId,
        suggestionKind: parsed.suggestionKind,
        polarity: parsed.polarity,
        delaySeconds: parsed.delaySeconds ?? null,
        notes: parsed.notes ?? null,
        operatorStateSnapshot,
      },
    },
  });

  return { id: row.id, key };
}

// ─── Reads ──────────────────────────────────────────────────────────

export interface SuggestionLoopSignal {
  suggestionId: string;
  suggestionKind: string;
  event: string | null;
  polarity: string | null;
  confidence: number;
  delaySeconds: number | null;
  notes: string | null;
  capturedAt: Date;
}

/**
 * Pull all suggestion-loop rows for the last N days · used by
 * improve-agent + future DPO data-prep + /system/quality scorecard.
 */
export async function listSuggestionSignals(
  daysBack = 30,
): Promise<SuggestionLoopSignal[]> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const rows = await prisma.brainMemory.findMany({
    where: {
      category: CATEGORY,
      lastSeen: { gte: since },
      deletedAt: null,
    },
    orderBy: { lastSeen: "desc" },
    take: 1000,
  });
  return rows.map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    return {
      suggestionId: String(meta.suggestionId ?? ""),
      suggestionKind: String(meta.suggestionKind ?? "other"),
      event: typeof meta.event === "string" ? meta.event : null,
      polarity: typeof meta.polarity === "string" ? meta.polarity : null,
      confidence: r.confidence,
      delaySeconds: typeof meta.delaySeconds === "number" ? meta.delaySeconds : null,
      notes: typeof meta.notes === "string" ? meta.notes : null,
      capturedAt: r.lastSeen,
    };
  });
}

/**
 * VAD-style signal gate · 2026-05-21.
 *
 * Returns suggestionIds the operator DISMISSED within the last
 * `daysBack` days. /api/nick/suggest filters these before ranking, so
 * a dismissed chip stops re-firing on the 60s poll instead of
 * resurfacing until the underlying data clears.
 *
 * Gates on `lastSeen`, not `seenCount`: trackSuggestionAction's upsert
 * bumps `lastSeen` on every repeat dismissal, so the window self-arms —
 * one dismissal buys `daysBack` of quiet; a repeat mid-window extends
 * it a full window again. Graduated suppression, no count math. When
 * the window lapses a still-relevant condition resurfaces once more.
 *
 * The Pipecat/Friday VAD threshold applied to the proactive layer:
 * a dismissal is below-threshold noise — gate it, don't transmit.
 */
export async function getDismissedSuggestionIds(
  daysBack = 7,
): Promise<Set<string>> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const rows = await prisma.brainMemory.findMany({
    where: {
      category: CATEGORY,
      key: { endsWith: ":action:dismissed" },
      lastSeen: { gte: since },
      deletedAt: null,
    },
    select: { metadata: true },
  });
  const ids = new Set<string>();
  for (const r of rows) {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.suggestionId === "string" && meta.suggestionId.length > 0) {
      ids.add(meta.suggestionId);
    }
  }
  return ids;
}

export interface SuggestionStatsByKind {
  acted: number;
  dismissed: number;
  modified: number;
  deferred: number;
  positive: number;
  negative: number;
  neutral: number;
}

export interface SuggestionLoopStats {
  totalSignals: number;
  byKind: Record<string, SuggestionStatsByKind>;
  actionRate: Record<string, number>;
  positiveOutcomeRate: Record<string, number>;
}

/**
 * Aggregate stats for the /system/quality scorecard:
 *   per-kind action rate · per-kind outcome polarity distribution.
 */
export async function suggestionLoopStats(
  daysBack = 30,
): Promise<SuggestionLoopStats> {
  const signals = await listSuggestionSignals(daysBack);
  const byKind: Record<string, SuggestionStatsByKind> = {};

  for (const s of signals) {
    const bucket = (byKind[s.suggestionKind] ??= {
      acted: 0,
      dismissed: 0,
      modified: 0,
      deferred: 0,
      positive: 0,
      negative: 0,
      neutral: 0,
    });
    if (s.event === "acted") bucket.acted++;
    else if (s.event === "dismissed") bucket.dismissed++;
    else if (s.event === "modified") bucket.modified++;
    else if (s.event === "deferred") bucket.deferred++;
    if (s.polarity === "positive") bucket.positive++;
    else if (s.polarity === "negative") bucket.negative++;
    else if (s.polarity === "neutral") bucket.neutral++;
  }

  const actionRate: Record<string, number> = {};
  const positiveOutcomeRate: Record<string, number> = {};
  for (const [kind, b] of Object.entries(byKind)) {
    const surfaced = b.acted + b.dismissed + b.modified + b.deferred;
    actionRate[kind] = surfaced > 0 ? b.acted / surfaced : 0;
    const outcomeTotal = b.positive + b.negative + b.neutral;
    positiveOutcomeRate[kind] = outcomeTotal > 0 ? b.positive / outcomeTotal : 0;
  }

  return {
    totalSignals: signals.length,
    byKind,
    actionRate,
    positiveOutcomeRate,
  };
}
