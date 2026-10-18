/**
 * kafene_leases reads and writes (migration 0148). Callers check that Kafene is enabled first,
 * so nothing here runs against a database that has not had 0148 applied.
 *
 * Every transition that decides who acts is ONE compare-and-swap on the status the caller read
 * (claim-before-act): attach (started -> approved, uid still NULL), sign (approved -> signed),
 * activate claim (signed -> activating) and its finish/release (activating -> activated|signed).
 * A count of 0 means another call won or the row moved; the caller re-reads and reports.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { kafeneLeases, tireOrders, type KafeneLease } from "../../../drizzle/schema";
import { affectedRowCount } from "../../lib/db-affected";
import { dbTyped } from "../../lib/db-helper";

type Order = typeof tireOrders.$inferSelect;
type DB = NonNullable<Awaited<ReturnType<typeof dbTyped>>>;

export const OPEN_STATUSES = ["started", "approved", "signed", "activating"] as const;

/** The order, matched on number AND phone like gatewayTire.createCheckout. */
export async function findOrder(d: DB, orderNumber: string, phone: string): Promise<Order | null> {
  const [order] = await d.select().from(tireOrders)
    .where(and(eq(tireOrders.orderNumber, orderNumber), eq(tireOrders.customerPhone, phone)))
    .limit(1);
  return order ?? null;
}

export async function findOrderByNumber(d: DB, orderNumber: string): Promise<Order | null> {
  const [order] = await d.select().from(tireOrders).where(eq(tireOrders.orderNumber, orderNumber)).limit(1);
  return order ?? null;
}

export async function latestLease(d: DB, orderNumber: string): Promise<KafeneLease | null> {
  const [row] = await d.select().from(kafeneLeases).where(eq(kafeneLeases.orderNumber, orderNumber)).orderBy(desc(kafeneLeases.id)).limit(1);
  return row ?? null;
}

export async function leaseByUid(d: DB, uid: string): Promise<KafeneLease | null> {
  const [row] = await d.select().from(kafeneLeases).where(eq(kafeneLeases.uid, uid)).limit(1);
  return row ?? null;
}

export async function insertLease(d: DB, orderNumber: string, merchandiseCents: number): Promise<void> {
  await d.insert(kafeneLeases).values({ orderNumber, merchandiseCents, status: "started" });
}

export async function refreshStartedLease(d: DB, id: number, merchandiseCents: number): Promise<void> {
  await d.update(kafeneLeases).set({ merchandiseCents }).where(and(eq(kafeneLeases.id, id), eq(kafeneLeases.status, "started")));
}

/** started -> approved with Kafene's uid; only while the row has no uid yet. */
export async function attachUid(d: DB, lease: KafeneLease, uid: string): Promise<boolean> {
  return affectedRowCount(await d.update(kafeneLeases).set({ uid, status: "approved" }).where(and(
    eq(kafeneLeases.id, lease.id),
    eq(kafeneLeases.orderNumber, lease.orderNumber),
    eq(kafeneLeases.status, "started"),
    isNull(kafeneLeases.uid),
  ))) === 1;
}

/** approved -> signed for this order's uid. */
export async function signLease(d: DB, orderNumber: string, uid: string): Promise<boolean> {
  return affectedRowCount(await d.update(kafeneLeases).set({ status: "signed" }).where(and(
    eq(kafeneLeases.orderNumber, orderNumber),
    eq(kafeneLeases.uid, uid),
    eq(kafeneLeases.status, "approved"),
  ))) === 1;
}

/** signed -> activating: the one caller that wins sends the activate. */
export async function claimActivation(d: DB, id: number, by: string): Promise<boolean> {
  return affectedRowCount(await d.update(kafeneLeases).set({ status: "activating", activatedBy: by.slice(0, 191) }).where(and(
    eq(kafeneLeases.id, id),
    eq(kafeneLeases.status, "signed"),
  ))) === 1;
}

export async function finishActivation(d: DB, id: number, activationDate: string): Promise<boolean> {
  return affectedRowCount(await d.update(kafeneLeases).set({ status: "activated", activatedAt: new Date(), activationDate, lastError: null }).where(and(
    eq(kafeneLeases.id, id),
    eq(kafeneLeases.status, "activating"),
  ))) === 1;
}

/** activating -> signed with the error, so an admin can try again; never "activated". */
export async function releaseActivation(d: DB, id: number, lastError: string): Promise<void> {
  await d.update(kafeneLeases).set({ status: "signed", lastError: lastError.slice(0, 255) }).where(and(
    eq(kafeneLeases.id, id),
    eq(kafeneLeases.status, "activating"),
  ));
}

export async function markCancelled(d: DB, lease: KafeneLease): Promise<boolean> {
  return affectedRowCount(await d.update(kafeneLeases).set({ status: "cancelled", cancelledAt: new Date() }).where(and(
    eq(kafeneLeases.id, lease.id),
    eq(kafeneLeases.status, lease.status),
  ))) === 1;
}

export async function recordCancelFailure(d: DB, id: number, lastError: string): Promise<void> {
  await d.update(kafeneLeases).set({ lastError: lastError.slice(0, 255) }).where(eq(kafeneLeases.id, id));
}

/** Append one line to the order's admin notes (no tire_orders column is added). */
export async function appendOrderNote(d: DB, order: Order, line: string): Promise<void> {
  await d.update(tireOrders).set({ adminNotes: order.adminNotes ? `${order.adminNotes}\n${line}` : line }).where(eq(tireOrders.id, order.id));
}
