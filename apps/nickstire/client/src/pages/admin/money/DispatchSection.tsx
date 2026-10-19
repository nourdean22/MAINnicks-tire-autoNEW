/**
 * Shop Status — ready queue, tech assignment, QC review.
 *
 * 2026-09-01 (audit, artifact 4 §1.3): the BAY GRID is gone. The `bays` table
 * has update-only writers and no insert or seed anywhere in the repo, so the
 * grid rendered "0/0 bays" forever on the Money page of a shop that
 * CURRENT-TRUTH says has no bay model on purpose. (`work_orders.assignedBay`
 * IS written — by the Work Orders quick-input, as a free-text label with no
 * bay row behind it; the audit's "never written" was wrong, correction #17.)
 * Techs, the ready queue and QC are real and stay.
 *
 * 2026-10-19 (admin prune W1): QC Review and Technicians tabs cut. The
 * technicians, job_assignments and qc_checklists tables have 0 rows ever and
 * neither tab was opened in 14 days. The ready queue stays.
 */
import { useEffect, useRef, useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { readStatus } from "@/lib/queryState";
import { Loader2, Play, CheckCircle2, XCircle, Wrench } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, ErrorState } from "../shared";

// Inferred from the tRPC AppRouter — replaces 14 `any` uses in this file
// (admin audit §3 follow-up). When the dispatch router shape changes,
// these types update automatically and the compiler flags every usage.
type DispatchLoad = NonNullable<RouterOutputs["dispatch"]["load"]>;
type Tech = DispatchLoad["techs"][number];
type WorkOrderListItem = RouterOutputs["workOrders"]["list"][number];
type DispatchRecommendation = NonNullable<RouterOutputs["dispatch"]["recommend"]>[number];
type QcChecklistItem = NonNullable<RouterOutputs["dispatch"]["getQcChecklist"]>["items"][number];

export default function DispatchSection() {
  // wave-admin-audit P3 — single dispatch.load query lifted to the section
  // root. Previously MetricsStrip polled at 30s while BayGrid/ReadyQueue/
  // TechManager polled the SAME query key at 10s — React-Query takes the
  // last-registered interval for a shared key, so the effective rate was
  // unpredictable and the MetricsStrip "30s" comment was dead. One hook at
  // 10s (the real-time shop-floor expectation) feeds every consumer, so the
  // interval is now explicit and consistent. Mirrors WorkOrdersSection's
  // lifted-stats pattern.
  // 10s foreground keeps the bay grid live on the counter screen; the
  // background flag stops the tab from hammering the server (this section
  // alone was ~24 req/min even while hidden behind another admin tab).
  const load = trpc.dispatch.load.useQuery(undefined, {
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Shop Floor"
        subtitle="Ready queue and tech assignment. First-come, no bays or slots, by design."
        icon={<Wrench className="w-5 h-5" />}
      />
      {/* Metrics Strip */}
      <MetricsStrip load={load} />

      <ReadyQueue />

    </div>
  );
}

// Shared shape for the lifted dispatch.load query handed to child views.
// NB: ReturnType<typeof ...useQuery> collapses `data` to `{}` (tRPC's generic
// useQuery loses TData under ReturnType), so type the fields the children
// actually consume against the already-inferred DispatchLoad payload.
type DispatchLoadQuery = {
  data: DispatchLoad | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

// ─── Metrics Strip ──────────────────────────────────
function MetricsStrip({ load: loadQuery }: { load: DispatchLoadQuery }) {
  // wave-admin-audit P3 — dispatch.load now lifted to the section root and
  // passed in (was a duplicate 30s subscription on the same key that fought
  // BayGrid's 10s). stats + qcStats stay local (only this strip reads them).
  const { data: load, isError } = loadQuery;
  // Summary counters don't need bay-grid cadence — 30s halves this strip's
  // request volume with no visible staleness on aggregate numbers.
  const { data: stats } = trpc.workOrders.stats.useQuery(undefined, { refetchInterval: 30_000, refetchIntervalInBackground: false });
  const { data: qcStats } = trpc.dispatch.qcStats.useQuery(undefined, { refetchInterval: 30_000, refetchIntervalInBackground: false });

  const clockedIn = load?.techs.filter((t: Tech) => t.clockedIn).length || 0;

  const metrics = [
    { label: "Techs In", value: clockedIn, color: "text-emerald-400" },
    { label: "In Progress", value: stats?.inProgress || 0, color: "text-primary" },
    // wave-admin-audit P1/P2 — was `active - inProgress`, which had two bugs:
    // (1) the label "Ready Queue" implies the ready_for_bay count but the
    // subtraction counted ALL active-not-in-progress WOs (queue + parts +
    // assigned + qc + pickup), so the strip metric and the "Ready Queue" tab
    // (which queries status:"ready_for_bay") showed different numbers under
    // the same name; (2) it could mislabel/go negative. stats.byStatus carries
    // the real per-status count, so show that — name now matches meaning and
    // the tab.
    { label: "Ready Queue", value: stats?.byStatus?.ready_for_bay || 0, color: "text-amber-400" },
    { label: "QC Pending", value: qcStats?.qcPending || 0, color: "text-purple-400" },
    // ?? not || — a real passRate of 0 (every QC check failed) must show
    // "0%", not fall through to the 100 default. || 0 would fake a green.
    { label: "QC Pass Rate", value: `${qcStats?.passRate ?? 100}%`, color: "text-emerald-400" },
    { label: "Comebacks (30d)", value: qcStats?.comebacks30d || 0, color: (qcStats?.comebacks30d || 0) > 0 ? "text-red-400" : "text-emerald-400" },
  ];

  // wave-admin-audit P4 — was silent on a dispatch.load error (bay/tech
  // metrics just showed 0/0 with no signal). Terse inline marker instead.
  if (isError) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-red-400/70">
        <XCircle className="w-3.5 h-3.5" />
        <span>Shop-floor metrics unavailable</span>
        <button onClick={() => loadQuery.refetch()} className="text-primary hover:underline">Retry</button>
      </div>
    );
  }

  return (
    // wave-155 — was grid-cols-7 fixed. On 375px viewport each cell
    // was ~50px wide × 2 lines of text (font-mono numbers + label).
    // Now: 2 cols mobile, 3 cols sm, 6 cols lg (the bay metric is gone).
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      {metrics.map(m => (
        <div key={m.label} className="bg-card border border-border/40 p-3 text-center">
          <div className={`text-xl font-bold ${m.color}`}>{m.value}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{m.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Row (phones and desktop: admin UI v1 W4, Today's row grammar) ──────
function DispatchRow({ wo, verb, selected, onVerb }: { wo: WorkOrderListItem; verb: string; selected: boolean; onVerb: () => void }) {
  const vehicle = [wo.vehicleYear, wo.vehicleMake, wo.vehicleModel].filter(Boolean).join(" ");
  const who = wo.customerName || "No customer on file";
  const promise = wo.promisedAt ? new Date(wo.promisedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  return (
    <li className={`py-3 flex items-center gap-3 ${selected ? "bg-primary/5" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className="text-[16px] leading-snug font-semibold truncate">{vehicle || "Vehicle not on file"}</p>
        <p className="text-[13px] text-muted-foreground truncate">
          {wo.orderNumber} · {who}
          {wo.assignedTech ? ` · ${wo.assignedTech}` : ""}
          {promise ? ` · promised ${promise}` : ""}
          {wo.serviceDescription ? ` · ${wo.serviceDescription}` : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={onVerb}
        aria-label={`${verb} ${who}`}
        aria-pressed={selected}
        className="min-h-12 px-4 shrink-0 rounded-md bg-secondary text-foreground text-[14px] font-semibold border border-border/60"
      >
        {verb}
      </button>
    </li>
  );
}

/** Brings the panel a row verb opened into view; below lg it renders under the whole list. */
function useScrollPanelIntoView(selected: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [selected]);
  return ref;
}

// ─── Ready Queue ────────────────────────────────────
function ReadyQueue() {
  const readyQuery = trpc.workOrders.list.useQuery({ status: "ready_for_bay" }, { refetchInterval: 10000, refetchIntervalInBackground: false });
  const { data: workOrders, isLoading, isError, refetch } = readyQuery;
  const [selectedWo, setSelectedWo] = useState<string | null>(null);
  const panelRef = useScrollPanelIntoView(selectedWo);

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  if (isError) return <ErrorState message="Couldn't load ready-queue" onRetry={() => refetch()} />;
  // Paused (offline PWA): nothing was read, so never "No jobs waiting".
  if (readStatus(readyQuery).state === "unavailable") return <ErrorState message="Ready queue not checked (offline). Unknown, not empty." onRetry={() => refetch()} />;

  const orders = workOrders || [];

  if (orders.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p>No jobs waiting for a bay</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Queue list */}
      <div>
        <h3 className="text-[13px] font-semibold text-foreground/70 border-b border-border/40 pb-1">Ready for a bay <span className="text-foreground/50 tabular-nums">{orders.length}</span></h3>
        <ul aria-label="Ready for a bay" className="divide-y divide-border/30">
          {orders.map((wo: WorkOrderListItem) => (
            <DispatchRow key={wo.id} wo={wo} verb="Assign" selected={selectedWo === wo.id} onVerb={() => setSelectedWo(wo.id)} />
          ))}
        </ul>
      </div>

      {/* Assignment panel */}
      {selectedWo && <div ref={panelRef} className="scroll-mt-16"><AssignmentPanel workOrderId={selectedWo} /></div>}
    </div>
  );
}

function AssignmentPanel({ workOrderId }: { workOrderId: string }) {
  const { data: recs, isLoading, isError } = trpc.dispatch.recommend.useQuery({ workOrderId });
  const [selectedTech, setSelectedTech] = useState<number | null>(null);
  const utils = trpc.useUtils();

  // v1.7 audit fix · pre-fix this mutation had no onError handler and
  // no onSuccess toast. A failed dispatch silently re-enabled the
  // button with zero feedback — blocking real-time shop ops if the
  // network blipped or the server rejected. Now both paths surface.
  //
  // 2026-09-01: bay selection removed — there are no bays (see the file
  // header). Assignment is tech-only, which is what the shop actually does.
  const assignMut = trpc.dispatch.assign.useMutation({
    onSuccess: () => {
      toast.success("Dispatched");
      utils.dispatch.load.invalidate();
      utils.workOrders.list.invalidate();
      setSelectedTech(null);
    },
    onError: (e) => toast.error(e.message || "Dispatch failed"),
  });

  return (
    <div className="border border-border/40 p-4 bg-card space-y-4">
      <h3 className="text-sm font-medium">Assign Work Order</h3>

      {/* Tech recommendations */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">Recommended Techs</div>
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : isError ? (
          <span className="text-xs text-red-400">Couldn't score techs right now.</span>
        ) : (recs || []).length === 0 ? (
          <span className="text-xs text-muted-foreground">No tech recommendations yet: clock a tech in first.</span>
        ) : (
          <div className="space-y-1">
            {(recs || []).map((rec: DispatchRecommendation) => (
              <button
                key={rec.techId}
                onClick={() => setSelectedTech(rec.techId)}
                className={`w-full text-left border rounded px-3 py-2 text-sm flex items-center justify-between ${
                  selectedTech === rec.techId ? "border-primary bg-primary/10" : "border-border/30 hover:border-border"
                }`}
              >
                <div>
                  <span className="font-medium">{rec.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">Score: {rec.score}</span>
                </div>
                <div className="text-[10px] text-muted-foreground">{rec.reasons.join(" · ")}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Assign button */}
      <button
        onClick={() => {
          if (selectedTech) {
            assignMut.mutate({ workOrderId, techId: selectedTech });
          }
        }}
        disabled={!selectedTech || assignMut.isPending}
        className="w-full min-h-[44px] py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {assignMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        Assign & Dispatch
      </button>
    </div>
  );
}
