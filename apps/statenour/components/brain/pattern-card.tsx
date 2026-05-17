"use client";

/**
 * PatternCard · Wave 23 (v10.0.529.79) · #2
 *
 * "The system noticed" surface. Lists clusters of recent task insights
 * grouped by 8-axis identity dimension. When 3+ insights share an
 * axis, the cluster surfaces as an actionable read.
 *
 * Example display:
 *   ⓘ velocity · 5 insights
 *     "researched LLM tool calling"
 *     "researched zustand state mgmt"
 *     "researched react server components"
 *     suggested next read: ship something
 *
 * Mounted on /brain (and reusable on /trends). Silent when no
 * clusters cross MIN_MEMBERS · the panel hides itself.
 */

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { onDataChanged } from "@/lib/events/data-change";
import { TipChip } from "@/components/ui/tip-chip";
import { Sparkles, RefreshCw } from "lucide-react";

interface Pattern {
  axis: string;
  memberCount: number;
  memberKeys: string[];
  sampleContent: string[];
  dominantWisdomQuery: string | null;
  freshness: string;
}

const PATTERN_TIP =
  "the system clusters your recent task insights by 8-axis identity. when 3+ tasks land on the same axis, it's a pattern worth noticing · maybe a thread to pull, maybe a sign to shift.";

export function PatternCard() {
  const [patterns, setPatterns] = useState<Pattern[] | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await authedFetch("/api/brain/patterns", { cache: "no-store" });
      if (!r.ok) {
        setError(true);
        return;
      }
      const body = await r.json();
      const payload = (body?.data ?? body) as { patterns: Pattern[] };
      setPatterns(payload.patterns ?? []);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  const regenerate = useCallback(async () => {
    setRefreshing(true);
    try {
      await authedFetch("/api/brain/patterns", { method: "POST" });
      await load();
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
    // v10.0.529.84 · Wave 28 · B6 · subscribe to tasks data-change
    // so the pattern surface refreshes when a check-off lands a new
    // task_insight. Pre-Wave-28 the panel only refreshed on manual
    // regen · stale by default.
    const off = onDataChanged(["tasks"], () => {
      setTimeout(() => void load(), 500);
    });
    return () => off();
  }, [load]);

  if (error || !patterns) return null;
  if (patterns.length === 0) return null;

  return (
    <section
      aria-label="task patterns"
      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.03] p-4 space-y-3"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[var(--gold)]" strokeWidth={1.75} />
          <h3 className="text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--text-primary)]">
            the system noticed
          </h3>
          <TipChip tip={PATTERN_TIP} title="patterns" size="xs" />
        </div>
        <button
          type="button"
          onClick={regenerate}
          disabled={refreshing}
          aria-label="regenerate patterns"
          className="text-[10px] font-mono text-[var(--text-tertiary)] hover:text-[var(--gold)] focus-visible:ring-1 focus-visible:ring-[var(--gold)] focus-visible:outline-none rounded px-1 transition-colors flex items-center gap-1"
        >
          <RefreshCw size={10} className={refreshing ? "animate-spin" : ""} />
          regen
        </button>
      </header>
      <ul className="space-y-3" aria-label="pattern clusters">
        {patterns.map((p) => (
          <li
            key={p.axis}
            className="rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.04] p-3 space-y-1.5"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--gold)]">
                {p.axis.replace(/_/g, " ")}
              </span>
              <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
                · {p.memberCount} insights
              </span>
            </div>
            <ul className="space-y-0.5 pl-2 border-l border-[var(--border-default)]">
              {p.sampleContent.map((c, i) => (
                <li
                  key={i}
                  className="text-[11px] text-[var(--text-secondary)] leading-snug truncate"
                >
                  · {c}
                </li>
              ))}
            </ul>
            {p.dominantWisdomQuery && (
              <p className="text-[10px] italic text-[var(--text-tertiary)] mt-1">
                thread to pull → {p.dominantWisdomQuery}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
