/**
 * Next-action algorithm for tire-order fulfillment. Pure — consumed by
 * the admin Tire Orders tab (display + sorting) and unit tests.
 *
 * Priority mirrors the shop's actual workflow: paid orders first (the
 * customer's money is already in hand, the Gateway order is the
 * bottleneck), then contact/confirm, then logistics. Lower number =
 * more urgent; the admin list sorts ascending so the operator's next
 * move is always at the top.
 */

export type TireOrderNextAction = {
  /** 1 = most urgent. Sort ascending. */
  priority: number;
  label: string;
  /** Chip tone for the admin UI. */
  tone: "crit" | "warn" | "info" | "ok" | "muted";
};

export function nextActionForOrder(o: {
  status: string;
  paymentStatus?: string | null;
  expectedDelivery?: string | Date | null;
}): TireOrderNextAction {
  const paid = o.paymentStatus === "paid";
  switch (o.status) {
    case "received":
      return paid
        ? { priority: 1, label: "PAID — confirm availability + order from Gateway NOW", tone: "crit" }
        : { priority: 2, label: "New request — call customer to confirm", tone: "warn" };
    case "confirmed":
      return paid
        ? { priority: 1, label: "PAID — order from Gateway (b2b.dktire.com)", tone: "crit" }
        : { priority: 3, label: "Confirmed — order from Gateway, collect at install", tone: "warn" };
    case "ordered":
    case "in_transit":
      return o.expectedDelivery
        ? { priority: 4, label: "Awaiting delivery", tone: "info" }
        : { priority: 4, label: "Awaiting delivery — set ETA", tone: "info" };
    case "delivered":
      return { priority: 2, label: "Tires arrived — call customer to schedule install", tone: "warn" };
    case "scheduled":
      return { priority: 5, label: "Install at appointment", tone: "info" };
    case "installed":
      return paid
        ? { priority: 7, label: "Done — paid online", tone: "ok" }
        : { priority: 6, label: "Installed — collect balance at shop", tone: "warn" };
    case "cancelled":
      return paid
        ? { priority: 1, label: "CANCELLED but PAID — refund via Stripe dashboard", tone: "crit" }
        : { priority: 8, label: "Cancelled", tone: "muted" };
    default:
      return { priority: 9, label: "Review order", tone: "muted" };
  }
}
