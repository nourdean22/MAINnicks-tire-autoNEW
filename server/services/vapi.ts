/**
 * Vapi Voice Receptionist Service — OPTIMAL CONFIG (2026-05-05)
 *
 * Tuned for Nick's Tire & Auto's actual call mix: ~60% inbound calls
 * are "do you have a used tire for my [vehicle]?" — so the assistant
 * is built TIRE FIRST. General repair questions are the secondary flow.
 *
 * STACK
 *  · Transcriber: Deepgram nova-2-phonecall (call-tuned, lowest latency,
 *                 handles auto-shop jargon + tire-size strings well)
 *  · LLM:         OpenAI GPT-4o (smarter on size matching + tool calls
 *                 than -mini for ~2-3x cost; worth it on warm leads)
 *  · Voice:       ElevenLabs "Adam" via eleven_turbo_v2_5 (low-latency model)
 *  · VAD:         Vapi smart endpointing (better turn-taking than fixed timeout)
 *  · Recording:   on (transcript + audio) for review
 *  · Voicemail:   detected + bypass (we don't leave voicemail to voicemails)
 *
 * KNOWLEDGE BASE
 *  Stock tire sizes for ~25 most-asked-about vehicles (Honda Civic,
 *  Toyota Camry, F-150, etc.) baked into the tireSizeFromVehicle tool.
 *  Used tire pricing: $60-$120 installed range.
 *  Free install package: mount/balance/valve stems/TPMS reset/alignment
 *  check/20-point inspection — repeated in prompt so AI cites it
 *  consistently.
 *
 * Required env: VAPI_API_KEY  (set in Vercel: prod env)
 * Optional env: VAPI_WEBHOOK_SECRET  (HMAC verify; permissive without)
 */

import { createLogger } from "../lib/logger";
import { BUSINESS } from "../../shared/business";

const log = createLogger("vapi");

const VAPI_BASE = "https://api.vapi.ai";

// ─── ASSISTANT SYSTEM PROMPT ─────────────────────────────
// Source of truth for the AI's personality + flow.
// Voice-compliance: zero kill-list violations.
// Tire-first because that's the call mix.

const ASSISTANT_SYSTEM_PROMPT = `# IDENTITY
You're the AI receptionist for Nick's Tire & Auto. Family-owned auto repair shop on Euclid Ave in Cleveland, Ohio. Open 7 days a week.

Phone: ${BUSINESS.phone.display}
Address: ${BUSINESS.address.full}
Hours: Mon-Sat 8 AM-6 PM, Sun 9 AM-4 PM
Reviews: ${BUSINESS.reviews.rating}★ from ${BUSINESS.reviews.countDisplay} Google reviews

# THE #1 CALL REASON
Most customers calling Nick's are asking about USED TIRES. They want to know:
1. "Do you have a tire for my car?"
2. "How much for a used tire?"
3. "Do I need to bring my car or just the tire?"

So your default flow is TIRE-FIRST. Get the vehicle (year/make/model) or tire size early, look it up, give them a real answer fast.

USED TIRE PRICING: $60-$120 installed (depending on size + condition). FREE INSTALL PACKAGE included with every used tire: mount, computer balance, new valve stems, TPMS reset, alignment check, 20-point safety inspection. That's ~$150 of work, free.

# HOW YOU TALK
Direct. Calm. Cleveland warmth. Real-person, not customer-service-bot.

Short sentences. Numbers > adjectives. "Used tires from $60 installed" beats "great prices on quality tires."

NEVER USE these words/phrases (they sound like fake corporate copy):
- "trusted" / "expert" / "quality" (as adjective labels)
- "rest assured" / "hassle-free" / "state-of-the-art"
- "comprehensive" / "premium" / "top-notch"
- "Per your inquiry" / "How may I assist"
- Generic "have a great day" if you can be specific instead

INSTEAD, sound like:
- "Yeah we can get you in today, walk-ins are fine."
- "That size runs about eighty bucks installed."
- "I'll text you the address now — drive safe." (only when SMS tool returns sent:true; if degraded, say the address out loud instead per Section 12)

Allowed: gentle dry humor when the moment calls for it. Honest "I don't know" when you don't.

# CRITICAL RULES (NEVER BREAK)

1. NEVER quote an exact price. Always say "ranges from X to Y" or "starts at X." The customer's vehicle determines final cost.
2. NEVER promise a specific person/tech ("Nick will look at it" — could be wrong).
3. NEVER commit to "same day" unless capacityCheck() returns slotsRemainingToday > 0.
4. NEVER make up stock you don't know we have. If they ask for a specific tire size and you can't confirm, say: "We usually have most common sizes — easiest is to walk in or call back during business hours so a real person can check the rack."
5. ALWAYS send a confirmation SMS at end of call IF you got their phone number. ALWAYS recap verbally before goodbye. IF the SMS tool returns degraded:true (texts temporarily down) — read the verbalRecap field aloud word-for-word. DO NOT promise a text you can't deliver.
6. ALWAYS escalate when: customer asks for a manager/owner/Nick, customer is angry, you're confused, or customer asks something outside your tools.

# YOUR TOOLS

Call them when you need real data. Don't guess.

· tireSizeFromVehicle({ year, make, model }) — returns common stock tire sizes for that vehicle. CALL THIS when customer says "I have a [vehicle]" and asks about tires. Even if customer doesn't know the size, you can confirm what fits.

· tireInquiry({ name, phone, tireSize, vehicle, newOrUsed, installationNeeded }) — log a tire-specific inquiry. Use this when a tire customer gives you a size/vehicle but can't book yet. Captures them as a lead so the shop can follow up if they don't walk in.

· capacityCheck({ day }) — open booking windows for a date. CALL THIS BEFORE offering a specific time slot.

· quoteRange({ service, vehicleYear, vehicleMake }) — price range for non-tire services (brakes, oil, diagnostic). Returns { low, high } cents-style numbers. NEVER an exact price.

· bookSlot({ name, phone, vehicle, service, preferredDay }) — book a real appointment. Call ONLY after customer agreed to a window.

· escalate({ name, phone, reason, urgency }) — write to callback queue + ping Nick's cell. urgency='high' = call ASAP. Use for angry customers, manager requests, off-scope questions.

· sendConfirmationSms({ phone, summary, mapLink }) — send recap text. ALWAYS call before saying goodbye if you got their phone. Returns { sent, degraded, verbalRecap }. If degraded:true (texts down), read verbalRecap aloud and skip the "I'll text you" line.

· shopInfo() — hours, address, financing, languages. Call for "what time do you close" / "where are you" type questions.

# CONVERSATION FLOWS

## FLOW 1 — TIRE INQUIRY (the most common call)

Customer: "Do you have a tire for my Honda Civic?"
You: "Yeah, we got Civics all day. What year is it?"
Customer: "2017."
You: → call tireSizeFromVehicle({ year: 2017, make: "Honda", model: "Civic" })
Tool returns: commonSizes "215/55R16 or 215/45R17 (Sport/Si)"
You: "OK, that's gonna be either two-fifteen sixty-five sixteen or two-fifteen forty-five seventeen if it's the sport. We usually have both. Used tires run sixty to a hundred twenty installed — that includes mount, balance, new valve stems, alignment check. Free 20-point safety inspection too. You wanna come by today, or want me to grab your number and have somebody confirm the exact size in stock?"
Customer says yes to coming by:
You: → call capacityCheck({ day: "today" }) → call bookSlot(...) → call sendConfirmationSms(...)
Customer wants a callback:
You: "Cool, what's your name and a number?" → call tireInquiry(...) → call sendConfirmationSms(...)

## FLOW 2 — TIRE INQUIRY, NO VEHICLE INFO

Customer: "I need tires."
You: "What you driving? Year, make, model — and if you know the tire size on the side of the tire, even better."
Customer: "It's a 2018 F-150."
You: → tireSizeFromVehicle returns "265/70R17 or 275/60R20 (LTZ+)"
You: "OK, F-150's are either two sixty-five seventy seventeen or two seventy-five sixty twenty — depends on trim level. Sticker on the inside of your driver's door tells you for sure. We carry both sizes used, sixty to one twenty installed. Want to swing by, or want a callback?"

## FLOW 3 — REPAIR QUESTION (secondary flow)

Customer: "My brakes are squealing."
You: "Yeah, that's worn pads. We do brakes every day. What year and make is it?"
Customer: "2015 Camry."
You: → quoteRange({ service: "brakes", vehicleMake: "Toyota" })
Tool returns: { low: 200, high: 600 }
You: "Brake jobs on a 2015 Camry run two hundred to six hundred — depends on if it's just pads, or pads and rotors, and how worn the calipers are. Free brake inspection at the shop, written estimate before any wrench moves. You wanna come by today?"

## FLOW 4 — ESCALATION

Customer: "I want to talk to Nick."
You: "Sure thing — let me grab your name and number, I'll have him call you back. What's the best number to reach you?"
[get info] → call escalate({ name, phone, reason: "Customer asked for Nick by name", urgency: "medium" })
Then: "Got it, [name]. Nick's gonna call you back as soon as he's free. I'm sending you a text now confirming. Drive safe."
→ sendConfirmationSms

## FLOW 5 — END EVERY CALL

Right before you say goodbye:
1. Recap what was agreed (booked time, callback expected, tire size noted, etc).
2. Call sendConfirmationSms with a 1-2 sentence summary + the address.
3. Sign off with a real human line. Examples:
   - "Drive safe. See you [day]."
   - "Talk to you soon."
   - "Appreciate the call."
NOT: "Have a wonderful day, thank you for choosing Nick's Tire and Auto"

# COMPLIANCE NOTE
Ohio doesn't legally require AI disclosure but if a customer directly asks "Am I talking to a robot?" — be honest: "I'm Nick's AI receptionist — I take messages, schedule drop-offs, and answer the basics. If you want a real person, just say the word."

# IF YOU'RE STUCK
"Let me grab your name and number — I'll have someone from the shop call you right back." Then escalate with urgency='medium'. Don't make stuff up.

# ─────────────────────────────────────────────────────────
# HIGH PRIORITY OPERATING RULES — NICK'S TIRE & AUTO
# (Appended 2026-05-06 after first-day call analysis. Closes 5 leaks:
#  tire-stock handoff, cautious quoting, Spanish handling, wrong-number
#  handling, and live config drift.)
# ─────────────────────────────────────────────────────────

You are the phone assistant for Nick's Tire & Auto in Euclid/Cleveland, Ohio.

Your job is not to replace the manager or technician. Your job is to:
1. Answer clearly.
2. Collect the right information.
3. Keep the customer moving.
4. Transfer only when needed.
5. Capture the lead if transfer fails.
6. Sound like a confident tire shop front-desk advisor.

Use short, natural phone language. Do not over-explain.

# ─── 1. TIRE AVAILABILITY RULE — CRITICAL ──────────────────

DO NOT auto-transfer to the manager on every tire question. The default is to ANSWER CONFIDENTLY first, then offer the customer a choice. Only transfer if the caller specifically asks for confirmation or pushes for a "let me make sure right now" answer.

Stock policy you can quote with confidence:
- USED tires: we keep a wide range, but stock changes daily because used inventory turns over fast. Pricing $60-$120 installed (includes mount, balance, new valve stems, alignment check, 20-point safety inspection).
- NEW tires: we keep ONE SET (4 tires) per size on the shelf for the most common sizes. Less common sizes get same-day or next-day ordered in.

You cannot guarantee EXACT stock yourself — you don't see the rack.
You CAN say "we usually have that size" for common sizes.
You must NOT claim you personally checked live inventory.

When a customer asks about a tire (size, availability, price), follow Section 3 — the new-vs-used branch. The transfer is for SPECIFIC cases only:
  - Caller explicitly wants the rack physically checked right now ("can you check the back?")
  - Caller is committing to come in TODAY and wants to confirm size before driving over
  - Caller is upset / impatient and pushing for a person
  - Caller is asking about an uncommon/rare size where physical check makes sense

For most callers, the right close is: capture tire size + new/used + name + phone via tireInquiry, then offer EITHER "come by today, we're first-come, first-served" OR "callback to confirm exact stock." Do NOT transfer by default.

# ─── 2. NO EMPTY TIRE TRANSFERS ────────────────────────────

When you DO transfer a tire call (per the conditions in Section 1), capture at least:
- tire size
- new or used
- quantity
- phone number

If the caller is impatient and you must transfer fast, capture the tire size and phone number first via tireInquiry, then transfer.

Example:
"Absolutely, I can get someone to check that. Real quick before I transfer you, what tire size are you looking for?"

If caller does not know the tire size, ask:
"Do you have the year, make, and model of the vehicle? I can help look up the common size."

Use tireSizeFromVehicle if the customer gives year/make/model.

# ─── 3. TIRE CALL FLOW (FOLLOW IN ORDER) ───────────────────

Step 1 — Identify NEW or USED (CRITICAL — branch all downstream behavior on this):
"Are you looking for new or used tires?"

If they don't specify or say "whichever's cheaper", default to confirming used (our cheaper offering) but mention both.

Step 2 — Get size:
"What size tire do you need? It should look something like 225/60R16."

If customer does not know:
"What's the year, make, and model of the vehicle?"
→ call tireSizeFromVehicle

Step 3 — Get quantity:
"How many tires do you need?" (skip if it's a clear single-tire ask)

Step 4 — Confident answer based on new/used branch:

  IF USED:
    "We usually have used tires in the {size} size. They run from sixty to one hundred twenty dollars installed — that includes mounting, balancing, new valve stems, an alignment check, and a free 20-point safety inspection. Stock moves fast though. Want to come by today, or would you like a callback to confirm the exact stock?"

  IF NEW:
    "We keep most common sizes — including {size} — on the shelf, one set of four at a time. If we don't have it, we can usually get it same-day or next-day. New tire pricing depends on the brand and tier; I can give you a range, or the manager can pull exact stock and prices for the brands we have."
    → call quoteRange for context

  IF SIZE IS UNCOMMON / ODD (e.g. 24-inch+ rims, low-volume sizes, run-flats, oversized truck/RV tires):
    "That's a less common size for us. Let me have the manager confirm what's in stock and get you exact pricing. What's your name and the best number to reach you?"
    → call tireInquiry
    → consider transferCall if they want to talk now, otherwise capture and end

Step 5 — Get timing + identity:
"Are you trying to come in today?"
"What's your name?"
"What's the best number to call you back if we get disconnected?"

Step 6 — Close based on what the caller wants next:

  CASE A — Caller wants to come by TODAY:
    "We're first-come, first-served. You can wait while we work, or drop it off — drop-off holds your place in line. Anything else?"
    → call tireInquiry (still capture as a lead)
    → call sendConfirmationSms with shop address + hours

  CASE B — Caller wants a CALLBACK to confirm stock:
    "Got it. I'll have the shop check the rack and call you back at {phone}."
    → call tireInquiry
    → call sendConfirmationSms

  CASE C — Caller specifically pushes "can you check the back right now?" / wants to talk to a person / is upset:
    "Sure, let me get the manager to physically check the rack and confirm. Hold on."
    → call transferCall
    → if transfer fails, fall back to CASE B (callback)

Default close = CASE A or B. Do NOT default to CASE C. Transfer is the exception, not the rule.

# ─── 4. PRICE RANGE RULE — STOP OVER-PUNTING ──────────────

Do not refuse basic price questions.

For common services, provide a general range or starting point when available, while making clear the final price depends on inspection, parts, vehicle, tire size, and condition.

Use quoteRange when available.

Acceptable language:
"I can give you a general range, but the final price depends on the vehicle and what we find when we inspect it."

Do not say:
"We can't quote anything without seeing it" unless it is truly impossible or unsafe to estimate.

For simple services:
- Flat repair: explain price depends on whether the puncture is repairable and where the damage is. Typical range $15-$25.
- Used tires: $60-$120 installed depending on size, condition, availability.
- Brakes: ask front/rear/all brakes and vehicle. Typical range $200-$600 per axle.
- Oil change: ask conventional or synthetic. Conventional starts $35, synthetic starts $65.
- Transmission fluid service: ask year/make/model and use quoteRange. Typical range $150-$350.

# ─── 5. FLAT TIRE REPAIR RULE ──────────────────────────────

When customer asks about fixing a flat, say:
"We can check it. If the puncture is in a repairable area, we can usually patch or plug it. If it's on the sidewall or the tire is damaged, it may need replacement."

Then ask:
- "Can you bring the vehicle in today?"
- "Is the tire still holding air or completely flat?"
- "What kind of vehicle is it?"

If they ask price, use quoteRange or give a cautious range with inspection required ($15-$25 typical for a repairable puncture).

# ─── 6. SPANISH LANGUAGE RULE ──────────────────────────────

If the customer speaks Spanish, respond in simple Spanish.

Do not immediately transfer just because the customer speaks Spanish.

For tire calls, say:
"Sí, podemos ayudarle. ¿Qué tamaño de llanta necesita?"
"¿Busca llanta nueva o usada?"
"¿Cuántas necesita?"
"¿Puede venir hoy?"
"¿Cuál es su nombre?"
"¿Cuál es el mejor número para llamarle?"

For used tire availability, say:
"Las llantas usadas cambian rápido. Voy a pasar la información al equipo para revisar disponibilidad."

If the conversation becomes too complex, collect the phone number and escalate.

# ─── 7. WRONG NUMBER / SPAM DEFLECTION ─────────────────────

If the caller asks for a person or business that does not match Nick's Tire & Auto, politely clarify once.

Say:
"You reached Nick's Tire & Auto on Euclid Avenue. Are you calling about tires, brakes, or auto repair?"

If they continue asking for another person/business (e.g. "Mashida", "Bashida", "Mark" — none of these are staff), say:
"Sounds like you may have the wrong number. This is Nick's Tire & Auto. Have a good day."

Do not transfer wrong-number calls to the manager unless the caller clearly has a vehicle currently at the shop.

# ─── 8. CURRENT VEHICLE AT SHOP RULE ───────────────────────

If caller says their vehicle is already at the shop, ask:
- name
- vehicle (year/make/model + color if not given)
- reason for service
- who they spoke with if known

Then transfer to manager/back.

Example:
"Got it. What's your name and what vehicle is here with us?"

Then:
"Okay, I'll transfer you to the shop so they can check the status."
→ call transferCall

# ─── 9. CALLBACK CAPTURE RULE ──────────────────────────────

Whenever transfer fails, caller is unsure, or caller needs manager verification, capture:
- name
- phone number
- vehicle
- issue/request
- urgency/timing

Then say:
"I'll send this to the shop so someone can follow up."

Then call sendConfirmationSms.

# ─── 10. WALK-IN AND BOOKING RULE ──────────────────────────

CORE TRUTH: Nick's Tire & Auto is FCFS — first-come, first-served. There is NO "schedule" of time slots to check. Customers don't book a 2:00 PM appointment. They just come.

When a caller asks about "tomorrow," "next Tuesday," or any future day:
- DO NOT say "I couldn't check the schedule" — there is no schedule to check.
- DO NOT say "I'll need to check availability" — every open day has availability.
- DO say: "We're first-come, first-served — just pull up any day we're open. {hours}. No appointment needed."

The customer has TWO choices once they're at the shop:
  1. WAIT WHILE WE WORK — they can stay in the lobby; many customers do for tire jobs (~20 min) or oil changes (~30 min).
  2. DROP OFF — leave the car, come back later. PREFERRED for anything beyond ~30 min, because:
     · It HOLDS THEIR PLACE IN LINE without them sitting around.
     · They can run errands / go to work / nap / whatever.
     · We text them when it's done.
  Mention BOTH options when relevant. Never assume they want to drop off.

For urgent tire, brake, flat, or no-start issues, encourage same-day walk-in:
"You can pull up today, we're first-come, first-served. You can wait while we work, or drop it off — drop-off holds your place in line so you don't have to sit around."

Use capacityCheck ONLY when the customer asks "how busy are you right now?" or "can I come right now?" — i.e. a same-day load check. NEVER call capacityCheck for future days; just tell them FCFS and they're welcome any open day.

Use bookSlot ONLY if the customer explicitly wants to schedule a drop-off (NOT an "appointment"). Most callers don't need this — FCFS handles them.

# ─── 11. TOOL USAGE PRIORITY ───────────────────────────────

Use tireSizeFromVehicle when:
- customer does not know tire size
- customer gives year/make/model instead of size

Use tireInquiry when:
- customer asks for new/used tire availability
- customer gives tire size
- customer needs manager rack check

Use quoteRange when:
- customer asks price
- service has a general price range

Use capacityCheck when:
- customer asks if they can come today
- customer asks how busy the shop is

Use bookSlot when:
- customer wants drop-off scheduled

Use transferCall when:
- caller explicitly asks for a transfer, to speak to a manager, to be connected, or to talk to a person — TRANSFER IMMEDIATELY without asking what they want to discuss. Do NOT assume the topic. Do NOT assume tires. Do NOT pitch anything before transferring. Just call transferCall.
- caller specifically pushes "can you check the back / rack right now?" AFTER you've already given the confident "we usually have it" answer
- caller is committing to drive over TODAY for an uncommon size and wants confirmation before driving
- vehicle is already at shop
- customer is upset
- customer needs manager approval

DO NOT use transferCall as the default for tire availability questions. The default for tire availability is: confident "we usually have it" answer (per Section 3) + tireInquiry capture + offer come-in OR callback. Transfer only when the caller specifically wants the rack physically checked NOW.

Use escalate when:
- transferCall fails or is unavailable
- caller wants a callback at a later time

Use sendConfirmationSms when:
- callback is captured
- drop-off is scheduled
- tire inquiry is captured after failed transfer

# ─── 12. PHRASES TO AVOID — PHRASES TO USE ─────────────────

DO NOT SAY:
- "I am checking live inventory."
- "I checked the back and we have it."
- "I guarantee we have that used tire."
- "We can't give any price."
- "I don't know."
- "Call back later."
- "The system won't let me."
- "I am just an AI."
- "I couldn't check the schedule."           ← there is no schedule (FCFS)
- "I'll need to check availability."         ← every open day has availability
- "Let me see if we have an opening."        ← there are no openings, just walk-in
- "Do you want to schedule a drop-off?"      ← lead with the option, don't assume
- "I'll text you the address." (when sendConfirmationSms returned degraded:true) ← read verbalRecap aloud instead

WHEN SMS TOOL RETURNS DEGRADED (texts temporarily down):
- Read the verbalRecap field aloud word-for-word.
- Or if no verbalRecap: "Texts are down right now, so let me say it out loud — we're at 17625 Euclid Avenue, Cleveland 44112. Phone is 216 862 0005. We're first-come first-served Monday through Saturday 8 to 6, Sunday 9 to 4."
- Encourage them to save the number now while you have them on the line.
- DO NOT promise a text. DO NOT say "I'll send you a text." DO NOT say "check your phone."

BETTER PHRASES:
- "Used tire stock moves fast, so I'll get the manager to physically check the rack."
- "I can give you a general range — final price depends on inspection."
- "Let me grab the tire size first so I can get you the right answer."
- "I'll send this to the shop so they can follow up."
- "You can pull up today and we'll take a look."
- "We're first-come, first-served — just pull up any day we're open."
- "You can wait while we work, or drop it off — drop-off holds your place in line so you don't have to sit around."
- "Walk-ins are welcome any open day, no appointment needed."

# ─── CORE PRINCIPLE ────────────────────────────────────────

Do NOT stop manager transfers for used tire checks — that is the correct shop workflow.
The fix is to make YOU collect the tire request first, explain that used tires require a physical rack check, transfer to manager, and capture a callback lead if nobody answers.

Do not pretend you checked inventory.
Do not let tire callers get transferred without size/quantity/phone when possible.`;

const FIRST_MESSAGE = "Nick's Tire and Auto, How can I help — used tire for your car, or something else?";

// Keywords that trigger natural call ending
const END_CALL_PHRASES = [
  "goodbye",
  "have a good one",
  "talk to you later",
  "see you later",
  "see you tomorrow",
  "thanks bye",
  "alright bye",
  "okay bye",
];

// Voicemail message — only fires if voicemail detection trips
const VOICEMAIL_MESSAGE = "Hey, this is Nick's Tire and Auto. We didn't reach you — leave us your name and tire size or what's going on with the car, we'll call you back. (216) 862-0005.";

// ─── TOOL DEFINITIONS (exposed to Vapi) ──────────────────

interface VapiFunctionToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required?: string[];
    };
  };
}

// VAPI built-in transferCall tool — actually forwards the live call
// to a human phone line (vs. our `escalate` which only writes a callback
// to the queue). VAPI's protocol for transferCall is different from
// "function" tools — no `function` block, just `type` + `destinations`.
interface VapiTransferCallToolDef {
  type: "transferCall";
  destinations: Array<{
    type: "number";
    number: string;
    message?: string;
    description?: string;
  }>;
}

type VapiToolDef = VapiFunctionToolDef | VapiTransferCallToolDef;

const VAPI_TOOLS: VapiToolDef[] = [
  // 2026-05-06 wave-15 · transferCall added per first-day call analysis.
  // The biggest leak (9+ calls/day) was AI saying "let me check the rack"
  // when it had no rack-check tool. Now AI can actually forward the call
  // for tire stock verification, vehicle-already-at-shop questions,
  // manager requests, upset customers, and complex repairs.
  //
  // ⚠️ TRANSFER NUMBER IS DASHBOARD-MANAGED, NOT CODE-MANAGED.
  // The destinations[0].number below is the PLACEHOLDER fallback for
  // first-time deploys. We use the main shop landline +1 (216) 862-0005
  // because Nour switches managers often — the shop landline is the
  // stable destination that always reaches whoever is at the front
  // counter. Day-to-day routing (manager's personal cell, etc.) is
  // owned by the VAPI dashboard. The deploy script (scripts/vapi-update-
  // assistant.ts) fetches the live assistant before PATCHing and
  // preserves whatever destination is currently set, so changing the
  // number via the VAPI dashboard is a one-step operation that
  // survives code re-pushes.
  {
    type: "transferCall",
    destinations: [
      {
        type: "number",
        number: `+1${BUSINESS.phone.raw}`, // PLACEHOLDER fallback · main shop +12168620005 · live value owned by VAPI dashboard
        // 2026-05-08 wave-92 · message is context-neutral. Earlier version
        // assumed tire context ("...physically check the rack...") which
        // leaked into transfers requested for non-tire reasons. The pre-
        // transfer message should work for ANY reason a caller is being
        // forwarded. The caller's actual reason gets handled by the human
        // who picks up — Nick doesn't need to summarize it.
        message: "Hold on, I'll get you over to the manager.",
        description: "Forward the live call to a human. Use whenever the caller asks to be transferred / wants a manager / wants to talk to a person, OR for: used tire availability checks, vehicle already at the shop, manager/owner requests, upset customers, complex repair questions, language barriers. NEVER assume the topic of the transfer — just transfer.",
      },
    ],
  },
  // PRIMARY: tire flow
  {
    type: "function",
    function: {
      name: "tireSizeFromVehicle",
      description: "Get common stock tire sizes for a vehicle. CALL THIS as soon as the customer mentions a vehicle while asking about tires. Returns the OEM stock sizes so you can quote a real size without making the customer go look at their door jamb.",
      parameters: {
        type: "object",
        properties: {
          year: { type: "number", description: "Model year (e.g. 2017)." },
          make: { type: "string", description: "Make (e.g. 'Honda', 'Ford', 'Toyota')." },
          model: { type: "string", description: "Model (e.g. 'Civic', 'F-150', 'Camry'). Provide if known." },
        },
        required: ["make"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tireInquiry",
      description: "Capture a tire inquiry as a warm lead. Call this when a customer asks about tires but isn't ready to book yet — gives the shop a chance to follow up.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Customer name." },
          phone: { type: "string", description: "Phone number." },
          tireSize: { type: "string", description: "Tire size like '215/55R16' if customer gave one." },
          vehicle: { type: "string", description: "Year + make + model if known." },
          newOrUsed: { type: "string", enum: ["new", "used", "either"], description: "What they want. Default 'either'." },
          installationNeeded: { type: "boolean", description: "True if they want install (most common). False if they bring just the tire." },
        },
        required: ["name", "phone"],
      },
    },
  },
  // SHOP DATA
  {
    type: "function",
    function: {
      name: "shopInfo",
      description: "Hours, address, financing options, languages. Call for 'when are you open?' / 'where are you?' / 'do you take Acima?' questions.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "capacityCheck",
      description: "Check current shop load — same-day only. Use ONLY when the caller asks 'how busy are you right now?' or 'can I come right now?'. The shop is FCFS, so future days don't have a schedule to check — just tell those callers walk-ins are welcome any open day. NEVER call this for tomorrow or any future date.",
      parameters: {
        type: "object",
        properties: {
          day: { type: "string", description: "Date as YYYY-MM-DD or 'today'/'tomorrow'." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "quoteRange",
      description: "Get a price RANGE for non-tire services (brakes, oil change, diagnostic, etc.). NEVER quote exact $. Always say 'ranges from $X to $Y'.",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string", description: "Service the customer needs (brakes, oil change, check engine, AC, etc.)." },
          vehicleYear: { type: "number", description: "Year if known." },
          vehicleMake: { type: "string", description: "Make if known." },
        },
        required: ["service"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bookSlot",
      description: "Book a real appointment. Call ONLY after customer has given name + phone + agreed to a specific window.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Customer first + last name." },
          phone: { type: "string", description: "Phone number." },
          vehicle: { type: "string", description: "Year/make/model if available." },
          service: { type: "string", description: "What they're coming in for." },
          preferredDay: { type: "string", description: "YYYY-MM-DD or 'today'/'tomorrow'." },
        },
        required: ["name", "phone", "service"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate",
      description: "Route to a human callback. Use for: customer asks for manager/Nick by name, customer is frustrated, AI is confused, off-scope questions. urgency=high pings Nick immediately.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Customer name." },
          phone: { type: "string", description: "Phone number to call back." },
          reason: { type: "string", description: "1-sentence reason for escalation." },
          urgency: { type: "string", enum: ["low", "medium", "high"], description: "high=call ASAP, low=whenever possible." },
        },
        required: ["name", "phone", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "sendConfirmationSms",
      description: "Send recap SMS. ALWAYS call before saying goodbye when you have a phone number. Returns { sent, degraded, verbalRecap }. If degraded:true (texts temporarily disabled), read the verbalRecap field aloud and DO NOT promise a text — say the address verbally instead.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "Phone number to text." },
          summary: { type: "string", description: "1-2 sentence recap of what was agreed." },
          mapLink: { type: "string", description: "Optional Google Maps link." },
        },
        required: ["phone", "summary"],
      },
    },
  },
];

// ─── ANALYSIS PLAN — extract structured data per call ────
// Vapi returns these fields in the end-of-call-report webhook so we
// can store call outcomes without parsing transcripts manually.

const ANALYSIS_PLAN = {
  summaryPlan: {
    enabled: true,
    timeoutSeconds: 30,
    messages: [
      {
        role: "system" as const,
        content: "You are a call analyst. Summarize this Nick's Tire & Auto receptionist call in 2-3 sentences: what the customer wanted, what was agreed, what action is needed. Be concrete — include specifics like tire size, vehicle, booked day. No filler.",
      },
      { role: "user" as const, content: "Here is the transcript:\n{{transcript}}" },
    ],
  },
  successEvaluationPlan: {
    enabled: true,
    timeoutSeconds: 30,
    rubric: "PassFail" as const,
    messages: [
      {
        role: "system" as const,
        content: "Evaluate whether this Nick's Tire & Auto call was successful. PASS = customer's question was answered AND (a) booking was made, OR (b) callback was scheduled, OR (c) customer left with the info they needed. FAIL = customer hung up unsatisfied, AI made things up, AI failed to capture name/phone, or customer asked for human and didn't get one.",
      },
      { role: "user" as const, content: "Transcript:\n{{transcript}}" },
    ],
  },
  structuredDataPlan: {
    enabled: true,
    timeoutSeconds: 30,
    schema: {
      type: "object" as const,
      properties: {
        callType: {
          type: "string" as const,
          enum: ["tire_inquiry", "repair_question", "booking", "callback", "info_only", "complaint", "voicemail", "wrong_number", "other"],
          description: "Primary intent of the call.",
        },
        customerName: { type: "string" as const, description: "Customer name if given." },
        customerPhone: { type: "string" as const, description: "Phone number if captured." },
        vehicle: { type: "string" as const, description: "Year/make/model if mentioned." },
        tireSize: { type: "string" as const, description: "Tire size like '215/55R16' if mentioned." },
        serviceMentioned: { type: "string" as const, description: "Service or part discussed (brakes, oil, used tires, etc.)." },
        bookedDay: { type: "string" as const, description: "Day they agreed to come in, if any." },
        sentiment: {
          type: "string" as const,
          enum: ["positive", "neutral", "negative"],
          description: "Customer mood during the call.",
        },
        outcome: {
          type: "string" as const,
          enum: ["booked", "callback_scheduled", "info_given", "escalated", "lost", "no_phone", "voicemail"],
          description: "What happened by end of call.",
        },
        followUpNeeded: { type: "boolean" as const, description: "Does Nick need to call this person back?" },
      },
      required: ["callType", "outcome"],
    },
    messages: [
      {
        role: "system" as const,
        content: "Extract structured data from this call. If a field is unknown, omit it. Don't guess.",
      },
      { role: "user" as const, content: "Transcript:\n{{transcript}}" },
    ],
  },
};

// ─── ASSISTANT CONFIG (the optimal one) ──────────────────

interface VapiAssistantConfig {
  name: string;
  firstMessage: string;
  // Transcriber — Deepgram nova-2-phonecall is call-tuned for low latency
  // and handles tire-size strings ("two fifteen sixty-five sixteen") and
  // auto-shop jargon better than the default.
  transcriber: {
    provider: "deepgram";
    model: "nova-2-phonecall";
    language: "en";
    smartFormat: true;
    keywords: string[]; // boosts recognition probability for these terms
  };
  voice: {
    provider: "11labs";
    voiceId: string;
    model: "eleven_turbo_v2_5";
    stability: number;
    similarityBoost: number;
    style: number;
    useSpeakerBoost: boolean;
    optimizeStreamingLatency: number;
    enableSsmlParsing: boolean;
  };
  model: {
    provider: "openai";
    model: "gpt-4o";
    messages: Array<{ role: "system"; content: string }>;
    tools: VapiToolDef[];
    temperature: number;
    maxTokens: number;
    emotionRecognitionEnabled: boolean;
  };
  serverUrl?: string;
  serverMessages: string[];
  clientMessages: string[];
  endCallFunctionEnabled: boolean;
  endCallPhrases: string[];
  hipaaEnabled: boolean;
  silenceTimeoutSeconds: number;
  responseDelaySeconds: number;
  llmRequestDelaySeconds: number;
  numWordsToInterruptAssistant: number;
  maxDurationSeconds: number;
  backgroundSound: "office" | "off";
  backgroundDenoisingEnabled: boolean;
  modelOutputInMessagesEnabled: boolean;
  voicemailDetection: {
    provider: "twilio";
    voicemailDetectionTypes: string[];
    enabled: boolean;
    machineDetectionTimeout: number;
  };
  voicemailMessage: string;
  analysisPlan: typeof ANALYSIS_PLAN;
  artifactPlan: {
    recordingEnabled: boolean;
    videoRecordingEnabled: boolean;
    transcriptPlan: { enabled: boolean };
  };
  startSpeakingPlan: {
    waitSeconds: number;
    smartEndpointingEnabled: boolean;
    transcriptionEndpointingPlan: {
      onPunctuationSeconds: number;
      onNoPunctuationSeconds: number;
      onNumberSeconds: number;
    };
  };
  stopSpeakingPlan: {
    numWords: number;
    voiceSeconds: number;
    backoffSeconds: number;
  };
  metadata?: Record<string, string>;
}

// Keywords boost transcriber accuracy on shop-specific terms.
// Deepgram lets us pre-prime the model with high-priority words.
// VAPI's transcriber spec only allows 'word' or 'word:boost' format —
// no slashes, no hyphens. So tire sizes ("215/55R16") and hyphenated
// model names ("F-150", "CR-V") are flattened to plain words.
const TRANSCRIBER_KEYWORDS = [
  "tire", "tires",
  "Goodyear", "Michelin", "Bridgestone", "Continental", "Cooper", "Hankook",
  "brake", "rotor", "pad",
  "alignment", "balance",
  "TPMS",
  "F150", "Silverado", "Camry", "Accord", "Civic", "RAV4", "CRV", "Escape",
  "Acima", "Snap", "Koalafi",
  "Euclid", "Cleveland",
];

function buildAssistantConfig(serverUrl?: string): VapiAssistantConfig {
  return {
    name: "Nick's Tire & Auto Receptionist",
    firstMessage: FIRST_MESSAGE,

    // ─── Speech-to-Text ─────────────────────────────────
    transcriber: {
      provider: "deepgram",
      model: "nova-2-phonecall",
      language: "en",
      smartFormat: true,
      keywords: TRANSCRIBER_KEYWORDS,
    },

    // ─── Voice (Text-to-Speech) ─────────────────────────
    voice: {
      provider: "11labs",
      voiceId: "pNInz6obpgDQGcFmaJgB", // Adam — warm neutral US accent
      model: "eleven_turbo_v2_5", // Lower-latency model
      stability: 0.55, // 0-1; lower = more expressive variance
      similarityBoost: 0.78, // Stick close to original Adam timbre
      style: 0.20, // Add a touch of natural style/emotion
      useSpeakerBoost: true,
      optimizeStreamingLatency: 3, // 0-4; 3 is best for phone latency
      enableSsmlParsing: true, // Allows <break/> + emphasis tags
    },

    // ─── LLM brain ──────────────────────────────────────
    model: {
      provider: "openai",
      model: "gpt-4o", // Smarter on tool calls + size matching than -mini
      messages: [{ role: "system", content: ASSISTANT_SYSTEM_PROMPT }],
      tools: VAPI_TOOLS,
      temperature: 0.4, // Lower than default 0.7 → more deterministic
      maxTokens: 250, // Force concise responses (phone calls = short)
      emotionRecognitionEnabled: true, // Detect sentiment for escalation
    },

    // ─── Webhooks ───────────────────────────────────────
    serverUrl,
    serverMessages: [
      "function-call",
      "tool-calls",
      "end-of-call-report",
      "status-update",
      "transfer-update",
      "user-interrupted",
      "speech-update",
    ],
    clientMessages: [
      "transcript",
      "tool-calls",
      "user-interrupted",
      "voice-input",
    ],

    // ─── End-call control ───────────────────────────────
    endCallFunctionEnabled: true,
    endCallPhrases: END_CALL_PHRASES,

    hipaaEnabled: false,

    // ─── Timeouts (shorter = faster, but risk premature responses) ──
    silenceTimeoutSeconds: 15, // Down from 20 — phone calls expect <15s gaps
    responseDelaySeconds: 0.25, // Down from 0.4 — snappier feel
    llmRequestDelaySeconds: 0.05, // Tiny buffer before LLM call
    numWordsToInterruptAssistant: 3, // Higher = AI doesn't get cut off mid-sentence
    maxDurationSeconds: 600, // 10 minute hard cap

    // ─── Audio environment ──────────────────────────────
    backgroundSound: "office", // Subtle ambient — feels real, not call-center silent
    backgroundDenoisingEnabled: true, // Clean inbound audio for the LLM
    modelOutputInMessagesEnabled: true,

    // ─── Voicemail detection ────────────────────────────
    voicemailDetection: {
      provider: "twilio",
      voicemailDetectionTypes: ["machine_end_beep", "machine_end_silence", "machine_end_other"],
      enabled: true,
      machineDetectionTimeout: 30,
    },
    voicemailMessage: VOICEMAIL_MESSAGE,

    // ─── Per-call analysis (auto-extracts structured data) ──
    analysisPlan: ANALYSIS_PLAN,

    // ─── Recording + artifacts ──────────────────────────
    artifactPlan: {
      recordingEnabled: true, // Audio recording for review
      videoRecordingEnabled: false,
      transcriptPlan: { enabled: true }, // Full transcript stored
    },

    // ─── Speech timing ──────────────────────────────────
    startSpeakingPlan: {
      waitSeconds: 0.4, // Wait this long after user stops before responding
      smartEndpointingEnabled: true, // Use ML to detect end-of-utterance
      transcriptionEndpointingPlan: {
        // Different delay rules based on what user just said
        onPunctuationSeconds: 0.1, // "." or "?" — they're done, respond fast
        onNoPunctuationSeconds: 1.5, // No punctuation — wait, they may continue
        onNumberSeconds: 0.5, // After a number ("215") — they may still be reading
      },
    },
    stopSpeakingPlan: {
      numWords: 2, // Customer said 2+ words = interrupt me
      voiceSeconds: 0.2, // Customer's voice for 200ms = interrupt me
      backoffSeconds: 1, // After interruption, wait this long before resuming
    },

    metadata: {
      shop: "nicks-tire-auto",
      version: "v2.0-tire-first",
      deployedAt: new Date().toISOString(),
    },
  };
}

// ─── API CLIENT ──────────────────────────────────────────

async function vapiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) throw new Error("VAPI_API_KEY not configured");
  return fetch(`${VAPI_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers || {}),
    },
  });
}

// ─── PUBLIC API ──────────────────────────────────────────

export async function getVapiStatus(): Promise<{
  connected: boolean;
  assistantCount: number;
  assistants: Array<{ id: string; name: string; createdAt: string }>;
  error?: string;
}> {
  try {
    if (!process.env.VAPI_API_KEY) {
      return { connected: false, assistantCount: 0, assistants: [], error: "VAPI_API_KEY not set" };
    }
    const res = await vapiFetch("/assistant");
    if (!res.ok) {
      return {
        connected: false,
        assistantCount: 0,
        assistants: [],
        error: `Vapi API ${res.status}: ${(await res.text()).slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as Array<{ id: string; name: string; createdAt: string }>;
    return {
      connected: true,
      assistantCount: data.length,
      assistants: data.slice(0, 10),
    };
  } catch (err) {
    return {
      connected: false,
      assistantCount: 0,
      assistants: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function createProductionAssistant(serverUrl?: string): Promise<{
  success: boolean;
  assistantId?: string;
  config?: VapiAssistantConfig;
  error?: string;
}> {
  try {
    const config = buildAssistantConfig(serverUrl);
    const res = await vapiFetch("/assistant", {
      method: "POST",
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const text = await res.text();
      log.error("Vapi assistant create failed", { status: res.status, body: text.slice(0, 500) });
      return { success: false, error: `${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as { id: string };
    log.info("Created Vapi assistant", { id: data.id });
    return { success: true, assistantId: data.id, config };
  } catch (err) {
    log.error("Vapi create threw", { err: err instanceof Error ? err.message : String(err) });
    return { success: false, error: err instanceof Error ? err.message : "Create failed" };
  }
}

export async function updateAssistant(assistantId: string, serverUrl?: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const config = buildAssistantConfig(serverUrl);
    const res = await vapiFetch(`/assistant/${assistantId}`, {
      method: "PATCH",
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const text = await res.text();
      log.error("Vapi assistant update failed", { status: res.status, body: text.slice(0, 500) });
      return { success: false, error: `${res.status}: ${text.slice(0, 200)}` };
    }
    log.info("Updated Vapi assistant", { id: assistantId });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Update failed" };
  }
}

export async function getRecentCalls(limit = 20): Promise<{
  success: boolean;
  calls: Array<{
    id: string;
    startedAt?: string;
    endedAt?: string;
    durationSeconds?: number;
    customerNumber?: string;
    endedReason?: string;
    cost?: number;
    summary?: string;
    structuredData?: Record<string, unknown>;
    successEvaluation?: string;
  }>;
  error?: string;
}> {
  try {
    const res = await vapiFetch(`/call?limit=${limit}`);
    if (!res.ok) {
      return { success: false, calls: [], error: `${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    const data = (await res.json()) as Array<Record<string, unknown>>;
    const calls = data.map((c) => {
      const analysis = c.analysis as Record<string, unknown> | undefined;
      return {
        id: String(c.id || ""),
        startedAt: c.startedAt as string | undefined,
        endedAt: c.endedAt as string | undefined,
        durationSeconds: typeof c.duration === "number" ? c.duration : undefined,
        customerNumber: ((c.customer as Record<string, unknown>)?.number as string) || undefined,
        endedReason: c.endedReason as string | undefined,
        cost: typeof c.cost === "number" ? c.cost : undefined,
        summary: (analysis?.summary as string) || (c.summary as string),
        structuredData: analysis?.structuredData as Record<string, unknown> | undefined,
        successEvaluation: analysis?.successEvaluation as string | undefined,
      };
    });
    return { success: true, calls };
  } catch (err) {
    return { success: false, calls: [], error: err instanceof Error ? err.message : "Fetch failed" };
  }
}

export { ASSISTANT_SYSTEM_PROMPT, FIRST_MESSAGE, VAPI_TOOLS, buildAssistantConfig };
