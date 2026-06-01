/**
 * Shared admin state indicators — loading, empty, error.
 */
import React from "react";
import { AlertTriangle } from "lucide-react";

// ─── STATE INDICATORS ───────────────────────────────────
// Loading, empty, and error states for consistent UX across all sections.
export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-3" />
      <p className="text-[12px] text-muted-foreground">{label}</p>
    </div>
  );
}

export function EmptyState({ icon, title, subtitle, action }: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="text-foreground/10 mb-3">{icon}</div>}
      <p className="text-[13px] font-medium text-foreground/40">{title}</p>
      {subtitle && <p className="text-[11px] text-foreground/20 mt-1 max-w-xs">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message = "Something went wrong", onRetry }: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <AlertTriangle className="w-6 h-6 text-red-400/50 mb-3" />
      <p className="text-[12px] text-red-400/70">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 px-3 py-1.5 text-[11px] font-medium text-primary bg-primary/10 rounded hover:bg-primary/20 transition-colors">
          Try Again
        </button>
      )}
    </div>
  );
}
