/**
 * LoyaltyAdminSection — extracted from Admin.tsx for maintainability.
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
  Loader2, Trophy, Gift, Star, Phone
} from "lucide-react";

export default function LoyaltyAdminSection() {
  const [phone, setPhone] = useState("");
  const [points, setPoints] = useState("");
  const [desc, setDesc] = useState("");

  const awardPoints = trpc.loyalty.awardPoints.useMutation({
    onSuccess: () => { setPhone(""); setPoints(""); setDesc(""); toast.success("Points awarded"); },
    onError: (err: any) => toast.error(err.message),
  });

  const { data: rewards, isLoading: rewardsLoading } = trpc.loyalty.rewards.useQuery();
  const utils = trpc.useUtils();
  const [rewardForm, setRewardForm] = useState({ title: "", description: "", pointsCost: "", discountValue: "" });
  const [showRewardForm, setShowRewardForm] = useState(false);

  const createReward = trpc.loyalty.createReward.useMutation({
    onSuccess: () => { utils.loyalty.rewards.invalidate(); setShowRewardForm(false); setRewardForm({ title: "", description: "", pointsCost: "", discountValue: "" }); toast.success("Reward created"); },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <div className="space-y-8">
      <h2 className="font-bold text-xl text-foreground tracking-wider">LOYALTY PROGRAM</h2>

      {/* Award Points */}
      <div className="bg-card border border-border/30 p-5">
        <h3 className="font-bold text-sm text-foreground tracking-[-0.01em] mb-4">AWARD POINTS</h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <input placeholder="Customer Phone" value={phone} onChange={e => setPhone(e.target.value)} className="bg-background border border-border/30 px-3 py-2 text-sm text-foreground" />
          <input placeholder="Points" type="number" value={points} onChange={e => setPoints(e.target.value)} className="bg-background border border-border/30 px-3 py-2 text-sm text-foreground" />
          <input placeholder="Description" value={desc} onChange={e => setDesc(e.target.value)} className="bg-background border border-border/30 px-3 py-2 text-sm text-foreground" />
          <button onClick={() => awardPoints.mutate({ userId: 0, points: parseInt(points) || 0, description: desc || "Manual award" })} disabled={awardPoints.isPending || !phone || !points} className="px-4 py-2 bg-primary text-primary-foreground font-bold text-xs tracking-wide disabled:opacity-50">
            {awardPoints.isPending ? "AWARDING..." : "AWARD"}
          </button>
        </div>
      </div>

      {/* Manage Rewards */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm text-foreground tracking-wider">REWARD CATALOG</h3>
          <button onClick={() => setShowRewardForm(!showRewardForm)} className="px-3 py-1.5 bg-primary text-primary-foreground font-bold text-xs tracking-wide">
            {showRewardForm ? "CANCEL" : "+ ADD REWARD"}
          </button>
        </div>

        {showRewardForm && (
          <div className="bg-card border border-border/30 p-5 space-y-4 mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <input placeholder="Reward Title" value={rewardForm.title} onChange={e => setRewardForm(f => ({ ...f, title: e.target.value }))} className="bg-background border border-border/30 px-3 py-2 text-sm text-foreground" />
              <input placeholder="Description" value={rewardForm.description} onChange={e => setRewardForm(f => ({ ...f, description: e.target.value }))} className="bg-background border border-border/30 px-3 py-2 text-sm text-foreground" />
              <input placeholder="Points Cost" type="number" value={rewardForm.pointsCost} onChange={e => setRewardForm(f => ({ ...f, pointsCost: e.target.value }))} className="bg-background border border-border/30 px-3 py-2 text-sm text-foreground" />
              <input placeholder="Discount Value ($)" type="number" value={rewardForm.discountValue} onChange={e => setRewardForm(f => ({ ...f, discountValue: e.target.value }))} className="bg-background border border-border/30 px-3 py-2 text-sm text-foreground" />
            </div>
            <button onClick={() => createReward.mutate({ title: rewardForm.title, description: rewardForm.description, pointsCost: parseInt(rewardForm.pointsCost) || 0, rewardValue: parseInt(rewardForm.discountValue) || 0 })} disabled={createReward.isPending || !rewardForm.title || !rewardForm.pointsCost} className="px-4 py-2 bg-primary text-primary-foreground font-bold text-xs tracking-wide disabled:opacity-50">
              {createReward.isPending ? "CREATING..." : "CREATE REWARD"}
            </button>
          </div>
        )}

        {rewardsLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : (rewards ?? []).length === 0 ? (
          <div className="text-center py-8 text-foreground/40">
            <Gift className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="text-[13px]">No rewards configured. Add one to start the loyalty program.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {(rewards ?? []).map((r: any) => (
              <div key={r.id} className="bg-card border border-border/30 p-4 flex items-center justify-between">
                <div>
                  <span className="font-bold text-foreground text-sm">{r.title}</span>
                  <p className="text-[12px] text-foreground/40">{r.description}</p>
                </div>
                <div className="text-right">
                  <span className="font-bold text-primary text-sm">{r.pointsCost} pts</span>
                  <p className="text-[12px] text-foreground/40">${r.discountValue} off</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── FOLLOW-UPS SECTION ─────────────────────────────────

