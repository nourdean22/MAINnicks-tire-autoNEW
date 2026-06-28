"use client";

/**
 * ContradictionsCard · v10.0.529.28 · Arc B Feature 5 · 10/10 pass
 *
 * Surfaces the contradiction-surfacer's unresolved positions for
 * operator resolution. Built to the FRONTEND-DESIGN ceiling rather
 * than the minimum-viable threshold · this card defines the visual
 * pattern for "two-position reconciliation" surfaces (replay,
 * contradiction, future Ghost Nick post-process).
 *
 * Data flow:
 *   · contradiction-surfacer.ts (apr 19) watches every persisted
 *     chat_importance / brain_dump_importance row · finds semantic
 *     neighbors ≥7d old with similarity ≥0.78 · detects negation /
 *     reversal / antonym / compound polarity flips · writes a
 *     BrainMemory(category="contradiction") row.
 *   · GET /api/system/contradictions?days=14&includeResolved=true
 *     returns both unresolved + resolved-this-window so this card
 *     can render the action surface AND a narrative footer in one
 *     fetch.
 *   · POST /api/system/contradictions/[key]/resolve wraps
 *     `resolveContradiction()` which deprecates the losing memory
 *     (confidence → 0.1) so the recall pipeline stops resurfacing it.
 *
 * Visual decisions (frontend-design · DFII 10):
 *
 *   1. EDITORIAL TYPOGRAPHIC HIERARCHY · the contradiction IS a
 *      temporal contrast · "now" reads at full weight + primary color
 *      while "Nd ago" reads desaturated + tertiary. The eye lands on
 *      the current position first by design. The label tokens
 *      ("now" gold-bright, "21d" faded-tertiary) extend the
 *      same temporal-fade language.
 *
 *   2. LEFT-EDGE TENSION GRADIENT · a 2px vertical rule per row that
 *      interpolates gold (top, current) → amber (bottom, stale) ·
 *      visualizes the polarity gap before the operator reads the
 *      text. Cheap perceptual signal · replaces what would otherwise
 *      need a paragraph of UI copy.
 *
 *   3. CURATED RESOLUTION ICONOGRAPHY · Scale for the toggle (signals
 *      "weighing two positions"), ArrowRight (current wins · forward
 *      motion), RotateCcw (old wins · revert), Equal (both valid),
 *      Slash (dismissed · cancel-out). Each icon CARRIES MEANING
 *      independently · the operator can resolve via icon recognition
 *      without reading the label.
 *
 *   4. CROSS-LINK COMPOSER SEED · tap "now" excerpt → opens /chat
 *      with a reconciliation prompt pre-loaded ("Help me reconcile:
 *      I said '<now>' but <N>d ago I said '<then>'. Which holds up?")
 *      so the deep-discussion path is one tap away · operator can
 *      EITHER resolve inline OR offload reasoning to Nick.
 *
 *   5. STATE-AWARE FOOTER NARRATIVE · resolved-this-week count + most
 *      recent surfaced as a single line · ages gracefully (drops
 *      from view as resolutions cool). When 0 resolved-this-week but
 *      unresolved exist · the footer encourages action.
 *
 *   6. ELON DELETIONS · raw `sim 0.85` removed (signal chip carries
 *      the same information categorically) · empty-state copy
 *      removed (card stays silent unless there's something to act on
 *      OR something to celebrate).
 *
 * Silent when: zero unresolved AND zero resolved-this-window.
 * Otherwise the card EARNS its slot · always carries operator-actionable
 * or narrative content, never just decoration.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Scale,
  ArrowRight,
  RotateCcw,
  Equal,
  Slash,
  X as XIcon,
  Loader2,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

type ContradictionStatus =
  | "unresolved"
  | "current_wins"
  | "old_wins"
  | "both_valid"
  | "dismissed";
type SignalKind = "negation" | "reversal" | "antonym" | "compound";

type ResolveChoice = Exclude<ContradictionStatus, "unresolved">;

const TOP_N = 3;
const PREVIEW_CHARS = 140;
const NOTE_MAX = 200;
const SEED_CAP = 1800;

// Resolution icons carry meaning independently · the operator can
// resolve by icon alone. ArrowRight = forward motion (current wins) ·
// RotateCcw = revert (old wins) · Equal = both stand · Slash =
// cancel-out (false positive). Icon-first design beats label-first
// for repetitive operator actions.
const RESOLVE_META: Record<
  ResolveChoice,
  { label: string; title: string; icon: typeof ArrowRight; tone: string }
> = {
  current_wins: {
    label: "current",
    title: "the current statement is right · the old position is deprecated",
    icon: ArrowRight,
    tone: "border-emerald-400/45 bg-emerald-400/[0.08] text-emerald-300 hover:bg-emerald-400/15 hover:border-emerald-400/60",
  },
  old_wins: {
    label: "old",
    title: "the old position still stands · the current statement was wrong",
    icon: RotateCcw,
    tone: "border-amber-400/45 bg-amber-400/[0.08] text-amber-300 hover:bg-amber-400/15 hover:border-amber-400/60",
  },
  both_valid: {
    label: "both",
    title: "context-dependent · both positions can be true",
    icon: Equal,
    tone: "border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)]",
  },
  dismissed: {
    label: "dismiss",
    title: "false positive · not actually a contradiction",
    icon: Slash,
    tone: "border-rose-400/30 bg-rose-400/[0.04] text-rose-300/80 hover:text-rose-300 hover:bg-rose-400/12 hover:border-rose-400/45",
  },
};

// Signal-kind chips colored to match the SEVERITY of the polarity flip.
// Compound (rare · two signals firing) is gold so it visually leads.
// Antonym (explicit semantic opposite) is rose. Negation (you flipped a
// "no longer" / "stop" / "never" word) is amber. Reversal (you said
// "scratch that" / "actually") is emerald · operator-acknowledged.
const SIGNAL_TONE: Record<SignalKind, string> = {
  compound: "border-[var(--gold)]/45 bg-[var(--gold)]/[0.08] text-[var(--gold)]",
  antonym: "border-rose-400/45 bg-rose-400/[0.08] text-rose-300",
  negation: "border-amber-400/45 bg-amber-400/[0.08] text-amber-300",
  reversal: "border-emerald-400/45 bg-emerald-400/[0.08] text-emerald-300",
};

function trimText(s: string | null | undefined, n = PREVIEW_CHARS): string {
  if (!s) return "";
  const trimmed = s.replace(/\s+/g, " ").trim();
  return trimmed.length > n ? trimmed.slice(0, n - 1).trimEnd() + "…" : trimmed;
}

function daysAgo(iso: string): number | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000)));
}

/**
 * Build the /chat seed prompt for cross-link. The reconciliation
 * template gives Nick the full polarity context so the chat
 * conversation can lead straight to a resolution recommendation
 * rather than playing 20 questions to recover the situation.
 *
 * Exported for unit testability · the prompt shape is part of the
 * contract between this card and the chat composer's seed hydration.
 */
export function buildReconcileSeed(
  newExcerpt: string,
  oldExcerpt: string,
  daysApart: number,
): string {
  return (
    `Help me reconcile two positions I've held.\n\n` +
    `NOW · "${newExcerpt.trim()}"\n\n` +
    `${daysApart}d AGO · "${oldExcerpt.trim()}"\n\n` +
    `Which holds up? What context would make BOTH true? What changed in me · or in the situation · between then and now?`
  );
}

export function ContradictionsCard() {
  // Phase B.6c (2026-05-22) · migrated off `useUltronFetch("/api/system/
  // contradictions?days=14&includeResolved=true")` + an `authedFetch`
  // POST onto `trpc.system.contradictions` (reactive read · 5-min
  // refetchInterval) + `trpc.system.resolveContradiction` (mutation).
  // The legacy `?days=14&includeResolved=true` query string is now a
  // typed input object. The procedure returns `{ items, summary }`
  // directly · the legacy envelope unwrap is gone. The `key` path param
  // now rides in the mutation input object (tRPC has no path).
  const contra = trpc.system.contradictions.useQuery(
    { days: 14, includeResolved: true },
    { refetchInterval: 300_000, staleTime: 300_000 },
  );
  const utils = trpc.useUtils();
  const resolveMutation = trpc.system.resolveContradiction.useMutation();

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);

  // v10.0.529.30 · Arc B Phase 3 · BottomPulseTicker deep-link. When
  // the operator taps a contradiction in the ambient ticker, the href
  // is `/?resolve=<key>#contradictions` · the hash scrolls to the
  // card's anchor wrapper · the query param tells THIS card to auto-
  // open that specific contradiction's resolution form so the tap is
  // a one-shot action rather than "scroll then hunt". The ref guard
  // makes it a one-shot · re-renders or refetches don't re-auto-open
  // after the operator manually closed the form.
  const searchParams = useSearchParams();
  const autoOpenedRef = useRef(false);

  const closeForm = useCallback(() => {
    setExpandedKey(null);
    setNote("");
  }, []);

  const openForm = useCallback((key: string) => {
    setExpandedKey(key);
    setNote("");
  }, []);

  const submitResolve = useCallback(
    async (key: string, status: ResolveChoice) => {
      setSubmittingKey(key);
      const toastId = toast.loading("resolving…");
      try {
        const trimmedNote = note.trim();
        await resolveMutation.mutateAsync({
          key,
          status,
          ...(trimmedNote.length > 0 ? { note: trimmedNote } : {}),
        });
        toast.success(
          status === "dismissed"
            ? "dismissed · false positive logged"
            : status === "both_valid"
              ? "both valid · context-dependent"
              : status === "current_wins"
                ? "current wins · old position deprecated"
                : "old wins · current statement deprecated",
          { id: toastId },
        );
        closeForm();
        await utils.system.contradictions.invalidate();
      } catch {
        toast.error("resolve failed", { id: toastId });
      } finally {
        setSubmittingKey(null);
      }
    },
    [note, closeForm, resolveMutation, utils],
  );

  // Sort and split memoized · avoids re-walking the items array on
  // every state change (form open/close · note typing). React Query
  // keeps the data object identity stable across polls, so this
  // recomputes only when actual data changes.
  const { shownUnresolved, moreCount, recentResolved, mostRecentResolved } =
    useMemo(() => {
      const items = contra.data?.items ?? [];
      const unresolved = items
        .filter((c) => c.status === "unresolved")
        .sort((a, b) => {
          const simDelta = b.similarity - a.similarity;
          if (Math.abs(simDelta) > 0.02) return simDelta;
          return b.daysApart - a.daysApart;
        });
      const resolved = items
        .filter((c) => c.status !== "unresolved" && c.resolvedAt)
        .sort((a, b) => {
          const at = new Date(a.resolvedAt!).getTime();
          const bt = new Date(b.resolvedAt!).getTime();
          return bt - at;
        });
      return {
        shownUnresolved: unresolved.slice(0, TOP_N),
        moreCount: Math.max(0, unresolved.length - TOP_N),
        recentResolved: resolved,
        mostRecentResolved: resolved[0] ?? null,
      };
    }, [contra.data]);

  // v10.0.529.30 · Arc B Phase 3 · auto-open from ticker deep-link.
  // Runs once after data loads · if `?resolve=<key>` is in the URL
  // AND the key matches an unresolved item, expand its form. Guarded
  // by autoOpenedRef so subsequent re-renders / refetches don't fight
  // the operator's manual close action. Items not currently in the
  // unresolved set (e.g. stale ticker link · already resolved) silently
  // no-op rather than open an empty form.
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!contra.data) return;
    const resolveKey = searchParams?.get("resolve");
    if (!resolveKey) return;
    const match = shownUnresolved.find((c) => c.key === resolveKey);
    if (match) {
      autoOpenedRef.current = true;
      setTimeout(() => {
        setExpandedKey(match.key);
        setNote("");
      }, 0);
    }
  }, [contra.data, searchParams, shownUnresolved]);

  if (contra.isLoading && !contra.data) {
    return <ShimmerSkeleton variant="card" className="min-h-[96px]" />;
  }

  // Silent on empty AND no recent activity · zero card noise on a
  // clean board. The card only earns real estate when there's
  // operator-actionable or narrative content to surface.
  if (shownUnresolved.length === 0 && !mostRecentResolved) {
    return null;
  }

  const unresolvedTotal = shownUnresolved.length + moreCount;

  return (
    <GlassCard
      className="min-h-[96px] border-(--gold)/25 bg-(--gold)/3"
      data-testid="contradictions-card"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-(--gold)">
          positions · contradictions
          {unresolvedTotal > 0 && (
            <span className="rounded-sm border border-(--gold)/30 px-1 py-px text-[9px] tabular-nums text-(--gold)">
              {unresolvedTotal} unresolved
            </span>
          )}
        </span>
        {recentResolved.length > 0 && (
          <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-(--text-tertiary) tabular-nums">
            {recentResolved.length} resolved · 14d
          </span>
        )}
      </div>

      {shownUnresolved.length > 0 && (
        <ul
          className="mt-2.5 space-y-2.5"
          aria-label="Unresolved contradictions awaiting reconciliation"
        >
          {shownUnresolved.map((c) => {
            const isExpanded = expandedKey === c.key;
            const isSubmitting = submittingKey === c.key;
            const seedHref = `/chat?seed=${encodeURIComponent(
              buildReconcileSeed(c.newExcerpt, c.oldExcerpt, c.daysApart).slice(
                0,
                SEED_CAP,
              ),
            )}`;
            return (
              <li
                key={c.key}
                className={cn(
                  "relative pl-3 pr-1 py-1 -mx-1 rounded-sm transition-colors",
                  isExpanded && "bg-(--gold)/4",
                )}
              >
                {/* LEFT-EDGE TENSION GRADIENT · 2px rule per row that
                    visualizes the temporal polarity gap. Gold top
                    (current truth) fading to amber bottom (stale
                    position). Cheap perceptual signal · the eye sees
                    the contradiction before reading. */}
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-1 bottom-1 w-px rounded-full"
                  style={{
                    background:
                      "linear-gradient(180deg, var(--gold) 0%, var(--gold) 38%, rgb(251 191 36 / 0.65) 62%, rgb(251 191 36 / 0.25) 100%)",
                  }}
                />

                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0 space-y-1">
                    {/* "now" line · cross-linked to /chat?seed=
                        for deep-discussion path. Operator can EITHER
                        resolve inline via the toggle OR tap the
                        excerpt to offload reasoning to Nick. */}
                    <Link
                      href={seedHref}
                      className="block group/now -mx-0.5 px-0.5 rounded-sm transition-colors hover:bg-(--gold)/6 focus-visible:bg-(--gold)/6 focus-visible:outline-none"
                      aria-label={`Reconcile this contradiction in chat · ${c.newExcerpt.slice(0, 60)}`}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="shrink-0 text-[8.5px] font-mono uppercase tracking-[0.18em] text-(--gold)/70 tabular-nums">
                          now
                        </span>
                        <span className="text-[12px] leading-[1.45] text-(--text-primary) font-medium">
                          {trimText(c.newExcerpt, PREVIEW_CHARS)}
                        </span>
                      </div>
                    </Link>

                    {/* "Nd ago" line · desaturated · the typographic
                        fade reinforces "this is the prior position".
                        Same component, deliberately weaker treatment. */}
                    <div className="flex items-baseline gap-2">
                      <span className="shrink-0 text-[8.5px] font-mono uppercase tracking-[0.18em] text-(--text-tertiary) tabular-nums">
                        {c.daysApart}d
                      </span>
                      <span className="text-[12px] leading-[1.45] text-(--text-tertiary)">
                        {trimText(c.oldExcerpt, PREVIEW_CHARS)}
                      </span>
                    </div>

                    {/* Signal chip · colored per kind · CARRIES the
                        polarity-kind information categorically (no
                        raw similarity score · the chip IS the score). */}
                    <div className="pt-0.5">
                      <span
                        className={cn(
                          "inline-block px-1.5 py-px rounded-sm border text-[9px] font-mono uppercase tracking-wide",
                          SIGNAL_TONE[c.signal],
                        )}
                        title={`polarity signal · ${c.signal}`}
                      >
                        {c.signal}
                      </span>
                    </div>
                  </div>

                  {/* Resolve toggle · Scale icon signals "weighing two
                      positions" rather than the generic pencil/edit
                      semantic. Icon stays Scale even when expanded
                      (the X variant is too generic for this surface). */}
                  <button
                    type="button"
                    onClick={() => (isExpanded ? closeForm() : openForm(c.key))}
                    aria-expanded={isExpanded ? "true" : "false"}
                    aria-label={
                      isExpanded
                        ? "close resolution form"
                        : "weigh and resolve this contradiction"
                    }
                    className={cn(
                      "shrink-0 -my-0.5 rounded transition-all",
                      "min-w-[44px] min-h-[44px] sm:min-w-[28px] sm:min-h-[28px] flex items-center justify-center",
                      isExpanded
                        ? "bg-(--gold)/15 text-(--gold) scale-95"
                        : "text-(--text-tertiary) hover:text-(--gold) hover:bg-(--gold)/8",
                    )}
                    title={isExpanded ? "close" : "weigh"}
                  >
                    {isExpanded ? <XIcon size={12} /> : <Scale size={12} />}
                  </button>
                </div>

                {/* INLINE RESOLUTION · 4 icon-first buttons + optional
                    note. Each button posts immediately on tap · the
                    note (if filled) rides on the next POST. No save
                    button · the action IS the save · matches the
                    operator's quick-decision flow. */}
                {isExpanded && (
                  <div className="mt-1.5 ml-0 border-l border-(--gold)/25 pl-2.5 py-1.5 space-y-1.5 animate-fade-in">
                    <div>
                      <label className="block text-[8.5px] font-bold uppercase tracking-[0.18em] text-(--text-tertiary) mb-1">
                        which holds up?
                      </label>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {(
                          [
                            "current_wins",
                            "old_wins",
                            "both_valid",
                            "dismissed",
                          ] as ResolveChoice[]
                        ).map((choice) => {
                          const meta = RESOLVE_META[choice];
                          const Icon = isSubmitting ? Loader2 : meta.icon;
                          return (
                            <button
                              key={choice}
                              type="button"
                              onClick={() => submitResolve(c.key, choice)}
                              disabled={isSubmitting}
                              title={meta.title}
                              className={cn(
                                "flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-mono lowercase tracking-wide transition-all",
                                "min-h-[44px] sm:min-h-[26px]",
                                meta.tone,
                                isSubmitting && "opacity-60 cursor-wait",
                              )}
                            >
                              <Icon
                                size={10}
                                className={isSubmitting ? "animate-spin" : undefined}
                              />
                              {meta.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[8.5px] font-bold uppercase tracking-[0.18em] text-(--text-tertiary) mb-0.5">
                        why
                        <span className="opacity-60 normal-case ml-1 tracking-normal">
                          (optional · rides on the next resolve)
                        </span>
                      </label>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
                        placeholder="what changed · what context matters"
                        rows={1}
                        disabled={isSubmitting}
                        className={cn(
                          "w-full resize-y rounded-md bg-(--bg-raised) border border-(--border-default)",
                          "text-[11px] leading-snug px-2 py-1.5 text-(--text-primary)",
                          "placeholder:text-(--text-tertiary)",
                          "focus:border-(--gold)/40 focus:outline-none transition-colors",
                          "min-h-[28px]",
                        )}
                        aria-label="resolution note (optional)"
                      />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
          {moreCount > 0 && (
            <li className="text-[9px] font-mono uppercase tracking-[0.18em] text-(--text-tertiary) pl-3">
              + {moreCount} more · {moreCount === 1 ? "is" : "are"} waiting
            </li>
          )}
        </ul>
      )}

      {/* STATE-AWARE FOOTER NARRATIVE · changes shape based on the
          actual state of the system, not just "show last lesson".
          Three cases · all-active · resolved-only · most-recent
          ages out gracefully. */}
      {mostRecentResolved && (
        <p className="mt-2.5 border-t border-(--border-default)/30 pt-2 text-[10px] leading-relaxed text-(--text-tertiary)">
          {shownUnresolved.length === 0 ? (
            <>
              <span className="text-emerald-400/80">clean board</span>
              {" · "}
              <span className="not-italic text-(--text-secondary) tabular-nums">
                {daysAgo(mostRecentResolved.resolvedAt!) ?? "—"}d ago
              </span>{" "}
              you resolved{" "}
              <span className="not-italic text-(--text-secondary) lowercase">
                {mostRecentResolved.status.replace("_", " ")}
              </span>
            </>
          ) : (
            <>
              last resolved{" "}
              <span className="not-italic text-(--text-secondary) tabular-nums">
                {daysAgo(mostRecentResolved.resolvedAt!) ?? "—"}d ago
              </span>{" "}
              ·{" "}
              <span className="not-italic text-(--text-secondary) lowercase">
                {mostRecentResolved.status.replace("_", " ")}
              </span>
            </>
          )}
          {mostRecentResolved.resolutionNote && (
            <>
              {" · "}
              <span className="italic text-(--text-tertiary)">
                “{trimText(mostRecentResolved.resolutionNote, 80)}”
              </span>
            </>
          )}
        </p>
      )}
    </GlassCard>
  );
}
