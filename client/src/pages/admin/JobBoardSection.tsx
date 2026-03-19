/**
 * JobBoardSection — extracted from Admin.tsx for maintainability.
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
  ClipboardList, Clock, Loader2, MapPin, Wrench
} from "lucide-react";

export default function JobBoardSection() {
  const { data: bookingsData, isLoading } = trpc.booking.list.useQuery();
  const jobs = bookingsData ?? [];
  const utils = trpc.useUtils();

  const updateStage = trpc.booking.updateStage.useMutation({
    onSuccess: () => { utils.booking.list.invalidate(); toast.success("Stage updated"); },
    onError: (err: any) => toast.error(err.message),
  });

  const statusColors: Record<string, string> = {
    received: "text-blue-400 bg-blue-500/10",
    inspecting: "text-purple-400 bg-purple-500/10",
    "waiting-parts": "text-amber-400 bg-amber-500/10",
    "in-progress": "text-primary bg-primary/10",
    "quality-check": "text-cyan-400 bg-cyan-500/10",
    ready: "text-emerald-400 bg-emerald-500/10",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-heading font-bold text-xl text-foreground tracking-wider">JOB BOARD</h2>
        <p className="font-mono text-xs text-foreground/40">Jobs are created from bookings. Update stages here.</p>
      </div>



      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (jobs ?? []).length === 0 ? (
        <div className="text-center py-12 text-foreground/40">
          <ClipboardList className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="font-mono text-sm">No active jobs. Create one to start tracking.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job: any) => (
            <div key={job.id} className="bg-card border border-border/30 p-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-heading font-bold text-foreground text-sm">{job.name}</span>
                    <span className="font-mono text-xs text-foreground/40">{job.phone}</span>
                    {job.referenceCode && <span className="font-mono text-[10px] text-nick-teal">#{job.referenceCode}</span>}
                  </div>
                  <p className="font-mono text-xs text-foreground/50">{job.vehicle || "No vehicle"} — {job.service}</p>
                  {job.notes && <p className="font-mono text-xs text-foreground/30 mt-1">{job.notes}</p>}
                  <p className="font-mono text-[10px] text-foreground/20 mt-1">
                    {new Date(job.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <select
                  value={job.stage || "received"}
                  onChange={(e) => updateStage.mutate({ id: job.id, stage: e.target.value as any })}
                  className={`px-2 py-1 text-xs font-mono border-0 ${statusColors[job.stage || "received"] || "text-foreground/50"}`}
                >
                  <option value="received">RECEIVED</option>
                  <option value="inspecting">INSPECTING</option>
                  <option value="waiting-parts">WAITING PARTS</option>
                  <option value="in-progress">IN PROGRESS</option>
                  <option value="quality-check">QUALITY CHECK</option>
                  <option value="ready">READY</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── INSPECTIONS SECTION ────────────────────────────────

