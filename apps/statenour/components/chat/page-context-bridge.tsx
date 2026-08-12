"use client";

/**
 * PageContextBridge · v10.0.529.91 · Wave 35
 *
 * Mounts in the (mastery) layout. Watches usePathname + window.location.hash
 * and extracts the entity ID the operator is currently viewing. Writes it
 * to localStorage `nour:page-context` AND fires a same-tab event
 * `nour:page-context-changed` that the chat page subscribes to.
 *
 * Purpose · close the last frame of pronoun resolution:
 *   · Wave 30 wired chat → contextRoute (just the pathname)
 *   · Wave 34 added lastTaskId/lastGoalId/lastJournalEntryId/etc from
 *     suggestion-chip taps
 *   · BUT · when the operator was just VIEWING /decisions/abc · they
 *     could open chat and say "grade this decision" with no anchor at
 *     all · this hook fixes that.
 *
 * Route → entity-id mapping:
 *   · /decisions/<id>          → { kind: "decision",  id }
 *   · /journal#bd-<id>         → { kind: "journal",   id }
 *   · /pins#pin-<id>           → { kind: "pin",       id }
 *   · /tasks#task-row-<id>     → { kind: "task",      id }
 *   · /brain/wisdom?focus=<k>  → no chat anchor today (skip)
 *
 * Hash changes don't trigger React re-renders by default, so we also
 * subscribe to "hashchange" to catch in-page deep-link navigation
 * (e.g. operator clicks the "view in journal" backlink that goes
 * from /tasks#task-row-X to /journal#bd-Y in the same tab).
 *
 * The bridge is invisible · zero DOM output.
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export interface PageContextPayload {
  // Which entity is the operator currently viewing? Mirrors the
  // GatePass field names so the chat-page consumer can spread it
  // straight into transportBodyRef.
  lastTaskId?: string;
  lastGoalId?: string;
  lastJournalEntryId?: string;
  lastDecisionId?: string;
  lastPinId?: string;
  lastReflectionId?: string;
  lastMissionId?: string;
  /**
   * The source page's route (2026-08-12) — feeds the server's
   * `contextRoute` hint + TOOL_BIAS, which had NO client sender on the
   * text-chat path since Wave 30 wired the server side.
   */
  contextRoute?: string;
  /** Last update timestamp · used to expire stale anchors after 10min. */
  ts: number;
}

const STORAGE_KEY = "nour:page-context";
const EVENT_NAME = "nour:page-context-changed";

/** Extract entity anchors from a (pathname, hash) pair. */
function extractEntity(
  pathname: string,
  hash: string,
): Partial<PageContextPayload> {
  const out: Partial<PageContextPayload> = {};

  // /decisions/<id> · the id is in the path itself
  const decisionMatch = pathname.match(/^\/decisions\/([^/?#]+)/);
  if (decisionMatch) {
    out.lastDecisionId = decisionMatch[1];
  }

  // Hash-based deep-links (only one hash type per page, so we route
  // by pathname first to avoid cross-page collisions).
  if (hash.startsWith("#")) {
    const cleanHash = hash.slice(1);
    if (pathname.startsWith("/journal") && cleanHash.startsWith("bd-")) {
      out.lastJournalEntryId = cleanHash.slice(3);
    } else if (pathname.startsWith("/pins") && cleanHash.startsWith("pin-")) {
      out.lastPinId = cleanHash.slice(4);
    } else if (pathname.startsWith("/missions") && cleanHash.startsWith("task-row-")) {
      out.lastTaskId = cleanHash.slice(9);
    }
  }

  return out;
}

/**
 * PURE and exported for the test: decide what the bridge should store for
 * a (pathname, hash) pair. Returns null to mean "leave storage untouched".
 *
 * 2026-08-12 fix — the bridge used to CLEAR storage on any page without an
 * entity anchor, and /chat has none, so navigating to chat wiped the source
 * page's context in the same frame chat needed to send it. The whole
 * anchor → OPERATOR CONTEXT lane was dead for cross-page navigation.
 * Now: /chat preserves whatever the source page stored (the 10-min TTL in
 * readPageContext bounds staleness), and every other page stores its route
 * (plus anchors where extractable) instead of deleting.
 */
export function computeNextPayload(
  pathname: string,
  hash: string,
): PageContextPayload | null {
  if (pathname.startsWith("/chat")) return null;
  const entity = extractEntity(pathname, hash);
  return { ...entity, contextRoute: pathname, ts: Date.now() };
}

/** Read the current page context · safe on server (returns null). */
export function readPageContext(): PageContextPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PageContextPayload;
    // Stale anchors after 10min · operator probably moved on
    if (Date.now() - (parsed.ts ?? 0) > 10 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Subscribe to same-tab page-context changes. Returns unsubscribe. */
export function onPageContextChanged(
  cb: (payload: PageContextPayload) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<PageContextPayload>).detail;
    if (detail) cb(detail);
  };
  window.addEventListener(EVENT_NAME, handler as EventListener);
  return () => window.removeEventListener(EVENT_NAME, handler as EventListener);
}

export function PageContextBridge() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined" || !pathname) return;

    const apply = () => {
      const payload = computeNextPayload(pathname, window.location.hash || "");
      // null = /chat — preserve the SOURCE page's stored context so the
      // chat request can actually send it (see computeNextPayload).
      if (payload === null) return;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {}
      window.dispatchEvent(
        new CustomEvent<PageContextPayload>(EVENT_NAME, { detail: payload }),
      );
    };

    // Apply on pathname change
    apply();

    // Subscribe to hash changes (clicking a #bd-<id> link inside /journal)
    const onHashChange = () => apply();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [pathname]);

  return null;
}
