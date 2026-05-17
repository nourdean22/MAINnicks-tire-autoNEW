"use client";

/**
 * MasteryRadar · Wave 24 (v10.0.529.80) · #2
 *
 * Recharts RadarChart over the operator's mastery domains.
 * Two layers:
 *   · "now"     · current score per domain (filled gold)
 *   · "7d ago"  · score from 7 days back (outline · gold-dim)
 *
 * The overlay shows growth — the area between "7d ago" and "now"
 * IS the operator's compound interest visualized.
 *
 * Auto-hides when fewer than 3 domains exist (radar needs ≥3 points
 * for a meaningful shape).
 */

import { useCallback, useEffect, useState } from "react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { onDataChanged } from "@/lib/events/data-change";
import { TipChip } from "@/components/ui/tip-chip";
import { Target } from "lucide-react";

interface RadarAxis {
  domain: string;
  current: number;
  weekAgo: number;
  delta: number;
}

const TIP =
  "your 8-axis growth radar. inner ring = 7 days ago · outer fill = now. the gap between them IS your compound interest. each task you check off with a mission domain lifts its axis · idle axes decay -0.05/day.";

export function MasteryRadar() {
  const [axes, setAxes] = useState<RadarAxis[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await authedFetch("/api/mastery/radar", { cache: "no-store" });
      if (!r.ok) {
        setError(true);
        return;
      }
      const body = await r.json();
      const payload = (body?.data ?? body) as { axes: RadarAxis[] };
      setAxes(payload.axes ?? []);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const off = onDataChanged(["tasks", "goals"], () => {
      setTimeout(() => void load(), 500);
    });
    return () => off();
  }, [load]);

  if (error || !axes) return null;
  if (axes.length < 3) return null;

  // Recharts wants `data` to be one row per axis with named keys.
  const data = axes.map((a) => ({
    domain: a.domain,
    now: a.current,
    weekAgo: a.weekAgo,
  }));

  const topGainer = [...axes].sort((a, b) => b.delta - a.delta)[0];
  const topLoser = [...axes].sort((a, b) => a.delta - b.delta)[0];

  return (
    <section
      aria-label="mastery radar"
      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.03] p-4 space-y-3"
    >
      <header className="flex items-center gap-2 flex-wrap">
        <Target size={13} className="text-[var(--gold)]" strokeWidth={1.75} />
        <h3 className="text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--text-primary)]">
          growth radar · 7d
        </h3>
        <TipChip tip={TIP} title="growth radar" size="xs" />
        {/* v10.0.529.84 · Wave 28 · C4 · legend chips · audit found
            that the two-ring radar (now vs 7d ago) had no visual key.
            New operators couldn't tell which shape was which · these
            small dot-+-label pairs close that gap with 10 LOC. */}
        <span className="inline-flex items-center gap-1 text-[9px] font-mono lowercase text-[var(--text-tertiary)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />
          now
        </span>
        <span className="inline-flex items-center gap-1 text-[9px] font-mono lowercase text-[var(--text-tertiary)]">
          <span className="h-1.5 w-1.5 rounded-full border border-dashed border-[var(--gold-dim,#D49A0E)]" />
          7d ago
        </span>
        <span className="ml-auto text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
          {axes.length} axes
        </span>
      </header>
      <div className="w-full h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} margin={{ top: 12, right: 30, bottom: 12, left: 30 }}>
            <PolarGrid
              stroke="var(--border-default)"
              strokeDasharray="3 3"
            />
            <PolarAngleAxis
              dataKey="domain"
              tick={{
                fill: "var(--text-secondary)",
                fontSize: 10,
                fontFamily: "var(--font-mono)",
              }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{ fill: "var(--text-tertiary)", fontSize: 9 }}
              tickCount={6}
            />
            {/* 7d-ago layer · outline only · gold-dim */}
            <Radar
              name="7d ago"
              dataKey="weekAgo"
              stroke="var(--gold-dim, #D49A0E)"
              fill="transparent"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            {/* Now layer · filled · gold */}
            <Radar
              name="now"
              dataKey="now"
              stroke="var(--gold)"
              fill="var(--gold)"
              fillOpacity={0.18}
              strokeWidth={1.5}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-3 flex-wrap text-[10px] font-mono tabular-nums">
        {topGainer && topGainer.delta > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-400">
            ↑ {topGainer.domain} +{topGainer.delta.toFixed(1)}
          </span>
        )}
        {topLoser && topLoser.delta < 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-rose-400">
            ↓ {topLoser.domain} {topLoser.delta.toFixed(1)}
          </span>
        )}
        <span className="text-[var(--text-tertiary)]">
          inner ring = 7d ago · outer fill = now
        </span>
      </div>
    </section>
  );
}
