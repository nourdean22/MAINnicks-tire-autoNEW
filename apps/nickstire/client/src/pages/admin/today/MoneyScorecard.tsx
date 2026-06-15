import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  DollarSign,
  Phone,
  Users,
  CalendarClock,
  RotateCcw,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Tag
} from "lucide-react";
import { formatCents } from "../shared/format";
import { navigateToAdminSection } from "../shared/navigation";

export function MoneyScorecard() {
  const [isOpen, setIsOpen] = useState(false);
  const { data, isLoading, dataUpdatedAt } = trpc.controlCenter.moneySummary.useQuery(undefined, {
    refetchInterval: 30000,
    staleTime: 25_000,
  });

  if (isLoading) {
    return (
      <div className="bg-card border border-border/40 p-5 space-y-4 animate-pulse">
        <div className="h-4 w-40 bg-foreground/10 rounded" />
        <div className="grid grid-cols-1 gap-4">
          <div className="h-16 bg-foreground/10 rounded" />
        </div>
        <div className="grid grid-cols-5 gap-2">
          <div className="h-12 bg-foreground/5 rounded" />
          <div className="h-12 bg-foreground/5 rounded" />
          <div className="h-12 bg-foreground/5 rounded" />
          <div className="h-12 bg-foreground/5 rounded" />
          <div className="h-12 bg-foreground/5 rounded" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : new Date().toLocaleTimeString();

  return (
    <div className="bg-card border border-border/40 p-5 space-y-4 shadow-lg backdrop-blur-sm bg-opacity-80">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-emerald-400 tracking-wide uppercase flex items-center gap-2">
          <DollarSign className="w-3.5 h-3.5" />
          Money & Operations Summary
          <span className="ml-1 text-[10px] text-foreground/45 normal-case tracking-normal">
            today's pipeline & outstanding revenue
          </span>
        </h3>
        <span
          className="text-[9px] bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full font-bold tracking-wider"
          title={`ALG mirror last synced at ${lastUpdated}`}
        >
          SYNCED: {lastUpdated}
        </span>
      </div>

      {/* Outstanding sums grid */}
      <div className="grid grid-cols-1 gap-3">
        <div className="p-4 bg-amber-500/[0.02] border border-amber-500/20 rounded-lg">
          <span className="text-[11px] text-amber-400 uppercase font-bold tracking-wider block">
            Open Estimates
          </span>
          <span className="text-[10px] text-muted-foreground/60 block mt-0.5">
            (Total outstanding opportunities)
          </span>
          <div className="text-2xl font-bold text-amber-400 mt-1.5 tabular-nums">
            {formatCents(data.openEstimatesSum)}
          </div>
        </div>
      </div>

      {/* Today's KPI Metrics Grid */}
      <div>
        <div className="text-[10px] text-foreground/45 uppercase font-bold tracking-wider mb-2">
          Today's Operational Activity
        </div>
        <div className="grid grid-cols-5 gap-2">
          <div className="p-2.5 bg-foreground/[0.02] border border-border/10 rounded flex flex-col items-center justify-center text-center">
            <Phone className="w-3.5 h-3.5 text-blue-400 mb-1" />
            <div className="text-sm font-bold text-foreground tabular-nums">
              {data.todayMetrics.calls}
            </div>
            <div className="text-[9px] text-foreground/40 uppercase">Calls</div>
          </div>
          <div className="p-2.5 bg-foreground/[0.02] border border-border/10 rounded flex flex-col items-center justify-center text-center">
            <Users className="w-3.5 h-3.5 text-amber-400 mb-1" />
            <div className="text-sm font-bold text-foreground tabular-nums">
              {data.todayMetrics.leads}
            </div>
            <div className="text-[9px] text-foreground/40 uppercase">Leads</div>
          </div>
          <div className="p-2.5 bg-foreground/[0.02] border border-border/10 rounded flex flex-col items-center justify-center text-center">
            <CalendarClock className="w-3.5 h-3.5 text-emerald-400 mb-1" />
            <div className="text-sm font-bold text-foreground tabular-nums">
              {data.todayMetrics.bookings}
            </div>
            <div className="text-[9px] text-foreground/40 uppercase">Bookings</div>
          </div>
          <div className="p-2.5 bg-foreground/[0.02] border border-border/10 rounded flex flex-col items-center justify-center text-center">
            <Tag className="w-3.5 h-3.5 text-purple-400 mb-1" />
            <div className="text-sm font-bold text-foreground tabular-nums">
              {data.todayMetrics.tireOrders}
            </div>
            <div className="text-[9px] text-foreground/40 uppercase">Tire Orders</div>
          </div>
          <div className="p-2.5 bg-foreground/[0.02] border border-border/10 rounded flex flex-col items-center justify-center text-center">
            <RotateCcw className="w-3.5 h-3.5 text-pink-400 mb-1" />
            <div className="text-sm font-bold text-foreground tabular-nums">
              {data.todayMetrics.winbacks}
            </div>
            <div className="text-[9px] text-foreground/40 uppercase">Winbacks</div>
          </div>
        </div>
      </div>

      {/* Accordion / Table for Top 5 Open Estimates */}
      {data.pendingItems.length > 0 && (
        <div className="border-t border-border/20 pt-3">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center justify-between w-full text-left py-1 text-xs text-foreground/70 hover:text-foreground transition-colors"
          >
            <span className="font-semibold uppercase tracking-wider text-[10px]">
              Top 5 Open Estimates ({formatCents(data.pendingItems.reduce((acc, item) => acc + item.value, 0))})
            </span>
            <span className="flex items-center gap-1 text-[10px] text-primary">
              {isOpen ? "Hide List" : "Show List"}
              {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </button>

          {isOpen && (
            <div className="mt-3 space-y-1.5 overflow-hidden transition-all duration-300">
              {data.pendingItems.map((item) => (
                <div
                  key={`${item.type}-${item.id}`}
                  onClick={() => navigateToAdminSection("leads")}
                  className="flex items-center justify-between p-2 bg-foreground/[0.02] hover:bg-foreground/[0.04] border border-border/10 hover:border-primary/20 rounded cursor-pointer transition-all"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ClipboardList className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-foreground truncate">
                          {item.name}
                        </span>
                        <span className="text-[9px] font-bold tracking-wider px-1 py-0.2 rounded text-amber-400 bg-amber-500/10">
                          ESTIMATE
                        </span>
                      </div>
                      <div className="text-[10px] text-foreground/40 truncate">
                        {item.reference} · {new Date(item.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 font-bold text-xs text-foreground tabular-nums">
                    {formatCents(item.value)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

