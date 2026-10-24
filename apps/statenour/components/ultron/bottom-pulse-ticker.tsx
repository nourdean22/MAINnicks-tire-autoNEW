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
 *
 * 2026-10-10 (audit 09) · F30: a failed read used to render nothing, the same as
 * "no pulse today"; it now says "Pulse unavailable". F21: the open-feed button,
 * pause and snooze have a real 44px box on phones, so the strip no longer opts
 * out of tests/e2e/target-size.spec.ts. F4: the feed is a Base UI Dialog.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

import { trpc } from "@/lib/trpc/client";
import { useDismissedTicker } from "@/hooks/use-dismissed-ticker";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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

const RESOLVE_FAILED = "Could not update that promise. Try again.";

export function BottomPulseTicker() {
  const { data, refetch: refetchPulse, isFetching: pulseFetching, isError: pulseError } = trpc.operator.personalPulse.useQuery(undefined, {
    refetchInterval: 300_000,
    retry: false,
  });
  const { data: topData, isFetching: tickerFetching, isError: tickerError } = trpc.operator.ticker.useQuery(undefined, {
    refetchInterval: 300_000,
    retry: false,
  });
  const { dismissed, dismiss } = useDismissedTicker();
  const s = useNourState();
  // 2026-08-12 · resolve an overdue commitment (Done/Drop) directly from
  // the sheet — the prior state was chat-only. The server mutation clears
  // its own 90s cache; refetch() here is what makes the client actually
  // notice within the same session instead of waiting up to 5 minutes.
  const [resolveError, setResolveError] = useState<string | null>(null);
  const resolveCommitment = trpc.operator.resolveCommitment.useMutation({
    onSuccess: () => {
      setResolveError(null);
      void refetchPulse();
    },
    // A rejected Done / Drop used to look like nothing happened (truth sweep 2026-10-23).
    onError: () => setResolveError(RESOLVE_FAILED),
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
  // The strip button that opens the feed; the dialog returns focus here on close.
  const openerRef = useRef<HTMLButtonElement>(null);
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

  // 09-F30: a ticker whose every sub-feed failed answers 200 with softError, not an error.
  const tickerFailed = tickerError || Boolean(topData?.softError);
  // Truth sweep 2026-10-23: a feed that failed beside one that works used to vanish without a word.
  const feedsDown = [pulseError ? "Personal pulse" : null, tickerFailed ? "Market ticker" : null].filter(
    (name): name is string => name !== null,
  );
  // What the sheet says about each: "could not load" is only true for a feed with nothing cached.
  // react-query keeps the last good data beside isError, and those items still show in the list.
  const feedNotes = [
    pulseError ? `Personal pulse could not ${data ? "refresh" : "load"}.` : null,
    tickerFailed ? `Market ticker could not ${topData && !topData.softError ? "refresh" : "load"}.` : null,
  ].filter((note): note is string => note !== null);
  if ((!data && !topData) || items.length === 0) {
    // Nothing to show. Only a failed read says so; an empty, healthy read stays silent.
    if (!pulseError && !tickerFailed) return null;
    // The blur stays until a Missions phone composition change buys margin on visible-transformation.spec.ts
    // (missions/phone sat at 35.2% on main).
    return (
      <div
        role="region"
        aria-label="System pulse"
        className="ui-material relative flex min-h-[32px] items-center border-t border-edge-subtle px-4 sm:h-5 sm:px-3"
      >
        <p className="font-mono text-[12px] text-fg-tertiary">Pulse unavailable</p>
      </div>
    );
  }

  const safeIdx = idx % items.length;
  const current = items[safeIdx];
  // The strip's ONE live indicator: amber + `pulse-live` only while something
  // is actually updating (SYSTEM.md §9 — "working" is the only pulsing state).
  const live = Boolean(pulseFetching || tickerFetching || resolveCommitment.isPending);

  // Hit areas (2026-10-10, audit 09-F21): on a phone the open-feed button, pause and snooze are
  // each a real 44px box, so the strip is in tests/e2e/target-size.spec.ts with no exemption.
  // The pause button already made the phone strip 44px tall whenever 2+ items rotate; the
  // open-feed button now holds 44px with a single item too (it was 32px), rather than a pulled
  // margin whose overhang would steal taps from the page above the chrome. From sm the strip
  // stays 20px; the open-feed button is a 24px box there (the fine-pointer floor).
  return (
    <div
      role="region"
      aria-label="System pulse"
      aria-live="off"
      className="ui-material relative min-h-[32px] sm:h-5 border-t border-edge-subtle"
    >
      {/* gap-4 / px-4 on phones: the snooze button's pulled margin (p-4 -m-4) reaches 16px past
          its glyph, so a 12px gap or edge would overlap the pause button or the screen edge. */}
      <div className="flex items-center gap-4 px-4 h-full min-h-[32px] sm:min-h-0 sm:gap-3 sm:px-3">
        {/* The one item · tap anywhere to open the full pulse feed. */}
        <button
          ref={openerRef}
          type="button"
          onClick={() => {
            setResolveError(null); // a rejected Done / Drop from an earlier open must not greet the next one
            setOpen((o) => !o);
          }}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-control text-left sm:-my-0.5 sm:min-h-6"
          aria-label={open ? "Close pulse feed" : "Open pulse feed"}
          aria-haspopup="dialog"
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
          {feedsDown.length > 0 && (
            <span className="shrink-0 font-mono text-[11px] text-amber-400">
              {feedsDown.length} {feedsDown.length === 1 ? "feed" : "feeds"} down
            </span>
          )}
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

        {/* Visible, touch-friendly snooze for the current item. alwaysVisible: the default
            hover gate (group/cell) has no group here, so the glyph sat at opacity 0 on touch. */}
        <DismissButton
          onClick={(e) => {
            e.stopPropagation();
            dismiss(current.id, { kind: current.kind, source: "bottom", ttlMs: SNOOZE_MS });
          }}
          label="Snooze item for a day"
          size="sm"
          alwaysVisible
          className="shrink-0 p-4 -m-4 hover:text-rose-400 sm:p-3 sm:-m-3"
        />
      </div>

      <PulseFeedSheet
        returnFocusRef={openerRef}
        open={open}
        items={items}
        activeIdx={safeIdx}
        onClose={() => setOpen(false)}
        onDismiss={(id, kind) => dismiss(id, { kind, source: "bottom", ttlMs: SNOOZE_MS })}
        onResolve={(commitmentId, action) => {
          setResolveError(null);
          resolveCommitment.mutate({ commitmentId, action });
        }}
        feedNotes={feedNotes}
        resolveError={resolveError}
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

/** The full pulse feed — a bottom sheet opened from the strip. Every item
 *  readable + tappable (≥44px rows) with a visible snooze.
 *
 *  2026-10-10 (audit 09-F4) · runs on the Base UI Dialog the More sheet uses:
 *  focus moves in and is trapped, Escape and a scrim tap close it, page scroll
 *  locks, focus returns to the strip button. That replaced a click-catcher div,
 *  a window Escape listener and an animationend unmount machine (whose failure
 *  mode was a ghost sheet that never unmounted). Enter/exit ride the popup's
 *  data-open / data-closed state; Base UI unmounts after the exit runs. */
export function PulseFeedSheet({
  open,
  items,
  activeIdx,
  onClose,
  onDismiss,
  onResolve,
  resolvingId,
  onPick,
  returnFocusRef,
  feedNotes = [],
  resolveError = null,
}: {
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
  /** The strip button that opened the sheet; focus returns to it on close. */
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  /** One sentence per feed that failed (could not load, or could not refresh over cached items): said above the list, never hidden. */
  feedNotes?: string[];
  /** A rejected Done / Drop, shown where the tap happened. */
  resolveError?: string | null;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        unstyled
        showCloseButton={false}
        finalFocus={returnFocusRef}
        overlayClassName="z-[70] bg-canvas/60"
        className="fixed inset-x-0 bottom-0 z-[71] max-h-[60dvh] overflow-y-auto overscroll-contain border-t border-edge-default bg-overlay pb-[env(safe-area-inset-bottom,0px)] outline-none duration-[var(--motion-panel)] data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-2 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-2"
      >
        <div className="sticky top-0 flex items-center justify-between px-3 py-2 border-b border-edge-subtle bg-overlay">
          <DialogTitle className="font-mono text-[11px] font-normal text-fg-tertiary">
            Pulse · {items.length}
          </DialogTitle>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-control px-2 font-mono text-[12px] text-fg-tertiary hover:text-fg sm:min-h-9"
          >
            Close
          </button>
        </div>
        {feedNotes.length > 0 && (
          <p role="status" className="border-b border-edge-subtle px-3 py-2 text-[13px] text-amber-300">
            {feedNotes.join(" ")}
          </p>
        )}
        {resolveError && (
          <p role="alert" className="border-b border-edge-subtle px-3 py-2 text-[13px] text-red-300">
            {resolveError}
          </p>
        )}
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
                <Link
                  href={it.href}
                  className="flex-1 min-w-0 py-2 rounded-control hover:bg-surface-hover transition-colors duration-[var(--motion-state)]"
                  aria-label={`${it.label}: ${it.text}`}
                  onClick={onClose}
                >
                  <PulseContent item={it} row />
                </Link>
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
                alwaysVisible
                className="shrink-0 hover:text-rose-400"
              />
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
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
        aria-label="Drop this promise, no longer doing it"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control px-2 font-mono text-[11px] text-fg-tertiary hover:text-rose-400 disabled:opacity-40 sm:min-h-9 sm:min-w-9"
      >
        Drop
      </button>
    </div>
  );
}
