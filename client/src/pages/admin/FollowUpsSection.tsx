/**
 * FollowUpsSection — extracted from Admin.tsx for maintainability.
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
  Loader2, Send, RefreshCw, CheckCircle2, Clock
} from "lucide-react";

export default function FollowUpsSection() {
  const runFollowUps = trpc.followUps.run.useMutation({
    onSuccess: (data) => { toast.success(`Processed ${data.total} follow-ups`); },
    onError: (err: any) => toast.error(err.message),
  });

  // Follow-ups don't have a pending query or markSent yet — show run button only
  const isLoading = false;
  const followups: any[] = [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-heading font-bold text-xl text-foreground tracking-wider">FOLLOW-UP MANAGER</h2>
        <button onClick={() => runFollowUps.mutate()} disabled={runFollowUps.isPending} className="px-4 py-2 bg-primary text-primary-foreground font-heading font-bold text-xs tracking-wider uppercase disabled:opacity-50">
          {runFollowUps.isPending ? "PROCESSING..." : "RUN FOLLOW-UPS"}
        </button>
      </div>

      <p className="font-mono text-xs text-foreground/40">
        Follow-ups are generated automatically when bookings are completed. Click "Run Follow-Ups" to process pending items.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (followups ?? []).length === 0 ? (
        <div className="text-center py-12 text-foreground/40">
          <Send className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="font-mono text-sm">No pending follow-ups. They are generated when bookings are completed.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(followups ?? []).map((fu: any) => (
            <div key={fu.id} className="bg-card border border-border/30 p-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-heading font-bold text-foreground text-sm">{fu.customerName || "Customer"}</span>
                    <span className={`px-2 py-0.5 text-[10px] font-mono ${
                      fu.type === "thank-you" ? "text-blue-400 bg-blue-500/10" :
                      fu.type === "review-request" ? "text-primary bg-primary/10" :
                      "text-emerald-400 bg-emerald-500/10"
                    }`}>{fu.type.toUpperCase()}</span>
                  </div>
                  <p className="font-mono text-xs text-foreground/40">
                    Scheduled: {new Date(fu.scheduledAt).toLocaleDateString()} • {fu.channel}
                  </p>
                </div>
                <span className="px-3 py-1.5 bg-foreground/5 text-foreground/40 font-mono text-xs">
                  PENDING
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SMS SECTION ─────────────────────────────────────

