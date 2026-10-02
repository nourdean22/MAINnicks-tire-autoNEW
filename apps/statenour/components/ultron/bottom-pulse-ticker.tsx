"use client";

/**
 * BOTTOM PULSE TICKER — Nour's personal state, ambient.
 *
 * 2026-05-31 · REBUILT to match the Edge Feed top ticker. Was a 60s CSS
 * marquee with `hover:pause` — the same banner-blindness + dead-on-touch
 * pattern the top ticker shed. The lone-item-doubled-itself bug was a symptom.
 * New form:
 *   · ONE item at a time, static (no scroll) — the whole strip is a tap target
 *     that opens the full pulse feed UPWARD (it's fixed to the bottom).
 *   · priority-first ordering (warn → win → info → mute) so the highest-signal
 *     item leads; a fade (not a slide) advances every ~10s, paused while the
 *     feed sheet is open.
 *   · a VISIBLE snooze (24h, not a permanent mute) — same shared dismissal hook
 *     as the top ticker, so a recurring personal signal returns tomorrow.
 * Ambient scale preserved (~h-5 desktop · 32px mobile tap zone): this is
 * the quiet personal strip, not the prominent top one — and keeping the height
 * means the layout's bottom reservation (chat safe-area + `pb`) is unchanged.
 * 2026-10-02 · UI v2 (docs/design/ui-v2/SYSTEM.md): control chrome, so the
 * strip is `.ui-material`; text is mono 12px sentence-case on tokens; the one
 * gold mark is the notch on the sheet's active row; the one pulse is the amber
 * `pulse-live` dot that renders only while a feed is refetching or a
 * commitment resolve is in flight.
 *
 * Data source: trpc.operator.personalPulse (cached 90s, polled every 5 min).
 * a11y: role="region" + aria-label="System pulse" + aria-live="off" so screen
 * readers can find/skip the strip without each rotation being announced.
 */

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

import { trpc } from "@/lib/trpc/client";
import { useDismissedTicker } from "@/hooks/use-dismissed-ticker";
import { DismissButton } from "@/components/ui/dismiss-button";
import { useNourState } from "@/lib/state/nour-state";

// v10.0.104 audit fix · keep this union in sync with the server's PulseItem.kind
// in app/api/ultron/personal-pulse/route.ts.
interface PulseItem {
  id: string;
  kind:
    | "capture" | "mit" | "tomorrow" | "narrator" | "commitment" | "reflection"
    | "win" | "insight" | "idle"
    | "contradiction" | "mind" | "life" | "wisdom"
    | "market" | "macro" | "industry" | "local" | "timeline" | "mode" | "shop" | "brain";
  glyph: string;
  label: string;
  text: string;
  tone: "info" | "warn" | "win" | "mute";
  href?: string;
  /** 2026-08-12 · set on kind:"commitment" items — enables inline resolve. */
  commitmentId?: number;
}

// Status hues (amber / emerald) are the sanctioned tiers; everything else is
// neutral — gold is a selection signal, not a tone.
const TONE_COLORS: Record<PulseItem["tone"], string> = {
  info: "text-fg-secondary",
  warn: "text-amber-400",
  win:  "text-emerald-400",
  mute: "text-fg-tertiary",
};

const LABEL_COLORS: Record<PulseItem["tone"], string> = {
  info: "text-fg-tertiary",
  warn: "text-amber-400",
  win:  "text-emerald-400",
  mute: "text-fg-tertiary",
};

// Important-first: warn > win > info > mute. Highest-signal personal item leads.
const TONE_RANK: Record<PulseItem["tone"], number> = { warn: 0, win: 1, info: 2, mute: 3 };

// A dismissal here is a 24h snooze (not a permanent mute) — a recurring personal
// signal (reflection freshness, an open commitment) returns tomorrow rather than
// being lost forever. Matches the top ticker.
const SNOOZE_MS = 24 * 60 * 60 * 1000;

export function BottomPulseTicker() {
  const { data, refetch: refetchPulse, isFetching: pulseFetching } = trpc.operator.personalPulse.useQuery(undefined, {
    refetchInterval: 300_000,
    retry: false,
  });
  const { data: topData, isFetching: tickerFetching } = trpc.operator.ticker.useQuery(undefined, {
    refetchInterval: 300_000,
    retry: false,
  });
  const { dismissed, dismiss } = useDismissedTicker();
  const s = useNourState();
  // 2026-08-12 · resolve an overdue commitment (Done/Drop) directly from
  // the sheet — the prior state was chat-only. The server mutation clears
  // its own 90s cache; refetch() here is what makes the client actually
  // notice within the same session instead of waiting up to 5 minutes.
  const resolveCommitment = trpc.operator.resolveCommitment.useMutation({
    onSuccess: () => {
      void refetchPulse();
    },
  });

  const items = useMemo<PulseItem[]>(() => {
    const personalItems = (data?.items ?? []) as PulseItem[];

    // Map top ticker items to PulseItem shape
    const topItems = (topData?.items ?? []).map((it: any) => {
      let tone: PulseItem["tone"] = "info";
      if (it.severity === "warn") tone = "warn";
      else if (it.severity === "win") tone = "win";

      const GLYPH: Record<string, string> = {
        timeline: "◆",
        shop: "●",
        mode: "▲",
        brain: "◉",
      };
      const glyph = GLYPH[it.category] || "◆";

      const labelText = it.symbol
        ? it.label.replace(new RegExp(`^${it.symbol}\\s*`), "")
        : it.label;
      const delta = it.deltaPct;
      const deltaStr =
        delta == null
          ? ""
          : ` ${delta > 0 ? "▲" : delta < 0 ? "▼" : "·"}${Math.abs(delta).toFixed(1)}%`;
      const text = `${labelText}${deltaStr}`;

      return {
        id: it.id,
        kind: it.category,
        glyph,
        label: it.symbol || it.category.toUpperCase(),
        text,
        tone,
        href: it.href,
      } as PulseItem;
    });

    const combined = [...personalItems, ...topItems];
    const live = combined.filter((it) => !dismissed.has(it.id));
    return [...live].sort((a, b) => (TONE_RANK[a.tone] ?? 9) - (TONE_RANK[b.tone] ?? 9));
  }, [data, topData, dismissed]);

  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  // OS reduced-motion must stop the rotation itself — the CSS kill-switch in
  // effects.css silences the fade but no CSS can stop a JS setInterval.
  // Same SSR-safe matchMedia pattern as components/3d/scene-canvas.tsx.
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Auto-advance every 10s (fade-on-change via the item key). Pauses while the
  // feed sheet is open, when the operator pauses it (WCAG 2.2.2), and under
  // prefers-reduced-motion. Motion only on change — no continuous scroll.
  // The priority sort means a frozen strip shows the highest-priority item,
  // and the tap-to-open feed still lists everything — nothing is hidden.
  useEffect(() => {
    if (open || paused || reducedMotion || items.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 10_000);
    return () => clearInterval(t);
  }, [open, paused, reducedMotion, items.length]);

  // Escape closes the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if ((!data && !topData) || items.length === 0) return null;

  const safeIdx = idx % items.length;
  const current = items[safeIdx];
  // The strip's ONE live indicator: amber + `pulse-live` only while something
  // is actually updating (SYSTEM.md §9 — "working" is the only pulsing state).
  const live = Boolean(pulseFetching || tickerFetching || resolveCommitment.isPending);

  // Section 5.8 (2026-09-08): this strip is bottom-chrome geometry (--bottom-chrome-h, the FAB
  // lane); its 32px controls are exempt from the 44px target audit until the chrome is resized
  // as one change. Named in tests/e2e/target-size.spec.ts.
  return (
    <div
      role="region"
      aria-label="System pulse"
      aria-live="off"
      data-target-audit="exempt"
      className="ui-material relative min-h-[32px] sm:h-5 border-t border-edge-subtle"
    >
      {/* gap-3: the snooze button uses the pulled-margin pattern (p-3 -m-3),
          so its hit box extends 12px past its footprint — at gap-2 it
          overlapped the pause button's edge. */}
      <div className="flex items-center gap-3 px-3 h-full min-h-[32px] sm:min-h-0">
        {/* The one item · tap anywhere to open the full pulse feed. */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex-1 min-w-0 flex items-center gap-2 h-full py-1 text-left rounded-control"
          aria-label={open ? "Close pulse feed" : "Open pulse feed"}
          aria-expanded={open}
        >
          {live && (
            <span
              className="pulse-live h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
              aria-hidden
            />
          )}
          {/* `flex` is load-bearing. PulseContent's root is an INLINE-flex
              box; in a non-flex span it sizes to its content, overflows, and
              -- since nothing clips here -- paints straight over the n/total
              counter to its right. That is the `low-stakes1/11pick one`
              collision the operator screenshotted. Making this a flex
              container is what lets min-w-0 + truncate below actually shrink
              the text. Measured at 390px: overlap gone, text ellipsizes. */}
          <span key={current.id} className="pulse-fade flex flex-1 min-w-0">
            <PulseContent item={current} />
          </span>
        </button>

        {items.length > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPaused((p) => !p);
            }}
            aria-pressed={paused}
            /* Static label + aria-pressed. Swapping the label AND setting
               aria-pressed announces "Resume rotation, pressed" when frozen,
               which states the opposite of the truth. */
            aria-label="Pause rotation"
            className="shrink-0 inline-flex min-h-11 min-w-11 items-center justify-center rounded-control px-1 font-mono text-[11px] tabular-nums text-fg-tertiary hover:text-fg-secondary sm:min-h-8 sm:min-w-8"
          >
            {paused ? "⏸ " : ""}
            {safeIdx + 1}/{items.length}
          </button>
        )}

        {/* Visible, touch-friendly snooze for the current item. */}
        <DismissButton
          onClick={(e) => {
            e.stopPropagation();
            dismiss(current.id, { kind: current.kind, source: "bottom", ttlMs: SNOOZE_MS });
          }}
          label="Snooze item for a day"
          size="sm"
          className="shrink-0 hover:text-rose-400"
        />
      </div>

      <PulseFeedSheet
        open={open}
        items={items}
        activeIdx={safeIdx}
        onClose={() => setOpen(false)}
        onDismiss={(id, kind) => dismiss(id, { kind, source: "bottom", ttlMs: SNOOZE_MS })}
        onResolve={(commitmentId, action) => resolveCommitment.mutate({ commitmentId, action })}
        resolvingId={resolveCommitment.isPending ? (resolveCommitment.variables?.commitmentId ?? null) : null}
        onPick={(i) => {
          setIdx(i);
          setOpen(false);
        }}
      />

      <style jsx>{`
        .pulse-fade {
          animation: pulseFade 380ms ease-out;
        }
        @keyframes pulseFade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

/** One pulse item's content — mono 12px metadata scale. Single-line in the
 *  strip, wrapping in the sheet (row). */
function PulseContent({ item, row = false }: { item: PulseItem; row?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 min-w-0 font-mono text-[12px]", !row && "truncate")}>
      <span className="shrink-0 opacity-90" aria-hidden>{item.glyph}</span>
      <span
        className={cn(
          "shrink-0 text-[11px] font-medium",
          LABEL_COLORS[item.tone],
        )}
      >
        {item.label}
      </span>
      {/* min-w-0: a flex item defaults to min-width:auto and refuses to
          shrink below its content, so truncate's overflow:hidden never
          engages and the text overflows its parent instead of ellipsizing. */}
      <span className={cn(TONE_COLORS[item.tone], !row && "truncate min-w-0")}>{item.text}</span>
    </span>
  );
}

/** The full pulse feed — opens UPWARD above the strip on tap (the strip is
 *  fixed to the bottom). Every item readable + tappable (≥44px rows) with a
 *  visible snooze. Mirrors the top ticker's FeedSheet. */
/** Enter/exit pair for the feed sheet. Exported so the regression test can
 *  pin both utilities against effects.css: unmount rides animationend, so a
 *  typo'd or deleted exit class would mean the closed sheet NEVER unmounts. */
export const PULSE_FEED_SHEET_ANIMATION = {
  enter: "animate-fadeSlideUp",
  exit: "animate-fadeSlideDown",
} as const;

export function PulseFeedSheet({
  open,
  items,
  activeIdx,
  onClose,
  onDismiss,
  onResolve,
  resolvingId,
  onPick,
}: {
  /** When false the sheet plays its exit animation, then unmounts on animationend. */
  open: boolean;
  items: PulseItem[];
  activeIdx: number;
  onClose: () => void;
  onDismiss: (id: string, kind: PulseItem["kind"]) => void;
  /** 2026-08-12 · fires the resolveCommitment mutation for a commitment row. */
  onResolve: (commitmentId: number, action: "done" | "drop") => void;
  /** commitmentId currently in flight, so its own row can show a busy state. */
  resolvingId: number | null;
  onPick: (i: number) => void;
}) {
  // 2026-08-12 · the sheet used to mount/unmount on the same frame `open`
  // flipped — no motion either way, the close visibly snapped. Same machine
  // as more-sheet.tsx (the reference implementation): `mounted` trails
  // `open` by one exit animation and unmount rides animationend, never a
  // timeout. Rapid reopen mid-close is safe — swapping animation-name
  // cancels the exit WITHOUT firing animationend, so the guard can't
  // unmount a sheet that is open again.
  const [mounted, setMounted] = useState(open);
  // lint-baseline 2026-08-13 · rising edge moved from an effect to the
  // React-sanctioned render-phase adjustment ("storing information from
  // previous renders") — same semantics, no effect-driven cascade. The
  // falling edge still rides animationend below, unchanged.
  if (open && !mounted) setMounted(true);
  if (!mounted) return null;

  return (
    <>
      {/* backdrop — tap outside to close */}
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div
        onAnimationEnd={() => {
          if (!open) setMounted(false);
        }}
        className={cn(
          "absolute left-0 right-0 bottom-full z-50 max-h-[60vh] overflow-y-auto border-t border-edge-default bg-overlay",
          open ? PULSE_FEED_SHEET_ANIMATION.enter : PULSE_FEED_SHEET_ANIMATION.exit,
        )}
      >
        <div className="sticky top-0 flex items-center justify-between px-3 py-2 border-b border-edge-subtle bg-overlay">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
            Pulse · {items.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-control px-2 font-mono text-[12px] text-fg-tertiary hover:text-fg sm:min-h-9"
          >
            Close
          </button>
        </div>
        <ul>
          {items.map((it, i) => (
            <li
              key={it.id}
              className={cn(
                "relative flex items-center gap-2 px-3 min-h-[44px] border-b border-edge-subtle",
                i === activeIdx && "bg-surface-interactive",
              )}
            >
              {/* The sheet's one gold mark: the notch on the row the strip is showing. */}
              {i === activeIdx && (
                <span className="notch absolute left-0 top-1/2 -translate-y-1/2" aria-hidden />
              )}
              {it.href ? (
                <a
                  href={it.href}
                  className="flex-1 min-w-0 py-2 rounded-control hover:bg-surface-hover transition-colors duration-[var(--motion-state)]"
                  aria-label={`${it.label}: ${it.text}`}
                  onClick={onClose}
                >
                  <PulseContent item={it} row />
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => onPick(i)}
                  className="flex-1 min-w-0 py-2 text-left"
                >
                  <PulseContent item={it} row />
                </button>
              )}
              {it.kind === "commitment" && it.commitmentId != null && (
                <CommitmentResolveButtons
                  commitmentId={it.commitmentId}
                  busy={resolvingId === it.commitmentId}
                  onResolve={onResolve}
                />
              )}
              <DismissButton
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(it.id, it.kind);
                }}
                label="Snooze item for a day"
                size="sm"
                className="shrink-0 hover:text-rose-400"
              />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/** Inline "Done" / "Drop" for a commitment row — 2026-08-12. Single-tap,
 *  no confirm dialog: both are reversible status flips (not deletes), and
 *  every other action in this ticker (pause, snooze) is already single-tap
 *  — a confirm step here would be inconsistent friction for the least-
 *  risky actions in the sheet. `busy` disables both buttons for the
 *  in-flight commitment so a double-tap during the mutation can't race. */
function CommitmentResolveButtons({
  commitmentId,
  busy,
  onResolve,
}: {
  commitmentId: number;
  busy: boolean;
  onResolve: (commitmentId: number, action: "done" | "drop") => void;
}) {
  return (
    <div className="shrink-0 flex items-center gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          onResolve(commitmentId, "done");
        }}
        aria-label="Mark this promise done"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control px-2 font-mono text-[11px] text-emerald-400/80 hover:text-emerald-300 disabled:opacity-40 sm:min-h-9 sm:min-w-9"
      >
        Done
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          onResolve(commitmentId, "drop");
        }}
        aria-label="Drop this promise — no longer doing it"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control px-2 font-mono text-[11px] text-fg-tertiary hover:text-rose-400 disabled:opacity-40 sm:min-h-9 sm:min-w-9"
      >
        Drop
      </button>
    </div>
  );
}
