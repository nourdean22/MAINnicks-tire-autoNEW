/**
 * Bay Dispatch Board — bay grid, ready queue, tech assignment, QC review.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Loader2, User, MapPin, Play, CheckCircle2, XCircle, Clock, Wrench, AlertTriangle, Shield, ChevronRight, RotateCcw } from "lucide-react";

type Tab = "bays" | "queue" | "qc" | "techs";

export default function DispatchSection() {
  const [tab, setTab] = useState<Tab>("bays");

  const TABS: { id: Tab; label: string }[] = [
    { id: "bays", label: "Bay Grid" },
    { id: "queue", label: "Ready Queue" },
    { id: "qc", label: "QC Review" },
    { id: "techs", label: "Technicians" },
  ];

  return (
    <div className="space-y-4">
      {/* Metrics Strip */}
      <MetricsStrip />

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

      {tab === "bays" && <BayGrid />}
      {tab === "queue" && <ReadyQueue />}
      {tab === "qc" && <QcReview />}
      {tab === "techs" && <TechManager />}
    </div>
  );
}

// ─── Metrics Strip ──────────────────────────────────
function MetricsStrip() {
  const { data: load } = trpc.dispatch.load.useQuery(undefined, { refetchInterval: 10000 });
  const { data: stats } = trpc.workOrders.stats.useQuery(undefined, { refetchInterval: 10000 });
  const { data: qcStats } = trpc.dispatch.qcStats.useQuery(undefined, { refetchInterval: 10000 });

  const clockedIn = load?.techs.filter(t => t.clockedIn).length || 0;
  const freeBays = load?.bays.filter(b => !b.occupied).length || 0;
  const totalBays = load?.bays.length || 0;

  const metrics = [
    { label: "Techs In", value: clockedIn, color: "text-emerald-400" },
    { label: "Bays Free", value: `${freeBays}/${totalBays}`, color: freeBays === 0 ? "text-red-400" : "text-blue-400" },
    { label: "In Progress", value: stats?.inProgress || 0, color: "text-primary" },
    { label: "Ready Queue", value: (stats?.active || 0) - (stats?.inProgress || 0), color: "text-amber-400" },
    { label: "QC Pending", value: qcStats?.qcPending || 0, color: "text-purple-400" },
    { label: "QC Pass Rate", value: `${qcStats?.passRate || 100}%`, color: "text-emerald-400" },
    { label: "Comebacks (30d)", value: qcStats?.comebacks30d || 0, color: (qcStats?.comebacks30d || 0) > 0 ? "text-red-400" : "text-emerald-400" },
  ];

  return (
    <div className="grid grid-cols-7 gap-2">
      {metrics.map(m => (
        <div key={m.label} className="bg-card border border-border/40 rounded-lg p-3 text-center">
          <div className={`text-xl font-bold ${m.color}`}>{m.value}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{m.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Bay Grid ───────────────────────────────────────
function BayGrid() {
  const { data: load, isLoading } = trpc.dispatch.load.useQuery(undefined, { refetchInterval: 10000 });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  const bays = load?.bays || [];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {bays.map(bay => (
        <BayCard key={bay.id} bay={bay} techs={load?.techs || []} />
      ))}
    </div>
  );
}

function BayCard({ bay, techs }: { bay: any; techs: any[] }) {
  const tech = bay.currentTechId ? techs.find(t => t.id === bay.currentTechId) : null;

  return (
    <div className={`border rounded-lg p-4 transition-colors ${
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
function ReadyQueue() {
  const { data: workOrders, isLoading } = trpc.workOrders.list.useQuery({ status: "ready_for_bay" }, { refetchInterval: 10000 });
  const { data: load } = trpc.dispatch.load.useQuery(undefined, { refetchInterval: 10000 });
  const [selectedWo, setSelectedWo] = useState<string | null>(null);

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  const orders = (workOrders as any[]) || [];

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
        {orders.map((wo: any) => (
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

function AssignmentPanel({ workOrderId, bays }: { workOrderId: string; bays: any[] }) {
  const { data: recs, isLoading } = trpc.dispatch.recommend.useQuery({ workOrderId });
  const freeBays = bays.filter(b => !b.occupied);
  const [selectedTech, setSelectedTech] = useState<number | null>(null);
  const [selectedBay, setSelectedBay] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const assignMut = trpc.dispatch.assign.useMutation({
    onSuccess: () => {
      utils.dispatch.load.invalidate();
      utils.workOrders.list.invalidate();
      setSelectedTech(null);
      setSelectedBay(null);
    },
  });

  return (
    <div className="border border-border/40 rounded-lg p-4 bg-card space-y-4">
      <h3 className="text-sm font-medium">Assign Work Order</h3>

      {/* Tech recommendations */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">Recommended Techs</div>
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <div className="space-y-1">
            {(recs || []).map((rec: any) => (
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

  const orders = (workOrders as any[]) || [];

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
        {orders.map((wo: any) => (
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

  const passMut = trpc.dispatch.passQc.useMutation({
    onSuccess: () => {
      utils.dispatch.invalidate();
      utils.workOrders.list.invalidate();
    },
  });

  const failMut = trpc.dispatch.failQc.useMutation({
    onSuccess: () => {
      utils.dispatch.invalidate();
      utils.workOrders.list.invalidate();
    },
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  if (!checklist) {
    return (
      <div className="border border-border/40 rounded-lg p-4 bg-card text-center">
        <p className="text-sm text-muted-foreground mb-3">No QC checklist yet</p>
        <CreateQcButton workOrderId={workOrderId} />
      </div>
    );
  }

  const items = (checklist.items as any[]) || [];
  const allRequiredPassed = items.filter(i => i.required).every(i => i.passed === true);
  const roadTestOk = !checklist.roadTestRequired || checklist.roadTestCompleted;

  return (
    <div className="border border-border/40 rounded-lg p-4 bg-card space-y-3">
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
        {items.map((item: any) => (
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
              failureReasons: items.filter((i: any) => i.passed === false).map((i: any) => i.label),
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

// ─── Tech Manager ───────────────────────────────────
function TechManager() {
  const { data: load, isLoading } = trpc.dispatch.load.useQuery(undefined, { refetchInterval: 10000 });
  const utils = trpc.useUtils();

  const clockInMut = trpc.dispatch.clockIn.useMutation({
    onSuccess: () => utils.dispatch.load.invalidate(),
  });
  const clockOutMut = trpc.dispatch.clockOut.useMutation({
    onSuccess: () => utils.dispatch.load.invalidate(),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  const techs = load?.techs || [];

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground mb-2">Technicians ({techs.length})</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {techs.map(tech => (
          <div key={tech.id} className="border border-border/40 rounded-lg p-4 bg-card">
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
