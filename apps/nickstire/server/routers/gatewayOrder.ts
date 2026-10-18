/**
 * gatewayOrder v1 · admin two-step D&K supplier order for a paid online tire order.
 *
 *   prepare      find the order's tire at D&K and put it in the shop's D&K cart with the PO
 *                "online order <orderNumber>"; show the lines back with a token of exactly them.
 *   submit       place the D&K order for exactly those lines, once, and record the D&K ref.
 *   clearOurLines take this order's lines back out of the D&K cart.
 *
 * Supplier orders spend the shop's money (AGENTS.md: protected operation), so a human taps the
 * button; nothing here runs on checkout. Cart and order WRITES need GATEWAY_ORDERING_ENABLED=true;
 * without it prepare is a read-only preview and the writers answer "disabled".
 *
 * At most one on-submit-order per order, ever: submit claims the row with a compare-and-swap
 * (gatewayOrderRef NULL -> "pending:<uuid>") before calling D&K. A definite D&K "no" releases
 * the claim; an outcome D&K may have accepted (timeout, 5xx) keeps the row parked as
 * "uncertain:<uuid>" so nobody can order the same tires twice: staff check the portal and
 * type the real ref (or clear it) in the order's admin form.
 */
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { tireOrders } from "../../drizzle/schema";
import { adminProcedure, router } from "../_core/trpc";
import { affectedRowCount } from "../lib/db-affected";
import { dbTyped } from "../lib/db-helper";
import { createLogger } from "../lib/logger";
import { getGatewayToken, pickWholesaleCost, searchTiresBySize } from "../services/gatewayClient";
import {
  addToCart,
  buildAddToCartBody,
  cartTokenFor,
  deleteCartLine,
  poNumberFor,
  readCart,
  readCutoff,
  saveCart,
  splitCart,
  submitOrder,
  withPo,
  extractOrderRef,
  type CartLine,
} from "../services/gatewaySupplierOrder";

const log = createLogger("routers:gatewayOrder");

const OPEN_STATUSES = ["received", "confirmed"] as const;

const orderingEnabled = () => process.env.GATEWAY_ORDERING_ENABLED === "true";

type Order = typeof tireOrders.$inferSelect;
type Match = { partNumber: string; brand: string; model: string; size: string; wholesaleCents: number; qtyAvailable: number | null };
type Line = { partNumber: string; description: string; quantity: number; unitCostCents: number; lineTotalCents: number; poNumber: string };
type Fail<R extends string> = { ok: false; reason: R; detail?: string };

async function loadOrder(orderId: number): Promise<Order> {
  const d = await dbTyped();
  if (!d) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable; the order could not be read." });
  const [order] = await d.select().from(tireOrders).where(eq(tireOrders.id, orderId)).limit(1);
  if (!order) throw new TRPCError({ code: "NOT_FOUND", message: `Tire order ${orderId} not found` });
  return order;
}

/** Why this order cannot be sent to D&K, or null when it can. */
function blocker(order: Order): Fail<"not_paid" | "already_ordered" | "claimed"> | null {
  if (order.paymentStatus !== "paid") return { ok: false, reason: "not_paid" };
  const ref = order.gatewayOrderRef ?? "";
  if (ref.startsWith("pending:")) return { ok: false, reason: "claimed", detail: "Another submit for this order is in progress." };
  if (ref.startsWith("uncertain:")) {
    return { ok: false, reason: "already_ordered", detail: "The last D&K submit had no clear answer. Check the D&K portal, then enter the D&K ref (or clear it) in the order." };
  }
  if (ref !== "") return { ok: false, reason: "already_ordered", detail: `D&K ref ${ref}` };
  if (!(OPEN_STATUSES as readonly string[]).includes(order.status)) return { ok: false, reason: "already_ordered", detail: `Order is ${order.status}` };
  return null;
}

const toLine = (l: CartLine): Line => ({
  partNumber: l.partNumber,
  description: l.description,
  quantity: l.quantity,
  unitCostCents: l.unitCostCents,
  lineTotalCents: l.unitCostCents * l.quantity,
  poNumber: l.poNumber,
});

const norm = (s: unknown) => String(s ?? "").trim().toUpperCase();
/** gatewayTire.publicSearch stores model = minor_name without its "BRAND - " prefix; match the same way. */
const modelOf = (item: Record<string, unknown>) => String(item.minor_name ?? "").replace(/^[A-Z]+\s*-\s*/, "");

function toMatch(item: Record<string, unknown>, size: string): Match {
  const pricing = Array.isArray(item.pricing_data) ? (item.pricing_data[0] as Record<string, unknown> | undefined) : undefined;
  return {
    partNumber: String(item.dk_part_number ?? ""),
    brand: norm(item.make),
    model: modelOf(item),
    size: String(item.invent_size ?? size),
    wholesaleCents: Math.round(pickWholesaleCost(item) * 100),
    qtyAvailable: typeof pricing?.quantity === "number" ? pricing.quantity : null,
  };
}

/** Same path the gatewayTire status alerts use; an alert failure never fails the order. */
async function alert(text: string, cls: "incident" | "receipt"): Promise<void> {
  try {
    const { sendTelegram } = await import("../services/telegram");
    await sendTelegram(text, cls);
  } catch (e) {
    log.warn("telegram alert failed", { error: e instanceof Error ? e.message : String(e) });
  }
}

/** Shared by prepare and submit: the D&K login and the account's ship-to. */
async function configured(): Promise<string | null> {
  const shipTo = process.env.GATEWAY_TIRE_SHIP_TO?.trim();
  if (!shipTo) return null;
  return (await getGatewayToken()) ? shipTo : null;
}

export const gatewayOrderRouter = router({
  prepare: adminProcedure
    .input(z.object({ orderId: z.number().int().positive(), partNumber: z.string().trim().min(1).max(64).optional() }))
    .mutation(async ({ input }) => {
      const order = await loadOrder(input.orderId);
      const blocked = blocker(order);
      if (blocked) return blocked;
      const shipTo = await configured();
      if (!shipTo) return { ok: false as const, reason: "unconfigured" as const };
      const preview = !orderingEnabled();
      const po = poNumberFor(order.orderNumber);

      // 1. The order's tire at D&K: same brand + model as the customer bought, in the order's size.
      const results = await searchTiresBySize(order.tireSize);
      if (!results) return { ok: false as const, reason: "upstream_error" as const, detail: "D&K search failed" };
      const sameTire = results.filter((i) => norm(i.make) === norm(order.tireBrand) && norm(modelOf(i)) === norm(order.tireModel));
      const byPart = new Map(sameTire.map((i) => [String(i.dk_part_number ?? ""), i] as const));
      byPart.delete("");
      let item: Record<string, unknown> | undefined;
      if (input.partNumber) item = byPart.get(input.partNumber);
      else if (byPart.size === 1) item = [...byPart.values()][0];
      else if (byPart.size > 1) {
        return { ok: false as const, reason: "ambiguous_match" as const, candidates: [...byPart.values()].map((i) => toMatch(i, order.tireSize)) };
      }
      if (!item) return { ok: false as const, reason: "no_match" as const };
      const match = toMatch(item, order.tireSize);

      // 2. The cart must not hold anyone else's lines: we would order them with ours.
      const before = await readCart(shipTo);
      if (!before.ok) return { ok: false as const, reason: "upstream_error" as const, detail: before.detail };
      const { foreign, ours: alreadyOurs } = splitCart(before.value, po);
      if (foreign.length > 0 && !preview) {
        return { ok: false as const, reason: "cart_not_empty" as const, otherLines: foreign.map(toLine) };
      }

      let lines: CartLine[];
      if (preview) {
        // What prepare WOULD add; nothing is written without the flag.
        lines = alreadyOurs.length > 0 ? alreadyOurs : [{
          id: "", partNumber: match.partNumber, description: String(item.display_name ?? ""), quantity: order.quantity,
          available: match.qtyAvailable, unitCostCents: Math.round(Number((item.pricing_data as Array<Record<string, unknown>>)?.[0]?.selling_price ?? 0) * 100),
          poNumber: po, siteId: null,
        }];
      } else {
        if (alreadyOurs.length === 0) {
          // 3. Add the tires, then put our PO on the line(s) the way the portal saves PO edits.
          const added = await addToCart(buildAddToCartBody(item, order.quantity, shipTo));
          if (!added.ok) return { ok: false as const, reason: "upstream_error" as const, detail: added.detail };
          const afterAdd = await readCart(shipTo);
          if (!afterAdd.ok) return { ok: false as const, reason: "upstream_error" as const, detail: afterAdd.detail };
          const parts = splitCart(afterAdd.value, po).foreign;
          // Only our part may be in the cart now; a staff line added meanwhile must not get our PO.
          if (parts.some((l) => l.partNumber !== match.partNumber)) {
            return { ok: false as const, reason: "cart_not_empty" as const, otherLines: parts.filter((l) => l.partNumber !== match.partNumber).map(toLine) };
          }
          const saved = await saveCart(withPo(afterAdd.value, po));
          if (!saved.ok) return { ok: false as const, reason: "upstream_error" as const, detail: saved.detail };
        }
        const after = await readCart(shipTo);
        if (!after.ok) return { ok: false as const, reason: "upstream_error" as const, detail: after.detail };
        const split = splitCart(after.value, po);
        if (split.ours.length === 0) {
          return { ok: false as const, reason: "upstream_error" as const, detail: "D&K did not keep the PO number on the cart line; the order cannot be matched safely. Finish it in the D&K portal." };
        }
        lines = split.ours;
      }

      const cutoff = await readCutoff(shipTo, lines[0]?.siteId ?? null);
      return {
        ok: true as const,
        preview,
        match,
        lines: lines.map(toLine),
        cartHadOtherLines: foreign.length > 0,
        cutoff,
        cartToken: cartTokenFor(lines),
      };
    }),

  submit: adminProcedure
    .input(z.object({ orderId: z.number().int().positive(), cartToken: z.string().regex(/^[a-f0-9]{64}$/) }))
    .mutation(async ({ input, ctx }) => {
      if (!orderingEnabled()) return { ok: false as const, reason: "disabled" as const };
      const order = await loadOrder(input.orderId);
      const blocked = blocker(order);
      if (blocked) return blocked;
      const shipTo = await configured();
      if (!shipTo) return { ok: false as const, reason: "unconfigured" as const };
      const po = poNumberFor(order.orderNumber);

      // Re-read the cart: send only if it still holds exactly the lines the admin saw.
      const cart = await readCart(shipTo);
      if (!cart.ok) return { ok: false as const, reason: "upstream_error" as const, detail: cart.detail };
      const { ours, foreign } = splitCart(cart.value, po);
      if (foreign.length > 0) return { ok: false as const, reason: "token_mismatch" as const, detail: "The D&K cart has lines that are not this order's." };
      if (ours.length === 0 || cartTokenFor(ours) !== input.cartToken) {
        return { ok: false as const, reason: "token_mismatch" as const, detail: "The D&K cart changed since prepare. Prepare again." };
      }
      const top = cart.value[0] as Record<string, unknown> | undefined;
      if (top?.site_level_prepay === true && top?.customer_level_prepay === true) {
        return { ok: false as const, reason: "upstream_error" as const, detail: "D&K wants a payment card for this order. Place it in the D&K portal." };
      }
      const short = ours.find((l) => l.available !== null && l.available < l.quantity);
      if (short) return { ok: false as const, reason: "upstream_error" as const, detail: `D&K has ${short.available} of ${short.quantity} ${short.partNumber}: backorder. Decide in the D&K portal.` };

      // CLAIM BEFORE ACT: one compare-and-swap on the exact fields the decision read.
      const d = await dbTyped();
      if (!d) return { ok: false as const, reason: "upstream_error" as const, detail: "Database unavailable" };
      const claim = `pending:${randomUUID()}`;
      const claimed = affectedRowCount(await d.update(tireOrders).set({ gatewayOrderRef: claim }).where(and(
        eq(tireOrders.id, order.id),
        or(isNull(tireOrders.gatewayOrderRef), eq(tireOrders.gatewayOrderRef, "")),
        eq(tireOrders.paymentStatus, "paid"),
        inArray(tireOrders.status, [...OPEN_STATUSES]),
      )));
      if (claimed !== 1) {
        const now = await loadOrder(order.id);
        return blocker(now) ?? { ok: false as const, reason: "claimed" as const };
      }

      const whereOurClaim = and(eq(tireOrders.id, order.id), eq(tireOrders.gatewayOrderRef, claim));
      const outcome = await submitOrder(cart.value);
      const actor = ctx.user?.email ?? ctx.user?.name ?? "admin";
      const tires = `${order.quantity}x ${order.tireBrand} ${order.tireModel} ${order.tireSize}`;

      if (outcome.kind === "rejected") {
        await d.update(tireOrders).set({ gatewayOrderRef: null }).where(whereOurClaim);
        // D&K's text goes to the admin, not the log: an upstream body can echo anything back.
        log.warn(`D&K refused order ${order.orderNumber}; claim released`);
        return { ok: false as const, reason: "upstream_error" as const, detail: outcome.detail };
      }
      if (outcome.kind === "uncertain") {
        // Park it: D&K may have placed the order, so this order must not be sent again.
        await d.update(tireOrders).set({ gatewayOrderRef: `uncertain:${claim.slice("pending:".length)}` }).where(whereOurClaim);
        log.error(`D&K order outcome UNKNOWN for ${order.orderNumber}`, { detail: outcome.detail });
        await alert(
          `⚠️ D&K ORDER UNCLEAR — ${order.orderNumber}\n${tires}\n${outcome.detail}\n` +
          `Check the D&K portal for PO "${po}" before doing anything else.`,
          "incident",
        );
        return { ok: false as const, reason: "upstream_error" as const, detail: `${outcome.detail}. D&K may have placed it: check the D&K portal for PO "${po}" before trying again.` };
      }

      const gatewayOrderRef = extractOrderRef(outcome.body).slice(0, 100);
      const submittedAt = new Date().toISOString();
      const note = `D&K order placed ${submittedAt} by ${actor} PO ${po}`;
      try {
        await d.update(tireOrders).set({
          gatewayOrderRef,
          status: "ordered",
          adminNotes: order.adminNotes ? `${order.adminNotes}\n${note}` : note,
        }).where(whereOurClaim);
      } catch (err) {
        // The order IS placed. Keep the claim (never released after a placed order) and say so loudly.
        log.error(`D&K order ${gatewayOrderRef} placed for ${order.orderNumber} but the row update failed`, { error: err instanceof Error ? err.message : String(err) });
      }

      const { logAdminAction } = await import("../services/auditTrail");
      await logAdminAction({
        action: "tireorder.supplier_ordered",
        entityType: "tire_order",
        entityId: order.orderNumber,
        details: `D&K order placed for ${order.orderNumber}: ${tires}, PO ${po}`,
        previousValue: String(order.status),
        newValue: gatewayOrderRef,
        actor,
      }).catch(() => { /* audit must never block the order */ });
      await alert(`🛒 D&K ORDER PLACED — ${order.orderNumber}\n${tires}\nD&K ref: ${gatewayOrderRef}`, "receipt");

      // Best effort: take our lines out if D&K left them in the cart. Never touch anyone else's.
      const leftover = await readCart(shipTo);
      if (leftover.ok) {
        for (const l of splitCart(leftover.value, po).ours) if (l.id) await deleteCartLine(l.id);
      }
      return { ok: true as const, gatewayOrderRef, submittedAt };
    }),

  clearOurLines: adminProcedure
    .input(z.object({ orderId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      if (!orderingEnabled()) return { ok: false as const, reason: "disabled" as const };
      const order = await loadOrder(input.orderId);
      const shipTo = await configured();
      if (!shipTo) return { ok: false as const, reason: "unconfigured" as const };
      const cart = await readCart(shipTo);
      if (!cart.ok) return { ok: false as const, reason: "upstream_error" as const, detail: cart.detail };
      let removed = 0;
      for (const l of splitCart(cart.value, poNumberFor(order.orderNumber)).ours) {
        if (!l.id) continue;
        const r = await deleteCartLine(l.id);
        if (!r.ok) return { ok: false as const, reason: "upstream_error" as const, detail: r.detail, removed };
        removed++;
      }
      return { ok: true as const, removed };
    }),
});
