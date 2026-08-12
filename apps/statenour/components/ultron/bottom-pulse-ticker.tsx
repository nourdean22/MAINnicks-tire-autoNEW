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
 * Ambient scale preserved (10px, ~h-5 desktop · 32px mobile tap zone): this is
 * the quiet personal strip, not the prominent top one — and keeping the height
 * means the layout's bottom reservation (chat safe-area + `pb`) is unchanged.
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

const TONE_COLORS: Record<PulseItem["tone"], string> = {
  info: "text-[var(--text-secondary)]",
  warn: "text-amber-400",
  win:  "text-emerald-400",
  mute: "text-[var(--text-tertiary)]",
};

const LABEL_COLORS: Record<PulseItem["tone"], string> = {
  info: "text-[var(--gold)]/80",
  warn: "text-amber-400",
  win:  "text-emerald-400",
  mute: "text-[var(--text-tertiary)]",
};

// Important-first: warn > win > info > mute. Highest-signal personal item leads.
const TONE_RANK: Record<PulseItem["tone"], number> = { warn: 0, win: 1, info: 2, mute: 3 };

// A dismissal here is a 24h snooze (not a permanent mute) — a recurring personal
// signal (reflection freshness, an open commitment) returns tomorrow rather than
// being lost forever. Matches the top ticker.
const SNOOZE_MS = 24 * 60 * 60 * 1000;

export function BottomPulseTicker() {
  const { data, refetch: refetchPulse } = trpc.operator.personalPulse.useQuery(undefined, {
    refetchInterval: 300_000,
    retry: false,
  });
  const { data: topData } = trpc.operator.ticker.useQuery(undefined, {
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

  return (
    <div
      role="region"
      aria-label="System pulse"
      aria-live="off"
      className="relative min-h-[32px] sm:h-5 border-t border-[var(--border-default)] bg-[var(--bg-void)]/60"
    >
      {/* gap-3: the snooze button uses the pulled-margin pattern (p-3 -m-3),
          so its hit box extends 12px past its footprint — at gap-2 it
          overlapped the pause button's edge. */}
      <div className="flex items-center gap-3 px-3 h-full min-h-[32px] sm:min-h-0">
        {/* The one item · tap anywhere to open the full pulse feed. */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex-1 min-w-0 flex items-center h-full py-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40 rounded"
          aria-label={open ? "Close pulse feed" : "Open pulse feed"}
          aria-expanded={open}
        >
          <span key={current.id} className="pulse-fade flex-1 min-w-0">
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
            className="shrink-0 inline-flex min-h-11 min-w-11 items-center justify-center rounded px-1 text-[9px] tabular-nums text-[var(--text-tertiary)] outline-none hover:text-[var(--text-secondary)] focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40 sm:min-h-8 sm:min-w-8"
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

/** One pulse item's content — ambient scale (10px). Single-line in the strip,
 *  wrapping in the sheet (row). */
function PulseContent({ item, row = false }: { item: PulseItem; row?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 min-w-0 text-[10px] font-mono", !row && "truncate")}>
      <span className="shrink-0 opacity-90" aria-hidden>{item.glyph}</span>
      <span
        className={cn(
          "shrink-0 font-[var(--font-display)] font-bold uppercase tracking-[0.2em] text-[9px]",
          LABEL_COLORS[item.tone],
        )}
      >
        {item.label}
      </span>
      <span className={cn(TONE_COLORS[item.tone], !row && "truncate")}>{item.text}</span>
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
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
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
          "absolute left-0 right-0 bottom-full z-50 max-h-[60vh] overflow-y-auto border-t border-[var(--border-default)] bg-[var(--bg-void)]/95 backdrop-blur-sm shadow-xl",
          open ? PULSE_FEED_SHEET_ANIMATION.enter : PULSE_FEED_SHEET_ANIMATION.exit,
        )}
      >
        <div className="sticky top-0 flex items-center justify-between px-3 py-2 border-b border-[var(--border-default)]/50 bg-[var(--bg-void)]/95">
          <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            Pulse · {items.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] px-2 min-h-[36px]"
          >
            Close
          </button>
        </div>
        <ul>
          {items.map((it, i) => (
            <li
              key={it.id}
              className={cn(
                "flex items-center gap-2 px-3 min-h-[44px] border-b border-[var(--border-default)]/25",
                i === activeIdx && "bg-white/[0.03]",
              )}
            >
              {it.href ? (
                <a
                  href={it.href}
                  className="flex-1 min-w-0 py-2 hover:brightness-150 transition-all"
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
        className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded px-2 text-[9px] font-mono uppercase tracking-wider text-emerald-400/80 hover:text-emerald-300 disabled:opacity-40 focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40"
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
        className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded px-2 text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-rose-400 disabled:opacity-40 focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40"
      >
        Drop
      </button>
    </div>
  );
}
