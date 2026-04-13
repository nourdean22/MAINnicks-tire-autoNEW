/**
 * Estimate + Approval Command System — pipeline view with follow-up automation,
 * stage tracking, and conversion metrics. Warm leads from AI estimator.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Loader2, DollarSign, Car, Clock, Search, TrendingUp, Phone,
  ArrowRight, CheckCircle2, XCircle, MessageSquare, Filter,
  ChevronRight, Send, AlertTriangle, Timer, Eye, Zap,
} from "lucide-react";
import { StatCard, PageHeader, LoadingState, EmptyState } from "./shared";

type PipelineStage = "new" | "contacted" | "quoted" | "booked" | "lost";

const PIPELINE_STAGES: { id: PipelineStage; label: string; color: string; bgColor: string }[] = [
  { id: "new", label: "New", color: "text-blue-400", bgColor: "bg-blue-500/10" },
  { id: "contacted", label: "Contacted", color: "text-amber-400", bgColor: "bg-amber-500/10" },
  { id: "quoted", label: "Quoted", color: "text-purple-400", bgColor: "bg-purple-500/10" },
  { id: "booked", label: "Booked", color: "text-emerald-400", bgColor: "bg-emerald-500/10" },
  { id: "lost", label: "Lost", color: "text-red-400", bgColor: "bg-red-500/10" },
];

function getTimeSince(dateStr: string | Date): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getSlaClass(dateStr: string | Date): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 120) return "text-emerald-400";
  if (mins < 480) return "text-amber-400";
  return "text-red-400";
}

export default function EstimatesSection() {
  const { data: leads, isLoading } = trpc.lead.list.useQuery(undefined, { refetchInterval: 30000 });
  const utils = trpc.useUtils();
  const updateLead = trpc.lead.update.useMutation({
    onSuccess: () => {
      toast.success("Status updated");
      utils.lead.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const [stageFilter, setStageFilter] = useState<PipelineStage | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Estimate-related leads
  const estimateLeads = useMemo(() => {
    if (!leads) return [];
    return leads.filter((l: any) =>
      l.source?.toLowerCase().includes("estimate") ||
      l.source?.toLowerCase().includes("labor") ||
      l.source?.toLowerCase().includes("cost") ||
      l.source?.toLowerCase().includes("pricing")
    );
  }, [leads]);

  // Map lead status to pipeline stage
  const mapStage = (status: string): PipelineStage => {
    switch (status) {
      case "new": return "new";
      case "contacted": return "contacted";
      case "booked": return "booked";
      case "completed": return "booked";
      case "closed": return "lost";
      case "lost": return "lost";
      default: return "new";
    }
  };

  // Pipeline counts
  const pipelineCounts = useMemo(() => {
    const counts: Record<PipelineStage, number> = { new: 0, contacted: 0, quoted: 0, booked: 0, lost: 0 };
    estimateLeads.forEach((l: any) => {
      const stage = mapStage(l.status || "new");
      counts[stage]++;
    });
    return counts;
  }, [estimateLeads]);

  // Filtered and searched
  const filteredLeads = useMemo(() => {
    let result = estimateLeads;
    if (stageFilter !== "all") {
      result = result.filter((l: any) => mapStage(l.status || "new") === stageFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((l: any) =>
        l.name?.toLowerCase().includes(q) ||
        l.phone?.includes(q) ||
        l.vehicle?.toLowerCase().includes(q) ||
        l.problem?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [estimateLeads, stageFilter, searchQuery]);

  // Conversion rate
  const conversionRate = estimateLeads.length > 0
    ? Math.round((pipelineCounts.booked / estimateLeads.length) * 100)
    : 0;

  // Avg time to contact — computed from createdAt vs updatedAt delta
  const avgResponseHours = useMemo(() => {
    const contacted = estimateLeads.filter((l: any) => ["contacted", "booked", "completed"].includes(l.status || "") && l.updatedAt && l.createdAt);
    if (contacted.length === 0) return null;
    const totalHours = contacted.reduce((sum: number, l: any) => {
      const created = new Date(l.createdAt).getTime();
      const updated = new Date(l.updatedAt).getTime();
      return sum + Math.max(0, (updated - created) / (1000 * 60 * 60));
    }, 0);
    const avg = Math.round(totalHours / contacted.length);
    return avg <= 1 ? "< 1h" : avg <= 4 ? `~${avg}h` : `${avg}h`;
  }, [estimateLeads]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-6 h-6 animate-spin text-primary/60" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── HEADER ─── */}
      <div>
        <h2 className="font-bold text-xl text-foreground tracking-tight">Estimate Pipeline</h2>
        <p className="text-muted-foreground text-[12px] mt-1">
          Track AI estimate requests through the approval pipeline — warm leads researching repair costs
        </p>
      </div>

      {/* ─── PIPELINE METRICS ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          label="Total Estimates" value={estimateLeads.length}
          icon={<DollarSign className="w-4 h-4" />} color="text-foreground"
        />
        <StatCard
          label="Awaiting Contact" value={pipelineCounts.new}
          icon={<AlertTriangle className="w-4 h-4" />}
          color={pipelineCounts.new > 0 ? "text-blue-400" : "text-muted-foreground"}
          trend={pipelineCounts.new > 0 ? "up" : "neutral"}
          trendLabel={pipelineCounts.new > 0 ? "Action needed" : "All contacted"}
        />
        <StatCard
          label="In Progress" value={pipelineCounts.contacted + pipelineCounts.quoted}
          icon={<MessageSquare className="w-4 h-4" />} color="text-amber-400"
        />
        <StatCard
          label="Converted" value={pipelineCounts.booked}
          icon={<CheckCircle2 className="w-4 h-4" />} color="text-emerald-400"
          trend={conversionRate > 0 ? "up" : "neutral"}
          trendLabel={`${conversionRate}% rate`}
        />
        <StatCard
          label="Lost" value={pipelineCounts.lost}
          icon={<XCircle className="w-4 h-4" />} color="text-red-400"
        />
      </div>

      {/* ─── PIPELINE VISUALIZATION ─── */}
      <div className="stat-card !p-5">
        <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-4 flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-primary" />
          Pipeline Flow
        </h3>
        <div className="flex items-center gap-1">
          {PIPELINE_STAGES.map((stage, i) => {
            const count = pipelineCounts[stage.id];
            const total = estimateLeads.length || 1;
            const pct = Math.max(Math.round((count / total) * 100), count > 0 ? 8 : 4);
            return (
              <div key={stage.id} className="flex items-center flex-1">
                <button
                  onClick={() => setStageFilter(stageFilter === stage.id ? "all" : stage.id)}
                  className={`flex-1 py-3 px-2 text-center transition-all rounded-sm ${
                    stageFilter === stage.id ? `${stage.bgColor} border border-current/20` : "hover:bg-muted/50"
                  }`}
                >
                  <div className={`text-lg font-bold ${stage.color}`}>{count}</div>
                  <div className="text-[10px] text-muted-foreground font-medium mt-0.5">{stage.label}</div>
                </button>
                {i < PIPELINE_STAGES.length - 1 && (
                  <ChevronRight className="w-3 h-3 text-border shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── ESTIMATE AGING — oldest first, showing time in stage ─── */}
      {estimateLeads.filter((l: any) => l.status === "new" || l.status === "contacted").length > 0 && (
        <div className="stat-card !p-5">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-3 flex items-center gap-2">
            <Timer className="w-3.5 h-3.5 text-amber-400" />
            Aging Estimates — Needs Follow-Up
          </h3>
          <div className="space-y-2">
            {estimateLeads
              .filter((l: any) => l.status === "new" || l.status === "contacted")
              .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
              .slice(0, 8)
              .map((lead: any) => {
                const ageMs = Date.now() - new Date(lead.createdAt).getTime();
                const ageHours = Math.floor(ageMs / 3600000);
                const ageDays = Math.floor(ageHours / 24);
                const maxBarDays = 14;
                const barPct = Math.min(100, (ageDays / maxBarDays) * 100 || (ageHours / (maxBarDays * 24)) * 100);
                const barColor = ageDays > 7 ? "bg-red-500" : ageDays > 3 ? "bg-amber-500" : ageDays > 1 ? "bg-blue-400" : "bg-emerald-400";
                const valueDollars = lead.estimatedValueCents ? (lead.estimatedValueCents / 100) : 0;

                return (
                  <div key={lead.id} className="flex items-center gap-3 text-[12px]">
                    <div className="w-20 shrink-0">
                      <span className={`font-mono font-bold ${ageDays > 3 ? "text-red-400" : ageDays > 1 ? "text-amber-400" : "text-foreground/70"}`}>
                        {ageDays > 0 ? `${ageDays}d ${ageHours % 24}h` : `${ageHours}h`}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-foreground truncate">{lead.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          lead.status === "new" ? "bg-blue-500/10 text-blue-400" : "bg-amber-500/10 text-amber-400"
                        }`}>{lead.status}</span>
                        {valueDollars > 0 && <span className="text-primary font-mono">${valueDollars.toFixed(0)}</span>}
                      </div>
                      {/* Aging bar */}
                      <div className="h-1.5 bg-muted/30 rounded-full mt-1 overflow-hidden">
                        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${Math.max(5, barPct)}%` }} />
                      </div>
                    </div>
                    {lead.phone && (
                      <a href={`tel:${lead.phone}`} className="shrink-0 text-primary hover:underline flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                      </a>
                    )}
                    <button
                      onClick={() => updateLead.mutate({ id: lead.id, status: lead.status === "new" ? "contacted" : "booked" })}
                      className="shrink-0 px-2 py-1 bg-primary/10 text-primary text-[10px] font-bold rounded hover:bg-primary/20 transition-colors"
                    >
                      {lead.status === "new" ? "Mark Called" : "Mark Booked"}
                    </button>
                  </div>
                );
              })}
          </div>
          {avgResponseHours && (
            <div className="mt-3 text-[10px] text-muted-foreground">
              Avg response time: <span className="font-mono font-bold text-foreground">{avgResponseHours}</span> ·
              Pipeline value: <span className="font-mono font-bold text-primary">
                ${estimateLeads
                  .filter((l: any) => l.status !== "booked" && l.status !== "lost")
                  .reduce((s: number, l: any) => s + (l.estimatedValueCents || 0) / 100, 0)
                  .toFixed(0)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ─── SEARCH + FILTER ─── */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, phone, vehicle..."
            className="w-full bg-background border border-border/30 pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
          />
        </div>
        {stageFilter !== "all" && (
          <button
            onClick={() => setStageFilter("all")}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <XCircle className="w-3 h-3" /> Clear filter
          </button>
        )}
      </div>

      {/* ─── ESTIMATE LIST ─── */}
      <div className="space-y-2">
        {filteredLeads.length === 0 ? (
          <div className="stat-card !p-8 text-center">
            <Search className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {searchQuery || stageFilter !== "all" ? "No estimates match your filter" : "No estimate requests yet"}
            </p>
            <p className="text-[11px] text-muted-foreground/50 mt-1">
              When customers use the AI Estimator, their requests appear here
            </p>
          </div>
        ) : (
          filteredLeads.map((lead: any) => {
            const stage = mapStage(lead.status || "new");
            const stageCfg = PIPELINE_STAGES.find(s => s.id === stage) || PIPELINE_STAGES[0];
            return (
              <div key={lead.id} className="stat-card !p-4 hover:!border-primary/30 transition-all">
                <div className="flex items-start gap-3">
                  {/* Vehicle icon + info */}
                  <div className="shrink-0 mt-0.5">
                    <div className="w-8 h-8 bg-muted/50 flex items-center justify-center rounded">
                      <Car className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>

                  {/* Main content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-foreground truncate">
                        {lead.name || "Anonymous"}
                      </span>
                      <span className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded ${stageCfg.bgColor} ${stageCfg.color}`}>
                        {stageCfg.label.toUpperCase()}
                      </span>
                      {lead.urgencyScore && lead.urgencyScore >= 4 && (
                        <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded text-red-400 bg-red-500/10">
                          URGENT
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      {lead.vehicle && (
                        <span className="flex items-center gap-1">
                          <Car className="w-3 h-3" /> {lead.vehicle}
                        </span>
                      )}
                      {lead.problem && (
                        <span className="truncate max-w-[200px]">{lead.problem}</span>
                      )}
                    </div>

                    {/* Timestamp */}
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`text-[10px] font-mono ${getSlaClass(lead.createdAt)}`}>
                        <Timer className="w-2.5 h-2.5 inline mr-0.5" />
                        {getTimeSince(lead.createdAt)}
                      </span>
                      <span className="text-[10px] text-muted-foreground/50">
                        {new Date(lead.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {lead.phone && (
                      <a
                        href={`tel:${lead.phone}`}
                        className="p-1.5 text-foreground/30 hover:text-emerald-400 hover:bg-emerald-500/10 rounded transition-all"
                        title="Call customer"
                      >
                        <Phone className="w-3.5 h-3.5" />
                      </a>
                    )}
                    {lead.phone && (
                      <a
                        href={`sms:${lead.phone}`}
                        className="p-1.5 text-foreground/30 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-all"
                        title="Text customer"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                      </a>
                    )}
                    {/* Stage progression buttons */}
                    {stage === "new" && (
                      <button
                        onClick={() => updateLead.mutate({ id: lead.id, status: "contacted" })}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 rounded transition-all"
                        disabled={updateLead.isPending}
                      >
                        <Send className="w-3 h-3" /> Mark Contacted
                      </button>
                    )}
                    {stage === "contacted" && (
                      <button
                        onClick={() => updateLead.mutate({ id: lead.id, status: "booked" })}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded transition-all"
                        disabled={updateLead.isPending}
                      >
                        <CheckCircle2 className="w-3 h-3" /> Mark Booked
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ─── CONVERSION INSIGHTS ─── */}
      <div className="stat-card !border-primary/15 !p-5">
        <h3 className="text-xs font-semibold text-primary tracking-wide uppercase mb-3 flex items-center gap-2">
          <Zap className="w-3.5 h-3.5" />
          Conversion Insights
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <span className="text-[11px] text-muted-foreground block mb-1">Conversion Rate</span>
            <span className={`text-2xl font-bold tracking-tight ${conversionRate >= 20 ? "text-emerald-400" : conversionRate >= 10 ? "text-amber-400" : "text-foreground"}`}>
              {conversionRate}%
            </span>
          </div>
          <div>
            <span className="text-[11px] text-muted-foreground block mb-1">Avg Response</span>
            <span className="text-2xl font-bold text-foreground tracking-tight">{avgResponseHours || "—"}</span>
          </div>
          <div>
            <span className="text-[11px] text-muted-foreground block mb-1">Avg Ticket Value</span>
            <span className="text-2xl font-bold text-primary tracking-tight">$350</span>
            <span className="text-[10px] text-muted-foreground block">industry avg</span>
          </div>
          <div>
            <span className="text-[11px] text-muted-foreground block mb-1">Pipeline Value</span>
            <span className="text-2xl font-bold text-emerald-400 tracking-tight">
              ${((pipelineCounts.new + pipelineCounts.contacted + pipelineCounts.quoted) * 350).toLocaleString()}
            </span>
            <span className="text-[10px] text-muted-foreground block">potential revenue</span>
          </div>
        </div>
      </div>
    </div>
  );
}
