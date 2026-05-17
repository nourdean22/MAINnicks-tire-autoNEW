"use client";

/**
 * /system/vapi-calls — voice-call analytics for Nick's Tire.
 *
 * v10.0.269 · shows how many calls Nick's voice assistant has handled,
 * status breakdown, end reasons, average duration, total spend, and
 * the most recent call's quick summary.
 *
 * Window selector · 1d / 7d / 30d / 90d. Auto-refresh 60s.
 * VAPI API key stays server-side via /api/system/vapi-calls.
 */

import { useState, useEffect, useCallback } from "react";
import { Panel } from "@/components/panel";
import { StandardPage } from "@/components/layout/standard-page";
import { cn } from "@/lib/utils/cn";
import { authedFetch } from "@/hooks/use-authed-fetch";

interface MostRecent {
  id: string;
  createdAt?: string;
  status?: string;
  endedReason?: string | null;
  durationSec?: number | null;
}

interface CallStats {
  windowDays: number;
  sinceIso: string;
  totalCalls: number;
  byStatus: Record<string, number>;
  byEndedReason: Record<string, number>;
  avgDurationSec: number;
  mostRecent: MostRecent | null;
  totalCostUsd: number;
  error?: string;
}

const WINDOWS = [
  { label: "1d", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
] as const;

export default function VapiCallsPage() {
  const [data, setData] = useState<CallStats | null>(null);
  const [days, setDays] = useState<number>(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await authedFetch(`/api/system/vapi-calls?days=${days}`);
      if (!r.ok) {
        setError(`HTTP ${r.status}`);
        setData(null);
        return;
      }
      const payload = (await r.json()) as { data: CallStats } | CallStats;
      const stats = "data" in payload ? payload.data : payload;
      setData(stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const i = setInterval(load, 60_000);
    return () => clearInterval(i);
  }, [load]);

  const fmtAgo = (iso?: string) => {
    if (!iso) return "—";
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
    return `${Math.round(ms / 86_400_000)}d ago`;
  };

  return (
    <StandardPage
      eyebrow="System / observability"
      title="Voice calls (VAPI)"
      description="How many calls Nick handled · status breakdown · spend · most recent call."
    >
      <div className="flex gap-1.5">
        {WINDOWS.map((w) => (
          <button
            key={w.label}
            type="button"
            onClick={() => setDays(w.days)}
            className={cn(
              "px-2.5 py-1 rounded border text-[11px] font-mono uppercase tracking-wider transition-colors",
              days === w.days
                ? "text-amber-300 bg-amber-500/15 border-amber-500/40"
                : "text-zinc-400 border-zinc-800/60 hover:bg-zinc-900/60",
            )}
          >
            {w.label}
          </button>
        ))}
      </div>

      {(error || data?.error) && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-[12px] text-red-300">
          {error || data?.error}
        </div>
      )}

      <Panel className="space-y-1.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
          {data ? `Last ${data.windowDays}d` : "Loading"}
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <div>
            <div className="text-[28px] font-bold text-zinc-100 leading-none">
              {data?.totalCalls ?? 0}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">calls</div>
          </div>
          <div className="text-zinc-800">·</div>
          <div>
            <div className="text-[20px] font-bold text-emerald-400 leading-none">
              {data?.avgDurationSec ?? 0}s
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">avg duration</div>
          </div>
          <div className="text-zinc-800">·</div>
          <div>
            <div className="text-[20px] font-bold text-amber-400 leading-none tabular-nums">
              ${data?.totalCostUsd ?? "0.00"}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">spend</div>
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">
          most recent call
        </div>
        {!data?.mostRecent && (
          <div className="text-[11px] text-zinc-600 italic">No calls in window.</div>
        )}
        {data?.mostRecent && (
          <div className="text-[12px] font-mono space-y-0.5">
            <div className="text-zinc-200">
              {fmtAgo(data.mostRecent.createdAt)}
              {data.mostRecent.durationSec ? ` · ${data.mostRecent.durationSec}s` : ""}
            </div>
            <div className="text-zinc-500 text-[10px]">
              status: <span className="text-zinc-300">{data.mostRecent.status ?? "—"}</span>
              {data.mostRecent.endedReason ? (
                <>
                  {" · "}
                  ended: <span className="text-zinc-300">{data.mostRecent.endedReason}</span>
                </>
              ) : null}
            </div>
          </div>
        )}
      </Panel>

      <Panel>
        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">
          by end reason
        </div>
        {data && Object.keys(data.byEndedReason).length === 0 && (
          <div className="text-[11px] text-zinc-600 italic">No data.</div>
        )}
        <div className="space-y-1">
          {data &&
            Object.entries(data.byEndedReason)
              .sort(([, a], [, b]) => b - a)
              .map(([reason, count]) => (
                <div
                  key={reason}
                  className="flex items-center gap-2 text-[11px] font-mono"
                >
                  <span className="flex-1 truncate text-zinc-200">{reason}</span>
                  <span className="text-zinc-300 tabular-nums">{count}</span>
                </div>
              ))}
        </div>
      </Panel>

      <div className="text-[9px] text-zinc-700 text-center font-mono">
        Auto-refresh 60s · proxied via VAPI /call endpoint · v10.0.316
      </div>
    </StandardPage>
  );
}
