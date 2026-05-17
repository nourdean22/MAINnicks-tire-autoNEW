"use client";

/**
 * useClientId — stable per-tab identifier stored in sessionStorage.
 * Sent as X-Prefetch-Client-Id on prefetch + idle-warmup requests so
 * the server rate-limit can distinguish between Nour's desktop and
 * phone (same IP, same UA) without cancelling either.
 *
 * Generated lazily on first use. Falls back to "anon" on SSR.
 */

const KEY = "nour:prefetch:client-id";

export function readClientId(): string {
  if (typeof window === "undefined") return "anon";
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID().slice(0, 16)
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}
