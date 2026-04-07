/**
 * ReferralsSection — extracted from Admin.tsx for maintainability.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import { BUSINESS } from "@shared/business";
import {
  StatCard, UrgencyBadge, ActivityIcon, StatusDot,
  BOOKING_STATUS_CONFIG, LEAD_STATUS_CONFIG, TIME_LABELS, CHART_COLORS,
  type BookingStatus, type LeadStatus,
} from "./shared";
import {
  CheckCircle2, ChevronRight, Clock, Gift, Loader2, Phone, Users, TrendingUp, ArrowRight
} from "lucide-react";

export default function ReferralsSection() {
  const { data: referrals, isLoading } = trpc.referrals.all.useQuery();
  const utils = trpc.useUtils();

  const updateStatus = trpc.referrals.updateStatus.useMutation({
    onSuccess: () => { utils.referrals.all.invalidate(); toast.success("Status updated"); },
  });

  const statusColors: Record<string, string> = {
    pending: "text-blue-400 bg-blue-500/10",
    contacted: "text-primary bg-primary/10",
    redeemed: "text-emerald-400 bg-emerald-500/10",
    expired: "text-foreground/40 bg-foreground/5",
  };

  const stats = useMemo(() => {
    const all = referrals ?? [];
    const total = all.length;
    const contacted = all.filter((r: any) => r.status === "contacted" || r.status === "redeemed").length;
    const redeemed = all.filter((r: any) => r.status === "redeemed").length;
    const pending = all.filter((r: any) => r.status === "pending").length;
    const contactedPct = total > 0 ? Math.round((contacted / total) * 100) : 0;
    const redeemedPct = total > 0 ? Math.round((redeemed / total) * 100) : 0;
    const conversionRate = total > 0 ? Math.round((redeemed / total) * 100) : 0;
    return { total, contacted, redeemed, pending, contactedPct, redeemedPct, conversionRate };
  }, [referrals]);

  const conversionColor = stats.conversionRate >= 20 ? "text-emerald-400" : stats.conversionRate >= 10 ? "text-amber-400" : "text-red-400";

  return (
    <div className="space-y-6">
      <h2 className="font-bold text-xl text-foreground tracking-wider">REFERRAL TRACKING</h2>

      {/* Analytics Strip */}
      {!isLoading && stats.total > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="TOTAL REFERRALS" value={stats.total} icon={<Users className="w-4 h-4" />} />
            <StatCard label="CONTACTED" value={`${stats.contactedPct}%`} icon={<Phone className="w-4 h-4" />} />
            <StatCard label="REDEEMED" value={`${stats.redeemedPct}%`} icon={<Gift className="w-4 h-4" />} />
            <StatCard label="CONVERSION RATE" value={`${stats.conversionRate}%`} icon={<TrendingUp className="w-4 h-4" />} color={conversionColor} />
          </div>

          {/* Funnel */}
          <div className="bg-card border border-border/30 p-4">
            <h3 className="font-bold text-xs text-foreground/60 tracking-wider mb-3">REFERRAL FUNNEL</h3>
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 text-center">
                <div className="text-2xl font-bold text-foreground">{stats.total}</div>
                <div className="text-[10px] text-foreground/40 tracking-wide mt-1">SUBMITTED</div>
              </div>
              <ArrowRight className="w-4 h-4 text-foreground/20 shrink-0" />
              <div className="flex-1 text-center">
                <div className="text-2xl font-bold text-primary">{stats.contacted}</div>
                <div className="text-[10px] text-foreground/40 tracking-wide mt-1">CONTACTED</div>
              </div>
              <ArrowRight className="w-4 h-4 text-foreground/20 shrink-0" />
              <div className="flex-1 text-center">
                <div className={`text-2xl font-bold ${conversionColor}`}>{stats.redeemed}</div>
                <div className="text-[10px] text-foreground/40 tracking-wide mt-1">REDEEMED</div>
              </div>
            </div>
          </div>
        </>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (referrals ?? []).length === 0 ? (
        <div className="text-center py-12 text-foreground/40">
          <Users className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-[13px]">No referrals yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(referrals ?? []).map((r: any) => (
            <div key={r.id} className="bg-card border border-border/30 p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-bold text-foreground text-sm">{r.referrerName}</span>
                    <ChevronRight className="w-4 h-4 text-foreground/30" />
                    <span className="font-bold text-foreground text-sm">{r.refereeName}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-foreground/40">
                    <span>{r.referrerPhone}</span>
                    <span>→</span>
                    <span>{r.refereePhone}</span>
                    <span>•</span>
                    <span>{new Date(r.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <select
                  value={r.status}
                  onChange={(e) => updateStatus.mutate({ id: r.id, status: e.target.value as "pending" | "visited" | "redeemed" | "expired" })}
                  className={`px-2 py-1 text-xs border-0 ${statusColors[r.status] || "text-foreground/50"}`}
                >
                  <option value="pending">PENDING</option>
                  <option value="contacted">CONTACTED</option>
                  <option value="redeemed">REDEEMED</option>
                  <option value="expired">EXPIRED</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── JOB BOARD SECTION ──────────────────────────────────

