/**
 * Work Orders Section — Kanban board + detail drawer.
 * Columns grouped by lifecycle phase, cards show priority/timer/blocker/tech.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  Wrench, Clock, AlertTriangle, User, ChevronRight, Plus, RefreshCw,
  Package, Truck, CheckCircle2, XCircle, Timer, Phone, MapPin,
  ArrowRight, Filter, BarChart3, Loader2, Search, TrendingUp,
} from "lucide-react";

// ─── Status columns for kanban ───────────────────────────
const KANBAN_COLUMNS = [
  {
    id: "queue",
    label: "Queue",
    statuses: ["approved", "parts_needed"],
    color: "border-blue-500/40",
    headerBg: "bg-blue-500/10",
  },
  {
    id: "parts",
    label: "Parts",
    statuses: ["parts_ordered", "parts_partial", "parts_received"],
    color: "border-amber-500/40",
    headerBg: "bg-amber-500/10",
  },
  {
    id: "shop",
    label: "In Shop",
    statuses: ["ready_for_bay", "assigned", "in_progress"],
    color: "border-primary/40",
    headerBg: "bg-primary/10",
  },
  {
    id: "review",
    label: "QC / Pickup",
    statuses: ["qc_review", "ready_for_pickup", "customer_notified"],
    color: "border-emerald-500/40",
    headerBg: "bg-emerald-500/10",
  },
  {
    id: "done",
    label: "Done",
    statuses: ["picked_up", "invoiced", "closed"],
    color: "border-foreground/10",
    headerBg: "bg-foreground/5",
  },
];

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft", approved: "Approved", parts_needed: "Parts Needed",
  parts_ordered: "Parts Ordered", parts_partial: "Parts Partial",
  parts_received: "Parts Ready", ready_for_bay: "Ready for Bay",
  assigned: "Assigned", in_progress: "In Progress", qc_review: "QC Review",
  ready_for_pickup: "Ready for Pickup", customer_notified: "Notified",
  picked_up: "Picked Up", invoiced: "Invoiced", closed: "Closed",
  on_hold: "On Hold", cancelled: "Cancelled",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "text-foreground/50", approved: "text-blue-400",
  parts_needed: "text-amber-400", parts_ordered: "text-amber-400",
  parts_partial: "text-amber-400", parts_received: "text-emerald-400",
  ready_for_bay: "text-emerald-400", assigned: "text-blue-400",
  in_progress: "text-primary", qc_review: "text-purple-400",
  ready_for_pickup: "text-emerald-400", customer_notified: "text-emerald-400",
  picked_up: "text-emerald-400", invoiced: "text-emerald-400",
  closed: "text-foreground/40", on_hold: "text-amber-400", cancelled: "text-red-400",
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  emergency: { label: "EMERGENCY", color: "text-red-400", bgColor: "bg-red-500/10 border-red-500/30" },
  high: { label: "HIGH", color: "text-amber-400", bgColor: "bg-amber-500/10 border-amber-500/30" },
  normal: { label: "NORMAL", color: "text-foreground/50", bgColor: "bg-foreground/5 border-border/20" },
  low: { label: "LOW", color: "text-foreground/30", bgColor: "bg-foreground/5 border-border/10" },
};

function formatTimeAgo(date: Date | string | null): string {
  if (!date) return "";
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function formatPromiseTime(date: Date | string | null): { text: string; overdue: boolean } {
  if (!date) return { text: "", overdue: false };
  const diff = new Date(date).getTime() - Date.now();
  const overdue = diff < 0;
  const absDiff = Math.abs(diff);
  const hrs = Math.floor(absDiff / 3600000);
  const mins = Math.floor((absDiff % 3600000) / 60000);
  if (hrs < 1) return { text: `${mins}m ${overdue ? "over" : "left"}`, overdue };
  if (hrs < 24) return { text: `${hrs}h ${overdue ? "over" : "left"}`, overdue };
  return { text: `${Math.floor(hrs / 24)}d ${overdue ? "over" : "left"}`, overdue };
}

// ─── Work Order Card ─────────────────────────────────────
function WOCard({ wo, onClick }: { wo: any; onClick: () => void }) {
  const promise = formatPromiseTime(wo.promisedAt);
  const prio = PRIORITY_CONFIG[wo.priority] || PRIORITY_CONFIG.normal;
  const age = formatTimeAgo(wo.createdAt);

  return (
    <button
      onClick={onClick}
      className="stagger-in w-full text-left bg-card border border-border/40 rounded-lg p-3 hover:border-primary/30 hover:bg-card/80 transition-all group"
    >
      {/* Header: order number + priority */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-mono font-semibold text-foreground/80">{wo.orderNumber}</span>
        <span className={`text-[9px] font-bold tracking-widest px-1.5 py-0.5 rounded border ${prio.bgColor} ${prio.color}`}>
          {prio.label}
        </span>
      </div>

      {/* Service description */}
      <p className="text-[11px] text-foreground/70 line-clamp-1 mb-2">
        {wo.serviceDescription || wo.customerComplaint || "No description"}
      </p>

      {/* Vehicle info */}
      {(wo.vehicleYear || wo.vehicleMake) && (
        <div className="text-[10px] text-foreground/40 mb-2 flex items-center gap-1">
          <MapPin className="w-3 h-3" />
          {[wo.vehicleYear, wo.vehicleMake, wo.vehicleModel].filter(Boolean).join(" ")}
        </div>
      )}

      {/* Bottom row: status + tech + timer */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-medium ${STATUS_COLORS[wo.status] || "text-foreground/40"}`}>
          {STATUS_LABELS[wo.status] || wo.status}
        </span>

        {wo.assignedTech && (
          <span className="text-[10px] text-foreground/40 flex items-center gap-0.5">
            <User className="w-2.5 h-2.5" /> {wo.assignedTech}
          </span>
        )}

        {wo.assignedBay && (
          <span className="text-[10px] text-foreground/40">Bay {wo.assignedBay}</span>
        )}

        {wo.blockerType && (
          <span className="text-[10px] text-red-400 flex items-center gap-0.5">
            <AlertTriangle className="w-2.5 h-2.5" /> {wo.blockerType.replace("waiting_", "").replace("_", " ")}
          </span>
        )}

        <span className="ml-auto text-[10px] text-foreground/30">{age}</span>
      </div>

      {/* Promise time bar */}
      {promise.text && (
        <div className={`mt-2 text-[10px] font-medium flex items-center gap-1 ${promise.overdue ? "text-red-400" : "text-emerald-400"}`}>
          <Timer className="w-3 h-3" /> {promise.text}
        </div>
      )}
    </button>
  );
}

// ─── Detail Drawer ──────────────────────────────────────
function WorkOrderDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: wo, isLoading } = trpc.workOrders.getById.useQuery({ id });
  const utils = trpc.useUtils();
  const advanceStatus = trpc.workOrders.advanceStatus.useMutation({
    onSuccess: () => { utils.workOrders.list.invalidate(); utils.workOrders.getById.invalidate({ id }); },
  });
  const updateFields = trpc.workOrders.updateFields.useMutation({
    onSuccess: () => { utils.workOrders.getById.invalidate({ id }); },
  });

  const updatePart = trpc.workOrders.updatePartStatus.useMutation({
    onSuccess: () => { utils.workOrders.getById.invalidate({ id }); utils.workOrders.pendingParts.invalidate(); },
  });
  const [techInput, setTechInput] = useState("");
  const [bayInput, setBayInput] = useState("");

  if (isLoading) return (
    <div className="fixed inset-0 z-50 flex">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="ml-auto w-full max-w-lg bg-background border-l border-border/40 p-6 overflow-y-auto relative z-10">
        <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-primary/60" /></div>
      </div>
    </div>
  );

  if (!wo) return null;

  const promise = formatPromiseTime(wo.promisedAt);
  const prio = PRIORITY_CONFIG[wo.priority] || PRIORITY_CONFIG.normal;

  // Next status suggestions based on current
  const nextStatuses: { status: string; label: string }[] = [];
  const s = wo.status;
  if (s === "approved") nextStatuses.push({ status: "parts_needed", label: "Parts Needed" }, { status: "ready_for_bay", label: "Ready for Bay" });
  if (s === "parts_needed") nextStatuses.push({ status: "parts_ordered", label: "Parts Ordered" });
  if (s === "parts_ordered" || s === "parts_partial") nextStatuses.push({ status: "parts_received", label: "All Parts In" });
  if (s === "parts_received" || s === "ready_for_bay") nextStatuses.push({ status: "assigned", label: "Assign Tech" }, { status: "in_progress", label: "Start Work" });
  if (s === "assigned") nextStatuses.push({ status: "in_progress", label: "Start Work" });
  if (s === "in_progress") nextStatuses.push({ status: "qc_review", label: "QC Review" }, { status: "ready_for_pickup", label: "Ready for Pickup" });
  if (s === "qc_review") nextStatuses.push({ status: "ready_for_pickup", label: "Ready for Pickup" });
  if (s === "ready_for_pickup" || s === "customer_notified") nextStatuses.push({ status: "picked_up", label: "Picked Up" });
  if (s === "picked_up") nextStatuses.push({ status: "invoiced", label: "Invoiced" });
  if (s === "invoiced") nextStatuses.push({ status: "closed", label: "Close" });
  // Always allow hold/cancel on active
  if (!["picked_up", "invoiced", "closed", "cancelled"].includes(s)) {
    nextStatuses.push({ status: "on_hold", label: "Put on Hold" }, { status: "cancelled", label: "Cancel" });
  }
  if (s === "on_hold") nextStatuses.push({ status: "approved", label: "Resume" });

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="ml-auto w-full max-w-lg bg-background border-l border-border/40 overflow-y-auto relative z-10">
        {/* Header */}
        <div className="sticky top-0 bg-background/95 backdrop-blur border-b border-border/30 px-5 py-4 flex items-center justify-between">
          <div>
            <span className="font-mono font-bold text-sm">{wo.orderNumber}</span>
            <span className={`ml-2 text-[10px] font-bold tracking-widest px-1.5 py-0.5 rounded border ${prio.bgColor} ${prio.color}`}>
              {prio.label}
            </span>
          </div>
          <button onClick={onClose} className="text-foreground/40 hover:text-foreground"><XCircle className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* Status + promise */}
          <div className="flex items-center gap-3">
            <span className={`text-sm font-semibold ${STATUS_COLORS[wo.status]}`}>{STATUS_LABELS[wo.status]}</span>
            {promise.text && (
              <span className={`text-xs flex items-center gap-1 ${promise.overdue ? "text-red-400" : "text-emerald-400"}`}>
                <Timer className="w-3.5 h-3.5" /> {promise.text}
              </span>
            )}
          </div>

          {/* Blocker */}
          {wo.blockerType && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-semibold text-red-400">{wo.blockerType.replace(/_/g, " ").toUpperCase()}</div>
                {wo.blockerNote && <div className="text-xs text-red-300/70 mt-0.5">{wo.blockerNote}</div>}
                <div className="text-[10px] text-red-300/50 mt-1">Since {formatTimeAgo(wo.blockerSince)} ago</div>
              </div>
            </div>
          )}

          {/* Vehicle + Service */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-card border border-border/30 rounded-lg p-3">
              <div className="text-[10px] text-foreground/40 mb-1">VEHICLE</div>
              <div className="text-xs font-medium">
                {[wo.vehicleYear, wo.vehicleMake, wo.vehicleModel].filter(Boolean).join(" ") || "—"}
              </div>
              {wo.vehicleVin && <div className="text-[10px] text-foreground/30 mt-0.5 font-mono">{wo.vehicleVin}</div>}
            </div>
            <div className="bg-card border border-border/30 rounded-lg p-3">
              <div className="text-[10px] text-foreground/40 mb-1">SERVICE</div>
              <div className="text-xs font-medium line-clamp-2">{wo.serviceDescription || "—"}</div>
            </div>
          </div>

          {/* Quick assign */}
          <div className="flex gap-2">
            <div className="flex-1">
              <input
                className="w-full bg-card border border-border/30 rounded px-2.5 py-1.5 text-xs"
                placeholder={wo.assignedTech || "Assign tech..."}
                value={techInput}
                onChange={e => setTechInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && techInput.trim()) {
                    updateFields.mutate({ id, assignedTech: techInput.trim() });
                    setTechInput("");
                  }
                }}
              />
            </div>
            <div className="w-20">
              <input
                className="w-full bg-card border border-border/30 rounded px-2.5 py-1.5 text-xs"
                placeholder={wo.assignedBay || "Bay #"}
                value={bayInput}
                onChange={e => setBayInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && bayInput.trim()) {
                    updateFields.mutate({ id, assignedBay: bayInput.trim() });
                    setBayInput("");
                  }
                }}
              />
            </div>
          </div>

          {/* Status advance buttons */}
          <div>
            <div className="text-[10px] font-semibold text-foreground/40 tracking-wide mb-2">ADVANCE STATUS</div>
            <div className="flex flex-wrap gap-1.5">
              {nextStatuses.map(ns => (
                <button
                  key={ns.status}
                  onClick={() => advanceStatus.mutate({ id, status: ns.status })}
                  disabled={advanceStatus.isPending}
                  className={`text-[11px] font-medium px-2.5 py-1.5 rounded border transition-colors ${
                    ns.status === "cancelled" ? "border-red-500/30 text-red-400 hover:bg-red-500/10" :
                    ns.status === "on_hold" ? "border-amber-500/30 text-amber-400 hover:bg-amber-500/10" :
                    "border-border/40 text-foreground/70 hover:bg-primary/10 hover:border-primary/30"
                  }`}
                >
                  {ns.label}
                </button>
              ))}
            </div>
          </div>

          {/* Line items with part controls */}
          {wo.items?.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-foreground/40 tracking-wide mb-2">LINE ITEMS ({wo.items.length})</div>
              <div className="space-y-1.5">
                {wo.items.map((item: any) => {
                  const hasPart = item.partStatus && item.partStatus !== "not_needed";
                  const partNext = hasPart ? (
                    item.partStatus === "needed" ? [{ s: "ordered", l: "Mark Ordered" }] :
                    item.partStatus === "ordered" ? [{ s: "received", l: "Mark Received" }] :
                    item.partStatus === "received" ? [{ s: "installed", l: "Mark Installed" }] :
                    []
                  ) : [];

                  return (
                    <div key={item.id} className="bg-card border border-border/30 rounded-lg p-2.5">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{item.description}</div>
                          <div className="text-[10px] text-foreground/40 flex items-center gap-2 mt-0.5">
                            <span>{item.type}</span>
                            <span>Qty: {item.quantity}</span>
                            <span>${Number(item.total || 0).toFixed(2)}</span>
                            {item.partNumber && <span className="font-mono">#{item.partNumber}</span>}
                          </div>
                        </div>
                        {hasPart && (
                          <span className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded ${
                            item.partStatus === "received" || item.partStatus === "installed" ? "bg-emerald-500/10 text-emerald-400" :
                            item.partStatus === "ordered" ? "bg-amber-500/10 text-amber-400" :
                            "bg-blue-500/10 text-blue-400"
                          }`}>
                            {item.partStatus.toUpperCase()}
                          </span>
                        )}
                        {item.approved === false && (
                          <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">DECLINED</span>
                        )}
                      </div>
                      {/* Part pipeline controls */}
                      {hasPart && (
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          {item.supplierName && (
                            <span className="text-[10px] text-foreground/30 flex items-center gap-0.5">
                              <Truck className="w-2.5 h-2.5" /> {item.supplierName}
                            </span>
                          )}
                          {item.partEta && (
                            <span className="text-[10px] text-foreground/30">
                              ETA: {new Date(item.partEta).toLocaleDateString()}
                            </span>
                          )}
                          {partNext.map(pn => (
                            <button
                              key={pn.s}
                              onClick={() => updatePart.mutate({ lineId: item.id, status: pn.s })}
                              disabled={updatePart.isPending}
                              className="text-[10px] font-medium px-2 py-1 rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors ml-auto"
                            >
                              {pn.l}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Transitions / History */}
          {wo.transitions?.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-foreground/40 tracking-wide mb-2">HISTORY</div>
              <div className="space-y-1">
                {wo.transitions.slice(0, 15).map((t: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] text-foreground/50">
                    <span className="text-foreground/30 w-10 shrink-0">{formatTimeAgo(t.createdAt)}</span>
                    <ArrowRight className="w-2.5 h-2.5 text-foreground/20" />
                    <span className={STATUS_COLORS[t.toStatus] || ""}>{STATUS_LABELS[t.toStatus] || t.toStatus}</span>
                    {t.changedBy && <span className="text-foreground/30">by {t.changedBy}</span>}
                    {t.note && <span className="text-foreground/20 truncate">— {t.note}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tech notes */}
          {wo.techNotes && (
            <div>
              <div className="text-[10px] font-semibold text-foreground/40 tracking-wide mb-1">TECH NOTES</div>
              <div className="text-xs text-foreground/60 bg-card border border-border/30 rounded-lg p-3">{wo.techNotes}</div>
            </div>
          )}

          {/* Financial summary */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-card border border-border/30 rounded-lg p-2.5 text-center">
              <div className="text-[10px] text-foreground/40">Quoted</div>
              <div className="text-sm font-bold">${Number(wo.quotedTotal || 0).toFixed(2)}</div>
            </div>
            <div className="bg-card border border-border/30 rounded-lg p-2.5 text-center">
              <div className="text-[10px] text-foreground/40">Actual</div>
              <div className="text-sm font-bold">${Number(wo.total || 0).toFixed(2)}</div>
            </div>
            <div className="bg-card border border-border/30 rounded-lg p-2.5 text-center">
              <div className="text-[10px] text-foreground/40">Margin</div>
              <div className={`text-sm font-bold ${Number(wo.total || 0) > Number(wo.quotedTotal || 0) ? "text-emerald-400" : "text-foreground/60"}`}>
                {wo.quotedTotal && Number(wo.quotedTotal) > 0
                  ? `${(((Number(wo.total || 0) - Number(wo.quotedTotal)) / Number(wo.quotedTotal)) * 100).toFixed(0)}%`
                  : "—"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Stats Bar ──────────────────────────────────────────
function StatsBar() {
  const { data: stats } = trpc.workOrders.stats.useQuery(undefined, { refetchInterval: 15000 });
  if (!stats) return null;

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <StatPill label="Active" value={stats.active} color="text-blue-400" />
      <StatPill label="In Progress" value={stats.inProgress} color="text-primary" />
      <StatPill label="Blocked" value={stats.blocked} color="text-red-400" alert={stats.blocked > 0} />
      <StatPill label="Overdue" value={stats.overdue} color="text-red-400" alert={stats.overdue > 0} />
      <StatPill label="Pickup Queue" value={stats.readyForPickup} color="text-emerald-400" />
      <div className="ml-auto text-xs text-foreground/40">
        ${stats.totalValueInProgress.toLocaleString()} in shop
      </div>
    </div>
  );
}

function StatPill({ label, value, color, alert }: { label: string; value: number; color: string; alert?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 ${alert ? "animate-pulse" : ""}`}>
      <span className="text-[10px] text-foreground/40">{label}</span>
      <span className={`text-sm font-bold ${color}`}>{value}</span>
    </div>
  );
}

// ─── Pending Parts View ─────────────────────────────────
function PendingPartsView({ onSelectWO }: { onSelectWO: (id: string) => void }) {
  const { data: parts, isLoading } = trpc.workOrders.pendingParts.useQuery(undefined, { refetchInterval: 15000 });
  const utils = trpc.useUtils();
  const updatePart = trpc.workOrders.updatePartStatus.useMutation({
    onSuccess: () => { utils.workOrders.pendingParts.invalidate(); utils.workOrders.list.invalidate(); },
  });

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary/60" /></div>;
  if (!parts?.length) return <div className="text-center py-20 text-foreground/30 text-sm">No pending parts</div>;

  const bySupplier = parts.reduce((acc: Record<string, any[]>, p: any) => {
    const key = p.supplierName || "Unassigned";
    (acc[key] = acc[key] || []).push(p);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="text-xs text-foreground/40">{parts.length} parts awaiting delivery across {Object.keys(bySupplier).length} suppliers</div>
      {Object.entries(bySupplier).map(([supplier, items]) => (
        <div key={supplier} className="border border-border/30 rounded-lg overflow-hidden">
          <div className="bg-card px-3 py-2 flex items-center justify-between border-b border-border/20">
            <span className="text-xs font-semibold flex items-center gap-1.5"><Truck className="w-3.5 h-3.5 text-foreground/40" /> {supplier}</span>
            <span className="text-[10px] text-foreground/40">{(items as any[]).length} parts</span>
          </div>
          <div className="divide-y divide-border/10">
            {(items as any[]).map((p: any) => (
              <div key={p.lineId} className="px-3 py-2 flex items-center gap-3 hover:bg-foreground/[0.02]">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{p.description}</div>
                  <div className="text-[10px] text-foreground/40 flex items-center gap-2 mt-0.5">
                    <button onClick={() => onSelectWO(p.workOrderId)} className="text-primary hover:underline">{p.orderNumber}</button>
                    {p.partEta && <span>ETA: {new Date(p.partEta).toLocaleDateString()}</span>}
                    {p.supplierOrderRef && <span className="font-mono">Ref: {p.supplierOrderRef}</span>}
                  </div>
                </div>
                <span className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded ${
                  p.partStatus === "ordered" ? "bg-amber-500/10 text-amber-400" : "bg-blue-500/10 text-blue-400"
                }`}>
                  {p.partStatus?.toUpperCase()}
                </span>
                {p.partStatus === "ordered" && (
                  <button
                    onClick={() => updatePart.mutate({ lineId: p.lineId, status: "received" })}
                    disabled={updatePart.isPending}
                    className="text-[10px] font-medium px-2 py-1 rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                  >
                    Received
                  </button>
                )}
                {p.partStatus === "needed" && (
                  <button
                    onClick={() => updatePart.mutate({ lineId: p.lineId, status: "ordered" })}
                    disabled={updatePart.isPending}
                    className="text-[10px] font-medium px-2 py-1 rounded border border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                  >
                    Mark Ordered
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Blockers & Overdue View ────────────────────────────
function BlockersView({ onSelectWO }: { onSelectWO: (id: string) => void }) {
  const { data: blocked } = trpc.workOrders.blocked.useQuery(undefined, { refetchInterval: 15000 });
  const { data: overdue } = trpc.workOrders.overdue.useQuery(undefined, { refetchInterval: 15000 });

  return (
    <div className="space-y-6">
      {/* Overdue */}
      <div>
        <div className="text-xs font-semibold text-red-400 mb-2 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" /> OVERDUE ({overdue?.length || 0})
        </div>
        {!overdue?.length ? (
          <div className="text-[10px] text-foreground/30 py-4 text-center">No overdue work orders</div>
        ) : (
          <div className="space-y-1.5">
            {overdue.map((wo: any) => {
              const promise = formatPromiseTime(wo.promisedAt);
              return (
                <button key={wo.id} onClick={() => onSelectWO(wo.id)}
                  className="w-full text-left bg-red-500/5 border border-red-500/20 rounded-lg p-3 hover:border-red-500/40 transition-all">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono font-semibold">{wo.orderNumber}</span>
                    <span className="text-[10px] font-bold text-red-400">{promise.text}</span>
                  </div>
                  <div className="text-[11px] text-foreground/60">{wo.serviceDescription || "—"}</div>
                  <div className="text-[10px] text-foreground/40 mt-1 flex items-center gap-2">
                    <span className={STATUS_COLORS[wo.status]}>{STATUS_LABELS[wo.status]}</span>
                    {wo.assignedTech && <span><User className="w-2.5 h-2.5 inline" /> {wo.assignedTech}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Blocked */}
      <div>
        <div className="text-xs font-semibold text-amber-400 mb-2 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> BLOCKED ({blocked?.length || 0})
        </div>
        {!blocked?.length ? (
          <div className="text-[10px] text-foreground/30 py-4 text-center">No blocked work orders</div>
        ) : (
          <div className="space-y-1.5">
            {blocked.map((wo: any) => (
              <button key={wo.id} onClick={() => onSelectWO(wo.id)}
                className="w-full text-left bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 hover:border-amber-500/40 transition-all">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-mono font-semibold">{wo.orderNumber}</span>
                  <span className="text-[10px] font-bold text-amber-400">{wo.blockerType?.replace(/_/g, " ").toUpperCase()}</span>
                </div>
                {wo.blockerNote && <div className="text-[11px] text-amber-300/60 mb-1">{wo.blockerNote}</div>}
                <div className="text-[10px] text-foreground/40 flex items-center gap-2">
                  <span className={STATUS_COLORS[wo.status]}>{STATUS_LABELS[wo.status]}</span>
                  <span>Blocked {formatTimeAgo(wo.blockerSince)} ago</span>
                  {wo.assignedTech && <span><User className="w-2.5 h-2.5 inline" /> {wo.assignedTech}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pickup Queue View ──────────────────────────────────
function PickupQueueView({ onSelectWO }: { onSelectWO: (id: string) => void }) {
  const { data: queue, isLoading } = trpc.workOrders.pickupQueue.useQuery(undefined, { refetchInterval: 15000 });
  const utils = trpc.useUtils();
  const advance = trpc.workOrders.advanceStatus.useMutation({
    onSuccess: () => { utils.workOrders.pickupQueue.invalidate(); utils.workOrders.list.invalidate(); utils.workOrders.stats.invalidate(); },
  });

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary/60" /></div>;
  if (!queue?.length) return <div className="text-center py-20 text-foreground/30 text-sm">No vehicles ready for pickup</div>;

  return (
    <div className="space-y-2">
      <div className="text-xs text-foreground/40">{queue.length} vehicles ready for pickup</div>
      {queue.map((wo: any) => (
        <div key={wo.id} className="bg-card border border-emerald-500/20 rounded-lg p-3 flex items-center gap-3">
          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelectWO(wo.id)}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono font-semibold">{wo.orderNumber}</span>
              <span className={`text-[10px] font-medium ${STATUS_COLORS[wo.status]}`}>{STATUS_LABELS[wo.status]}</span>
            </div>
            <div className="text-[11px] text-foreground/60">{wo.serviceDescription || "—"}</div>
            <div className="text-[10px] text-foreground/40 mt-0.5 flex items-center gap-2">
              {wo.vehicleMake && <span>{[wo.vehicleYear, wo.vehicleMake, wo.vehicleModel].filter(Boolean).join(" ")}</span>}
              {wo.completedAt && <span>Done {formatTimeAgo(wo.completedAt)} ago</span>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="text-right mr-2">
              <div className="text-sm font-bold">${Number(wo.total || 0).toFixed(2)}</div>
              {wo.financingUsed && <div className="text-[9px] text-amber-400">FINANCED</div>}
            </div>
            <button
              onClick={() => advance.mutate({ id: wo.id, status: "picked_up" })}
              disabled={advance.isPending}
              className="text-[11px] font-medium px-3 py-1.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
            >
              <CheckCircle2 className="w-3 h-3 inline mr-1" />Picked Up
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Shop Pulse Mood Indicator ────────────────────────────
function ShopPulseMood() {
  const { data: stats } = trpc.adminDashboard.stats.useQuery(undefined, { refetchInterval: 30000 });
  const shopFloor = (stats as any)?.shopFloor;

  if (!shopFloor) return null;

  const revenueToday = Math.round(Number(shopFloor.revenueToday || 0));
  const jobsClosed = Number(shopFloor.invoicesToday || 0);
  // Monthly target $20K / ~22 working days = ~$909/day
  const dailyTarget = 909;
  const pacePercent = dailyTarget > 0 ? Math.round((revenueToday / dailyTarget) * 100) : 0;

  let mood: "busy" | "normal" | "slow";
  let emoji: string;
  let moodLabel: string;
  let moodLine: string;
  let borderColor: string;
  let bgColor: string;
  let textColor: string;

  if (pacePercent >= 110) {
    mood = "busy";
    emoji = "\uD83D\uDFE2";
    moodLabel = "BUSY DAY";
    moodLine = "Keep this energy. Every car counts.";
    borderColor = "border-emerald-500/40";
    bgColor = "bg-emerald-500/5";
    textColor = "text-emerald-400";
  } else if (pacePercent >= 70) {
    mood = "normal";
    emoji = "\uD83D\uDFE1";
    moodLabel = "NORMAL DAY";
    moodLine = "Solid pace. Stay sharp on callbacks and follow-ups.";
    borderColor = "border-amber-500/40";
    bgColor = "bg-amber-500/5";
    textColor = "text-amber-400";
  } else {
    mood = "slow";
    emoji = "\uD83D\uDD34";
    moodLabel = "SLOW DAY";
    moodLine = "Push harder. Call lapsed customers. Chase pending estimates.";
    borderColor = "border-red-500/40";
    bgColor = "bg-red-500/5";
    textColor = "text-red-400";
  }

  return (
    <div className={`${bgColor} border-2 ${borderColor} rounded-lg p-4`}>
      <div className="flex items-center gap-4 flex-wrap">
        {/* Mood emoji + label */}
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">{emoji}</span>
          <span className={`text-sm font-black tracking-widest uppercase ${textColor}`}>
            {moodLabel}
          </span>
        </div>

        {/* Metrics */}
        <div className="flex items-center gap-4 ml-auto">
          <div className="text-center">
            <div className="text-lg font-bold text-foreground">{jobsClosed}</div>
            <div className="text-[8px] text-muted-foreground tracking-widest">JOBS</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-foreground">${revenueToday.toLocaleString()}</div>
            <div className="text-[8px] text-muted-foreground tracking-widest">REVENUE</div>
          </div>
          <div className="text-center">
            <div className={`text-lg font-bold ${textColor}`}>{pacePercent}%</div>
            <div className="text-[8px] text-muted-foreground tracking-widest">PACE</div>
          </div>
        </div>
      </div>

      {/* Motivational line */}
      <div className="mt-2 text-[11px] text-foreground/50 flex items-center gap-1.5">
        <TrendingUp className="w-3 h-3 shrink-0" />
        {moodLine}
      </div>
    </div>
  );
}

// ─── Main Section ────────────────────────────────────────
export default function WorkOrdersSection() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<"board" | "parts" | "blockers" | "pickup">("board");
  const { data: workOrders, isLoading } = trpc.workOrders.list.useQuery({
    includeTerminal: showTerminal,
    limit: 200,
  }, { refetchInterval: 15000 });
  const utils = trpc.useUtils();

  // Filter work orders by search query
  const filteredWorkOrders = useMemo(() => {
    if (!workOrders) return [];
    if (!searchQuery.trim()) return workOrders;
    const q = searchQuery.toLowerCase();
    return workOrders.filter((wo: any) =>
      (wo.customerName && wo.customerName.toLowerCase().includes(q)) ||
      (wo.orderNumber && wo.orderNumber.toLowerCase().includes(q)) ||
      (wo.vehicleMake && wo.vehicleMake.toLowerCase().includes(q)) ||
      (wo.vehicleModel && wo.vehicleModel.toLowerCase().includes(q)) ||
      (wo.vehicleYear && String(wo.vehicleYear).includes(q)) ||
      (wo.serviceDescription && wo.serviceDescription.toLowerCase().includes(q)) ||
      (wo.assignedTech && wo.assignedTech.toLowerCase().includes(q)) ||
      (wo.status && (STATUS_LABELS[wo.status] || wo.status).toLowerCase().includes(q))
    );
  }, [workOrders, searchQuery]);

  // Group work orders by kanban column
  const columns = useMemo(() => {
    if (!filteredWorkOrders.length) return KANBAN_COLUMNS.map(c => ({ ...c, orders: [] as any[] }));
    return KANBAN_COLUMNS.map(col => ({
      ...col,
      orders: filteredWorkOrders.filter((wo: any) => col.statuses.includes(wo.status)),
    }));
  }, [filteredWorkOrders]);

  // On-hold / cancelled sidebar
  const holdOrders = useMemo(() => {
    if (!filteredWorkOrders.length) return [];
    return filteredWorkOrders.filter((wo: any) => wo.status === "on_hold" || wo.status === "cancelled");
  }, [filteredWorkOrders]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Wrench className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold">Work Order Board</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-border/40 rounded overflow-hidden">
            <button
              onClick={() => setView("board")}
              className={`text-[11px] px-2.5 py-1.5 transition-colors ${view === "board" ? "bg-primary/10 text-primary" : "text-foreground/50 hover:bg-foreground/5"}`}
            >
              Board
            </button>
            <button
              onClick={() => setView("parts")}
              className={`text-[11px] px-2.5 py-1.5 transition-colors ${view === "parts" ? "bg-primary/10 text-primary" : "text-foreground/50 hover:bg-foreground/5"}`}
            >
              <Package className="w-3 h-3 inline mr-1" />Parts
            </button>
            <button
              onClick={() => setView("blockers")}
              className={`text-[11px] px-2.5 py-1.5 transition-colors ${view === "blockers" ? "bg-primary/10 text-primary" : "text-foreground/50 hover:bg-foreground/5"}`}
            >
              <AlertTriangle className="w-3 h-3 inline mr-1" />Blockers
            </button>
            <button
              onClick={() => setView("pickup")}
              className={`text-[11px] px-2.5 py-1.5 transition-colors ${view === "pickup" ? "bg-primary/10 text-primary" : "text-foreground/50 hover:bg-foreground/5"}`}
            >
              <Phone className="w-3 h-3 inline mr-1" />Pickup
            </button>
          </div>
          {view === "board" && (
            <button
              onClick={() => setShowTerminal(!showTerminal)}
              className={`text-[11px] px-2.5 py-1.5 rounded border transition-colors ${
                showTerminal ? "border-primary/40 text-primary bg-primary/10" : "border-border/40 text-foreground/50 hover:bg-foreground/5"
              }`}
            >
              {showTerminal ? "Hide Done" : "Show Done"}
            </button>
          )}
          <button
            onClick={() => { utils.workOrders.list.invalidate(); utils.workOrders.pendingParts.invalidate(); }}
            className="text-[11px] px-2.5 py-1.5 rounded border border-border/40 text-foreground/50 hover:bg-foreground/5 flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
      </div>

      {/* Shop Pulse Mood */}
      <ShopPulseMood />

      {/* Stats bar */}
      <StatsBar />

      {/* Search */}
      {view === "board" && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" />
          <input
            type="text"
            placeholder="Search work orders by name, vehicle, tech, status..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-card border border-border/50 text-foreground pl-10 pr-4 py-2.5 text-[13px] rounded placeholder:text-foreground/30 focus:outline-none focus:border-primary/50"
          />
        </div>
      )}

      {/* Parts view */}
      {view === "parts" && <PendingPartsView onSelectWO={setSelectedId} />}

      {/* Blockers view */}
      {view === "blockers" && <BlockersView onSelectWO={setSelectedId} />}

      {/* Pickup queue view */}
      {view === "pickup" && <PickupQueueView onSelectWO={setSelectedId} />}

      {/* Kanban board */}
      {view === "board" && (isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-primary/60" />
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 400 }}>
          {columns.map(col => (
            <div key={col.id} className={`flex-1 min-w-[220px] max-w-[300px] border-t-2 ${col.color} rounded-lg`}>
              {/* Column header */}
              <div className={`${col.headerBg} px-3 py-2 rounded-t-lg flex items-center justify-between`}>
                <span className="text-xs font-semibold">{col.label}</span>
                <span className="text-[10px] font-bold text-foreground/40">{col.orders.length}</span>
              </div>
              {/* Cards */}
              <div className="p-2 space-y-2">
                {col.orders.length === 0 && (
                  <p className="text-foreground/20 text-xs text-center py-6">No jobs in this stage</p>
                )}
                {col.orders.map((wo: any) => (
                  <WOCard key={wo.id} wo={wo} onClick={() => setSelectedId(wo.id)} />
                ))}
              </div>
            </div>
          ))}

          {/* On-hold sidebar */}
          {holdOrders.length > 0 && (
            <div className="min-w-[200px] max-w-[240px] border-t-2 border-amber-500/30 rounded-lg">
              <div className="bg-amber-500/10 px-3 py-2 rounded-t-lg flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-400">Hold / Cancelled</span>
                <span className="text-[10px] font-bold text-foreground/40">{holdOrders.length}</span>
              </div>
              <div className="p-2 space-y-2">
                {holdOrders.map((wo: any) => (
                  <WOCard key={wo.id} wo={wo} onClick={() => setSelectedId(wo.id)} />
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Detail drawer */}
      {selectedId && <WorkOrderDrawer id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
