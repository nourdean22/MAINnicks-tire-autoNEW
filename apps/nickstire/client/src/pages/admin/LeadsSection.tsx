/**
 * LeadsSection — extracted from Admin.tsx for maintainability.
 * Includes Kanban board view and traditional list view.
 */
import { useState, useMemo, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { SkeletonPanel } from "@/components/admin/AdminSkeletons";
import {
  StatCard, UrgencyBadge, PageHeader, LoadingState, EmptyState, SectionInsightStrip,
  LEAD_STATUS_CONFIG,
  useUrlFilter, FilterChips,
  type LeadStatus,
} from "./shared";
// wave-181.x Leads Phase 1 cleanup · trimmed 8 unused imports
// (ActivityIcon · StatusDot · BOOKING_STATUS_CONFIG · TIME_LABELS ·
// CHART_COLORS · ChevronRight · ExternalLink · FileSpreadsheet).
// Verified via grep that each had zero body references.
import {
  AlertTriangle, Car, CheckCircle2, Filter, Hash, Loader2, Mail, MessageSquare, Phone, PhoneCall, RefreshCw, Search, Trash2, UserCheck, Users, Wrench, XCircle, Zap, LayoutGrid, List, Calculator
} from "lucide-react";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { openWalkInQuote } from "@/components/admin/WalkInQuoteDrawer";
// wave-181.x Leads Phase 2 · 3-line LeadsBrief above the StatCard grid
// (velocity / pipeline / SLA-breach action). Composes from the same
// trpc.lead.list query the parent already runs · no extra round-trip.
import { LeadsBrief } from "./leads/LeadsBrief";
// lead-source hygiene — distinct CALLBACK/PHONE badges vs real web leads
// + the read-only source rollup (counts, duplicates, phone overlap).
import { classifyLeadOrigin, summarizeLeadSourceHygiene } from "@shared/leadSource";

// ── Lead type ──
// 2026-05-23 · widened to match drizzle/schema.ts. The JSX already
// renders `lead.recommendedService` / `lead.urgencyReason` /
// `lead.contactedBy` (lines 841-871) and tsc accepts them because
// tRPC infers the wider DB shape — but the explicit interface was
// missing them, making it look like dead JSX. Now declared so the
// interface matches reality.
interface LeadItem {
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
  // Present on the DB row (lead.list = SELECT *); declared so the source
  // classifier can read them. callbackId distinguishes a web-callback artifact
  // (linked, has a callback_requests row) from a voice rack-check lead (null).
  callbackId?: number | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
}

/**
 * Distinct source badge — lets an operator tell a real website lead from a
 * callback/voice artifact at a glance (lead-source hygiene audit). `careers`
 * keeps its JOB APPLICANT pill; source="callback" leads render CALLBACK
 * (web callback request) or PHONE (voice rack-check) instead of blending in.
 * `hideWebSource` drops the low-signal "via {source}" line for real leads in
 * the dense Kanban view (where it was previously invisible anyway).
 */
function LeadSourceBadge({ lead, hideWebSource = false }: { lead: LeadItem; hideWebSource?: boolean }) {
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

// ── SLA Timer for leads ──
function LeadAge({ dateStr }: { dateStr: string | Date }) {
  // wave-181.x Leads Phase 3 · code-review agent caught M3 · LeadAge
  // was render-pure reading Date.now() at mount; the green/amber/red
  // SLA color and label froze until parent re-render. A lead at 3h59m
  // wouldn't flip to red at 4h until the next list refetch (~30s).
  // Minute-tick interval keeps the visual honest at ≤60s granularity.
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
  lead: LeadItem;
  onUpdate: (id: number, status: LeadStatus) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const currentStatusIdx = KANBAN_COLUMNS.findIndex(c => c.status === lead.status);
  const availableTransitions = KANBAN_COLUMNS.filter((_, i) => i !== currentStatusIdx);

  return (
    <div className="bg-background border border-border/50 p-3 text-[12px] hover:border-primary/50 transition-colors">
      <div className="space-y-2">
        {/* Name and Urgency — wave-187+ · shared UrgencyBadge (clamps 1-5,
            matches list view; replaced the bespoke inline badge that
            rendered raw out-of-range scores like "36/5"). */}
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-bold text-foreground">{lead.name}</h4>
          <UrgencyBadge score={lead.urgencyScore ?? 3} />
        </div>

        {/* Source badge — careers / callback / phone flagged distinctly */}
        <LeadSourceBadge lead={lead} hideWebSource />

        {/* Phone — guard null (tel:null renders a dead link otherwise) */}
        {lead.phone && (
          <div className="flex items-center gap-2 text-foreground/70">
            <Phone className="w-3 h-3 text-primary shrink-0" />
            <a href={`tel:${lead.phone}`} className="hover:text-primary">{lead.phone}</a>
          </div>
        )}

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

        {/* Value + Age + Money Aging */}
        <div className="flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-2">
            <span className="text-foreground/40">{new Date(lead.createdAt).toLocaleDateString()}</span>
            {lead.estimatedValueCents ? (
              <span className="text-emerald-400 font-bold">${Math.round(lead.estimatedValueCents / 100)}</span>
            ) : null}
          </div>
          <LeadAge dateStr={lead.createdAt} />
        </div>
        {/* Money aging — time since last follow-up */}
        {lead.lastFollowUpAt ? (
          <div className="text-[10px] text-foreground/30 mt-1">
            Last touch: {Math.round((Date.now() - new Date(lead.lastFollowUpAt).getTime()) / 86400000)}d ago
          </div>
        ) : lead.status !== "new" ? (
          <div className="text-[10px] text-amber-400 mt-1">No follow-up recorded</div>
        ) : null}
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
          // wave-120 — z-10 was too low; multiple ancestor cards have
          // `overflow-x-auto` / `overflow-hidden` which clipped the
          // dropdown. Bumped to z-50 (admin-shell standard for floating
          // UI) so the dropdown always renders above sibling cards.
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

function KanbanBoard({ leadsData, onUpdate, isLoading }: {
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
        // wave-181.x Leads Phase 1 bug-fix · code-review agent caught
        // this as H1. KANBAN_COLUMNS has 5 entries (new/contacted/
        // booked/completed/lost) — no "closed". So before this fix, a
        // lead with status="closed" was bucketed into the `closed: []`
        // array but never rendered, silently disappearing from Kanban.
        // Collapse closed → completed at write time so closed leads
        // appear in the Completed column where the operator can still
        // see + reopen them. (Matches the list-view treatment which
        // does include "closed" in its filter set.)
        const bucket: LeadStatus = lead.status === "closed" ? "completed" : (lead.status as LeadStatus);
        if (grouped[bucket]) {
          grouped[bucket].push(lead);
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
    return <SkeletonPanel rows={6} />;
  }

  return (
    // wave-181.x Leads Phase 3 · audit agent caught mobile UX gap ·
    // overflow-x-auto with no snap meant the operator could scroll
    // past the column they were aiming at on a phone. snap-x +
    // snap-mandatory on the scroller + snap-start on each column
    // anchors the swipe to column boundaries.
    <div className="overflow-x-auto snap-x snap-mandatory">
      <div className="flex gap-6 min-w-full pb-4">
        {KANBAN_COLUMNS.map(col => {
          const leads = leadsByStatus[col.status];
          // wave-181.x Leads Phase 2 · loss-aversion-designer steal ·
          // sum the $ value of active-pipeline leads in this column.
          // Code-review agent caught M2: showing "$X in pipeline" on
          // Completed / Lost columns is semantically wrong (revenue
          // already booked OR gone — not "pipeline"). YAGNI says hide
          // the line on terminal columns until we have different copy
          // ("$X recovered" / "$X lost") · skip the noise for now.
          const isActivePipelineColumn = col.status === "new" || col.status === "contacted" || col.status === "booked";
          const columnStalledCents = isActivePipelineColumn
            ? leads.reduce((sum, l) => sum + (l.estimatedValueCents ?? 0), 0)
            : 0;
          // wave-124b — Kanban columns were `w-80` (320px) on a 390px
          // phone viewport. Operator saw 1.2 columns with no scroll
          // hint. `w-[85vw]` on mobile makes one column nearly fill
          // the screen so the swipe pattern is obvious; sm+ keeps
          // the original 320px so 5 columns fit on tablet/desktop.
          return (
            <div key={col.status} className="flex-shrink-0 w-[85vw] sm:w-80 snap-start">
              {/* Column Header */}
              <div className={`${col.color} border p-4 mb-4`}>
                <h3 className="font-bold text-lg text-foreground tracking-wider">{col.label}</h3>
                <p className="text-[13px] text-foreground/60 mt-1">{leads.length} {leads.length === 1 ? "lead" : "leads"}</p>
                {columnStalledCents > 0 && (
                  <p className="text-[11px] text-foreground/40 mt-0.5 font-mono">
                    ${Math.round(columnStalledCents / 100).toLocaleString()} in pipeline
                  </p>
                )}
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

// wave-181.x Leads Phase 5 · audit agent flagged the LeadCategory tab
// taxonomy as redundant with `sourceFilter` (chat == source=chat ·
// callbacks == source=callback · estimates was the only true new
// axis · and even that is reachable via the existing search box
// which already indexes the problem field on L600-604). Operator
// approved the ~50 LOC delete · ELON discipline: question → delete →
// simplify. Net: 1 filter taxonomy instead of 2 overlapping ones.

/**
 * MarkContactedButton — inline "mark lead contacted" control with a notes
 * input. Replaces a window.prompt() call: prompt() is suppressed in iOS PWA
 * standalone mode (where the admin is operated), so the old markContacted()
 * handler silently never fired the mutation — leads were never marked
 * contacted on the phone. Same native-primitive bug class wave-139/168 fixed
 * for window.confirm() and the follow-up-call prompt. Mirrors FollowUpButton.
 */
function MarkContactedButton({ leadId, variant }: { leadId: number; variant: "banner" | "list" }) {
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const mutation = trpc.lead.update.useMutation({
    onSuccess: () => {
      void utils.lead.list.invalidate();
      toast.success("Lead marked contacted");
      setExpanded(false);
      setNotes("");
    },
    onError: (err) => toast.error("Failed: " + err.message),
  });

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const submit = () => {
    // wave-181.x Leads Phase 1 bug-fix · code-review agent caught the
    // placeholder "Called, no notes." pollutes the data Nick AI's
    // pattern-detector reads. Same anti-pattern as the "estimate-as-
    // invoice" leak (wave-95). Send undefined when the operator typed
    // nothing — the JSX (line ~140) already guards on falsy with the
    // contactNotes block hidden, so the visual is correct too.
    const trimmed = notes.trim();
    mutation.mutate({
      id: leadId,
      status: "contacted",
      contacted: 1,
      contactNotes: trimmed.length > 0 ? trimmed : undefined,
    });
  };

  if (expanded) {
    return (
      <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") { setExpanded(false); setNotes(""); }
          }}
          placeholder="Notes (optional)"
          aria-label="Contact notes"
          className="px-2 py-1 bg-card border border-primary/30 text-foreground text-[11px] tracking-wide placeholder:text-foreground/30 focus:outline-none focus:border-primary w-40"
        />
        <button
          onClick={submit}
          disabled={mutation.isPending}
          className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold tracking-wide hover:bg-emerald-500/25 disabled:opacity-50"
          aria-label="Save contacted"
        >
          {mutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserCheck className="w-3 h-3" />}
          SAVE
        </button>
        <button
          onClick={() => { setExpanded(false); setNotes(""); }}
          className="px-2 py-1 text-foreground/40 hover:text-foreground/70 text-[12px] leading-none"
          aria-label="Cancel"
        >
          ×
        </button>
      </div>
    );
  }

  if (variant === "banner") {
    return (
      <button
        onClick={() => setExpanded(true)}
        disabled={mutation.isPending}
        className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-[10px] font-bold rounded hover:bg-emerald-500/30 disabled:opacity-50 transition-colors"
      >
        Mark Called
      </button>
    );
  }

  return (
    <button
      onClick={() => setExpanded(true)}
      disabled={mutation.isPending}
      className="flex items-center gap-2 border border-primary/30 text-primary px-4 py-2.5 font-bold text-xs tracking-wide hover:bg-primary/10 disabled:opacity-50"
    >
      <UserCheck className="w-4 h-4" /> MARK CONTACTED
    </button>
  );
}

const LOST_REASONS = [
  "Price too high", "Went to competitor", "No response",
  "Changed mind", "Already fixed elsewhere", "Other",
] as const;

/**
 * LostReasonButton — inline "mark lead lost" control with a reason picker.
 * Replaces a window.prompt() call (suppressed in iOS PWA standalone, so the
 * old kanban handler silently never persisted) and ALSO adds reason capture
 * to the list view, which previously sent no reason at all. The reason feeds
 * Nick AI pattern detection. Mirrors FollowUpButton.
 */
function LostReasonButton({ leadId }: { leadId: number }) {
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState(false);

  const mutation = trpc.lead.update.useMutation({
    onSuccess: () => {
      void utils.lead.list.invalidate();
      toast.success("Lead marked lost");
      setExpanded(false);
    },
    onError: (err) => toast.error("Failed: " + err.message),
  });

  if (expanded) {
    return (
      <div className="flex flex-col gap-1.5 border border-red-500/30 bg-red-500/5 p-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] tracking-wider text-red-400/80 font-bold">WHY LOST?</span>
          <button
            onClick={() => setExpanded(false)}
            className="px-1 text-foreground/40 hover:text-foreground/70 text-[12px] leading-none"
            aria-label="Cancel"
          >
            ×
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {LOST_REASONS.map((reason) => (
            <button
              key={reason}
              onClick={() => mutation.mutate({ id: leadId, status: "lost", lostReason: reason })}
              disabled={mutation.isPending}
              className="px-2 py-1 bg-card border border-red-500/20 text-red-400/80 text-[10px] tracking-wide hover:bg-red-500/15 hover:text-red-400 disabled:opacity-50 transition-colors"
            >
              {reason}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setExpanded(true)}
      disabled={mutation.isPending}
      className="flex items-center gap-2 border border-red-500/30 text-red-400 px-4 py-2.5 font-bold text-xs tracking-wide hover:bg-red-500/10 disabled:opacity-50"
    >
      <XCircle className="w-4 h-4" /> LOST
    </button>
  );
}

export default function LeadsSection() {
  // 2026-05-06 — URL-persistent filters via useUrlFilter.
  // Reload, back-button, shared links all preserve filter state.
  // ?status= ?q= ?source= ?view= ?cat= keys; defaults are NOT in URL.
  const [leadFilter, setLeadFilter] = useUrlFilter<LeadStatus | "all">(
    "status", "all",
    {
      validate: (v) => (["all", "new", "contacted", "booked", "completed", "closed", "lost"].includes(v)
        ? (v as LeadStatus | "all") : null),
    },
  );
  const [searchQuery, setSearchQuery] = useUrlFilter<string>("q", "", { debounce: true });
  const [sourceFilter, setSourceFilter] = useUrlFilter<string>("source", "all");
  const [viewMode, setViewMode] = useUrlFilter<"kanban" | "list">(
    "view", "kanban",
    { validate: (v) => (v === "kanban" || v === "list" ? v : null) },
  );
  const utils = trpc.useUtils();
  const { data: leadsData, isLoading } = trpc.lead.list.useQuery(undefined, {
    refetchInterval: 30000,
  });

  // wave-116d — was `refetch()` on the local query instance. That only
  // refreshed THIS component's lead list, so OverviewSection's lead
  // queue (which is a sibling subscription) stayed stale. Switched to
  // utils.lead.list.invalidate() which propagates to every mounted
  // subscriber. OverviewSection already uses this pattern at L310-314.
  const updateLead = trpc.lead.update.useMutation({
    onSuccess: () => { void utils.lead.list.invalidate(); toast.success("Lead updated"); },
    onError: (err) => toast.error("Failed: " + err.message),
  });

  const deleteLead = trpc.lead.delete.useMutation({
    onSuccess: () => { void utils.lead.list.invalidate(); toast.success("Lead deleted"); },
    onError: (err) => toast.error("Delete failed: " + err.message),
  });

  const availableSources = useMemo((): string[] => {
    const sourceSet = new Set<string>(["careers"]); // Always show careers as a source option
    if (leadsData) leadsData.forEach((l: LeadItem) => { if (l.source) sourceSet.add(String(l.source)); });
    return [...sourceSet].sort();
  }, [leadsData]);

  // Kanban drag-drop status handler. The lost-reason capture that used
  // to live here relied on window.prompt() (suppressed in iOS PWA
  // standalone mode); the reason is now captured by LostReasonButton
  // in the list view.
  //
  // wave-181.x Leads Phase 1 · code-review agent caught H2: terminal
  // status transitions (lost / completed / closed) were firing with no
  // confirm gate. A misclick on the small Kanban dropdown silently
  // mutated state — lead drops out of working pipeline + may trigger
  // downstream D7/D14 retention SMS via cron. Forward-motion
  // transitions (new → contacted → booked) stay un-gated because
  // they're reversible and high-frequency.
  const handleStatusChange = async (id: number, status: LeadStatus) => {
    const isTerminal = status === "lost" || status === "completed" || status === "closed";
    if (isTerminal) {
      const lead = leadsData?.find((l: LeadItem) => l.id === id);
      const leadName = lead?.name ?? "this lead";
      const messageExtra = status === "lost"
        ? " The list-view's \"Mark Lost\" button is a better path — it captures the lost-reason for the analytics pipeline."
        : "";
      const ok = await confirmDialog({
        title: `Move ${leadName} to ${status.toUpperCase()}?`,
        message: `Removes the lead from the active pipeline.${messageExtra}`,
        confirmLabel: `Move to ${status}`,
        cancelLabel: "Cancel",
        tone: status === "lost" ? "danger" : "default",
      });
      if (!ok) return;
    }
    updateLead.mutate({ id, status });
  };

  // wave-181.x Leads Phase 5 · `applyCategory` + `categoryFilteredLeads`
  // both removed when the dual filter taxonomy was deleted. Chat /
  // Callbacks were duplicates of `sourceFilter`; the search box already
  // indexes the `problem` field so "Cost estimate:" prefix is reachable
  // via search. One taxonomy · one source of truth.
  const filteredLeads = useMemo(() => {
    if (!leadsData) return [];
    let list = [...leadsData];
    if (leadFilter !== "all") list = list.filter(l => l.status === leadFilter);
    if (sourceFilter !== "all") list = list.filter(l => l.source === sourceFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      // wave-133 — was `l.phone.includes(q)`. LeadItem.phone is
      // string|null; a null phone (valid — phone is optional)
      // crashed the whole list with "Cannot read properties of
      // null (reading 'includes')" the moment the operator typed
      // anything in the search box.
      list = list.filter(l =>
        l.name.toLowerCase().includes(q) || (l.phone || "").includes(q) ||
        (l.email && l.email.toLowerCase().includes(q)) ||
        (l.vehicle && l.vehicle.toLowerCase().includes(q)) ||
        (l.problem && l.problem.toLowerCase().includes(q))
      );
    }
    return list;
  }, [leadsData, leadFilter, sourceFilter, searchQuery]);

  const leadStats = useMemo(() => {
    if (!leadsData) return { new: 0, contacted: 0, urgent: 0, total: 0, booked: 0 };
    // wave-128 — operator screenshot bug: a booked lead with
    // urgencyScore=4 was counted in "Urgent". Urgency only matters
    // while the lead is in-flight; once it's booked/completed/closed/
    // lost the lead has been actioned and shouldn't bleed into the
    // urgent counter. Same fix as wave-123 Action Queue (Overview).
    const TERMINAL = new Set(["booked", "completed", "closed", "lost"]);
    return {
      new: leadsData.filter((l: LeadItem) => l.status === "new").length,
      contacted: leadsData.filter((l: LeadItem) => l.status === "contacted").length,
      urgent: leadsData.filter((l: LeadItem) =>
        (l.urgencyScore ?? 0) >= 4 && !TERMINAL.has(l.status)
      ).length,
      total: leadsData.length,
      booked: leadsData.filter((l: LeadItem) => l.status === "booked").length,
    };
  }, [leadsData]);

  // Urgent uncontacted leads — the money bleeder
  const uncontactedLeads = useMemo(() => {
    if (!leadsData) return [];
    return leadsData
      .filter((l: LeadItem) => l.status === "new")
      .sort((a: LeadItem, b: LeadItem) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [leadsData]);

  // Source hygiene rollup — read-only. Reuses lead.list (above) + callback.list.
  // No refetchInterval: the Admin shell already polls callback.list at 30s
  // (Admin.tsx), and this observer shares that cache entry — adding our own
  // interval would only fire redundant off-phase fetches.
  const { data: callbacksData } = trpc.callback.list.useQuery();
  const sourceHygiene = useMemo(() => {
    if (!leadsData) return null;
    return summarizeLeadSourceHygiene(leadsData, callbacksData ?? []);
  }, [leadsData, callbacksData]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads & Estimates"
        subtitle="Inbound leads · estimate forms · phone-call captures · Vapi tire inquiries · golden 4-hour response window"
        icon={<Users className="w-5 h-5" />}
        actions={
          <button
            type="button"
            onClick={() => openWalkInQuote()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] tracking-wider uppercase font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/15 transition-colors rounded"
            title="Open Walk-In Quote pricing tool"
          >
            <Calculator className="w-3.5 h-3.5" />
            Walk-In Quote
          </button>
        }
      />
      <SectionInsightStrip section="leads" />
      <LeadsBrief
        onSlaAction={() => {
          // wave-181.x Leads Phase 2 · SLA-breach CTA · code-review agent
          // caught M1 (false-affordance risk): banner only renders when
          // uncontactedLeads.length > 0, AND `uncontactedLeads` filters on
          // status==="new" without an age gate. So a 3h-old uncontacted
          // lead would inflate the count and SLA-breach would fire on a
          // sibling 5h lead — visible flash is correct. But if the
          // banner is hidden (zero uncontacted but stale older leads)
          // the scroll target is missing and the CTA silently no-ops.
          // Defensive fallback · flip filters to ?status=new&view=list
          // so the operator lands on the right cohort even if the
          // urgent banner isn't currently rendered.
          setLeadFilter("new");
          setViewMode("list");
          setTimeout(() => {
            const el = document.getElementById("leads-urgent-banner");
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              el.classList.add("ring-2", "ring-red-400/50");
              setTimeout(() => el.classList.remove("ring-2", "ring-red-400/50"), 1200);
            }
          }, 100);
        }}
      />
      {/* 2026-05-06 — Active filter chips with one-click clear */}
      <FilterChips
        chips={[
          { label: "Status", value: leadFilter, default: "all", onClear: () => setLeadFilter("all"), displayValue: leadFilter === "all" ? undefined : leadFilter.charAt(0).toUpperCase() + leadFilter.slice(1) },
          { label: "Search", value: searchQuery, default: "", onClear: () => setSearchQuery("") },
          { label: "Source", value: sourceFilter, default: "all", onClear: () => setSourceFilter("all") },
          { label: "View", value: viewMode, default: "kanban", onClear: () => setViewMode("kanban"), displayValue: viewMode === "list" ? "List" : undefined },
        ]}
        onClearAll={() => {
          setLeadFilter("all");
          setSearchQuery("");
          setSourceFilter("all");
          setViewMode("kanban");
        }}
      />
      {/* CRITICAL ALERT — Uncontacted leads with ticking timer.
       *
       * wave-181.x Leads Phase 1 · was `animate-pulse-slow` (no Tailwind
       * def · silently no-op) · replaced with no animation. The red
       * border + red tint is already operator-attention-grabbing · a
       * constant pulse on top would be AI-slop visual noise that
       * desensitizes the operator over time. */}
      {uncontactedLeads.length > 0 && (
        <div id="leads-urgent-banner" className="bg-red-500/5 border border-red-500/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-[13px] font-bold text-red-400 tracking-wide">
              {uncontactedLeads.length} LEAD{uncontactedLeads.length > 1 ? "S" : ""} — NOT YET CONTACTED
            </span>
            <span className="text-[10px] text-red-400/60 ml-auto">Every hour = -15% conversion</span>
          </div>
          <div className="space-y-2">
            {uncontactedLeads.slice(0, 5).map((lead: LeadItem) => {
              const ageMs = Date.now() - new Date(lead.createdAt).getTime();
              const ageMin = Math.floor(ageMs / 60000);
              const ageHrs = Math.floor(ageMin / 60);
              const ageLabel = ageHrs > 0 ? `${ageHrs}h ${ageMin % 60}m` : `${ageMin}m`;
              const isCritical = ageMin > 240; // 4+ hours
              return (
                <div key={lead.id} className="flex items-center gap-3 text-[12px]">
                  <span className={`font-mono font-bold px-2 py-0.5 rounded text-[11px] ${
                    isCritical ? "bg-red-500/20 text-red-400" : ageMin > 60 ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400"
                  }`}>
                    {ageLabel} ago
                  </span>
                  <span className="font-bold text-foreground">{lead.name}</span>
                  {lead.phone && (
                    <a href={`tel:${lead.phone}`} className="text-primary hover:underline flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {lead.phone}
                    </a>
                  )}
                  <span className="text-foreground/40 truncate flex-1">{lead.vehicle || lead.problem?.slice(0, 40)}</span>
                  {lead.estimatedValueCents && (
                    <span className="text-primary font-mono font-bold">${(lead.estimatedValueCents / 100).toFixed(0)}</span>
                  )}
                  <MarkContactedButton leadId={lead.id} variant="banner" />
                </div>
              );
            })}
          </div>
          {uncontactedLeads.length > 5 && (
            <p className="text-[10px] text-red-400/60 mt-2">+ {uncontactedLeads.length - 5} more uncontacted</p>
          )}
        </div>
      )}

      {/* Stats — wave-127 — clickable filters. Each card sets the
          status filter + flips to list view. Urgent scrolls to the
          red banner (which already surfaces uncontacted leads by age). */}
      {/* wave-181.x Leads Phase 3 · audit agent caught grid orphan
          on tablet portrait (iPad common nick admin device) · 2-col
          drops "Urgent" tile alone on row 3. Adding md:grid-cols-3
          balances the layout · 5 cards split 3+2 on tablet, 5 on
          desktop, 2-row stack on phone. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard
          label="Total Leads"
          value={leadStats.total}
          icon={<Hash className="w-4 h-4" />}
          color="text-foreground"
          onClick={() => { setLeadFilter("all"); setViewMode("list"); }}
        />
        <StatCard
          label="New (Uncalled)"
          value={leadStats.new}
          icon={<Users className="w-4 h-4" />}
          color="text-blue-400"
          onClick={() => { setLeadFilter("new"); setViewMode("list"); }}
        />
        <StatCard
          label="Contacted"
          value={leadStats.contacted}
          icon={<PhoneCall className="w-4 h-4" />}
          color="text-primary"
          onClick={() => { setLeadFilter("contacted"); setViewMode("list"); }}
        />
        <StatCard
          label="Booked"
          value={leadStats.booked}
          icon={<CheckCircle2 className="w-4 h-4" />}
          color="text-emerald-400"
          onClick={() => { setLeadFilter("booked"); setViewMode("list"); }}
        />
        <StatCard
          label="Urgent (4-5)"
          value={leadStats.urgent}
          icon={<AlertTriangle className="w-4 h-4" />}
          color="text-red-400"
          onClick={() => {
            const banner = document.getElementById("leads-urgent-banner");
            if (banner) {
              banner.scrollIntoView({ behavior: "smooth", block: "start" });
              banner.classList.add("ring-2", "ring-red-400/60");
              setTimeout(() => banner.classList.remove("ring-2", "ring-red-400/60"), 1500);
            } else {
              // No urgent banner means no uncontacted urgent leads —
              // fall back to list view so operator can scan all leads.
              setLeadFilter("all");
              setViewMode("list");
            }
          }}
        />
      </div>

      {/* wave-181.x Leads Phase 5 · Category Tabs deleted (chat /
       * callbacks were duplicates of sourceFilter · estimates is
       * reachable via search · ~30 LOC removed). Operator opt-in. */}

      {/* SOURCE HYGIENE — read-only rollup: where leads come from, which
          rows are caller artifacts, and how many people exist on BOTH the
          Leads and Callbacks surfaces. No actions, no mutations. */}
      {sourceHygiene && sourceHygiene.totalLeads > 0 && (
        <div className="bg-card border border-border/30 rounded-lg px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[10px] font-bold tracking-wider text-foreground/40 uppercase">Source hygiene</span>
            {Object.entries(sourceHygiene.countsByLabel)
              .sort((a, b) => b[1] - a[1])
              .map(([label, count]) => (
                <span key={label} className="font-mono text-[10px] text-foreground/60 uppercase tracking-wider">
                  {label} <span className="text-foreground font-bold">{count}</span>
                </span>
              ))}
          </div>
          {(sourceHygiene.linkedCallbackDuplicates > 0 || sourceHygiene.phoneOverlapCount > 0 || sourceHygiene.blankSourceLeads > 0) && (
            <div className="mt-2 space-y-1">
              {sourceHygiene.linkedCallbackDuplicates > 0 && (
                <p className="text-[11px] text-amber-400/80">
                  {sourceHygiene.linkedCallbackDuplicates} callback-linked duplicate{sourceHygiene.linkedCallbackDuplicates > 1 ? "s" : ""} — same person also under Call Tracking; excluded from money-risk counts
                </p>
              )}
              {sourceHygiene.phoneOverlapCount > 0 && (
                <p className="text-[11px] text-foreground/50">
                  {sourceHygiene.phoneOverlapCount} phone number{sourceHygiene.phoneOverlapCount > 1 ? "s" : ""} appear{sourceHygiene.phoneOverlapCount > 1 ? "" : "s"} in both Leads and Callbacks
                </p>
              )}
              {sourceHygiene.blankSourceLeads > 0 && (
                <p className="text-[11px] text-red-400/80">
                  {sourceHygiene.blankSourceLeads} lead{sourceHygiene.blankSourceLeads > 1 ? "s" : ""} with a blank source (legacy capture bug) — fix shipped; old rows unaffected
                </p>
              )}
            </div>
          )}
        </div>
      )}

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
          <button onClick={() => void utils.lead.list.invalidate()} aria-label="Refresh data" className="p-2 text-foreground/50 hover:text-primary transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Kanban View · post-Phase-5 uses raw leadsData (Kanban shows
       * all columns as bird's-eye-view · list-view applies filters). */}
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
              {availableSources.length > 1 && (
                <>
                  <div className="h-6 w-px bg-border/30 mx-1" />
                  <select
                    value={sourceFilter}
                    onChange={e => setSourceFilter(e.target.value)}
                    className="bg-card border border-border/30 text-foreground/60 px-3 py-2 text-[12px] tracking-wide focus:outline-none focus:border-primary/50"
                  >
                    <option value="all">All Sources</option>
                    {availableSources.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </>
              )}
            </div>
          </div>

          {/* Leads List */}
          {isLoading ? (
            <LoadingState label="Loading leads..." />
          ) : filteredLeads.length === 0 ? (
            <EmptyState
              icon={<Users className="w-8 h-8" />}
              title="No leads"
              subtitle="Leads from the popup and chat will appear here."
            />
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
                        <LeadSourceBadge lead={lead} />
                        <LeadAge dateStr={lead.createdAt} />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {lead.phone && (
                          <div className="flex items-center gap-2 text-foreground/70">
                            <Phone className="w-4 h-4 text-primary shrink-0" />
                            <a href={`tel:${lead.phone}`} className="text-[13px] hover:text-primary">{lead.phone}</a>
                          </div>
                        )}
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
                          {lead.phone && (
                            <a
                              href={`tel:${lead.phone}`}
                              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 font-bold text-xs tracking-wide hover:bg-primary/90"
                            >
                              <PhoneCall className="w-4 h-4" /> CALL
                            </a>
                          )}
                          <MarkContactedButton leadId={lead.id} variant="list" />
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
                          <LostReasonButton leadId={lead.id} />
                        </>
                      )}
                      {(lead.status === "booked" || lead.status === "completed" || lead.status === "closed" || lead.status === "lost") && (
                        <button
                          onClick={async () => {
                            // wave-181.x Leads Phase 1 · audit agent
                            // flagged this as a one-tap operator footgun
                            // — reopens a terminal lead back to "new"
                            // AND clears the contacted flag, sending it
                            // back to the uncontacted-lead banner +
                            // resetting the audit trail. Gate it.
                            const ok = await confirmDialog({
                              title: `Reopen ${lead.name}'s lead?`,
                              message: `Returns the lead to "new" status and clears the contacted flag. The lead will reappear in the urgent-uncontacted banner.`,
                              confirmLabel: "Reopen",
                              cancelLabel: "Cancel",
                              tone: "default",
                            });
                            if (!ok) return;
                            updateLead.mutate({ id: lead.id, status: "new", contacted: 0 });
                          }}
                          disabled={updateLead.isPending}
                          className="flex items-center gap-2 border border-border/30 text-foreground/50 px-4 py-2.5 font-bold text-xs tracking-wide hover:text-foreground disabled:opacity-50"
                        >
                          <RefreshCw className="w-4 h-4" /> REOPEN
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          if (await confirmDialog({
                            title: "Delete lead?",
                            message: `Remove ${lead.name}'s lead. This cannot be undone.`,
                            confirmLabel: "Delete",
                            tone: "danger",
                          })) {
                            deleteLead.mutate({ id: lead.id });
                          }
                        }}
                        disabled={deleteLead.isPending}
                        className="flex items-center gap-2 border border-red-500/20 text-red-400/60 px-4 py-2.5 font-bold text-xs tracking-wide hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" /> DELETE
                      </button>
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

