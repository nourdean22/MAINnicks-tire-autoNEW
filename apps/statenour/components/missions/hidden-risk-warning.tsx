import { useState, useEffect } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HiddenRiskSummary } from "@/lib/tasks/hidden-risk";

interface HiddenRiskWarningProps {
  summary: HiddenRiskSummary;
  executionModeActive: boolean;
  filterKey: string;
  onClearFilters: () => void;
  onExitFocusMode: () => void;
  onQueueNext: (taskId: string) => void;
}

export function HiddenRiskWarning({
  summary,
  executionModeActive,
  filterKey,
  onClearFilters,
  onExitFocusMode,
  onQueueNext,
}: HiddenRiskWarningProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [dismissedUntilFilterChange, setDismissedUntilFilterChange] = useState(false);
  const [dismissedSession, setDismissedSession] = useState(false);

  // Sync session storage dismissal
  useEffect(() => {
    if (typeof window !== "undefined") {
      const isDismissed = sessionStorage.getItem("risk-warning-dismissed-session") === "true";
      setDismissedSession(isDismissed);
    }
  }, []);

  // Reset filter-specific dismissal when filters change
  useEffect(() => {
    setDismissedUntilFilterChange(false);
  }, [filterKey]);

  if (summary.counts.total === 0) return null;
  if (dismissedUntilFilterChange || dismissedSession) return null;

  const highestSeverity = summary.counts.critical > 0
    ? "critical"
    : summary.counts.high > 0
      ? "high"
      : "medium";

  const bannerColorClass = highestSeverity === "critical"
    ? "border-rose-500/20 bg-rose-500/[0.02] text-rose-200/90"
    : highestSeverity === "high"
      ? "border-amber-500/20 bg-amber-500/[0.02] text-amber-200/90"
      : "border-zinc-800 bg-zinc-950/40 text-zinc-300";

  const badgeColorClass = (severity: string) => {
    switch (severity) {
      case "critical": return "bg-rose-500/10 text-rose-300 border-rose-500/20";
      case "high": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      default: return "bg-zinc-800 text-zinc-400 border-zinc-700/50";
    }
  };

  const handleDismissSession = () => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("risk-warning-dismissed-session", "true");
      setDismissedSession(true);
    }
  };

  return (
    <div className={cn("rounded-2xl border px-4 py-3 text-sm space-y-2.5 transition-all", bannerColorClass)}>
      <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-2">
          <AlertTriangle className={cn("h-4.5 w-4.5 shrink-0", 
            highestSeverity === "critical" ? "text-rose-400" : highestSeverity === "high" ? "text-amber-400" : "text-zinc-400"
          )} />
          <span className="font-medium tracking-wide">
            {executionModeActive ? (
              <>
                <strong>{summary.counts.total}</strong> risk task{summary.counts.total === 1 ? "" : "s"} outside this focus
              </>
            ) : (
              <>
                <strong>{summary.counts.total}</strong> high-risk task{summary.counts.total === 1 ? "" : "s"} hidden by filters
              </>
            )}
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="inline-flex items-center gap-1 font-mono uppercase tracking-wider text-zinc-400 hover:text-zinc-200 transition-colors px-2 py-1"
          >
            {showPreview ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showPreview ? "Hide Preview" : "Show hidden risks"}
          </button>

          {executionModeActive ? (
            <button
              onClick={onExitFocusMode}
              className="font-mono uppercase tracking-wider text-amber-400 hover:text-amber-300 transition-colors border border-amber-500/30 rounded bg-amber-500/5 px-2.5 py-1"
            >
              Exit to review
            </button>
          ) : (
            <button
              onClick={onClearFilters}
              className="font-mono uppercase tracking-wider text-rose-400 hover:text-rose-300 transition-colors border border-rose-500/30 rounded bg-rose-500/5 px-2.5 py-1"
            >
              Clear filters
            </button>
          )}

          {/* Dismiss options */}
          <div className="flex items-center gap-1.5 border-l border-zinc-800 pl-2">
            <button
              onClick={() => setDismissedUntilFilterChange(true)}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 underline"
              title="Hide until active filters change"
            >
              Hide
            </button>
            <span className="text-[10px] text-zinc-600">|</span>
            <button
              onClick={handleDismissSession}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 underline"
              title="Dismiss for this session"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>

      {/* Hidden risks details (collapsible preview) */}
      {showPreview && (
        <div className="border-t border-zinc-800/60 pt-2.5 space-y-2">
          {summary.previewList.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 bg-zinc-950/20 p-2 rounded-lg border border-zinc-800/40 text-xs"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={cn("px-1.5 py-0.5 rounded border text-[9px] uppercase font-mono tracking-wider font-semibold", badgeColorClass(item.severity))}>
                    {item.severity}
                  </span>
                  <span className="bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider">
                    {item.label}
                  </span>
                  {item.missionTitle && (
                    <span className="text-zinc-500 text-[10px]">
                      ↳ {item.missionTitle}
                    </span>
                  )}
                </div>
                <span className="text-zinc-200 font-medium">{item.title}</span>
              </div>

              {executionModeActive && (
                <button
                  onClick={() => onQueueNext(item.id)}
                  className="shrink-0 flex items-center gap-1 font-mono uppercase tracking-wider text-amber-400 hover:text-amber-300 transition-colors border border-amber-500/20 hover:border-amber-500/50 rounded bg-amber-500/[0.04] px-2 py-1 text-[10px]"
                >
                  <Play size={10} className="fill-current" />
                  Queue after this
                </button>
              )}
            </div>
          ))}

          {summary.hiddenTasks.length > 3 && (
            <div className="text-[10px] text-zinc-500 italic pl-1">
              And {summary.hiddenTasks.length - 3} other hidden risk task{summary.hiddenTasks.length - 3 === 1 ? "" : "s"}...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
