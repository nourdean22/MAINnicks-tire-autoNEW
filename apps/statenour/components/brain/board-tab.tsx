"use client";

/**
 * BoardTab · the Board section of the merged /brain surface (Wave 2).
 *
 * Moved verbatim from the former app/(mastery)/brain/board/page.tsx — the
 * only change is the outer <StandardPage> wrapper became a fragment (the
 * page-level chrome now lives on /brain), and the former StandardPage
 * `description` moved into an inline subtitle at the top of the fragment
 * so nothing is lost. The board selector, question/consult flow, synthesis
 * card, advisor takes, and recent-consultations list are unchanged.
 *
 * The strategic-intelligence amplifier. Operator picks a pre-configured
 * board (strategic · invest · product · operator · full), types a
 * question, and gets a SYNTHESIS card + one ADVISOR TAKE per board
 * member · expandable · preserves divergence rather than fusing lenses
 * into one answer.
 *
 * Editorial-minimalist per docs/aesthetic-principles.md · gold-on-dark
 * · glass cards · 10-12px font-mono eyebrows · no purple.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { BOARDS, BOARD_IDS } from "@/lib/ai/board/boards";
import type { BoardId } from "@/lib/ai/board/types";

// 2026-09-02 · this was a hand-maintained mirror of five of the six boards.
// Its own comment said "If the operator adds a 6th board, update here AND
// lib/ai/board/boards.ts" — the 6th board (`team`, Working Team, 5 AG-12
// personas) shipped 2026-07-09 in AG-42, five weeks AFTER this file was last
// touched, and the instruction was not followed. The board has been accepted
// by the tRPC procedure and reachable from the chat tool ever since, and
// invisible on the one surface built to select boards.
//
// The type system could not catch it: `BoardId` was derived FROM the mirror,
// so a five-of-six subset compiled cleanly against the server's six-value
// union. A comment was the only guard, and comments do not fail builds.
//
// The mirror was also unnecessary. BOARDS already carries `name` and
// `oneLiner` for every board, so this deletes the duplicate rather than
// repairing it — deriving the options means a seventh board appears here the
// moment it is defined, with no second edit and nothing to forget.
const BOARD_OPTIONS: ReadonlyArray<{
  id: BoardId;
  name: string;
  oneLiner: string;
}> = BOARD_IDS.map((id) => ({
  id,
  name: BOARDS[id].name,
  oneLiner: BOARDS[id].oneLiner,
}));

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

export function BoardTab() {
  // First board in display order, rather than a literal. Identical value
  // today; the point is that no board id is spelled out in this file, so the
  // canary can assert that flatly instead of carving out an exception a future
  // mirror could hide behind.
  const [boardId, setBoardId] = useState<BoardId>(BOARD_IDS[0]);
  const [question, setQuestion] = useState("");
  const [expandedTakes, setExpandedTakes] = useState<Set<string>>(new Set());

  const consultMutation = trpc.brain.consultBoard.useMutation();
  const utils = trpc.useUtils();
  const recentQuery = trpc.brain.recentBoardConsultations.useQuery({
    limit: 10,
  });

  const result = consultMutation.data?.consultation ?? null;
  const recents = recentQuery.data?.consultations ?? [];

  // 2026-09-02 · the mood gate, made visible.
  //
  // lib/ai/board/consult.ts MOOD_DROP_RULES removes 3 of the strategic
  // board's 5 advisors when mood=depleted and 4 when mood=scattered. The
  // routing shipped 2026-05-23 with a comment claiming the "operator can
  // see WHICH state drove the routing + which advisors got gated out";
  // grepping the whole client tree for `droppedAdvisorIds` returned
  // nothing. On a depleted day the board chip promised 5 lenses, the
  // header said "3 advisors", and the difference was unexplained on a
  // surface whose entire premise is that it preserves divergence.
  //
  // `takes` are the advisors that RAN, `droppedAdvisorIds` the ones the
  // gate removed before the fan-out, so their sum is the board as the
  // operator curated it. Rendering the denominator is what turns "3
  // advisors" from a silent subtraction into a stated one.
  const dropped = result?.droppedAdvisorIds ?? [];
  const boardSize = result ? result.takes.length + dropped.length : 0;
  const gatingMood = result?.operatorState?.mood ?? null;

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
    <>
      <p className="text-sm text-[var(--text-secondary)] mb-4" style={{ maxWidth: "60ch" }}>
        multi-advisor board · N lenses in parallel · preserves divergence
        rather than fusing into one answer · use when a decision has
        compound consequences.
      </p>

      {/* ── Board selector · row of chips ───────────────────────── */}
      <div>
        <p className="mb-2 text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary">
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
                  "min-h-[36px] px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors duration-[var(--motion-state)] " +
                  (isActive
                    ? "border-accent bg-surface-interactive text-fg"
                    : "border-edge-default text-fg-secondary hover:border-edge-strong hover:text-fg")
                }
              >
                {b.name}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] font-mono text-[var(--text-tertiary)]">
          {BOARD_OPTIONS.find((b) => b.id === boardId)?.oneLiner}
        </p>
      </div>

      {/* ── Question + consult button ──────────────────────────── */}
      <div className="space-y-2 mt-5">
        <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary">
          question
        </p>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="should I push price up on brake jobs by $20?"
          rows={3}
          className="w-full bg-[var(--bg-raised)]/[0.03] border border-[var(--border-default)] rounded-control p-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-accent hover:border-edge-strong transition-colors resize-y"
          maxLength={4000}
        />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[11px] font-mono tabular-nums text-[var(--text-tertiary)]">
            {question.length}/4000 · need ≥8 chars
          </span>
          <button
            type="button"
            onClick={onConsult}
            disabled={!canConsult}
            className={
              "inline-flex min-h-[44px] items-center gap-1.5 rounded-control border px-4 text-[13px] font-medium transition-colors duration-[var(--motion-state)] " +
              (canConsult
                ? "border-edge-default text-fg-secondary hover:border-edge-strong hover:text-fg"
                : "border-edge-subtle text-fg-tertiary cursor-not-allowed")
            }
          >
            {consultMutation.isPending ? "Consulting..." : "Consult board"}
          </button>
        </div>
      </div>

      {/* ── Error shell ────────────────────────────────────────── */}
      {consultMutation.isError && (
        <div className="rounded-micro border border-red-500/30 bg-red-500/[0.04] px-3 py-3 text-[11px] text-red-300 mt-5">
          consultation failed · {consultMutation.error?.message ?? "unknown"}
        </div>
      )}

      {/* ── SYNTHESIS card · top of result · the operator's primary read ── */}
      {result && (
        <div className="rounded-surface border border-edge-subtle bg-content p-4 space-y-3 mt-5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono text-fg-secondary">
              synthesis · {result.boardName.toLowerCase()}
            </span>
            <span className="text-[11px] font-mono tabular-nums text-[var(--text-tertiary)]">
              {Math.round(result.synthesis.confidence * 100)}% confidence
            </span>
            <span className="ml-auto text-[11px] font-mono tabular-nums text-[var(--text-tertiary)]">
              {result.durationMs}ms ·{" "}
              {dropped.length > 0
                ? `${result.takes.length} of ${boardSize} advisors`
                : `${result.takes.length} advisors`}
            </span>
          </div>

          {/* Mood gate · WHICH lenses were withheld and WHY. Rendered
              inside the synthesis card because it qualifies the
              recommendation directly: this is the board minus N lenses,
              and the operator is entitled to know which N before acting
              on a decision described as having compound consequences. */}
          {dropped.length > 0 && (
            <div className="border-t border-amber-400/20 pt-2.5">
              <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-amber-400/80 mb-1">
                lenses withheld ({dropped.length})
              </p>
              <p className="text-[12px] text-[var(--text-secondary)]">
                {gatingMood
                  ? `your state read as ${gatingMood} · these lenses were gated out before the board ran: `
                  : "these lenses were gated out before the board ran: "}
                <span className="font-mono text-[11px] text-amber-300/90">
                  {dropped.join(" · ")}
                </span>
              </p>
              <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                they were never consulted · the synthesis above does not
                speak for them
              </p>
            </div>
          )}

          {/* Recommendation · the lean · biggest font size on the page */}
          <p className="text-sm leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap">
            {result.synthesis.recommendation}
          </p>

          {/* Tension axis · only when present · the highest-signal divergence */}
          {result.synthesis.tension && (
            <div className="border-t border-edge-subtle pt-2.5">
              <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-amber-400/80 mb-1">
                tension
              </p>
              <p className="text-[12px] text-[var(--text-secondary)]">
                {result.synthesis.tension}
              </p>
            </div>
          )}

          {/* Consensus bullets */}
          {result.synthesis.consensus.length > 0 && (
            <div className="border-t border-edge-subtle pt-2.5">
              <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary mb-1">
                consensus
              </p>
              <ul className="space-y-1 text-[12px] text-[var(--text-secondary)]">
                {result.synthesis.consensus.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-fg-secondary">·</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Divergences · where the board split */}
          {result.synthesis.divergences.length > 0 && (
            <div className="border-t border-edge-subtle pt-2.5">
              <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-amber-400/80 mb-1">
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
        <div className="space-y-2 mt-5">
          <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary">
            advisor takes ({result.takes.length}
            {dropped.length > 0 ? ` of ${boardSize}` : ""})
          </p>
          {result.takes.map((take) => {
            const isExpanded = expandedTakes.has(take.advisorId);
            const isErrored = !!take.error;
            return (
              <div
                key={take.advisorId}
                className={
                  "rounded-surface border bg-[var(--bg-raised)]/[0.03] p-3 space-y-2 " +
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
                  <span className="text-[11px] font-mono text-[var(--text-primary)]">
                    {take.advisorName.toLowerCase()}
                  </span>
                  {isErrored ? (
                    <span className="text-[11px] font-mono text-red-400">
                      errored
                    </span>
                  ) : (
                    <span className="text-[11px] font-mono tabular-nums text-[var(--text-tertiary)]">
                      {Math.round(take.confidence * 100)}%
                    </span>
                  )}
                  {take.divergenceFlag && (
                    <span className="text-[11px] font-mono text-amber-400/80">
                      ⚡ divergence
                    </span>
                  )}
                  <span className="ml-auto text-[11px] font-mono text-[var(--text-tertiary)]">
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
                          <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary mb-0.5">
                            insight
                          </p>
                          <p className="text-[12px] text-[var(--text-secondary)]">
                            {take.keyInsight}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary mb-0.5">
                            recommendation
                          </p>
                          <p className="text-[12px] text-[var(--text-primary)]">
                            {take.recommendation}
                          </p>
                        </div>
                        {take.divergenceFlag && (
                          <div>
                            <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-amber-400/80 mb-0.5">
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

      {/* ── Recent consultations · scroll-back history ──────────
          A failed query used to render as an ABSENT section: the guard
          was `recents.length > 0` over `data?.consultations ?? []`, so a
          503 and an empty history were pixel-identical and the operator
          was shown "you have no history" for "we could not read it".
          Same three honest states as components/brain/judgment-quality-
          panel.tsx:35-43 — loading, unknown, empty — never a silent gap. */}
      {recentQuery.isError && (
        <div className="pt-4 border-t border-[var(--border-default)] mt-5">
          <p className="rounded-micro border border-red-500/25 bg-red-500/[0.04] px-3 py-2.5 text-[11px] text-red-300">
            recent consultations couldn&apos;t load — state unknown, not
            empty · {recentQuery.error?.message ?? "unknown"}
          </p>
          <button
            type="button"
            onClick={() => void recentQuery.refetch()}
            className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
          >
            Retry
          </button>
        </div>
      )}

      {!recentQuery.isError && !recentQuery.isLoading && recents.length === 0 && (
        <div className="pt-4 border-t border-[var(--border-default)] mt-5">
          <p className="text-[11px] text-[var(--text-tertiary)]">
            no consultations recorded yet · the history builds as you use
            the board.
          </p>
        </div>
      )}

      {recents.length > 0 && (
        <div className="pt-4 border-t border-[var(--border-default)] space-y-2 mt-5">
          <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary">
            recent consultations ({recents.length})
          </p>
          <ul className="space-y-1.5">
            {recents.map((r) => (
              <li
                key={r.id}
                className="rounded-micro border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02] px-3 py-2 space-y-1"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-mono text-fg-secondary">
                    {r.boardId}
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-[var(--text-tertiary)]">
                    {Math.round(r.confidence * 100)}%
                  </span>
                  {r.divergenceCount > 0 && (
                    <span className="text-[11px] font-mono text-amber-400/80">
                      ⚡ {r.divergenceCount} div
                    </span>
                  )}
                  {/* The persisted gate verdict · without it a 3-advisor
                      row in history is indistinguishable from a 3-advisor
                      board, and the operator cannot tell why two lenses
                      are missing from a decision they already made. */}
                  {r.droppedAdvisorIds.length > 0 && (
                    <span
                      className="text-[11px] font-mono text-amber-400/80"
                      title={
                        (r.moodAtConsult ? `mood ${r.moodAtConsult} · ` : "") +
                        `gated out: ${r.droppedAdvisorIds.join(", ")}`
                      }
                    >
                      {r.advisorCount} of{" "}
                      {r.advisorCount + r.erroredCount + r.droppedAdvisorIds.length} lenses
                      {r.moodAtConsult ? ` · ${r.moodAtConsult}` : ""}
                    </span>
                  )}
                  {r.droppedAdvisorIds.length === 0 && r.erroredCount > 0 && (
                    <span className="text-[11px] font-mono text-red-400/80">
                      {r.erroredCount} errored
                    </span>
                  )}
                  <span className="ml-auto text-[11px] font-mono tabular-nums text-[var(--text-tertiary)]">
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
    </>
  );
}
