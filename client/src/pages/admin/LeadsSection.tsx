/**
 * LeadsSection — extracted from Admin.tsx for maintainability.
 * Includes Kanban board view and traditional list view.
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
  AlertTriangle, Car, CheckCircle2, ChevronRight, ExternalLink, FileSpreadsheet, Filter, Hash, Loader2, Mail, MessageSquare, Phone, PhoneCall, RefreshCw, Search, UserCheck, Users, Wrench, XCircle, Zap, LayoutGrid, List
} from "lucide-react";

// ── SLA Timer for leads ──
function LeadAge({ dateStr }: { dateStr: string | Date }) {
  const created = new Date(dateStr);
  const diffMs = Date.now() - created.getTime();
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(hours / 24);

  let label: string;
  if (hours < 1) label = `${Math.floor(diffMs / 60000)}m`;
  else if (hours < 24) label = `${hours}h`;
  else label = `${days}d`;

  // SLA: green <4h, yellow 4-24h, red >24h
  const color = hours < 4
    ? "text-emerald-400 bg-emerald-500/10"
    : hours < 24
    ? "text-amber-400 bg-amber-500/10"
    : "text-red-400 bg-red-500/10 animate-pulse";

  return (
    <span className={`inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-mono font-bold tracking-wide rounded ${color}`}>
      ⏱ {label}
    </span>
  );
}

const KANBAN_COLUMNS: { status: LeadStatus; label: string; color: string }[] = [
  { status: "new", label: "New", color: "bg-blue-500/10 border-blue-500/30" },
  { status: "contacted", label: "Contacted", color: "bg-amber-500/10 border-amber-500/30" },
  { status: "booked", label: "Booked", color: "bg-emerald-500/10 border-emerald-500/30" },
  { status: "completed", label: "Completed", color: "bg-purple-500/10 border-purple-500/30" },
  { status: "lost", label: "Lost", color: "bg-red-500/10 border-red-500/30" },
];

function KanbanLeadCard({ lead, onUpdate }: {
  lead: any;
  onUpdate: (id: number, status: LeadStatus) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const currentStatusIdx = KANBAN_COLUMNS.findIndex(c => c.status === lead.status);
  const availableTransitions = KANBAN_COLUMNS.filter((_, i) => i !== currentStatusIdx);

  return (
    <div className="bg-background border border-border/50 p-3 text-[12px] hover:border-primary/50 transition-colors">
      <div className="space-y-2">
        {/* Name and Urgency */}
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-bold text-foreground">{lead.name}</h4>
          <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold tracking-wider ${
            (lead.urgencyScore ?? 0) >= 4
              ? "bg-red-500/20 text-red-400"
              : (lead.urgencyScore ?? 0) >= 3
              ? "bg-amber-500/20 text-amber-400"
              : "bg-foreground/10 text-foreground/50"
          }`}>
            {lead.urgencyScore ?? 3}/5
          </span>
        </div>

        {/* Phone */}
        <div className="flex items-center gap-2 text-foreground/70">
          <Phone className="w-3 h-3 text-primary shrink-0" />
          <a href={`tel:${lead.phone}`} className="hover:text-primary">{lead.phone}</a>
        </div>

        {/* Vehicle */}
        {lead.vehicle && (
          <div className="flex items-center gap-2 text-foreground/70">
            <Car className="w-3 h-3 text-primary shrink-0" />
            <span>{lead.vehicle}</span>
          </div>
        )}

        {/* Problem */}
        {lead.problem && (
          <div className="flex items-start gap-2 text-foreground/60">
            <MessageSquare className="w-3 h-3 text-primary shrink-0 mt-0.5" />
            <p className="line-clamp-2">{lead.problem}</p>
          </div>
        )}

        {/* Contact Notes */}
        {lead.contactNotes && (
          <div className="flex items-start gap-2 text-emerald-400 text-[11px] bg-emerald-500/10 p-1.5">
            <UserCheck className="w-3 h-3 shrink-0 mt-0.5" />
            <span>{lead.contactNotes}</span>
          </div>
        )}

        {/* Age + SLA Timer */}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-foreground/40">{new Date(lead.createdAt).toLocaleDateString()}</span>
          <LeadAge dateStr={lead.createdAt} />
        </div>
      </div>

      {/* Status dropdown */}
      <div className="mt-3 relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="w-full px-2 py-1.5 text-[11px] font-bold tracking-wide bg-card border border-border/30 text-foreground/70 hover:text-foreground transition-colors text-left"
        >
          Change Status ▼
        </button>
        {showMenu && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border/50 z-10 divide-y divide-border/30">
            {availableTransitions.map(col => (
              <button
                key={col.status}
                onClick={() => {
                  onUpdate(lead.id, col.status);
                  setShowMenu(false);
                }}
                className="w-full px-2 py-1.5 text-[11px] font-bold text-foreground/70 hover:text-primary hover:bg-primary/10 transition-colors text-left"
              >
                {col.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KanbanBoard({ leadsData, onUpdate, isLoading }: {
  leadsData: any[] | undefined;
  onUpdate: (id: number, status: LeadStatus) => void;
  isLoading: boolean;
}) {
  const leadsByStatus = useMemo(() => {
    const grouped: Record<LeadStatus, any[]> = {
      new: [],
      contacted: [],
      booked: [],
      completed: [],
      closed: [],
      lost: [],
    };
    if (leadsData) {
      leadsData.forEach(lead => {
        if (grouped[lead.status as LeadStatus]) {
          grouped[lead.status as LeadStatus].push(lead);
        }
      });
      // Sort each column by newest first
      Object.keys(grouped).forEach(key => {
        grouped[key as LeadStatus].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      });
    }
    return grouped;
  }, [leadsData]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-6 min-w-full pb-4">
        {KANBAN_COLUMNS.map(col => {
          const leads = leadsByStatus[col.status];
          return (
            <div key={col.status} className="flex-shrink-0 w-80">
              {/* Column Header */}
              <div className={`${col.color} border p-4 mb-4`}>
                <h3 className="font-bold text-lg text-foreground tracking-wider">{col.label}</h3>
                <p className="text-[13px] text-foreground/60 mt-1">{leads.length} {leads.length === 1 ? "lead" : "leads"}</p>
              </div>

              {/* Cards */}
              <div className="space-y-3">
                {leads.length === 0 ? (
                  <div className="text-center py-8 text-foreground/30">
                    <Users className="w-6 h-6 mx-auto mb-2 opacity-40" />
                    <p className="text-[12px]">No leads</p>
                  </div>
                ) : (
                  leads.map(lead => (
                    <KanbanLeadCard key={lead.id} lead={lead} onUpdate={onUpdate} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function LeadsSection() {
  const [leadFilter, setLeadFilter] = useState<LeadStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");

  const { data: leadsData, isLoading, refetch } = trpc.lead.list.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const updateLead = trpc.lead.update.useMutation({
    onSuccess: () => { refetch(); toast.success("Lead updated"); },
    onError: (err) => toast.error("Failed: " + err.message),
  });

  const handleStatusChange = (id: number, status: LeadStatus) => {
    if (status === "lost") {
      // Prompt for lost reason — this data feeds Nick AI for pattern detection
      const REASONS = ["Price too high", "Went to competitor", "No response", "Changed mind", "Already fixed elsewhere", "Other"];
      const reason = prompt(
        `Why was this lead lost?\n\n${REASONS.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n\nEnter number or type reason:`
      );
      if (!reason) return; // Cancelled
      const lostReason = REASONS[parseInt(reason) - 1] || reason;
      updateLead.mutate({ id, status, lostReason });
    } else {
      updateLead.mutate({ id, status });
    }
  };

  const filteredLeads = useMemo(() => {
    if (!leadsData) return [];
    let list = [...leadsData];
    if (leadFilter !== "all") list = list.filter(l => l.status === leadFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(l =>
        l.name.toLowerCase().includes(q) || l.phone.includes(q) ||
        (l.email && l.email.toLowerCase().includes(q)) ||
        (l.vehicle && l.vehicle.toLowerCase().includes(q)) ||
        (l.problem && l.problem.toLowerCase().includes(q))
      );
    }
    return list;
  }, [leadsData, leadFilter, searchQuery]);

  const leadStats = useMemo(() => {
    if (!leadsData) return { new: 0, contacted: 0, urgent: 0, total: 0, booked: 0 };
    return {
      new: leadsData.filter((l: any) => l.status === "new").length,
      contacted: leadsData.filter((l: any) => l.status === "contacted").length,
      urgent: leadsData.filter((l: any) => (l.urgencyScore ?? 0) >= 4).length,
      total: leadsData.length,
      booked: leadsData.filter((l: any) => l.status === "booked").length,
    };
  }, [leadsData]);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Total Leads" value={leadStats.total} icon={<Hash className="w-4 h-4" />} color="text-foreground" />
        <StatCard label="New (Uncalled)" value={leadStats.new} icon={<Users className="w-4 h-4" />} color="text-blue-400" />
        <StatCard label="Contacted" value={leadStats.contacted} icon={<PhoneCall className="w-4 h-4" />} color="text-primary" />
        <StatCard label="Booked" value={leadStats.booked} icon={<CheckCircle2 className="w-4 h-4" />} color="text-emerald-400" />
        <StatCard label="Urgent (4-5)" value={leadStats.urgent} icon={<AlertTriangle className="w-4 h-4" />} color="text-red-400" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode("kanban")}
            className={`flex items-center gap-2 px-3 py-2 text-[12px] font-bold tracking-wide transition-colors ${
              viewMode === "kanban" ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"
            }`}
          >
            <LayoutGrid className="w-4 h-4" /> KANBAN
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`flex items-center gap-2 px-3 py-2 text-[12px] font-bold tracking-wide transition-colors ${
              viewMode === "list" ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"
            }`}
          >
            <List className="w-4 h-4" /> LIST
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="p-2 text-foreground/50 hover:text-primary transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Kanban View */}
      {viewMode === "kanban" ? (
        <KanbanBoard leadsData={leadsData} onUpdate={handleStatusChange} isLoading={isLoading} />
      ) : (
        <>
          {/* List View Filters */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" />
              <input
                type="text"
                placeholder="Search leads..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-card border border-border/50 text-foreground pl-10 pr-4 py-3 text-[13px] placeholder:text-foreground/30 focus:outline-none focus:border-primary/50"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="w-4 h-4 text-foreground/40" />
              {(["all", "new", "contacted", "booked", "completed", "closed", "lost"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setLeadFilter(f)}
                  className={`px-3 py-2 text-[12px] tracking-wide transition-colors ${
                    leadFilter === f ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Leads List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="text-center py-20 border border-border/30 bg-card">
              <Users className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
              <p className="font-bold text-xl text-foreground/40 tracking-wider">NO LEADS</p>
              <p className="text-foreground/30 text-[13px] mt-2">Leads from the popup and chat will appear here.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredLeads.map((lead, _lIdx) => (
                <div
                  key={lead.id}
                  className={`stagger-in bg-card border p-6 transition-colors ${
                    (lead.urgencyScore ?? 0) >= 4 ? "border-red-500/30 hover:border-red-500/50" : "border-border/30 hover:border-border/50"
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="font-bold text-lg text-foreground tracking-wider">{lead.name}</h3>
                        <UrgencyBadge score={lead.urgencyScore ?? 3} />
                        <span className={`inline-flex items-center px-2 py-0.5 border text-[10px] tracking-wider ${LEAD_STATUS_CONFIG[lead.status as LeadStatus]?.color} ${LEAD_STATUS_CONFIG[lead.status as LeadStatus]?.bgColor}`}>
                          {LEAD_STATUS_CONFIG[lead.status as LeadStatus]?.label}
                        </span>
                        <span className="font-mono text-[10px] text-foreground/30 uppercase tracking-wider">
                          via {lead.source}
                        </span>
                        <LeadAge dateStr={lead.createdAt} />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="flex items-center gap-2 text-foreground/70">
                          <Phone className="w-4 h-4 text-primary shrink-0" />
                          <a href={`tel:${lead.phone}`} className="text-[13px] hover:text-primary">{lead.phone}</a>
                        </div>
                        {lead.email && (
                          <div className="flex items-center gap-2 text-foreground/70">
                            <Mail className="w-4 h-4 text-primary shrink-0" />
                            <span className="text-[13px] truncate">{lead.email}</span>
                          </div>
                        )}
                        {lead.vehicle && (
                          <div className="flex items-center gap-2 text-foreground/70">
                            <Car className="w-4 h-4 text-primary shrink-0" />
                            <span className="text-[13px]">{lead.vehicle}</span>
                          </div>
                        )}
                        {lead.recommendedService && (
                          <div className="flex items-center gap-2 text-foreground/70">
                            <Wrench className="w-4 h-4 text-primary shrink-0" />
                            <span className="text-[13px]">{lead.recommendedService}</span>
                          </div>
                        )}
                      </div>

                      {lead.problem && (
                        <div className="flex items-start gap-2 text-foreground/60 bg-background/50 p-3 border border-border/20">
                          <MessageSquare className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          <p className="text-[13px] leading-relaxed">{lead.problem}</p>
                        </div>
                      )}

                      {lead.urgencyReason && (
                        <div className="flex items-start gap-2 text-foreground/50">
                          <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                          <p className="text-[12px] leading-relaxed italic">{lead.urgencyReason}</p>
                        </div>
                      )}

                      {lead.contactNotes && (
                        <div className="flex items-start gap-2 text-foreground/50 bg-emerald-500/5 p-2 border border-emerald-500/20">
                          <UserCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          <p className="text-[12px] leading-relaxed">
                            <span className="text-emerald-400">Contacted by {lead.contactedBy || "staff"}: </span>
                            {lead.contactNotes}
                          </p>
                        </div>
                      )}

                      <p className="text-[12px] text-foreground/30">
                        Received {new Date(lead.createdAt).toLocaleString()}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-row lg:flex-col gap-2 shrink-0">
                      {lead.status === "new" && (
                        <>
                          <a
                            href={`tel:${lead.phone}`}
                            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 font-bold text-xs tracking-wide hover:bg-primary/90"
                          >
                            <PhoneCall className="w-4 h-4" /> CALL
                          </a>
                          <button
                            onClick={() => {
                              const notes = prompt("Contact notes (what was discussed?):");
                              if (notes !== null) {
                                updateLead.mutate({
                                  id: lead.id,
                                  status: "contacted",
                                  contacted: 1,
                                  contactNotes: notes || "Called, no notes.",
                                });
                              }
                            }}
                            disabled={updateLead.isPending}
                            className="flex items-center gap-2 border border-primary/30 text-primary px-4 py-2.5 font-bold text-xs tracking-wide hover:bg-primary/10 disabled:opacity-50"
                          >
                            <UserCheck className="w-4 h-4" /> MARK CONTACTED
                          </button>
                        </>
                      )}
                      {lead.status === "contacted" && (
                        <>
                          <button
                            onClick={() => updateLead.mutate({ id: lead.id, status: "booked" })}
                            disabled={updateLead.isPending}
                            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2.5 font-bold text-xs tracking-wide hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-4 h-4" /> BOOKED
                          </button>
                          <button
                            onClick={() => updateLead.mutate({ id: lead.id, status: "lost" })}
                            disabled={updateLead.isPending}
                            className="flex items-center gap-2 border border-red-500/30 text-red-400 px-4 py-2.5 font-bold text-xs tracking-wide hover:bg-red-500/10 disabled:opacity-50"
                          >
                            <XCircle className="w-4 h-4" /> LOST
                          </button>
                        </>
                      )}
                      {(lead.status === "booked" || lead.status === "completed" || lead.status === "closed" || lead.status === "lost") && (
                        <button
                          onClick={() => updateLead.mutate({ id: lead.id, status: "new", contacted: 0 })}
                          disabled={updateLead.isPending}
                          className="flex items-center gap-2 border border-border/30 text-foreground/50 px-4 py-2.5 font-bold text-xs tracking-wide hover:text-foreground disabled:opacity-50"
                        >
                          <RefreshCw className="w-4 h-4" /> REOPEN
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── CONTENT SECTION ────────────────────────────────────

