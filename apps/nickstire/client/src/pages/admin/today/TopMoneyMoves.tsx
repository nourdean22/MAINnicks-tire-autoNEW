import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  TrendingUp, PhoneCall, DollarSign, Send, Shield, Zap, Sparkles, ChevronRight, CheckCircle2, AlertTriangle, Loader2
} from "lucide-react";
import { navigateToAdminSection } from "../shared";
import { confirmDialog } from "@/components/admin/ConfirmDialog";

const MOVE_CONFIG = {
  estimate: {
    icon: <TrendingUp className="w-4 h-4 text-amber-400" />,
    color: "text-amber-400 border-amber-500/20 bg-amber-500/5",
    badge: "text-amber-400 bg-amber-500/10",
  },
  callback: {
    icon: <PhoneCall className="w-4 h-4 text-blue-400" />,
    color: "text-blue-400 border-blue-500/20 bg-blue-500/5",
    badge: "text-blue-400 bg-blue-500/10",
  },
  invoice: {
    icon: <DollarSign className="w-4 h-4 text-emerald-400" />,
    color: "text-emerald-400 border-emerald-500/20 bg-emerald-500/5",
    badge: "text-emerald-400 bg-emerald-500/10",
  },
  winback: {
    icon: <Send className="w-4 h-4 text-primary" />,
    color: "text-primary border-primary/20 bg-primary/5",
    badge: "text-primary bg-primary/10",
  },
  membership: {
    icon: <Shield className="w-4 h-4 text-red-400" />,
    color: "text-red-400 border-red-500/20 bg-red-500/5",
    badge: "text-red-400 bg-red-500/10",
  },
} as const;

export function TopMoneyMoves() {
  const utils = trpc.useUtils();
  const { data: moves, isLoading, error } = trpc.controlCenter.topMoneyMoves.useQuery(undefined, {
    refetchInterval: 30000,
    staleTime: 25_000,
  });

  const grantGrace = trpc.memberships.grantGracePeriod.useMutation({
    onSuccess: () => {
      toast.success("Grace period granted successfully");
      utils.controlCenter.topMoneyMoves.invalidate();
      utils.adminDashboard.stats.invalidate();
    },
    onError: (err) => {
      toast.error(`Failed to grant grace period: ${err.message}`);
    },
  });

  const [mutatingId, setMutatingId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="bg-card border border-border/40 p-5 animate-pulse space-y-4">
        <div className="h-4 bg-muted w-1/4 rounded" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-24 bg-muted rounded-lg" />
          <div className="h-24 bg-muted rounded-lg" />
          <div className="h-24 bg-muted rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || !moves || moves.length === 0) {
    return null; // Clarity-gate: do not render vanity empty panel if no moves available
  }

  const handleAction = async (move: typeof moves[number]) => {
    if (move.type === "membership" && move.cta === "Grant Grace Period") {
      const ok = await confirmDialog({
        title: "Grant 3-day Grace Period?",
        message: `This will override the warning status for ${move.metadata.name || "Unknown"} and mark the membership active for 3 days.`,
        confirmLabel: "Grant Grace Override",
      });
      if (!ok) return;

      setMutatingId(move.id);
      try {
        await grantGrace.mutateAsync({ membershipId: move.id, days: 3 });
      } finally {
        setMutatingId(null);
      }
      return;
    }

    // Default action: navigate to the corresponding admin tab
    navigateToAdminSection(move.targetTab as any);
  };

  return (
    <div className="bg-card border border-border/40 p-5 space-y-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded bg-primary/10">
            <Zap className="w-4 h-4 text-primary" />
          </div>
          <h3 className="text-xs font-bold tracking-widest text-foreground/75 uppercase flex items-center gap-1.5">
            Top 3 Money Moves
            <span className="text-[10px] lowercase font-normal text-muted-foreground">(derived from live opportunities)</span>
          </h3>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60">
          <Sparkles className="w-3 h-3 text-primary/70 animate-pulse" />
          Live Suggestions
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {moves.map((move) => {
          const config = MOVE_CONFIG[move.type] || MOVE_CONFIG.estimate;
          const isMutating = mutatingId === move.id;

          return (
            <div
              key={`${move.type}-${move.id}`}
              className={`flex flex-col justify-between p-4 border rounded-xl hover:shadow-md transition-all duration-200 ${config.color}`}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="p-1 rounded bg-foreground/5">{config.icon}</span>
                    <span className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded uppercase ${config.badge}`}>
                      {move.type}
                    </span>
                  </div>
                  {move.value > 0 && (
                    <span className="text-[11px] font-mono font-bold text-foreground/80">
                      ${move.value.toLocaleString()}
                    </span>
                  )}
                </div>

                <h4 className="text-xs font-semibold text-foreground leading-snug tracking-tight">
                  {move.title}
                </h4>

                <p className="text-[11px] text-muted-foreground leading-normal font-normal">
                  {move.description}
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleAction(move)}
                disabled={isMutating}
                className="mt-4 inline-flex items-center justify-center gap-1.5 w-full py-1.5 px-3 rounded-lg text-[11px] font-semibold bg-foreground/5 hover:bg-foreground/10 text-foreground transition-all duration-150 border border-border/20 disabled:opacity-50"
              >
                {isMutating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    {move.cta}
                    <ChevronRight className="w-3 h-3" />
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
