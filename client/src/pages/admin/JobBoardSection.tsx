/**
 * JobBoardSection — Advanced Kanban-style job board with technician assignment,
 * time tracking, and workload balancing.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  ClipboardList, Clock, Loader2, Wrench, User, Play, Square, Plus, X, Timer, Users, ChevronDown
} from "lucide-react";

const STAGES = [
  { key: "received", label: "RECEIVED", color: "border-blue-500/50 bg-blue-500/5", badge: "bg-blue-500/20 text-blue-400" },
  { key: "inspecting", label: "INSPECTING", color: "border-purple-500/50 bg-purple-500/5", badge: "bg-purple-500/20 text-purple-400" },
  { key: "waiting-parts", label: "WAITING PARTS", color: "border-amber-500/50 bg-amber-500/5", badge: "bg-amber-500/20 text-amber-400" },
  { key: "in-progress", label: "IN PROGRESS", color: "border-primary/50 bg-primary/5", badge: "bg-primary/20 text-primary" },
  { key: "quality-check", label: "QC", color: "border-cyan-500/50 bg-cyan-500/5", badge: "bg-cyan-500/20 text-cyan-400" },
  { key: "ready", label: "READY", color: "border-emerald-500/50 bg-emerald-500/5", badge: "bg-emerald-500/20 text-emerald-400" },
] as const;

type StageKey = typeof STAGES[number]["key"];

export default function JobBoardSection() {
  const { data: bookingsData, isLoading } = trpc.booking.list.useQuery();
  const { data: workload } = trpc.jobAssignments.workload.useQuery();
  const { data: techList } = trpc.technicians.list.useQuery();
  const utils = trpc.useUtils();
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [assigningBookingId, setAssigningBookingId] = useState<number | null>(null);

  const updateStage = trpc.booking.updateStage.useMutation({
    onSuccess: () => { utils.booking.list.invalidate(); toast.success("Stage updated"); },
    onError: (err: any) => toast.error(err.message),
  });

  const assignTech = trpc.jobAssignments.assign.useMutation({
    onSuccess: () => {
      utils.jobAssignments.workload.invalidate();
      utils.booking.list.invalidate();
      setAssigningBookingId(null);
      toast.success("Technician assigned");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const startTimer = trpc.jobAssignments.startTimer.useMutation({
    onSuccess: () => { utils.jobAssignments.workload.invalidate(); toast.success("Timer started"); },
  });

  const stopTimer = trpc.jobAssignments.stopTimer.useMutation({
    onSuccess: () => { utils.jobAssignments.workload.invalidate(); toast.success("Timer stopped"); },
  });

  const jobs = useMemo(() => {
    if (!bookingsData) return [];
    return bookingsData.filter((b: any) => b.status !== "cancelled");
  }, [bookingsData]);

  const jobsByStage = useMemo(() => {
    const map: Record<string, any[]> = {};
    STAGES.forEach(s => { map[s.key] = []; });
    jobs.forEach((j: any) => {
      const stage = j.stage || "received";
      if (map[stage]) map[stage].push(j);
    });
    return map;
  }, [jobs]);

  // Technician workload summary
  const techWorkloadMap = useMemo(() => {
    const map: Record<number, { name: string; activeJobs: number }> = {};
    workload?.forEach((t: any) => {
      map[t.id] = { name: t.name, activeJobs: t.activeJobs };
    });
    return map;
  }, [workload]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="font-heading font-bold text-xl text-foreground tracking-wider">ADVANCED JOB BOARD</h2>
          <p className="font-mono text-xs text-foreground/40 mt-1">
            {jobs.length} active jobs across {STAGES.length} stages
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode("kanban")}
            className={`px-3 py-1.5 font-mono text-xs tracking-wider ${viewMode === "kanban" ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/60"}`}
          >
            KANBAN
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`px-3 py-1.5 font-mono text-xs tracking-wider ${viewMode === "list" ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/60"}`}
          >
            LIST
          </button>
        </div>
      </div>

      {/* Technician Workload Bar */}
      {workload && workload.length > 0 && (
        <div className="bg-card border border-border/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-primary" />
            <span className="font-heading font-bold text-sm text-foreground tracking-wider">TECHNICIAN WORKLOAD</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {workload.map((t: any) => (
              <div key={t.id} className="flex items-center gap-2 bg-background/50 px-3 py-2 border border-border/20">
                <div className="w-7 h-7 bg-primary/20 flex items-center justify-center">
                  <span className="font-heading font-bold text-xs text-primary">{t.name.charAt(0)}</span>
                </div>
                <div>
                  <span className="font-mono text-xs text-foreground">{t.name}</span>
                  <span className={`ml-2 font-mono text-[10px] ${t.activeJobs > 3 ? "text-red-400" : t.activeJobs > 1 ? "text-amber-400" : "text-emerald-400"}`}>
                    {t.activeJobs} job{t.activeJobs !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Kanban View */}
      {viewMode === "kanban" ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {STAGES.map(stage => (
            <div key={stage.key} className={`border ${stage.color} min-h-[200px]`}>
              <div className="p-3 border-b border-border/20">
                <div className="flex items-center justify-between">
                  <span className={`font-mono text-[10px] tracking-widest font-bold px-2 py-0.5 ${stage.badge}`}>
                    {stage.label}
                  </span>
                  <span className="font-mono text-[10px] text-foreground/30">
                    {jobsByStage[stage.key]?.length || 0}
                  </span>
                </div>
              </div>
              <div className="p-2 space-y-2">
                {(jobsByStage[stage.key] || []).map((job: any) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    stage={stage.key}
                    onStageChange={(newStage) => updateStage.mutate({ id: job.id, stage: newStage })}
                    onAssign={() => setAssigningBookingId(job.id)}
                    techWorkload={techWorkloadMap}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* List View */
        <div className="space-y-2">
          {jobs.map((job: any) => (
            <div key={job.id} className="bg-card border border-border/30 p-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-heading font-bold text-foreground text-sm">{job.name}</span>
                    <span className="font-mono text-xs text-foreground/40">{job.phone}</span>
                    {job.referenceCode && <span className="font-mono text-[10px] text-cyan-400">#{job.referenceCode}</span>}
                  </div>
                  <p className="font-mono text-xs text-foreground/50">{job.vehicle || "No vehicle"} — {job.service}</p>
                  {job.adminNotes && <p className="font-mono text-xs text-foreground/30 mt-1">{job.adminNotes}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAssigningBookingId(job.id)}
                    className="p-1.5 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    title="Assign Technician"
                  >
                    <User className="w-3.5 h-3.5" />
                  </button>
                  <select
                    value={job.stage || "received"}
                    onChange={(e) => updateStage.mutate({ id: job.id, stage: e.target.value as any })}
                    className="px-2 py-1 text-xs font-mono bg-card border border-border/30 text-foreground"
                  >
                    {STAGES.map(s => (
                      <option key={s.key} value={s.key}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Assign Technician Modal */}
      {assigningBookingId !== null && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setAssigningBookingId(null)}>
          <div className="bg-card border border-border/30 p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-bold text-foreground tracking-wider">ASSIGN TECHNICIAN</h3>
              <button onClick={() => setAssigningBookingId(null)} className="text-foreground/40 hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2">
              {(techList || []).map((tech: any) => (
                <button
                  key={tech.id}
                  onClick={() => assignTech.mutate({ bookingId: assigningBookingId, technicianId: tech.id })}
                  className="w-full flex items-center gap-3 p-3 bg-background/50 border border-border/20 hover:border-primary/50 transition-colors text-left"
                >
                  <div className="w-8 h-8 bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <span className="font-heading font-bold text-sm text-primary">{tech.name.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-heading font-bold text-sm text-foreground block">{tech.name}</span>
                    <span className="font-mono text-[10px] text-foreground/40">{tech.title}</span>
                  </div>
                  <span className="font-mono text-[10px] text-foreground/30">
                    {techWorkloadMap[tech.id]?.activeJobs || 0} jobs
                  </span>
                </button>
              ))}
              {(!techList || techList.length === 0) && (
                <p className="text-center py-4 font-mono text-xs text-foreground/40">
                  No technicians found. Add technicians in the Technicians section first.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── JOB CARD (Kanban) ──────────────────────────────────
function JobCard({
  job,
  stage,
  onStageChange,
  onAssign,
  techWorkload,
}: {
  job: any;
  stage: string;
  onStageChange: (stage: StageKey) => void;
  onAssign: () => void;
  techWorkload: Record<number, { name: string; activeJobs: number }>;
}) {
  const [showStageMenu, setShowStageMenu] = useState(false);
  const stageIndex = STAGES.findIndex(s => s.key === stage);

  return (
    <div className="bg-card border border-border/20 p-3 hover:border-border/40 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="font-heading font-bold text-xs text-foreground leading-tight">{job.name}</span>
        {job.urgency === "emergency" && (
          <span className="font-mono text-[8px] bg-red-500/20 text-red-400 px-1.5 py-0.5 flex-shrink-0">URGENT</span>
        )}
      </div>
      <p className="font-mono text-[10px] text-foreground/50 mb-1 truncate">{job.service}</p>
      <p className="font-mono text-[10px] text-foreground/30 truncate">{job.vehicle || "—"}</p>
      {job.referenceCode && (
        <p className="font-mono text-[9px] text-cyan-400/60 mt-1">#{job.referenceCode}</p>
      )}

      {/* Quick actions */}
      <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border/10">
        <button
          onClick={onAssign}
          className="p-1 text-foreground/30 hover:text-primary transition-colors"
          title="Assign Tech"
        >
          <User className="w-3 h-3" />
        </button>
        {/* Move to next stage */}
        {stageIndex < STAGES.length - 1 && (
          <button
            onClick={() => onStageChange(STAGES[stageIndex + 1].key)}
            className="ml-auto flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary font-mono text-[9px] tracking-wider hover:bg-primary/20 transition-colors"
          >
            NEXT <ChevronDown className="w-2.5 h-2.5 -rotate-90" />
          </button>
        )}
        {stageIndex === STAGES.length - 1 && (
          <span className="ml-auto font-mono text-[9px] text-emerald-400 tracking-wider">DONE</span>
        )}
      </div>
    </div>
  );
}
