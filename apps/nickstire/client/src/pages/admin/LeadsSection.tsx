/**
 * LeadsSection â extracted from Admin.tsx for maintainability.
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
// wave-181.x Leads Phase 1 cleanup Â· trimmed 8 unused imports
// (ActivityIcon Â· StatusDot Â· BOOKING_STATUS_CONFIG Â· TIME_LABELS Â·
// CHART_COLORS Â· ChevronRight Â· ExternalLink Â· FileSpreadsheet).
// Verified via grep that each had zero body references.
import {
  AlertTriangle, Car, CheckCircle2, ClipboardList, Filter, Hash, Loader2, Mail, MessageSquare, Phone, PhoneCall, RefreshCw, Search, Trash2, UserCheck, Users, Wrench, XCircle, Zap, LayoutGrid, List, Calculator
} from "lucide-react";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { openWalkInQuote } from "@/components/admin/WalkInQuoteDrawer";
// wave-181.x Leads Phase 2 Â· 3-line LeadsBrief above the StatCard grid
// (velocity / pipeline / SLA-breach action). Composes from the same
// trpc.lead.list query the parent already runs Â· no extra round-trip.
import { LeadsBrief } from "./leads/LeadsBrief";
// lead-source hygiene â distinct CALLBACK/PHONE badges vs real web leads
// + the read-only source rollup (counts, duplicates, phone overlap).
import { summarizeLeadSourceHygiene, isCallbackDuplicateLead } from "@shared/leadSource";
import {
  KanbanBoard,
  LeadSourceBadge,
  AttributionChip,
  LeadAge,
  type LeadItem,
} from "./leads/KanbanBoard";
import { MarkContactedButton } from "./leads/MarkContactedButton";
import { LostReasonButton } from "./leads/LostReasonButton";
import { LeadDeliveryLog } from "./leads/LeadDeliveryLog";

export default function LeadsSection() {
  // 2026-05-06 â URL-persistent filters via useUrlFilter.
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
  const { data: leadsData, isLoading, isError, error } = trpc.lead.list.useQuery(undefined, {
    refetchInterval: 30000,
  });
  /**
   * ROS-083 Â· this page had ZERO isError references across 697 lines. A failed
   * read collapsed to five zeros plus a Kanban of empty columns â the landing
   * view for leads, asserting no one has contacted the shop.
   *
   * `unknown` must be tested BEFORE `!leadsData`: with refetchInterval, react-
   * query keeps the last successful data while isError is true, so a
   * `!leadsData`-only guard never fires on the common refetch-failure path.
   */
  const unknown = isError;

  // wave-116d â was `refetch()` on the local query instance. That only
  // refreshed THIS component's lead list, so OverviewSection's lead
  // queue (which is a sibling subscription) stayed stale. Switched to
  // utils.lead.list.invalidate() which propagates to every mounted
  // subscriber. OverviewSection already uses this pattern at L310-314.
  const updateLead = trpc.lead.update.useMutation({
    onSuccess: () => { void utils.lead.list.invalidate(); toast.success("Lead updated"); },
    onError: (err) => toast.error("Failed: " + err.message),
  });

  // Phase 7 contextual action: creates a DRAFT in the approval queue — no
  // callback row exists until a human approves it there (trust ladder).
  const proposeCallback = trpc.proposals.create.useMutation({
    onSuccess: (r) => {
      if (r.created) toast.success("Draft created — review it in Approvals");
      else if ("deduped" in r && r.deduped) toast.message("Already drafted", { description: "An identical proposal is in the queue." });
      else toast.error("Could not draft: " + ("error" in r ? r.error : "unknown"));
      void utils.proposals.list.invalidate();
      void utils.proposals.counts.invalidate();
    },
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
  // wave-181.x Leads Phase 1 Â· code-review agent caught H2: terminal
  // status transitions (lost / completed / closed) were firing with no
  // confirm gate. A misclick on the small Kanban dropdown silently
  // mutated state â lead drops out of working pipeline + may trigger
  // downstream D7/D14 retention SMS via cron. Forward-motion
  // transitions (new â contacted â booked) stay un-gated because
  // they're reversible and high-frequency.
  const handleStatusChange = async (id: number, status: LeadStatus) => {
    const isTerminal = status === "lost" || status === "completed" || status === "closed";
    if (isTerminal) {
      const lead = leadsData?.find((l: LeadItem) => l.id === id);
      const leadName = lead?.name ?? "this lead";
      const messageExtra = status === "lost"
        ? " The list-view's \"Mark Lost\" button is a better path â it captures the lost-reason for the analytics pipeline."
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

  // wave-181.x Leads Phase 5 Â· `applyCategory` + `categoryFilteredLeads`
  // both removed when the dual filter taxonomy was deleted. Chat /
  // Callbacks were duplicates of `sourceFilter`; the search box already
  // indexes the `problem` field so "Cost estimate:" prefix is reachable
  // via search. One taxonomy Â· one source of truth.
  const filteredLeads = useMemo(() => {
    if (!leadsData) return [];
    let list = [...leadsData];
    if (leadFilter !== "all") list = list.filter(l => l.status === leadFilter);
    if (sourceFilter !== "all") list = list.filter(l => l.source === sourceFilter);
    // AG-20 Â· job applicants are not sales leads. The default ("all")
    // view now excludes source==="careers" rows so applicants stop
    // inflating pipeline counts and drip-selection views; picking the
    // "careers" source in the filter IS the Applicants view (the option
    // is always offered â see sourceSet above â and KanbanBoard already
    // badges these rows JOB APPLICANT).
    else list = list.filter(l => l.source !== "careers");
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      // wave-133 â was `l.phone.includes(q)`. LeadItem.phone is
      // string|null; a null phone (valid â phone is optional)
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

  // revenue-attribution wave 2026-06 Â· leads-by-source rollup over the
  // already-fetched array (zero new queries) â copies CallTrackingSection's
  // sourceBreakdown pattern. Null utmSource buckets as "direct/untagged"
  // (matches the existing "direct" convention in Call Tracking). Honest by
  // construction: re-presents fetched rows only, no fabricated history.
  const leadSourceRollup = useMemo(() => {
    if (!leadsData || leadsData.length === 0) return [];
    const sources: Record<string, number> = {};
    (leadsData as LeadItem[]).forEach(l => {
      const src = l.utmSource || "direct/untagged";
      sources[src] = (sources[src] || 0) + 1;
    });
    return Object.entries(sources)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [leadsData]);

  const leadStats = useMemo(() => {
    // null, not zeros â the caller renders an em dash. Unknown before missing:
    // stale data survives a failed refetch, so `!leadsData` alone never fires.
    if (unknown) return null;
    if (!leadsData) return { new: 0, contacted: 0, urgent: 0, total: 0, booked: 0 };
    // wave-128 â operator screenshot bug: a booked lead with
    // urgencyScore=4 was counted in "Urgent". Urgency only matters
    // while the lead is in-flight; once it's booked/completed/closed/
    // lost the lead has been actioned and shouldn't bleed into the
    // urgent counter. Same fix as wave-123 Action Queue (Overview).
    const TERMINAL = new Set(["booked", "completed", "closed", "lost"]);
    const newCount = leadsData.filter((l: LeadItem) => l.status === "new").length;
    const contacted = leadsData.filter((l: LeadItem) => l.status === "contacted").length;
    const booked = leadsData.filter((l: LeadItem) => l.status === "booked").length;
    const urgent = leadsData.filter((l: LeadItem) =>
      (l.urgencyScore ?? 0) >= 4 && !TERMINAL.has(l.status)
    ).length;
    // "Active" total = the three status buckets shown below (New + Contacted +
    // Booked), so the headline always reconciles with the breakdown. Closed/lost
    // leads are finished and aren't surfaced as buckets here.
    return { new: newCount, contacted, urgent, total: newCount + contacted + booked, booked };
  }, [leadsData]);

  // Urgent uncontacted leads â the money bleeder
  const uncontactedLeads = useMemo(() => {
    if (!leadsData) return [];
    return leadsData
      // Callback-linked duplicates are excluded â the same person is already
      // an actionable item in the Callbacks queue; listing them here told
      // the operator to call twice. Voice leads (callbackId null) stay.
      .filter((l: LeadItem) => l.status === "new" && !isCallbackDuplicateLead(l))
      .sort((a: LeadItem, b: LeadItem) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [leadsData]);

  // Source hygiene rollup â read-only. Reuses lead.list (above) + callback.list.
  // No refetchInterval: the Admin shell already polls callback.list at 30s
  // (Admin.tsx), and this observer shares that cache entry â adding our own
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
        subtitle="Inbound leads Â· estimate forms Â· phone-call captures Â· Vapi tire inquiries Â· golden 4-hour response window"
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

      {unknown && (
        <div className="border border-amber-500/40 bg-amber-500/10 p-4 text-[13px] text-amber-400">
          <strong>Leads could not be read.</strong> Everything below is unknown — NOT zero, and nothing here means nobody has contacted the shop. {error?.message}
        </div>
      )}
      <LeadsBrief
        onSlaAction={() => {
          // wave-181.x Leads Phase 2 Â· SLA-breach CTA Â· code-review agent
          // caught M1 (false-affordance risk): banner only renders when
          // uncontactedLeads.length > 0, AND `uncontactedLeads` filters on
          // status==="new" without an age gate. So a 3h-old uncontacted
          // lead would inflate the count and SLA-breach would fire on a
          // sibling 5h lead â visible flash is correct. But if the
          // banner is hidden (zero uncontacted but stale older leads)
          // the scroll target is missing and the CTA silently no-ops.
          // Defensive fallback Â· flip filters to ?status=new&view=list
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
      {/* 2026-05-06 â Active filter chips with one-click clear */}
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
      {/* CRITICAL ALERT â Uncontacted leads with ticking timer.
       *
       * wave-181.x Leads Phase 1 Â· was `animate-pulse-slow` (no Tailwind
       * def Â· silently no-op) Â· replaced with no animation. The red
       * border + red tint is already operator-attention-grabbing Â· a
       * constant pulse on top would be AI-slop visual noise that
       * desensitizes the operator over time. */}
      {uncontactedLeads.length > 0 && (
        <div id="leads-urgent-banner" className="bg-red-500/5 border border-red-500/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-[13px] font-bold text-red-400 tracking-wide">
              {uncontactedLeads.length} LEAD{uncontactedLeads.length > 1 ? "S" : ""} â NOT YET CONTACTED
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

      {/* Stats â wave-127 â clickable filters. Each card sets the
          status filter + flips to list view. Urgent scrolls to the
          red banner (which already surfaces uncontacted leads by age). */}
      {/* wave-181.x Leads Phase 3 Â· audit agent caught grid orphan
          on tablet portrait (iPad common nick admin device) Â· 2-col
          drops "Urgent" tile alone on row 3. Adding md:grid-cols-3
          balances the layout Â· 5 cards split 3+2 on tablet, 5 on
          desktop, 2-row stack on phone. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard
          label="Active Leads"
          value={leadStats ? leadStats.total : "—"}
          icon={<Hash className="w-4 h-4" />}
          color="text-foreground"
          onClick={() => { setLeadFilter("all"); setViewMode("list"); }}
        />
        <StatCard
          label="New (Uncalled)"
          value={leadStats ? leadStats.new : "—"}
          icon={<Users className="w-4 h-4" />}
          color="text-blue-400"
          onClick={() => { setLeadFilter("new"); setViewMode("list"); }}
        />
        <StatCard
          label="Contacted"
          value={leadStats ? leadStats.contacted : "—"}
          icon={<PhoneCall className="w-4 h-4" />}
          color="text-primary"
          onClick={() => { setLeadFilter("contacted"); setViewMode("list"); }}
        />
        <StatCard
          label="Booked"
          value={leadStats ? leadStats.booked : "—"}
          icon={<CheckCircle2 className="w-4 h-4" />}
          color={leadStats ? "text-emerald-400" : "text-foreground"}
          onClick={() => { setLeadFilter("booked"); setViewMode("list"); }}
        />
        <StatCard
          label="Urgent (4-5)"
          value={leadStats ? leadStats.urgent : "—"}
          icon={<AlertTriangle className="w-4 h-4" />}
          color={leadStats ? "text-red-400" : "text-foreground"}
          onClick={() => {
            const banner = document.getElementById("leads-urgent-banner");
            if (banner) {
              banner.scrollIntoView({ behavior: "smooth", block: "start" });
              banner.classList.add("ring-2", "ring-red-400/60");
              setTimeout(() => banner.classList.remove("ring-2", "ring-red-400/60"), 1500);
            } else {
              // No urgent banner means no uncontacted urgent leads â
              // fall back to list view so operator can scan all leads.
              setLeadFilter("all");
              setViewMode("list");
            }
          }}
        />
      </div>

      {/* wave-181.x Leads Phase 5 Â· Category Tabs deleted (chat /
       * callbacks were duplicates of sourceFilter Â· estimates is
       * reachable via search Â· ~30 LOC removed). Operator opt-in. */}

      {/* SOURCE HYGIENE â read-only rollup: where leads come from, which
          rows are caller artifacts, and how many people exist on BOTH the
          Leads and Callbacks surfaces. No actions, no mutations. */}
      {sourceHygiene && sourceHygiene.totalLeads > 0 && (
        <div className="bg-card border border-border/30 rounded-lg px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span
              title="How each lead ENTERED the system (web form, phone, callback artifact) â origin/type cleanliness, not marketing attribution"
              className="text-[10px] font-bold tracking-wider text-foreground/40 uppercase cursor-help"
            >
              Source hygiene
            </span>
            {Object.entries(sourceHygiene.countsByLabel)
              .sort((a, b) => b[1] - a[1])
              .map(([label, count]) => (
                <span key={label} className="font-mono text-[10px] text-foreground/60 uppercase tracking-wider">
                  {/* raw enum values read as developer-speak (FINANCING_PREAPPROVAL) â display with spaces */}
                  {label.replace(/_/g, " ")} <span className="text-foreground font-bold">{count}</span>
                </span>
              ))}
          </div>
          {(sourceHygiene.linkedCallbackDuplicates > 0 || sourceHygiene.phoneOverlapCount > 0 || sourceHygiene.blankSourceLeads > 0) && (
            <div className="mt-2 space-y-1">
              {sourceHygiene.linkedCallbackDuplicates > 0 && (
                <p className="text-[11px] text-amber-400/80">
                  {sourceHygiene.linkedCallbackDuplicates} callback-linked duplicate{sourceHygiene.linkedCallbackDuplicates > 1 ? "s" : ""} â same person also under Call Tracking; excluded from money-risk counts
                </p>
              )}
              {sourceHygiene.phoneOverlapCount > 0 && (
                <p className="text-[11px] text-foreground/50">
                  {sourceHygiene.phoneOverlapCount} phone number{sourceHygiene.phoneOverlapCount > 1 ? "s" : ""} appear{sourceHygiene.phoneOverlapCount > 1 ? "" : "s"} in both Leads and Callbacks
                </p>
              )}
              {sourceHygiene.blankSourceLeads > 0 && (
                <p className="text-[11px] text-red-400/80">
                  {sourceHygiene.blankSourceLeads} lead{sourceHygiene.blankSourceLeads > 1 ? "s" : ""} with a blank source (legacy capture bug) â fix shipped; old rows unaffected
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

      {/* Leads by source Â· revenue-attribution wave 2026-06 Â· compact strip
          over the loaded set (both views). Self-hides when nothing is loaded. */}
      {leadSourceRollup.length > 0 && (
        <div className="bg-card border border-border/30 px-4 py-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span
              title="Marketing attribution â which campaign/channel tag (utm_source) each lead carried; direct/untagged = arrived with no campaign tag"
              className="text-[10px] font-bold tracking-wider uppercase text-foreground/45 shrink-0 cursor-help"
            >
              Leads by source
            </span>
            {leadSourceRollup.map(s => (
              <span key={s.source} className="inline-flex items-center gap-1.5 text-[11px] font-mono text-foreground/65">
                {s.source}
                <span className="font-bold text-foreground tabular-nums">{s.count}</span>
              </span>
            ))}
            <span className="text-[10px] text-foreground/30 ml-auto shrink-0">
              of {leadsData?.length.toLocaleString() ?? 0} loaded leads
            </span>
          </div>
        </div>
      )}

      {/* Kanban View Â· post-Phase-5 uses raw leadsData (Kanban shows
       * all columns as bird's-eye-view Â· list-view applies filters). */}
      {viewMode === "kanban" ? (
        // Kanban is the DEFAULT view, so an unhandled unknown here is the
        // landing screen: six columns of "0 leads" under a banner saying the
        // data could not be read. Suppress the board rather than render columns
        // whose emptiness is unverified.
        unknown ? (
          <div className="border border-amber-500/40 bg-amber-500/10 p-4 text-[13px] text-amber-400">
            The pipeline board is unavailable — column counts would be unknown, not zero.
          </div>
        ) : (
          <KanbanBoard leadsData={leadsData} onUpdate={handleStatusChange} isLoading={isLoading} />
        )
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
          ) : unknown ? (
            // All five stat cards are clickable filters that land here, so
            // without this branch the "No leads" lie is one tap away.
            <EmptyState
              icon={<Users className="w-8 h-8" />}
              title="Leads unavailable"
              subtitle="This list could not be read — it is unknown, not empty."
            />
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
                        <AttributionChip lead={lead} />
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

                      <LeadDeliveryLog leadId={lead.id} />
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
                      {lead.phone && lead.status !== "booked" && lead.status !== "completed" && (
                        <button
                          onClick={() =>
                            proposeCallback.mutate({
                              actionType: "create_callback",
                              title: `Callback: ${lead.name} — flagged from Sales Pipeline`,
                              payload: {
                                name: lead.name,
                                phone: lead.phone,
                                reason: `Flagged from lead #${lead.id}${lead.recommendedService ? ` · ${lead.recommendedService}` : ""}`,
                                sourcePage: "admin-leads",
                              },
                              entityType: "lead",
                              entityId: String(lead.id),
                            })
                          }
                          disabled={proposeCallback.isPending}
                          title="Creates a DRAFT in the approval queue — nothing happens until it is approved there"
                          className="flex items-center gap-2 border border-violet-500/40 text-violet-500 px-4 py-2.5 font-bold text-xs tracking-wide hover:bg-violet-500/10 disabled:opacity-50"
                        >
                          <ClipboardList className="w-4 h-4" /> FLAG CALLBACK
                        </button>
                      )}
                      {(lead.status === "booked" || lead.status === "completed" || lead.status === "closed" || lead.status === "lost") && (
                        <button
                          onClick={async () => {
                            // wave-181.x Leads Phase 1 Â· audit agent
                            // flagged this as a one-tap operator footgun
                            // â reopens a terminal lead back to "new"
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

// âââ CONTENT SECTION ââââââââââââââââââââââââââââââââââââ

