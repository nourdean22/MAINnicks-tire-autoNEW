/**
 * Shop Status — bay grid, ready queue, tech assignment, QC review.
 */
import { useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Loader2, User, MapPin, Play, CheckCircle2, XCircle, Clock, Wrench, Shield, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, ErrorState } from "../shared";

type Tab = "bays" | "queue" | "qc" | "techs";

// Inferred from the tRPC AppRouter — replaces 14 `any` uses in this file
// (admin audit §3 follow-up). When the dispatch router shape changes,
// these types update automatically and the compiler flags every usage.
type DispatchLoad = NonNullable<RouterOutputs["dispatch"]["load"]>;
type Bay = DispatchLoad["bays"][number];
type Tech = DispatchLoad["techs"][number];
type WorkOrderListItem = RouterOutputs["workOrders"]["list"][number];
type DispatchRecommendation = NonNullable<RouterOutputs["dispatch"]["recommend"]>[number];
type QcChecklistItem = NonNullable<RouterOutputs["dispatch"]["getQcChecklist"]>["items"][number];

export default function DispatchSection() {
  const [tab, setTab] = useState<Tab>("bays");

  // wave-admin-audit P3 — single dispatch.load query lifted to the section
  // root. Previously MetricsStrip polled at 30s while BayGrid/ReadyQueue/
  // TechManager polled the SAME query key at 10s — React-Query takes the
  // last-registered interval for a shared key, so the effective rate was
  // unpredictable and the MetricsStrip "30s" comment was dead. One hook at
  // 10s (the real-time shop-floor expectation) feeds every consumer, so the
  // interval is now explicit and consistent. Mirrors WorkOrdersSection's
  // lifted-stats pattern.
  const load = trpc.dispatch.load.useQuery(undefined, { refetchInterval: 10000 });

  const TABS: { id: Tab; label: string }[] = [
    { id: "bays", label: "Bay Grid" },
    { id: "queue", label: "Ready Queue" },
    { id: "qc", label: "QC Review" },
    { id: "techs", label: "Technicians" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Shop Floor"
        subtitle="Bay grid · ready queue · tech assignments · QC review. Dispatch is real-time."
        icon={<Wrench className="w-5 h-5" />}
      />
      {/* Metrics Strip */}
      <MetricsStrip load={load} />

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border/40">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "bays" && <BayGrid load={load} />}
      {tab === "queue" && <ReadyQueue load={load} />}
      {tab === "qc" && <QcReview />}
      {tab === "techs" && (
        <>
          <TechManager load={load} />
          <TeamPerformancePanel />
        </>
      )}
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
  // BayGrid's 10s). stats + qcStats stay local (only this strip reads them);
  // bumped to 10s to match the unified shop-floor cadence.
  const { data: load, isError } = loadQuery;
  const { data: stats } = trpc.workOrders.stats.useQuery(undefined, { refetchInterval: 10000 });
  const { data: qcStats } = trpc.dispatch.qcStats.useQuery(undefined, { refetchInterval: 10000 });

  const clockedIn = load?.techs.filter((t: Tech) => t.clockedIn).length || 0;
  const freeBays = load?.bays.filter((b: Bay) => !b.occupied).length || 0;
  const totalBays = load?.bays.length || 0;

  const metrics = [
    { label: "Techs In", value: clockedIn, color: "text-emerald-400" },
    { label: "Bays Free", value: `${freeBays}/${totalBays}`, color: freeBays === 0 ? "text-red-400" : "text-blue-400" },
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
    // Now: 2 cols mobile, 4 cols sm, 7 cols lg.
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {metrics.map(m => (
        <div key={m.label} className="bg-card border border-border/40 p-3 text-center">
          <div className={`text-xl font-bold ${m.color}`}>{m.value}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{m.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Bay Grid ───────────────────────────────────────
function BayGrid({ load: loadQuery }: { load: DispatchLoadQuery }) {
  // wave-admin-audit P3 — uses the lifted dispatch.load query (was its own
  // 10s subscription). P4 — added the isError branch; pre-fix a load error
  // rendered a blank grid with no signal (only ReadyQueue/QcReview handled it).
  const { data: load, isLoading, isError } = loadQuery;

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  if (isError) return <ErrorState message="Couldn't load the bay grid" onRetry={() => loadQuery.refetch()} />;

  const bays = load?.bays || [];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {bays.map((bay: Bay) => (
        <BayCard key={bay.id} bay={bay} techs={load?.techs || []} />
      ))}
    </div>
  );
}

function BayCard({ bay, techs }: { bay: Bay; techs: Tech[] }) {
  const tech = bay.currentTechId ? techs.find(t => t.id === bay.currentTechId) : null;

  return (
    <div className={`border p-4 transition-colors ${
      bay.occupied
        ? "border-primary/40 bg-primary/5"
        : "border-border/40 bg-card"
    }`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold">{bay.name}</span>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${
          bay.occupied ? "bg-primary/20 text-primary" : "bg-emerald-500/20 text-emerald-400"
        }`}>
          {bay.occupied ? "BUSY" : "FREE"}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">{bay.type.replace(/_/g, " ")}</div>
      {bay.occupied && (
        <div className="mt-2 pt-2 border-t border-border/30 space-y-1">
          {tech && (
            <div className="flex items-center gap-1 text-xs">
              <User className="w-3 h-3" />
              <span>{tech.name}</span>
            </div>
          )}
          <div className="text-[10px] text-muted-foreground truncate">
            WO: {bay.currentWorkOrderId?.slice(0, 8)}...
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Ready Queue ────────────────────────────────────
function ReadyQueue({ load: loadQuery }: { load: DispatchLoadQuery }) {
  const { data: workOrders, isLoading, isError, refetch } = trpc.workOrders.list.useQuery({ status: "ready_for_bay" }, { refetchInterval: 10000 });
  // wave-admin-audit P3 — bays come from the lifted dispatch.load (was a
  // duplicate 10s subscription on the same key).
  const { data: load } = loadQuery;
  const [selectedWo, setSelectedWo] = useState<string | null>(null);

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  if (isError) return <ErrorState message="Couldn't load ready-queue" onRetry={() => refetch()} />;

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
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Ready for Bay ({orders.length})</h3>
        {orders.map((wo: WorkOrderListItem) => (
          <button
            key={wo.id}
            onClick={() => setSelectedWo(wo.id)}
            className={`w-full text-left border rounded-lg p-3 transition-colors ${
              selectedWo === wo.id
                ? "border-primary bg-primary/5"
                : "border-border/40 bg-card hover:border-border"
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-sm">{wo.orderNumber}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  {[wo.vehicleYear, wo.vehicleMake, wo.vehicleModel].filter(Boolean).join(" ")}
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="text-xs text-muted-foreground mt-1 truncate">{wo.serviceDescription}</div>
            {wo.promisedAt && (
              <div className="flex items-center gap-1 mt-1 text-[10px] text-amber-400">
                <Clock className="w-3 h-3" />
                <span>Promise: {new Date(wo.promisedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Assignment panel */}
      {selectedWo && <AssignmentPanel workOrderId={selectedWo} bays={load?.bays || []} />}
    </div>
  );
}

function AssignmentPanel({ workOrderId, bays }: { workOrderId: string; bays: Bay[] }) {
  const { data: recs, isLoading, isError } = trpc.dispatch.recommend.useQuery({ workOrderId });
  const freeBays = bays.filter(b => !b.occupied);
  const [selectedTech, setSelectedTech] = useState<number | null>(null);
  const [selectedBay, setSelectedBay] = useState<number | null>(null);
  const utils = trpc.useUtils();

  // v1.7 audit fix · pre-fix this mutation had no onError handler and
  // no onSuccess toast. A failed dispatch silently re-enabled the
  // button with zero feedback — blocking real-time shop ops if the
  // network blipped or the server rejected. Now both paths surface.
  const assignMut = trpc.dispatch.assign.useMutation({
    onSuccess: () => {
      toast.success("Dispatched");
      utils.dispatch.load.invalidate();
      utils.workOrders.list.invalidate();
      setSelectedTech(null);
      setSelectedBay(null);
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
          <span className="text-xs text-red-400">Couldn't score techs — pick a bay manually.</span>
        ) : (recs || []).length === 0 ? (
          <span className="text-xs text-muted-foreground">No tech recommendations — pick a bay manually.</span>
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

      {/* Bay selection */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">Select Bay</div>
        <div className="flex flex-wrap gap-2">
          {freeBays.map(bay => (
            <button
              key={bay.id}
              onClick={() => setSelectedBay(bay.id)}
              className={`px-3 py-1.5 text-sm border rounded ${
                selectedBay === bay.id ? "border-primary bg-primary/10" : "border-border/30 hover:border-border"
              }`}
            >
              {bay.name}
            </button>
          ))}
          {freeBays.length === 0 && (
            <span className="text-xs text-red-400">No bays available</span>
          )}
        </div>
      </div>

      {/* Assign button */}
      <button
        onClick={() => {
          if (selectedTech && selectedBay) {
            assignMut.mutate({ workOrderId, techId: selectedTech, bayId: selectedBay });
          }
        }}
        disabled={!selectedTech || !selectedBay || assignMut.isPending}
        className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {assignMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        Assign & Dispatch
      </button>
    </div>
  );
}

// ─── QC Review ──────────────────────────────────────
function QcReview() {
  const { data: workOrders, isLoading } = trpc.workOrders.list.useQuery({ status: "qc_review" }, { refetchInterval: 10000 });
  const [selectedWo, setSelectedWo] = useState<string | null>(null);

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  const orders = workOrders || [];

  if (orders.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Shield className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p>No jobs pending QC review</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Awaiting QC ({orders.length})</h3>
        {orders.map((wo: WorkOrderListItem) => (
          <button
            key={wo.id}
            onClick={() => setSelectedWo(wo.id)}
            className={`w-full text-left border rounded-lg p-3 transition-colors ${
              selectedWo === wo.id ? "border-purple-400 bg-purple-500/5" : "border-border/40 bg-card hover:border-border"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{wo.orderNumber}</span>
              <span className="text-xs text-muted-foreground">{wo.assignedTech || "—"}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1 truncate">{wo.serviceDescription}</div>
          </button>
        ))}
      </div>
      {selectedWo && <QcChecklistPanel workOrderId={selectedWo} />}
    </div>
  );
}

function QcChecklistPanel({ workOrderId }: { workOrderId: string }) {
  const { data: checklist, isLoading } = trpc.dispatch.getQcChecklist.useQuery({ workOrderId });
  const utils = trpc.useUtils();

  // wave-152 — were silent on error. A failed QC pass/fail gave the
  // operator zero feedback; they tapped the button + saw nothing happen.
  // assignMut already had the toast pattern (v1.7 audit); these two
  // were missed.
  const passMut = trpc.dispatch.passQc.useMutation({
    onSuccess: () => {
      utils.dispatch.invalidate();
      utils.workOrders.list.invalidate();
      toast.success("QC passed");
    },
    onError: (e) => toast.error(`QC pass failed: ${e.message}`),
  });

  const failMut = trpc.dispatch.failQc.useMutation({
    onSuccess: () => {
      utils.dispatch.invalidate();
      utils.workOrders.list.invalidate();
      toast.info("Sent back for rework");
    },
    onError: (e) => toast.error(`QC fail failed: ${e.message}`),
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  if (!checklist) {
    return (
      <div className="border border-border/40 p-4 bg-card text-center">
        <p className="text-sm text-muted-foreground mb-3">No QC checklist yet</p>
        <CreateQcButton workOrderId={workOrderId} />
      </div>
    );
  }

  const items = (checklist.items ?? []) as QcChecklistItem[];
  const allRequiredPassed = items.filter(i => i.required).every(i => i.passed === true);
  const roadTestOk = !checklist.roadTestRequired || checklist.roadTestCompleted;

  return (
    <div className="border border-border/40 p-4 bg-card space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">QC Checklist</h3>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${
          checklist.status === "passed" ? "bg-emerald-500/20 text-emerald-400" :
          checklist.status === "failed" ? "bg-red-500/20 text-red-400" :
          "bg-purple-500/20 text-purple-400"
        }`}>
          {checklist.status.toUpperCase()}
        </span>
      </div>

      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {items.map((item: QcChecklistItem) => (
          <div key={item.id} className="flex items-center gap-2 text-sm py-1">
            {item.passed === true ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            ) : item.passed === false ? (
              <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            ) : (
              <div className="w-4 h-4 rounded-full border border-border/60 flex-shrink-0" />
            )}
            <span className={item.required ? "" : "text-muted-foreground"}>{item.label}</span>
            {item.required && <span className="text-[9px] text-red-400">REQ</span>}
          </div>
        ))}
      </div>

      {checklist.roadTestRequired && (
        <div className={`flex items-center gap-2 text-sm p-2 rounded border ${
          checklist.roadTestCompleted ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"
        }`}>
          <Wrench className="w-4 h-4" />
          <span>Road Test: {checklist.roadTestCompleted ? "Complete" : "Required"}</span>
        </div>
      )}

      {checklist.status === "pending" || checklist.status === "in_progress" ? (
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => passMut.mutate({ checklistId: checklist.id, reviewedBy: "admin" })}
            disabled={!allRequiredPassed || !roadTestOk || passMut.isPending}
            className="flex-1 py-2 bg-emerald-600 text-white rounded text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1"
          >
            <CheckCircle2 className="w-4 h-4" /> Pass QC
          </button>
          <button
            onClick={() => failMut.mutate({
              checklistId: checklist.id,
              failureReasons: items.filter((i: QcChecklistItem) => i.passed === false).map((i: QcChecklistItem) => i.label),
              correctiveActions: "Rework needed",
              reviewedBy: "admin",
            })}
            disabled={failMut.isPending}
            className="flex-1 py-2 bg-red-600 text-white rounded text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1"
          >
            <XCircle className="w-4 h-4" /> Fail QC
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CreateQcButton({ workOrderId }: { workOrderId: string }) {
  const utils = trpc.useUtils();
  const createMut = trpc.dispatch.createQcChecklist.useMutation({
    onSuccess: () => utils.dispatch.getQcChecklist.invalidate(),
    onError: (e) => toast.error(`QC checklist create failed: ${e.message}`),
  });

  return (
    <button
      onClick={() => createMut.mutate({ workOrderId })}
      disabled={createMut.isPending}
      className="px-4 py-2 bg-purple-600 text-white rounded text-sm"
    >
      {createMut.isPending ? "Creating..." : "Create QC Checklist"}
    </button>
  );
}

// ─── Team Performance (AG-20 · 2026-07-09) ──────────
// dispatch.teamPerformance existed on the server with ZERO UI consumers
// — the operator had no screen showing per-tech performance while
// recommendTech silently scored techs on these very numbers.
function TeamPerformancePanel() {
  const { data, isLoading, isError, refetch } = trpc.dispatch.teamPerformance.useQuery(
    undefined,
    { staleTime: 60_000 },
  );

  if (isLoading) return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  if (isError) return <ErrorState message="Couldn't load team performance" onRetry={() => refetch()} />;

  const techs = data?.techs || [];
  if (techs.length === 0) return null;

  // NB: `??` not `||` on every numeric — a real 0 (0 jobs, 0% QC) must
  // render as 0, never fall through to a fake default (see the
  // qcStats?.passRate regression guard in __tests__/admin.test.tsx).
  return (
    <div className="space-y-2 mt-6">
      <h3 className="text-sm font-medium text-muted-foreground mb-2">30-Day Performance</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {techs.map((t) => (
          <div key={t.techId} className="border border-border/40 p-4 bg-card">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium">{t.name}</span>
              <span className="text-[10px] text-muted-foreground">{t.role || "—"}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
              <div>Jobs: <span className="text-foreground">{t.metrics.jobsCompleted30d ?? 0}</span></div>
              <div>Revenue: <span className="text-foreground">${Math.round(t.metrics.totalRevenue30d ?? 0).toLocaleString()}</span></div>
              <div>QC pass: <span className="text-foreground">{Math.round((t.metrics.qcPassRate ?? 0) * 100)}%</span></div>
              <div>Comebacks: <span className="text-foreground">{Math.round((t.metrics.comebackRate ?? 0) * 100)}%</span></div>
            </div>
          </div>
        ))}
      </div>
      {data?.teamTotals && (
        <div className="text-xs text-muted-foreground pt-1">
          Team: {data.teamTotals.totalJobs ?? 0} jobs · ${Math.round(data.teamTotals.totalRevenue ?? 0).toLocaleString()} · avg QC {Math.round((data.teamTotals.avgQcPassRate ?? 0) * 100)}%
        </div>
      )}
    </div>
  );
}

// ─── Tech Manager ───────────────────────────────────
function TechManager({ load: loadQuery }: { load: DispatchLoadQuery }) {
  // wave-admin-audit P3 — uses the lifted dispatch.load query. P4 — added
  // the isError branch (was a silent empty tech list on a load failure).
  const { data: load, isLoading, isError } = loadQuery;
  const utils = trpc.useUtils();

  // 2026-05-23 · added onError. Tech believes they're clocked in,
  // network blip on shop-floor tablet meant DB never updated — payroll
  // discrepancy with no signal. Now any failure surfaces to the tech.
  const clockInMut = trpc.dispatch.clockIn.useMutation({
    onSuccess: () => utils.dispatch.load.invalidate(),
    onError: (e) => toast.error(`Clock in failed: ${e.message}`),
  });
  const clockOutMut = trpc.dispatch.clockOut.useMutation({
    onSuccess: () => utils.dispatch.load.invalidate(),
    onError: (e) => toast.error(`Clock out failed: ${e.message}`),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  if (isError) return <ErrorState message="Couldn't load technicians" onRetry={() => loadQuery.refetch()} />;

  const techs = load?.techs || [];

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground mb-2">Technicians ({techs.length})</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {techs.map((tech: Tech) => (
          <div key={tech.id} className="border border-border/40 p-4 bg-card">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium">{tech.name}</span>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                tech.clockedIn ? "bg-emerald-500/20 text-emerald-400" : "bg-foreground/10 text-muted-foreground"
              }`}>
                {tech.clockedIn ? "IN" : "OUT"}
              </span>
            </div>

            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>Role: {tech.role || "—"}</div>
              <div>Load: {tech.currentLoad} active job(s)</div>
              <div>Skills: {tech.skills.length > 0 ? tech.skills.join(", ") : "—"}</div>
            </div>

            <div className="mt-3">
              {tech.clockedIn ? (
                <button
                  onClick={() => clockOutMut.mutate({ techId: tech.id })}
                  disabled={clockOutMut.isPending}
                  className="w-full py-1.5 text-xs border border-red-500/30 text-red-400 rounded hover:bg-red-500/10"
                >
                  Clock Out
                </button>
              ) : (
                <button
                  onClick={() => clockInMut.mutate({ techId: tech.id })}
                  disabled={clockInMut.isPending}
                  className="w-full py-1.5 text-xs border border-emerald-500/30 text-emerald-400 rounded hover:bg-emerald-500/10"
                >
                  Clock In
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
