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
  CheckCircle2, ChevronRight, Clock, Gift, Loader2, Phone, Users
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

  return (
    <div className="space-y-6">
      <h2 className="font-bold text-xl text-foreground tracking-wider">REFERRAL TRACKING</h2>

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

