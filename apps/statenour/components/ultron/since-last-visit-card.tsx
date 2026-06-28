"use client";

/**
 * SinceLastVisitCard · v8.9 BATCH 52 · Apr 29.
 *
 * "What changed since I last looked at HQ?" widget.
 *
 * Pulls the entity-audit firehose from the global activity stream
 * and compares to a localStorage timestamp. Shows a tinted block
 * with the count of mutations + a 1-line summary if anything's
 * new since the last visit.
 *
 * Silent when no changes (zero noise on a fresh refresh). Auto-
 * updates the timestamp 5 seconds after first paint so the widget
 * doesn't keep flagging the same events forever.
 *
 * Composes:
 *   · v8.0 entity_audits firehose (/api/audit/entity?firehose=1)
 *   · v8.5 GlobalActivityStream's data shape (re-uses)
 *   · localStorage("nour:hq-last-visit") for the cursor
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatedCounter } from "@/components/ui/animated-counter";

import { trpc } from "@/lib/trpc/client";
const STORAGE_KEY = "nour:hq-last-visit";
const SETTLE_MS = 5_000;

interface ActivityEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  reason: string | null;
  createdAt: string;
}

interface Props {
  /** Cap on rows fetched. Defaults to 50 — enough to count "many"
   *  without paying for the full firehose. */
  limit?: number;
}

function readCursor(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeCursor(at: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(at));
  } catch {
    /* ignore */
  }
}

const ACTION_LABEL: Record<string, string> = {
  created: "created",
  updated: "updated",
  soft_deleted: "deleted",
  restored: "restored",
  purged: "purged",
};

export function SinceLastVisitCard({ limit = 50 }: Props) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [cursor, setCursor] = useState<number>(() => readCursor());
  const [error, setError] = useState<string | null>(null);
  // Cross-domain residuals slice (2026-05-22) · migrated off
  // `authedFetch("/api/audit/entity?firehose=1")` onto
  // `trpc.brain.activityStream`. The read is a one-shot on mount (NOT a
  // render-time query · the cursor diff is computed against a localStorage
  // timestamp) so it fires imperatively via `utils.brain.activityStream
  // .fetch()`. The procedure returns the `{ count, entries, mode }` view
  // directly · the legacy `j.entries` envelope read is preserved.
  const utils = trpc.useUtils();

  const load = useCallback(async () => {
    try {
      const view = await utils.brain.activityStream.fetch({ limit });
      setEntries(Array.isArray(view.entries) ? view.entries : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [limit, utils]);

  useEffect(() => {
    setTimeout(() => {
      void load();
    }, 0);
  }, [load]);

  // After SETTLE_MS, advance the cursor to NOW so re-mounts don't
  // keep flagging the same events. Only fires once per mount.
  useEffect(() => {
    if (cursor === 0 || entries === null) return;
    const id = window.setTimeout(() => {
      const newCursor = Date.now();
      writeCursor(newCursor);
      // v10.0.529.41 · we DO setCursor now. Pre-fix the comment said
      // "intentionally NOT setCursor here · we want the current render
      // to keep showing the delta until reload." That intent is
      // already enforced by the SETTLE_MS gate (cursor only advances
      // after the operator has been on the page long enough to have
      // READ the delta). Withholding the state sync just meant
      // SPA-internal navigations (operator goes to /chat and back to
      // /ultron without a hard reload) kept showing the stale delta.
      // Syncing state to localStorage fixes that without losing the
      // settle-time intent.
      setCursor(newCursor);
    }, SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [cursor, entries]);

  // First-time visitor: stamp `now` and render nothing this render.
  useEffect(() => {
    if (cursor === 0) {
      const now = Date.now();
      writeCursor(now);
      setTimeout(() => setCursor(now), 0);
    }
  }, [cursor]);

  const newEntries = useMemo(() => {
    if (!entries || cursor === 0) return [];
    return entries.filter(
      (e) => new Date(e.createdAt).getTime() > cursor,
    );
  }, [entries, cursor]);

  if (error) return null; // Silent on transient fetch errors
  if (!entries) return null; // Loading — silent
  if (cursor === 0) return null; // First visit — nothing to compare against
  if (newEntries.length === 0) return null; // Nothing new — silent

  const byAction: Record<string, number> = {};
  for (const e of newEntries) {
    byAction[e.action] = (byAction[e.action] ?? 0) + 1;
  }
  const summary = Object.entries(byAction)
    .map(([k, v]) => `${v} ${ACTION_LABEL[k] ?? k}`)
    .join(" · ");

  const top = newEntries.slice(0, 3);

  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/60 animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-300">
            since last visit · <AnimatedCounter value={newEntries.length} /> change{newEntries.length === 1 ? "" : "s"}
          </span>
        </div>
        <a
          href="/brain?tab=continuity"
          className="text-[10px] font-mono text-emerald-300/70 hover:text-emerald-200"
        >
          full feed →
        </a>
      </div>
      <p className="text-[11px] text-emerald-200/85 mb-1.5">{summary}</p>
      <ul className="space-y-1">
        {top.map((e) => (
          <li
            key={e.id}
            className="flex items-center gap-2 text-[11px] text-emerald-100/75"
          >
            <span className="text-emerald-400/80 shrink-0">
              {ACTION_LABEL[e.action] ?? e.action}
            </span>
            <span className="truncate">
              <a
                href={`/system/history?type=${encodeURIComponent(e.entityType)}&id=${encodeURIComponent(e.entityId)}`}
                className="hover:underline underline-offset-2"
              >
                {e.entityType}/{e.entityId.slice(0, 10)}
              </a>
              {e.reason && (
                <span className="ml-1 text-emerald-200/60">— {e.reason.slice(0, 60)}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
