"use client";

/**
 * FLOATING HOME — Draggable, swipe-to-hide nav orb.
 *
 * Behavior:
 *  - **Tap**        → toggle the quick-nav menu
 *  - **Drag**       → reposition the orb anywhere on screen; snaps to
 *                     nearest horizontal edge on release
 *  - **Swipe right**→ flick the orb off-screen to a thin peek tab
 *  - **Tap peek**   → orb comes back to its last position
 *
 * Position (x/y %, edge side, hidden state) persists to localStorage
 * so it survives navigation and full reloads.
 *
 * Renders on first paint (no mounted null-guard). Initial state is
 * collapsed + default bottom-right; persisted state is applied in an
 * effect after hydration. No SSR/CSR mismatch because the DOM markup
 * is identical in both runs — only inline styles change.
 *
 * Works on both touch (mobile) and mouse (desktop). Pointer Events API
 * unifies them so the same code handles both.
 *
 * Portability: zero dependencies on NourState. Only needs Next.js Link +
 * usePathname, lucide icons, and nav-items. Drop-in ready for any app.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MOBILE_TABS, NAV_ITEMS, type NavItem } from "./nav-items";
import { resolveActiveNav } from "@/lib/nav/active-nav";
import { CAPTURE_OPEN_EVENT } from "@/components/brain-dump-modal";
import { COMMAND_PALETTE_OPEN_EVENT } from "@/components/command-palette";
// v10.0.529.72 · BrainIcon · ServerIcon · CompassIcon dropped — they
// only powered the BRAIN / OPS / LIFE rows of the QUICK NAV that were
// inlined into <ActionsContextBand> on /tasks.
import { Minus, Shield, GripVertical, ChevronLeft, NotebookPen, Cog as CogIcon, ArrowRight, Clock, Target, Users, Search } from "lucide-react";
import { useSystemPulse, type SystemPulse } from "@/lib/hooks/use-system-pulse";
import { useRecentPages } from "@/lib/hooks/use-recent-pages";
import { pickSmartNow } from "@/lib/floating-home/smart-now";

// Nav items in the floating orb menu. Rendered from MOBILE_TABS so the
// orb and the mobile bottom tabs always stay in sync (currently:
// Ultron, Nick, Actions, Journal, Admin). Depth items like Growth /
// Brain / System / Settings live in the sidebar + ⌘K palette only so
// the orb stays a 5-item surface — the quick-nav, not a full menu.

const STORAGE_KEY_STATE = "nour-floating-home:state-v2";
const DRAG_THRESHOLD = 6;        // px before drag kicks in
/** v11.0 · Nick-quality badge shows only after this many replies have
 *  been scored in the 7d window. Avoids noise when data is cold. */
const NICK_QUALITY_MIN_REPLIES = 3;
const SWIPE_HIDE_DISTANCE = 80;  // px swipe right to hide
const SWIPE_HIDE_VELOCITY = 0.4; // px/ms to count as a flick
const EDGE_PADDING = 16;         // min distance from viewport edge
const ORB_SIZE = 48;

interface OrbState {
  /** Hidden to peek tab? */
  hidden: boolean;
  /** Pixel position from top-left. Persisted between sessions. */
  x: number;
  y: number;
  /** Which edge the peek tab sticks to when hidden. */
  peekEdge: "right" | "left";
  /** Is the nav menu expanded? */
  expanded: boolean;
}

function defaultState(): OrbState {
  // Server-safe defaults. Recomputed after hydration with real viewport.
  return {
    hidden: false,
    x: 9999, // sentinel — replaced on mount
    y: 9999,
    peekEdge: "right",
    expanded: false,
  };
}

function clampToViewport(x: number, y: number): { x: number; y: number } {
  if (typeof window === "undefined") return { x, y };
  const maxX = window.innerWidth - ORB_SIZE - EDGE_PADDING;
  const maxY = window.innerHeight - ORB_SIZE - EDGE_PADDING;
  return {
    x: Math.max(EDGE_PADDING, Math.min(maxX, x)),
    y: Math.max(EDGE_PADDING, Math.min(maxY, y)),
  };
}

function snapToNearestEdge(x: number): { x: number; edge: "left" | "right" } {
  if (typeof window === "undefined") return { x, edge: "right" };
  const center = x + ORB_SIZE / 2;
  const half = window.innerWidth / 2;
  if (center < half) {
    return { x: EDGE_PADDING, edge: "left" };
  }
  return { x: window.innerWidth - ORB_SIZE - EDGE_PADDING, edge: "right" };
}

// v11 restructure · pulseCount helper retired — the expanded SYSTEM
// OPS rows it fed were collapsed into a single Settings link. The
// NavItem.pulseKey field stays for any future per-tab badge surface.
// Reference kept for doc-completeness: see /settings SystemOpsHub.
// Prefix with _ so eslint's no-unused-vars rule ignores it
// without needing a suppression comment.
type _PulseTabRef = NavItem;
// Side-effect reference so tree-shaking doesn't warn about the
// doc-only type alias.
export type { _PulseTabRef };

/** Overall orb tint: red when anything critical RIGHT NOW, amber when
 *  anything warning, gold when calm. Drives the orb border color so
 *  Nour sees system state at a glance without opening the menu.
 *
 *  v11.1 refinement — the orb used to paint red if there was ANY fatal
 *  error or failed cron in the last 24h, which meant a single transient
 *  blip at 11pm kept the orb red all day. Now uses fresh-tail counters
 *  (1h cron fails, 6h fatals, 1h AI error rate) for the red trigger, so
 *  the orb actually clears once the issue ages out. The wider 24h counts
 *  still show up in the drawer — they just don't lock the tone. */
function deriveOrbTone(pulse: SystemPulse | null): "gold" | "amber" | "red" {
  if (!pulse) return "gold";
  // Fresh-tail red: something is on fire NOW, not "sometime today"
  const freshFatal = pulse.errorsFatal6h ?? pulse.errorsFatal24h;
  const freshCronFail = pulse.cronFails1h ?? pulse.cronFails24h;
  const freshAiRate = pulse.aiErrorRate1h ?? pulse.aiErrorRate;
  if (freshFatal > 0 || freshCronFail > 0 || freshAiRate > 20) return "red";
  // Amber: wider 24h window for lingering concerns worth glancing at
  if (pulse.cronsDrifted > 0 || pulse.errors24h > 0 || pulse.aiErrorRate > 5 || pulse.actionsPending > 0) return "amber";
  return "gold";
}

export function FloatingHome() {
  const pathname = usePathname();
  const pulse = useSystemPulse();
  const orbTone = deriveOrbTone(pulse);
  // v10.0.348 · smart additions · context-aware "do this now" suggestion
  // + recent-3 jump candidates. Both are cheap reads (pulse already
  // polled once for the whole orb · recents read from localStorage).
  const smartNow = pickSmartNow({ pathname: pathname ?? "/", pulse });
  const { candidates: recentCandidates } = useRecentPages();
  const [state, setState] = useState<OrbState>(defaultState);
  const [hydrated, setHydrated] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Drag/swipe tracking
  const pointerStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // ── Hydrate persisted state ────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STATE);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<OrbState>;
        const base = defaultBottomRight();
        const next: OrbState = {
          hidden: parsed.hidden ?? false,
          x: typeof parsed.x === "number" ? parsed.x : base.x,
          y: typeof parsed.y === "number" ? parsed.y : base.y,
          peekEdge: parsed.peekEdge === "left" ? "left" : "right",
          expanded: false,
        };
        const clamped = clampToViewport(next.x, next.y);
        setState({ ...next, x: clamped.x, y: clamped.y });
      } else {
        setState({ ...defaultState(), ...defaultBottomRight() });
      }
    } catch {
      setState({ ...defaultState(), ...defaultBottomRight() });
    }
    setHydrated(true);
  }, []);

  // ── Persist on change ──────────────────────────────────
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        STORAGE_KEY_STATE,
        JSON.stringify({
          hidden: state.hidden,
          x: state.x,
          y: state.y,
          peekEdge: state.peekEdge,
        })
      );
    } catch {}
  }, [state.hidden, state.x, state.y, state.peekEdge, hydrated]);

  // ── Auto-close menu on route change ────────────────────
  useEffect(() => {
    setState((s) => ({ ...s, expanded: false }));
  }, [pathname]);

  // ── Re-clamp on window resize ──────────────────────────
  useEffect(() => {
    if (!hydrated) return;
    function onResize() {
      setState((s) => {
        const c = clampToViewport(s.x, s.y);
        return { ...s, x: c.x, y: c.y };
      });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [hydrated]);

  // ── Click outside closes menu ──────────────────────────
  useEffect(() => {
    if (!state.expanded) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setState((s) => ({ ...s, expanded: false }));
      }
    }
    const t = setTimeout(() => document.addEventListener("click", onDocClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", onDocClick);
    };
  }, [state.expanded]);

  // ── Escape closes menu ─────────────────────────────────
  useEffect(() => {
    if (!state.expanded) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setState((s) => ({ ...s, expanded: false }));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state.expanded]);

  // ── Pointer handlers (unified touch + mouse) ───────────
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const target = e.currentTarget;
    try { target.setPointerCapture(e.pointerId); } catch {}
    pointerStart.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    dragOffset.current = { dx: e.clientX - state.x, dy: e.clientY - state.y };
    setDragging(false);
  }, [state.x, state.y]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerStart.current || !dragOffset.current) return;
    const dx = e.clientX - pointerStart.current.x;
    const dy = e.clientY - pointerStart.current.y;
    const moved = Math.hypot(dx, dy);
    if (!dragging && moved < DRAG_THRESHOLD) return;
    if (!dragging) setDragging(true);
    // Update position directly for smooth drag
    const nextX = e.clientX - dragOffset.current.dx;
    const nextY = e.clientY - dragOffset.current.dy;
    const clamped = clampToViewport(nextX, nextY);
    setState((s) => ({ ...s, x: clamped.x, y: clamped.y }));
  }, [dragging]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    dragOffset.current = null;
    if (!start) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dt = Date.now() - start.t;
    const moved = Math.hypot(dx, dy);
    const velocityX = dx / Math.max(dt, 1);

    // Swipe right → hide to peek tab (edge that makes sense from where
    // the orb currently sits).
    const isRightFlick = dx > SWIPE_HIDE_DISTANCE && velocityX > SWIPE_HIDE_VELOCITY;
    const isLeftFlick = dx < -SWIPE_HIDE_DISTANCE && velocityX < -SWIPE_HIDE_VELOCITY;
    if (isRightFlick || isLeftFlick) {
      setState((s) => ({
        ...s,
        hidden: true,
        peekEdge: isRightFlick ? "right" : "left",
        expanded: false,
      }));
      setDragging(false);
      return;
    }

    if (moved < DRAG_THRESHOLD) {
      // Treat as tap → toggle menu
      setState((s) => ({ ...s, expanded: !s.expanded }));
      setDragging(false);
      return;
    }

    // Drag release → snap horizontally to nearest edge, keep vertical
    const snapped = snapToNearestEdge(state.x);
    setState((s) => ({ ...s, x: snapped.x, peekEdge: snapped.edge }));
    setDragging(false);
  }, [state.x]);

  // ── Peek tab restore ───────────────────────────────────
  const restoreFromPeek = useCallback(() => {
    setState((s) => {
      // Come back to the last position, or default edge if none
      const base = defaultBottomRight();
      const x = s.x > 0 && s.x < (typeof window !== "undefined" ? window.innerWidth : 9999)
        ? s.x
        : base.x;
      const y = s.y > 0 && s.y < (typeof window !== "undefined" ? window.innerHeight : 9999)
        ? s.y
        : base.y;
      return { ...s, hidden: false, x, y, expanded: false };
    });
  }, []);

  // Determine the active surface so the orb icon + menu header reflect
  // WHERE the operator is, on every page (not just the 4 mobile tabs).
  const activeNav = resolveActiveNav(pathname ?? "/", NAV_ITEMS);
  const OrbIcon = activeNav?.icon ?? Shield;

  // ── Render: peek tab when hidden ───────────────────────
  if (state.hidden) {
    return (
      <button
        onClick={restoreFromPeek}
        aria-label="Restore navigation orb"
        className={cn(
          "fixed top-1/2 -translate-y-1/2 z-40",
          "w-2 h-16 rounded-l-full rounded-r-none",
          "bg-[var(--gold)] shadow-[0_0_16px_rgba(253,185,19,0.6)]",
          "hover:w-3 transition-[transform,opacity] duration-200",
          state.peekEdge === "right" ? "right-0" : "left-0 rounded-l-none rounded-r-full"
        )}
        style={{
          // Extra ambient pulse so it's discoverable
          animation: "peek-pulse 2s ease-in-out infinite",
        }}
      >
        <ChevronLeft
          size={10}
          className={cn(
            "text-[var(--bg-void)] absolute top-1/2 -translate-y-1/2",
            state.peekEdge === "right" ? "left-0" : "right-0 rotate-180"
          )}
        />
      </button>
    );
  }

  // ── Render: orb + optional expanded menu ───────────────
  return (
    <div
      ref={wrapperRef}
      className="fixed z-40"
      style={{
        left: `${state.x}px`,
        top: `${state.y}px`,
        transition: dragging ? "none" : "left 0.22s ease, top 0.22s ease",
        touchAction: "none",
      }}
    >
      {/* Expanded menu — stacks upward from the orb when there's room,
          downward otherwise. */}
      {state.expanded && (
        <div
          className={cn(
            "absolute w-44",
            "rounded-2xl border border-[var(--gold)]/40",
            "bg-[var(--bg-void)] backdrop-blur-xl",
            "shadow-[0_20px_60px_rgba(0,0,0,0.6),0_0_40px_rgba(253,185,19,0.2)]",
            "overflow-hidden animate-fadeSlideUp origin-bottom-right",
            // Position above the orb
            "bottom-14 right-0"
          )}
        >
          <div className="px-3 py-2 border-b border-[var(--border-default)] flex items-center justify-between">
            <span className="text-[9px] font-[var(--font-display)] font-bold uppercase tracking-[0.2em] text-[var(--gold)]">
              Nour OS
            </span>
            <span className="text-[8px] font-mono text-[var(--text-tertiary)] uppercase">
              {activeNav ? activeNav.label : "quick nav"}
            </span>
          </div>

          {/* 2026-06-18 · IA reorg Phase 1 · Search opens the ⌘K command
              palette by TAP — the only way to reach it on the keyboardless
              iOS PWA. Dispatches COMMAND_PALETTE_OPEN_EVENT (mirrors Capture). */}
          <button
            onClick={() => {
              window.dispatchEvent(new Event(COMMAND_PALETTE_OPEN_EVENT));
              setState((s) => ({ ...s, expanded: false }));
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-xs transition-colors border-b border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--gold)]/10 hover:text-[var(--gold)]"
            aria-label="Search everything (open command palette)"
          >
            <Search size={14} strokeWidth={1.75} />
            <span className="font-medium uppercase tracking-[0.15em] text-[10px]">
              Search
            </span>
            <kbd className="ml-auto hidden sm:inline-flex items-center h-4 px-1 rounded border border-[var(--border-default)] bg-[var(--bg-raised)] text-[8px] font-mono text-[var(--text-tertiary)]">
              ⌘K
            </kbd>
          </button>

          {/* v10.0.348 · SMART NOW · context-aware top suggestion. Shows the
              highest-leverage next-step based on pulse + time-of-day. Tap
              once to jump. Auto-skips when operator is already on target.
              Tone reflects urgency · red=critical · amber=medium · gold=low. */}
          {smartNow && (
            <Link
              href={smartNow.href}
              onClick={() => setState((s) => ({ ...s, expanded: false }))}
              className={cn(
                "flex items-center gap-2 px-3 py-2 text-xs transition-colors border-b border-[var(--border-default)]",
                smartNow.urgency === "high"
                  ? "bg-rose-500/[0.08] text-rose-200 hover:bg-rose-500/15"
                  : smartNow.urgency === "medium"
                    ? "bg-amber-500/[0.06] text-amber-200 hover:bg-amber-500/15"
                    : "bg-[var(--gold)]/[0.05] text-[var(--gold)]/80 hover:bg-[var(--gold)]/15 hover:text-[var(--gold)]",
              )}
              title={`${smartNow.reason} · tap to jump`}
              aria-label={`Smart suggestion: ${smartNow.label} · ${smartNow.reason}`}
            >
              {smartNow.emoji && (
                <span className="text-[12px] shrink-0" aria-hidden>
                  {smartNow.emoji}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-mono uppercase tracking-wider opacity-60">
                  Now
                </div>
                <div className="text-[11px] font-medium truncate">
                  {smartNow.label}
                </div>
              </div>
              <ArrowRight size={11} className="shrink-0 opacity-60" />
            </Link>
          )}

          {/* v10.0.348 · RECENT JUMPS · last 3 distinct pages from
              localStorage. Excludes the current page. Compact horizontal
              pills for one-tap revisit · matches the operator's actual
              navigation pattern. */}
          {recentCandidates.length > 0 && (
            <div className="px-2 py-1.5 border-b border-[var(--border-default)] bg-[var(--bg-raised)]/30">
              <div className="flex items-center gap-1 mb-1">
                <Clock size={9} className="text-[var(--text-tertiary)]" />
                <span className="text-[8px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                  recent
                </span>
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {recentCandidates.map((r) => (
                  <Link
                    key={r.href}
                    href={r.href}
                    onClick={() => setState((s) => ({ ...s, expanded: false }))}
                    className="text-[9px] font-mono px-2 py-0.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-base)]/40 text-[var(--text-secondary)] hover:bg-[var(--gold)]/10 hover:border-[var(--gold)]/30 hover:text-[var(--gold)] transition-colors truncate max-w-[120px]"
                    title={r.href}
                  >
                    {r.label}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="py-1">
            {MOBILE_TABS.map((item) => {
              const Icon = item.icon;
              // Active when paths match exactly, OR when on a sub-path.
              // Special case: `/` only matches exactly (every other path
              // starts with `/` too, which would otherwise always match).
              // External items (Admin → nickstire.org) are never active
              // — they live outside autonicks so pathname never matches.
              const isActive =
                item.external
                  ? false
                  : item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href || pathname.startsWith(item.href + "/");

              const className = cn(
                "flex items-center gap-3 px-3 py-2.5 text-xs transition-colors border-l-2",
                isActive
                  ? "bg-[var(--gold)]/10 text-[var(--gold)] border-l-[var(--gold)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] border-l-transparent"
              );

              const inner = (
                <>
                  <Icon size={14} strokeWidth={isActive ? 2.25 : 1.5} />
                  <span className="font-medium uppercase tracking-[0.15em] text-[10px]">
                    {item.label}
                  </span>
                  {item.external && (
                    <span
                      className="ml-auto text-[8px] font-mono text-[var(--text-tertiary)]"
                      aria-hidden="true"
                      title="opens nickstire.org/admin in a new tab"
                    >
                      ↗
                    </span>
                  )}
                  {!item.external && isActive && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--gold)] animate-pulse" />
                  )}
                </>
              );

              // External targets render as a plain <a> with target + rel
              // so the browser actually navigates cross-origin. <Link>
              // optimistically prefetches + client-side routes which
              // breaks for absolute URLs.
              if (item.external) {
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={className}
                    onClick={() => setState((s) => ({ ...s, expanded: false }))}
                  >
                    {inner}
                  </a>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={className}
                  onClick={() => setState((s) => ({ ...s, expanded: false }))}
                >
                  {inner}
                </Link>
              );
            })}
          </div>

          {/* Goals · 2026-05-21 · the KommandoShell dismantle relocated
              the old /tasks PLAN tab to a standalone /goals page (goal
              authoring + active missions) and added /goals to NAV_ITEMS
              — but only as a DEPTH item, which the orb (it renders
              MOBILE_TABS only) never surfaces. On a phone — the
              operator's primary device — that left goals + missions
              reachable only by typing the URL. This row restores
              one-tap access from the single nav surface.

              2026-05-28 · operator asked "where are the missions" and
              "the new page needs to be added to the floating home bar".
              Added two adjacent rows: Missions (deep-link to /goals
              #missions where MissionScoreboard surfaces) and
              Relationships (Power Atlas · the per-person CIA dossier +
              Greene law coach shipped over the last 2 days). All three
              rows share the same gold hover treatment so the section
              reads as one unit. */}
          <div className="border-t border-[var(--border-default)]">
            {/* 2026-05-30 · /scoreboard + /goals consolidated into /stats
                (personal character sheet + goals). This row pointed at the
                retired /goals; now it deep-links the combined Stats surface
                so the orb menu has one personal-progress entry, not a stale
                "Goals" that 308-redirects. */}
            <Link
              href="/stats"
              onClick={() => setState((s) => ({ ...s, expanded: false }))}
              className="flex items-center gap-3 px-3 py-2.5 text-xs transition-colors border-l-2 border-l-transparent text-[var(--text-secondary)] hover:bg-[var(--gold)]/10 hover:text-[var(--gold)] hover:border-l-[var(--gold)]"
              title="stats · your character sheet + goals + leveling"
            >
              <Target size={14} strokeWidth={1.5} />
              <span className="font-medium uppercase tracking-[0.15em] text-[10px]">
                Stats
              </span>
            </Link>
            {/* wave-AB.e · removed the hardcoded Missions row here ·
             *  Wave AA renamed the mobile-tab "Actions" → "Missions"
             *  so this row became a literal duplicate of the entry
             *  already rendered above from MOBILE_TABS. Operator saw
             *  Missions twice in the orb menu. */}
            <Link
              href="/people"
              onClick={() => setState((s) => ({ ...s, expanded: false }))}
              className="flex items-center gap-3 px-3 py-2.5 text-xs transition-colors border-l-2 border-l-transparent text-[var(--text-secondary)] hover:bg-[var(--gold)]/10 hover:text-[var(--gold)] hover:border-l-[var(--gold)]"
              title="power atlas · per-person dossier + Greene law coach"
            >
              <Users size={14} strokeWidth={1.5} />
              <span className="font-medium uppercase tracking-[0.15em] text-[10px]">
                People
              </span>
            </Link>
          </div>

          {/* v10.0.529.72 · Wave 18 IA merge · BRAIN + LIFE + OPS rows
              deleted from QUICK NAV. Per the operator's IA pass: Brain
              and Life "fit better in Actions" — they're now inlined as
              the <ActionsContextBand> above <KommandoShell> on /tasks.
              OPS row was redundant with the SystemOpsHub block at the
              top of /settings (built in Wave 17.4) which already lists
              every /system/* surface with live pulse counts. Net result:
              the QUICK NAV drops from 10 items → 7 · cleaner mental
              model · brain/life/system still reachable via ⌘K + the
              context band + direct URLs. Pulse drift signal preserved
              on the Settings row's system-tone dot below.
              See docs/adr/0013-merge-brain-life-ops-ia.md. */}
          <div className="border-t border-[var(--border-default)]">
            <Link
              href="/settings"
              onClick={() => setState((s) => ({ ...s, expanded: false }))}
              className="flex items-center gap-3 px-3 py-2.5 text-xs transition-colors border-l-2 border-l-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] border-t border-[var(--border-default)]/40"
              title="settings · skill library · identity · preferences · data"
            >
              <CogIcon size={13} strokeWidth={1.5} />
              <span className="font-medium uppercase tracking-[0.15em] text-[10px]">
                Settings
              </span>

              {/* Nick-quality 7d badge + delta arrow */}
              {pulse?.nickQualityAvg7d != null &&
                pulse.nickQualityReplies7d != null &&
                pulse.nickQualityReplies7d >= NICK_QUALITY_MIN_REPLIES && (() => {
                  const arrow =
                    pulse.nickQualityDirection === "rising" ? "↗" :
                    pulse.nickQualityDirection === "falling" ? "↘" :
                    pulse.nickQualityDirection === "flat" ? "→" : "";
                  const tint =
                    pulse.nickQualityAvg7d >= 80 ? "text-emerald-300 bg-emerald-500/10" :
                    pulse.nickQualityAvg7d >= 65 ? "text-amber-300 bg-amber-500/10" :
                    "text-rose-300 bg-rose-500/10 animate-pulse";
                  return (
                    <span
                      className={cn("ml-auto rounded-full px-1.5 py-[1px] text-[8px] font-mono tabular-nums", tint)}
                      title={`Nick quality · 7d mean ${pulse.nickQualityAvg7d}/100`}
                    >
                      🧠 {pulse.nickQualityAvg7d}{arrow && <span className="ml-0.5">{arrow}</span>}
                    </span>
                  );
                })()}

              {/* Overall system tone dot */}
              <span
                className={cn(
                  !pulse?.nickQualityAvg7d && "ml-auto",
                  "flex items-center gap-1",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    orbTone === "red" ? "bg-rose-400 animate-pulse" :
                    orbTone === "amber" ? "bg-amber-400 animate-pulse" :
                    "bg-emerald-400",
                  )}
                  title={pulse
                    ? `${pulse.errors24h} errors · ${pulse.cronsDrifted} drifted · ${pulse.aiErrorRate}% AI err · ${pulse.actionsPending} pending`
                    : "loading pulse…"}
                />
                <span className="text-[8px] font-mono text-[var(--text-tertiary)] uppercase">
                  {orbTone === "red" ? "alert" : orbTone === "amber" ? "watch" : "calm"}
                </span>
              </span>
            </Link>
          </div>

          {/* Action row — capture folds in here instead of a second
              floating button. Keyboard shortcut (⌘⇧J) still works globally. */}
          <div className="border-t border-[var(--border-default)] py-1">
            <button
              onClick={() => {
                window.dispatchEvent(new Event(CAPTURE_OPEN_EVENT));
                setState((s) => ({ ...s, expanded: false }));
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-xs transition-colors border-l-2 border-l-transparent text-[var(--text-secondary)] hover:bg-[var(--gold)]/10 hover:text-[var(--gold)] hover:border-l-[var(--gold)]"
              aria-label="Capture a thought (⌘⇧J)"
            >
              <NotebookPen size={14} strokeWidth={1.75} />
              <span className="font-medium uppercase tracking-[0.15em] text-[10px]">
                Capture
              </span>
              <kbd className="ml-auto hidden sm:inline-flex items-center h-4 px-1 rounded border border-[var(--border-default)] bg-[var(--bg-raised)] text-[8px] font-mono text-[var(--text-tertiary)]">
                ⌘⇧J
              </kbd>
            </button>
          </div>

          <div className="border-t border-[var(--border-default)] flex">
            <button
              onClick={() => setState((s) => ({ ...s, hidden: true }))}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[10px] uppercase tracking-[0.15em] text-[var(--text-tertiary)] hover:bg-[var(--bg-raised)] hover:text-[var(--gold)] transition-colors border-r border-[var(--border-default)]"
              aria-label="Hide orb to peek tab"
            >
              <ChevronLeft size={12} />
              Hide
            </button>
            <button
              onClick={() => setState((s) => ({ ...s, expanded: false }))}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[10px] uppercase tracking-[0.15em] text-[var(--text-tertiary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-secondary)] transition-colors"
            >
              <Minus size={12} />
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── The orb ── */}
      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn(
          "relative w-12 h-12 rounded-full flex items-center justify-center",
          "bg-[var(--bg-void)]",
          "shadow-[0_8px_24px_rgba(0,0,0,0.6),0_0_0_1px_rgba(253,185,19,0.3)]",
          "border-2 select-none",
          "active:scale-90",
          // v11.0 — orb tone reflects system vitals. Gold = calm, amber =
          // watch, red = alert. Applied only when menu closed so the
          // expanded state stays visually distinct.
          state.expanded
            ? "border-[var(--gold)] text-[var(--gold)] scale-95 shadow-[0_0_32px_rgba(253,185,19,0.5)]"
            : orbTone === "red"
              ? "border-rose-500/80 text-rose-400 hover:border-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.3)]"
              : orbTone === "amber"
                ? "border-amber-500/70 text-amber-400 hover:border-amber-400"
                : "border-[var(--gold)]/60 text-[var(--gold)] hover:border-[var(--gold)]",
          dragging && "cursor-grabbing",
          !dragging && "cursor-grab"
        )}
        aria-label={
          state.expanded
            ? "Close navigation menu"
            : `Open navigation menu (drag to move, swipe to hide). System: ${orbTone}`
        }
        aria-expanded={state.expanded}
        style={{ touchAction: "none" }}
      >
        <OrbIcon size={20} strokeWidth={2.25} />

        {/* v11.0 — critical badge: count of problems when system tone is
            red. Tiny notification pip in the upper-right. */}
        {!state.expanded && pulse && orbTone === "red" && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-rose-500 text-white text-[9px] font-mono font-bold flex items-center justify-center border border-[var(--bg-void)] animate-pulse"
            aria-label="critical system issues — tap orb to inspect"
          >
            {Math.min(99, pulse.errorsFatal24h + pulse.cronFails24h)}
          </span>
        )}

        {/* Drag affordance — a tiny grip indicator on hover/drag */}
        {dragging && (
          <GripVertical
            size={10}
            className="absolute -top-1 -right-1 text-[var(--gold)] bg-[var(--bg-void)] rounded-full border border-[var(--gold)]/40"
          />
        )}

        {/* Ambient halo pulse — tint matches orb tone */}
        {!state.expanded && !dragging && (
          <span
            className={cn(
              "absolute inset-0 rounded-full border pointer-events-none",
              orbTone === "red" ? "border-rose-500/40" :
              orbTone === "amber" ? "border-amber-500/40" :
              "border-[var(--gold)]/30",
            )}
            style={{ animation: "cockpit-halo 4s ease-in-out infinite" }}
          />
        )}
      </button>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────
function defaultBottomRight(): { x: number; y: number } {
  if (typeof window === "undefined") {
    return { x: 0, y: 0 };
  }
  return {
    x: window.innerWidth - ORB_SIZE - EDGE_PADDING,
    y: window.innerHeight - ORB_SIZE - EDGE_PADDING - 64, // lifted above any bottom bar
  };
}
