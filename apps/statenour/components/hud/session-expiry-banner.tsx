"use client";

/**
 * SessionExpiryBanner — proactive warning before NextAuth session dies.
 *
 * Problem it solves: NextAuth JWT sessions expire silently. Nour is
 * mid-capture, hits save, gets a 401 → useAuthedFetch bounces him to
 * /auth/sign-in → he loses whatever he was typing. This banner warns
 * him BEFORE the session dies so he can re-auth on his own terms.
 *
 * Behavior:
 *   - Polls /api/auth/expires (edge runtime, ~5ms warm) every 2 min
 *     when idle, every 30s once we're inside the warn window.
 *   - When remaining life ≤ 10 min: amber banner with countdown +
 *     "Refresh now" action.
 *   - When remaining life ≤ 1 min: rose banner, pulsing dot, same
 *     action — last-chance prompt.
 *   - Dismiss hides for 10 min (returns if session still alive).
 *   - Silent when > 10 min remaining OR when auth is disabled (mock
 *     session has no expires field).
 *
 * Apr 26: switched from /api/auth/session (Node catchall) to
 * /api/auth/expires (edge route, single jwt-decode). ~80% latency cut
 * per poll, no behavior change.
 *
 * Mount in a client layout (e.g., app/(mastery)/layout.tsx) so it only
 * renders inside authenticated surfaces. /auth/* pages don't need it.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";

import { trpc } from "@/lib/trpc/client";

const POLL_ACTIVE_MS = 30_000; // within danger window → check often
const POLL_IDLE_MS = 120_000; // well above threshold → slow polling
const WARN_MS = 10 * 60_000;
const URGENT_MS = 60_000;
const DISMISS_MS = 10 * 60_000;

const DISMISS_KEY = "session-expiry-banner:dismissedAt";

function readDismissedUntil(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function SessionExpiryBanner() {
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [dismissedUntil, setDismissedUntil] = useState<number>(() =>
    readDismissedUntil(),
  );

  // scattered-components REST→tRPC slice (2026-05-22) · `utils` drives
  // the session-expiry probe (migrated off `authedFetch("/api/auth/
  // expires")` onto `trpc.system.sessionExpiry`). The poll cadence is
  // dynamic (30s inside the warn window · 120s outside) which React
  // Query's static `refetchInterval` can't express, so the probe is
  // fired imperatively via `utils.system.sessionExpiry.fetch()` from
  // the existing setInterval. The procedure returns `{ expires }`
  // directly (the legacy route's bare shape) · `sessionExpiry` is a
  // PUBLIC procedure so it works even as the session winds down.
  const utils = trpc.useUtils();

  const fetchSession = useCallback(async () => {
    try {
      // `staleTime: 0` forces every poll to hit the network — a cached
      // expiry value would defeat the whole point of the banner.
      const data = await utils.system.sessionExpiry.fetch(undefined, {
        staleTime: 0,
      });
      if (data?.expires) {
        const t = new Date(data.expires).getTime();
        setExpiresAt(Number.isFinite(t) ? t : null);
      } else {
        // No expires field — mock/dev mode, or not logged in.
        setExpiresAt(null);
      }
    } catch {
      setExpiresAt(null);
    }
  }, [utils]);

  // Tick `now` each second so the countdown updates smoothly.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Poll /api/auth/expires — faster when inside the warn window so
  // we catch a refresh the moment it lands.
  //
  // v10.0.48 — split into initial-load + interval to break the re-mount
  // race. Pre-fix the dep `[fetchSession, expiresAt]` re-ran the effect
  // every time fetchSession's setExpiresAt landed: the new effect ran
  // fetchSession again (extra network hit) AND started a new interval
  // while the cleanup fired async, briefly running two concurrent polls.
  // Now: initial fetch once on mount; interval driven by an `inWarn`
  // state derived from expiresAt without re-mounting on every change.
  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

  useEffect(() => {
    const remaining = expiresAt ? expiresAt - Date.now() : Infinity;
    const inWarn = remaining <= WARN_MS;
    const interval = inWarn ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    const id = setInterval(fetchSession, interval);
    return () => clearInterval(id);
    // Only re-create the interval when crossing the warn boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSession, expiresAt ? expiresAt - Date.now() <= WARN_MS : false]);

  const dismiss = useCallback(() => {
    const until = Date.now() + DISMISS_MS;
    setDismissedUntil(until);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(until));
    } catch {
      /* storage disabled */
    }
  }, []);

  const refresh = useCallback(() => {
    // NextAuth refreshes JWT on any authenticated request — full
    // navigation to sign-in is the simplest "get me a fresh cookie"
    // path that handles expired sessions cleanly.
    const callback = window.location.pathname + window.location.search;
    window.location.href =
      "/auth/sign-in?callbackUrl=" + encodeURIComponent(callback);
  }, []);

  if (!expiresAt) return null;

  const remaining = expiresAt - now;
  if (remaining > WARN_MS) return null;
  if (remaining <= 0) return null; // expired — the next authed request bounces to sign-in
  // lint-baseline 2026-08-13 · use the ticking `now` state instead of
  // Date.now() in render (react-hooks/purity). Dismissal is hours-scale,
  // so tick granularity is more than enough.
  if (now < dismissedUntil) return null;

  const urgent = remaining <= URGENT_MS;

  const mins = Math.floor(remaining / 60_000);
  const secs = Math.floor((remaining % 60_000) / 1_000);
  const countdown = mins > 0 ? `${mins}m ${secs.toString().padStart(2, "0")}s` : `${secs}s`;

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "fixed inset-x-0 top-0 z-[60] flex justify-center px-3 pt-[env(safe-area-inset-top)]",
      )}
    >
      <div
        className={cn(
          "mt-2 flex w-full max-w-2xl items-center gap-3 rounded-xl border px-3 py-2 shadow-lg backdrop-blur",
          urgent
            ? "border-rose-500/50 bg-rose-950/80 text-rose-100"
            : "border-amber-500/40 bg-amber-950/80 text-amber-100",
        )}
      >
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            urgent ? "bg-rose-400 animate-pulse" : "bg-amber-400",
          )}
          aria-hidden
        />
        <AlertTriangle
          className={cn(
            "h-4 w-4 shrink-0",
            urgent ? "text-rose-200" : "text-amber-200",
          )}
          aria-hidden
        />
        <div className="flex-1 min-w-0 text-sm leading-tight">
          <span className="font-semibold">
            {urgent ? "Session expiring" : "Session expires soon"}
          </span>
          <span className="ml-2 tabular-nums opacity-90">in {countdown}</span>
          <span className="ml-2 hidden opacity-70 sm:inline">
            refresh now to avoid losing in-progress work
          </span>
        </div>
        <button
          type="button"
          onClick={refresh}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
            urgent
              ? "border-rose-400/50 bg-rose-500/20 hover:bg-rose-500/30"
              : "border-amber-400/40 bg-amber-500/20 hover:bg-amber-500/30",
          )}
        >
          <RefreshCw className="h-3 w-3" />
          <span>Refresh</span>
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss for 10 minutes"
          className="rounded-md p-1 opacity-70 hover:bg-white/10 hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
