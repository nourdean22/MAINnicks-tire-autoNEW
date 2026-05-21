"use client";

/**
 * ClientErrorTelemetry — captures unhandled errors + promise
 * rejections + React error-boundary trips, POSTs them to /api/errors.
 *
 * Mounted once at the root layout. Completely passive — zero UI
 * footprint, no user-visible behavior. Its only job is to surface
 * client-side crashes to Nour's server logs so a render loop or
 * unhandled promise on a panel doesn't vanish into the void.
 *
 * Today's "Maximum update depth exceeded" loop was reported by Nour
 * via screenshot because we had no capture path. After this mounts,
 * the same loop would land in StateLog within ~30s.
 *
 * Design:
 *   · Debounce identical errors (same fingerprint) to 1 post per 30s
 *     — prevents a tight loop from spamming the log
 *   · Rate-cap at 10 posts per minute — backpressure if the site is
 *     broken in a way that produces many distinct errors
 *   · Fire-and-forget POST — never blocks user work
 *   · No PII — body + stack + URL + userAgent, nothing else
 */

import { useEffect } from "react";

import { authedFetch } from "@/hooks/use-authed-fetch";
interface TelemetryPayload {
  kind: "error" | "unhandledrejection" | "boundary";
  message: string;
  stack?: string;
  url: string;
  userAgent: string;
  timestamp: number;
  // React error-boundary-specific
  componentStack?: string;
  errorBoundary?: string;
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const DEDUPE_WINDOW_MS = 30_000;

const recentFingerprints = new Map<string, number>();
const recentPosts: number[] = [];

function fingerprint(p: TelemetryPayload): string {
  // First 200 chars of message + first line of stack is enough to
  // distinguish error identity without leaking too much.
  const stackHead = (p.stack ?? "").split("\n")[1]?.trim() ?? "";
  return `${p.kind}::${p.message.slice(0, 200)}::${stackHead}`;
}

function shouldReport(p: TelemetryPayload): boolean {
  const now = Date.now();
  // Prune rate-limit window
  while (recentPosts.length > 0 && now - recentPosts[0] > RATE_LIMIT_WINDOW_MS) {
    recentPosts.shift();
  }
  if (recentPosts.length >= RATE_LIMIT_MAX) return false;

  // Dedupe by fingerprint in 30s window
  const fp = fingerprint(p);
  const lastSeen = recentFingerprints.get(fp);
  if (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS) return false;
  recentFingerprints.set(fp, now);

  // Opportunistic prune of dedupe map
  if (recentFingerprints.size > 200) {
    for (const [k, v] of recentFingerprints) {
      if (now - v > DEDUPE_WINDOW_MS * 5) recentFingerprints.delete(k);
    }
  }

  recentPosts.push(now);
  return true;
}

async function post(payload: TelemetryPayload): Promise<void> {
  if (!shouldReport(payload)) return;
  try {
    // credentials: include so the owner-auth gate on /api/errors is
    // satisfied by the session cookie.
    await authedFetch("/api/errors", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // keepalive allows the POST to survive page unload — catches
      // errors that fire right before nav.
      keepalive: true,
    });
  } catch {
    // swallow — telemetry that itself fails should never be visible.
  }
}

export function ClientErrorTelemetry() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onError = (event: ErrorEvent) => {
      void post({
        kind: "error",
        message: event.message || "Unknown error",
        stack: event.error?.stack,
        url: window.location.href,
        userAgent: navigator.userAgent,
        timestamp: Date.now(),
      });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : JSON.stringify(reason)?.slice(0, 500) ?? "unhandled rejection";
      void post({
        kind: "unhandledrejection",
        message,
        stack: reason instanceof Error ? reason.stack : undefined,
        url: window.location.href,
        userAgent: navigator.userAgent,
        timestamp: Date.now(),
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}

/**
 * Imperative reporter for React error-boundary integrations or
 * manual catch blocks. Same pipeline, same dedupe, explicit shape.
 *
 * Pass `context.source` (e.g. "tasks.addTask") from a manual catch
 * block — it prefixes the logged message `[source] …`, mirroring the
 * server-side logError() convention, so /system/logs shows WHICH
 * handler swallowed the error rather than just the bare error text.
 */
export function reportClientError(
  err: unknown,
  context?: { boundary?: string; componentStack?: string; source?: string },
): void {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const message = context?.source ? `[${context.source}] ${rawMessage}` : rawMessage;
  const stack = err instanceof Error ? err.stack : undefined;
  if (typeof window === "undefined") return;
  void post({
    kind: "boundary",
    message,
    stack,
    componentStack: context?.componentStack,
    errorBoundary: context?.boundary,
    url: window.location.href,
    userAgent: navigator.userAgent,
    timestamp: Date.now(),
  });
}
