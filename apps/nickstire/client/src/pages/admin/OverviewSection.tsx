import DegradedDataBanner from "@/components/admin/DegradedDataBanner";
import ClosedLoopLiftPanel from "./ClosedLoopLiftPanel";
import SalesCard from "./SalesCard";
import PromisesPanel from "./PromisesPanel";
import InspectionCapturePanel from "./InspectionCapturePanel";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { buildMessageCustomerHref } from "@/components/admin/MessageCustomerLink";
import { getAdminActionableCounts } from "@/lib/adminActionableCounts";
import { buildAdminSignals } from "@/lib/adminSignals";
import { getBusinessDateKey, isBusinessDate } from "@/lib/businessDate";
import { classifyIntegrationFreshness } from "@/lib/integrationFreshness";
import { gatewayState } from "@/lib/gatewayState";
import { trpc } from "@/lib/trpc";
import { isCallbackDuplicateLead } from "@shared/leadSource";
import { exceptionFeed } from "@shared/adminSignal";
import { AlertTriangle, History, Loader2, Plug, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { navigateToAdminSection, sectionsForRole } from "./shared";
import type { AdminRole } from "@shared/adminPermissions";
import { navigateToAdminUrl } from "./shared/navigation";
import ArrivalLoadStrip from "./today/ArrivalLoadStrip";
import ChecksRail from "./today/ChecksRail";
import ExceptionFeed from "./today/ExceptionFeed";
import { MorningBrief } from "./today/MorningBrief";
import { getQueueActionDefinition } from "./today/queueActions";
import QueueRow from "./today/QueueRow";
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
const UNKNOWN = "—";
/** The board is finite: past this many rows it offers one "Show N more" row. */
const BOARD_ROW_CAP = 12;

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

/** "42 min" / "5 h" / "2 d" — from the SQL-computed wait, not a driver-parsed timestamp. */
function waitLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / (24 * 60))} d`;
}

/** Shape of one bundle.owedTexts entry (server/services/smsResponseJobs.ts WaitingConversation). */
interface OwedTextItem {
  conversationId: number;
  phone: string;
  customerName: string | null;
  preview: string;
  waitingMinutes: number;
  /** Past the ROS-058 30-min human-reply SLA. */
  overdue: boolean;
}

export default function OverviewSection() {
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<"all" | ActionItem["type"]>("all");
  const [showAll, setShowAll] = useState(false);
  // Rows an action took off the queue, hidden until the refetch drops them for real.
  const [doneIds, setDoneIds] = useState<ReadonlySet<string>>(() => new Set());
  const { data: security } = trpc.adminSecurity.status.useQuery();
  const canViewHistory = security?.permissions.includes("reports.view") ?? false;
  // Same derivation as the shell (Admin.tsx): the role decides where a work order can open.
  const adminRole = (security?.adminRole ?? "viewer") as AdminRole;

  const {
    data: bundle,
    isLoading,
    isError,
    error,
    refetch: refetchBundle,
    dataUpdatedAt: bundleCheckedAt,
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
  /**
   * Approval queue (0111). Same key + options as the shell's query in Admin.tsx
   * so this second observer reads the shared cache instead of doubling the poll
   * (the operationsSignal pattern above).
   */
  const { data: proposalCounts, isError: proposalsFailed } = trpc.proposals.counts.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 45_000,
    refetchIntervalInBackground: false,
  });
  const { data: freshness, refetch: refetchFreshness, isFetching: freshnessFetching, isError: freshnessFailed } =
    trpc.adminSecurity.integrationFreshness.useQuery(undefined, {
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    });
  // Same key and options as MorningBrief's read, so this observer shares its cache: the Checks rail
  // counts a down gateway as an open item now that the brief's gateway line lives inside it.
  const { data: smsGw, isError: smsGwError } = trpc.sms.gatewayHealth.useQuery(undefined, { staleTime: 60_000 });
  const { data: recentActions } = trpc.adminSecurity.recentActions.useQuery(
    { limit: 8 },
    { enabled: canViewHistory, refetchInterval: 60_000, refetchIntervalInBackground: false },
  );

  const bookingUpdate = trpc.booking.updateStatus.useMutation();
  const leadUpdate = trpc.lead.update.useMutation();
  const callbackUpdate = trpc.callback.updateStatus.useMutation();
  const recordAction = trpc.adminSecurity.recordAction.useMutation();
  const markNoReplyNeeded = trpc.smsConversations.markNoReplyNeeded.useMutation();

  const stats = bundle?.stats ?? null;
  const bookings = (bundle?.bookings ?? []) as BookingItem[];
  const leads = (bundle?.leads ?? []) as LeadItem[];
  const callbacks = (bundle?.callbacks ?? []) as CallbackItem[];
  // callbackId -> "invoiced/booked since the request" hint. Never closes a callback by
  // itself (the enum has no honest "served elsewhere"); the operator taps Done.
  const callbackServed = (bundle?.callbackServed ?? {}) as Record<number, { label: string }>;
  const owedTexts = (bundle?.owedTexts ?? []) as OwedTextItem[];

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
    !workOrdersFailed &&
    !isError &&
    !unavailable.some((s) => s === "leads" || s === "bookings" || s === "callbacks" || s === "owedTexts");
  /**
   * The work-order read is capped, so a full page is a LOWER BOUND, not a count.
   * Saying "37" when the true number could be anything above 30 is the same
   * false-precision problem as saying "0" for an unread source.
   */
  const queueSaturated = currentWorkOrders.length >= WORK_ORDER_QUEUE_LIMIT;
  // Each card is only as known as its own slice: a failed bundle or slice is "unknown", never 0.
  const bookingsKnown = !isError && !unavailable.includes("bookings");
  const leadsKnown = !isError && !unavailable.includes("leads");

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
        opsVideoProviderBlocked: opsSignal?.videoProviderBlocked,
        proposalsFailed,
        proposalsReadable: proposalCounts?.readable,
        proposalsCount: proposalCounts?.count,
      }),
    [isError, bundle?.slices, bookings, leads, callbacks, stats, opsFailed, opsSignal, proposalsFailed, proposalCounts],
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
        detail: callbackServed[callback.id]
          ? `${callback.reason || "Callback requested"} · ${callbackServed[callback.id].label}`
          : callback.reason || "Callback requested",
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
    // Customers waiting on a human text reply: the ROS-058 obligation, so a
    // human reply or "No reply needed" clears it and an automated text does
    // not. Urgent is the same 30-min SLA the Outreach badge and alerts use.
    const now = Date.now();
    for (const text of owedTexts) {
      items.push({
        id: `text-${text.conversationId}`,
        entityId: text.conversationId,
        type: "text",
        name: text.customerName || "Texting customer",
        detail: `Waiting ${waitLabel(text.waitingMinutes)} · "${text.preview}"`,
        phone: text.phone,
        urgency: text.overdue ? 4 : 3,
        createdAt: new Date(now - text.waitingMinutes * 60_000).toISOString(),
        status: "awaiting_reply",
      });
    }
    return items
      .filter((item) => !doneIds.has(item.id))
      .sort((a, b) => b.urgency - a.urgency || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [bookings, callbacks, callbackServed, currentWorkOrders, leads, owedTexts, doneIds]);

  const filteredQueue = filter === "all" ? queue : queue.filter((item) => item.type === filter);
  const boardRows = showAll ? filteredQueue : filteredQueue.slice(0, BOARD_ROW_CAP);
  const todaysBookings = bookings.filter(
    (booking) => booking.preferredDate === todayKey || isBusinessDate(booking.createdAt, todayKey),
  );
  const integration = classifyIntegrationFreshness({
    connected: freshness?.connected,
    lastSuccessfulAt: freshness?.lastSuccessfulAt,
    staleAfterMinutes: 24 * 60,
    // ROS-083 · without these two the card can only answer "how old is the last
    // success", which reads emerald "Fresh" for a full day of live auth
    // failures. `freshnessFailed` covers the case where the query itself did
    // not resolve, which no server field can report.
    readable: freshnessFailed ? false : freshness?.readable,
    failuresSinceLastSuccess: freshness?.failuresSinceLastSuccess,
    lastAttemptOutcome: freshness?.lastAttemptOutcome,
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

  function openTextThread(item: ActionItem) {
    navigateToAdminUrl(
      { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false },
      buildMessageCustomerHref(item.phone ?? ""),
      "campaigns",
    );
  }

  /**
   * Work orders live on Money's default tab (Shop Pulse). Money is closed to front desk and tech,
   * whose queue still carries work orders, so they get the customer's Active Backlog instead.
   * Returns where it went, or null when no section this role can open shows the work order.
   * Work orders have no deep link to a single row yet.
   */
  function openWorkOrder(item: ActionItem): "revenue" | "customers" | null {
    const allowed = sectionsForRole(adminRole);
    const url = new URL(window.location.href);
    if (allowed.includes("revenue")) {
      url.searchParams.delete("moneyTab");
      window.history.replaceState({}, "", url.toString());
      navigateToAdminSection("revenue");
      return "revenue";
    }
    const customerId = Number(currentWorkOrders.find((wo) => wo.id === item.entityId)?.customerId);
    if (allowed.includes("customers") && customerId > 0) {
      url.searchParams.set("id", String(customerId));
      url.searchParams.set("profileTab", "backlog");
      window.history.replaceState({}, "", url.toString());
      navigateToAdminSection("customers");
      return "customers";
    }
    toast.error("Work orders are in Money, which your role cannot open");
    return null;
  }

  /**
   * Both actions resolve true only when the write moved the item to a state the queue above excludes
   * (booking confirmed or cancelled, callback completed, lead closed, text closed), so QueueRow can
   * take the row off the board at once. A contacted lead is still an active lead and stays; opening a
   * thread, a callback or a work order changes nothing on the board.
   */
  async function performPrimary(item: ActionItem): Promise<boolean> {
    const definition = getQueueActionDefinition(item.type);
    if (item.type === "text") {
      openTextThread(item);
      return false;
    }
    if (item.type === "workOrder") {
      const target = openWorkOrder(item);
      if (target) await logReceipt(item, "admin.work_order_opened", { status: item.status, target });
      return false;
    }
    const confirmed = await confirmDialog({
      title: definition.primaryConfirmTitle,
      message: definition.primaryConfirmMessage(item.name),
      confirmLabel: definition.primaryLabel,
    });
    if (!confirmed) return false;
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
    return item.type !== "lead";
  }

  async function performSecondary(item: ActionItem): Promise<boolean> {
    const definition = getQueueActionDefinition(item.type);
    if (item.type === "text") {
      const confirmed = await confirmDialog({
        title: definition.secondaryConfirmTitle,
        message: definition.secondaryConfirmMessage(item.name),
        confirmLabel: definition.secondaryLabel,
      });
      if (!confirmed) return false;
      const { closed } = await markNoReplyNeeded.mutateAsync({ conversationId: item.entityId });
      await logReceipt(item, "admin.text_no_reply_needed", { closed });
      await utils.adminDashboard.overviewMediumBundle.invalidate();
      return Boolean(closed);
    }
    if (item.type === "callback") {
      navigateToAdminSection("callTrackingView");
      await logReceipt(item, "admin.callback_opened", { status: item.status });
      return false;
    }
    if (item.type === "workOrder") {
      const target = openWorkOrder(item);
      if (target) await logReceipt(item, "admin.work_order_opened", { status: item.status, target });
      return false;
    }
    const confirmed = await confirmDialog({
      title: definition.secondaryConfirmTitle,
      message: definition.secondaryConfirmMessage(item.name),
      confirmLabel: definition.secondaryLabel,
      tone: definition.secondaryDestructive ? "danger" : "default",
    });
    if (!confirmed) return false;
    if (item.type === "booking") {
      await bookingUpdate.mutateAsync({ id: item.entityId, status: "cancelled" });
      await logReceipt(item, "admin.booking_cancelled", { from: item.status, to: "cancelled" });
    } else {
      await leadUpdate.mutateAsync({ id: item.entityId, status: "closed" });
      await logReceipt(item, "admin.lead_closed", { from: item.status, to: "closed" });
    }
    await utils.adminDashboard.overviewMediumBundle.invalidate();
    return true;
  }

  /** A row's action never rejects: a failure keeps the row and says why. */
  const guarded = (run: (item: ActionItem) => Promise<boolean>, item: ActionItem) => () =>
    run(item).catch((actionError: unknown) => {
      toast.error(actionError instanceof Error ? actionError.message : "Action failed");
      return false;
    });

  const mutationPending = bookingUpdate.isPending || leadUpdate.isPending || callbackUpdate.isPending || markNoReplyNeeded.isPending || recordAction.isPending;

  /**
   * ONE definition, two consumers: the "Urgent leads" card and the morning
   * brief above it. This was inline in the card's JSX; the brief would have
   * needed the same predicate re-typed, and a re-typed predicate is how the
   * weekly digest nearly drifted from the daily report on the lead count.
   * Callback-duplicate exclusion is part of the rule, not a caller's chore.
   */
  const urgentLeadCount = useMemo(
    () =>
      leads.filter(
        (lead) =>
          !isCallbackDuplicateLead(lead) &&
          ACTIVE_LEAD_STATUSES.has(lead.status) &&
          (lead.urgencyScore ?? 0) >= 4,
      ).length,
    [leads],
  );

  /**
   * The Checks rail's summary. It folds every monitoring panel away on a phone, so it must say how
   * many of them need a look: the exceptions the feed would list (an unknown reading counts), an
   * integration that is not fresh, and an SMS gateway that is down or unreadable. With nothing open
   * it only says "nothing open" when every feed source actually reported.
   */
  const feedHidden = new Set<string>([...QUEUE_COVERED_SIGNAL_IDS, ...DUPLICATE_ALIAS_SIGNAL_IDS]);
  const feedSignals = signals.filter((s) => !feedHidden.has(s.id));
  const gateway = gatewayState(smsGw, smsGwError);
  const openChecks =
    exceptionFeed(feedSignals).length +
    (integration.state === "fresh" ? 0 : 1) +
    (gateway === "offline" || gateway === "unknown" || gateway === "not_configured" ? 1 : 0);
  const checksStatus =
    openChecks > 0
      ? `${openChecks} open`
      : feedSignals.length > 0 && feedSignals.every((s) => s.reading.state === "counted")
        ? "nothing open"
        : "not all measured";

  if (isLoading) {
    return <div className="min-h-[50vh] flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6" aria-label="Today operator command center">
      <DegradedDataBanner stats={stats} unavailable={isError} unavailableMessage={error?.message} onRetry={() => void refetchBundle()} />

      {/* The verdict: one line from the brief, read from the SAME `queue` and `urgentLeadCount` the
          board and strip below render, so it cannot disagree with them. Its calls and gateway line
          lives in the Checks rail. */}
      <MorningBrief part="verdict" priorityQueueLength={queue.length} urgentLeads={urgentLeadCount} queueTrustworthy={queueTrustworthy} />

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

      {/* THE BOARD (admin UI v1 W2). The queue is the page, not a card: ruled rows the crew acts on
          in place, finite, ending in one line when nothing is left. The owner Decision Inbox was
          retired from this page on 2026-09-07 by operator decision; do NOT re-mount a decision queue
          here under another name. */}
      <section aria-labelledby="queue-title">
        <h2 id="queue-title" className="text-[15px] font-semibold">Priority action queue</h2>
        <div className="mt-2 -mx-1 px-1 flex gap-1.5 overflow-x-auto" role="group" aria-label="Filter queue">
          {(["all", "booking", "lead", "callback", "workOrder", "text"] as const).map((value) => (
            <button key={value} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value} className={`min-h-12 px-3.5 shrink-0 rounded-md text-[13px] ${filter === value ? "bg-secondary text-foreground font-semibold border border-border/60" : "text-muted-foreground"}`}>
              {value === "all" ? "All" : value === "workOrder" ? "Work orders" : `${value.charAt(0).toUpperCase()}${value.slice(1)}s`}
            </button>
          ))}
        </div>

        {filteredQueue.length === 0 ? (
          /*
           * An empty queue is only an all-clear if every source that feeds it was actually read
           * (queueTrustworthy covers the bundle, its slices and the separate work-order query). The
           * unreadable state is the W0 contract; its text stays as it is.
           */
          !queueTrustworthy ? (
            <div className="py-8 text-center text-amber-600" role="status">
              <AlertTriangle className="w-7 h-7 mx-auto mb-2" />
              <p className="text-sm font-medium">Queue unreadable: this is UNKNOWN, not clear</p>
              <p className="text-xs mt-1 text-amber-600/80">
                At least one source failed. Work may be waiting that this list could not load.
              </p>
            </div>
          ) : filter === "all" ? (
            <div className="py-10 text-center" role="status">
              <p className="text-[17px] font-medium">Done for today. Nothing needs you.</p>
              {bundleCheckedAt ? (
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Checked {new Date(bundleCheckedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="py-8 text-center text-[13px] text-muted-foreground" role="status">No pending actions in this view</p>
          )
        ) : (
          <div className="mt-1 divide-y divide-border/40 border-y border-border/40">
            {boardRows.map((item) => {
              const definition = getQueueActionDefinition(item.type);
              return (
                <QueueRow
                  key={item.id}
                  item={item}
                  typeLabel={requestLabel(item)}
                  primaryLabel={definition.primaryLabel}
                  secondaryLabel={definition.secondaryLabel !== definition.primaryLabel ? definition.secondaryLabel : undefined}
                  body={`Hi ${item.name.split(" ")[0]}, it's Nick's Tire following up on your ${requestLabel(item)}.`}
                  disabled={mutationPending}
                  onPrimary={guarded(performPrimary, item)}
                  onSecondary={guarded(performSecondary, item)}
                  onGone={() => setDoneIds((prev) => new Set(prev).add(item.id))}
                />
              );
            })}
            {filteredQueue.length > boardRows.length && (
              <button type="button" onClick={() => setShowAll(true)} className="w-full min-h-12 text-[14px] font-medium text-foreground/85">
                Show {filteredQueue.length - boardRows.length} more
              </button>
            )}
          </div>
        )}
      </section>

      <section className="grid grid-cols-4 gap-2" aria-label="Today summary">
        <SummaryCard
          label="Needs action"
          value={queueTrustworthy ? (queueSaturated ? `${queue.length}+` : queue.length) : UNKNOWN}
          detail={
            !queueTrustworthy
              ? "Unable to determine"
              : queueSaturated
                ? "At least this many: work-order list is capped"
                : queue.length
                  ? undefined
                  : "All clear"
          }
          alert={queue.length > 0 || !queueTrustworthy}
          priority={queueTrustworthy && queue.length > 0}
        />
        <SummaryCard label="Bookings today" value={bookingsKnown ? todaysBookings.length : UNKNOWN} detail={bookingsKnown ? undefined : "Unable to determine"} />
        <SummaryCard label="Urgent leads" value={leadsKnown ? urgentLeadCount : UNKNOWN} detail={leadsKnown ? undefined : "Unable to determine"} />
        {/*
          Fed by the SAME query as the "Needs action" number. It used to render a
          neutral "0" while that number, on the identical failure, correctly read
          "unknown / Unable to determine": two cells side by side disagreeing about
          whether the shop floor had been read at all.
        */}
        <SummaryCard
          label="Active work orders"
          value={workOrdersFailed ? UNKNOWN : currentWorkOrders.filter((wo) => ACTIVE_WORK_ORDER_STATUSES.has(wo.status ?? "")).length}
          detail={workOrdersFailed ? "Unable to determine" : undefined}
          alert={workOrdersFailed}
        />
      </section>

      {/* SALES (2026-09-07): what the shop billed, unchanged, now below the work. */}
      <SalesCard />

      {/* Arrival load (NT-008): who said they're coming today plus tomorrow's preferred-date bookings,
          from the same bundle. Self-suppresses when empty AND healthy. */}
      <ArrivalLoadStrip bookings={bookings} bookingsTrustworthy={!unavailable.includes("bookings")} />

      {/* CHECKS: everything that monitors rather than asks for work, under one rail. */}
      <ChecksRail status={checksStatus} alert={openChecks > 0}>
        <MorningBrief part="signals" priorityQueueLength={queue.length} urgentLeads={urgentLeadCount} queueTrustworthy={queueTrustworthy} />

        {/* Promise Ledger (0102): log promises the moment they're made; the sweep escalates overdue
            ones into the queue read on the Opportunities tab. */}
        <PromisesPanel />

        {/* DVI capture (drop-off intake): findings + photos, publish, hand the customer the link. */}
        <InspectionCapturePanel />

        {/* Automation lift (2026-07-29): the closedLoop A/B lift math, a slow-moving measurement. */}
        <ClosedLoopLiftPanel />

        {/*
          Cross-domain exceptions: publishing holds, tire orders and membership
          warnings, plus anything the system could not read. The board covers
          bookings / leads / callbacks / work orders / texts and knows nothing about
          the rest, so these had no surface on Today at all.
        */}
        <ExceptionFeed signals={signals} hideIds={[...QUEUE_COVERED_SIGNAL_IDS, ...DUPLICATE_ALIAS_SIGNAL_IDS]} />

        <section className="rounded-lg border border-border/40 bg-card p-4" aria-labelledby="freshness-title">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="freshness-title" className="text-sm font-semibold flex items-center gap-2"><Plug className="w-4 h-4 text-primary" />Integration freshness</h2>
              <p className={`mt-1 text-xs ${integration.state === "fresh" ? "text-emerald-400" : integration.state === "stale" || integration.state === "unknown" ? "text-amber-400" : "text-red-400"}`}>
                ALG / ShopDriver · {integration.label}
                {/* Keep the last-success timestamp on a FAILING card. It is the
                    most useful number there (it says how long the outage has
                    been running) but it must never be the only thing shown,
                    which is what made a live failure read as freshly synced. */}
                {freshness?.lastSuccessfulAt ? ` · last success ${new Date(freshness.lastSuccessfulAt).toLocaleString()}` : ""}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">Source: {freshness?.source ?? "unknown"} · checked {freshness?.generatedAt ? new Date(freshness.generatedAt).toLocaleTimeString() : "—"}</p>
            </div>
            <button type="button" onClick={() => refetchFreshness()} className="inline-flex items-center justify-center min-h-12 min-w-12 rounded-md border border-border/40 text-muted-foreground hover:text-foreground" aria-label="Refresh integration freshness">
              <RefreshCw className={`w-4 h-4 ${freshnessFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
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
      </ChecksRail>
    </div>
  );
}

/**
 * One number of the summary strip. `value` accepts a string so it can say "—" for UNKNOWN.
 *
 * It was `number`, which meant the component structurally could not express
 * "we could not read this": the only options were a count or a zero, and zero
 * is a claim. The type was enforcing the defect. `detail` only renders when it
 * says something the number cannot (unknown, capped, all clear).
 */
function SummaryCard({ label, value, detail, alert = false, priority = false }: { label: string; value: number | string; detail?: string; alert?: boolean; priority?: boolean }) {
  // `priority` is the owner-priority gold (index.css --owner-priority): work is waiting and the count is real.
  return (
    <div className="min-w-0">
      <div className={`text-2xl font-bold tabular-nums leading-none ${priority ? "text-[var(--owner-priority)]" : alert ? "text-red-400" : "text-foreground"}`}>{value}</div>
      <div className="mt-1.5 text-[12px] leading-tight text-muted-foreground">{label}</div>
      {detail && <div className="mt-1 text-[11px] leading-tight text-muted-foreground">{detail}</div>}
    </div>
  );
}
