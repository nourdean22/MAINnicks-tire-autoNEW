"use client";

/**
 * useAuthedFetch — shared helper for client panels that hit owner-only
 * endpoints. Handles two real-world pain points:
 *
 *   1. Auth-cookie timing race — on a fresh page load, the first fetch
 *      sometimes fires a millisecond before the session cookie lands in
 *      the request headers. The server returns 401, the panel renders
 *      "failed." A transient retry after 300ms usually succeeds because
 *      the cookie is set by then.
 *
 *   2. Generic "fetch failed" noise — panels used to throw a generic
 *      string on any non-OK response, hiding the real status. This
 *      helper surfaces `status + statusText + body-preview` so Nour
 *      sees "401 Unauthorized · auth cookie not yet set" instead of a
 *      useless "fetch failed."
 *
 * Usage:
 *   const { data, error, loading, reload } = useAuthedFetch<MyShape>(
 *     "/api/skills",
 *     { retryOn401: true }
 *   );
 *
 * Writes (POST/PATCH/DELETE) use `authedFetch()` directly — same error
 * handling, no state-management wrapper.
 */
import { useCallback, useEffect, useState } from "react";

interface AuthedFetchOpts {
  /** If the first response is 401, retry once after 300ms. Default true. */
  retryOn401?: boolean;
  /** Additional retry attempts beyond the 401 bounce. Default 0. */
  extraRetries?: number;
  /** Skip the fetch entirely (e.g. waiting on a parent value). */
  skip?: boolean;
  /**
   * When true, redirect to /auth/sign-in after all retries fail with
   * 401. Default: true. Set false only if the caller has its own
   * fallback UI that handles persistent 401 (rare).
   *
   * Why this exists: the "red error card with retry button" pattern is
   * a dead-end for session-expired cases. Nour has to notice the card,
   * click retry, watch it fail again, figure out he needs to sign in.
   * A hard redirect collapses that into one step.
   */
  redirectOnAuthFail?: boolean;
}

interface AuthedFetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Bump this to force a reload. */
  reload: () => void;
  /** Reset error state without reloading. */
  dismiss: () => void;
}

/**
 * Should a persistent 401 trigger a redirect to /auth/sign-in?
 *
 * NO when:
 *   · Already on /auth/sign-in       — would cause a redirect loop
 *   · On a *.vercel.app preview URL  — preview deploys are gated by
 *     Vercel's own SSO, not NextAuth. A 401 there means the cookie
 *     domain doesn't match (prod cookie on preview host). Redirecting
 *     to preview's /auth/sign-in produces the same 401, loop forever.
 *   · Not in a browser (SSR context) — no window to redirect
 *
 * Preview breakage was surfaced 2026-04-22 when Nour hit a preview
 * URL after the auto-redirect shipped and got stuck on an infinite
 * sign-in bounce. This guard lets preview deploys fall back to the
 * old "red error card" behavior, which is the correct UX for preview
 * since there's nothing useful /auth/sign-in can do.
 */
/**
 * EXPORTED so tests (tests/hooks/use-authed-fetch.test.ts) can lock
 * down the preview/auth-page suppression without needing to mount a
 * real browser. Any change in the branches here directly affects
 * whether Nour gets bounced to /auth/sign-in on expired sessions.
 */
export function shouldRedirectOnAuthFail(): boolean {
  if (typeof window === "undefined") return false;
  const { hostname, pathname } = window.location;
  if (pathname.startsWith("/auth/")) return false;
  if (hostname.endsWith(".vercel.app")) return false;
  return true;
}

/**
 * Primitive — wraps fetch() with 401-bounce retry + rich error message.
 * Use directly from write handlers (button onClick, etc).
 *
 * When BOTH attempts return 401 AND we're running in a browser AND
 * redirect is safe (not already on sign-in, not a preview deploy),
 * redirects to /auth/sign-in so Nour re-authenticates instead of
 * getting a silent failure. Pass `{ redirectOnAuthFail: false }` in
 * the options bag to opt out (rare — only if the caller has its own
 * auth recovery flow).
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init?: RequestInit & { redirectOnAuthFail?: boolean },
): Promise<Response> {
  const { redirectOnAuthFail = true, ...fetchInit } = init ?? {};
  const res = await fetch(input, { credentials: "include", ...fetchInit });
  if (res.status === 401) {
    // 300ms cookie-arrival grace — retry once
    await new Promise((r) => setTimeout(r, 300));
    const retry = await fetch(input, { credentials: "include", ...fetchInit });
    if (retry.status === 401 && redirectOnAuthFail && shouldRedirectOnAuthFail()) {
      const signInUrl = new URL("/auth/sign-in", window.location.origin);
      signInUrl.searchParams.set(
        "callbackUrl",
        window.location.pathname + window.location.search,
      );
      window.location.href = signInUrl.toString();
      // Return the 401 response so callers that don't expect the redirect
      // can still inspect the status. The navigation fires before the
      // returned response is consumed in most real flows.
    }
    return retry;
  }
  return res;
}

/**
 * Build a human-readable error string from a non-OK Response.
 * Always awaits the body even if the server sent no content.
 */
export async function describeFetchError(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  const preview = body.slice(0, 160).replace(/\s+/g, " ").trim();
  return `${res.status} ${res.statusText}${preview ? ` · ${preview}` : ""}`;
}

/**
 * Hook version — GET with state management. Most common panel pattern:
 *   mount → fetch → show data OR show specific error + retry button.
 */
export function useAuthedFetch<T = unknown>(
  url: string | null,
  opts: AuthedFetchOpts = {},
): AuthedFetchState<T> {
  const {
    retryOn401 = true,
    extraRetries = 0,
    skip = false,
    redirectOnAuthFail = true,
  } = opts;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url && !skip);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!url || skip) {
      setLoading(false);
      return;
    }
    // Cancellation via closure-local `self`. When deps change React
    // fires the cleanup first (setting self.alive=false) before the
    // new effect runs, so any in-flight fetch from the old effect
    // checks self.alive and skips setState after completing.
    const self = { alive: true };
    setLoading(true);
    setError(null);

    (async () => {
      let attempt = 0;
      const maxAttempts = 1 + (retryOn401 ? 1 : 0) + extraRetries;
      let lastErrorMsg: string | null = null;
      while (attempt < maxAttempts) {
        attempt++;
        try {
          const res = await fetch(url, { credentials: "include" });
          if (res.status === 401 && attempt < maxAttempts && retryOn401) {
            await new Promise((r) => setTimeout(r, 300 * attempt));
            continue;
          }
          if (!res.ok) {
            lastErrorMsg = await describeFetchError(res);
            if (attempt < maxAttempts) {
              await new Promise((r) => setTimeout(r, 300 * attempt));
              continue;
            }
            // Persistent 401 → session has expired. Redirect to sign-in
            // rather than leave Nour staring at a red error card.
            // Skip when shouldRedirectOnAuthFail() returns false
            // (already on sign-in, preview deploy, SSR).
            if (
              res.status === 401 &&
              redirectOnAuthFail &&
              shouldRedirectOnAuthFail()
            ) {
              const signInUrl = new URL("/auth/sign-in", window.location.origin);
              signInUrl.searchParams.set("callbackUrl", window.location.pathname + window.location.search);
              // Clear loading BEFORE the navigation so if the page
              // doesn't actually unmount (beforeunload blocker, iOS BF
              // cache), the UI doesn't stay stuck in a "loading..." shell.
              if (self.alive) setLoading(false);
              window.location.href = signInUrl.toString();
              return;
            }
            if (self.alive) {
              setError(lastErrorMsg);
              setLoading(false);
            }
            return;
          }
          const raw = (await res.json()) as { data?: T } | T;
          // Most apiHandler routes wrap payload in { data: ... }; unwrap if present.
          const payload = ((raw as { data?: T }).data ?? raw) as T;
          if (self.alive) {
            setData(payload);
            setError(null);
            setLoading(false);
          }
          return;
        } catch (err) {
          lastErrorMsg = err instanceof Error ? err.message : String(err);
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 300 * attempt));
            continue;
          }
          if (self.alive) {
            setError(lastErrorMsg);
            setLoading(false);
          }
          return;
        }
      }
    })();

    return () => {
      self.alive = false;
    };
  }, [url, tick, skip, retryOn401, extraRetries]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const dismiss = useCallback(() => setError(null), []);

  return { data, error, loading, reload, dismiss };
}
