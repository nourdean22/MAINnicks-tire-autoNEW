/**
 * Today-dashboard query result types.
 *
 * 2026-05-23 · extracted from OverviewSection.tsx (Phase 3 split). These
 * are local types that approximate the tRPC return shapes for the
 * `adminDashboard.overviewMediumBundle` bundle + adjacent queries.
 * Eventually they should derive from `RouterOutputs[...]` but keeping
 * them explicit while the dashboard is in churn.
 */

export interface BookingItem {
  id: number;
  name: string;
  phone?: string | null;
  status: string;
  service?: string;
  vehicle?: string;
  createdAt: string | Date;
  preferredTime?: string;
  preferredDate?: string;
  priority?: string;
  urgency?: string;
  referenceCode?: string;
  adminNotes?: string;
  stage?: string;
  stageUpdatedAt?: string | Date;
}

export interface LeadItem {
  id: number;
  name?: string;
  email?: string;
  phone?: string | null;
  status: string;
  source?: string;
  /** Links a callback-form lead to its callback_requests row — used to skip
   *  the duplicate in action queues (the callback row is the canonical item). */
  callbackId?: number | null;
  urgencyScore?: number;
  createdAt: string | Date;
}

export interface CallbackItem {
  id: number;
  name?: string;
  phone?: string | null;
  status: string;
  reason?: string;
  createdAt: string | Date;
}

export interface WorkOrderItem {
  id: number;
  status?: string;
  customerName?: string;
  customerId?: string | number;
  customerPhone?: string | null;
  serviceDescription?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  total?: string | number;
  createdAt: string | Date;
  promisedAt?: string | Date | null;
  blockerType?: string | null;
  assignedTech?: string;
  priority?: string;
}

export interface NBAAction {
  type: string;
  urgency: number;
  message: string;
  phone?: string | null;
  actionUrl: string;
}

export interface AtRiskWhale {
  id: number;
  name: string;
  phone?: unknown;
  totalSpent: number;
  visits?: unknown;
  daysSince: unknown;
}

export interface ShopFloorData {
  revenueToday: number;
  /** ISO timestamp of the last ALG invoice ingest — null if never synced. */
  dataAsOf?: string | null;
  invoicesToday: number;
  estimatesToday: number;
  avgTicket: number;
  conversionRate: number;
  revenueThisWeek: number;
  revenueThisMonth: number;
  invoicesThisWeek: number;
  estimatesThisWeek: number;
  totalCustomers: number;
  vipCustomers: number;
}

/** Priority action queue item — merged shape across bookings / leads /
 *  callbacks / work orders so the queue can render them uniformly. */
export interface ActionItem {
  id: string;
  /** Numeric entity ID — needed to call mutations (mark-done, delete) */
  entityId: number;
  type: "booking" | "lead" | "callback" | "workOrder";
  name: string;
  detail: string;
  phone?: string | null;
  urgency: number; // 1-5
  createdAt: string | Date;
  status: string;
  isVip?: boolean;
  totalVisits?: number;
  totalRevenue?: number;
}
