/**
 * kafene v1 · Kafene lease checkout for a placed tire order.
 *
 * Public (the customer, identified by order number + phone like gatewayTire.createCheckout):
 *   config      the browser SDK ids, only while Kafene is enabled, and the merchant limit
 *   start       the SDK payload for the order; records a "started" lease
 *   attach      the uid Kafene's SDK gave on approval -> the lease (compare-and-swap)
 *   markSigned  the SDK reported "completed": lease signed, shop hand-off, order NOT marked paid
 * Admin:
 *   activate    at install: starts Kafene funding (about 2 business days); one call per lease
 *   cancel      cancels the application at Kafene
 *   status      the order's latest lease
 *
 * The keyed checkout is off unless KAFENE_MERCHANT_ID, KAFENE_STORE_ID and KAFENE_API_KEY are all set:
 * config/start/attach/markSigned/activate/cancel then answer "disabled" before touching the network or
 * the kafene_leases table (0148). applyStarted (keyless website click) and status work without them.
 *
 * The browser's "signed" is the customer's report, not Kafene's: Kafene's own plugin trusts the
 * same callback, and no server-side status read is published. So the order is never marked paid
 * here; money is real only after activate succeeds, and the hand-off tells staff to confirm the
 * lease in the Kafene Merchant Portal before ordering tires.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { dbTyped } from "../lib/db-helper";
import { isMissingTableError } from "../lib/dbErrors";
import { clientIp } from "../middleware/rateLimiters";
import { createLogger } from "../lib/logger";
import { getBusinessDateKey } from "../lib/timezoneAssert";
import { activateLease, cancelLease, kafeneEnv, maxApprovalCents } from "../services/kafene/partnerApi";
import {
  OPEN_STATUSES,
  appendOrderNote,
  attachUid,
  claimActivation,
  finishActivation,
  findOrder,
  findOrderByNumber,
  insertLease,
  latestLease,
  leaseByUid,
  markCancelled,
  recordCancelFailure,
  refreshStartedLease,
  releaseActivation,
  signLease,
} from "../services/kafene/leases";

const log = createLogger("routers:kafene");

const ids = { orderNumber: z.string().trim().min(1).max(50), phone: z.string().trim().min(7).max(30) };
/** Kafene application ids: letters, digits, "_" and "-", at most 64 (the uid column width). */
const uid = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/);

const disabled = { ok: false as const, reason: "disabled" as const };

async function alert(text: string): Promise<void> {
  try {
    const { sendTelegram } = await import("../services/telegram");
    await sendTelegram(text, "receipt");
  } catch (e) {
    log.warn("kafene telegram failed", { error: e instanceof Error ? e.message : String(e) });
  }
}

// ── applyStarted: keyless "Apply with Kafene" click (no KAFENE_* env needed) ──
const APPLY_DAY_MS = 24 * 60 * 60_000;
const APPLY_WINDOW_MS = 60 * 60_000;
const APPLY_MAX_PER_WINDOW = 5;
const MAX_TRACKED = 5_000;
/** Per-IP calls in the last hour. Per CALL, not per HTTP request: a batch carries several. */
const applyCallsByIp = new Map<string, number[]>();
/** Orders the shop was told about, so a repeat (or a race, or a missing table) stays quiet for 24 h. */
const appliedNotified = new Map<string, number>();

function takeApplyCall(ip: string): boolean {
  const now = Date.now();
  const recent = (applyCallsByIp.get(ip) ?? []).filter((t) => now - t < APPLY_WINDOW_MS);
  if (recent.length >= APPLY_MAX_PER_WINDOW) {
    applyCallsByIp.set(ip, recent);
    return false;
  }
  recent.push(now);
  applyCallsByIp.delete(ip);
  applyCallsByIp.set(ip, recent);
  if (applyCallsByIp.size > MAX_TRACKED) applyCallsByIp.delete(applyCallsByIp.keys().next().value as string);
  return true;
}

/** "Pat Q Doe" -> first "Pat", last "Q Doe". */
function splitName(name: string): { first_name: string; last_name: string } {
  const t = name.trim();
  const i = t.indexOf(" ");
  return i === -1 ? { first_name: t, last_name: "" } : { first_name: t.slice(0, i), last_name: t.slice(i + 1).trim() };
}

export const kafeneRouter = router({
  config: publicProcedure.query(async () => {
    const env = kafeneEnv();
    if (!env) return { enabled: false, apiKey: null, storeId: null, environment: null, maxApprovalCents: null };
    // Kafene's browser SDK is initialised with the API key and Store ID by design; they are served
    // only while Kafene is enabled and are never stored anywhere but env.
    return { enabled: true, apiKey: env.apiKey, storeId: env.storeId, environment: env.environment, maxApprovalCents: await maxApprovalCents(env) };
  }),

  start: publicProcedure.input(z.object(ids)).mutation(async ({ input }) => {
    const env = kafeneEnv();
    if (!env) return disabled;
    const d = await dbTyped();
    if (!d) return { ok: false as const, reason: "upstream_error" as const };
    try {
      const order = await findOrder(d, input.orderNumber, input.phone);
      if (!order) return { ok: false as const, reason: "not_found" as const };
      if (order.paymentStatus === "paid") return { ok: false as const, reason: "already_paid" as const };
      if (order.status === "cancelled") return { ok: false as const, reason: "cancelled" as const };
      if (!order.totalAmount || order.totalAmount <= 0 || !order.quantity || order.quantity <= 0) return { ok: false as const, reason: "not_found" as const };

      // One leasable line per tire at the order's installed per-tire price, in DOLLARS (Kafene
      // items are dollars; our columns are cents). No tax and no card-fee line: the lease terms
      // replace the card fee, and sales tax is settled with the shop at install.
      const price = Math.round(order.totalAmount / order.quantity) / 100;
      const merchandiseCents = Math.round(price * 100) * order.quantity;
      const limit = await maxApprovalCents(env);
      if (limit !== null && merchandiseCents > limit) return { ok: false as const, reason: "over_limit" as const };

      const lease = await latestLease(d, order.orderNumber);
      if (lease && (lease.status === "signed" || lease.status === "activating" || lease.status === "activated")) {
        return { ok: false as const, reason: "already_signed" as const };
      }
      if (lease && lease.status === "started") await refreshStartedLease(d, lease.id, merchandiseCents);
      else await insertLease(d, order.orderNumber, merchandiseCents);

      const label = `${order.tireBrand} ${order.tireModel} ${order.tireSize}`.slice(0, 60);
      return {
        ok: true as const,
        orderId: order.orderNumber,
        items: [{ model: label, description: label, price, quantity: order.quantity, condition: "New", damage: "", leasable: true }],
        shippingCost: 0,
        customer: {
          billing: {
            ...splitName(order.customerName),
            phone: order.customerPhone,
            ...(order.customerEmail ? { email: order.customerEmail } : {}),
          },
        },
      };
    } catch (err) {
      log.warn("kafene.start failed", { error: err instanceof Error ? err.name : "unknown" });
      return { ok: false as const, reason: "upstream_error" as const };
    }
  }),

  /**
   * The customer tapped "Apply with Kafene" on the website (Kafene's own application link, no SDK).
   * Works with NO KAFENE_* env: it only tells the shop, once per order per 24 h, so staff can find
   * the application in merchant.kafene.com by phone. Never "disabled", never marks anything paid.
   */
  applyStarted: publicProcedure.input(z.object(ids)).mutation(async ({ input, ctx }) => {
    if (!takeApplyCall(ctx.req ? clientIp(ctx.req) : "unknown")) return { ok: false as const, reason: "rate_limited" as const };
    const d = await dbTyped();
    if (!d) return { ok: false as const, reason: "upstream_error" as const };
    const order = await findOrder(d, input.orderNumber, input.phone);
    if (!order) return { ok: false as const, reason: "not_found" as const };
    if (order.paymentStatus === "paid") return { ok: false as const, reason: "already_paid" as const };
    if (order.status === "cancelled") return { ok: false as const, reason: "cancelled" as const };

    let tableReady = true;
    let lease: Awaited<ReturnType<typeof latestLease>> = null;
    try {
      lease = await latestLease(d, order.orderNumber);
    } catch (err) {
      if (!isMissingTableError(err)) return { ok: false as const, reason: "upstream_error" as const };
      tableReady = false; // 0148 not applied yet: still tell the shop, deduped in memory
    }
    const now = Date.now();
    // An order already in the keyed checkout is tracked there.
    if (lease && (OPEN_STATUSES as readonly string[]).includes(lease.status)) return { ok: true as const };
    if (lease?.status === "applied" && now - new Date(lease.createdAt).getTime() < APPLY_DAY_MS) return { ok: true as const };
    // Checked and set with no await in between, so two concurrent clicks send one Telegram.
    const told = appliedNotified.get(order.orderNumber);
    if (told !== undefined && now - told < APPLY_DAY_MS) return { ok: true as const };
    appliedNotified.set(order.orderNumber, now);
    if (appliedNotified.size > MAX_TRACKED) appliedNotified.delete(appliedNotified.keys().next().value as string);

    if (tableReady) {
      try {
        await insertLease(d, order.orderNumber, order.totalAmount, "applied");
      } catch (err) {
        log.warn("kafene.applyStarted lease row failed", { error: err instanceof Error ? err.name : "unknown" });
      }
    }
    try {
      await appendOrderNote(d, order, `Kafene application started from the website ${new Date(now).toISOString()}`);
    } catch (err) {
      log.warn("kafene.applyStarted order note failed", { error: err instanceof Error ? err.name : "unknown" });
    }
    const last4 = order.customerPhone.replace(/\D/g, "").slice(-4);
    await alert(
      `Kafene: ${splitName(order.customerName).first_name} started an application for order ${order.orderNumber} ` +
      `(${order.tireBrand} ${order.tireModel} ${order.tireSize} x${order.quantity}, $${(order.totalAmount / 100).toFixed(2)}). ` +
      `Look it up in merchant.kafene.com by phone when they come in. Phone ends in ${last4}.`,
    );
    return { ok: true as const };
  }),

  attach: publicProcedure.input(z.object({ ...ids, uid })).mutation(async ({ input }) => {
    if (!kafeneEnv()) return disabled;
    const d = await dbTyped();
    if (!d) return { ok: false as const, reason: "not_found" as const };
    const order = await findOrder(d, input.orderNumber, input.phone);
    if (!order) return { ok: false as const, reason: "not_found" as const };
    const owner = await leaseByUid(d, input.uid);
    if (owner) {
      // A retried attach of the same uid is fine; the uid on anyone else's lease is not.
      return owner.orderNumber === order.orderNumber ? { ok: true as const } : { ok: false as const, reason: "conflict" as const };
    }
    const lease = await latestLease(d, order.orderNumber);
    if (!lease || !(OPEN_STATUSES as readonly string[]).includes(lease.status)) return { ok: false as const, reason: "not_found" as const };
    if (lease.status !== "started" || lease.uid !== null) return { ok: false as const, reason: "conflict" as const };
    if (await attachUid(d, lease, input.uid)) return { ok: true as const };
    const now = await leaseByUid(d, input.uid);
    return now?.orderNumber === order.orderNumber ? { ok: true as const } : { ok: false as const, reason: "conflict" as const };
  }),

  markSigned: publicProcedure.input(z.object({ ...ids, uid })).mutation(async ({ input }) => {
    if (!kafeneEnv()) return disabled;
    const d = await dbTyped();
    if (!d) return { ok: false as const, reason: "not_found" as const };
    const order = await findOrder(d, input.orderNumber, input.phone);
    if (!order) return { ok: false as const, reason: "not_found" as const };
    const lease = await leaseByUid(d, input.uid);
    if (!lease || lease.orderNumber !== order.orderNumber) return { ok: false as const, reason: "unknown_uid" as const };
    if (lease.status === "signed" || lease.status === "activating" || lease.status === "activated") {
      return { ok: true as const, status: "signed" as const }; // already recorded; no second hand-off
    }
    if (!(await signLease(d, order.orderNumber, input.uid))) {
      const now = await leaseByUid(d, input.uid);
      return now && now.status !== "approved" && ["signed", "activating", "activated"].includes(now.status)
        ? { ok: true as const, status: "signed" as const }
        : { ok: false as const, reason: "unknown_uid" as const };
    }

    // Only the call that flipped approved -> signed hands off, so a repeated callback sends nothing.
    // paymentStatus stays as it is: tire_orders knows only unpaid/paid/refunded, and nothing is
    // collected until the lease is activated.
    const at = new Date().toISOString();
    try {
      await appendOrderNote(d, order, `Kafene lease signed ${at} uid ${input.uid}`);
    } catch (err) {
      log.error(`Kafene lease ${input.uid} signed for ${order.orderNumber} but the order note failed`, { error: err instanceof Error ? err.name : "unknown" });
    }
    const leaseAmount = lease.merchandiseCents / 100;
    try {
      const { notifyTireOrderKafeneSigned } = await import("../email-notify");
      const res = await notifyTireOrderKafeneSigned({
        orderNumber: order.orderNumber,
        uid: input.uid,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerEmail: order.customerEmail || undefined,
        vehicleInfo: order.vehicleInfo || undefined,
        tireBrand: order.tireBrand,
        tireModel: order.tireModel,
        tireSize: order.tireSize,
        quantity: order.quantity,
        leaseAmount,
        customerNotes: order.customerNotes || undefined,
      });
      if (!res?.emailSent) log.error(`Kafene lease signed for ${order.orderNumber} but the shop hand-off email did NOT send — fulfil it manually`);
    } catch (err) {
      log.error(`Kafene lease signed for ${order.orderNumber} but the shop hand-off email threw — fulfil it manually`, { error: err instanceof Error ? err.name : "unknown" });
    }
    await alert(
      `Kafene lease signed — ${order.orderNumber}\n${order.quantity}x ${order.tireBrand} ${order.tireModel} (${order.tireSize})\n` +
      `${order.customerName} · ${order.customerPhone}\n$${leaseAmount.toFixed(2)} leased, NOT collected yet: activate at install.\n` +
      `Confirm application ${input.uid} in the Kafene portal, then order the tires.`,
    );
    return { ok: true as const, status: "signed" as const };
  }),

  activate: adminProcedure.input(z.object({ orderNumber: ids.orderNumber })).mutation(async ({ input, ctx }) => {
    const env = kafeneEnv();
    if (!env) return disabled;
    const d = await dbTyped();
    if (!d) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable; the lease could not be read." });
    const lease = await latestLease(d, input.orderNumber);
    if (!lease || lease.status !== "signed" || !lease.uid) return { ok: false as const, reason: "not_signed" as const };
    const by = ctx.user?.email ?? ctx.user?.name ?? "admin";
    // CLAIM BEFORE ACT: signed -> activating. The loser of a double tap never calls Kafene.
    if (!(await claimActivation(d, lease.id, by))) return { ok: false as const, reason: "not_signed" as const };

    const deliveryDate = getBusinessDateKey();
    const r = await activateLease(env, lease.uid, deliveryDate);
    if (!r.ok) {
      const lastError = r.status === null ? "Kafene activate: no answer" : `Kafene activate HTTP ${r.status}`;
      await releaseActivation(d, lease.id, lastError);
      return { ok: false as const, reason: "upstream_error" as const, detail: lastError };
    }
    if (!(await finishActivation(d, lease.id, deliveryDate))) {
      log.error(`Kafene lease ${lease.uid} ACTIVATED at Kafene for ${input.orderNumber} but the row was not updated`);
    }
    const order = await findOrderByNumber(d, input.orderNumber);
    const at = new Date().toISOString();
    if (order) {
      try {
        await appendOrderNote(d, order, `Kafene lease activated ${at} by ${by} uid ${lease.uid} delivery ${deliveryDate}`);
      } catch (err) {
        log.error(`Kafene lease activated for ${input.orderNumber} but the order note failed`, { error: err instanceof Error ? err.name : "unknown" });
      }
    }
    await alert(`Kafene lease activated, funding in about 2 business days — ${input.orderNumber}\n$${(lease.merchandiseCents / 100).toFixed(2)} · application ${lease.uid}`);
    return { ok: true as const, status: "activated" as const, activatedAt: at, activationDate: deliveryDate };
  }),

  cancel: adminProcedure.input(z.object({ orderNumber: ids.orderNumber, reason: z.string().trim().min(1).max(200) })).mutation(async ({ input }) => {
    const env = kafeneEnv();
    if (!env) return disabled;
    const d = await dbTyped();
    if (!d) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable; the lease could not be read." });
    const lease = await latestLease(d, input.orderNumber);
    if (!lease || lease.status === "cancelled" || lease.status === "activating") return { ok: false as const, reason: "not_found" as const };
    if (lease.uid) {
      const r = await cancelLease(env, lease.uid, input.reason);
      if (!r.ok) {
        const lastError = r.status === null ? "Kafene cancel: no answer" : `Kafene cancel HTTP ${r.status}`;
        await recordCancelFailure(d, lease.id, lastError);
        return { ok: false as const, reason: "upstream_error" as const, detail: lastError };
      }
    }
    if (!(await markCancelled(d, lease))) return { ok: false as const, reason: "conflict" as const };
    return { ok: true as const, status: "cancelled" as const };
  }),

  /** Works with no KAFENE_* env too: a keyless "applied" row must show in the admin. */
  status: adminProcedure.input(z.object({ orderNumber: ids.orderNumber })).query(async ({ input }) => {
    const d = await dbTyped();
    if (!d) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable; the lease is unknown, not absent." });
    try {
      return { ok: true as const, lease: await latestLease(d, input.orderNumber) };
    } catch (err) {
      if (isMissingTableError(err)) return { ok: false as const, reason: "not_installed" as const };
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable; the lease is unknown, not absent." });
    }
  }),
});
