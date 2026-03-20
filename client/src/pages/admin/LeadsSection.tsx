/**
 * LeadsSection — extracted from Admin.tsx for maintainability.
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
  AlertTriangle, Car, CheckCircle2, ChevronRight, ExternalLink, FileSpreadsheet, Filter, Hash, Loader2, Mail, MessageSquare, Phone, PhoneCall, RefreshCw, Search, UserCheck, Users, Wrench, XCircle, Zap
} from "lucide-react";

export default function LeadsSection() {
  const [leadFilter, setLeadFilter] = useState<LeadStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: leadsData, isLoading, refetch } = trpc.lead.list.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const updateLead = trpc.lead.update.useMutation({
    onSuccess: () => { refetch(); toast.success("Lead updated"); },
    onError: (err) => toast.error("Failed: " + err.message),
  });

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
      new: leadsData.filter(l => l.status === "new").length,
      contacted: leadsData.filter(l => l.status === "contacted").length,
      urgent: leadsData.filter(l => (l.urgencyScore ?? 0) >= 4).length,
      total: leadsData.length,
      booked: leadsData.filter(l => l.status === "booked").length,
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

      {/* Filters */}
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
          {(["all", "new", "contacted", "booked", "closed", "lost"] as const).map(f => (
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
          <button onClick={() => refetch()} className="p-2 text-foreground/50 hover:text-primary transition-colors ml-2">
            <RefreshCw className="w-4 h-4" />
          </button>
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
          {filteredLeads.map(lead => (
            <div
              key={lead.id}
              className={`bg-card border p-6 transition-colors ${
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
                  {(lead.status === "booked" || lead.status === "closed" || lead.status === "lost") && (
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
    </div>
  );
}

// ─── CONTENT SECTION ────────────────────────────────────

