import DegradedDataBanner from "@/components/admin/DegradedDataBanner";
import ClosedLoopLiftPanel from "./ClosedLoopLiftPanel";
import DecisionInboxPanel from "./DecisionInboxPanel";
import PromisesPanel from "./PromisesPanel";
import InspectionCapturePanel from "./InspectionCapturePanel";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import MessageCustomerLink from "@/components/admin/MessageCustomerLink";
import { getAdminActionableCounts } from "@/lib/adminActionableCounts";
import { buildAdminSignals } from "@/lib/adminSignals";
import { getBusinessDateKey, isBusinessDate } from "@/lib/businessDate";
import { classifyIntegrationFreshness } from "@/lib/integrationFreshness";
import { trpc } from "@/lib/trpc";
import { isCallbackDuplicateLead } from "@shared/leadSource";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  History,
  Loader2,
  MessageSquare,
  Phone,
  Plug,
  RefreshCw,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { navigateToAdminSection } from "./shared";
import ExceptionFeed from "./today/ExceptionFeed";
import { getQueueActionDefinition } from "./today/queueActions";
import type { ActionItem, BookingItem, CallbackItem, LeadItem, WorkOrderItem } from "./today/types";

const ACTIVE_LEAD_STATUSES = new Set(["new", "contacted"]);
const ACTIVE_WORK_ORDER_STATUSES = new Set(["new", "scheduled", "in_progress", "waiting_parts", "quality_check"]);

/**
 * Page size for the work-order read that feeds the action queue.
 *
 * Named because the queue count depends on it: a full page means the real
 * number is "at least this", not "exactly this". `queueSaturated` below turns
 * that into a visible "30+" rather than a precise-looking lie.
 */
const WORK_ORDER_QUEUE_LIMIT = 30;

/**
 * Signals the action queue below already renders, hidden from the exception
 * strip so Today does not say the same thing twice.
 *
 * Listed by ID rather than by section on purpose: `ops-overview` shares the
 * "overview" section with these three but is NOT in the queue — the queue reads
 * bookings, leads, callbacks and work orders, and knows nothing about
 * publishing. Excluding by section would have silently swallowed it, which is
 * the class of mistake this whole arc keeps finding.
 *
 * `todayExceptionFeed.test.ts` fails if any id here stops being produced, so a
 * renamed signal cannot quietly become invisible.
 */
const QUEUE_COVERED_SIGNAL_IDS = ["new-bookings", "actionable-leads", "pending-callbacks", "new-leads"] as const;

/**
 * Aliases of a signal that is already in the feed under another id.
 *
 * `buildAdminSignals()` deliberately emits the publishing count TWICE — once as
 * `ops-overview` and once as `ops-instagram` — so the sidebar can badge both
 * Today and Instagram from one reading. On Today that would print "publishing
 * items held" as two identical rows, which reads as two problems. The operator
 * taps expecting two things to fix and finds one: the same inflation
 * `operationsSignal` already de-overlaps for on the server.
 *
 * `ops-overview` is the one kept, because this IS Today.
 */
const DUPLICATE_ALIAS_SIGNAL_IDS = ["ops-instagram"] as const;

function requestLabel(item: ActionItem): string {
  return item.type === "workOrder" ? "work order" : item.type;
}

export default function OverviewSection() {
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<"all" | ActionItem["type"]>("all");
  const { data: security } = trpc.adminSecurity.status.useQuery();
  const canViewHistory = security?.permissions.includes("reports.view") ?? false;

  const {
    data: bundle,
    isLoading,
    isError,
    error,
  } = trpc.adminDashboard.overviewMediumBundle.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 25_000,
    refetchIntervalInBackground: false,
  });
  /**
   * `isError` is captured here and NOT discarded — it used to be.
   *
   * Work orders are a SEPARATE query from the bundle, so `unavailableSlices`
   * below cannot see them. When this failed, `workOrders` was undefined,
   * `currentWorkOrders` became [] and the action queue silently dropped every
   * work order — while `queueTrustworthy` still reported true, because it only
   * inspected the bundle's slices. Work orders carry urgency 5 when overdue or
   * blocked, so the HIGHEST-priority items were the ones that vanished, and the
   * summary card kept showing a confident count of what was left.
   */
  const { data: workOrders, isError: workOrdersFailed } = trpc.workOrders.list.useQuery(
    { limit: WORK_ORDER_QUEUE_LIMIT },
    { refetchInterval: 30_000, refetchIntervalInBackground: false },
  );
  /**
   * Same key AND the same options as the shell's query in Admin.tsx, so this
   * second observer reads the shared react-query cache instead of triggering a
   * refetch of its own. A shorter staleTime here would double the poll rate on
   * a procedure the sidebar already runs on every page load.
   */
  const { data: opsSignal, isError: opsFailed } = trpc.contentAdmin.operationsSignal.useQuery(undefined, {
    refetchInterval: 120_000,
    staleTime: 90_000,
    refetchIntervalInBackground: false,
  });
  const { data: freshness, refetch: refetchFreshness, isFetching: freshnessFetching } =
    trpc.adminSecurity.integrationFreshness.useQuery(undefined, {
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    });
  const { data: recentActions } = trpc.adminSecurity.recentActions.useQuery(
    { limit: 8 },
    { enabled: canViewHistory, refetchInterval: 60_000, refetchIntervalInBackground: false },
  );

  const bookingUpdate = trpc.booking.updateStatus.useMutation();
  const leadUpdate = trpc.lead.update.useMutation();
  const callbackUpdate = trpc.callback.updateStatus.useMutation();
  const recordAction = trpc.adminSecurity.recordAction.useMutation();

  const stats = bundle?.stats ?? null;
  const bookings = (bundle?.bookings ?? []) as BookingItem[];
  const leads = (bundle?.leads ?? []) as LeadItem[];
  const callbacks = (bundle?.callbacks ?? []) as CallbackItem[];

  /**
   * WHICH OF THOSE EMPTY ARRAYS ARE REAL?
   *
   * `?? []` above turns a failed read into an empty queue, and an empty queue
   * renders as "All clear" — the single most dangerous sentence this screen can
   * say. The bundle now reports per-slice availability, so emptiness can be
   * qualified instead of trusted.
   *
   * Note this is NOT covered by `isError`: the tRPC call SUCCEEDS while carrying
   * a failed slice inside it, which is exactly why DegradedDataBanner never fired.
   */
  const unavailable = bundle?.unavailableSlices ?? [];
  const currentWorkOrders = (workOrders ?? []) as WorkOrderItem[];
  /**
   * Every source the queue is built from must be able to veto "All clear" —
   * including the work-order query, which is not part of the bundle and was
   * therefore invisible to this check.
   */
  const queueTrustworthy =
    !workOrdersFailed && !unavailable.some((s) => s === "leads" || s === "bookings" || s === "callbacks");
  /**
   * The work-order read is capped, so a full page is a LOWER BOUND, not a count.
   * Saying "37" when the true number could be anything above 30 is the same
   * false-precision problem as saying "0" for an unread source.
   */
  const queueSaturated = currentWorkOrders.length >= WORK_ORDER_QUEUE_LIMIT;

  /**
   * Built from the SAME builder the sidebar badges use, so a section cannot be
   * outstanding in the sidebar and absent from Today, or the reverse.
   */
  const signals = useMemo(
    () =>
      buildAdminSignals({
        bundleFailed: isError,
        slices: bundle?.slices,
        counts: getAdminActionableCounts({ bookings, leads, callbacks }),
        stats,
        opsFailed,
        opsUnknown: opsSignal?.unknown === true,
        opsTotal: opsSignal?.total,
      }),
    [isError, bundle?.slices, bookings, leads, callbacks, stats, opsFailed, opsSignal],
  );
  const todayKey = getBusinessDateKey();

  const queue = useMemo<ActionItem[]>(() => {
    const items: ActionItem[] = [];
    for (const booking of bookings) {
      if (booking.status !== "new") continue;
      items.push({
        id: `booking-${booking.id}`,
        entityId: booking.id,
        type: "booking",
        name: booking.name || "Unknown customer",
        detail: `${booking.service || "General service"} · ${booking.preferredDate || "Date not set"}`,
        phone: booking.phone,
        urgency: booking.urgency === "emergency" ? 5 : booking.priority === "high" ? 4 : 2,
        createdAt: booking.createdAt,
        status: booking.status,
      });
    }
    for (const lead of leads) {
      if (!ACTIVE_LEAD_STATUSES.has(lead.status) || isCallbackDuplicateLead(lead)) continue;
      items.push({
        id: `lead-${lead.id}`,
        entityId: lead.id,
        type: "lead",
        name: lead.name || "Unknown lead",
        detail: `${lead.source || "unknown source"} · ${lead.status}`,
        phone: lead.phone,
        urgency: lead.urgencyScore ?? 3,
        createdAt: lead.createdAt,
        status: lead.status,
      });
    }
    for (const callback of callbacks) {
      if (callback.status !== "new" && callback.status !== "pending") continue;
      items.push({
        id: `callback-${callback.id}`,
        entityId: callback.id,
        type: "callback",
        name: callback.name || "Callback customer",
        detail: callback.reason || "Callback requested",
        phone: callback.phone,
        urgency: 4,
        createdAt: callback.createdAt,
        status: callback.status,
      });
    }
    for (const workOrder of currentWorkOrders) {
      if (!ACTIVE_WORK_ORDER_STATUSES.has(workOrder.status ?? "")) continue;
      const overdue = workOrder.promisedAt ? new Date(workOrder.promisedAt).getTime() < Date.now() : false;
      items.push({
        id: `workOrder-${workOrder.id}`,
        entityId: workOrder.id,
        type: "workOrder",
        name: workOrder.customerName || "Work order",
        detail: workOrder.serviceDescription || workOrder.status?.replace(/_/g, " ") || "Service in progress",
        phone: workOrder.customerPhone,
        urgency: overdue || workOrder.blockerType ? 5 : workOrder.priority === "high" ? 4 : 2,
        createdAt: workOrder.createdAt,
        status: workOrder.status || "unknown",
        totalRevenue: workOrder.total ? Number(workOrder.total) : undefined,
      });
    }
    return items.sort((a, b) => b.urgency - a.urgency || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [bookings, callbacks, currentWorkOrders, leads]);

  const filteredQueue = filter === "all" ? queue : queue.filter((item) => item.type === filter);
  const todaysBookings = bookings.filter(
    (booking) => booking.preferredDate === todayKey || isBusinessDate(booking.createdAt, todayKey),
  );
  const integration = classifyIntegrationFreshness({
    connected: freshness?.connected,
    lastSuccessfulAt: freshness?.lastSuccessfulAt,
    staleAfterMinutes: 24 * 60,
  });

  async function logReceipt(item: ActionItem, action: string, changes: Record<string, unknown>) {
    const result = await recordAction.mutateAsync({
      action,
      entityType: item.type,
      entityId: item.entityId,
      changes,
    });
    toast.success(`${action.replace(/^admin\./, "").replace(/_/g, " ")} · ${result.reference}`);
    utils.adminSecurity.recentActions.invalidate();
  }

  async function performPrimary(item: ActionItem) {
    const definition = getQueueActionDefinition(item.type);
    if (item.type === "workOrder") {
      navigateToAdminSection("customers");
      await logReceipt(item, "admin.work_order_opened", { status: item.status });
      return;
    }
    const confirmed = await confirmDialog({
      title: definition.primaryConfirmTitle,
      message: definition.primaryConfirmMessage(item.name),
      confirmLabel: definition.primaryLabel,
    });
    if (!confirmed) return;
    if (item.type === "booking") {
      await bookingUpdate.mutateAsync({ id: item.entityId, status: "confirmed" });
      await logReceipt(item, "admin.booking_confirmed", { from: item.status, to: "confirmed" });
    } else if (item.type === "lead") {
      await leadUpdate.mutateAsync({ id: item.entityId, status: "contacted", contacted: 1 });
      await logReceipt(item, "admin.lead_contacted", { from: item.status, to: "contacted" });
    } else {
      await callbackUpdate.mutateAsync({ id: item.entityId, status: "completed" });
      await logReceipt(item, "admin.callback_completed", { from: item.status, to: "completed" });
    }
    await utils.adminDashboard.overviewMediumBundle.invalidate();
  }

  async function performSecondary(item: ActionItem) {
    const definition = getQueueActionDefinition(item.type);
    if (item.type === "callback") {
      navigateToAdminSection("callTrackingView");
      await logReceipt(item, "admin.callback_opened", { status: item.status });
      return;
    }
    if (item.type === "workOrder") {
      navigateToAdminSection("customers");
      await logReceipt(item, "admin.work_order_opened", { status: item.status });
      return;
    }
    const confirmed = await confirmDialog({
      title: definition.secondaryConfirmTitle,
      message: definition.secondaryConfirmMessage(item.name),
      confirmLabel: definition.secondaryLabel,
      tone: definition.secondaryDestructive ? "danger" : "default",
    });
    if (!confirmed) return;
    if (item.type === "booking") {
      await bookingUpdate.mutateAsync({ id: item.entityId, status: "cancelled" });
      await logReceipt(item, "admin.booking_cancelled", { from: item.status, to: "cancelled" });
    } else {
      await leadUpdate.mutateAsync({ id: item.entityId, status: "closed" });
      await logReceipt(item, "admin.lead_closed", { from: item.status, to: "closed" });
    }
    await utils.adminDashboard.overviewMediumBundle.invalidate();
  }

  const mutationPending = bookingUpdate.isPending || leadUpdate.isPending || callbackUpdate.isPending || recordAction.isPending;

  if (isLoading) {
    return <div className="min-h-[50vh] flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-5" aria-label="Today operator command center">
      <DegradedDataBanner stats={stats} unavailable={isError} unavailableMessage={error?.message} />

      {/* Owner Decision Inbox (Wave 4) — the top-5 evidence-backed
          decisions LEAD the day. Everything below is monitoring; this is
          the part that moves money. Degrades to an empty card until the
          queue table (0099) is applied + collectors run. */}
      <DecisionInboxPanel />

      {/* Promise Ledger (0102) — log promises the moment they're made;
          the sweep escalates overdue ones back into the inbox above. */}
      <PromisesPanel />

      {/* Automation lift (2026-07-29) — first admin consumer of the
          closedLoop A/B lift math (it previously reached the operator
          only via Telegram digest): winning / flat / hurting with the
          wave receipts underneath. */}
      <ClosedLoopLiftPanel />

      {/* DVI capture (drop-off intake) — the inspection loop's inlet:
          findings + photos → publish → hand the customer the link. */}
      <InspectionCapturePanel />

      {/* A slice can fail while the request succeeds. Without this the operator
          sees a clean board built on reads that never happened. */}
      {unavailable.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
          <strong>Could not read: {unavailable.join(", ")}.</strong>
          <div className="mt-1 text-xs text-amber-200/70">
            Anything below that looks empty may be UNKNOWN rather than clear. Refresh, or check the database.
          </div>
        </div>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Today summary">
        <SummaryCard
          label="Needs action"
          value={queueTrustworthy ? (queueSaturated ? `${queue.length}+` : queue.length) : "—"}
          detail={
            !queueTrustworthy
              ? "Unable to determine"
              : queueSaturated
                ? "At least this many — work-order list is capped"
                : queue.length
                  ? "Open queue items"
                  : "All clear"
          }
          alert={queue.length > 0 || !queueTrustworthy}
        />
        <SummaryCard label="Bookings today" value={todaysBookings.length} detail={`Cleveland date · ${todayKey}`} />
        <SummaryCard label="Urgent leads" value={leads.filter((lead) => !isCallbackDuplicateLead(lead) && ACTIVE_LEAD_STATUSES.has(lead.status) && (lead.urgencyScore ?? 0) >= 4).length} detail="Included once" />
        {/*
          Fed by the SAME query as the "Needs action" card. It used to render a
          neutral "0" while that card, on the identical failure, correctly read
          "— / Unable to determine" — two cards side by side disagreeing about
          whether the shop floor had been read at all.
        */}
        <SummaryCard
          label="Active work orders"
          value={workOrdersFailed ? "—" : currentWorkOrders.filter((wo) => ACTIVE_WORK_ORDER_STATUSES.has(wo.status ?? "")).length}
          detail={workOrdersFailed ? "Unable to determine" : "Shop floor"}
          alert={workOrdersFailed}
        />
      </section>

      {/*
        Cross-domain exceptions: publishing holds, tire orders and membership
        warnings, plus anything the system could not read. The action queue
        below covers bookings / leads / callbacks / work orders and knows
        nothing about the rest, so these had no surface on Today at all.
      */}
      <ExceptionFeed signals={signals} hideIds={[...QUEUE_COVERED_SIGNAL_IDS, ...DUPLICATE_ALIAS_SIGNAL_IDS]} />

      <section className="rounded-lg border border-border/40 bg-card p-4" aria-labelledby="freshness-title">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="freshness-title" className="text-sm font-semibold flex items-center gap-2"><Plug className="w-4 h-4 text-primary" />Integration freshness</h2>
            <p className={`mt-1 text-xs ${integration.state === "fresh" ? "text-emerald-400" : integration.state === "stale" ? "text-amber-400" : "text-red-400"}`}>
              ALG / ShopDriver · {integration.label}
              {freshness?.lastSuccessfulAt ? ` · last success ${new Date(freshness.lastSuccessfulAt).toLocaleString()}` : ""}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">Source: {freshness?.source ?? "unknown"} · checked {freshness?.generatedAt ? new Date(freshness.generatedAt).toLocaleTimeString() : "—"}</p>
          </div>
          <button type="button" onClick={() => refetchFreshness()} className="p-2 rounded-md border border-border/40 text-muted-foreground hover:text-foreground" aria-label="Refresh integration freshness">
            <RefreshCw className={`w-4 h-4 ${freshnessFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-primary/20 bg-card p-4" aria-labelledby="queue-title">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 id="queue-title" className="text-sm font-semibold flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" />Priority action queue</h2>
            <p className="text-xs text-muted-foreground mt-1">Every completed action returns a durable ACT reference.</p>
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter queue">
            {(["all", "booking", "lead", "callback", "workOrder"] as const).map((value) => (
              <button key={value} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value} className={`px-2.5 py-1.5 rounded text-xs ${filter === value ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`}>
                {value === "all" ? "All" : value === "workOrder" ? "Work orders" : `${value.charAt(0).toUpperCase()}${value.slice(1)}s`}
              </button>
            ))}
          </div>
        </div>

        {filteredQueue.length === 0 ? (
          /*
           * An empty queue is only an all-clear if every source that feeds it
           * was actually read.
           *
           * This branch used to test `filteredQueue.length === 0` and nothing
           * else — not queueTrustworthy, not workOrdersFailed, not the bundle's
           * unavailable slices. So on a work-order failure the operator got a
           * large emerald check reading "No pending actions in this view" on
           * the SAME render where the card above said "— / Unable to
           * determine", and no banner on the page covers that query. With the
           * type filter selected it was worse still: a green check asserting
           * work orders specifically were clear, sourced from a query that had
           * failed.
           */
          !queueTrustworthy ? (
            <div className="py-10 text-center text-amber-600" role="status">
              <AlertTriangle className="w-7 h-7 mx-auto mb-2" />
              <p className="text-sm font-medium">Queue unreadable — this is UNKNOWN, not clear</p>
              <p className="text-xs mt-1 text-amber-600/80">
                At least one source failed. Work may be waiting that this list could not load.
              </p>
            </div>
          ) : (
            <div className="py-10 text-center text-emerald-400"><CheckCircle2 className="w-7 h-7 mx-auto mb-2" /><p className="text-sm font-medium">No pending actions in this view</p></div>
          )
        ) : (
          <div className="space-y-2">
            {filteredQueue.map((item) => {
              const definition = getQueueActionDefinition(item.type);
              const Icon = item.type === "booking" ? CalendarClock : item.type === "lead" ? Users : item.type === "callback" ? Phone : Wrench;
              return (
                <article key={item.id} className="rounded-md border border-border/30 bg-background/50 p-3 flex flex-col lg:flex-row lg:items-center gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <Icon className="w-4 h-4 text-primary mt-1 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium truncate">{item.name}</h3><span className="text-[9px] uppercase tracking-wider rounded bg-muted px-1.5 py-0.5">{requestLabel(item)}</span>{item.urgency >= 4 && <span className="text-[9px] uppercase tracking-wider rounded bg-red-500/10 text-red-400 px-1.5 py-0.5">Urgent</span>}</div>
                      <p className="text-xs text-muted-foreground mt-1 truncate">{item.detail}</p>
                      <p className="text-[10px] text-muted-foreground/70 mt-1 flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(item.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {item.phone && <a href={`tel:${item.phone}`} className="p-2 rounded border border-border/40" aria-label={`Call ${item.name}`}><Phone className="w-4 h-4" /></a>}
                    {item.phone && <MessageCustomerLink phone={item.phone} body={`Hi ${item.name.split(" ")[0]}, it's Nick's Tire following up on your ${requestLabel(item)}.`} className="p-2 rounded border border-border/40" title="Message customer" ariaLabel={`Message ${item.name}`}><MessageSquare className="w-4 h-4" /></MessageCustomerLink>}
                    <button type="button" disabled={mutationPending} onClick={() => performPrimary(item).catch((actionError) => toast.error(actionError instanceof Error ? actionError.message : "Action failed"))} className="px-3 py-2 rounded bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50">{definition.primaryLabel}</button>
                    {definition.secondaryLabel !== definition.primaryLabel && <button type="button" disabled={mutationPending} onClick={() => performSecondary(item).catch((actionError) => toast.error(actionError instanceof Error ? actionError.message : "Action failed"))} className="px-3 py-2 rounded border border-border/50 text-xs font-medium disabled:opacity-50">{definition.secondaryLabel}</button>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {canViewHistory && (
        <section className="rounded-lg border border-border/40 bg-card p-4" aria-labelledby="history-title">
          <h2 id="history-title" className="text-sm font-semibold flex items-center gap-2"><History className="w-4 h-4 text-primary" />Recent action receipts</h2>
          <div className="mt-3 space-y-2">
            {(recentActions ?? []).length === 0 ? <p className="text-xs text-muted-foreground">No recorded admin actions yet.</p> : (recentActions ?? []).map((entry: any) => (
              <div key={entry.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 rounded border border-border/20 bg-background/40 px-3 py-2">
                <div><p className="text-xs font-medium">{entry.action}</p><p className="text-[10px] text-muted-foreground">{entry.actor} · {entry.entityId || "—"}</p></div>
                <div className="text-[10px] font-mono text-muted-foreground">{entry.changes?.reference || "ACT"} · {new Date(entry.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * `value` accepts a string so this card can say "—" for UNKNOWN.
 *
 * It was `number`, which meant the component structurally could not express
 * "we could not read this" — the only options were a count or a zero, and zero
 * is a claim. The type was enforcing the defect.
 */
function SummaryCard({ label, value, detail, alert = false }: { label: string; value: number | string; detail: string; alert?: boolean }) {
  return (
    <div className="rounded-lg border border-border/40 bg-card p-4">
      <div className={`text-2xl font-bold tabular-nums ${alert ? "text-red-400" : "text-foreground"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{label}</div>
      <div className="text-[10px] text-muted-foreground/70 mt-1">{detail}</div>
    </div>
  );
}
