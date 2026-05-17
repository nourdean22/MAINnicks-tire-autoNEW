/**
 * DegradedDataBanner — wave-181.16
 *
 * Silent-failure audit (Finding #2) caught that getDashboardStats()
 * returns `_degraded: true` and all-zero defaults when the inner
 * try/catch swallows a query throw. Without surfacing this to the UI,
 * the operator sees a healthy-looking admin dashboard with all-zero
 * KPIs and has no way to know the backend is broken.
 *
 * This banner renders ONLY when stats._degraded === true. Drop at the
 * top of any admin section that reads `trpc.adminDashboard.stats`.
 *
 * Pairs with the Telegram alert that already fires from the catch in
 * server/admin-stats.ts:540 — Telegram tells ops the failure is
 * happening; this banner tells the OPERATOR sitting at the dashboard
 * that what they're looking at isn't trustworthy.
 */

import { AlertTriangle } from "lucide-react";

interface Props {
  /** Any object that may carry the _degraded marker. The interface
   *  comes from DashboardStats (server/admin-stats.ts) but we accept
   *  loose shapes here so callers don't have to import the server type. */
  stats?: { _degraded?: boolean; _errorId?: string } | null | undefined;
}

export default function DegradedDataBanner({ stats }: Props) {
  if (!stats?._degraded) return null;
  return (
    <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" aria-hidden />
      <div className="flex-1">
        <p className="font-semibold text-red-300 text-sm">Dashboard data is degraded</p>
        <p className="text-red-200/80 text-xs mt-1 leading-relaxed">
          The stats pipeline threw inside `getDashboardStats()` and returned
          all-zero defaults. The numbers below are NOT real — they're the
          fallback shape. A Telegram alert was sent to ops.
          {stats._errorId ? (
            <span className="ml-1 font-mono opacity-70">
              [errorId: {stats._errorId}]
            </span>
          ) : null}
        </p>
        <p className="text-red-200/60 text-[10px] mt-1.5 leading-relaxed">
          Check Sentry / Railway logs for the underlying query failure.
          Refresh once the backend is fixed to clear this banner.
        </p>
      </div>
    </div>
  );
}
