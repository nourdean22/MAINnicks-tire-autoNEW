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
 * Restored 2026-07-16: PR #765 (admin wave 2) committed this file truncated —
 * import + Props + the doc comment above, no component body — which broke
 * `vite build` for the five admin pages that default-import it. The body below
 * reconstructs the pre-#765 `_degraded` banner (wave-181.16) and adds the
 * transport-failure case the wave-2 Props/JSDoc describe and the callers
 * already pass (OverviewSection/Admin send `unavailable` + `unavailableMessage`).
 *
 *   · stats._degraded → getDashboardStats() swallowed a query throw and
 *     returned all-zero defaults; the numbers on screen are fallback shape.
 *   · unavailable     → the query itself failed; there is no stats object
 *     at all and sections may render empty rather than zeroed.
 */
export default function DegradedDataBanner({ stats, unavailable, unavailableMessage }: Props) {
  const degraded = Boolean(stats?._degraded);
  if (!degraded && !unavailable) return null;

  return (
    <div
      role="alert"
      className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 flex items-start gap-3"
    >
      <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" aria-hidden />
      <div className="flex-1">
        <p className="font-semibold text-red-300 text-sm">
          {unavailable ? "Dashboard data is unavailable" : "Dashboard data is degraded"}
        </p>
        <p className="text-red-200/80 text-xs mt-1 leading-relaxed">
          {unavailable ? (
            <>
              The stats query failed — nothing below is live data.
              {unavailableMessage ? (
                <span className="ml-1 font-mono opacity-70">[{unavailableMessage}]</span>
              ) : null}
            </>
          ) : (
            <>
              The stats pipeline threw inside `getDashboardStats()` and returned
              all-zero defaults. The numbers below are NOT real — they're the
              fallback shape. A Telegram alert was sent to ops.
              {stats?._errorId ? (
                <span className="ml-1 font-mono opacity-70">[errorId: {stats._errorId}]</span>
              ) : null}
            </>
          )}
        </p>
        <p className="text-red-200/60 text-[10px] mt-1.5 leading-relaxed">
          Check Sentry / Railway logs for the underlying failure. Refresh once
          the backend is fixed to clear this banner.
        </p>
      </div>
    </div>
  );
}
