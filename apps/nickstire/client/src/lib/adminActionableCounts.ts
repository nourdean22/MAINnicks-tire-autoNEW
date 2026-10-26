import { isCallbackDuplicateLead, type LeadOriginInput } from "@shared/leadSource";

interface BookingLike {
  status?: string | null;
}

interface LeadLike extends LeadOriginInput {
  status?: string | null;
  urgencyScore?: number | null;
}

interface CallbackLike {
  status?: string | null;
}

export interface AdminActionableCounts {
  newBookings: number;
  newLeads: number;
  urgentLeads: number;
  actionableLeads: number;
  pendingCallbacks: number;
  total: number;
}

/**
 * ONE rule for the Today board, its tiles, its verdict and the sidebar badge: a lead is the shop's move
 * while it is new. Marking it contacted logs the attempt and moves it to "Waiting on customer"; the
 * reply comes back as an owed text. Linked callback-form leads are the callback row's duplicate.
 */
export const isOpenLead = (lead: LeadLike) => (lead.status ?? "new") === "new" && !isCallbackDuplicateLead(lead);
export const isWaitingLead = (lead: LeadLike) => lead.status === "contacted" && !isCallbackDuplicateLead(lead);
const PENDING_CALLBACK_STATUSES = new Set(["new", "pending"]);

/**
 * Produces one canonical, non-overlapping count for the admin "Today" badge.
 *
 * Urgent leads are a subset of actionable leads, not an extra bucket. Linked
 * callback-form leads are excluded because the callback row already represents
 * the same customer on the operator queue.
 */
export function getAdminActionableCounts(input: {
  bookings?: BookingLike[] | null;
  leads?: LeadLike[] | null;
  callbacks?: CallbackLike[] | null;
}): AdminActionableCounts {
  const bookings = input.bookings ?? [];
  const leads = input.leads ?? [];
  const callbacks = input.callbacks ?? [];

  const newBookings = bookings.filter((booking) => booking.status === "new").length;
  const actionableLeadRows = leads.filter(isOpenLead);
  const newLeads = actionableLeadRows.length;
  const urgentLeads = actionableLeadRows.filter((lead) => (lead.urgencyScore ?? 0) >= 4).length;
  const pendingCallbacks = callbacks.filter((callback) =>
    PENDING_CALLBACK_STATUSES.has(callback.status ?? "new"),
  ).length;

  const actionableLeads = actionableLeadRows.length;

  return {
    newBookings,
    newLeads,
    urgentLeads,
    actionableLeads,
    pendingCallbacks,
    total: newBookings + actionableLeads + pendingCallbacks,
  };
}
