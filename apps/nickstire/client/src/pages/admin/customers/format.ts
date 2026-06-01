import { type RouterOutputs } from "@/lib/trpc";

// Inferred from tRPC AppRouter — admin audit §3 follow-up.
export type ListedCustomer = NonNullable<RouterOutputs["customers"]["list"]>["customers"][number];
export type CustomerHistoryInvoice = NonNullable<RouterOutputs["customers"]["history"]>["invoices"][number];
export type CustomerDeclinedEstimate = NonNullable<RouterOutputs["customers"]["history"]>["declinedEstimates"][number];
export type CustomerOpenWorkOrder = NonNullable<RouterOutputs["customers"]["history"]>["openWorkOrders"][number];
export type TimelineEvent = NonNullable<RouterOutputs["customers"]["timeline"]>[number];

export type CustomerTab = "customers" | "loyalty" | "coupons";

export type Segment = "all" | "recent" | "lapsed" | "unknown";
export type SortBy = "name" | "visits" | "lastVisit" | "totalSpent";
export type SortDir = "asc" | "desc";

export function daysSinceStr(days: number | null | undefined): string {
  if (days == null) return "—";
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}yr ago`;
}

export type SortByExt = "name" | "visits" | "lastVisit" | "totalSpent" | "firstVisit" | "created" | "declined" | "backlog";

// wave-181.27 · format relative age for the metrics-freshness badge.
// Returns "computed Xm ago" / "Xh ago" / "Xd ago" — short form for chip.
export function formatMetricsAge(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "computed —";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `computed ${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `computed ${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `computed ${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `computed ${day}d ago`;
}
