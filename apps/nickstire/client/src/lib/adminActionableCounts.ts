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

const ACTIVE_LEAD_STATUSES = new Set(["new", "contacted", "qualified"]);
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
  const actionableLeadRows = leads.filter((lead) => {
    if (isCallbackDuplicateLead(lead)) return false;
    return ACTIVE_LEAD_STATUSES.has(lead.status ?? "new");
  });
  const newLeads = actionableLeadRows.filter((lead) => (lead.status ?? "new") === "new").length;
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
