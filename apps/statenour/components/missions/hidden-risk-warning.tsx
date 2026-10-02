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
      : "border-edge-subtle bg-content text-fg-secondary";

  const badgeColorClass = (severity: string) => {
    switch (severity) {
      case "critical": return "bg-rose-500/10 text-rose-300 border-rose-500/20";
      case "high": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      default: return "bg-surface-interactive text-fg-secondary border-edge-default";
    }
  };

  const handleDismissSession = () => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("risk-warning-dismissed-session", "true");
      setDismissedSession(true);
    }
  };

  return (
    <div className={cn("rounded-surface border px-4 py-3 text-sm space-y-2.5", bannerColorClass)}>
      <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-2">
          <AlertTriangle className={cn("h-4.5 w-4.5 shrink-0", 
            highestSeverity === "critical" ? "text-rose-400" : highestSeverity === "high" ? "text-amber-400" : "text-fg-tertiary"
          )} />
          <span className="font-medium">
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
            className="inline-flex min-h-[44px] items-center gap-1 text-[13px] font-medium text-fg-tertiary hover:text-fg transition-colors duration-[var(--motion-state)] px-2 py-1"
          >
            {showPreview ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showPreview ? "Hide Preview" : "Show hidden risks"}
          </button>

          {executionModeActive ? (
            <button
              onClick={onExitFocusMode}
              className="inline-flex min-h-[44px] items-center text-[13px] font-medium text-amber-400 hover:text-amber-300 transition-colors duration-[var(--motion-state)] border border-amber-500/30 rounded-control bg-amber-500/5 px-3 py-1"
            >
              Exit to review
            </button>
          ) : (
            <button
              onClick={onClearFilters}
              className="inline-flex min-h-[44px] items-center text-[13px] font-medium text-rose-400 hover:text-rose-300 transition-colors duration-[var(--motion-state)] border border-rose-500/30 rounded-control bg-rose-500/5 px-3 py-1"
            >
              Clear filters
            </button>
          )}

          {/* Dismiss options */}
          <div className="flex items-center gap-1.5 border-l border-edge-default pl-2">
            <button
              onClick={() => setDismissedUntilFilterChange(true)}
              className="min-h-[44px] text-[12px] text-fg-tertiary hover:text-fg transition-colors duration-[var(--motion-state)] underline"
              title="Hide until active filters change"
            >
              Hide
            </button>
            <span className="text-[12px] text-fg-tertiary">|</span>
            <button
              onClick={handleDismissSession}
              className="min-h-[44px] text-[12px] text-fg-tertiary hover:text-fg transition-colors duration-[var(--motion-state)] underline"
              title="Dismiss for this session"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>

      {/* Hidden risks details (collapsible preview) */}
      {showPreview && (
        <div className="border-t border-edge-subtle pt-2.5 space-y-2">
          {summary.previewList.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 bg-surface-raised p-2 rounded-control border border-edge-subtle text-xs"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={cn("px-1.5 py-0.5 rounded-micro border font-mono text-[11px] uppercase tracking-[0.12em]", badgeColorClass(item.severity))}>
                    {item.severity}
                  </span>
                  <span className="bg-surface-interactive text-fg-secondary px-1.5 py-0.5 rounded-micro font-mono text-[11px]">
                    {item.label}
                  </span>
                  {item.missionTitle && (
                    <span className="text-fg-tertiary text-[11px]">
                      ↳ {item.missionTitle}
                    </span>
                  )}
                </div>
                <span className="text-fg font-medium">{item.title}</span>
              </div>

              {executionModeActive && (
                <button
                  onClick={() => onQueueNext(item.id)}
                  className="shrink-0 flex min-h-[44px] items-center gap-1 text-[13px] font-medium text-amber-400 hover:text-amber-300 transition-colors duration-[var(--motion-state)] border border-amber-500/20 hover:border-amber-500/50 rounded-control bg-amber-500/[0.04] px-3 py-1"
                >
                  <Play size={10} className="fill-current" />
                  Queue after this
                </button>
              )}
            </div>
          ))}

          {summary.hiddenTasks.length > 3 && (
            <div className="text-[12px] text-fg-tertiary italic pl-1">
              And {summary.hiddenTasks.length - 3} other hidden risk task{summary.hiddenTasks.length - 3 === 1 ? "" : "s"}...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
