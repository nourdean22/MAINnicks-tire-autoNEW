"use client";

/**
 * useWorkAnchor · /tasks v2.2 Phase 2 · 2026-05-26
 *
 * Soft work anchor · replaces the plan's forced-pomodoro design.
 * Tracks which task the operator is currently "on" without forcing a
 * timer or hard interruption. Lives entirely in localStorage so it
 * survives page reloads and tab switches without any backend writes.
 *
 * Semantics (per the redesign plan):
 *   - Operator clicks [Do ▶] on a task → startWork(taskId)
 *   - Operator clicks [Done ✓] or [Skip] → releaseAnchor()
 *   - 30 min idle without check-in → auto-release (handled by consumer
 *     via useIdleDetector + this hook's reaffirm() / release() methods)
 *
 * The hook is intentionally minimal · no idle detection here. Composes
 * with useIdleDetector for the watcher · stays SRP-clean.
 *
 * Returned shape ·
 *   { anchor: { taskId, startedAt, reaffirmedAt? } | null,
 *     elapsedMs: number (0 when no anchor),
 *     startWork(taskId),
 *     reaffirm(),         // bump reaffirmedAt to "still on this"
 *     release() }
 *
 * Race-safety · cross-tab storage events sync the anchor across open
 * tabs. Operator clicking [Do ▶] on /tasks in one tab is reflected in
 * the same hook on another tab within milliseconds.
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "nour:workAnchor:v1";

export interface WorkAnchor {
  taskId: string;
  startedAt: string; // ISO timestamp
  reaffirmedAt?: string; // ISO · bumped on reaffirm() · drives idle math
}

function readStored(): WorkAnchor | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkAnchor;
    if (typeof parsed?.taskId !== "string" || typeof parsed?.startedAt !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(anchor: WorkAnchor | null): void {
  if (typeof window === "undefined") return;
  try {
    if (anchor === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(anchor));
    }
    // Fire a same-window storage event so other hooks in this same
    // tab pick up the change immediately (native storage events only
    // fire in OTHER tabs by default).
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
  } catch {
    // localStorage may be unavailable (private browsing) · fail silent
  }
}

export function useWorkAnchor() {
  const [anchor, setAnchor] = useState<WorkAnchor | null>(() => readStored());
  const [now, setNow] = useState(() => Date.now());

  // Cross-tab + same-tab sync · listen to storage events.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY || e.key === null) {
        setAnchor(readStored());
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Tick "now" every 30s so elapsedMs derived value stays roughly fresh
  // for UI. 30s is cheap and matches the lowest-resolution display
  // unit we'd render ("focused 10 min" milestone chips).
  useEffect(() => {
    if (!anchor) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [anchor]);

  const startWork = useCallback((taskId: string) => {
    const next: WorkAnchor = { taskId, startedAt: new Date().toISOString() };
    writeStored(next);
    setAnchor(next);
    setNow(Date.now());
  }, []);

  const reaffirm = useCallback(() => {
    const current = readStored();
    if (!current) return;
    const next: WorkAnchor = { ...current, reaffirmedAt: new Date().toISOString() };
    writeStored(next);
    setAnchor(next);
  }, []);

  const release = useCallback(() => {
    writeStored(null);
    setAnchor(null);
  }, []);

  const elapsedMs = anchor ? now - Date.parse(anchor.startedAt) : 0;
  const sinceLastReaffirmMs = anchor
    ? now - Date.parse(anchor.reaffirmedAt ?? anchor.startedAt)
    : 0;

  return { anchor, elapsedMs, sinceLastReaffirmMs, startWork, reaffirm, release };
}
