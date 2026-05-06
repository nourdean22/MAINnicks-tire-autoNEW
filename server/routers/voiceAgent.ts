/**
 * Voice Agent Router — Vapi tool endpoints
 *
 * The Vapi assistant calls these endpoints during a phone conversation
 * to do real work: check capacity, quote price ranges, book slots,
 * escalate to a human, send SMS confirmations.
 *
 * Per the design doc (docs/voice-ai-receptionist-design.md):
 *  - capacityCheck — query open windows for a target day
 *  - quoteRange    — price range for a service (NEVER an exact $)
 *  - bookSlot      — write a real booking row
 *  - escalate      — write to callback queue + ping Nick's cell
 *  - sendConfirmationSms — recap text after a successful call
 *
 * Security: all endpoints are publicProcedure but require a Vapi
 * webhook signature header (validated by middleware in production).
 * The risk surface is rate-limited junk submissions; same protections
 * already in place on bookingRouter.create are reused here.
 */

import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { SERVICES } from "../../shared/services";
import { BUSINESS } from "../../shared/business";
import { createLogger } from "../lib/logger";

const log = createLogger("voiceAgent");

// ─── Helpers ────────────────────────────────────────────

/**
 * Map a free-text service description from the AI to one of our
 * canonical service slugs. Vapi will say "brakes", "brake repair",
 * "the brakes are squealing" — all should map to /brakes service.
 */
function matchService(text: string): typeof SERVICES[number] | null {
  if (!text) return null;
  const t = text.toLowerCase();
  // Direct slug match first
  const slug = SERVICES.find((s) => t.includes(s.slug));
  if (slug) return slug;
  // Fall back to keyword match against service title + description
  const keywordMap: Array<[RegExp, string]> = [
    [/\bbrake|rotor|pad|squeal|grind/i, "brakes"],
    [/\btire|flat|patch|nail|tread/i, "tires"],
    [/\bcheck.engine|diag|code|obd|engine.light/i, "diagnostics"],
    [/\boil|lube|filter|synthetic/i, "oil-change"],
    [/\be.?check|emission|smog|state.test/i, "emissions"],
    [/\balign|pulling|drift|wheel/i, "alignment"],
    [/\bac\b|air.condition|cool.air/i, "ac-repair"],
    [/\btransmission|trans|shift|gear/i, "transmission"],
    [/\bbattery|dead|jump|start/i, "battery"],
    [/\belectric|wiring|alternator|starter/i, "electrical"],
    [/\bexhaust|muffler|catalytic|pipe/i, "exhaust"],
    [/\bcool|radiator|overheat|thermostat/i, "cooling"],
    [/\bsuspension|strut|shock|control.arm/i, "general-repair"],
  ];
  for (const [re, targetSlug] of keywordMap) {
    if (re.test(t)) {
      const match = SERVICES.find((s) => s.slug === targetSlug);
      if (match) return match;
    }
  }
  return null;
}

/**
 * Pull a $-range from the service's pricingTiers (the canonical
 * source of truth). Falls back to a vague "ranges from low to high"
 * line if the service has no tiers configured.
 */
function priceRangeForService(service: typeof SERVICES[number]): {
  low: number | null;
  high: number | null;
  sourceNote: string;
} {
  const tiers = service.pricingTiers ?? [];
  if (tiers.length === 0) {
    return {
      low: null,
      high: null,
      sourceNote: `${service.title} pricing depends on the vehicle. Free written estimate before any work.`,
    };
  }
  // Extract numbers from the `range` field (e.g. "$60-$120" → [60, 120])
  const allNumbers: number[] = [];
  for (const tier of tiers) {
    const matches = (tier.range || "").match(/\d+/g);
    if (matches) allNumbers.push(...matches.map(Number));
  }
  if (allNumbers.length === 0) {
    return {
      low: null,
      high: null,
      sourceNote: `${service.title} pricing depends on the vehicle. Free written estimate.`,
    };
  }
  return {
    low: Math.min(...allNumbers),
    high: Math.max(...allNumbers),
    sourceNote: `${service.title} typical range; final price depends on your vehicle and parts.`,
  };
}

// ─── Router ─────────────────────────────────────────────

export const voiceAgentRouter = router({
  /**
   * Returns shop capacity for a day so the AI knows what to offer.
   * For V1 we expose simple business-hours-based capacity. Real ALG
   * appointment data lives in another service; we'll wire that in V2.
   */
  capacityCheck: publicProcedure
    .input(z.object({ day: z.string().max(20).optional() }))
    .query(async ({ input }) => {
      // V1: assume open windows during business hours
      // Mon-Sat 8-18, Sun 9-16. Returns 3 next-available slots.
      const now = new Date();
      const requestedDay = input.day ? new Date(input.day) : now;
      const dayOfWeek = requestedDay.getDay(); // 0=Sun
      const isSunday = dayOfWeek === 0;

      const openHour = isSunday ? 9 : 8;
      const closeHour = isSunday ? 16 : 18;

      // Generate 3 candidate windows
      const windows = [
        { start: `${openHour}:00`, end: `${openHour + 2}:00`, label: "morning" },
        { start: "12:00", end: "14:00", label: "midday" },
        { start: `${closeHour - 3}:00`, end: `${closeHour - 1}:00`, label: "afternoon" },
      ];

      return {
        slotsRemainingToday: windows.length,
        estimatedWaitMinutes: 30,
        nextWindows: windows,
        message: `${requestedDay.toLocaleDateString("en-US", { weekday: "long", timeZone: BUSINESS.timezone })} — 3 windows open. Walk-ins welcome.`,
      };
    }),

  /**
   * Returns a price RANGE — never an exact number. The AI is
   * prompted to always say "ranges from $X to $Y" and never
   * commit. If the service is unknown, returns null + escalate hint.
   */
  quoteRange: publicProcedure
    .input(z.object({
      service: z.string().min(1).max(200),
      vehicleYear: z.number().int().optional(),
      vehicleMake: z.string().max(50).optional(),
    }))
    .query(async ({ input }) => {
      const matched = matchService(input.service);
      if (!matched) {
        return {
          low: null,
          high: null,
          sourceNote: "I'm not sure about that exact service — let me have someone call you back with a quote.",
          shouldEscalate: true,
        };
      }
      const range = priceRangeForService(matched);
      // Adjust slightly higher for high-end vehicles
      const isLuxury = (input.vehicleMake || "").toLowerCase().match(/bmw|mercedes|audi|lexus|porsche|tesla|land.rover/);
      let { low, high } = range;
      if (isLuxury && low && high) {
        low = Math.round(low * 1.2);
        high = Math.round(high * 1.4);
      }
      return {
        low,
        high,
        sourceNote: range.sourceNote + (isLuxury ? " European/luxury vehicles run a bit higher on parts." : ""),
        serviceTitle: matched.title,
        shouldEscalate: false,
      };
    }),

  /**
   * Books a slot. Reuses the booking infrastructure but tags
   * source: "voice-agent" so admin can filter Vapi-driven bookings.
   * Returns a reference code the AI reads back to the caller.
   */
  bookSlot: publicProcedure
    .input(z.object({
      name: z.string().min(2).max(200),
      phone: z.string().min(7).max(20),
      vehicle: z.string().max(200).optional(),
      service: z.string().max(200),
      preferredDay: z.string().max(20).optional(),
      callId: z.string().max(100).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { db } = await import("../lib/db-helper");
        const { bookings } = await import("../../drizzle/schema");
        const d = await db();
        if (!d) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        }
        const refCode = `VOICE-${Date.now().toString(36).toUpperCase()}`;
        await d.insert(bookings).values({
          name: input.name,
          phone: input.phone.replace(/\D/g, ""),
          email: null,
          service: input.service,
          vehicle: input.vehicle || null,
          // Tag provenance in message since bookings table has no source col.
          message: `[VOICE-AGENT]${input.callId ? ` callId=${input.callId}` : ""} — booked via Vapi AI receptionist`,
          urgency: "whenever",
          status: "new",
          preferredDate: input.preferredDay || null,
          preferredTime: "no-preference",
          referenceCode: refCode,
          utmSource: "voice-agent",
          utmMedium: "phone",
          utmCampaign: "vapi-receptionist",
        });
        log.info("Voice agent booked slot", { refCode, name: input.name, service: input.service });
        return {
          success: true,
          reference: refCode,
          windowStart: input.preferredDay || "next available",
          message: `Booked ${input.name} for ${input.service}. Reference: ${refCode}.`,
        };
      } catch (err) {
        log.error("Voice agent book failed", { err: err instanceof Error ? err.message : String(err) });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Booking failed",
        });
      }
    }),

  /**
   * Escalate — caller wants a human, AI is confused, or sentiment
   * went bad. Writes to callback_requests + alerts Nick via Telegram.
   */
  escalate: publicProcedure
    .input(z.object({
      name: z.string().min(2).max(200),
      phone: z.string().min(7).max(20),
      reason: z.string().max(500),
      urgency: z.enum(["low", "medium", "high"]).default("medium"),
      callId: z.string().max(100).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { db } = await import("../lib/db-helper");
        const { callbackRequests } = await import("../../drizzle/schema");
        const d = await db();
        if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        await d.insert(callbackRequests).values({
          name: input.name,
          phone: input.phone.replace(/\D/g, ""),
          context: `[VOICE-AGENT · ${input.urgency.toUpperCase()}]${input.callId ? ` callId=${input.callId}` : ""} — ${input.reason}`,
          status: "new",
          utmSource: "voice-agent",
          utmMedium: "phone",
          utmCampaign: "vapi-receptionist",
        });
        // Ping Nick via Telegram immediately on high-urgency
        if (input.urgency === "high") {
          try {
            const { sendTelegram } = await import("../services/telegram");
            await sendTelegram(
              `🚨 VOICE AGENT ESCALATION — HIGH URGENCY\n\n` +
              `${input.name} · ${input.phone}\n` +
              `Reason: ${input.reason}\n` +
              (input.callId ? `Call: ${input.callId}\n` : "") +
              `\nCall back ASAP.`,
            );
          } catch (e) {
            log.warn("Telegram escalation alert failed", { err: e instanceof Error ? e.message : String(e) });
          }
        }
        log.info("Voice agent escalated", { name: input.name, urgency: input.urgency });
        return {
          success: true,
          message: `Escalated to human callback queue. Nick will call ${input.name} back.`,
        };
      } catch (err) {
        log.error("Voice agent escalate failed", { err: err instanceof Error ? err.message : String(err) });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Escalation failed" });
      }
    }),

  /**
   * Send the recap SMS at end of call. Always called by the AI per
   * the conversation flow — AI says "I'll text you the address right
   * now" and this fires.
   */
  sendConfirmationSms: publicProcedure
    .input(z.object({
      phone: z.string().min(7).max(20),
      summary: z.string().min(2).max(500),
      mapLink: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { sendSms } = await import("../sms");
        const body = `${input.summary}\n\n📍 17625 Euclid Ave, Cleveland\n📞 (216) 862-0005\n${input.mapLink || "https://nickstire.org/contact"}`;
        const result = await sendSms(input.phone, body);
        log.info("Voice agent SMS sent", { phone: input.phone.slice(-4), success: result.success });
        return { sent: result.success, sid: result.sid, error: result.error };
      } catch (err) {
        log.error("Voice agent SMS failed", { err: err instanceof Error ? err.message : String(err) });
        return { sent: false, error: err instanceof Error ? err.message : "SMS send failed" };
      }
    }),

  /**
   * Hours + address + general FAQ — read-only, fast lookup.
   * AI calls this for "what time do you close?" / "where are you?".
   */
  shopInfo: publicProcedure.query(() => {
    return {
      name: BUSINESS.name,
      phone: BUSINESS.phone.display,
      address: `${BUSINESS.address.street}, ${BUSINESS.address.city}, ${BUSINESS.address.state} ${BUSINESS.address.zip}`,
      hours: {
        monday: "8:00 AM - 6:00 PM",
        tuesday: "8:00 AM - 6:00 PM",
        wednesday: "8:00 AM - 6:00 PM",
        thursday: "8:00 AM - 6:00 PM",
        friday: "8:00 AM - 6:00 PM",
        saturday: "8:00 AM - 6:00 PM",
        sunday: "9:00 AM - 4:00 PM",
      },
      walkInsWelcome: true,
      financingAvailable: true,
      financingProviders: ["Acima", "Snap Finance", "Koalafi", "American First"],
      emergencyAfterHours: "Leave a voicemail or text — Nick checks after-hours messages.",
      languagesSpoken: ["English"],
    };
  }),
});
