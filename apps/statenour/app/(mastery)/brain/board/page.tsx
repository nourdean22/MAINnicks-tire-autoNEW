"use client";

/**
 * /brain/board · task #24 (2026-05-23) · multi-advisor board surface.
 *
 * The strategic-intelligence amplifier. Operator picks a pre-configured
 * board (strategic · invest · product · operator · full), types a
 * question, and gets:
 *
 *   · A SYNTHESIS card on top · recommendation + consensus + divergences
 *     + tension axis + confidence
 *   · One ADVISOR TAKE per board member · expandable · preserves the
 *     advisor's distinct lens · the WHOLE point of the pattern (the
 *     existing strategic-frameworks lens-injection in Nick FUSES lenses
 *     into one answer · this surface KEEPS them distinct so divergence
 *     stays visible)
 *
 * Below the live consultation · a "recent consultations" list of past
 * runs persisted as `board_consultation` BrainMemory rows · operator
 * can scroll back through old strategic decisions.
 *
 * Editorial-minimalist per docs/aesthetic-principles.md · gold-on-dark
 * · glass cards · 10-12px uppercase font-mono eyebrows · no purple
 * (board surface uses gold for the synthesis, zinc tones for advisor
 * takes, subtle amber when divergence is flagged).
 */

import { useState } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { trpc } from "@/lib/trpc/client";

// Local mirror of BOARDS' display data · the boards module exports
// BOARD_IDS as a const tuple for the tRPC enum but the human labels
// + one-liners are easier to keep co-located with the page rendering.
// If the operator adds a 6th board, update here AND lib/ai/board/boards.ts.
const BOARD_OPTIONS: ReadonlyArray<{
  id: "strategic" | "invest" | "product" | "operator" | "full";
  name: string;
  oneLiner: string;
}> = [
  {
    id: "strategic",
    name: "strategic",
    oneLiner: "major life/career decisions · 5 lenses",
  },
  {
    id: "invest",
    name: "invest",
    oneLiner: "capital + pricing + financial",
  },
  {
    id: "product",
    name: "product",
    oneLiner: "product / feature / market direction",
  },
  {
    id: "operator",
    name: "operator",
    oneLiner: "personal decision quality + tempo",
  },
  {
    id: "full",
    name: "full",
    oneLiner: "critical decisions · 8 advisors · slower + costlier",
  },
];

type BoardId = (typeof BOARD_OPTIONS)[number]["id"];

function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

export default function BrainBoardPage() {
  const [boardId, setBoardId] = useState<BoardId>("strategic");
  const [question, setQuestion] = useState("");
  const [expandedTakes, setExpandedTakes] = useState<Set<string>>(new Set());

  const consultMutation = trpc.brain.consultBoard.useMutation();
  const utils = trpc.useUtils();
  const recentQuery = trpc.brain.recentBoardConsultations.useQuery({
    limit: 10,
  });

  const result = consultMutation.data?.consultation ?? null;
  const recents = recentQuery.data?.consultations ?? [];

  async function onConsult() {
    if (question.trim().length < 8) return;
    try {
      await consultMutation.mutateAsync({
        boardId,
        question: question.trim(),
      });
      void utils.brain.recentBoardConsultations.invalidate();
    } catch {
      // mutation error surfaces via consultMutation.error · UI shows it
    }
  }

  const toggleExpanded = (advisorId: string) => {
    setExpandedTakes((prev) => {
      const next = new Set(prev);
      if (next.has(advisorId)) next.delete(advisorId);
      else next.add(advisorId);
      return next;
    });
  };

  const canConsult =
    !consultMutation.isPending && question.trim().length >= 8;

  return (
    <StandardPage
      eyebrow="brain"
      title="board"
      description="multi-advisor board · N lenses in parallel · preserves divergence rather than fusing into one answer · use when a decision has compound consequences."
      width="md"
      rhythm="comfortable"
    >
      {/* ── Board selector · row of chips ───────────────────────── */}
      <div>
        <p className="mb-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          board
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          {BOARD_OPTIONS.map((b) => {
            const isActive = b.id === boardId;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setBoardId(b.id)}
                aria-pressed={isActive}
                title={b.oneLiner}
                className={
                  "min-h-[36px] px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-[0.14em] border transition-colors " +
                  (isActive
                    ? "border-[var(--gold)]/60 bg-[var(--gold)]/10 text-[var(--gold)]"
                    : "border-[var(--border-default)] bg-[var(--bg-raised)]/[0.03] text-[var(--text-secondary)] hover:border-[var(--gold)]/30 hover:text-[var(--gold)]")
                }
              >
                {b.name}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[10px] font-mono text-[var(--text-tertiary)]">
          {BOARD_OPTIONS.find((b) => b.id === boardId)?.oneLiner}
        </p>
      </div>

      {/* ── Question + consult button ──────────────────────────── */}
      <div className="space-y-2">
        <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          question
        </p>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="should I push price up on brake jobs by $20?"
          rows={3}
          className="w-full bg-[var(--bg-raised)]/[0.03] border border-[var(--border-default)] rounded-lg p-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--gold)]/40 hover:border-[var(--gold)]/30 transition-colors resize-y"
          maxLength={4000}
        />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
            {question.length}/4000 · need ≥8 chars
          </span>
          <button
            type="button"
            onClick={onConsult}
            disabled={!canConsult}
            className={
              "min-h-[44px] px-4 py-2 rounded-full text-[11px] font-mono uppercase tracking-[0.16em] border transition-colors " +
              (canConsult
                ? "border-[var(--gold)]/60 bg-[var(--gold)]/10 text-[var(--gold)] hover:bg-[var(--gold)]/15"
                : "border-[var(--border-default)] bg-[var(--bg-raised)]/[0.03] text-[var(--text-tertiary)] cursor-not-allowed")
            }
          >
            {consultMutation.isPending ? "consulting..." : "consult board"}
          </button>
        </div>
      </div>

      {/* ── Error shell ────────────────────────────────────────── */}
      {consultMutation.isError && (
        <div className="rounded border border-red-500/30 bg-red-500/[0.04] px-3 py-3 text-[11px] text-red-300">
          consultation failed · {consultMutation.error?.message ?? "unknown"}
        </div>
      )}

      {/* ── SYNTHESIS card · top of result · the operator's primary read ── */}
      {result && (
        <div className="rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/[0.04] p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]">
              synthesis · {result.boardName.toLowerCase()}
            </span>
            <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
              {Math.round(result.synthesis.confidence * 100)}% confidence
            </span>
            <span className="ml-auto text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
              {result.durationMs}ms · {result.takes.length} advisors
            </span>
          </div>

          {/* Recommendation · the lean · biggest font size on the page */}
          <p className="text-sm leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap">
            {result.synthesis.recommendation}
          </p>

          {/* Tension axis · only when present · the highest-signal divergence */}
          {result.synthesis.tension && (
            <div className="border-t border-[var(--gold)]/20 pt-2.5">
              <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-amber-400/80 mb-1">
                tension
              </p>
              <p className="text-[12px] text-[var(--text-secondary)]">
                {result.synthesis.tension}
              </p>
            </div>
          )}

          {/* Consensus bullets */}
          {result.synthesis.consensus.length > 0 && (
            <div className="border-t border-[var(--gold)]/20 pt-2.5">
              <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-tertiary)] mb-1">
                consensus
              </p>
              <ul className="space-y-1 text-[12px] text-[var(--text-secondary)]">
                {result.synthesis.consensus.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-[var(--gold)]/60">·</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Divergences · where the board split */}
          {result.synthesis.divergences.length > 0 && (
            <div className="border-t border-[var(--gold)]/20 pt-2.5">
              <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-amber-400/80 mb-1">
                divergence
              </p>
              <ul className="space-y-1 text-[12px] text-[var(--text-secondary)]">
                {result.synthesis.divergences.map((d, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-amber-400/50">·</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Advisor takes · one per board member · expandable ──── */}
      {result && result.takes.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            advisor takes ({result.takes.length})
          </p>
          {result.takes.map((take) => {
            const isExpanded = expandedTakes.has(take.advisorId);
            const isErrored = !!take.error;
            return (
              <div
                key={take.advisorId}
                className={
                  "rounded-lg border bg-[var(--bg-raised)]/[0.03] p-3 space-y-2 " +
                  (isErrored
                    ? "border-red-500/20"
                    : "border-[var(--border-default)]")
                }
              >
                <button
                  type="button"
                  onClick={() => toggleExpanded(take.advisorId)}
                  aria-expanded={isExpanded}
                  className="w-full text-left flex items-start gap-2 flex-wrap"
                >
                  <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-[var(--text-primary)]">
                    {take.advisorName.toLowerCase()}
                  </span>
                  {isErrored ? (
                    <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-red-400">
                      errored
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
                      {Math.round(take.confidence * 100)}%
                    </span>
                  )}
                  {take.divergenceFlag && (
                    <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-amber-400/80">
                      ⚡ divergence
                    </span>
                  )}
                  <span className="ml-auto text-[10px] font-mono text-[var(--text-tertiary)]">
                    {isExpanded ? "−" : "+"}
                  </span>
                </button>

                {/* Always-visible one-line summary · the scannable lens. */}
                <p className="text-[12px] italic text-[var(--text-secondary)]">
                  {take.lensOneLine}
                </p>

                {/* Expanded · insight + recommendation + divergence flag. */}
                {isExpanded && (
                  <div className="space-y-2 pt-1 border-t border-[var(--border-default)]/40">
                    {take.error ? (
                      <p className="text-[11px] text-red-300 font-mono">
                        {take.error}
                      </p>
                    ) : (
                      <>
                        <div>
                          <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-tertiary)] mb-0.5">
                            insight
                          </p>
                          <p className="text-[12px] text-[var(--text-secondary)]">
                            {take.keyInsight}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-tertiary)] mb-0.5">
                            recommendation
                          </p>
                          <p className="text-[12px] text-[var(--text-primary)]">
                            {take.recommendation}
                          </p>
                        </div>
                        {take.divergenceFlag && (
                          <div>
                            <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-amber-400/80 mb-0.5">
                              divergence flag
                            </p>
                            <p className="text-[12px] text-[var(--text-secondary)]">
                              {take.divergenceFlag}
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Recent consultations · scroll-back history ────────── */}
      {recents.length > 0 && (
        <div className="pt-4 border-t border-[var(--border-default)] space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            recent consultations ({recents.length})
          </p>
          <ul className="space-y-1.5">
            {recents.map((r) => (
              <li
                key={r.id}
                className="rounded border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02] px-3 py-2 space-y-1"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--gold)]/80">
                    {r.boardId}
                  </span>
                  <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
                    {Math.round(r.confidence * 100)}%
                  </span>
                  {r.divergenceCount > 0 && (
                    <span className="text-[10px] font-mono text-amber-400/80">
                      ⚡ {r.divergenceCount} div
                    </span>
                  )}
                  <span className="ml-auto text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
                    {formatRelative(r.createdAt)}
                  </span>
                </div>
                <p className="text-[12px] text-[var(--text-secondary)] line-clamp-1">
                  &quot;{r.question}&quot;
                </p>
                <p className="text-[11px] text-[var(--text-tertiary)] line-clamp-2">
                  → {r.recommendation}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </StandardPage>
  );
}
