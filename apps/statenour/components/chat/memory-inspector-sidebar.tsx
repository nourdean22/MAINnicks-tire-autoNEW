"use client";

import React, { useState } from "react";
import { AlertTriangle, ShieldCheck, X } from "lucide-react";
import type { QualityPayload } from "@/components/chat/quality-bar";
import { WEAK_MATCH_BELOW, splitWeakTail } from "@/lib/chat/recall-display";
import { useInspector } from "@/hooks/use-inspector";

/** U2 · the source of a recalled memory: the universal memory inspector (?inspect=memory:<id>). */
function OpenMemoryButton({ id, category, onOpened }: { id: string; category: string; onOpened?: () => void }) {
  const { openInspector } = useInspector();
  return (
    <button
      type="button"
      onClick={() => {
        openInspector({ kind: "memory", id });
        onOpened?.();
      }}
      aria-label={`Open this ${category} memory`}
      className="-my-3 -mr-2 flex min-h-11 items-center rounded-control px-2 text-fg-secondary hover:bg-surface hover:text-fg"
    >
      Open
    </button>
  );
}

export interface MemoryHit {
  id: string;
  content: string;
  category: string;
  similarity: number;
}

export interface MemoryInspectorSidebarProps {
  open: boolean;
  onClose: () => void;
  hits: MemoryHit[];
  /** When the recall shown here was fetched — UI-2: evidence without a
   *  timestamp is a claim, not evidence. Null = not fetched yet. */
  fetchedAt?: Date | null;
  /** WP-11 (2026-07-29): the latest assistant turn's persisted quality
   *  verdicts — gate · critic · factCheck · truth · receipt. Undefined
   *  when no blob has been persisted yet (live turn, or old history). */
  reply?: QualityPayload;
  /**
   * 2026-09-10 · why `hits` is the length it is.
   *
   * "(0) No semantic memory hits retrieved" used to render for FOUR
   * different states: a real no-match, a fail-soft query embedding, a 3s
   * timeout, and a thrown error. Only the first is a fact about Nick's
   * memory; the other three are a broken instrument, and showing them as
   * "Nick believes nothing about you" is the single most trust-
   * destroying thing this panel can do.
   *
   * Undefined on older turns persisted before this shipped -- rendered
   * as "not recorded", never silently as a measured zero.
   */
  recallProvenance?: "OK" | "ZERO" | "ERROR" | "UNMEASURED";
  recallProvenanceReason?: string;
  /**
   * W3b (UI v3): at xl the island docks this beside the conversation as a column of its own, on the
   * raised surface so the evidence reads as a separate plane from the reading canvas. Below xl it
   * stays the fixed overlay it was.
   */
  docked?: boolean;
  /**
   * U2 (2026-10-30) · where `hits` came from. "turn" = the stream's memory.recalled event: what
   * recall returned for this turn (the prompt may use part of it: with NICK_RECALL_ARBITER on, an
   * arbitrated pack is built from these and other sources). "preview" = recall re-run on the last
   * message after the fact (a reload, an old thread). Undefined = unknown.
   */
  recallSource?: "turn" | "preview";
}

export const MemoryInspectorSidebar: React.FC<MemoryInspectorSidebarProps> = ({
  open,
  onClose,
  hits,
  fetchedAt,
  reply,
  recallProvenance,
  recallProvenanceReason,
  docked = false,
  recallSource,
}) => {
  // Open for THIS list only: a new turn's list starts folded again.
  const [weakOpenFor, setWeakOpenFor] = useState<MemoryHit[] | null>(null);
  if (!open) return null;
  const showWeak = weakOpenFor === hits;
  // A degraded read is lexical-only: its scores are not cosine, so nothing folds.
  const { strong, weak } = recallProvenance === "OK" ? splitWeakTail(hits) : { strong: hits, weak: [] };
  const shown = showWeak ? hits : strong;
  // Absolute time, not "Ns ago": render stays pure (no Date.now() during
  // render — react-compiler purity rule) and an absolute stamp is the more
  // honest receipt anyway.
  const freshness = fetchedAt
    ? `recalled at ${fetchedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}`
    : "not yet fetched: open state, not evidence";

  return (
    <div
      className={
        docked
          ? "relative flex h-full w-96 shrink-0 flex-col border-l border-edge-default bg-surface-raised"
          : "fixed inset-y-0 right-0 z-50 w-80 md:w-96 bg-overlay border-l border-edge-default shadow-l1 flex flex-col animate-fadeSlideLeft"
      }
    >
      <div className="flex justify-between items-center py-1 pl-4 pr-1 border-b border-edge-subtle">
        {/* audit 002 #3 (R-04): no Brain or Sparkles glyph; the words name the panel and the list. */}
        <div className="flex items-center space-x-2">
          <span className="text-[13px] font-semibold text-fg">
            Context &amp; Evidence
          </span>
        </div>
        {/* 44px: the floor every control keeps (it was a bare 16px icon). */}
        <button type="button" onClick={onClose} aria-label="Close context and memory" className="flex h-11 w-11 items-center justify-center rounded-control text-fg-secondary transition-colors duration-[var(--motion-state)] hover:bg-surface hover:text-fg">
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>

      {/* UI-2: the epistemics line — memory vs evidence is the
          distinction that keeps this panel honest. */}
      <div className="px-4 pt-3 pb-1">
        <p className="text-[11px] text-fg-tertiary leading-relaxed">
          Memory is what Nick believes · evidence is why to trust this answer.
        </p>
        <p className="text-[11px] font-mono text-fg-tertiary mt-0.5">{freshness}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* WP-11 · Reply verdicts — why the last answer was allowed,
            rewritten, warned, or flagged. Reads the SAME persisted
            tokenUsage blob the quality bar reads — one source, no drift. */}
        <div>
          <div className="flex items-center space-x-1 text-sky-400 mb-3">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span className="font-mono text-[11px] font-medium">
              This reply: quality verdicts
            </span>
          </div>
          {!reply ? (
            <p className="text-[11px] text-fg-tertiary italic">
              No quality metadata persisted yet, a live turn finalizes after the
              stream ends; older conversations may predate the verdict blob.
            </p>
          ) : (
            <div className="space-y-2 text-[11px]">
              {reply.gate && (
                <div className="bg-surface/50 border border-edge-subtle p-2.5 rounded-surface">
                  <div className="flex justify-between text-[11px] font-mono text-fg-tertiary mb-0.5">
                    <span>reply gate</span>
                    <span className={reply.gate.shouldRegen ? "text-amber-400" : "text-emerald-400"}>
                      {reply.gate.shouldRegen ? "Flagged for regen" : "Passed"} · sev {reply.gate.severity ?? 0}
                    </span>
                  </div>
                  {(reply.gate.reasons ?? []).length > 0 && (
                    <p className="text-fg-secondary">{(reply.gate.reasons ?? []).join(" · ")}</p>
                  )}
                </div>
              )}
              {reply.critic && (
                <div className="bg-surface/50 border border-edge-subtle p-2.5 rounded-surface">
                  <div className="flex justify-between text-[11px] font-mono text-fg-tertiary mb-0.5">
                    <span>output critic</span>
                    <span className={reply.critic.shouldRegen ? "text-amber-400" : "text-emerald-400"}>
                      {reply.critic.overall ?? "n/a"}/100{reply.critic.shouldRegen ? " · would regen" : ""}
                    </span>
                  </div>
                  {(reply.critic.reasons ?? []).length > 0 && (
                    <p className="text-fg-secondary">{(reply.critic.reasons ?? []).slice(0, 3).join(" · ")}</p>
                  )}
                </div>
              )}
              {reply.receipt && (
                <div
                  className={`border p-2.5 rounded-surface ${
                    reply.receipt.ok === false
                      ? "bg-rose-950/10 border-rose-900/30"
                      : "bg-surface/50 border-edge-subtle"
                  }`}
                >
                  <div className="flex justify-between text-[11px] font-mono text-fg-tertiary mb-0.5">
                    <span>action receipts</span>
                    <span className={reply.receipt.ok === false ? "text-rose-400" : "text-emerald-400"}>
                      {reply.receipt.ok === false
                        ? "CLAIM WITHOUT RECEIPT: banner applied"
                        : `${(reply.receipt.toolsFired ?? []).length} tool call(s) receipted`}
                    </span>
                  </div>
                  {(reply.receipt.offenders ?? []).length > 0 && (
                    <p className="text-rose-300">
                      {(reply.receipt.offenders ?? [])
                        .map((o) => `${o.label || o.toolName} (${o.status})`)
                        .join(" · ")}
                    </p>
                  )}
                </div>
              )}
              {reply.truth && (reply.truth.total ?? 0) > 0 && (
                <div className="bg-amber-950/10 border border-amber-900/30 p-2.5 rounded-surface">
                  <div className="text-[11px] font-mono text-amber-400 mb-0.5">
                    known-truth flags ({reply.truth.total})
                  </div>
                  <p className="text-fg-secondary">
                    {(reply.truth.flags ?? [])
                      .slice(0, 3)
                      .map((f) => f.rule || f.kind)
                      .join(" · ")}
                  </p>
                </div>
              )}
              {reply.factCheck && (
                <div className="bg-surface/50 border border-edge-subtle p-2.5 rounded-surface">
                  <div className="flex justify-between text-[11px] font-mono text-fg-tertiary">
                    <span>fact check</span>
                    <span className={(reply.factCheck.unverified ?? 0) > 0 ? "text-amber-400" : "text-emerald-400"}>
                      {reply.factCheck.unverified ?? 0}/{reply.factCheck.total ?? 0} unverified
                    </span>
                  </div>
                </div>
              )}
              {!reply.gate && !reply.critic && !reply.receipt && !reply.truth && !reply.factCheck && (
                <p className="text-fg-tertiary italic">
                  Blob present but carries no verdicts, nothing fired this turn.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Memory Hits Section */}
        <div>
          <div className="flex items-center space-x-1 text-fg-tertiary mb-3">
            <span className="font-mono text-[11px] font-medium">
              {recallSource === "turn"
                ? `Recalled for this turn (${hits.length})`
                : recallSource === "preview"
                  ? `Recall preview for your last message (${hits.length})`
                  : `Remembered: what Nick believes (${hits.length})`}
            </span>
          </div>
          {recallSource && hits.length > 0 ? (
            <p className="text-[11px] text-fg-tertiary mb-3">
              {recallSource === "turn"
                ? "What memory recall returned for this message. Nick's prompt may use part of it."
                : "Run again just now. The reply may have used different memories."}
            </p>
          ) : null}
          {/*
            2026-09-10 (review) · a DEGRADED read that still returned
            hits must not render as a clean one.

            The provenance branches below only fire when `hits` is
            empty, so the exact case the outage path was built to
            produce -- dense retrieval down, lexical fallback returning
            real rows, `provenance: "ERROR"` -- rendered as an ordinary
            list with per-hit "% Match" scores and no hint that ranking
            was degraded. The producer's own comment says "callers must
            not read this as a clean result"; this is the consumer
            finally honouring it.
          */}
          {hits.length > 0 && recallProvenance && recallProvenance !== "OK" ? (
            <div className="flex items-start space-x-1.5 mb-3">
              <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-[11px] text-amber-300/90">
                Degraded retrieval: these hits are real, but ranking is weaker than usual.
                {recallProvenanceReason ? (
                  <span className="block text-[11px] text-fg-tertiary mt-0.5">
                    {recallProvenanceReason}
                  </span>
                ) : null}
              </p>
            </div>
          ) : null}
          {hits.length === 0 ? (
            // THREE STATES, never two. A failed read must not wear the
            // same clothes as an empty one.
            recallProvenance === "ERROR" ? (
              <div className="flex items-start space-x-1.5">
                <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
                <p className="text-[11px] text-amber-300/90">
                  Memory read failed: state unknown, not empty.
                  {recallProvenanceReason ? (
                    <span className="block text-[11px] text-fg-tertiary mt-0.5">
                      {recallProvenanceReason}
                    </span>
                  ) : null}
                </p>
              </div>
            ) : recallProvenance === "UNMEASURED" ? (
              <p className="text-[11px] text-fg-tertiary italic">
                Memory was not queried this turn.
                {recallProvenanceReason ? (
                  <span className="block text-[11px] text-fg-tertiary mt-0.5">
                    {recallProvenanceReason}
                  </span>
                ) : null}
              </p>
            ) : recallProvenance === "ZERO" ? (
              <p className="text-[11px] text-fg-tertiary italic">
                Searched memory: nothing matched this turn.
              </p>
            ) : (
              // Pre-2026-09-10 turns carry no provenance. Say that,
              // rather than asserting a measured zero we cannot support.
              <p className="text-[11px] text-fg-tertiary italic">
                No hits recorded for this turn (retrieval state not captured).
              </p>
            )
          ) : (
            <div className="space-y-3">
              {shown.map((hit) => (
                <div key={hit.id} className="bg-surface/50 border border-edge-subtle p-3 rounded-surface">
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-fg-tertiary mb-1">
                    <span>{hit.category}</span>
                    <span className="ml-auto">{(hit.similarity * 100).toFixed(0)}% match</span>
                    {/* hit-N ids are the preview's placeholders for rows with no id: nothing to open. */}
                    {/^hit-\d+$/.test(hit.id) ? null : <OpenMemoryButton
                        id={hit.id}
                        category={hit.category}
                        // Undocked this panel is a z-50 overlay; the inspector's side panel sits at z-45 under it.
                        onOpened={docked ? undefined : onClose}
                      />}
                  </div>
                  <p className="text-[11px] text-fg-secondary whitespace-pre-wrap">{hit.content}</p>
                </div>
              ))}
              {weak.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setWeakOpenFor(showWeak ? null : hits)}
                  aria-expanded={showWeak}
                  className="flex min-h-11 w-full items-center rounded-control px-2 text-left text-[11px] text-fg-tertiary hover:bg-surface hover:text-fg"
                >
                  {showWeak
                    ? `Hide ${weak.length} weak ${weak.length === 1 ? "match" : "matches"}`
                    : `${weak.length} weak ${weak.length === 1 ? "match" : "matches"} hidden (under ${Math.round(WEAK_MATCH_BELOW * 100)}%). Show`}
                </button>
              ) : null}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
