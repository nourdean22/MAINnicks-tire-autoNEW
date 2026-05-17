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
      label = `${queueCount} queued · tap to retry`;
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
        size={11}
        className={cn(
          color,
          "shrink-0",
          status === "retrying" && "animate-spin"
        )}
      />
      <span className={cn("text-[10px] font-medium", color)}>{label}</span>
      {status === "queued" && onClear && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="ml-1 text-[9px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] underline"
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
          "fixed bottom-16 left-1/2 -translate-x-1/2 z-[50] flex items-center gap-1.5 px-2.5 py-1 rounded-full border backdrop-blur-sm transition-all hover:scale-105",
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
        "fixed bottom-16 left-1/2 -translate-x-1/2 z-[50] flex items-center gap-1.5 px-2.5 py-1 rounded-full border backdrop-blur-sm",
        bg,
        border
      )}
    >
      {content}
    </div>
  );
}
