/**
 * QueryState — reusable loading, error, and empty state components
 * for tRPC query results across all pages.
 *
 * 2026-05-06 visual upgrade: customer-facing loading state now uses the
 * branded TireSpinner instead of a generic spinner — every Cleveland
 * waiter who sees this gets a tiny dose of "yes, this is a tire shop"
 * brand reinforcement during the otherwise-blank loading moment.
 */
import { AlertTriangle, RefreshCw } from "lucide-react";
import TireSpinner from "./TireSpinner";

interface QueryLoadingProps {
  message?: string;
  className?: string;
}

export function QueryLoading({ message = "Loading...", className = "" }: QueryLoadingProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 ${className}`}>
      <TireSpinner size="md" />
      <p className="text-[13px] text-foreground/70 mt-4">{message}</p>
    </div>
  );
}

interface QueryErrorProps {
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function QueryError({ message = "Something went wrong. Please try again.", onRetry, className = "" }: QueryErrorProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 text-center ${className}`}>
      <AlertTriangle className="w-10 h-10 text-red-400 mb-4" />
      <p className="text-[13px] text-foreground/60 max-w-md mb-4">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 font-bold text-xs tracking-wide hover:bg-primary/90 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          TRY AGAIN
        </button>
      )}
    </div>
  );
}

interface QueryEmptyProps {
  icon?: React.ReactNode;
  title?: string;
  message?: string;
  className?: string;
}

export function QueryEmpty({ icon, title = "No data yet", message, className = "" }: QueryEmptyProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 text-center ${className}`}>
      {icon && <div className="text-foreground/20 mb-4">{icon}</div>}
      <p className="font-bold text-lg text-foreground/70 tracking-wider">{title}</p>
      {message && <p className="text-[13px] text-foreground/60 mt-2 max-w-md">{message}</p>}
    </div>
  );
}
