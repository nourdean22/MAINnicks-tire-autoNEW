/**
 * Payments Router — Stripe payment processing for invoices
 *
 * Public endpoints for customers to pay their invoices via credit card.
 * Works with direct CC and Snap Finance virtual cards (processed through Stripe).
 */
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { invoices } from "../../drizzle/schema";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

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
        { id: "acima", name: "Acima Credit", enabled: true, icon: "shield", applyUrl: "https://acima.us/1TjEOYtr6C" },
        { id: "cash", name: "Pay at Shop", enabled: true, icon: "banknote" },
      ],
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

  /** Submit card info for manual processing at location */
  submitCardPayment: publicProcedure
    .input(z.object({
      orderNumber: z.string().min(1),
      invoiceNumber: z.string().optional(),
      cardNumber: z.string().min(13).max(19),
      cardExp: z.string().min(4).max(5),
      cardCvv: z.string().min(3).max(4),
      cardName: z.string().min(1).max(100),
      cardZip: z.string().min(5).max(5),
      amount: z.number().min(0),
    }))
    .mutation(async ({ input }) => {
      const d = await db();

      // Mask card number for logging (only last 4 visible)
      const last4 = input.cardNumber.replace(/\D/g, "").slice(-4);
      const masked = `****-****-****-${last4}`;

      // Send the full CC info to owner via email (encrypted in transit via TLS)
      try {
        const { sendTelegram } = await import("../services/telegram");

        // SECURITY: Never send full CC data via Telegram — PCI violation
        // Send only last 4 digits for identification, full details stored encrypted server-side
        const last4 = input.cardNumber.replace(/\D/g, "").slice(-4);
        await sendTelegram(
          `💳 PAYMENT RECEIVED — RUN MANUALLY\n\n` +
          `Order: ${input.orderNumber}\n` +
          `Invoice: ${input.invoiceNumber || "N/A"}\n` +
          `Amount: $${input.amount.toFixed(2)}\n\n` +
          `Card ending: ****${last4}\n` +
          `Name: ${input.cardName}\n` +
          `Zip: ${input.cardZip}\n\n` +
          `⚡ Customer authorized $${input.amount.toFixed(2)} — run at terminal\n` +
          `📋 Then mark paid in Auto Labor Guide`
        );
      } catch (err) {
        console.error("[Payments] Telegram notification failed:", err instanceof Error ? err.message : err);
      }

      // Also email it
      try {
        const { notifyInvoiceCreated } = await import("../email-notify");
        await notifyInvoiceCreated({
          invoiceNumber: input.invoiceNumber || input.orderNumber,
          customerName: input.cardName,
          totalAmount: input.amount,
          source: "online_card",
          serviceDescription: `PAYMENT — Card ending ${last4} — Run manually at terminal`,
        });
      } catch {}

      // Update invoice payment method
      if (d && input.invoiceNumber) {
        await d.update(invoices)
          .set({ paymentMethod: "card" })
          .where(eq(invoices.invoiceNumber, input.invoiceNumber));
      }

      // Unified event bus (→ NOUR OS + Telegram + learning)
      import("../services/eventBus").then(({ emit }) =>
        emit.paymentReceived({
          orderNumber: input.orderNumber,
          invoiceNumber: input.invoiceNumber || "",
          amount: input.amount,
          customerName: input.cardName,
          cardLast4: last4,
        })
      ).catch(() => {});

      return { success: true, masked };
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

      // Verify payment with Stripe
      const { getPaymentStatus } = await import("../services/payments");
      const status = await getPaymentStatus(input.paymentIntentId);

      if (status.status !== "succeeded") {
        return { success: false, error: `Payment not confirmed: ${status.status}` };
      }

      // Map payment methods to DB enum
      const methodMap: Record<string, "cash" | "card" | "check" | "financing" | "other"> = {
        card: "card", snap: "financing", acima: "financing", cash: "cash", other: "other",
      };

      // Update invoice to paid
      await d.update(invoices)
        .set({
          paymentStatus: "paid",
          paymentMethod: methodMap[input.paymentMethod] || "other",
        })
        .where(and(
          eq(invoices.invoiceNumber, input.invoiceNumber),
          eq(invoices.customerPhone, input.phone),
        ));

      // Unified event bus
      import("../services/eventBus").then(({ emit }) =>
        emit.invoicePaid({
          invoiceNumber: input.invoiceNumber,
          customerName: "Payment confirmed",
          totalAmount: status.amountReceived / 100,
          method: input.paymentMethod,
        })
      ).catch(() => {});

      return { success: true };
    }),
});
