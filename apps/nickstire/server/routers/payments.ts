/**
 * Payments Router — Stripe payment processing for invoices
 *
 * Public endpoints for customers to pay their invoices via credit card.
 * Works with direct CC and Snap Finance virtual cards (processed through Stripe).
 */
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { invoices } from "../../drizzle/schema";

import { db } from "../lib/db-helper";

import { createLogger } from "../lib/logger";

const log = createLogger("routers:payments");
export const paymentsRouter = router({
  /** Get payment config (publishable key, available methods) */
  config: publicProcedure.query(async () => {
    const { isStripeConfigured, getStripePublishableKey } = await import("../services/payments");
    return {
      stripeEnabled: isStripeConfigured(),
      publishableKey: getStripePublishableKey(),
      methods: [
        { id: "card", name: "Credit/Debit Card", enabled: isStripeConfigured(), icon: "credit-card" },
        { id: "snap", name: "Snap Finance", enabled: true, icon: "zap", applyUrl: "https://getsnap.snapfinance.com/lease/en-US/consumer/apply/landing" },
        { id: "acima", name: "Acima", enabled: true, icon: "shield", applyUrl: "https://acima.us/1TjEOYtr6C" },
        { id: "cash", name: "Pay at Shop", enabled: true, icon: "banknote" },
      ],
    };
  }),

  /**
   * Payment-infrastructure health for the admin Tire Orders tab.
   * Booleans only — never key material. Surfaces the half-configured
   * state (secret key set, webhook secret missing) where paid Stripe
   * events are DROPPED and only the return-page confirm saves the order.
   */
  health: adminProcedure.query(async () => {
    const { getStripeHealth } = await import("../services/payments");
    const { isSheetConfigured } = await import("../sheets-sync");
    return {
      stripe: getStripeHealth(),
      sheetsConfigured: isSheetConfigured(),
    };
  }),

  /** Look up an invoice for payment (public — requires phone for verification) */
  lookupInvoice: publicProcedure
    .input(z.object({
      invoiceNumber: z.string().min(1),
      phone: z.string().min(7),
    }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return null;

      const results = await d.select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        customerName: invoices.customerName,
        totalAmount: invoices.totalAmount,
        partsCost: invoices.partsCost,
        laborCost: invoices.laborCost,
        taxAmount: invoices.taxAmount,
        serviceDescription: invoices.serviceDescription,
        vehicleInfo: invoices.vehicleInfo,
        paymentStatus: invoices.paymentStatus,
        paymentMethod: invoices.paymentMethod,
        invoiceDate: invoices.invoiceDate,
      })
        .from(invoices)
        .where(and(
          eq(invoices.invoiceNumber, input.invoiceNumber),
          eq(invoices.customerPhone, input.phone),
        ))
        .limit(1);

      if (results.length === 0) return null;

      const inv = results[0];
      return {
        ...inv,
        totalAmount: inv.totalAmount / 100,
        partsCost: (inv.partsCost || 0) / 100,
        laborCost: (inv.laborCost || 0) / 100,
        taxAmount: (inv.taxAmount || 0) / 100,
        canPay: inv.paymentStatus === "pending" || inv.paymentStatus === "partial",
      };
    }),

  /** Create payment intent for an invoice */
  createPaymentIntent: publicProcedure
    .input(z.object({
      invoiceNumber: z.string().min(1),
      phone: z.string().min(7),
      email: z.string().email().optional(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { error: "Service unavailable" };

      // Verify invoice exists and is payable
      const [inv] = await d.select()
        .from(invoices)
        .where(and(
          eq(invoices.invoiceNumber, input.invoiceNumber),
          eq(invoices.customerPhone, input.phone),
        ))
        .limit(1);

      if (!inv) return { error: "Invoice not found" };
      if (inv.paymentStatus === "paid") return { error: "Invoice already paid" };

      const { createPaymentIntent } = await import("../services/payments");
      const result = await createPaymentIntent({
        amountCents: inv.totalAmount,
        invoiceNumber: inv.invoiceNumber!,
        customerName: inv.customerName,
        customerEmail: input.email,
        description: `Nick's Tire & Auto — ${inv.serviceDescription || inv.invoiceNumber}`,
      });

      return result;
    }),

  /** Mark invoice as paid (after successful Stripe payment) */
  confirmPayment: publicProcedure
    .input(z.object({
      invoiceNumber: z.string().min(1),
      phone: z.string().min(7),
      paymentIntentId: z.string().min(1),
      paymentMethod: z.enum(["card", "snap", "acima", "cash", "other"]).default("card"),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false, error: "Service unavailable" };

      // wave-122 — load the invoice FIRST to know the real amount we
      // expect Stripe to confirm. Fetch fields needed for the cross-
      // check rather than just the existence guard.
      const [inv] = await d.select({
        id: invoices.id,
        totalAmount: invoices.totalAmount,
        paymentStatus: invoices.paymentStatus,
      })
        .from(invoices)
        .where(and(
          eq(invoices.invoiceNumber, input.invoiceNumber),
          eq(invoices.customerPhone, input.phone),
        ))
        .limit(1);

      if (!inv) return { success: false, error: "Invoice not found" };
      if (inv.paymentStatus === "paid") return { success: false, error: "Invoice already paid" };

      // Verify payment with Stripe
      const { getPaymentStatus } = await import("../services/payments");
      const status = await getPaymentStatus(input.paymentIntentId);

      if (status.status !== "succeeded") {
        return { success: false, error: `Payment not confirmed: ${status.status}` };
      }

      // forensic-audit HIGH · bind the intent to THIS invoice. Without this
      // a customer/attacker could confirm invoice B using invoice A's
      // paymentIntentId when the two totals matched — marking B paid with
      // no money collected. createPaymentIntent stamps metadata.invoiceNumber,
      // so enforce it when present.
      if (status.invoiceNumber && status.invoiceNumber !== input.invoiceNumber) {
        log.warn("[payments.confirmPayment] intent/invoice mismatch — refusing to mark paid", {
          requestedInvoice: input.invoiceNumber,
          intentInvoice: status.invoiceNumber,
          paymentIntentId: input.paymentIntentId,
        });
        return { success: false, error: "Payment does not belong to this invoice" };
      }

      // wave-122 (CRITICAL S1/S5) — amount verification gate. Prior code
      // marked the invoice paid based ONLY on Stripe `succeeded` status
      // without checking that the captured amount matched the invoice
      // total. Defense-in-depth: if an attacker somehow obtains a
      // succeeded paymentIntentId for a different (lower) amount in
      // our Stripe account, this check refuses to apply it to the
      // invoice. 50 cent tolerance for Stripe's processing-fee rounding.
      const amountDelta = Math.abs(status.amountReceived - inv.totalAmount);
      if (amountDelta > 50) {
        log.warn("[payments.confirmPayment] amount mismatch — refusing to mark paid", {
          invoiceNumber: input.invoiceNumber,
          paymentIntentId: input.paymentIntentId,
          expected: inv.totalAmount,
          received: status.amountReceived,
        });
        return {
          success: false,
          error: `Payment amount mismatch (expected ${(inv.totalAmount / 100).toFixed(2)}, received ${(status.amountReceived / 100).toFixed(2)})`,
        };
      }

      // Map payment methods to DB enum
      const methodMap: Record<string, "cash" | "card" | "check" | "financing" | "other"> = {
        card: "card", snap: "financing", acima: "financing", cash: "cash", other: "other",
      };

      // forensic-audit HIGH · conditional claim (paymentStatus <> 'paid').
      // Previously an unconditional UPDATE that always emitted invoicePaid,
      // so it raced the payment_intent.succeeded webhook and double-fired
      // the fan-out (duplicate manager SMS/Telegram/journey). Only emit if
      // WE flipped the row from unpaid → paid.
      const [claim] = await d.execute(sql`
        UPDATE invoices
        SET paymentStatus = 'paid',
            paymentMethod = ${methodMap[input.paymentMethod] || "other"},
            updatedAt = NOW()
        WHERE invoiceNumber = ${input.invoiceNumber}
          AND customerPhone = ${input.phone}
          AND paymentStatus <> 'paid'
      `);
      const claimed = ((claim as unknown as { affectedRows?: number }).affectedRows ?? 0) > 0;

      // Unified event bus — only on the winning claim (webhook may also fire).
      if (claimed) {
        import("../services/eventBus").then(({ emit }) =>
          emit.invoicePaid({
            invoiceNumber: input.invoiceNumber,
            customerName: "Payment confirmed",
            totalAmount: status.amountReceived / 100,
            method: input.paymentMethod,
          })
        ).catch((e) => { log.warn("[routers/payments] fire-and-forget failed:", e); });
      }

      return { success: true };
    }),
});
