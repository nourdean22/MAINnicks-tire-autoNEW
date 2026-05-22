"use client";

/**
 * /system/tire-stock-requests — used-tire stock-check log dashboard.
 *
 * v10.0.279 · what sizes are callers asking for? · how urgent? · what
 * vehicles? Fed by brainMemory category='tire_stock_request' written
 * by the VAPI Nick assistant's checkUsedTireStock tool.
 *
 * Three panels ·
 *   1. Headline scorecard · total requests + urgency rate
 *   2. Top-asked sizes (inventory signal · what to stock more of)
 *   3. Recent calls (last 25) with caller / vehicle / urgency
 *
 * Window selector · 1d / 7d / 30d / 90d. Auto-refresh 60s.
 */

import { useState, useEffect } from "react";
import { Panel } from "@/components/panel";
import { StandardPage } from "@/components/layout/standard-page";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { cn } from "@/lib/utils/cn";
import { trpc } from "@/lib/trpc/client";

interface SizeAgg {
  size: string;
  count: number;
}

interface RequestRow {
  id: string;
  capturedAt: string | null;
  size: string;
  quantity: number;
  callerName: string | null;
  callerPhone: string | null;
  vehicle: string | null;
  urgency: string;
  notes: string | null;
}

interface DayBucket {
  date: string;
  count: number;
  urgent: number;
}

interface TireStockData {
  windowDays: number;
  sinceIso: string;
  totalRequests: number;
  urgentCount: number;
  urgencyRate: number;
  topSizes: SizeAgg[];
  dailyHistogram: DayBucket[];
  recent: RequestRow[];
}

// v10.0.292 · day-by-day stacked sparkline · amber for total volume,
// rose overlay for the urgent share. Pure CSS · matches the existing
// SVG / progress-ring vocabulary without pulling Recharts into a small
// dashboard widget.
function DailyVolumeChart({ data }: { data: DayBucket[] }) {
  if (!data.length) return null;
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="space-y-1">
      <div className="flex items-end gap-[2px] h-[60px]">
        {data.map((d) => {
          const heightPct = (d.count / max) * 100;
          const urgentPct = d.count > 0 ? (d.urgent / d.count) * 100 : 0;
          return (
            <div
              key={d.date}
              className="flex-1 min-w-0 flex flex-col justify-end"
              title={`${d.date} · ${d.count} call${d.count === 1 ? "" : "s"}${d.urgent > 0 ? ` (${d.urgent} urgent)` : ""}`}
            >
              <div
                className="w-full rounded-sm overflow-hidden flex flex-col-reverse bg-zinc-900/40"
                style={{ height: `${heightPct}%` }}
              >
                <div
                  className="w-full bg-rose-500/70"
                  style={{ height: `${urgentPct}%` }}
                />
                <div className="flex-1 bg-amber-500/60" />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[8px] font-mono text-zinc-600">
        <span>{data[0]?.date.slice(5)}</span>
        <span>{data[data.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

const WINDOWS = [
  { label: "1d", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
] as const;

export default function TireStockRequestsPage() {
  const [days, setDays] = useState<number>(30);
  // v10.0.440 · sort key · 4 modes
  type TireSort = "newest" | "oldest" | "urgent-first" | "quantity-most";
  const [sortKey, setSortKey] = useState<TireSort>(() => {
    if (typeof window === "undefined") return "newest";
    const saved = window.localStorage.getItem("tire-stock:sortKey");
    const valid: TireSort[] = ["newest", "oldest", "urgent-first", "quantity-most"];
    return saved && valid.includes(saved as TireSort) ? (saved as TireSort) : "newest";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("tire-stock:sortKey", sortKey);
  }, [sortKey]);

  // Phase B.7b · React Query drives the fetch + the 60s auto-refresh
  // (was a manual setInterval over authedFetch). The input object is
  // the query key, so switching the window pill refetches without a
  // manual load(). The TireStockData shape flows from the procedure.
  const stockQuery = trpc.system.tireStockRequests.useQuery(
    { days },
    { refetchInterval: 60_000, staleTime: 30_000 },
  );
  const data = stockQuery.data ?? null;
  const loading = stockQuery.isLoading;
  const error = stockQuery.error;

  const fmtAgo = (iso?: string | null) => {
    if (!iso) return "—";
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
    return `${Math.round(ms / 86_400_000)}d ago`;
  };

  const maxSizeCount = data?.topSizes[0]?.count ?? 1;

  return (
    <StandardPage
      eyebrow="System / observability"
      title="Used-tire stock requests"
      description="What sizes callers are asking for · urgency mix · inventory signal."
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

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-[11px] text-red-300">
          Failed to load · {error.message}
        </div>
      )}

      <Panel className="space-y-1.5">
        <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">
          {data ? `Last ${data.windowDays}d` : "Loading"}
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <div>
            <div className="text-[28px] font-bold text-zinc-100 leading-none">
              {data?.totalRequests ?? 0}
            </div>
            <div className="text-[9px] text-zinc-500 mt-0.5">
              stock-check call{data?.totalRequests === 1 ? "" : "s"}
            </div>
          </div>
          <div className="text-zinc-800">·</div>
          <div>
            <div
              className={cn(
                "text-[20px] font-bold leading-none",
                (data?.urgencyRate ?? 0) > 50 ? "text-rose-400" : "text-amber-400",
              )}
            >
              {data?.urgencyRate ?? 0}%
            </div>
            <div className="text-[9px] text-zinc-500 mt-0.5">
              urgent · stranded callers
            </div>
          </div>
          <div className="text-zinc-800">·</div>
          <div>
            <div className="text-[20px] font-bold text-zinc-300 leading-none">
              {data?.urgentCount ?? 0}
            </div>
            <div className="text-[9px] text-zinc-500 mt-0.5">
              urgent count
            </div>
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 mb-2">
          daily volume · last {data?.windowDays ?? 0}d
        </div>
        {data?.dailyHistogram && data.dailyHistogram.length > 0 ? (
          <DailyVolumeChart data={data.dailyHistogram} />
        ) : (
          <div className="text-[11px] text-zinc-600 italic">
            No volume yet. Bars appear once Nick handles tire-search calls.
          </div>
        )}
      </Panel>

      <Panel>
        <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 mb-2">
          top-asked sizes (inventory signal)
        </div>
        {loading && !data && (
          <div className="text-[11px] text-zinc-600">loading…</div>
        )}
        {data && data.topSizes.length === 0 && (
          <div className="text-[11px] text-zinc-600 italic">
            No tire-stock requests yet in this window. Once Nick handles
            calls and the checkUsedTireStock tool fires, they show up here.
          </div>
        )}
        <div className="space-y-1">
          {data?.topSizes.map((s) => (
            <div
              key={s.size}
              className="flex items-center gap-2 text-[11px] font-mono"
            >
              <div className="flex-1 min-w-0">
                <span className="text-zinc-200">{s.size}</span>
                <div className="h-1 bg-zinc-900 rounded mt-0.5 overflow-hidden">
                  <div
                    className="h-full bg-amber-500/60 transition-all"
                    style={{ width: `${(s.count / maxSizeCount) * 100}%` }}
                  />
                </div>
              </div>
              <span className="text-zinc-300 tabular-nums shrink-0 w-10 text-right">
                {s.count}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">
            recent · last {data?.recent.length ?? 0}
          </div>
          {/* v10.0.440 · sort dropdown · 4 modes */}
          <SortDropdown<TireSort>
            value={sortKey}
            onChange={setSortKey}
            defaultValue="newest"
            ariaLabel="Sort tire-stock requests"
            options={[
              { value: "newest", label: "newest first" },
              { value: "oldest", label: "oldest first" },
              { value: "urgent-first", label: "urgent first" },
              { value: "quantity-most", label: "quantity · most" },
            ]}
          />
        </div>
        {data && data.recent.length === 0 && (
          <div className="text-[11px] text-zinc-600 italic">No recent calls.</div>
        )}
        <div className="space-y-1.5">
          {[...(data?.recent ?? [])].sort((a, b) => {
            switch (sortKey) {
              case "oldest": {
                const at = a.capturedAt ? new Date(a.capturedAt).getTime() : 0;
                const bt = b.capturedAt ? new Date(b.capturedAt).getTime() : 0;
                return at - bt;
              }
              case "urgent-first": {
                const ua = a.urgency === "urgent" ? 0 : 1;
                const ub = b.urgency === "urgent" ? 0 : 1;
                if (ua !== ub) return ua - ub;
                const at = a.capturedAt ? new Date(a.capturedAt).getTime() : 0;
                const bt = b.capturedAt ? new Date(b.capturedAt).getTime() : 0;
                return bt - at;
              }
              case "quantity-most":
                return (b.quantity ?? 0) - (a.quantity ?? 0);
              case "newest":
              default: {
                const at = a.capturedAt ? new Date(a.capturedAt).getTime() : 0;
                const bt = b.capturedAt ? new Date(b.capturedAt).getTime() : 0;
                return bt - at;
              }
            }
          }).map((r) => (
            <div
              key={r.id}
              className={cn(
                "rounded border p-2 text-[11px] font-mono",
                r.urgency === "urgent"
                  ? "border-rose-500/30 bg-rose-500/5"
                  : "border-zinc-800/60 bg-zinc-900/30",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-zinc-200">
                  {r.size}
                  {r.quantity > 1 && (
                    <span className="text-zinc-500 ml-1">×{r.quantity}</span>
                  )}
                </span>
                <span className="text-[9px] text-zinc-600">
                  {fmtAgo(r.capturedAt)}
                </span>
              </div>
              <div className="text-[9px] text-zinc-500 mt-0.5 flex flex-wrap gap-x-2">
                {r.urgency === "urgent" && (
                  <span className="text-rose-400">URGENT</span>
                )}
                {r.callerName && <span>caller: {r.callerName}</span>}
                {r.callerPhone && <span>· {r.callerPhone}</span>}
                {r.vehicle && <span>· {r.vehicle}</span>}
              </div>
              {r.notes && (
                <p className="text-[9px] text-zinc-400 italic mt-0.5">{r.notes}</p>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <div className="text-[9px] text-zinc-700 text-center font-mono">
        Auto-refresh 60s · brainMemory category=&apos;tire_stock_request&apos; · v10.0.314
      </div>
    </StandardPage>
  );
}
