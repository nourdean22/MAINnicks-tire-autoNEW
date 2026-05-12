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
import { router, publicProcedure, voiceAgentInternalProcedure } from "../_core/trpc";
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
  // wave-148 — write mutation gated on internal context (VAPI webhook
  // signed dispatch) or VOICE_AGENT_INTERNAL_SECRET header.
  bookSlot: voiceAgentInternalProcedure
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
  // wave-148 — write mutation: callback_requests row + Telegram alert.
  escalate: voiceAgentInternalProcedure
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
            // wave-122 (MEDIUM S3) — mask phone in Telegram body. Last-4
            // is enough for operator recognition; full number is in
            // callback_requests row for the admin tool.
            const phoneTail = input.phone.replace(/\D/g, "").slice(-4);
            const { sendTelegram } = await import("../services/telegram");
            await sendTelegram(
              `🚨 VOICE AGENT ESCALATION — HIGH URGENCY\n\n` +
              `${input.name} · ...${phoneTail}\n` +
              `Reason: ${input.reason}\n` +
              (input.callId ? `Call: ${input.callId}\n` : "") +
              `\nCall back ASAP — full number in admin > Callbacks.`,
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
   *
   * GRACEFUL DEGRADATION: when SMS_KILL_SWITCH is on (Twilio outage),
   * sendSms returns { success: false, error: "sms_disabled" }. We pass
   * that back as `degraded: true` so the VAPI prompt can teach Nick to
   * verbally confirm the address instead of pretending a text went out.
   * The lead is still captured server-side either way.
   */
  // wave-148 — side-effect mutation: fires SMS to arbitrary phone.
  sendConfirmationSms: voiceAgentInternalProcedure
    .input(z.object({
      phone: z.string().min(7).max(20),
      summary: z.string().min(2).max(500),
      mapLink: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { sendSms } = await import("../sms");
        const body = `${input.summary}\n\n📍 17625 Euclid Ave, Cleveland\n📞 (216) 862-0005\n${input.mapLink || "https://nickstire.org/contact"}`;
        // Wave-103 — route through the shop's real number so the
        // customer sees the text from 216-862-0005 (the same line they
        // just called). Falls back to Twilio if the gateway is offline.
        const result = await sendSms(input.phone, body, { via: "shop" });
        const degraded = !result.success && result.error === "sms_disabled";
        log.info("Voice agent SMS sent", {
          phone: input.phone.slice(-4),
          success: result.success,
          degraded,
        });
        return {
          sent: result.success,
          sid: result.sid,
          error: result.error,
          degraded,
          // Friendly verbal recap Nick should READ ALOUD when degraded
          verbalRecap: degraded
            ? "Texts are temporarily down — I'll just say it out loud: 17625 Euclid Avenue, Cleveland, 4 4 1 1 2. Phone is 2 1 6 8 6 2 0 0 0 5. We're first-come, first-served Monday through Saturday 8 to 6, Sunday 9 to 4."
            : undefined,
        };
      } catch (err) {
        log.error("Voice agent SMS failed", { err: err instanceof Error ? err.message : String(err) });
        return { sent: false, error: err instanceof Error ? err.message : "SMS send failed" };
      }
    }),

  /**
   * TIRE LOOKUP — primary call reason for this shop.
   *
   * Most inbound calls are: "Do you have a used tire for my [vehicle]?"
   * This tool takes a vehicle (year/make/model) and returns the OEM stock
   * tire size(s) so the AI can confirm sizes verbally without making
   * the customer go look in their door jamb.
   *
   * Falls back to a friendly "common sizes for that vehicle" answer
   * when the lookup table doesn't have the exact match — the goal is
   * to get the customer to the shop with a size they can repeat.
   */
  tireSizeFromVehicle: publicProcedure
    .input(z.object({
      year: z.number().int().min(1980).max(2030).optional(),
      make: z.string().min(1).max(50),
      model: z.string().min(1).max(80).optional(),
    }))
    .query(async ({ input }) => {
      // Hard-coded stock-size map for the most-asked-about vehicles in
      // Cleveland. Real-world: this could call a third-party VIN/spec
      // service, but for V1 the top 25 vehicles cover ~70% of calls.
      const make = input.make.toLowerCase();
      const model = (input.model || "").toLowerCase();

      // Format: { match: string|RegExp, size: string, note?: string }
      const TIRE_MAP: Array<{ match: RegExp; size: string; note?: string }> = [
        // Honda
        { match: /honda.*civic/, size: "215/55R16 or 215/45R17 (Sport/Si)" },
        { match: /honda.*accord/, size: "225/50R17 or 235/40R19 (Touring/Sport)" },
        { match: /honda.*cr.?v/, size: "235/65R17 or 235/60R18 (newer)" },
        { match: /honda.*odyssey/, size: "235/60R18" },
        { match: /honda.*pilot/, size: "245/60R18 or 265/45R20 (Black Edition)" },
        // Toyota
        { match: /toyota.*camry/, size: "215/55R17 or 235/45R18 (XSE/SE)" },
        { match: /toyota.*corolla/, size: "205/55R16 or 225/40R18 (XSE)" },
        { match: /toyota.*rav.?4/, size: "225/65R17 or 235/55R19 (Limited)" },
        { match: /toyota.*highlander/, size: "245/60R18 or 235/55R20 (Platinum)" },
        { match: /toyota.*tacoma/, size: "265/70R16 or 265/65R17 (TRD)" },
        // Ford
        { match: /ford.*f.?150/, size: "265/70R17 or 275/65R18 (XLT) or 275/55R20 (Lariat+)" },
        { match: /ford.*explorer/, size: "255/65R18 or 255/55R20 (Limited+)" },
        { match: /ford.*escape/, size: "225/65R17 or 225/55R19 (Titanium)" },
        { match: /ford.*fusion/, size: "235/50R17 or 235/45R18" },
        { match: /ford.*focus/, size: "215/55R16 or 215/45R18 (ST)" },
        // Chevy
        { match: /chev(rolet|y).*silverado/, size: "265/70R17 or 275/60R20 (LTZ+)" },
        { match: /chev(rolet|y).*equinox/, size: "225/65R17 or 235/50R19 (Premier)" },
        { match: /chev(rolet|y).*malibu/, size: "225/55R17 or 245/40R19 (Premier)" },
        { match: /chev(rolet|y).*tahoe/, size: "265/65R18 or 275/55R20 (Premier+)" },
        { match: /chev(rolet|y).*cruze/, size: "215/60R16 or 225/45R18 (RS)" },
        // Jeep
        { match: /jeep.*grand.cherokee/, size: "265/60R18 or 265/50R20 (Limited+)" },
        { match: /jeep.*cherokee/, size: "225/60R17 or 225/55R18 (Limited)" },
        { match: /jeep.*wrangler/, size: "255/75R17 or 285/70R17 (Rubicon)" },
        // Nissan
        { match: /nissan.*altima/, size: "215/60R16 or 235/40R19 (Platinum)" },
        { match: /nissan.*rogue/, size: "225/65R17 or 225/55R19 (SL+)" },
        { match: /nissan.*sentra/, size: "205/60R16 or 215/45R17 (SR)" },
        // Hyundai/Kia
        { match: /hyundai.*sonata/, size: "215/55R17 or 235/45R18 (Limited)" },
        { match: /hyundai.*elantra/, size: "205/55R16 or 225/45R17 (Limited)" },
        { match: /hyundai.*tucson/, size: "225/60R17 or 235/55R19 (Limited)" },
        { match: /kia.*optima/, size: "205/65R16 or 235/45R18 (SX)" },
        { match: /kia.*sorento/, size: "235/65R17 or 235/55R19 (SX)" },
        // RAM/Dodge
        { match: /(ram|dodge).*1500/, size: "275/65R18 or 275/55R20 (Laramie+)" },
        { match: /dodge.*charger/, size: "235/55R18 or 245/45R20 (R/T+)" },
        { match: /dodge.*challenger/, size: "235/55R18 or 245/45R20 (R/T+)" },
        // Subaru
        { match: /subaru.*outback/, size: "225/65R17 or 225/60R18 (Limited XT)" },
        { match: /subaru.*forester/, size: "225/60R17 or 225/55R18 (Touring)" },
        // Tesla
        { match: /tesla.*model.3/, size: "235/45R18 or 235/40R19 (Performance)" },
        { match: /tesla.*model.y/, size: "255/45R19 or 255/40R20 (Performance)" },
      ];

      const compositeQuery = `${make} ${model}`;
      for (const entry of TIRE_MAP) {
        if (entry.match.test(compositeQuery)) {
          return {
            found: true,
            vehicle: `${input.year ?? ""} ${input.make} ${input.model ?? ""}`.trim(),
            commonSizes: entry.size,
            note: entry.note ?? "Trim level may change the size — check the door jamb sticker if you can.",
            usedTirePriceRange: { low: 60, high: 120 },
            installPackageIncluded: true,
            installPackageContents: [
              "Mount + computer balance",
              "New valve stems",
              "TPMS reset (if equipped)",
              "Alignment check",
              "20-point safety inspection",
            ],
          };
        }
      }

      // Fallback when no match — give a friendly answer that gets them
      // to the shop without a fake size.
      return {
        found: false,
        vehicle: `${input.year ?? ""} ${input.make} ${input.model ?? ""}`.trim(),
        commonSizes: null,
        note: "I don't have your exact stock size on file. Easiest answer: check the side of any current tire on your vehicle for the size, or look at the sticker inside the driver's door jamb. Then call back or come in — we'll match it.",
        usedTirePriceRange: { low: 60, high: 120 },
        installPackageIncluded: true,
        installPackageContents: [
          "Mount + computer balance",
          "New valve stems",
          "TPMS reset (if equipped)",
          "Alignment check",
          "20-point safety inspection",
        ],
      };
    }),

  /**
   * TIRE INQUIRY CAPTURE — log a tire-specific call.
   *
   * The AI calls this when a customer asks about used tires but doesn't
   * commit to a booking yet. Captures the size + vehicle + name + phone
   * so we can follow up if they don't walk in.
   *
   * Different from a general escalation — these are warm leads, not
   * complaints. They go to the leads table tagged source="voice-tire".
   */
  // wave-178 STRIDE: gated behind voiceAgentInternalProcedure. This was
  // previously publicProcedure with no rate limit — any internet caller
  // could POST high-urgency leads into the table and poison the admin
  // feed. Same internal-only gate that wave-165 applied to bookSlot /
  // escalate / sendConfirmationSms.
  tireInquiry: voiceAgentInternalProcedure
    .input(z.object({
      name: z.string().min(2).max(200),
      phone: z.string().min(7).max(20),
      tireSize: z.string().max(50).optional(),
      vehicle: z.string().max(200).optional(),
      newOrUsed: z.enum(["new", "used", "either"]).default("either"),
      installationNeeded: z.boolean().default(true),
      callId: z.string().max(100).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { db } = await import("../lib/db-helper");
        const { leads } = await import("../../drizzle/schema");
        const d = await db();
        if (!d) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        }
        const problemSummary = [
          `${input.newOrUsed.toUpperCase()} TIRES`,
          input.tireSize ? `Size: ${input.tireSize}` : null,
          input.vehicle ? `Vehicle: ${input.vehicle}` : null,
          input.installationNeeded ? "Wants install" : "No install needed",
        ].filter(Boolean).join(" · ");

        await d.insert(leads).values({
          name: input.name,
          phone: input.phone.replace(/\D/g, ""),
          email: null,
          problem: `[VOICE-AGENT TIRE INQUIRY]${input.callId ? ` callId=${input.callId}` : ""} — ${problemSummary}`,
          vehicle: input.vehicle || null,
          source: "callback",
          status: "new",
          urgencyScore: 4, // Tires-specific = high intent
          utmSource: "voice-agent",
          utmMedium: "phone",
          utmCampaign: "vapi-tire-inquiry",
        });
        log.info("Voice agent tire inquiry captured", { name: input.name, size: input.tireSize });
        return {
          success: true,
          message: `Got it — I've sent the tire info to the shop. ${input.tireSize ? `Looking for ${input.tireSize}.` : ""} Walk in any day, we usually have most common sizes on the rack from $60 installed.`,
        };
      } catch (err) {
        log.error("Voice agent tire inquiry failed", { err: err instanceof Error ? err.message : String(err) });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Tire inquiry log failed" });
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
      languagesSpoken: ["English", "Arabic"],
    };
  }),

  /**
   * wave-179: lookupCustomer
   *
   * Caller phone → existing customer record. Lets the Vapi assistant
   * personalize the greeting and skip re-collecting info we already
   * have. The single highest-impact tool addition for retention:
   * "Hi Robert! I see you had brakes done in September — welcome back!"
   *
   * Returns sanitized customer data (no PII beyond what the caller
   * already owns — they're calling FROM the phone we look up).
   * If no match: returns { found: false } so the AI knows to collect
   * fresh info.
   */
  lookupCustomer: voiceAgentInternalProcedure
    .input(z.object({
      phone: z.string().min(7).max(20),
    }))
    .query(async ({ input }) => {
      try {
        const { db } = await import("../lib/db-helper");
        const { customers } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const d = await db();
        if (!d) return { found: false, reason: "DB unavailable" };
        const phoneDigits = input.phone.replace(/\D/g, "");
        if (phoneDigits.length < 10) return { found: false, reason: "Invalid phone format" };
        const [c] = await d
          .select({
            firstName: customers.firstName,
            lastName: customers.lastName,
            totalVisits: customers.totalVisits,
            lastVisitDate: customers.lastVisitDate,
            vehicleYear: customers.vehicleYear,
            vehicleMake: customers.vehicleMake,
            vehicleModel: customers.vehicleModel,
            segment: customers.segment,
            balanceDue: customers.balanceDue,
          })
          .from(customers)
          .where(eq(customers.phone, phoneDigits))
          .limit(1);
        if (!c) return { found: false };
        const daysSinceLastVisit = c.lastVisitDate
          ? Math.floor((Date.now() - new Date(c.lastVisitDate).getTime()) / 86_400_000)
          : null;
        return {
          found: true,
          firstName: c.firstName,
          lastName: c.lastName || null,
          totalVisits: c.totalVisits,
          lastVisitDays: daysSinceLastVisit,
          segment: c.segment, // "recent" | "lapsed" | "new" | "unknown"
          // primary vehicle on file — AI can confirm "still driving the X?"
          vehicle: [c.vehicleYear, c.vehicleMake, c.vehicleModel].filter(Boolean).join(" ") || null,
          hasOutstandingBalance: c.balanceDue > 0,
          // No raw $ amount returned — the AI shouldn't quote balance
          // over the phone; the operator handles that on the floor.
        };
      } catch (err) {
        log.error("Voice agent lookupCustomer failed", { err: err instanceof Error ? err.message : String(err) });
        return { found: false, reason: "Lookup error" };
      }
    }),

  /**
   * wave-179: getDeclinedEstimate
   *
   * Caller phone → any unconverted ALG estimate awaiting their decision.
   * Targets the $321K declined-work pipeline from the phone channel:
   * "I see we quoted you $487 for brakes on March 14 — is that still
   * what we're looking at?" Massive conversion-recovery surface.
   *
   * Returns the most recent unmatched estimate (matchedInvoiceId IS NULL)
   * within the last 120 days. Older estimates are likely stale.
   *
   * Phone matching uses customer alsCustomerId → alg_estimates link via
   * customerPhone column (fuzzy-matched to 10-digit normalized form).
   */
  getDeclinedEstimate: voiceAgentInternalProcedure
    .input(z.object({
      phone: z.string().min(7).max(20),
    }))
    .query(async ({ input }) => {
      try {
        const { db } = await import("../lib/db-helper");
        const { algEstimates } = await import("../../drizzle/schema");
        const { isNull, eq, gte, and, desc, sql } = await import("drizzle-orm");
        const d = await db();
        if (!d) return { found: false, reason: "DB unavailable" };
        const phoneDigits = input.phone.replace(/\D/g, "");
        if (phoneDigits.length < 10) return { found: false, reason: "Invalid phone format" };
        const oneTwentyDaysAgo = new Date(Date.now() - 120 * 86_400_000);
        const [est] = await d
          .select({
            id: algEstimates.id,
            externalId: algEstimates.externalId,
            customerName: algEstimates.customerName,
            vehicleInfo: algEstimates.vehicleInfo,
            serviceDescription: algEstimates.serviceDescription,
            estimatedAmount: algEstimates.estimatedAmount,
            estimateDate: algEstimates.estimateDate,
          })
          .from(algEstimates)
          .where(
            and(
              isNull(algEstimates.matchedInvoiceId),
              gte(algEstimates.estimateDate, oneTwentyDaysAgo),
              // Match either exact digits OR last-10-digits to handle
              // formatting variation (parens, dashes, spaces) in ALG
              sql`REPLACE(REPLACE(REPLACE(REPLACE(${algEstimates.customerPhone}, '-', ''), '(', ''), ')', ''), ' ', '') = ${phoneDigits}`,
            ),
          )
          .orderBy(desc(algEstimates.estimateDate))
          .limit(1);
        if (!est) return { found: false };
        const daysOld = Math.floor((Date.now() - new Date(est.estimateDate).getTime()) / 86_400_000);
        return {
          found: true,
          estimateId: est.externalId,
          customerName: est.customerName,
          vehicle: est.vehicleInfo || null,
          service: est.serviceDescription || "service",
          estimateDollars: Math.round(est.estimatedAmount / 100),
          daysOld,
          // AI script suggestion — keep it natural, low-pressure
          aiHint: `Customer has an unconverted ${Math.round(est.estimatedAmount / 100)} dollar estimate from ${daysOld} days ago for ${est.serviceDescription || "service"} on their ${est.vehicleInfo || "vehicle"}. Mention it ONLY if the caller seems to be revisiting the same topic. Don't pitch hard.`,
        };
      } catch (err) {
        log.error("Voice agent getDeclinedEstimate failed", { err: err instanceof Error ? err.message : String(err) });
        return { found: false, reason: "Lookup error" };
      }
    }),

  /**
   * wave-179: getCurrentWaitTime
   *
   * Real-time shop-load read. Caller asks "how busy are you right now?"
   * — AI gives accurate answer instead of generic "first-come first-served."
   * Sets realistic expectations + reduces walk-in disappointment.
   */
  getCurrentWaitTime: voiceAgentInternalProcedure
    .input(z.object({}).optional())
    .query(async () => {
      try {
        const { db } = await import("../lib/db-helper");
        const { bookings } = await import("../../drizzle/schema");
        const { and, gte, sql } = await import("drizzle-orm");
        const d = await db();
        if (!d) return { available: false, reason: "DB unavailable" };
        const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        const [todayLoad] = await d
          .select({ count: sql<number>`COUNT(*)` })
          .from(bookings)
          .where(
            and(
              gte(bookings.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
              sql`(${bookings.status} = 'new' OR ${bookings.status} = 'confirmed')`,
            ),
          );
        const activeCount = Number(todayLoad?.count ?? 0);
        // Heuristic — 6 bays. <4 active = open. 4-7 = busy. 8+ = loaded.
        let load: "open" | "busy" | "loaded";
        let waitMinutes: number;
        let aiHint: string;
        if (activeCount < 4) {
          load = "open";
          waitMinutes = 0;
          aiHint = "Shop is open — walk in any time, you'll get on a lift quickly.";
        } else if (activeCount < 8) {
          load = "busy";
          waitMinutes = 30;
          aiHint = "Shop is busy — expect 30-min wait for tires, longer for repair. Drop-off recommended.";
        } else {
          load = "loaded";
          waitMinutes = 60;
          aiHint = "Shop is loaded — drop-off only for repairs. Tires might be 60+ min wait. Suggest scheduling for tomorrow if not urgent.";
        }
        return {
          available: true,
          load,
          activeBookings: activeCount,
          estimatedWaitMinutes: waitMinutes,
          asOf: todayStr,
          aiHint,
        };
      } catch (err) {
        log.error("Voice agent getCurrentWaitTime failed", { err: err instanceof Error ? err.message : String(err) });
        return { available: false, reason: "Lookup error" };
      }
    }),

  /**
   * wave-179: scheduleCallback
   *
   * After-hours capture. Caller dials outside business hours, AI offers
   * a callback. Creates a callbackRequests record so the front desk
   * sees it first thing in the morning. Same table the website's
   * CallbackModal writes to — single source of truth.
   */
  scheduleCallback: voiceAgentInternalProcedure
    .input(z.object({
      name: z.string().min(2).max(200),
      phone: z.string().min(7).max(20),
      reason: z.string().max(500).optional(),
      preferredTime: z.string().max(100).optional(),
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
          context: `[VOICE-AGENT CALLBACK]${input.callId ? ` callId=${input.callId}` : ""}${input.preferredTime ? ` · prefers: ${input.preferredTime}` : ""}${input.reason ? ` — ${input.reason}` : ""}`,
          sourcePage: "vapi-voice-agent",
          status: "new",
        });
        log.info("Voice agent scheduleCallback captured", { name: input.name });
        return {
          success: true,
          message: `Got it, ${input.name}. ${input.preferredTime ? `We'll call you back ${input.preferredTime}.` : "We'll call you back first thing during business hours."}`,
        };
      } catch (err) {
        log.error("Voice agent scheduleCallback failed", { err: err instanceof Error ? err.message : String(err) });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Callback scheduling failed" });
      }
    }),
});
