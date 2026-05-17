"use client";

/**
 * useIdleSuggestion — if the input is focused AND empty AND the user
 * hasn't typed for 3s, pull ONE context-aware suggestion from the
 * chat-openers endpoint. That single suggestion renders as a subtle
 * inline hint above the input.
 *
 * Tesla principle: silence by default. Only surface when there's
 * real hesitation.
 *
 * Reuses /api/ai/chat-openers — same endpoint that powers the empty
 * state, but only consumes the FIRST opener (highest-urgency) so
 * it's not a full list to pick from, just one strong pull.
 *
 * v7.3 · Apr 29 · Persistent dismissal. Was: dismiss only kills the
 * current session — refresh and the same "risk appetite at 41/100"
 * pulls right back in. Now: dismiss writes a 24h TTL key to
 * localStorage AND a per-suggestion-id key so the same headline can't
 * keep nagging across visits.
 *
 * v10.0.141 · May 02 · per-id dismissal is now PERMANENT. Nour
 * dismissed "risk appetite at 34/100 — weakest axis" multiple times
 * and it kept coming back after the 24h TTL cleared. The global TTL
 * stays (so a fresh round of suggestions surfaces eventually), but
 * once a SPECIFIC headline is X'd, that exact id is dead forever.
 * Reset via DevTools: localStorage.removeItem keys starting with
 * `nour-idle-suggestion-dismissed-id:`.
 */

import { useEffect, useRef, useState } from "react";

import { authedFetch } from "@/hooks/use-authed-fetch";
interface Opener {
  id: string;
  headline: string;
  ask: string;
  severity: "alert" | "info" | "win";
  source: string;
}

interface Args {
  inputEmpty: boolean;
  inputFocused: boolean;
  /** Hide permanently after first dismissal until fresh session */
  dismissedOnce: boolean;
  /** ms of idle focus before firing. Default 3000. */
  idleThresholdMs?: number;
}

const DISMISS_GLOBAL_KEY = "nour-idle-suggestion-dismissed-until";
const DISMISS_PER_ID_PREFIX = "nour-idle-suggestion-dismissed-id:";
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function isGloballyDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(DISMISS_GLOBAL_KEY);
    if (!raw) return false;
    const until = Number(raw);
    if (Number.isFinite(until) && Date.now() < until) return true;
    localStorage.removeItem(DISMISS_GLOBAL_KEY);
    return false;
  } catch {
    return false;
  }
}

function isIdDismissed(id: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    // v10.0.141 · permanent per-id dismissal. ANY non-empty marker
    // for this id means "never show again" — the legacy "until-ts"
    // value also counts because Number-coercing it gives NaN-safe
    // behavior (NaN < anything is false but the row exists, so the
    // mere presence is enough). Skip the timestamp expiry check.
    const raw = localStorage.getItem(`${DISMISS_PER_ID_PREFIX}${id}`);
    return !!raw;
  } catch {
    return false;
  }
}

function persistDismissal(id?: string) {
  if (typeof window === "undefined") return;
  const expiry = String(Date.now() + DISMISS_TTL_MS);
  try {
    // Global key still uses TTL — fresh suggestion rounds eventually
    // surface after a quiet day. The per-id key is now PERMANENT
    // (any non-empty value means "killed forever"); see isIdDismissed.
    localStorage.setItem(DISMISS_GLOBAL_KEY, expiry);
    if (id) localStorage.setItem(`${DISMISS_PER_ID_PREFIX}${id}`, "permanent");
  } catch {
    // quota-exceeded — fall through silently
  }
}

export function useIdleSuggestion(args: Args) {
  const { inputEmpty, inputFocused, dismissedOnce, idleThresholdMs = 3000 } = args;
  const [suggestion, setSuggestion] = useState<Opener | null>(null);
  const [fetched, setFetched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Reset when input has content, loses focus, or globally dismissed
    if (!inputEmpty || !inputFocused || dismissedOnce || isGloballyDismissed()) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // v10.0.116 audit fix · isMounted guard prevents setSuggestion /
    // setFetched from firing on a dead instance if the user navigates
    // away during the 3s idle timer + fetch window.
    let isMounted = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (fetched || !isMounted) return;
      try {
        const res = await authedFetch("/api/ai/chat-openers");
        if (!isMounted || !res.ok) return;
        const raw = (await res.json()) as { data?: { openers?: Opener[] } };
        if (!isMounted) return;
        const top = raw.data?.openers?.[0];
        if (top && !isIdDismissed(top.id)) setSuggestion(top);
      } catch {
        // swallow
      } finally {
        if (isMounted) setFetched(true);
      }
    }, idleThresholdMs);

    return () => {
      isMounted = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [inputEmpty, inputFocused, dismissedOnce, idleThresholdMs, fetched]);

  const dismiss = () => {
    persistDismissal(suggestion?.id);
    setSuggestion(null);
  };

  return { suggestion, dismiss };
}
