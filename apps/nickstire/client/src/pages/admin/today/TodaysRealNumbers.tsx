/**
 * TodaysRealNumbers — the Today surface, on tables that actually have rows.
 *
 * Its sibling TodaysMoneyRisks reads `leads` (2 rows in all of production) and
 * `callback_requests` (nothing newer than 2026-05-31). This card reads the
 * three things the shop genuinely generates: declined work worth reclaiming,
 * calls, and invoiced revenue. `controlCenter.todayPulse` documents what was
 * measured and excluded, and why.
 *
 * HONESTY · when the query fails the card renders NOTHING. An unreadable pulse
 * must never draw as a quiet day — that is the exact confusion this whole arc
 * has been removing. The revenue figure carries its own through-date because
 * the ShopDriver mirror runs a day behind and a bare "7-day revenue" implies a
 * currency it does not have.
 */
import { trpc } from "@/lib/trpc";
import { AlertTriangle, PhoneCall, Receipt, TrendingUp } from "lucide-react";
import { formatCents } from "../shared/format";
import { mirrorFreshness, abandonRate } from "./todayPulse";

export function TodaysRealNumbers() {
  const { data, isLoading } = trpc.controlCenter.todayPulse.useQuery(undefined, {
    refetchInterval: 120_000,
  });

  // Nothing to say yet, or the read failed. Silence beats a fabricated zero.
  if (isLoading || !data?.available) return null;

  const { declinedWork, calls, revenue } = data;
  const freshness = mirrorFreshness(revenue.throughDate, new Date());
  const abandoned = abandonRate(calls);

  return (
    <div className="bg-card border border-border/30">
      <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-foreground/60" />
        <span className="text-xs uppercase tracking-[0.15em] text-foreground/70 font-medium">
          Today, for real
        </span>
      </div>

      <div className="divide-y divide-border/20">
        {/* Biggest recoverable number in the business, and loops already run on it. */}
        {declinedWork.openCount > 0 && (
          <div className="px-4 py-3.5 flex items-start gap-3">
            <Receipt className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-lg font-semibold tabular-nums text-amber-400">
                {formatCents(declinedWork.openCents)}
              </div>
              <div className="text-xs text-foreground/60 mt-0.5">
                {declinedWork.openCount} estimates never became jobs
                {declinedWork.last30 > 0 && <> · {declinedWork.last30} in the last 30 days</>}
              </div>
            </div>
          </div>
        )}

        {/* The only table in this database that is live to the minute. */}
        <div className="px-4 py-3.5 flex items-start gap-3">
          <PhoneCall className="w-4 h-4 mt-0.5 text-emerald-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-lg font-semibold tabular-nums">
              {calls.last24h} <span className="text-sm font-normal text-foreground/60">calls · 24h</span>
            </div>
            <div className="text-xs text-foreground/60 mt-0.5">
              {/* "reached a booking or quote tool", NOT "became leads". The
                  underlying column is set on tool contact, and 449 calls carry
                  it while the leads table holds 2 rows. See todayPulse's SQL. */}
              {calls.reachedTool24h} reached a booking or quote tool
              {/* Only rendered when there were calls to measure — see abandonRate. */}
              {abandoned !== null && calls.abandoned24h > 0 && (
                <> · {calls.abandoned24h} hung up under 20s ({abandoned}%)</>
              )}
            </div>
          </div>
        </div>

        {/* Revenue always ships its own as-of date. */}
        <div className="px-4 py-3.5 flex items-start gap-3">
          <TrendingUp className="w-4 h-4 mt-0.5 text-primary shrink-0" />
          <div className="min-w-0">
            <div className="text-lg font-semibold tabular-nums text-primary">
              {formatCents(revenue.revenue7dCents)}
            </div>
            <div className="text-xs text-foreground/60 mt-0.5">
              {revenue.invoices7d} paid invoices · 7 days ·{" "}
              <span className={freshness.stale ? "text-amber-400" : ""}>{freshness.label}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Loud only when the lag is genuinely abnormal — a one-day lag is normal
          here, and warning about it daily trains the operator to ignore this. */}
      {freshness.stale && (
        <div className="px-4 py-2.5 border-t border-border/30 bg-amber-500/10 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-[11px] text-amber-200/90">
            Invoice sync is {freshness.label} — revenue above is understated until the mirror catches up.
          </span>
        </div>
      )}
    </div>
  );
}
