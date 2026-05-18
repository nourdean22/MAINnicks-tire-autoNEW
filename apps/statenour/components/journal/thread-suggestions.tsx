"use client";

/**
 * ThreadSuggestions · ADR-0013 · Phase D follow-up (2026-05-18)
 *
 * Surfaces entries the capture-hook scored in the 0.65-0.80 band
 * (between auto-join and ignore). Operator confirms ("join thread X")
 * or dismisses. Silent when nothing's pending.
 *
 * Lives between ThreadRail (active threads) and ThreadRadar
 * (convergence candidates) so the radar workflow goes:
 *   1. Coalescing themes → ThreadRadar (top)
 *   2. Pinned threads → ThreadRail
 *   3. Borderline joins → ThreadSuggestions
 * All three are quiet by default. Page looks unchanged unless
 * something fires.
 */

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/hooks/use-authed-fetch";

interface Suggestion {
  key: string;
  threadId: string;
  threadName: string;
  entrySource: "brain_dump" | "reflection" | "situation_log" | "decision_replay";
  entryId: string;
  excerpt: string;
  similarity: number;
  createdAt: string;
}

export function ThreadSuggestions({
  refreshSignal,
  onActioned,
}: {
  refreshSignal?: number;
  onActioned?: () => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/api/journal/suggestions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data: Suggestion[] };
      setSuggestions(json.data ?? []);
    } catch {
      // silent · suggestions are advisory · errors don't disrupt page
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  const accept = async (key: string) => {
    if (busyKey) return;
    setBusyKey(key);
    try {
      const res = await authedFetch("/api/journal/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
      onActioned?.();
    } catch {
      // surface via DOM or future toast · today: silent re-fetch
      await load();
    } finally {
      setBusyKey(null);
    }
  };

  const dismiss = async (key: string) => {
    if (busyKey) return;
    setBusyKey(key);
    try {
      const res = await authedFetch(
        `/api/journal/suggestions?key=${encodeURIComponent(key)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch {
      await load();
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) return null;
  if (suggestions.length === 0) return null;

  return (
    <section className="mb-8 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs uppercase tracking-[0.22em] text-white/40">
          Possible joins · {suggestions.length}
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-white/30">
          borderline matches
        </span>
      </div>
      <ul className="space-y-2">
        {suggestions.map((s) => (
          <li
            key={s.key}
            className="rounded-lg border border-white/10 bg-white/[0.02] p-3 transition hover:bg-white/[0.04]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1">
                  thread · {s.threadName} · similarity{" "}
                  {(s.similarity * 100).toFixed(0)}%
                </p>
                <p className="text-sm text-white/80 line-clamp-2">
                  {s.excerpt}
                </p>
              </div>
              <div className="shrink-0 flex flex-col gap-1.5 sm:flex-row">
                <button
                  type="button"
                  onClick={() => accept(s.key)}
                  disabled={busyKey === s.key}
                  className="text-[10px] uppercase tracking-wider px-3 min-h-[44px] rounded border border-[#FDB913]/40 text-amber-200 hover:bg-[#FDB913]/10 disabled:opacity-30"
                >
                  join
                </button>
                <button
                  type="button"
                  onClick={() => dismiss(s.key)}
                  disabled={busyKey === s.key}
                  className="text-[10px] uppercase tracking-wider px-3 min-h-[44px] rounded border border-white/15 text-white/50 hover:bg-white/5 disabled:opacity-30"
                >
                  skip
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
