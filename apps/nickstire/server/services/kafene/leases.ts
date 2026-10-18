/**
 * kafene_leases reads and writes (migration 0148). Keyed-checkout callers check that Kafene is enabled
 * first; applyStarted and the admin status read run without keys and handle a missing table themselves.
 *
 * Every transition that decides who acts is ONE compare-and-swap on the status the caller read
 * (claim-before-act): attach (started -> approved, uid still NULL), sign (approved -> signed),
 * activate claim (signed | activate_unclear -> activating) and its finish (activating -> activated), park
 * (activating -> activate_unclear: Kafene may have activated) or release (activating -> signed: Kafene said no).
 * A count of 0 means another call won or the row moved; the caller re-reads and reports.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { kafeneLeases, tireOrders, type KafeneLease } from "../../../drizzle/schema";
import { affectedRowCount } from "../../lib/db-affected";
import { appendAdminNote } from "../../lib/adminNotes";
import { dbTyped } from "../../lib/db-helper";

type Order = typeof tireOrders.$inferSelect;
type LeaseStatus = "signed" | "activate_unclear";
type DB = NonNullable<Awaited<ReturnType<typeof dbTyped>>>;

export const OPEN_STATUSES = ["started", "approved", "signed", "activating"] as const;
/** A lease the customer signed (and maybe Kafene activated): the order is leased, whatever the latest row says. */
export const COMMITTED_STATUSES = ["signed", "activating", "activated", "activate_unclear"] as const;

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
  const [row] = await d.select().from(kafeneLeases).where(eq(kafeneLeases.orderNumber, orderNumber)).orderBy(desc(kafeneLeases.createdAt), desc(kafeneLeases.id)).limit(1); // TiDB ids are not time-ordered
  return row ?? null;
}

/** True when ANY lease on the order is signed or later, not only the latest row. */
export async function hasCommittedLease(d: DB, orderNumber: string): Promise<boolean> {
  const [row] = await d.select({ id: kafeneLeases.id }).from(kafeneLeases)
    .where(and(eq(kafeneLeases.orderNumber, orderNumber), inArray(kafeneLeases.status, [...COMMITTED_STATUSES])))
    .limit(1);
  return row !== undefined;
}

export async function leaseByUid(d: DB, uid: string): Promise<KafeneLease | null> {
  const [row] = await d.select().from(kafeneLeases).where(eq(kafeneLeases.uid, uid)).limit(1);
  return row ?? null;
}

/** status "started" for the keyed SDK checkout; "applied" for a keyless website application click. */
export async function insertLease(d: DB, orderNumber: string, merchandiseCents: number, status: "started" | "applied" = "started"): Promise<void> {
  await d.insert(kafeneLeases).values({ orderNumber, merchandiseCents, status });
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

/** signed | activate_unclear -> activating: the one caller that wins sends the activate. */
export async function claimActivation(d: DB, id: number, from: LeaseStatus, by: string): Promise<boolean> {
  return affectedRowCount(await d.update(kafeneLeases).set({ status: "activating", activatedBy: by.slice(0, 191) }).where(and(
    eq(kafeneLeases.id, id),
    eq(kafeneLeases.status, from),
  ))) === 1;
}

/** activating -> activate_unclear: no answer or a 5xx, so Kafene may have activated it. Not retried blindly. */
export async function parkActivation(d: DB, id: number, lastError: string): Promise<void> {
  await d.update(kafeneLeases).set({ status: "activate_unclear", lastError: lastError.slice(0, 255) }).where(and(
    eq(kafeneLeases.id, id),
    eq(kafeneLeases.status, "activating"),
  ));
}

export async function finishActivation(d: DB, id: number, activationDate: string): Promise<boolean> {
  return affectedRowCount(await d.update(kafeneLeases).set({ status: "activated", activatedAt: new Date(), activationDate, lastError: null }).where(and(
    eq(kafeneLeases.id, id),
    eq(kafeneLeases.status, "activating"),
  ))) === 1;
}

/** activating -> signed with the error: Kafene answered no, so an admin can try again; never "activated". */
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

/** Append one line to the order's admin notes, in SQL (no tire_orders column is added). */
export async function appendOrderNote(d: DB, orderId: number, line: string): Promise<void> {
  await d.update(tireOrders).set({ adminNotes: appendAdminNote(line) }).where(eq(tireOrders.id, orderId));
}
