"use client";

/**
 * CONNECTION STATUS INDICATOR — compact pill that shows online/
 * offline/queued/retrying status for the chat offline queue.
 *
 * Renders nothing when status is "online" (no news is good news).
 * Shows a colored pill otherwise. Clicking it triggers a retry when
 * there are queued messages.
 */

import { cn } from "@/lib/utils";
import { Wifi, WifiOff, RefreshCw, Clock, CheckCircle2 } from "lucide-react";
import type { OfflineStatus, QueuedMessage } from "@/hooks/use-offline-queue";

interface ConnectionStatusProps {
  status: OfflineStatus;
  queue: QueuedMessage[];
  onRetry?: () => void;
  onClear?: () => void;
}

export function ConnectionStatus({
  status,
  queue,
  onRetry,
  onClear,
}: ConnectionStatusProps) {
  if (status === "online") return null;

  const queueCount = queue.length;

  let label: string;
  let Icon: typeof Wifi;
  let color: string;
  let bg: string;
  let border: string;
  let clickable = false;

  switch (status) {
    case "offline":
      label = queueCount > 0 ? `Offline · ${queueCount} queued` : "Offline";
      Icon = WifiOff;
      color = "text-red-400";
      bg = "bg-red-500/10";
      border = "border-red-500/30";
      break;
    case "queued":
      // 2026-05-24 · Wave X · pre-fix the label said "tap to retry"
      // implying queue persistence · the queue is WIPED on every mount
      // (see use-offline-queue.ts:131 · duplicate-replay bug
      // mitigation). On iOS Safari PWA the tab dies after ~30s in
      // background · any queued message vanishes. Now: label is honest
      // about session-only persistence so operator's mental model
      // matches reality.
      label = `${queueCount} queued · this session only · tap to send now`;
      Icon = Clock;
      color = "text-amber-400";
      bg = "bg-amber-500/10";
      border = "border-amber-500/30";
      clickable = true;
      break;
    case "retrying":
      label = `Reconnecting · sending ${queueCount}`;
      Icon = RefreshCw;
      color = "text-amber-400";
      bg = "bg-amber-500/10";
      border = "border-amber-500/30";
      break;
    case "drained":
      label = "All messages delivered";
      Icon = CheckCircle2;
      color = "text-emerald-400";
      bg = "bg-emerald-500/10";
      border = "border-emerald-500/30";
      break;
    default:
      return null;
  }

  const content = (
    <>
      <Icon
        size={14}
        className={cn(
          color,
          "shrink-0",
          status === "retrying" && "animate-spin"
        )}
      />
      <span className={cn("text-[12px] font-medium", color)}>{label}</span>
      {status === "queued" && onClear && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="ml-1 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] underline"
          aria-label="Clear offline queue"
        >
          clear
        </button>
      )}
    </>
  );

  if (clickable && onRetry) {
    return (
      <button
        onClick={onRetry}
        className={cn(
          "fixed left-1/2 -translate-x-1/2 z-[65] flex items-center gap-1.5 px-2.5 py-1 rounded-full border backdrop-blur-sm transition-all hover:scale-105 [bottom:calc(72px+env(safe-area-inset-bottom))]",
          bg,
          border
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "fixed left-1/2 -translate-x-1/2 z-[65] flex items-center gap-1.5 px-2.5 py-1 rounded-full border backdrop-blur-sm [bottom:calc(72px+env(safe-area-inset-bottom))]",
        bg,
        border
      )}
    >
      {content}
    </div>
  );
}
