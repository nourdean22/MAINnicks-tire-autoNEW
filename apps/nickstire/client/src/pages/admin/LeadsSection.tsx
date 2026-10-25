/**
 * Sales Pipeline. 2026-10-25 (job admin-tabs-pipeline): the section opens on Today's follow-ups
 * (the opportunity queue, five due now beside the total open). The web leads are one list with
 * three filters, Needs response / Waiting / Closed, in place of the kanban: a handful of leads a
 * month is a list. Job applicants are not sales leads, so they live on their own Hiring tab.
 * Old links still land: ?leadsTab=opportunities opens the follow-ups, ?leadsTab=pipeline the leads,
 * and ?tab=opportunities through registry.tsx RETIRED_SECTIONS. Every tab admits the same roles.
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  PageHeader, LoadingState, EmptyState, SectionInsightStrip,
  LEAD_STATUS_CONFIG,
  useUrlFilter,
  type LeadStatus,
} from "./shared";
import { ClipboardList, Search, UserCheck, Users, Calculator } from "lucide-react";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { openWalkInQuote } from "@/components/admin/WalkInQuoteDrawer";
import { LeadsBrief } from "./leads/LeadsBrief";
import { MarkContactedButton } from "./leads/MarkContactedButton";
import { LostReasonButton } from "./leads/LostReasonButton";
import OpportunitiesSection from "./OpportunitiesSection";
import { TechnicianReferralsPanel } from "./leads/TechnicianReferralsPanel";
import { TabBar } from "./shared/table";
import { resolveInnerTab } from "./innerTabs";
import { CandidatesPanel } from "./leads/CandidatesPanel";
import { AiReferralsCard } from "./leads/AiReferralsCard";
import { LEAD_BUCKETS, leadBucket, ago, type LeadBucket } from "./leads/leadInbox";
import { LeadSourceBadge } from "./leads/LeadSourceBadge";
import { LeadDeliveryLog } from "./leads/LeadDeliveryLog";
import { summarizeLeadSourceHygiene } from "@shared/leadSource";

// lead.list rows come from the loosely typed db() handle (any), so the fields read here are named.
interface Lead {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  vehicle?: string | null;
  problem?: string | null;
  recommendedService?: string | null;
  status: string;
  source?: string | null;
  callbackId?: number | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  createdAt: string | Date;
  lastFollowUpAt?: string | Date | null;
}

const STATUSES = Object.keys(LEAD_STATUS_CONFIG) as LeadStatus[];
const TERMINAL: readonly LeadStatus[] = ["completed", "closed", "lost"];
const CHIP = "min-h-[48px] px-4 rounded border text-sm";

export default function LeadsSection() {
  const [tab, setTab] = useUrlFilter<string>("leadsTab", "followups", {
    validate: (v) => resolveInnerTab("leads", v, null),
  });
  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales Pipeline"
        subtitle="Who to call back today, the web leads, and hiring. Called and Texted record what you did outside the admin; this page sends nothing."
        icon={<Users className="w-5 h-5" />}
        actions={
          <button
            type="button"
            onClick={() => openWalkInQuote()}
            className="inline-flex items-center gap-1.5 min-h-[48px] px-3 text-sm font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/15 transition-colors rounded"
          >
            <Calculator className="w-4 h-4" />
            Walk-in quote
          </button>
        }
      />
      <TabBar
        tabs={[
          { id: "followups", label: "Today's follow-ups", icon: <ClipboardList className="w-3.5 h-3.5" /> },
          { id: "leads", label: "Leads", icon: <Users className="w-3.5 h-3.5" /> },
          { id: "hiring", label: "Hiring", icon: <UserCheck className="w-3.5 h-3.5" /> },
        ]}
        activeTab={tab}
        onChange={setTab}
      />
      {tab === "leads" ? (
        <LeadsList />
      ) : tab === "hiring" ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Hiring · job applicants</h2>
          <CandidatesPanel />
        </div>
      ) : (
        <OpportunitiesSection />
      )}
    </div>
  );
}

function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "No name";
}

/** The first line of what the customer wrote; the problem field holds the form message. */
function requestLine(l: Lead): string {
  const first = (l.problem ?? "").split("\n").map((s: string) => s.trim()).find(Boolean);
  return first || l.recommendedService || l.vehicle || "No request text";
}

function LeadsList() {
  const [bucket, setBucket] = useUrlFilter<LeadBucket>("status", "needs", {
    validate: (v) => (LEAD_BUCKETS.some((b) => b.id === v) ? (v as LeadBucket) : null),
  });
  const [searchQuery, setSearchQuery] = useUrlFilter<string>("q", "", { debounce: true });
  const utils = trpc.useUtils();
  const { data: leadsData, isLoading, isError, error } = trpc.lead.list.useQuery(undefined, {
    refetchInterval: 30000,
  });
  // Tested before data: with refetchInterval a failed refetch keeps the last rows while isError is true.
  const unknown = isError;

  const updateLead = trpc.lead.update.useMutation({
    onSuccess: () => { void utils.lead.list.invalidate(); toast.success("Lead updated"); },
    onError: (err) => toast.error("Failed: " + err.message),
  });

  // A finished status leaves the open filters, and a misclick on a phone select is easy: ask first.
  const handleStatusChange = async (l: Lead, status: LeadStatus) => {
    if (TERMINAL.includes(status)) {
      const ok = await confirmDialog({
        title: `Move ${firstName(l.name)} to ${LEAD_STATUS_CONFIG[status].label}?`,
        message: `The lead moves to Closed.${status === "lost" ? " Lost on a contacted lead records why; this does not." : ""}`,
        confirmLabel: `Move to ${LEAD_STATUS_CONFIG[status].label}`,
        cancelLabel: "Cancel",
        tone: status === "lost" ? "danger" : "default",
      });
      if (!ok) return;
    }
    updateLead.mutate({ id: l.id, status });
  };

  // Applicants (source careers) are on the Hiring tab, never counted as sales leads.
  const webLeads = useMemo(() => ((leadsData ?? []) as Lead[]).filter((l) => l.source !== "careers"), [leadsData]);
  const shown = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return webLeads.filter((l) =>
      leadBucket(l.status) === bucket &&
      (!q || [l.name, l.phone, l.email, l.vehicle, l.problem].some((v) => (v ?? "").toLowerCase().includes(q))),
    );
  }, [webLeads, bucket, searchQuery]);

  // Read-only: how leads entered (web, phone, callback) and how many people sit in both Leads and
  // Callbacks. Shares the callback.list cache entry the Admin shell already polls.
  const { data: callbacksData } = trpc.callback.list.useQuery();
  const hygiene = useMemo(
    () => (leadsData && !unknown ? summarizeLeadSourceHygiene(webLeads, callbacksData ?? []) : null),
    [leadsData, webLeads, callbacksData, unknown],
  );

  return (
    <div className="space-y-4">
      <SectionInsightStrip section="leads" />

      {unknown && (
        <div className="border border-amber-500/40 bg-amber-500/10 p-4 text-[13px] text-amber-400">
          <strong>Leads could not be read.</strong> Everything below is unknown: NOT zero, and nothing here means nobody has contacted the shop. {error?.message}
        </div>
      )}
      <LeadsBrief onSlaAction={() => setBucket("needs")} />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter leads">
        {LEAD_BUCKETS.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setBucket(b.id)}
            aria-pressed={bucket === b.id}
            className={`${CHIP} ${bucket === b.id ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border/40 text-foreground/80"}`}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/60" aria-hidden />
        <input
          type="search"
          placeholder="Search name, phone, vehicle or message"
          aria-label="Search leads"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full min-h-[48px] bg-card border border-border/50 text-foreground pl-10 pr-4 text-base placeholder:text-foreground/60 focus:outline-none focus:border-primary/50"
        />
      </div>

      {isLoading ? (
        <LoadingState label="Loading leads..." />
      ) : unknown ? (
        <EmptyState
          icon={<Users className="w-8 h-8" />}
          title="Leads unavailable"
          subtitle="This list could not be read: it is unknown, not empty."
        />
      ) : (
        <>
          <p className="text-sm text-foreground/60">{`${shown.length} of ${webLeads.length} web leads`}</p>
          {shown.length === 0 ? (
            <EmptyState
              icon={<Users className="w-8 h-8" />}
              title="No leads here"
              subtitle="Leads from the website forms and chat appear here."
            />
          ) : (
            <ul className="space-y-3">
              {shown.map((l) => {
                const first = firstName(l.name);
                const touched = ago(l.lastFollowUpAt);
                return (
                  <li key={l.id} className="rounded border border-border/40 p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{first}</span>
                      <LeadSourceBadge lead={l} />
                    </div>
                    <p className="text-sm break-words">{requestLine(l)}</p>
                    <p className="text-xs text-foreground/60">
                      Received {ago(l.createdAt) ?? "time not recorded"} · {touched ? `Last shop touch ${touched}` : "No shop touch recorded"}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {l.phone && (
                        <a href={`tel:${l.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center min-h-[48px] text-sm underline">
                          {l.phone}
                        </a>
                      )}
                      {l.status === "new" && <MarkContactedButton leadId={l.id} />}
                      {l.status === "contacted" && <LostReasonButton leadId={l.id} />}
                      <select
                        aria-label={`Change status for ${first}`}
                        value={l.status}
                        disabled={updateLead.isPending}
                        onChange={(e) => void handleStatusChange(l, e.target.value as LeadStatus)}
                        className="min-h-[48px] px-3 rounded bg-card border border-border/50 text-base text-foreground"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>{LEAD_STATUS_CONFIG[s].label}</option>
                        ))}
                      </select>
                    </div>
                    <LeadDeliveryLog leadId={l.id} />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {hygiene && hygiene.totalLeads > 0 && (
        <div className="rounded border border-border/40 px-3 py-2 text-xs text-foreground/60 space-y-1">
          <p>
            {`How the ${hygiene.totalLeads} leads arrived: `}
            {Object.entries(hygiene.countsByLabel)
              .sort((a, b) => b[1] - a[1])
              .map(([label, count]) => `${label.replace(/_/g, " ").toLowerCase()} ${count}`)
              .join(", ")}
          </p>
          {hygiene.phoneOverlapCount > 0 && (
            <p>{`${hygiene.phoneOverlapCount} of these phone numbers also appear under Callbacks.`}</p>
          )}
        </div>
      )}

      <TechnicianReferralsPanel />
      <AiReferralsCard />
    </div>
  );
}
