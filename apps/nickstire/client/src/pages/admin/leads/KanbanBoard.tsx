import React, { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
import {
  Phone, Car, MessageSquare, UserCheck, PhoneCall, ChevronUp, ChevronDown, ChevronRight, Users, Loader2
} from "lucide-react";
import { UrgencyBadge, type LeadStatus } from "../shared";
import { SkeletonPanel } from "@/components/admin/AdminSkeletons";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import MessageCustomerLink from "@/components/admin/MessageCustomerLink";
import { classifyLeadOrigin } from "@shared/leadSource";
import { normalizePathname } from "@shared/attribution";

export interface LeadItem {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  vehicle?: string | null;
  problem?: string | null;
  status: string;
  source?: string | null;
  urgencyScore?: number | null;
  urgencyReason?: string | null;
  recommendedService?: string | null;
  contactedBy?: string | null;
  estimatedValueCents?: number | null;
  contactNotes?: string | null;
  createdAt: string | Date;
  lastFollowUpAt?: string | Date | null;
  callbackId?: number | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmSource?: string | null;
  landingPage?: string | null;
  referrer?: string | null;
}

export function LeadSourceBadge({ lead, hideWebSource = false }: { lead: LeadItem; hideWebSource?: boolean }) {
  if (lead.source === "careers") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 border text-[10px] tracking-wider font-bold text-purple-400 bg-purple-500/10 border-purple-500/30">
        JOB APPLICANT
      </span>
    );
  }
  const origin = classifyLeadOrigin(lead);
  if (origin === "phoneCall") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 border text-[10px] tracking-wider font-bold text-sky-400 bg-sky-500/10 border-sky-500/30">
        <PhoneCall className="w-3 h-3" /> PHONE
      </span>
    );
  }
  if (origin === "duplicateLink" || origin === "operationalCallback") {
    return (
      <span
        title={origin === "duplicateLink"
          ? "Callback request — same person also appears under Call Tracking"
          : "Callback request"}
        className="inline-flex items-center gap-1 px-2 py-0.5 border text-[10px] tracking-wider font-bold text-amber-400 bg-amber-500/10 border-amber-500/30"
      >
        <PhoneCall className="w-3 h-3" /> CALLBACK
      </span>
    );
  }
  if (hideWebSource) return null;
  return (
    <span className="font-mono text-[10px] text-foreground/30 uppercase tracking-wider">
      via {lead.source}
    </span>
  );
}

export function AttributionChip({ lead }: { lead: LeadItem }) {
  if (!lead.utmSource) return null;
  const path = normalizePathname(lead.landingPage);
  return (
    <span
      title={lead.referrer ? `Referrer: ${lead.referrer}` : undefined}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 border border-border/30 bg-background/40 text-[10px] font-mono tracking-wide text-foreground/60"
    >
      {lead.utmSource}
      {lead.utmCampaign ? `:${lead.utmCampaign}` : ""}
      {path && <span className="text-foreground/35">{path}</span>}
    </span>
  );
}

export function LeadAge({ dateStr }: { dateStr: string | Date }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const created = new Date(dateStr);
  const diffMs = Date.now() - created.getTime();
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(hours / 24);

  let label: string;
  if (hours < 1) label = `${Math.floor(diffMs / 60000)}m`;
  else if (hours < 24) label = `${hours}h`;
  else label = `${days}d`;

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
  lead: LeadItem;
  onUpdate: (id: number, status: LeadStatus) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const currentStatusIdx = KANBAN_COLUMNS.findIndex(c => c.status === lead.status);
  const availableTransitions = KANBAN_COLUMNS.filter((_, i) => i !== currentStatusIdx);

  return (
    <div className="bg-background border border-border/50 p-3 text-[12px] hover:border-primary/50 transition-colors">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-bold text-foreground">{lead.name}</h4>
          <UrgencyBadge score={lead.urgencyScore ?? 3} />
        </div>

        <LeadSourceBadge lead={lead} hideWebSource />

        {lead.phone && (
          <div className="flex items-center gap-2 text-foreground/70">
            <Phone className="w-3 h-3 text-primary shrink-0" />
            <a href={`tel:${lead.phone}`} className="hover:text-primary">{lead.phone}</a>
          </div>
        )}

        {lead.vehicle && (
          <div className="flex items-center gap-2 text-foreground/70">
            <Car className="w-3 h-3 text-primary shrink-0" />
            <span>{lead.vehicle}</span>
          </div>
        )}

        {lead.problem && (
          <div className="flex items-start gap-2 text-foreground/60">
            <MessageSquare className="w-3 h-3 text-primary shrink-0 mt-0.5" />
            <p className="line-clamp-2">{lead.problem}</p>
          </div>
        )}

        {lead.contactNotes && (
          <div className="flex items-start gap-2 text-emerald-400 text-[11px] bg-emerald-500/10 p-1.5">
            <UserCheck className="w-3 h-3 shrink-0 mt-0.5" />
            <span>{lead.contactNotes}</span>
          </div>
        )}

        <div className="flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-2">
            <span className="text-foreground/40">{new Date(lead.createdAt).toLocaleDateString()}</span>
            {lead.estimatedValueCents ? (
              <span className="text-emerald-400 font-bold">${Math.round(lead.estimatedValueCents / 100)}</span>
            ) : null}
          </div>
          <LeadAge dateStr={lead.createdAt} />
        </div>
        {lead.lastFollowUpAt ? (
          <div className="text-[10px] text-foreground/30 mt-1">
            Last touch: {Math.round((Date.now() - new Date(lead.lastFollowUpAt).getTime()) / 86400000)}d ago
          </div>
        ) : lead.status !== "new" ? (
          <div className="text-[10px] text-amber-400 mt-1">No follow-up recorded</div>
        ) : null}
      </div>

      <div className="mt-3 relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="w-full px-2 py-1.5 text-[11px] font-bold tracking-wide bg-card border border-border/30 text-foreground/70 hover:text-foreground transition-colors text-left"
        >
          Change Status ▼
        </button>
        {showMenu && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border/50 z-50 divide-y divide-border/30">
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

export function KanbanBoard({ leadsData, onUpdate, isLoading }: {
  leadsData: LeadItem[] | undefined;
  onUpdate: (id: number, status: LeadStatus) => void;
  isLoading: boolean;
}) {
  const leadsByStatus = useMemo(() => {
    const grouped: Record<LeadStatus, LeadItem[]> = {
      new: [],
      contacted: [],
      booked: [],
      completed: [],
      closed: [],
      lost: [],
    };
    if (leadsData) {
      leadsData.forEach(lead => {
        const bucket: LeadStatus = lead.status === "closed" ? "completed" : (lead.status as LeadStatus);
        if (grouped[bucket]) {
          grouped[bucket].push(lead);
        }
      });
      Object.keys(grouped).forEach(key => {
        grouped[key as LeadStatus].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      });
    }
    return grouped;
  }, [leadsData]);

  if (isLoading) {
    return <SkeletonPanel rows={6} />;
  }

  return (
    <div className="overflow-x-auto snap-x snap-mandatory">
      <div className="flex gap-6 min-w-full pb-4">
        {KANBAN_COLUMNS.map(col => {
          const leads = leadsByStatus[col.status];
          const isActivePipelineColumn = col.status === "new" || col.status === "contacted" || col.status === "booked";
          const columnStalledCents = isActivePipelineColumn
            ? leads.reduce((sum, l) => sum + (l.estimatedValueCents ?? 0), 0)
            : 0;
          return (
            <div key={col.status} className="flex-shrink-0 w-[85vw] sm:w-80 snap-start">
              <div className={`${col.color} border p-4 mb-4`}>
                <h3 className="font-bold text-lg text-foreground tracking-wider">{col.label}</h3>
                <p className="text-[13px] text-foreground/60 mt-1">{leads.length} {leads.length === 1 ? "lead" : "leads"}</p>
                {columnStalledCents > 0 && (
                  <p className="text-[11px] text-foreground/40 mt-0.5 font-mono">
                    ${Math.round(columnStalledCents / 100).toLocaleString()} in pipeline
                  </p>
                )}
              </div>

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
