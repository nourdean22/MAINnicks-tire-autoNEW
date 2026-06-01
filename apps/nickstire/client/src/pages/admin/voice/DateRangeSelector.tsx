import { Calendar, RefreshCw } from "lucide-react";
import { RANGE_LABELS, RangePreset, defaultDateString } from "./format";

// ─── Date range selector (wave-91) ─────────────────────────
//
// Quick chips: Today / 7d / 30d / Custom. Custom expands two
// <input type="date"> pickers for arbitrary range. Defaults to
// 7-days-ago → today when Custom is selected fresh.

export function DateRangeSelector({
  preset,
  onPresetChange,
  customSince,
  customUntil,
  onCustomSinceChange,
  onCustomUntilChange,
  onRefresh,
  refreshing,
}: {
  preset: RangePreset;
  onPresetChange: (p: RangePreset) => void;
  customSince: string;
  customUntil: string;
  onCustomSinceChange: (v: string) => void;
  onCustomUntilChange: (v: string) => void;
  /** wave-111 — when auto-refresh is paused (preset !== "today"), give
      the operator a manual refresh button instead of forcing a browser
      reload or preset toggle. */
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <div className="bg-card border border-border/30 rounded p-3 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5 shrink-0">
        <Calendar className="w-4 h-4 text-foreground/50" />
        <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-foreground/50">
          Range
        </span>
      </div>
      <div className="inline-flex items-center gap-1 bg-background border border-border/30 rounded-md p-1">
        {(Object.keys(RANGE_LABELS) as RangePreset[]).map((p) => (
          <button
            key={p}
            onClick={() => onPresetChange(p)}
            className={
              "px-3 py-1 text-[12px] font-semibold tracking-wide rounded transition-colors " +
              (preset === p
                ? "bg-primary text-primary-foreground"
                : "text-foreground/60 hover:text-foreground hover:bg-foreground/5")
            }
          >
            {RANGE_LABELS[p]}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex items-center gap-2 ml-1">
          <input
            type="date"
            value={customSince}
            max={customUntil}
            onChange={(e) => onCustomSinceChange(e.target.value)}
            className="bg-background border border-border/30 rounded px-2 py-1 text-[12px] font-mono text-foreground focus:border-primary/50 focus:outline-none"
          />
          <span className="text-foreground/40 text-[12px]">→</span>
          <input
            type="date"
            value={customUntil}
            min={customSince}
            max={defaultDateString(0)}
            onChange={(e) => onCustomUntilChange(e.target.value)}
            className="bg-background border border-border/30 rounded px-2 py-1 text-[12px] font-mono text-foreground focus:border-primary/50 focus:outline-none"
          />
        </div>
      )}
      {preset !== "today" && (
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[10px] text-foreground/40 italic">
            Auto-refresh paused
          </span>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-[0.15em] uppercase px-2.5 py-1 border border-primary/40 text-primary rounded hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Refresh data"
              title="Pull fresh metrics + calls for this date range"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing" : "Refresh"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
