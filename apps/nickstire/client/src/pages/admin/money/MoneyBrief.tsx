/**
 * MoneyBrief — wave-181.x Money Phase 2.
 *
 * Mirror of CustomersBrief / OutreachBrief / LeadsBrief / MorningBrief
 * · 3-line auto-narrative that lands above the AT-A-GLANCE removal /
 * MONTHLY PACE block so the operator's first eye-grab is "what's the
 * money state today" rather than 7 KPI tiles.
 *
 * COMPOSITION (3 signal lines, each <120 chars)
 *   1. VELOCITY · $ today (or period) vs daily target (% pacing)
 *   2. PIPELINE · $ in shop + $ in declined recovery available
 *   3. ACTION   · loss-aversion-designer steal · "N declined ≥$500
 *                 + ≥7d old · ${RECOVERABLE} hot · FIRE →"
 *                 clarity-gate · self-hides when no real signal
 *
 * STEAL BUNDLE (per parallel skill-mining agent · DFII 8-9)
 *   · loss-aversion-designer · daily-burn framing in Action line
 *   · data-storytelling      · "[number] + [impact] + [context]"
 *                              headline formula on Pipeline line
 *   · kpi-dashboard-design   · 3-line cap above StatCards (not 5+)
 *
 * NO NEW SERVER WORK · composes from queries RevenueContent
 * already runs (stats / kpi / shopFloor) plus one extra
 * invoices.declined.useQuery to compute the action line.
 *
 * CLARITY-GATE DECISIONS (resolved before coding)
 *   · Loading state → short shimmer line · not full skeleton
 *   · "Today" vs "Period" → use the period prop the parent passes
 *     so brief tracks the same time window as the dashboard charts.
 *     period=1 → today · period=7 → "this week" · period=30 → "30d".
 *   · ACTION threshold → $500 + 7d old · matches the cron's 7d-tier
 *     sweep eligibility · what's actually ready to FIRE
 *   · Daily-burn rate → declined value × (1 − 2^(−1/30)) ≈ 2.3% ·
 *     ≡ what a 30-day half-life implies per day · honest reference
 *     point per loss-aversion-designer guidance
 */
import { trpc } from "@/lib/trpc";
import { TrendingUp, DollarSign, AlertTriangle, ArrowRight, Activity } from "lucide-react";
// wave-181.x Money Phase 2 · agent code-review M4 fix · DAILY_DECAY_
// RATE was duplicated · hoisted to shared moneyMath helper.
import { agedRecoverableDollars, dailyBurnDollars } from "./moneyMath";
import { formatMoneyShort } from "../shared/format";

interface MoneyBriefProps {
  /** Number of days the parent dashboard is showing · 1 / 7 / 30 / 90 */
  period: number;
  /** Click handler for the Action CTA · jumps to the Declined tab. */
  onDeclinedAction: () => void;
}

// formatDollars · alias for the shared compact formatMoneyShort helper
const formatDollars = formatMoneyShort;

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Late shift";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Afternoon";
  return "Good evening";
}

export function MoneyBrief({ period, onDeclinedAction }: MoneyBriefProps) {
  const { data: stats } = trpc.invoices.stats.useQuery({ days: period }, { staleTime: 60_000 });
  const { data: kpi } = trpc.kpi.current.useQuery(undefined, { staleTime: 60_000 });
  const { data: shopFloor } = trpc.nourOsBridge.shopFloor.useQuery(undefined, { staleTime: 60_000 });
  const { data: declined, isError: declinedError } = trpc.invoices.declined.useQuery({ days: 60 }, { staleTime: 60_000 });
  const { data: intel } = trpc.invoices.intelligence.useQuery({ period: "30d" }, { staleTime: 60_000 });

  // wave-181.x Money Phase 2 · R1 fix · the all-or-nothing gate
  // (!stats || !kpi || !declined || !intel) left the WHOLE brief stuck
  // on the shimmer in prod because one of declined/intel never resolved
  // for the brief while the dashboard below rendered fine off its own
  // query copies. Now gate ONLY on the headline-bearing pair (stats +
  // kpi); the Pipeline and Action lines lazy-fill once declined/intel
  // arrive (each guarded individually below). shopFloor stays optional.
  if (!stats || !kpi) {
    return (
      <div className="bg-card border border-border/40 p-4">
        <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-foreground/30 animate-pulse">
          Loading money brief…
        </div>
      </div>
    );
  }

  // VELOCITY · total revenue this period vs daily target × period.
  // Needs only stats; the "% of target" clause depends on intel and is
  // gated by periodTarget > 0 (zero until intel resolves → clause hidden).
  const periodRevenue = stats.totalRevenue ?? 0;
  const dailyTarget = intel?.projections?.dailyTarget ?? 0;
  const periodTarget = dailyTarget * period;
  const pacingPercent = periodTarget > 0 ? Math.round((periodRevenue / periodTarget) * 100) : 0;
  const periodLabel = period === 1 ? "today" : period === 7 ? "this week" : `last ${period}d`;

  // PIPELINE · $ in shop + $ recoverable from declined (both optional;
  // line self-hides until at least one resolves to a non-zero value)
  const valueInShop = shopFloor?.totalValueInProgress ?? 0;
  const recoverableDollars = declined?.recoverable ?? 0;

  // ACTION · count hot declined estimates (≥$500 · ≥7d old). Lazy-fills
  // once `declined` arrives. Server query aliases estimateDate →
  // invoiceDate (see server/routers/advanced/invoices.ts L682). Same
  // shape used by DeclinedEstimatesSection's recoveryScore.
  const estimates = declined?.estimates ?? [];
  const now = Date.now();
  const SEVEN_DAYS_MS = 7 * 86_400_000;
  const FIVE_HUNDRED_CENTS = 50_000;
  let hotCount = 0;
  let hotDollars = 0;
  for (const est of estimates) {
    const amount = est.totalAmount ?? 0;
    if (amount < FIVE_HUNDRED_CENTS) continue;
    const estDate = est.invoiceDate;
    const ageMs = estDate ? now - new Date(estDate).getTime() : 0;
    if (ageMs < SEVEN_DAYS_MS) continue;
    hotCount += 1;
    hotDollars += amount / 100;
  }

  // wave-181.x Money Phase 2 · agent code-review #3 fix · was using
  // the full `recoverableDollars` (includes fresh estimates) for the
  // burn anchor. Half-life only meaningfully applies to AGED esti-
  // mates · so the burn rate now anchors on the same ≥7d-old subset
  // the Action threshold uses. Honest framing per loss-aversion-
  // designer "verify the scarcity is real" rule.
  const agedDollars = agedRecoverableDollars(estimates);
  const dailyBurn = dailyBurnDollars(agedDollars);

  const showActionLine = hotCount > 0;

  return (
    <div className="bg-card border border-border/40 p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-[0.18em] uppercase text-foreground/45">
          {greeting()} · money brief
        </span>
        <span className="text-[10px] tracking-wider text-foreground/30">
          {periodLabel}
        </span>
      </div>
      <div className="space-y-1.5">
        {/* Line 1 · velocity */}
        <div className="flex items-center gap-2.5">
          <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="text-[12.5px] text-foreground/85 leading-tight">
            Velocity · {formatDollars(periodRevenue)} collected {periodLabel}
            {periodTarget > 0 ? ` · pacing ${pacingPercent}% of ${formatDollars(periodTarget)} target` : ""}
          </span>
        </div>

        {/* ROS-083 · a failed declined read used to leave recoverableDollars at
            0, which BOTH silenced the recoverable clause here AND self-hid the
            Action line below — the brief read as "nothing to chase" precisely
            when it could not see. Unknown is not zero. */}
        {declinedError && (
          <div className="flex items-center gap-2.5">
            <DollarSign className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[12.5px] text-amber-400 leading-tight">
              Declined work could not be read — recoverable money is unknown, NOT zero.
            </span>
          </div>
        )}

        {/* Line 2 · pipeline · skip when nothing in flight */}
        {(valueInShop > 0 || recoverableDollars > 0) && (
          <div className="flex items-center gap-2.5">
            <Activity className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="text-[12.5px] text-foreground/85 leading-tight">
              Pipeline ·
              {valueInShop > 0 ? ` ${formatDollars(valueInShop)} in shop` : ""}
              {valueInShop > 0 && recoverableDollars > 0 ? " · " : ""}
              {recoverableDollars > 0 ? `${formatDollars(recoverableDollars)} recoverable from declined work` : ""}
            </span>
          </div>
        )}

        {/* Line 3 · action · loss-aversion-designer daily-burn framing */}
        {showActionLine ? (
          <button
            type="button"
            onClick={onDeclinedAction}
            className="flex items-center gap-2.5 w-full text-left hover:bg-amber-500/[0.04] -mx-2 px-2 py-1 rounded transition-colors group"
          >
            <DollarSign className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[12.5px] text-amber-300 leading-tight flex-1">
              Action · <span className="font-semibold">{hotCount}</span> declined ≥$500 + ≥7d old · {formatDollars(hotDollars)} hot
              {dailyBurn > 0 ? ` · ~${formatDollars(dailyBurn)}/day decaying at 30d half-life` : ""}
            </span>
            <span className="text-[10px] text-amber-400/60 tracking-wider group-hover:text-amber-400 transition-colors whitespace-nowrap">
              FIRE <ArrowRight className="w-3 h-3 inline-block -mt-0.5" />
            </span>
          </button>
        ) : recoverableDollars > 0 ? (
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[12.5px] text-foreground/85 leading-tight">
              Action · no ≥$500 + ≥7d-old declined work pending · queue is current
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
