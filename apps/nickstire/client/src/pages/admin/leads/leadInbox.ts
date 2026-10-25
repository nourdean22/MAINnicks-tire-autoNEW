/**
 * The web leads as one list with three filters (2026-10-25). A handful of leads a month is a list,
 * not a kanban: needs a response from the shop, waiting on the customer, or closed.
 */
import type { LeadStatus } from "../shared";

export type LeadBucket = "needs" | "waiting" | "closed";

export const LEAD_BUCKETS: ReadonlyArray<{ id: LeadBucket; label: string }> = [
  { id: "needs", label: "Needs response" },
  { id: "waiting", label: "Waiting" },
  { id: "closed", label: "Closed" },
];

// booked waits on the customer's visit: the counter's completed closes it, not the booking.
// shortcut: "a customer reply after the last shop touch" is not on lead.list, so only `new` needs a response; add it when the row carries it.
const BUCKET: Record<LeadStatus, LeadBucket> = {
  new: "needs",
  contacted: "waiting",
  booked: "waiting",
  completed: "closed",
  closed: "closed",
  lost: "closed",
};

/** A status this page does not know yet needs a look, so it is never dropped from every filter. */
export function leadBucket(status: string): LeadBucket {
  return BUCKET[status as LeadStatus] ?? "needs";
}

/** "12m ago", "3h ago", "2d ago"; a missing or unparsable time says so. */
export function ago(at: string | Date | null | undefined): string | null {
  if (!at) return null;
  const ms = Date.now() - new Date(at).getTime();
  if (!Number.isFinite(ms)) return null;
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
}
