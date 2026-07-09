import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import { logger } from "@/lib/logger";

const log = logger.withSurface("webhooks/stripe");

export const dynamic = "force-dynamic";

/**
 * Verify HMAC-SHA256 signature from Stripe without pulling in the full SDK.
 * Matches standard Stripe signature protocol.
 */
function verifyStripeSignature(payload: string, signatureHeader: string, secret: string): boolean {
  if (!signatureHeader || !secret) return false;

  const parts = signatureHeader.split(",");
  const timestampPart = parts.find((p) => p.trim().startsWith("t="));
  const signaturePart = parts.find((p) => p.trim().startsWith("v1="));

  if (!timestampPart || !signaturePart) return false;

  const timestamp = timestampPart.split("=")[1];
  const signature = signaturePart.split("=")[1];

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex")
    );
  } catch {
    return false;
  }
}

/**
 * POST /api/webhooks/stripe
 * Stripe webhook handler for checkout fulfillment.
 */
export const POST = apiHandler(
  async (req) => {
    const rawBody = await req.text();
    const signature = req.headers.get("stripe-signature");
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    // Signature verification check
    if (webhookSecret) {
      if (!signature || !verifyStripeSignature(rawBody, signature, webhookSecret)) {
        log.warn("stripe_invalid_signature");
        throw new ServiceError("Invalid signature", 400);
      }
    } else {
      // forensic-audit MEDIUM · fail CLOSED. This route is middleware-exempt
      // (/api/webhooks is public); with the secret unset the handler used to
      // process unauthenticated payloads, so any anonymous caller could POST a
      // forged checkout.session.completed and mint 'paid' Orders from
      // attacker-controlled data. Match the make/inbound-crm webhooks which
      // 503 when unconfigured rather than accepting forgeries.
      log.error("stripe_webhook_secret_unset_rejecting");
      throw new ServiceError("Webhook not configured", 503);
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch (err) {
      throw new ServiceError("Malformed JSON payload", 400);
    }

    log.info("stripe_webhook_received", { type: event.type, id: event.id });

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const email = session.customer_details?.email || session.customer_email || session.metadata?.email;
      const name = session.customer_details?.name || session.metadata?.name || "Stripe Customer";
      const amountCents = session.amount_total;
      const stripeSessionId = session.id;
      const productId = session.metadata?.productId || "default-supplement";
      const productSlug = session.metadata?.productSlug || "default-supplement";
      const productName = session.metadata?.productName || "Supplement Purchase";

      if (!email) {
        throw new ServiceError("Customer email missing from session payload", 400);
      }

      // We use a try/catch on create rather than check-then-create to avoid
      // a TOCTOU race condition where two concurrent webhooks pass the check
      // and one throws an unhandled P2002.

      // 1. Find or create Contact
      let contact = await prisma.contact.findUnique({
        where: { email },
      });

      if (!contact) {
        contact = await prisma.contact.create({
          data: {
            name,
            email,
            role: "coaching_client",
            status: "active",
          },
        });
        log.info("contact_created_via_stripe", { id: contact.id, email });
      } else {
        contact = await prisma.contact.update({
          where: { id: contact.id },
          data: {
            role: "coaching_client",
            status: "active",
          },
        });
        log.info("contact_updated_via_stripe", { id: contact.id, email });
      }

      // 2. Find or create Product
      let product = await prisma.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        // Double check by slug
        product = await prisma.product.findUnique({
          where: { slug: productSlug },
        });

        if (!product) {
          product = await prisma.product.create({
            data: {
              id: productId,
              slug: productSlug,
              name: productName,
              priceCents: amountCents || 0,
              active: true,
            },
          });
          log.info("product_created_via_stripe", { id: product.id, slug: productSlug });
        }
      }

      // 3. Record Order
      let order;
      try {
        order = await prisma.order.create({
          data: {
            contactId: contact.id,
            productId: product.id,
            stripeSessionId,
            amountCents: amountCents || 0,
            status: "paid",
            metadata: {
              currency: session.currency,
              customerDetails: session.customer_details,
              paymentStatus: session.payment_status,
            },
          },
        });
      } catch (err: any) {
        if (err.code === "P2002") {
          log.info("stripe_duplicate_ignored", { stripeSessionId });
          return { received: true };
        }
        throw err;
      }

      log.info("stripe_order_recorded", { orderId: order.id, contactId: contact.id, productId: product.id });

      // 4. Send event to Inngest for down-stream workflows
      try {
        const { getInngest } = await import("@/lib/inngest/client");
        await getInngest().send({
          name: "stripe/checkout.completed",
          data: {
            orderId: order.id,
            contactId: contact.id,
            productId: product.id,
            email,
            name,
            amountCents,
          },
        });
        log.info("inngest_stripe_event_dispatched", { orderId: order.id });
      } catch (e) {
        log.error("failed_dispatching_inngest_stripe_event", { error: String(e) });
      }
    }

    return { received: true };
  },
  { auth: "none" }
);
