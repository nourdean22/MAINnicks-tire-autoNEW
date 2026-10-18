/**
 * tireQuote · "Text me this quote" on the /tires top-pick cards (2026-10-18).
 *
 * A quote is the same record "Request these" writes, a tire_orders row (status received, no
 * invoice, no booking), so it shows in the admin Tire Orders tab as a new request the shop calls
 * back on. One customer text goes out through customerMessageTemplates (quoteTexted), which
 * carries the dry-run flag, the send-pause switch, the per-order idempotency and the audit row;
 * sendSms underneath applies the opt-out and internal-line refusals. An uncertain gateway answer
 * is reported as uncertain and never retried. Staff get a Telegram with the phone's last four.
 *
 * The row's number is TQ-..., the persisted mark that keeps a quote out of checkout, the Kafene
 * lease lookups, placeOrder's dedupe and every order / revenue count (lib/tire-order-guards.ts).
 *
 * Rate limit: blockBatchedLimits + formLimiter in _core/index.ts (10 per hour per IP), plus a
 * five-minute dedupe on phone + tire + qty so a double tap never sends twice: an in-memory claim
 * taken before the first await (two concurrent requests on one replica) and a DB check (a retry
 * after a redeploy).
 */
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { publicProcedure, router } from "../_core/trpc";
import { db } from "../lib/db-helper";
import { tireOrders } from "../../drizzle/schema";
import { evaluateOrderPrice, generateQuoteNumber, getIdempotencyKey, isDuplicateKeyError } from "../lib/tire-order-guards";
import { createLogger } from "../lib/logger";

const log = createLogger("routers:tireQuote");

const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const MAX_CLAIMS = 5_000;
const PICK_LABEL = { lowest: "Lowest price", value: "Best value", premium: "Premium" } as const;

type QuoteResult =
  | { ok: true; orderNumber: string; sms: QuoteSmsState }
  | { ok: false; reason: "price" | "upstream_error" };

/** phone|brand|model|size|qty -> the request that owns this quote for five minutes (one replica). */
const claims = new Map<string, { at: number; result: Promise<QuoteResult> }>();

/** Tests share one module instance; the claim map must not carry a quote from one test into the next. */
export function _resetQuoteClaimsForTest(): void { claims.clear(); }

function pruneClaims(now: number) {
  for (const [k, v] of claims) if (now - v.at > DEDUPE_WINDOW_MS) claims.delete(k);
  while (claims.size > MAX_CLAIMS) claims.delete(claims.keys().next().value as string);
}

/** "(216) 555-0123" / "+1 216 555 0123" -> "2165550123"; anything else is rejected. */
const usPhone = z.string().trim().transform((v, ctx) => {
  const digits = v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (!/^\d{10}$/.test(digits)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a 10-digit US mobile number" });
    return z.NEVER;
  }
  return digits;
});

const lastFour = (phone: string) => phone.slice(-4);

/** Echoed into the customer's text, so markup and links are refused outright. */
const plainText = (max: number) => z.string().trim().min(1).max(max).refine((v) => !/[<>]|https?:|www\./i.test(v), "plain text only");

type QuoteSmsState = "sent" | "queued" | "uncertain" | "not_sent" | "duplicate";

type QuoteInput = {
  phone: string; tireBrand: string; tireModel: string; tireSize: string; quantity: number; pricePerTireCents: number;
  pick: keyof typeof PICK_LABEL; vehicle?: { year: number; make: string; model: string; trim?: string };
  utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null;
  landingPage?: string | null; referrer?: string | null; sessionId?: string | null;
};

export const tireQuoteRouter = router({
  text: publicProcedure
    .input(z.object({
      phone: usPhone,
      tireBrand: plainText(100),
      tireModel: plainText(255),
      tireSize: z.string().trim().min(3).max(50).regex(/^[0-9A-Za-z/.-]+$/, "a tire size like 215/60R16"),
      quantity: z.number().int().min(1).max(20),
      pricePerTireCents: z.number().int().min(0),
      pick: z.enum(["lowest", "value", "premium"]),
      vehicle: z.object({
        year: z.number().int().min(1900).max(2100),
        make: plainText(60),
        model: plainText(60),
        trim: plainText(60).optional(),
      }).optional(),
      utmSource: z.string().max(100).nullish(),
      utmMedium: z.string().max(100).nullish(),
      utmCampaign: z.string().max(255).nullish(),
      landingPage: z.string().max(500).nullish(),
      referrer: z.string().max(500).nullish(),
      sessionId: z.string().max(64).nullish(),
    }))
    .mutation(async ({ input }): Promise<QuoteResult> => {
      // shortcut: the $50 absolute floor only (placeOrder also re-derives the price from the
      // supplier feed). The quoted figure can never be charged: createCheckout and the Kafene
      // lookups refuse a TQ- number. Upgrade to re-derivation if a quote is ever shown as final.
      if (!evaluateOrderPrice(input.pricePerTireCents, null).ok) return { ok: false, reason: "price" };

      // Claim the quote identity BEFORE the first await: a second request for the same quote
      // waits for the first and reports it as the duplicate, so a race sends one text.
      const key = getIdempotencyKey({ customerPhone: input.phone, tireBrand: input.tireBrand, tireModel: input.tireModel, tireSize: input.tireSize, quantity: input.quantity });
      const now = Date.now();
      pruneClaims(now);
      const held = claims.get(key);
      if (held) {
        const first = await held.result;
        return first.ok ? { ...first, sms: "duplicate" } : first;
      }
      const result = storeAndText(input);
      claims.set(key, { at: now, result });
      const settled = await result;
      if (!settled.ok) claims.delete(key); // a failed attempt must not block the retry
      return settled;
    }),
});

async function storeAndText(input: QuoteInput): Promise<QuoteResult> {
      const d = await db();
      if (!d) return { ok: false, reason: "upstream_error" };

      const totalAmount = input.pricePerTireCents * input.quantity;
      const vehicleInfo = input.vehicle
        ? [input.vehicle.year, input.vehicle.make, input.vehicle.model, input.vehicle.trim].filter(Boolean).join(" ")
        : null;

      // A double tap or a refresh inside five minutes is the same quote: no second row, no second text.
      try {
        const [recent] = await d.select({ orderNumber: tireOrders.orderNumber })
          .from(tireOrders)
          .where(and(
            eq(tireOrders.customerPhone, input.phone),
            eq(tireOrders.tireBrand, input.tireBrand),
            eq(tireOrders.tireModel, input.tireModel),
            eq(tireOrders.tireSize, input.tireSize),
            eq(tireOrders.quantity, input.quantity),
            sql`${tireOrders.createdAt} >= ${new Date(Date.now() - DEDUPE_WINDOW_MS)}`,
            sql`${tireOrders.status} <> 'cancelled'`,
          ))
          .orderBy(desc(tireOrders.createdAt))
          .limit(1);
        if (recent) return { ok: true, orderNumber: recent.orderNumber, sms: "duplicate" };
      } catch (e) {
        log.warn("quote dedupe check failed, continuing", { error: e instanceof Error ? e.message : String(e) });
      }

      // TQ-YYYYMMDD-NNN collides on a busy day: regenerate, like placeOrder.
      let orderNumber = generateQuoteNumber();
      try {
        for (let attempt = 1; ; attempt++) {
          try {
            await d.insert(tireOrders).values({
              orderNumber,
              customerName: "Quote by text",
              customerPhone: input.phone,
              customerEmail: null,
              vehicleInfo,
              tireBrand: input.tireBrand,
              tireModel: input.tireModel,
              tireSize: input.tireSize,
              quantity: input.quantity,
              pricePerTire: input.pricePerTireCents,
              serviceFeePerTire: 0,
              totalAmount,
              status: "received",
              customerNotes: `Quote by text from /tires (${PICK_LABEL[input.pick]} pick). Not an order yet: call to confirm fitment and book.`,
              utmSource: input.utmSource || null,
              utmMedium: input.utmMedium || null,
              utmCampaign: input.utmCampaign || null,
              landingPage: input.landingPage || null,
              referrer: input.referrer || null,
              sessionId: input.sessionId || null,
            });
            break;
          } catch (err) {
            if (isDuplicateKeyError(err) && attempt < 3) {
              orderNumber = generateQuoteNumber();
              continue;
            }
            throw err;
          }
        }
      } catch (err) {
        log.error("quote row insert failed", { error: err instanceof Error ? err.message : String(err) });
        return { ok: false, reason: "upstream_error" };
      }

      // Awaited, not fire-and-forget: the customer is told whether the text went out.
      let sms: QuoteSmsState = "not_sent";
      try {
        const { sendCustomerMessage } = await import("../services/customerMessageTemplates");
        const { smsOutcome } = await sendCustomerMessage(orderNumber, "quoteTexted");
        sms = smsOutcome === "sent" || smsOutcome === "queued" || smsOutcome === "uncertain" ? smsOutcome : "not_sent";
      } catch (e) {
        log.error(`quote text for ${orderNumber} failed`, { error: e instanceof Error ? e.message : String(e) });
      }

      // "incident": a customer is waiting for a call. A "receipt" is held unless telegram_receipt is on.
      try {
        const { sendTelegram } = await import("../services/telegram");
        await sendTelegram(
          `Tire quote texted (${PICK_LABEL[input.pick]}) · ${orderNumber}\n` +
          `${input.quantity}x ${input.tireBrand} ${input.tireModel} (${input.tireSize}) · $${(totalAmount / 100).toFixed(2)} installed` +
          (vehicleInfo ? ` · ${vehicleInfo}` : "") + "\n" +
          `Phone ending ${lastFour(input.phone)} · text ${sms === "not_sent" ? "NOT sent (refused or off): call them" : sms}\n` +
          `Admin > Tire Orders > New Requests`,
          "incident",
        );
      } catch (e) {
        log.warn("quote telegram failed", { error: e instanceof Error ? e.message : String(e) });
      }

      return { ok: true, orderNumber, sms };
}
