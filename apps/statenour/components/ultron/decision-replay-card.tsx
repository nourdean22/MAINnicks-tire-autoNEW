"use client";

/**
 * DecisionReplayCard · v10.0.529 · v529.27 · Arc B F3 surface
 *
 * Consumer for the decision-replay coach pipeline shipped in v10.0.528:
 *   · daily cron (mega-morning · /api/cron/decision-replay) picks up to
 *     5 MasteryDecisions aged ≥30d, matches a wisdom citation, queues
 *     BrainMemory(category="decision_replay_due") rows
 *   · morning-brief Personal slice consumes + marks 3 per day
 *   · this Ultron card surfaces the FULL backlog so anything not
 *     covered in the morning push stays visible until it's actually
 *     reviewed
 *
 * Reads GET /api/system/decision-replays · returns:
 *   · due.unconsumed[] — queued but not yet shown in any brief
 *   · due.consumedTodayCount — already pushed today
 *   · recent[] — last 10 reviewed (with outcome + lesson)
 *
 * Silent on empty (no due, no recent) — zero noise on a clean board.
 * Otherwise renders an editorial-minimalist card with the top 3 due
 * + a footer line referencing the most-recent reviewed lesson (if any),
 * so the operator sees both backlog AND signal-of-replay-rhythm in
 * one glance.
 *
 * Design (frontend-design · DFII ≥ 8 · no AI-slop):
 *   · GlassCard with gold accent — matches ObservabilityRow rhythm
 *   · Decision rows are dense single-lines (title + age chip) not cards
 *   · No iconography clutter · the gold left-border IS the affordance
 *   · 44px min tap targets via the row padding
 *
 * Cron + brief load:
 *   · Poll cadence 5 min (decision queue rolls once per day; faster
 *     is wasteful · slower misses the post-mark-consumed shrink).
 *
 * v529.27 · Arc B Phase 1B · INLINE LESSON FORM
 *   The "future /system/decision-replays page will host the submit-lesson
 *   form" TODO from v529.7 is closed. Each due row gets a small
 *   pencil-icon toggle next to the age chip · click expands an inline
 *   form below the row with three fields:
 *     · outcome (what actually happened · required · 500-char cap)
 *     · score chip (wrong / mixed / right → -1 / 0 / +1)
 *     · lesson (what was learned · optional · 800-char cap)
 *   Submit POSTs to the existing /mark route with the body · the route
 *   dual-writes consumedAt on the BrainMemory AND calls markReplayed()
 *   so the lesson lands in DecisionReplay + the BrainMemory wisdom
 *   recall index. Operator can still tap-the-row to go to /chat for
 *   the deep-discussion path · the two flows coexist.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PencilLine, X as XIcon, Sparkles, Loader2 } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const TOP_N = 3;
const PREVIEW_CHARS = 90;
const OUTCOME_MAX = 500;
const LESSON_MAX = 800;

// v529.27 · 3-chip score. Maps to the markReplayed `outcomeScore`
// schema range (-5..+5) but uses -1/0/+1 so the chip set stays
// readable and the operator isn't asked to grade fine-grained.
type ScoreChoice = "wrong" | "mixed" | "right";
const SCORE_VALUES: Record<ScoreChoice, number> = {
  wrong: -1,
  mixed: 0,
  right: 1,
};
const SCORE_LABELS: Record<ScoreChoice, string> = {
  wrong: "wrong call",
  mixed: "mixed",
  right: "right call",
};

function ageDaysFrom(iso: string): number | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000)));
}

function trimText(s: string | null | undefined, n = PREVIEW_CHARS): string {
  if (!s) return "";
  const trimmed = s.replace(/\s+/g, " ").trim();
  return trimmed.length > n ? trimmed.slice(0, n - 1).trimEnd() + "…" : trimmed;
}

export function DecisionReplayCard() {
  // Phase B.6c (2026-05-22) · migrated off `useUltronFetch("/api/system/
  // decision-replays")` + two `authedFetch` POSTs to the `/mark` route
  // onto `trpc.system.decisionReplays` (reactive read · 5-min
  // refetchInterval) + `trpc.system.markDecisionReplay` (mutation). The
  // mark endpoint is dual-mode: the inline lesson form sends a full
  // body, the tap-to-chat row click fires it with no `outcome` (the
  // legacy empty-body mark). The procedure returns the result object
  // directly · the `id` path param now rides in the input object.
  const replays = trpc.system.decisionReplays.useQuery(undefined, {
    refetchInterval: 300_000,
    staleTime: 300_000,
  });
  const utils = trpc.useUtils();
  const markMutation = trpc.system.markDecisionReplay.useMutation();

  // v529.27 · per-row lesson-form state. Only one row's form is open
  // at a time · clicking a different row's toggle closes the previous
  // form silently · prevents the operator from accidentally losing
  // input by opening two forms in parallel.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");
  const [score, setScore] = useState<ScoreChoice | null>(null);
  const [lesson, setLesson] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const closeForm = useCallback(() => {
    setExpandedId(null);
    setOutcome("");
    setScore(null);
    setLesson("");
  }, []);

  const openForm = useCallback((rowId: string) => {
    setExpandedId(rowId);
    setOutcome("");
    setScore(null);
    setLesson("");
  }, []);

  const submitLesson = useCallback(
    async (rowId: string) => {
      const trimmedOutcome = outcome.trim();
      if (trimmedOutcome.length === 0) {
        toast.error("outcome required");
        return;
      }
      setSubmitting(true);
      const toastId = toast.loading("logging lesson…");
      try {
        const trimmedLesson = lesson.trim();
        const result = await markMutation.mutateAsync({
          id: rowId,
          outcome: trimmedOutcome,
          ...(score !== null ? { outcomeScore: SCORE_VALUES[score] } : {}),
          ...(trimmedLesson.length > 0 ? { lesson: trimmedLesson } : {}),
        });
        toast.success(
          result.replayWritten
            ? "lesson logged · brain memory updated"
            : "marked consumed",
          { id: toastId },
        );
        closeForm();
        await utils.system.decisionReplays.invalidate();
      } catch {
        toast.error("save failed", { id: toastId });
      } finally {
        setSubmitting(false);
      }
    },
    [outcome, score, lesson, closeForm, markMutation, utils],
  );

  if (replays.isLoading && !replays.data) {
    return <ShimmerSkeleton variant="card" className="min-h-[96px]" />;
  }

  const data = replays.data;
  const due = data?.due?.unconsumed ?? [];
  const consumedTodayCount = data?.due?.consumedTodayCount ?? 0;
  const recent = data?.recent ?? [];
  const mostRecent = recent[0] ?? null;

  // Silent when nothing on either side · keeps HQ clean.
  if (due.length === 0 && consumedTodayCount === 0 && recent.length === 0) {
    return null;
  }

  const shown = due.slice(0, TOP_N);
  const more = Math.max(0, due.length - TOP_N);

  return (
    <GlassCard
      className="min-h-[96px] border-[var(--gold)]/25 bg-[var(--gold)]/[0.03]"
      data-testid="decision-replay-card"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]">
          decisions · replay
          <span className="rounded-sm border border-[var(--gold)]/30 px-1 py-px text-[9px] tabular-nums text-[var(--gold)]">
            {due.length} due
          </span>
        </span>
        {consumedTodayCount > 0 && (
          <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            {consumedTodayCount} pushed today
          </span>
        )}
      </div>

      {shown.length > 0 ? (
        <ul className="mt-2 space-y-1.5" aria-label="Decisions due for replay">
          {shown.map((row) => {
            const age = ageDaysFrom(row.queuedAt);
            const promptPreview = trimText(row.text, PREVIEW_CHARS);
            // v10.0.529.7 · tap-to-act · row click goes to /chat with the
            // replay seeded into the composer. Fire-and-forget the mark
            // mutation (empty-body mode · no `outcome` → consumedAt-only)
            // so the row drops from this tile without waiting for the
            // next 5-min poll. The invalidate forces an immediate refresh.
            const handleMarkConsumed = () => {
              markMutation
                .mutateAsync({ id: row.id })
                .then(() => {
                  void utils.system.decisionReplays.invalidate();
                })
                .catch(() => {
                  // best-effort · the queue will reconcile on next poll
                });
            };
            // v10.0.529.8 · cap seed at 1800 chars (URL-safe headroom under
            // common 2KB browser limits after encodeURIComponent expansion).
            const seedHref = `/chat?seed=${encodeURIComponent(row.text.slice(0, 1800))}`;
            const isExpanded = expandedId === row.id;
            return (
              <li key={row.id} className="text-[11px] leading-snug">
                {/* v529.27 · row no longer a single <Link> · split into
                    Link (preview + age, tap → /chat) + toggle button
                    (pencil icon, expands the inline lesson form). The
                    two affordances coexist: deep-discussion-in-chat
                    path AND quick-capture-here path. */}
                <div className="-mx-1 flex items-start gap-2 px-1 py-1 rounded-sm">
                  <Link
                    href={seedHref}
                    onClick={handleMarkConsumed}
                    className="flex-1 min-w-0 transition-colors hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:text-[var(--text-primary)]"
                    aria-label={`Replay decision in chat · ${promptPreview}`}
                  >
                    <span className="text-[var(--text-secondary)]">
                      {promptPreview}
                    </span>
                  </Link>
                  <span className="shrink-0 text-[9px] font-mono uppercase tracking-wide tabular-nums text-[var(--text-tertiary)]">
                    {age !== null ? `${age}d` : "—"}
                  </span>
                  <button
                    type="button"
                    onClick={() => (isExpanded ? closeForm() : openForm(row.id))}
                    aria-expanded={isExpanded}
                    aria-label={isExpanded ? "close lesson form" : "log lesson inline"}
                    className={cn(
                      "shrink-0 -my-0.5 p-1 rounded transition-colors",
                      "min-w-[44px] min-h-[44px] sm:min-w-[28px] sm:min-h-[28px] flex items-center justify-center",
                      isExpanded
                        ? "bg-[var(--gold)]/15 text-[var(--gold)]"
                        : "text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:bg-[var(--gold)]/[0.08]",
                    )}
                    title={isExpanded ? "close lesson form" : "log lesson inline"}
                  >
                    {isExpanded ? <XIcon size={11} /> : <PencilLine size={11} />}
                  </button>
                </div>

                {/* v529.27 · inline lesson form. Renders below the row
                    when expanded. 3 fields: outcome (required) · 3-chip
                    score (-1/0/+1) · lesson (optional). Gold left-rule
                    visually marks the form as a child of the row above. */}
                {isExpanded && (
                  <div className="mt-1 ml-2 border-l border-[var(--gold)]/25 pl-2.5 py-1.5 space-y-1.5">
                    <div>
                      <label className="block text-[8px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-0.5">
                        what actually happened
                      </label>
                      <textarea
                        value={outcome}
                        onChange={(e) => setOutcome(e.target.value.slice(0, OUTCOME_MAX))}
                        placeholder="the outcome · the data · what played out"
                        rows={2}
                        disabled={submitting}
                        className={cn(
                          "w-full resize-y rounded-md bg-[var(--bg-raised)] border border-[var(--border-default)]",
                          "text-[11px] leading-snug px-2 py-1.5 text-[var(--text-primary)]",
                          "placeholder:text-[var(--text-tertiary)]",
                          "focus:border-[var(--gold)]/40 focus:outline-none transition-colors",
                          "min-h-[36px]",
                        )}
                        aria-label="what actually happened"
                      />
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[8px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mr-1">
                        score
                      </span>
                      {(["wrong", "mixed", "right"] as ScoreChoice[]).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setScore((cur) => (cur === s ? null : s))}
                          disabled={submitting}
                          aria-pressed={score === s}
                          className={cn(
                            "px-2 py-0.5 rounded border text-[9px] font-mono lowercase tracking-wide transition-colors",
                            "min-h-[24px] flex items-center",
                            score === s
                              ? s === "wrong"
                                ? "border-rose-400/50 bg-rose-400/15 text-rose-300"
                                : s === "right"
                                  ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300"
                                  : "border-[var(--text-tertiary)]/50 bg-[var(--bg-raised)] text-[var(--text-secondary)]"
                              : "border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
                          )}
                        >
                          {SCORE_LABELS[s]}
                        </button>
                      ))}
                    </div>

                    <div>
                      <label className="block text-[8px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-0.5">
                        lesson <span className="opacity-60">(optional)</span>
                      </label>
                      <textarea
                        value={lesson}
                        onChange={(e) => setLesson(e.target.value.slice(0, LESSON_MAX))}
                        placeholder="what you'd do differently · what's worth remembering"
                        rows={2}
                        disabled={submitting}
                        className={cn(
                          "w-full resize-y rounded-md bg-[var(--bg-raised)] border border-[var(--border-default)]",
                          "text-[11px] leading-snug px-2 py-1.5 text-[var(--text-primary)]",
                          "placeholder:text-[var(--text-tertiary)]",
                          "focus:border-[var(--gold)]/40 focus:outline-none transition-colors",
                          "min-h-[36px]",
                        )}
                        aria-label="lesson (optional)"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-mono text-[var(--text-tertiary)]">
                        {outcome.length}/{OUTCOME_MAX}
                        {lesson.length > 0 && ` · ${lesson.length}/${LESSON_MAX}`}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={closeForm}
                          disabled={submitting}
                          className="px-2 py-1 rounded text-[10px] font-mono text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                        >
                          cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => submitLesson(row.id)}
                          disabled={submitting || outcome.trim().length === 0}
                          className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1 rounded border text-[10px] font-bold uppercase tracking-wider transition-colors",
                            "min-h-[28px]",
                            submitting
                              ? "bg-[var(--bg-surface)] border-[var(--border-hover)] text-[var(--text-tertiary)]"
                              : outcome.trim().length === 0
                                ? "bg-transparent border-[var(--border-default)] text-[var(--text-tertiary)] cursor-not-allowed"
                                : "bg-[var(--gold)]/15 border-[var(--gold)]/40 text-[var(--gold)] hover:bg-[var(--gold)]/25",
                          )}
                          aria-label="log lesson"
                        >
                          {submitting ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                          {submitting ? "logging…" : "log"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
          {more > 0 && (
            <li className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              + {more} more queued
            </li>
          )}
        </ul>
      ) : (
        <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
          no replays queued · the cron will pick fresh decisions tomorrow morning
        </p>
      )}

      {mostRecent && mostRecent.lesson && (
        <p className="mt-2 border-t border-[var(--border-default)]/30 pt-2 text-[10px] italic text-[var(--text-tertiary)]">
          last lesson{" "}
          <span className="not-italic text-[var(--text-secondary)]">
            “{trimText(mostRecent.lesson, 110)}”
          </span>
        </p>
      )}
    </GlassCard>
  );
}
