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
      // 2026-07-20 · This used to invent capacity out of nothing: three
      // hardcoded "windows", `slotsRemainingToday: 3`, and a flat
      // `estimatedWaitMinutes: 30` returned on EVERY call regardless of the
      // day, the hour, or what was actually happening in the shop. Nick's is
      // walk-in / first-come first-served — there are no slots to remain and
      // no schedule to check, so every one of those figures was fiction the
      // AI could repeat to a caller as fact.
      //
      // Operator decision: the AI never states a wait or a capacity. It
      // confirms whether the shop is OPEN that day and says walk in; a live
      // person answers "how busy is it right now".
      const requestedDay = input.day ? new Date(input.day) : new Date();
      const isValidDay = !Number.isNaN(requestedDay.getTime());
      const day = isValidDay ? requestedDay : new Date();
      const dayName = day.toLocaleDateString("en-US", { weekday: "long", timeZone: BUSINESS.timezone });
      const isSunday = day.getDay() === 0;

      return {
        walkIn: true,
        openThatDay: true,
        hours: isSunday ? "9-4" : "8-6",
        message: `${dayName} — we're open ${isSunday ? "9 to 4" : "8 to 6"}. Nick's is first come, first served, so walk in any time we're open.`,
        aiHint:
          "Do NOT state a wait time, a number of minutes, or how busy the shop is — you don't have that information. Confirm the day is open and that it's walk-in. If the caller presses on how long the wait is, hand them to a person (transferCall while open).",
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
        log.info("Voice agent bookSlot called (bypassing DB bookings table)", { name: input.name, service: input.service });

        // wave-fix-2026-05-25 (audit #107) · mark this call as converted
        // so VAPI eval scoring + conversion-rate dashboards count it.
        // Pre-fix, convertedToLead stayed 0 for every booked call, the
        // alert thresholds (e.g. "low-quality calls > 30%") fired on
        // noise. Best-effort · failure here doesn't block the booking.
        if (input.callId) {
          try {
            const { db } = await import("../lib/db-helper");
            const d = await db();
            if (d) {
              const { vapiCallLogs } = await import("../../drizzle/schema");
              const { eq } = await import("drizzle-orm");
              await d.update(vapiCallLogs)
                .set({ convertedToLead: 1 })
                .where(eq(vapiCallLogs.vapiCallId, input.callId));
            }
          } catch (err) {
            log.warn("Failed to mark vapi_call_logs.convertedToLead=1 for bookSlot", { callId: input.callId, err: err instanceof Error ? err.message : String(err) });
          }
        }

        // Persist the intent as a durable EXPECTED ARRIVAL (not a booking — FCFS,
        // no appointments — and not a lead). This is the "customer said they're
        // coming" record the shop can plan around and later reconcile to a paid
        // invoice; it also makes the bookSlot/scheduleDropoff "phantom" real, so
        // agenticAuditor can verify a dropoff was persisted. Best-effort.
        try {
          const { recordExpectedArrival } = await import("../services/expectedArrivals");
          await recordExpectedArrival({
            phone: input.phone,
            name: input.name,
            vehicle: input.vehicle,
            service: input.service,
            preferredDay: input.preferredDay,
            source: "voice",
            sourceRef: input.callId,
          });
        } catch (err) {
          log.warn("Failed to record expected arrival from bookSlot", { err: err instanceof Error ? err.message : String(err) });
        }

        // PII projection — never echo caller name/service in returned text; AI has them in context.
        return {
          success: true,
          reference: "WALKIN-INFO",
          status: "walk_in_guidance",
          message: "No appointment was booked. Tell the caller Nick's is first come, first served. They can walk in or drop off during business hours. Send a recap text with the address if helpful.",
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
   * GRACEFUL DEGRADATION: any genuine non-send — shop gateway down AND
   * Twilio fallback unavailable, the SMS kill switch on, or any send
   * error — comes back from sendSms as { success: false }. We surface
   * that as `degraded: true` (+ a verbalRecap) so the VAPI prompt teaches
   * Nick to read the address ALOUD instead of promising a text that won't
   * arrive. A successful Twilio fallback still counts as sent
   * (degraded:false). The lead is captured server-side either way.
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
        const { orchestrateSms } = await import("../services/smsOrchestrator");
        const orchResult = await orchestrateSms({
          type: "vapi_confirmation",
          phone: input.phone,
          summary: input.summary,
          mapLink: input.mapLink,
        });

        // `sending` = the shop gateway timed out: attempted, deliberately not
        // retried (retrying risks a double-send), delivery NEVER CONFIRMED.
        //
        // It counts as success — the lead is captured and nothing should be
        // re-sent — but it is DEGRADED, because only `sent` is an observed
        // delivery. Previously a timeout mapped to "sent", so the tool returned
        // { sent: true, degraded: false } and the prompt's rule ("I'll text you
        // the address" only when sent:true) fired on a text nobody had seen
        // leave. Meanwhile the same call logged "delivery uncertain" and stored
        // the row as `sending`.
        //
        // degraded:true costs one spoken address on a text that may well have
        // arrived. degraded:false costs a caller driving off with no address at
        // all. Not a symmetric trade.
        const success = orchResult.status === "sent" || orchResult.status === "queued" || orchResult.status === "sending";
        const degraded = orchResult.status !== "sent";

        log.info("Voice agent SMS sent via orchestrator", {
          phone: input.phone.slice(-4),
          status: orchResult.status,
          degraded,
        });

        return {
          sent: success,
          sid: orchResult.id?.toString(),
          error: orchResult.status === "failed" ? orchResult.reason : undefined,
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
      // wave-180: free-form flag for special-attention inquiries.
      // Currently used for "PHYSICAL RACK CHECK REQUESTED — promised
      // 15 min callback" when caller wanted stock confirmation BEFORE
      // driving over. Appears in the admin notes column.
      notes: z.string().max(500).optional(),
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
          input.notes || null,
        ].filter(Boolean).join(" · ");

        // wave-180: rack-check requests bump urgency to 5 so the front
        // desk surfaces them above ordinary warm leads (15-min promise).
        const isRackCheck = !!input.notes && /rack.?check/i.test(input.notes);

        // 2026-06-05 · operator directive: ordinary voice tire inquiries no
        // longer create an admin lead. Every inbound call is already recorded
        // + transcribed in vapi_call_logs, so a "warm lead" per tire caller
        // was pure noise in the admin Leads feed. We persist a lead ONLY for a
        // rack-check — a promised 15-min callback the front desk MUST act on
        // (the dedicated `checkTireStock` tool is the primary rack-check path;
        // this keeps the legacy notes-based rack-check working too). Ordinary
        // inquiries are acknowledged and left to the call recording.
        if (!isRackCheck) {
          log.info("Voice agent tire inquiry — acknowledged, no admin lead (ordinary inquiry; call already recorded)", {
            name: input.name,
            size: input.tireSize,
          });
          return {
            success: true,
            message: `Got it — I've sent the tire info to the shop. ${input.tireSize ? `Looking for ${input.tireSize}.` : ""} Walk in any day, we usually have most common sizes on the rack from $60 installed.`,
          };
        }

        // lead-source hygiene · 5-min dedup scoped to VOICE-AGENT rows only —
        // VAPI can fire tireInquiry AND checkTireStock for one caller in a
        // single call (or an immediate redial), which used to create two
        // source="callback" leads with zero dedup. Scoping to utmSource=
        // "voice-agent" guarantees the matched row is itself an urgency-5
        // rack-check lead (the 15-min promise stays durably recorded) and a
        // web/chat lead can never absorb a rack-check. Voice rows store
        // digits-only phones, so RIGHT(phone,10) tolerates a country-code
        // prefix (the lookupCustomer wave-181.2 pattern). Under 10 digits
        // (blocked caller-ID, VAPI anonymous sentinel) we never dedup — a
        // garbage key must not match a DIFFERENT person. FAIL-OPEN: a dedup
        // error must never block capture — on error we insert.
        const normalizedPhone = input.phone.replace(/\D/g, "");
        const inquiryProblem = `[VOICE-AGENT TIRE INQUIRY]${input.callId ? ` callId=${input.callId}` : ""} — ${problemSummary}`;
        let dedupLeadId: number | null = null;
        if (normalizedPhone.length >= 10) {
          try {
            const { and, eq, gte, sql } = await import("drizzle-orm");
            const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
            const [recent] = await d.select({ id: leads.id }).from(leads)
              .where(and(
                sql`RIGHT(${leads.phone}, 10) = ${normalizedPhone.slice(-10)}`,
                eq(leads.utmSource, "voice-agent"),
                gte(leads.createdAt, fiveMinAgo),
              ))
              .limit(1);
            dedupLeadId = recent?.id ?? null;
          } catch (dedupErr) {
            log.warn("[voiceAgent:tireInquiry] dedup check failed — proceeding with insert", { err: dedupErr instanceof Error ? dedupErr.message : String(dedupErr) });
          }
        }

        // wave-149 · capture the new lead's id via $returningId() so the
        // call→lead FK gets written below. Pre-fix the id was discarded, so
        // vapi_call_logs.leadId was ALWAYS null for voice tire inquiries —
        // call-to-conversion traceability was broken (eval + attribution).
        let newLeadId: number | null = dedupLeadId;
        if (dedupLeadId == null) {
          const insertedLeadRows = await d.insert(leads).values({
            name: input.name,
            phone: normalizedPhone,
            email: null,
            problem: inquiryProblem,
            vehicle: input.vehicle || null,
            source: "callback",
            status: "new",
            urgencyScore: isRackCheck ? 5 : 4,
            utmSource: "voice-agent",
            utmMedium: "phone",
            utmCampaign: isRackCheck ? "vapi-rack-check" : "vapi-tire-inquiry",
          }).$returningId();
          newLeadId = insertedLeadRows[0]?.id ?? null;
          log.info("Voice agent tire inquiry captured", { name: input.name, size: input.tireSize, leadId: newLeadId });
        } else {
          // Same caller's voice lead from the last 5 min — annotate it with
          // this inquiry (e.g. a second tire size) and link this call to it,
          // instead of creating a duplicate person in Leads. The annotation
          // is fail-open: if it errors the existing urgency-5 row still
          // carries the rack-check promise.
          try {
            const { eq, sql } = await import("drizzle-orm");
            await d.update(leads)
              .set({ problem: sql`CONCAT(COALESCE(${leads.problem}, ''), '\n[+] ', ${inquiryProblem})` })
              .where(eq(leads.id, dedupLeadId));
          } catch (annotateErr) {
            log.warn("[voiceAgent:tireInquiry] dedup annotate failed (existing lead still holds the promise)", { leadId: dedupLeadId, err: annotateErr instanceof Error ? annotateErr.message : String(annotateErr) });
          }
          log.info("Voice agent tire inquiry deduped onto existing voice lead", { name: input.name, leadId: dedupLeadId });
        }

        // wave-fix-2026-05-25 (audit #107) · same convertedToLead update
        // as bookSlot. A tire inquiry that creates a real `leads` row IS
        // a conversion · should not show up in the "wasted call" bucket.
        if (input.callId) {
          // RECORD THE LEAD ID ON THE CALL-STATE TRAIL.
          //
          // The UPDATE below cannot work mid-call and never did: the
          // vapi_call_logs row is INSERTED by the end-of-call webhook, so
          // during the call there is no row to update. Measured consequence —
          // leadId was populated on 0 of 2,136 rows, while 525 of them had
          // convertedToLead=1. The shop knew 525 calls produced a lead and
          // could not say WHICH lead: attribution broke at the first hop.
          //
          // The trail is durable, is written during the call, and is already
          // read by that same webhook to compute convertedToLead — so the id
          // rides a path that is proven to work rather than a new one. The
          // webhook picks it up and writes it at INSERT time.
          //
          // `tool_called` is the state the webhook already records for this
          // tool, and `trailReachedTool` is a `.some()` existence check, so an
          // extra event of the same state cannot distort convertedToLead.
          try {
            const { recordCallState } = await import("../services/voice-call-state");
            await recordCallState({
              callId: input.callId,
              state: "tool_called",
              metadata: { tool: "tireInquiry", leadId: newLeadId },
            });
          } catch (err) {
            log.warn("Failed to record leadId on the call-state trail", { callId: input.callId, err: err instanceof Error ? err.message : String(err) });
          }

          // Kept deliberately: harmless when the row is absent (0 rows
          // matched), and correct in the ordering where a webhook retry has
          // already created it. It is a belt, not the braces.
          try {
            const { vapiCallLogs } = await import("../../drizzle/schema");
            const { eq } = await import("drizzle-orm");
            await d.update(vapiCallLogs)
              .set({ convertedToLead: 1, leadId: newLeadId })
              .where(eq(vapiCallLogs.vapiCallId, input.callId));
          } catch (err) {
            log.warn("Failed to mark vapi_call_logs.convertedToLead=1 for tireInquiry", { callId: input.callId, err: err instanceof Error ? err.message : String(err) });
          }
        }

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
        const { sql } = await import("drizzle-orm");
        const d = await db();
        if (!d) return { found: false, reason: "DB unavailable" };
        const phoneDigits = input.phone.replace(/\D/g, "");
        if (phoneDigits.length < 10) return { found: false, reason: "Invalid phone format" };
        // wave-181.2: phone is stored E.164 ("+12168620005") via normalizePhone.
        // Compare on the LAST 10 digits (strip "+" and country code) so any
        // inbound format — "+12168620005", "12168620005", "2168620005",
        // "(216) 862-0005" — all match the same row.
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
          .where(sql`RIGHT(REGEXP_REPLACE(${customers.phone}, '[^0-9]', ''), 10) = RIGHT(${phoneDigits}, 10)`)
          .limit(1);
        if (!c) return { found: false };
        const monthsSinceLastVisit = c.lastVisitDate
          ? Math.round((Date.now() - new Date(c.lastVisitDate).getTime()) / (30 * 86_400_000))
          : null;
        // PII projection — never expand this without security review.
        return {
          found: true,
          firstName: c.firstName,
          lastNameInitial: c.lastName ? c.lastName.charAt(0).toUpperCase() : null,
          totalVisits: c.totalVisits,
          lastVisitMonthsAgo: monthsSinceLastVisit,
          segment: c.segment,
          vehicle: [c.vehicleYear, c.vehicleMake, c.vehicleModel].filter(Boolean).join(" ") || null,
          hasOutstandingBalance: c.balanceDue > 0,
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
              // wave-181.1 smoke-test caught: my REPLACE chain handled
              // dashes/parens/spaces but NOT plus signs, country codes,
              // or other non-digit chars. ALG phones like "+1 216-862-
              // 0005" never matched. Now: normalize BOTH sides to last
              // 10 digits using REGEXP_REPLACE — handles any formatting.
              sql`RIGHT(REGEXP_REPLACE(${algEstimates.customerPhone}, '[^0-9]', ''), 10) = RIGHT(${phoneDigits}, 10)`,
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
      // 2026-07-20 · This tool NO LONGER ESTIMATES A WAIT. It used to count
      // `bookings` rows from the trailing 24h against a hardcoded 6-bay
      // assumption and return open|busy|loaded + a minute figure. Nick's is
      // walk-in / first-come first-served, so booking volume is simply not the
      // shop's workload — the number was fabricated, and it drove both this
      // tool's answer AND an unprompted "about an hour wait in the bays" line
      // in the call greeting (see vapi-bdi.ts).
      //
      // Operator decision: a live person answers wait-time questions. The AI
      // must never guess one. Kept as a procedure (rather than deleted) so an
      // already-deployed VAPI assistant that still lists this tool gets a safe
      // hand-off instruction instead of a tool-call error mid-call.
      return {
        available: false,
        handOffToHuman: true,
        aiHint:
          "Do NOT estimate a wait time or say how busy the shop is — you don't have that information. Hand the caller to a person (transferCall) so someone on the floor can tell them.",
      };
    }),

  /**
   * checkTireStock — hand the caller to a person who can walk the rack.
   *
   * 2026-07-20 · REWRITTEN. This tool used to write a `leads` row tagged
   * "[VOICE-AGENT RACK CHECK]" at urgency 5, fire a Telegram to the front
   * desk, and tell the caller "front desk will check the physical rack and
   * follow up as soon as they can."
   *
   * Nothing in the codebase ever recorded whether anyone walked the rack —
   * the promise had no completion path, so a caller could be told someone
   * would get back to them and nobody ever did. It also generated lead rows
   * for a question, which conflicts with the standing rule that AI-handled
   * inbound must not create lead noise.
   *
   * Operator decision: rack checks go to a live person. No lead row, no
   * Telegram, no promise, no new tracking surface — the call itself is
   * already durably recorded in vapi_call_logs. Inputs are accepted but
   * ignored (and now optional) so the AI isn't forced to collect a name and
   * number just to hand off, which keeps the call short. Kept as a procedure
   * rather than deleted so an already-deployed VAPI assistant still listing
   * this tool gets a safe hand-off instead of a tool-call error mid-call.
   */
  checkTireStock: voiceAgentInternalProcedure
    .input(z.object({
      name: z.string().max(200).optional(),
      phone: z.string().max(20).optional(),
      tireSize: z.string().max(50).optional(),
      vehicle: z.string().max(200).optional(),
      callId: z.string().max(100).optional(),
    }).optional())
    .mutation(async ({ input }) => {
      log.info("Voice agent rack-check → hand off to human", { size: input?.tireSize ?? null });
      // `aiHint` (an instruction to the model), never `message` (which reads as
      // caller-facing copy the AI may speak verbatim). Keeping the instruction
      // out of a speakable field is what stops "do NOT promise a callback"
      // from being read aloud as a promise.
      return {
        success: true,
        handOffToHuman: true,
        aiHint:
          "You cannot see the rack. Do NOT state whether the tire is in stock, and do NOT promise a callback or any timeframe. Hand the caller to a person (transferCall while open, escalate while closed) so someone can physically check it.",
      };
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
        // PII projection — AI constructs the spoken confirmation from its own context.
        return { success: true };
      } catch (err) {
        log.error("Voice agent scheduleCallback failed", { err: err instanceof Error ? err.message : String(err) });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Callback scheduling failed" });
      }
    }),
});
