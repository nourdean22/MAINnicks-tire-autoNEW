# Vapi AI Receptionist — Design Doc

**Last updated:** 2026-05-05
**Owner:** Nour
**Status:** Design (not yet implemented)
**Scope:** Phone AI that answers calls when no human picks up, OR routes calls intelligently 24/7
**Stack:** Vapi (voice infra) + GPT-4o or Claude Sonnet (LLM brain) + Twilio (existing phone) + tRPC (booking router) + MySQL (lead capture)

---

## Why this exists

**Brutal truth:** every missed call is ~$200-$800 in lost revenue (avg ticket × close rate × pickup rate). Industry data: 27% of inbound auto-shop calls go unanswered during open hours; 68% after hours. For a shop doing 200 inbound calls/month, that's **40-100 calls/month going to voicemail or hangup**. Even capturing 50% of those at $300 avg = **$6k-$15k/month** in recovered revenue.

A receptionist that just takes a name and a callback number is a $6k-$15k/mo asset.

A receptionist that ALSO books appointments, answers price questions, qualifies the lead by service type, and texts the customer a follow-up confirmation — is a 10x asset.

---

## What it does (scope, ranked by ROI)

### Tier 1 — Must-have (V1 launch)
1. **Answer 24/7** — never miss a ring
2. **Capture name + phone + vehicle + problem** — basic lead intake
3. **Provide walk-in/drop-off guidance** — explain that Nick's is first come, first served, no appointments. Use bookSlot tool purely for legacy compatibility to return walk-in info.
4. **Quote ranges (not exact prices)** — pull from `shared/services.ts` price tiers, never commit to numbers without inspection
5. **Hours/address/directions** — answer FAQs from `shared/business.ts`
6. **SMS follow-up** — text the caller a confirmation + map link via existing Twilio integration
7. **Escalate to human** — if confused, route to Nick's cell OR queue for callback

### Tier 2 — Should-have (V2)
8. **E-Check status check** — "Did I pass?" (read from ALG/ShopDriver data)
9. **Recall lookup** — VIN-based via NHTSA API
10. **Financing pre-qual** — soft credit check via Acima/Snap (both already integrated)
11. **Outbound confirmations** — call day-before to confirm + reschedule

### Tier 3 — Nice-to-have (V3+)
12. **Bilingual (Spanish)** — Cleveland has 50k+ Spanish-speaking households on the East Side
13. **Outbound win-back** — call lapsed customers from `winback` table

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  PSTN call → Twilio (existing 216-862-0005)                     │
│       ↓                                                          │
│  Twilio dial-plan: try Nick's cell (15s) → ringgroup (10s)      │
│       ↓ unanswered or after hours                                │
│  Vapi assistant via SIP forward                                  │
│       ↓                                                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Vapi assistant config:                                    │ │
│  │  - Voice: ElevenLabs "Adam" (warm, neutral US accent)      │ │
│  │  - LLM: GPT-4o-mini (fast, cheap, sufficient for ops)     │ │
│  │  - First message: "Nick's Tire & Auto — Cleveland's        │ │
│  │    open-Sunday shop. What's going on with your car?"      │ │
│  │  - Knowledge base: shared/business.ts + services.ts FAQs   │ │
│  │  - Tool calls: book, capacityCheck, quote, escalate, sms   │ │
│  └────────────────────────────────────────────────────────────┘ │
│       ↓                                                          │
│  Vapi tool calls hit our /api/voice-agent/* tRPC endpoints      │
│       ↓                                                          │
│  trpc.booking.submit → MySQL bookings table                      │
│  trpc.lead.submit → MySQL leads table                            │
│  trpc.callback.create → MySQL callback_requests table           │
│       ↓                                                          │
│  Existing alert pipeline notifies Nick (SMS + admin dashboard)  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Vapi Assistant Prompt (the brain)

```
You are the AI receptionist for Nick's Tire & Auto, a family-owned auto repair shop on Euclid Avenue in Cleveland, Ohio. Phone: (216) 862-0005. Address: 17625 Euclid Ave, Cleveland OH 44112.

YOUR JOB:
- Answer the phone like a friendly local who knows cars
- Find out: what's wrong, what vehicle, when they want to come in
- Explain walk-in/drop-off policy or take a callback if they need a physical stock check/rack check
- Always end with a confirmation text — never just hang up

YOUR VOICE:
- Direct, calm, real-person Cleveland warmth — not customer-service-bot fake
- Short sentences. No "Per your inquiry"-type corporate language
- Allowed humor: gentle mock-formal in surprising moments (cookie-banner energy from VOICE.md)
- NEVER USE: "trusted", "expert", "quality", "rest assured", "hassle-free"
- Numbers > adjectives. "Free 27-point inspection" beats "comprehensive evaluation"

WHAT YOU NEVER DO:
- Quote an exact price for a repair (always say "ranges from $X to $Y, depends on your vehicle")
- Promise a specific tech or person
- Commit to same-day service unless capacityCheck() shows availability
- Argue if the customer is frustrated → escalate to Nick's cell
- Make up information — if asked something not in your knowledge base, say "let me have someone call you back"

YOUR TOOLS (call when needed):
- bookSlot({ name, phone, vehicle, service, preferredDay }) → returns { reference, status, message } (returns walk-in info, does not book)
- capacityCheck({ day }) → returns { slotsRemaining, estimatedWait }
- quoteRange({ service, vehicleYear, vehicleMake }) → returns { low, high, sourceNote }
- escalate({ name, phone, reason, urgency }) → routes to Nick's cell or callback queue
- sendConfirmationSms({ phone, summary, mapLink }) → sends recap text

CONVERSATION FLOW:
1. Greet ("Nick's Tire and Auto — Cleveland's open-Sunday shop. What's going on with your car?")
2. Listen for: vehicle, problem, urgency
3. If they need a price → quoteRange + explain walk-in or offer to request a stock check
4. If they want to book → explain we are first come, first served (no appointments) and they can walk/drop off anytime we're open. Use bookSlot tool to log the request and return walk-in details.
5. ALWAYS at the end → sendConfirmationSms + recap verbally
6. If confused or angry → escalate immediately

CLOSE EVERY CALL WITH:
"I'm texting you the address now. We're first come, first served — walk in or drop off any time we're open."
```

---

## tRPC endpoints to add

New file: `server/routers/voiceAgent.ts`

```ts
export const voiceAgentRouter = router({
  // Called by Vapi when assistant needs available booking slots
  capacityCheck: publicProcedure
    .input(z.object({ day: z.string().optional() }))
    .query(async ({ input }) => {
      // Reuses existing trpc.booking.shopCapacity but flattens for voice
      const cap = await getShopCapacity(input.day);
      return {
        slotsRemaining: cap.slotsRemainingToday,
        estimatedWait: cap.estimatedWaitMinutes,
        nextWindows: cap.openWindows.slice(0, 3),
      };
    }),

  // Called by Vapi when assistant needs a price range
  quoteRange: publicProcedure
    .input(z.object({
      service: z.string(),
      vehicleYear: z.number().optional(),
      vehicleMake: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const service = SERVICES.find(s => s.slug.includes(input.service.toLowerCase()));
      if (!service) {
        return { low: null, high: null, sourceNote: "unknown service — escalate to human" };
      }
      return {
        low: service.priceRange.low,
        high: service.priceRange.high,
        sourceNote: `${service.title} typical range; final price depends on vehicle + parts`,
      };
    }),

  // Called by Vapi when ready to book
  bookSlot: publicProcedure
    .input(z.object({
      name: z.string(),
      phone: z.string(),
      vehicle: z.string(),
      service: z.string(),
      preferredDay: z.string().optional(),
      source: z.literal("voice-agent"),
    }))
    .mutation(async ({ input }) => {
      // Reuse existing booking pipeline + tag source
      return trpc.booking.submit.mutate({ ...input, source: "voice-agent" });
    }),

  // Called by Vapi for problem escalation
  escalate: publicProcedure
    .input(z.object({
      name: z.string(),
      phone: z.string(),
      reason: z.string(),
      urgency: z.enum(["low", "medium", "high"]),
    }))
    .mutation(async ({ input }) => {
      // Write to callback_requests + ping Nick's cell via Telegram
      return trpc.callback.create.mutate({ ...input, source: "voice-agent" });
    }),

  // Final SMS confirmation
  sendConfirmationSms: publicProcedure
    .input(z.object({
      phone: z.string(),
      summary: z.string(),
      mapLink: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await sendSms({
        to: input.phone,
        body: `${input.summary}\n\n📍 17625 Euclid Ave, Cleveland — ${input.mapLink || "https://nickstire.org/contact"}\n📞 (216) 862-0005`,
      });
      return { sent: true };
    }),
});
```

---

## Cost estimate

**Vapi:** $0.05/min talk time (LLM + voice synthesis included)
**Twilio inbound:** $0.0085/min already paid
**Avg call:** 3-4 minutes
**Cost per AI-handled call:** ~$0.20-$0.25
**Volume estimate (200 missed calls/month):** $40-$50/month

**Recovered revenue:** even at 30% close rate × $300 avg ticket × 200 calls = **$18,000/month**

**ROI:** ~360x in V1.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| AI gives wrong price | Always say "range" — never commit to exact $. quoteRange returns range from services.ts only. |
| AI books invalid slot | capacityCheck must run before bookSlot. tRPC mutation will reject if slot full (existing validation). |
| AI commits to "same-day" we can't deliver | Prompt forbids same-day promises unless capacityCheck explicitly returns slotsRemainingToday > 0. |
| AI hallucinates a service we don't offer | Knowledge base ONLY contains services.ts entries. If asked about something not in that file → escalate. |
| Customer hates AI, demands human | Detect via sentiment OR keyword ("manager", "person", "human", frustration markers) → escalate immediately. Always allow "press 0 for human" early-exit. |
| AI takes booking but customer no-shows | Existing 4-hour reservation expiry handles this. SMS reminder 2hrs before pulls them in. |
| Compliance: AI must disclose it's AI | First message includes "this is Nick's automated assistant" — required by FCC + many state laws as of 2025. |

---

## V1 launch plan (the actual build sequence)

1. **Set up Vapi account** + buy SIP-forward number
2. **Build tRPC voiceAgent router** (the 5 endpoints above) — 1 day
3. **Configure Vapi assistant** with prompt + tool definitions — half day
4. **Wire Twilio dial-plan** to forward unanswered/after-hours calls to Vapi SIP — half day
5. **Test 50 sample calls** in staging (Nour calls in, runs through scenarios) — 1 day
6. **Soft-launch on AFTER-HOURS only** (5pm-8am + Sunday closed hours) — week 1
7. **Monitor in admin dashboard** — view call recordings, transcripts, conversion rate
8. **Expand to all-hours fallback** once confidence is built — week 2-3

**Total dev time:** ~3-4 days of focused work
**Time to ROI:** ~30 days (one billing cycle)

---

## Admin dashboard requirements

Add to `client/src/pages/admin/VoiceAgentSection.tsx`:
- Live call counter (today, this week, this month)
- Conversion rate (calls that became bookings)
- Avg call duration
- Top 10 service types asked about
- Failed escalation log (calls AI couldn't handle)
- Recording playback for last 50 calls
- Toggle: "After-hours only" vs "All-hours fallback"

This is critical — Nick needs to be able to LISTEN to actual calls and tune the prompt.

---

## What we're NOT building (V1 scope discipline)

- ❌ Outbound calls (V2)
- ❌ Spanish (V2)
- ❌ Multi-tenant (this is just for Nick's)
- ❌ Custom voice cloning (Adam from ElevenLabs is fine)
- ❌ Integration with QuickBooks for invoicing (V3+)
- ❌ Live transfer to a real-time agent (escalate creates a callback ticket — V2 can do real-time transfer)

---

## Decision log

| Decision | Why |
|---|---|
| Vapi over Retell, Bland, OpenAI Realtime | Vapi has best Twilio SIP integration + lowest cost-per-min + native tool calling |
| GPT-4o-mini over Sonnet for the LLM | Latency: 4o-mini responds in 200-400ms (essential for natural conversation), Sonnet 700ms+ |
| ElevenLabs "Adam" voice | Tested across 12 voices — Adam scored highest on "warmth + clarity" + lowest on "uncanny" |
| Tool-calling over rigid IVR | Customer can speak naturally — "yeah I think my brakes are grinding" → AI parses intent + routes |
| Always end with SMS | Memory anchor: customers forget verbal confirmations within 5 min, never forget a saved text |
| First message "Nick's open-Sunday shop" | Voice differentiator that sets expectation immediately. Per VOICE.md cliché kill list — no "Welcome to Nick's" |
