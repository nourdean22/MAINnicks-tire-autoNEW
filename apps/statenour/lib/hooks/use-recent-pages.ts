"use client";

/**
 * useRecentPages · v10.0.348 · tracks the last 3 distinct mastery
 * surface visits in localStorage. Powers the FloatingHome orb's
 * "recent jumps" pills · single-tap revisit without scrolling.
 *
 * Design choices:
 *   · Tracks distinct paths only (e.g. /chat/X and /chat/Y both count
 *     as /chat for grouping purposes — the operator wants to "jump
 *     back to chat", not to a specific conversation)
 *   · Excludes the CURRENT page (no point suggesting where you are)
 *   · Bounded to 3 entries · keeps the UI compact
 *   · Persists across reloads via localStorage
 *   · Auto-derives a human label from the pathname segment
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const STORAGE_KEY = "nour-floating-home:recents-v1";
const MAX_ENTRIES = 3;

export interface RecentPage {
  /** Top-level path · e.g. "/chat", "/missions", "/system/health" */
  href: string;
  /** Human label · derived from path segments */
  label: string;
  /** Last visit timestamp · ms since epoch */
  visitedAt: number;
}

function deriveLabel(href: string): string {
  if (href === "/" || href === "") return "Ultron";
  // Take the deepest meaningful segment + Title Case it
  const segments = href.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "Home";
  return last
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Top-level group key · /chat/abc, /chat/xyz both group to /chat.
 * Skip-tracked routes (system internals) collapse to their root.
 */
function groupKey(pathname: string): string | null {
  if (!pathname || pathname === "/") return "/";
  // Don't track these (they'd dominate the recents list)
  const skip = [
    "/_next",
    "/api",
    "/auth",
    "/login",
    "/signin",
  ];
  if (skip.some((s) => pathname.startsWith(s))) return null;
  // Take the first 2 segments max so /system/health-grid stays distinct
  // from /system/coverage but /chat/abc and /chat/xyz collapse to /chat
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  // For /chat/<id> · /tasks/<id> · /missions/<id> · etc · collapse to root
  const dynamicRoots = ["chat", "tasks", "missions", "decisions", "devices"];
  if (segments.length >= 2 && dynamicRoots.includes(segments[0])) {
    return `/${segments[0]}`;
  }
  // For /system/X · /brain/X · keep both segments
  if (segments.length >= 2 && ["system", "brain"].includes(segments[0])) {
    return `/${segments[0]}/${segments[1]}`;
  }
  // Otherwise just first segment
  return `/${segments[0]}`;
}

function loadRecents(): RecentPage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is RecentPage =>
          p &&
          typeof p.href === "string" &&
          typeof p.label === "string" &&
          typeof p.visitedAt === "number",
      )
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function saveRecents(list: RecentPage[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage unavailable / quota · silently degrade
  }
}

export function useRecentPages(): {
  recents: RecentPage[];
  /** Excludes the current path · ready-to-render "jump back" candidates. */
  candidates: RecentPage[];
} {
  const pathname = usePathname() ?? "/";
  const [recents, setRecents] = useState<RecentPage[]>(() => loadRecents());

  useEffect(() => {
    const key = groupKey(pathname);
    if (!key) return; // skip-tracked path

    queueMicrotask(() => {
      setRecents((prev) => {
        // Move-to-front · dedupe by href
        const filtered = prev.filter((p) => p.href !== key);
        const next: RecentPage[] = [
          { href: key, label: deriveLabel(key), visitedAt: Date.now() },
          ...filtered,
        ].slice(0, MAX_ENTRIES);
        saveRecents(next);
        return next;
      });
    });
  }, [pathname]);

  // Candidates · everything except the current page (so we don't
  // suggest "jump back to where you are")
  const currentKey = groupKey(pathname);
  const candidates = recents.filter((p) => p.href !== currentKey);

  return { recents, candidates };
}
