import { AlertTriangle } from "lucide-react";

interface Props {
  stats?: { _degraded?: boolean; _errorId?: string } | null;
  unavailable?: boolean;
  unavailableMessage?: string;
}

/**
 * Prevents missing or failed admin data from being presented as verified zeros.
 * The banner supports both server-degraded fallback shapes and transport/query
 * failures where no stats object was returned at all.
 *
 * (Shipped truncated mid-file in #767 — every consumer imported a module with
 * no export, breaking typecheck repo-wide. Body reconstructed from this
 * docstring + the Props contract + the five call sites.)
 */
export default function DegradedDataBanner({ stats, unavailable, unavailableMessage }: Props) {
  if (unavailable) {
    return (
      <div role="alert" className="flex gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div>
          <strong>Data unavailable.</strong>
          <div className="mt-1 text-xs text-red-200/70">
            {unavailableMessage || "The dashboard query failed."} Figures below may render as zeros — treat them as missing, not as real values.
          </div>
        </div>
      </div>
    );
  }

  if (stats?._degraded) {
    return (
      <div role="alert" className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div>
          <strong>Degraded data.</strong>
          <div className="mt-1 text-xs text-amber-200/70">
            Part of the dashboard pipeline failed; some figures are fallbacks, not verified numbers.
            {stats._errorId ? <> Error reference: <code className="font-mono">{stats._errorId}</code></> : null}
          </div>
        </div>
      </div>
    );
  }

  return null;
}