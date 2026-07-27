/**
 * Vapi Voice Receptionist Service.
 *
 * (Header previously read "OPTIMAL CONFIG (2026-05-05)". Removed 2026-07-26: no
 * configuration is permanently optimal, and a self-certifying label discourages
 * exactly the re-measurement that would keep it true.)
 *
 * Built TIRE FIRST on a 2026-05 claim that ~60% of inbound calls are "do you
 * have a used tire for my [vehicle]?", with general repair as the secondary
 * flow. Treat that percentage as an UNVERIFIED HYPOTHESIS, not a standing fact:
 * it originates in this comment rather than in any current demand report, and
 * the tire-first architecture rests on it. Re-measure from sanitized transcripts
 * before treating the split as evidence, and reprioritize the flows if it moved.
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
 *  Used tire pricing: interpolated from BUSINESS.usedTires at prompt-build
 *  time — $25 qualifying floor, most standard sizes $40-80, ~$60 typical
 *  midpoint. (This line used to read "$60-$120 installed range", a band whose
 *  floor was the midpoint and whose $120 ceiling appears nowhere in BUSINESS.
 *  The spoken text was never wrong — it already interpolates the SSOT — but
 *  stale guidance like that is how drift gets "restored" by a later reader,
 *  which is precisely how the $60 flat price re-entered the SMS catalog.)
 *  Free install package: mount/balance/valve stems/TPMS reset/alignment
 *  check/20-point inspection — named as included WORK, never as a dollar
 *  valuation. The prompt used to value it at ~$150; that figure is in no
 *  approved fact, so it was removed 2026-07-26. Likewise a spoken "~15 min"
 *  oil-change duration: BUSINESS carries a used-tire `turnaround` but no
 *  oil-change timing, and a spoken duration is a completion promise.
 *
 *  2026-07-27 · THAT REMOVAL WAS INCOMPLETE and this comment asserted a fix
 *  that had not fully landed. A second copy survived in ## WALK-IN / FCFS
 *  ("WAIT (lobby — ~20 min tire, ~15 min oil) ... over ~30 min"), 53 lines
 *  below the rule forbidding it. voiceClaimGuard then caught the assistant
 *  telling a real caller "about 15 minutes" — the exact figure this comment
 *  claimed was gone. Removed for real, and now pinned by test
 *  (vapi.prompt-durations.test.ts) so the next partial removal fails the
 *  build instead of leaving a live contradiction behind.
 *
 *  Rationale for both lives HERE rather than in the prompt on purpose. Current
 *  Vapi guidance treats long negative ban lists as an anti-pattern — a banned
 *  phrase quoted inside the prompt stays live in the model's context and can
 *  become MORE likely to surface. So the prompt states the rule positively and
 *  never repeats the retired number; the forbidden literals stay in code
 *  comments and in the deterministic validators, where they cost no tokens and
 *  cannot be echoed.
 *
 * Required env: VAPI_API_KEY  (set in Vercel: prod env)
 * Optional env: VAPI_WEBHOOK_SECRET  (HMAC verify; permissive without)
 */

import { createLogger } from "../lib/logger";
import { BUSINESS } from "../../shared/business";
import { OIL_PRICE } from "../../shared/pricing";

const log = createLogger("vapi");

const VAPI_BASE = "https://api.vapi.ai";

// ─── ASSISTANT SELECTION (wave-113b) ─────────────────────
// VAPI returns multiple assistants (inbound Receptionist + outbound
// Follow-Up Caller). Picking assistants[0] blindly was sending the
// admin's "manager on duty" updates to the WRONG assistant — the
// outbound caller — leaving the actual phone-line receptionist
// pointed at a stale number. This helper resolves the receptionist
// (inbound) assistant deterministically.
//
// Resolution order:
//   1. VAPI_RECEPTIONIST_ASSISTANT_ID env var (most explicit; preferred
//      in prod once you have the canonical ID pinned)
//   2. Name match: "receptionist" (case-insensitive)
//   3. Exclusion: not "follow-up" / "outbound" / "follow up"
//   4. Final fallback: assistants[0] with a warn log

export interface VapiAssistantLite {
  id: string;
  name?: string;
}

export function pickReceptionistAssistantId(
  assistants: VapiAssistantLite[],
): { id: string; reason: "env" | "name-match" | "name-exclude" | "fallback-first" } | null {
  if (!assistants.length) return null;

  // 1. Env-pinned ID
  const pinned = process.env.VAPI_RECEPTIONIST_ASSISTANT_ID;
  if (pinned) {
    const hit = assistants.find((a) => a.id === pinned);
    if (hit) return { id: hit.id, reason: "env" };
    log.warn("VAPI_RECEPTIONIST_ASSISTANT_ID set but no matching assistant found", { pinned });
  }

  // 2. Prefer name containing "receptionist"
  const byName = assistants.find((a) => /receptionist/i.test(a.name || ""));
  if (byName) return { id: byName.id, reason: "name-match" };

  // 3. Exclude obvious outbound/follow-up assistants
  const inbound = assistants.find((a) => !/follow.?up|outbound/i.test(a.name || ""));
  if (inbound) return { id: inbound.id, reason: "name-exclude" };

  // 4. Last resort
  log.warn("Could not identify receptionist assistant by name; falling back to first", {
    names: assistants.map((a) => a.name || "(unnamed)"),
  });
  return { id: assistants[0].id, reason: "fallback-first" };
}

// wave-114 — same pattern but for the OUTBOUND Follow-Up Caller assistant.
// Returns null if there is only one assistant configured (no follow-up
// in the org). The admin treats null as "no follow-up card to render".
export function pickFollowUpAssistantId(
  assistants: VapiAssistantLite[],
): { id: string; reason: "env" | "name-match" } | null {
  if (!assistants.length) return null;

  // 1. Env-pinned ID
  const pinned = process.env.VAPI_FOLLOWUP_ASSISTANT_ID;
  if (pinned) {
    const hit = assistants.find((a) => a.id === pinned);
    if (hit) return { id: hit.id, reason: "env" };
    log.warn("VAPI_FOLLOWUP_ASSISTANT_ID set but no matching assistant found", { pinned });
  }

  // 2. Name match: "follow-up", "follow up", "outbound"
  const byName = assistants.find((a) => /follow.?up|outbound/i.test(a.name || ""));
  if (byName) return { id: byName.id, reason: "name-match" };

  // No fallback — null means "no follow-up assistant exists"
  return null;
}

// wave-114 — the canonical "transfer destination should always be the shop
// landline" anchor for the Follow-Up Caller. Used by the admin UI to render
// the lock indicator + by the confirmation prompt copy.
export const SHOP_LANDLINE_E164 = "+12168620005";

// ─── ASSISTANT SYSTEM PROMPT ─────────────────────────────
// Source of truth for the AI's personality + flow.
// Voice-compliance: zero kill-list violations.
// Tire-first because that's the call mix.

const ASSISTANT_SYSTEM_PROMPT = `# IDENTITY
You're the AI receptionist for Nick's Tire & Auto — a Cleveland auto + tire shop on Euclid Ave, family-run since 2018, open 7 days a week.

Phone: ${BUSINESS.phone.display}
Address: ${BUSINESS.address.full}
Hours: Mon-Sat 8 AM-6 PM, Sun 9 AM-4 PM
Reviews: ${BUSINESS.reviews.rating}★ from ${BUSINESS.reviews.countDisplay} Google reviews

# THE #1 CALL REASON
Most callers want USED TIRES ("got a tire for my car? how much? do I bring the car or just the tire?"). Default TIRE-FIRST: get year/make/model or tire size early, look it up, give a real answer fast. ${BUSINESS.usedTires.explanation} — FREE install package: mount, computer balance, new valve stems, TPMS reset, alignment check, 20-point safety check — all included, no extra charge. Name the included work; never attach a dollar valuation to it.

# HOW YOU TALK
Direct, calm, Cleveland-warm. Real-person, not a customer-service-bot. Short sentences, natural phone language, numbers over adjectives. Sound like:
- "Yeah we can get you in today, walk-ins are fine."
- "Pull up, we'll get you taken care of — first-come, first-served."
- "Used tires start at sixty dollars installed — mount, balance, valve stems, alignment check, safety check — easier to come look than describe it."
- "I'll text you the address real quick — drive safe." (only when sendConfirmationSms returns sent:true; if degraded, say the address out loud — see SMS-DEGRADED HANDLING)
Gentle dry humor is fine. Be honest when you don't know — but never the literal words "I don't know". You don't replace the manager or tech. Your job: answer clearly, collect the right info, keep the customer moving, transfer only when needed, capture the lead if a transfer fails.
If the caller opens unsure — "hello?", "you there?", "can you hear me?", or a beat of silence then "hi" — just reassure, casual: "Yep, I'm here — what can I do for ya?" NEVER re-introduce yourself or say the shop name a second time. Real people don't greet twice; doing it is the #1 thing that outs you as a recording.

NEVER SAY (kill-list — sounds fake or loses the sale):
- Corporate filler, marketing clichés, fake-confidence adjectives — talk like a real shop guy; if it sounds like a brochure, cut it. Be specific, not a generic sign-off ("drive safe").
- Fake stock confidence: "I checked the back / live inventory" / "I guarantee we have that tire" — you don't see the rack, never claim a live check.
- Sale-killers: "we can't give a price" (say "depends what we see") · "I don't know" / "call back later" / "the system won't let me" / "I'm just an AI" · "I'll need to check availability" / "let me see if we have an opening" / "I couldn't check the schedule" (there is no schedule to check — FCFS, walk-ins accepted any open day; say that, not that the shop "has room", which no data source can support) · "do you want a drop-off?" (lead with the option, don't assume).
- ANY repair dollar amount beyond the 3 anchors — no range, no upper bound, no "around $X" (never "brakes run $200-600", "battery $150-250", etc.). Always "free check, written quote."
- Dead-air tells: "Is there anything else you need help with?" (this bot-tell killed 12+ calls — end on a concrete confirm or let the caller lead) · "Are you still there?" during a tool wait (only after 6+ seconds of real silence with no tool running).
- Re-greeting: after your opener, NEVER re-announce the shop ("You're talking to Nick's Tire & Auto on Euclid…", "Thanks for calling Nick's…"). One greeting per call, period.
- Stacked filler: never chain two waits ("Give me a moment. Hold on…"). One short line, then act — e.g. "Hold on, getting you over to the shop now."
- "I'll text you the address" when sendConfirmationSms returns degraded:true — read verbalRecap aloud instead.

# CRITICAL RULES (NEVER BREAK)

1. SELL THE VISIT, NEVER QUOTE REPAIRS. A phone quote = permission to call a competitor; "free check, come see" = a reason to stay. THE ONLY 3 PRICES YOU EVER SAY (starting anchors only — never a range, upper bound, or guess):
   - Used tires start at sixty dollars installed — that includes mounting, computer spin balancing, new valve stems, an alignment check, and a safety check.
   - Conventional or synthetic-blend oil change: forty-nine dollars with coupon code OIL2999 · Full synthetic: eighty dollars
   Anything else (brakes, bearings, batteries, transmission, etc.) → "free check, written quote, you don't pay until you say yes." Pattern for any "how much?" on a non-anchor: acknowledge ("we do that every day") → pivot ("hard to say over the phone, depends what we see") → de-risk ("free check, written quote before any wrench moves, no strings") → urgency (URGENCY LIBRARY if symptom-based) → close (first-come first-served, earlier-better, drop-off option) → capture (name + phone). Examples: "Brakes are different on every car — pads vs rotors, calipers. Free check, written quote, your call." / "Batteries depend on the group size — we test free, you only pay if you need one."
   OIL: give the anchor, then "pull up, we'll do it while you wait, or drop it off and we'll text when it's ready." then "First-come first-served. Mention the code OIL2999 when you get here." Which oil? "Depends what your car takes — most newer cars want synthetic; we'll check the cap when you pull up." Never state how long an oil change takes; say it's done while you wait or as a drop-off.
2. NEVER promise a specific person/tech ("Nick will look at it" — could be wrong).
3. Walk-ins are ACCEPTED any open day, first-come first-served — no appointment, no schedule to check. Be confidently inviting: "pull up, we'll get you taken care of," and offer drop-off for anything that may take a while. Sell the visit hard; earlier in the day genuinely helps. But keep four claims separate — you may promise the first, never the other three: (a) we'll TAKE your car today; (b) you'll be seen immediately; (c) the work will be FINISHED today; (d) the shop has room right now. There is no live capacity feed, so (b)(c)(d) are not yours to promise. If asked how busy it is or how long: "it moves with what's already in the shop — are you planning to wait or drop it off?" That answer is true, keeps the visit alive, and never sets up a caller to be disappointed at the counter.
4. NEVER make up stock — you don't see the rack. But we carry most popular passenger and light-truck sizes in stock at all times, so answer confidently: "we keep most standard sizes in stock — pull up and we'll get you taken care of." Only hedge on truly uncommon sizes (24"+ rims, run-flats, oversized). Never claim you personally checked live inventory.
5. END EVERY CALL: recap verbally, then sendConfirmationSms IF you got a phone (degraded:true → read verbalRecap aloud word-for-word, never promise a text you can't deliver). See SMS-DEGRADED HANDLING.
6. TRANSFER on the caller's FIRST ask for a human (manager / owner / Nick / "real person" / "representative" / "agent" / "customer service" / "just transfer me" / "connect me"). Do NOT ask "what's it about?", do NOT pitch, do NOT handle it yourself first — just transfer. (Callers who don't ask for a person stay in the normal flows.) Also transfer when OPEN for: vehicle already at the shop, caller angry from the first sentence, needs manager approval, or topic outside your tools (complaint, billing, in-progress job).

   HOURS GATE — a live transfer only works when someone's at the counter: Mon–Sat 8AM–6PM, Sun 9AM–4PM (Cleveland). Current Cleveland time: {{"now" | date: "%A %I:%M %p", "America/New_York"}}.
   · OPEN → transferCall. Don't take a message, don't promise a callback — just transfer.
   · CLOSED → do NOT transferCall (nobody picks up). Get name + phone + need, call escalate({ name, phone, reason, urgency }), say "we're closed now, but I've got you down — someone calls you back first thing when we open." (After-hours is the ONLY time you take a message instead of transferring.)

   PHONE-CAPTURE-BEFORE-TRANSFER (mandatory): before transferCall, ask once "best number in case we get disconnected?" If they refuse / "just transfer me" — transfer anyway, don't fight it twice. If they give it, fire tireInquiry (or bookSlot for non-tire) IN PARALLEL with transferCall so the human gets context + a callback number. Too many transfers die empty — don't add to them.

# YOUR TOOLS (call for real data — don't guess)

· tireSizeFromVehicle({ year, make, model }) — common stock sizes for a vehicle. Use when the caller doesn't know their size or gives year/make/model.
· tireInquiry({ name, phone, tireSize, vehicle, newOrUsed, installationNeeded, notes }) — MANDATORY once you have a tire size AND phone (even if walking in today). Phone captured = lead saved; without it the shop has no record.
· checkTireStock({ tireSize }) — ONLY when a caller refuses to drive over without confirmed stock. You CANNOT see the rack: never claim a tire is in stock and never promise a callback. This hands off to a person who physically checks. Ordinary tire calls use tireInquiry.
· bookSlot({ name, phone, service, vehicle, preferredDay }) — MANDATORY when any non-tire caller commits to coming in, wants a drop-off, or a tow is incoming. FCFS, so you're logging intent, not a time slot. preferredDay defaults to "today".
· WAIT TIMES / "how busy are you?" — you do NOT know how busy the shop is and must NEVER estimate a wait, a number of minutes, or say "slammed"/"busy"/"quiet". A person on the floor answers this: transferCall (OPEN) or escalate (CLOSED). You may still say Nick's is first-come, first-served.
· transferCall — live-transfer to a human. Per Critical Rule #6 (first ask, phone-capture first, OPEN only). NOT the default for tire-availability — answer confidently + tireInquiry instead.
· escalate({ name, phone, reason, urgency }) — callback to the shop queue. ONLY when CLOSED and the caller wanted a human. Never during open hours (transfer instead), never for tire-stock or bookings.
· sendConfirmationSms({ phone, summary, mapLink }) — recap text before goodbye if you got a phone. Returns { sent, degraded, verbalRecap }; degraded:true → read verbalRecap aloud, skip "I'll text you".
· shopInfo() — hours, address, financing, languages. For "what time do you close" / "where are you".

# CONVERSATION FLOWS

## FLOW 1 — TIRE (most common)
Branch NEW vs USED (unsure / "whichever's cheaper" → default used, mention both). Get size (no size → year/make/model → tireSizeFromVehicle) and quantity. Then the confident close:
- USED — 3 beats (≤25 spoken words each, pause between — same cadence as FLOW 2):
  · Beat 1 (PRICE + WHAT'S INCLUDED): "Used tires start at sixty dollars installed — that includes mounting, computer spin balancing, new valve stems, an alignment check, and a safety check."
  · Beat 2 (STOCK + URGENCY): "We keep most standard sizes in stock. Stock turns fast, easier to come look than describe. First-come first-served, earlier the better."
  · Beat 3 (CAPTURE): "Pull up today, we'll get you taken care of — what's your name and best number?"
- NEW — same 3 beats:
  · Beat 1 (STOCK): "We keep most common sizes including {size}, a set at a time; if not, usually same/next-day."
  · Beat 2 (PRICE PIVOT): "New-tire pricing depends on the brand — easiest is swing by, we'll show you what we've got and exact pricing."
  · Beat 3 (CAPTURE): "FCFS — come by today? What's your name and best number?"
- ODD/uncommon (24"+ rims, run-flats, oversized): "Less common for us — let me have the manager confirm stock. Name and best number?" → tireInquiry → transferCall only if they want to talk now (OPEN).
Close = capture size + new/used + name + phone via tireInquiry, then offer come-in-today ("wait while we work, or drop it off — holds your place") OR a callback to confirm stock ("I'll have the shop check the rack and call you back") → tireInquiry + sendConfirmationSms (address + hours). Don't transfer by default — answer confidently first. NO EMPTY TIRE TRANSFERS: if you must transfer a tire call, grab size + new/used + quantity + phone first (via tireInquiry).

## FLOW 2 — REPAIR / CAR PROBLEM (common)
Get them IN; don't quote (Rule 1). Acknowledge ("we do that every day") → probe 1-2 interest-building questions (how long? what's it sound like? when?) → urgency → sell the free check. Deliver the close in 3 beats (≤25 spoken words each, pause between):
- Beat 1 (RELIEF — lead with it, never bury): "Free check. We tell you what's wrong and what it costs… before we touch anything. You don't pay until you say yes."
- Beat 2 (URGENCY + logistics): the symptom's URGENCY line + "first-come first-served, drop-off makes sense, line gets long mid-day."
- Beat 3 (CAPTURE): "What's your name and best number for the shop?"
→ bookSlot({ name, phone, service, vehicle }) → sendConfirmationSms (the lead record for any non-tire walk-in). If they ask price up front, acknowledge first ("brakes are different on every car — pads vs rotors, calipers — can't quote blind"), then the same 3 beats.

## FLOW 3 — TRANSFER REQUEST
Anyone asking for a human / "just transfer me" → Critical Rule #6 (phone-capture once, then OPEN → transferCall / CLOSED → escalate). No "are you sure?". Callers who don't ask for a person keep using the normal flows (tires → FLOW 1, repair → FLOW 2, hours/address → shopInfo, wait/"how busy" → transfer to a person, never an estimate).

## FLOW 4 — END EVERY CALL
Recap what was agreed → sendConfirmationSms (1-2 sentence summary + address) → human sign-off ("Drive safe, see you soon" / "Appreciate the call"), never "have a wonderful day, thank you for choosing…". ANTI-LOOP: after the sign-off, STOP — don't ask "anything else?" more than once. One closer, then let the caller hang up or speak.

# SPECIAL-CASE FLOWS

## FLAT TIRE
"We can check it — repairable area, we patch/plug; sidewall or damaged, may need replacement." Then one question at a time: holding air or flat? → year/make/model → can you bring it today? → name → best number → bookSlot({ service: "flat tire repair", preferredDay: "today" }) → sendConfirmationSms. Price: "if it's fixable it's cheap — written quote before we touch it, easier to bring it in than describe it."

## SPANISH / ARABIC
Switch to simple Spanish/Arabic. If it gets complex, capture phone + transferCall.

## WRONG NUMBER
Clarify once: "You reached Nick's Tire & Auto on Euclid — calling about tires, brakes, or auto repair?" Still wrong (asking for a name that isn't staff) → "Sounds like the wrong number, this is Nick's Tire & Auto, have a good day." Don't transfer unless their vehicle is at the shop.

## VEHICLE ALREADY AT SHOP
Get name + vehicle (year/make/model + color) + reason + who they spoke with → "I'll get you to the shop to check status" → transferCall.

## BROKEN-DOWN / TOWED (highest-value call — they pay for the tow either way; make it come HERE)
Triggers: won't start, accident, engine seized, transmission slipped, "not sure what to do". Pitch in 3 beats (≤25 spoken words each, pause between): · Beat 1 (REFRAME THE SUNK COST): "Wherever it ends up you're paying for the tow — might as well send it here." · Beat 2 (DE-RISK): "Free look, free written quote, no strings — you'll know what's wrong and what it costs before any wrench moves." · Beat 3 (TRUST): "We've been on Euclid for years." Capture name + phone + where the car is now + year/make/model + what happened + tow company (or offer a referral → manager has the contacts). Confirm: "car's at {location}, sending it to 17625 Euclid Ave — soon as it lands we'll look and call you with the estimate." → bookSlot({ service: "tow incoming — diagnose", preferredDay: "today" }) → sendConfirmationSms → transferCall (manager wants to know now; if it fails, bookSlot already saved the lead). Waffling → "meter's running on a tow either way, any other shop charges to even look, we don't — send it, get the estimate, then decide." Don't let them off the line without name + phone + vehicle.

## RACK-CHECK ("won't come if you don't have the tire") — hand to a person
You CANNOT see the rack. Never say a tire is or isn't in stock, and NEVER promise a callback or a timeframe — nobody is tracking that promise, so it gets broken.
"Fair enough — let me get you someone who can walk out and physically look at the rack for you." → transferCall (OPEN) / escalate (CLOSED). Grab the size first if they haven't given it, so the person picking up isn't starting from zero.

## CALLBACK CAPTURE (transfer fails / caller unsure)
Capture name + phone + vehicle + issue + urgency → "I'll send this to the shop so someone can follow up" → sendConfirmationSms.

## WALK-IN / FCFS
No schedule, no time slots — customers just come. Future-day asks → "first-come first-served, pull up any open day, {hours}, no appointment." Two choices once here: WAIT (lobby) or DROP OFF (holds their place, run errands, we text when done — the better call for anything that may take a while). Mention both; never assume drop-off.

# TRUST PHRASES (at most ONE per call, only if the caller's hesitant; skip entirely if they're curt/rude — just be terse and competent)
- "Calling around" → "Cheaper than the dealer, faster than the chains, more honest than both."
- Upsell worry → "If you only need one tire, we sell you one — we don't push four."
- Asks if the check costs anything → "Worst case you got a free look and an honest answer."
- Unsure about cars → "Tell us what you need, we'll figure it out."
- Old / ugly car → "Bring it broken, bring it dead, bring it ugly — that's what we do."
- Quoted high elsewhere → "Tell me the price you got, we'll see what we can do."
- Worried it won't last → "We screw up, we own it. Give us one shot, we'll make it right."
- Suspicious → "I don't get commission — my job's getting you back on the road."

# URGENCY LIBRARY (use the ONE that fits the symptom — adds reason-to-come-now)
- Brakes squealing/grinding → "metal-on-metal soon — that gets expensive fast"
- Wheel bearing / hub noise / hum → "if it locks up while you're driving, that's a tow truck and worse"
- Battery weak / slow to start / no-start → "this weather kills weak batteries — and the alternator goes next when the battery's dragging"
- Coolant or antifreeze leak / overheating → "engines don't survive overheating, even once"
- Tire low / bald / bulging → "blowout on the highway is the bad ending"
- Suspension / clunk / steering pull → "small noise now, big repair later — and it's a safety thing"
- Vague noise / "something's off" → "noises don't fix themselves, they just get more expensive"
- Check-engine light → "could be a five-dollar sensor or a five-thousand-dollar engine — we scan it for free"

# SMS-DEGRADED (sendConfirmationSms returned degraded:true — texts down)
Read verbalRecap aloud word-for-word; or if none: "Texts are down — we're at 17625 Euclid Ave, open today, save the number 216 862 0005, see you soon." Keep it under 10 seconds. Encourage them to save the number now. NEVER promise a text ("I'll send you a text" / "check your phone").

# NAME ECHO
Echo a caller-given name back ONCE. Deepgram skews toward "brake"/"tire"/"alignment" — single-syllable names ("Brent","Drake","Ray") often mis-hear as "Brake". If you echo "Brake" and they pause or correct, re-ask the name fresh — don't second-guess the audio.

# COMPLIANCE NOTE
Ohio doesn't legally require AI disclosure but if a customer directly asks "Am I talking to a robot?" — be honest: "I'm Nick's AI receptionist — I help schedule drop-offs and answer the basics. If you want a real person, just say the word."

# IF STUCK
"Hold on, let me get you over to the shop" → transferCall (OPEN) / escalate (CLOSED). Don't make stuff up, don't take a message — just transfer.

# CORE
Default for routine tire-availability = confident answer + tireInquiry capture, NOT a transfer. Only transfer for a genuine rack-check request, a human ask, vehicle-at-shop, upset caller, or manager approval. Never pretend you checked inventory. Don't let tire callers transfer without size/quantity/phone when you can get it.`;

// wave-181.35: previous greeting front-loaded "used tire / something else"
// which (a) confused non-tire callers, (b) read as dismissive, (c) caused
// ~5 confused 1-line hangups per day in the May 14 call audit. Open-ended
// is what a human receptionist would say.
const FIRST_MESSAGE = "Nick's Tire and Auto — what can I do for you?";

// ─── OUTBOUND FOLLOW-UP ASSISTANT (wave-102, 2026-05-08) ───
// Separate assistant for OPERATOR-TRIGGERED outbound follow-up calls
// to recent-service customers. NOT for inbound. NOT for sales.
// Pure psychological-decoy + referral-capture play. 3-min cap.
//
// Variables overridden per-call via assistantOverrides.variableValues:
//   {{name}}        — customer first name (e.g. "Howard")
//   {{lastService}} — service description (e.g. "brake job", "set of tires")

const FOLLOW_UP_FIRST_MESSAGE = "{{name}}?";

const FOLLOW_UP_SYSTEM_PROMPT = `# IDENTITY
You're calling from Nick's Tire and Auto in Cleveland. Outbound follow-up to {{name}} after their {{lastService}}. This is a trust call, not a sales call.

# HOW YOU TALK
Direct, warm, Cleveland casual. Like a guy who fixed your car calling to make sure it's still running right. Short sentences. Real phone voice. Keep it under 3 minutes.

# OPENER (two-step — do this exactly)
Your firstMessage is just their name: "{{name}}?"
Wait for them to confirm ("yeah" / "speaking" / "this is them").

Once confirmed, say: "Hope you're doing good, this is Nick from Nick's Tire and Auto, and I don't mean to bother but I'm just following up after your last visit. How is everything?"

Wrong number ("no" / "who?" / "wrong number"): "My bad — wrong number. Have a good one." End the call.
No answer after a beat: "Hello — is this {{name}}?" One more try, then end.

# AFTER "HOW IS EVERYTHING?"
Listen. They'll tell you one of three things — handle it naturally:

Everything's good → Great. Thank them. Then the referral ask (once, naturally): "Glad to hear it. Hey listen — if you got any friends or family who need work, tires, brakes, oil, whatever — send 'em our way. If you trust me to fix your car, your people will too. Word-of-mouth keeps this place alive." Then sign off.

Something's wrong → Don't get defensive. "Got it — tell me what's going on, I'll write it down and we'll have someone call you back today to make it right." Get the issue (what, when it started, same job or different). Call escalate({ name: "{{name}}", phone: "<their number>", reason: "Post-repair complaint: <issue>", urgency: "high" }). If they're not upset, ask the referral. If they're mad, skip it — just say "we got it logged, we'll be in touch. Sorry for the trouble. Drive safe."

Needs new work → "Yeah we can take care of that. Pull up any open day, first-come first-served. Earlier the better. Drop it off if you can't wait — we text you when it's ready." Call sendConfirmationSms with their phone + summary. Then the referral ask.

Busy / can't talk / curt → Cut straight to it: "No worries — one quick thing, if you got friends or family who need work, send 'em our way. Appreciate you. Drive safe." End.

Can't hear you / bad connection / driving: "No worries, I'll let you go. Call us if anything comes up. Drive safe." End.

# SIGN OFF
"Appreciate you taking the call. You ever need anything, you know where to find us. Drive safe."

# TOOLS
- escalate({ name, phone, reason, urgency }) — log a complaint or callback
- sendConfirmationSms({ phone, summary }) — text address + recap

# IF ASKED "ARE YOU AI?" / "IS THIS A RECORDING?"
"Yeah, I'm Nick's AI — just checking in for him. Want me to have him call you back instead?" If yes → escalate + sign off. If no → keep going. Don't volunteer it. Don't lie if asked.

# NEVER SAY (kill-list)
- "I appreciate your business" / "Thank you for choosing Nick's"
- "Is there anything else I can help you with?"
- "Have a wonderful day" / "We value your loyalty"
- "I'm just following up to ensure your satisfaction"
- "appointment" / "scheduled" (FCFS walk-in shop)
- Any repair price (this is not a sales call)
- "you're due for an oil change" or any upsell
- "I'll need to check" / "let me verify" (you don't have backend access)

End the call when they say bye / thanks / see ya / take care / drive safe.
`;

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
    // transferPlan controls HOW the handoff happens. Without it, VAPI
    // does a blind transfer (carrier hand-off) which does not complete
    // from a Vapi-provided number. A warm-transfer-* mode has VAPI place
    // the outbound leg itself, which works on any number.
    transferPlan?: { mode: string; message?: string; sipVerb?: string };
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
        // 2026-07-27 · was "Hold on, I'll get you over to the manager." Two
        // defects, both measured on 100 real inbound calls:
        //
        // 1. STACKED FILLER on 22% of calls. The model correctly says ONE short
        //    line while the tool fires ("Give me a moment" / "Just a sec"), then
        //    VAPI speaks THIS message — which opened with a second wait cue.
        //    Result: "Give me a moment Hold on, I'll get you over to the
        //    manager." The kill-list has banned chaining two waits since
        //    0720a97d and could never fix it, because the model was never the
        //    source of the second wait. Prose aimed at the wrong actor.
        // 2. NAMED-PERSON PROMISE (Critical Rule #2). This forwards to the shop
        //    counter line; whoever picks up may not be the manager.
        //
        // Now the ACT half only — the model's line is the wait, this is the
        // action. Still context-neutral per wave-92 (no tire assumption).
        message: "Connecting you to the shop now.",
        description: "Forward the live call to a human. Use whenever the caller asks to be transferred / wants a manager / wants to talk to a person, OR for: used tire availability checks, vehicle already at the shop, manager/owner requests, upset customers, complex repair questions, language barriers. NEVER assume the topic of the transfer — just transfer.",
        // 2026-05-20 · WARM transfer. The prior default (blind transfer)
        // hands the call to the carrier and never completes from a Vapi-
        // provided number — a 2-day audit showed 18 transfers reaching the
        // manager 0 times. warm-transfer-say-message has VAPI place the
        // outbound leg itself + announce the caller, which works on any
        // number. Live value is still dashboard-managed (preserved by
        // vapi-update-assistant.ts); this is the code default.
        transferPlan: {
          mode: "warm-transfer-say-message",
          message: "You've got a customer holding on the Nick's Tire and Auto line. Connecting you now.",
          sipVerb: "dial",
        },
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
      description: "Capture a tire inquiry. **CALL THIS EVERY TIME a caller gives you a tire size AND a phone number — even if they say they're walking in today.** Phone captured = lead saved. Without this call, the shop has no record of the conversation. If the caller asked for stock confirmation before driving over, note the size here and hand them to a person — do NOT promise a callback.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Customer name." },
          phone: { type: "string", description: "Phone number." },
          tireSize: { type: "string", description: "Tire size like '215/55R16' if customer gave one." },
          vehicle: { type: "string", description: "Year + make + model if known." },
          newOrUsed: { type: "string", enum: ["new", "used", "either"], description: "What they want. Default 'either'." },
          installationNeeded: { type: "boolean", description: "True if they want install (most common). False if they bring just the tire." },
          notes: { type: "string", description: "Free-form flag. Use 'PHYSICAL RACK CHECK REQUESTED — promised 15 min callback' when caller wants stock confirmation BEFORE driving over." },
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
      description: "Confirm a given day is open and that Nick's is walk-in. Returns hours only — it does NOT report how busy the shop is and gives no wait estimate. Never tell a caller a wait time or a number of minutes; if they press on how long the wait is, hand them to a person (transferCall while open).",
      parameters: {
        type: "object",
        properties: {
          day: { type: "string", description: "Date as YYYY-MM-DD or 'today'/'tomorrow'." },
        },
      },
    },
  },
  // quoteRange tool REMOVED 2026-05-08 — operator's "sell the visit, not
  // the work" doctrine. Nick should never quote repair pricing. Only
  // exception is the used-tire price in Section 4, which is interpolated from
  // BUSINESS.usedTires (a $25 floor + $40-80 band), NOT a "$60 anchor" as this
  // comment previously said — $60 is the typical midpoint only.
  // wave-181.35: bookSlot RE-ADDED. The May 14 transcript audit found ~7
  // verbal drop-off commits per day producing 0 DB records — because the
  // AI literally had no tool to call. The 0.4% fire rate from wave-181's
  // audit was a prompt problem, not a tool problem. The new prompt makes
  // bookSlot MANDATORY for any non-tire drop-off commit.
  {
    type: "function",
    function: {
      name: "bookSlot",
      description: "Create a drop-off / walk-in record. **MANDATORY when any non-tire caller commits to coming in (brake check, alignment, lights, diagnostic, suspension, oil change, anything else where you have name+phone+vehicle).** The shop is FCFS — you are not picking a time slot, you are logging the intent so the front desk knows they're coming. preferredDay defaults to 'today'. Without this call, the shop has no record of the conversation and the lead is lost.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Customer name." },
          phone: { type: "string", description: "Phone number." },
          service: { type: "string", description: "Service requested in 1-3 words (e.g. 'brake check', 'oil change', 'alignment', 'diagnostic')." },
          vehicle: { type: "string", description: "Year + make + model (e.g. '2021 Mazda CX-5')." },
          preferredDay: { type: "string", description: "Defaults to 'today' for walk-ins. Only set if customer specifies a different day." },
        },
        required: ["name", "phone", "service"],
      },
    },
  },
  // wave-140 (2026-05-29): escalate RE-ADDED, tightly gated. wave-181.35
  // removed it because the AI over-escalated tire questions DURING open
  // hours. The operator's new decision (transfer in-hours, callback after-
  // hours) needs a callback path again — but the inbound prompt allows
  // escalate ONLY when the shop is CLOSED (Rule 6 HOURS GATE); during open
  // hours it still transfers live, so the over-escalation can't recur. This
  // also revives the OUTBOUND follow-up assistant's complaint/"have Nick
  // call me" capture, which had silently no-op'd since 181.35 (the prompt
  // still called escalate). Dispatcher + backend already route it
  // (webhooks/vapi.ts case "escalate" → voiceAgent.escalate).
  {
    type: "function",
    function: {
      name: "escalate",
      description: "Capture a human callback to the shop queue (front desk sees it + calls back). INBOUND: use ONLY when the shop is CLOSED right now (see Rule 6 HOURS GATE) and the caller wants a human — during open hours, transferCall instead; never escalate a caller you could transfer. NEVER use for tire-stock questions (use checkTireStock) or ordinary bookings (use bookSlot).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Caller's name." },
          phone: { type: "string", description: "Callback phone number." },
          reason: { type: "string", description: "1-2 sentence reason for the callback (what they need / their issue)." },
          urgency: { type: "string", description: "low | medium | high", enum: ["low", "medium", "high"] },
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
  // wave-181.35: lookupCustomer + getDeclinedEstimate REMOVED.
  // Operator decision — "doesn't need to look the customer up, just
  // answer the call and help get the customer down here." The AI was
  // wasting prompt budget on a personalization path that fired 0 times
  // in 14 days of calls anyway. Backend procedures stay in voiceAgent.ts.
  {
    type: "function",
    function: {
      name: "getCurrentWaitTime",
      description: "DEPRECATED — does not return a wait estimate. The shop is walk-in, so no wait figure is available to you. If a caller asks how busy it is or how long the wait is, do NOT guess: hand them to a person (transferCall while open, escalate while closed).",
      parameters: { type: "object", properties: {} },
    },
  },
  // wave-181: scheduleCallback REMOVED — semantically duplicates escalate.
  // The 14-day audit found AI confused about which to call when. Both
  // wrote to the same backend (callback queue + Telegram). Now escalate
  // is the single name for "human follow-up needed" — its urgency enum
  // covers both immediate (high) and overnight-callback (low) cases.
  // Backend procedure stays in voiceAgent.ts.
  // checkTireStock · 2026-07-20 · REPURPOSED to a hand-off. It previously
  // captured caller info into a leads row and promised a 15-minute callback.
  // Nothing ever recorded whether the rack was actually walked, so that
  // promise had no completion path and could silently go unkept. Rack checks
  // now go to a live person; the tool no longer writes a lead or alerts
  // Telegram. See the RACK-CHECK section of the system prompt.
  {
    type: "function",
    function: {
      name: "checkTireStock",
      description: "Use ONLY when a caller explicitly says they won't drive over without confirmed stock ('do you actually have it?'). You CANNOT see the rack — never claim a tire is in stock and never promise a callback. This hands the caller to a person who physically checks it. Do NOT use for ordinary tire inquiries — use tireInquiry for those.",
      parameters: {
        type: "object",
        properties: {
          tireSize: { type: "string", description: "Tire size like '215/55R16', if the caller gave one." },
          vehicle: { type: "string", description: "Year + make + model if known." },
        },
        required: [],
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
  voice:
    | {
        provider: "11labs";
        voiceId: string;
        model: "eleven_turbo_v2_5" | "eleven_multilingual_v2" | "eleven_flash_v2";
        stability: number;
        similarityBoost: number;
        style: number;
        useSpeakerBoost: boolean;
        optimizeStreamingLatency: number;
        enableSsmlParsing: boolean;
      }
    | {
        provider: "cartesia";
        voiceId: string;
        model: "sonic-english" | "sonic-2" | "sonic-multilingual";
        language?: string;
        speed?: "slow" | "normal" | "fast";
        emotion?: string[];
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
  // wave-181.50 — VAPI prefers the nested `server` object for new traffic.
  // The top-level serverUrl is legacy/alias. Setting BOTH for safety. The
  // secret field is omitted here and injected at PATCH time from
  // VAPI_WEBHOOK_SECRET env var by the update script.
  server?: { url: string; timeoutSeconds?: number; secret?: string };
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
    // wave-181.42: Cartesia → 11Labs Brian. Operator: "i want something
    // human like." Cartesia Sonic is the lowest-latency TTS but the
    // voice still reads slightly synthetic to a careful ear. 11Labs
    // eleven_turbo_v2_5 + Brian (mature gravelly US male, already used
    // for the FOLLOW_UP assistant in this file) is the best human-quality
    // / latency trade-off in production phone agents today.
    //
    // Latency note: first-token ~200ms (vs Cartesia ~75ms). The 125ms
    // gap is perceivable as a slightly slower pickup but well within
    // normal human turn-taking. Brian's voice quality more than offsets
    // it for a tire-shop receptionist where "talking to a real person"
    // matters more than millisecond response.
    //
    // Tuning knobs (11Labs-specific):
    //   stability 0.40    — below the 0.5 default so Brian gets natural
    //                       emotional variation rather than monotone (more human)
    //   similarityBoost 0.80 — stick close to Brian's reference timbre
    //   style 0.40        — more expressive warmth/emphasis (was 0.30; the
    //                       outbound follow-up assistant runs 0.45 for ref)
    //   useSpeakerBoost true — louder + cleaner on phone audio
    //   optimizeStreamingLatency 3 — 0-4; 3 is the sweet spot for phone
    voice: {
      provider: "11labs",
      voiceId: "nPczCjzI2devNBz1zQrb", // Brian — mature gravelly US male
      model: "eleven_turbo_v2_5",
      stability: 0.40, // was 0.50 - lower adds natural emotional variation (more human, less monotone)
      similarityBoost: 0.80,
      style: 0.40, // was 0.30 - higher adds expressive warmth
      useSpeakerBoost: true,
      optimizeStreamingLatency: 3,
      enableSsmlParsing: true,
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
    // wave-181.50 — set BOTH legacy top-level serverUrl AND the modern
    // nested server.url. VAPI's prod routing prefers the nested field;
    // before this fix, the nested url was the root (https://nickstire.org/)
    // causing every tool call to hit the React SPA → 0 DB writes for 5
    // days. Secret is injected by vapi-update-assistant.ts at PATCH time
    // from VAPI_WEBHOOK_SECRET env (not stored in code).
    serverUrl,
    server: serverUrl ? { url: serverUrl, timeoutSeconds: 20 } : undefined,
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
    // forensic-audit MEDIUM · no timeout meant a VAPI hang blocked the caller
    // for undici's ~300s default — hanging admin Voice queries (infinite
    // spinner) and serializing the outbound-call crons. 15s cap.
    signal: init.signal ?? AbortSignal.timeout(15_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers || {}),
    },
  });
}

/**
 * wave-145 · The outbound caller-ID line. Defaults to Nick's registered VAPI
 * number — the same line callers reach inbound, so outbound calls show a
 * number customers recognize. Operator can point elsewhere via env override.
 */
const DEFAULT_VAPI_OUTBOUND_NUMBER = "+12164249249";
let cachedVapiPhoneNumberId: string | null = null;

/**
 * wave-145 · Resolve the VAPI phoneNumberId required for ALL outbound calls.
 *
 * The bug this fixes: every outbound path (confirmationCalls, voiceRecovery,
 * followupCadence crons + placeVapiOutboundCall) demanded a hand-set
 * VAPI_PHONE_NUMBER_ID env var that was never set — so all three crons
 * silently skipped forever, and the whole outbound program (the $321K voice
 * recovery closer, the 7/30/60 flywheel, confirmation calls) never ran.
 * But makeFollowUpCall already proved the id is derivable from the VAPI API
 * by the known shop number. This centralizes that derivation:
 *   1. VAPI_PHONE_NUMBER_ID env (explicit override) wins if set.
 *   2. Else look up DEFAULT_VAPI_OUTBOUND_NUMBER (+12164249249) via the API.
 *   3. Else null → callers skip gracefully (no rogue call from a wrong line).
 * Cached for the process lifetime on success (ids are stable) so we don't
 * re-hit the API every cron tick; a transient miss is NOT cached so the next
 * tick retries.
 */
export async function resolveVapiPhoneNumberId(): Promise<string | null> {
  const override = process.env.VAPI_PHONE_NUMBER_ID;
  if (override) return override;
  if (cachedVapiPhoneNumberId) return cachedVapiPhoneNumberId;
  if (!process.env.VAPI_API_KEY) return null;
  try {
    const res = await vapiFetch("/phone-number");
    if (!res.ok) return null;
    const numbers = (await res.json()) as Array<{ id: string; number: string }>;
    if (!Array.isArray(numbers)) return null;
    const line = numbers.find((n) => n.number === DEFAULT_VAPI_OUTBOUND_NUMBER);
    if (line?.id) {
      cachedVapiPhoneNumberId = line.id; // cache only on success — transient failures retry next tick
      return line.id;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── PUBLIC API ──────────────────────────────────────────

export async function getVapiStatus(): Promise<{
  connected: boolean;
  assistantCount: number;
  assistants: Array<{ id: string; name: string; createdAt: string }>;
  error?: string;
  // Classifies WHY the check failed, so the admin shows the right message
  // instead of always blaming the API key:
  //  · "auth"   — key missing / 401 / 403  → operator can fix
  //  · "outage" — VAPI 5xx / 429 / unreachable → vendor-side, just wait
  //  · "other"  — unclassified failure
  errorKind?: "auth" | "outage" | "other";
}> {
  try {
    if (!process.env.VAPI_API_KEY) {
      return { connected: false, assistantCount: 0, assistants: [], error: "VAPI_API_KEY not set", errorKind: "auth" };
    }
    const res = await vapiFetch("/assistant");
    if (!res.ok) {
      // 401/403 = a real auth problem (key missing/invalid). 5xx — including
      // Cloudflare's 520-527 "origin unreachable" codes — and 429 mean VAPI
      // itself is down or overloaded, NOT a problem with our key or config.
      const errorKind: "auth" | "outage" | "other" =
        res.status === 401 || res.status === 403
          ? "auth"
          : res.status >= 500 || res.status === 429
            ? "outage"
            : "other";
      return {
        connected: false,
        assistantCount: 0,
        assistants: [],
        error: `Vapi API ${res.status}: ${(await res.text()).slice(0, 200)}`,
        errorKind,
      };
    }
    const data = (await res.json()) as Array<{ id: string; name: string; createdAt: string }>;
    return {
      connected: true,
      assistantCount: data.length,
      assistants: data.slice(0, 10),
    };
  } catch (err) {
    // A thrown fetch (DNS failure, timeout, connection refused) means VAPI
    // was unreachable entirely — that is an outage, never an auth failure.
    return {
      connected: false,
      assistantCount: 0,
      assistants: [],
      error: err instanceof Error ? err.message : String(err),
      errorKind: "outage",
    };
  }
}

/**
 * Builds the OUTBOUND follow-up assistant config. Reuses voice/model/
 * audio settings from the inbound config; swaps prompt + firstMessage
 * + tools (only escalate + sendConfirmationSms · wave-140 dropped the
 * stray transferCall — an outbound trust call never transfers) + a
 * shorter 3-minute max duration.
 */
function buildFollowUpAssistantConfig(serverUrl?: string): VapiAssistantConfig {
  // Subset of tools the follow-up assistant needs
  const followUpTools = VAPI_TOOLS.filter((t) => {
    const tool = t as unknown as Record<string, unknown>;
    // wave-140 · NO transferCall on the OUTBOUND follow-up — it's a trust
    // call WE placed; forwarding it to the shop mid-call makes no sense and
    // the prompt never used it. Complaints / "have Nick call me" go to the
    // callback queue via escalate (re-added to VAPI_TOOLS this wave, so the
    // follow-up prompt's escalate() calls — dead since 181.35 — work again).
    const fn = tool.function as Record<string, unknown> | undefined;
    const name = fn?.name as string | undefined;
    return name === "escalate" || name === "sendConfirmationSms";
  });

  return {
    name: "Nick's Tire Follow-Up Caller",
    firstMessage: FOLLOW_UP_FIRST_MESSAGE,
    transcriber: {
      provider: "deepgram",
      model: "nova-2-phonecall",
      language: "en",
      smartFormat: true,
      keywords: TRANSCRIBER_KEYWORDS,
    },
    voice: {
      provider: "11labs",
      // Wave-102 voice tune (2026-05-08): switched from Adam (polished/AI-y)
      // to Brian (older, slightly gravelly, sounds like a tire-shop guy
      // who's been doing this a while). Plus settings tuned for natural
      // variance + emphasis.
      voiceId: "nPczCjzI2devNBz1zQrb", // Brian — mature gravelly US male
      model: "eleven_multilingual_v2", // More natural than turbo, ~200ms slower
      stability: 0.35, // Lower = more emotional variance (was 0.55)
      similarityBoost: 0.78,
      style: 0.45, // Higher = more expressive emphasis (was 0.20)
      useSpeakerBoost: true,
      optimizeStreamingLatency: 1, // Quality over latency (was 3)
      enableSsmlParsing: true,
    },
    model: {
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "system", content: FOLLOW_UP_SYSTEM_PROMPT }],
      tools: followUpTools,
      temperature: 0.5, // Slightly higher = more natural phrasing variance
      maxTokens: 200,
      emotionRecognitionEnabled: true,
    },
    serverUrl,
    // wave-181.60-followup (audit · 2026-05-18 PM) · the inbound
    // assistant was fixed in wave-181.50 to set BOTH `serverUrl` (legacy)
    // AND nested `server.url` (which VAPI prefers for new traffic). The
    // follow-up assistant was missed · same root cause would silently
    // drop follow-up call webhooks on the next `updateFollowUpAssistant()`
    // PATCH. Adding the nested field now to prevent regression.
    server: serverUrl ? { url: serverUrl, timeoutSeconds: 20 } : undefined,
    serverMessages: [
      "function-call",
      "tool-calls",
      "end-of-call-report",
      "status-update",
    ],
    clientMessages: ["transcript", "tool-calls"],
    endCallFunctionEnabled: true,
    endCallPhrases: END_CALL_PHRASES,
    hipaaEnabled: false,
    silenceTimeoutSeconds: 12, // Tighter — outbound, customer might be busy
    responseDelaySeconds: 0.25,
    llmRequestDelaySeconds: 0.05,
    numWordsToInterruptAssistant: 3,
    maxDurationSeconds: 180, // 3-minute hard cap per operator spec
    backgroundSound: "office",
    backgroundDenoisingEnabled: true,
    modelOutputInMessagesEnabled: true,
    // Voicemail detection — outbound calls hit voicemail often
    voicemailDetection: {
      provider: "twilio",
      voicemailDetectionTypes: ["machine_end_beep", "machine_end_silence"],
      enabled: true,
      machineDetectionTimeout: 30,
    },
    voicemailMessage: "Hey {{name}}, this is Nick from Nick's Tire and Auto, just following up after your last visit. If everything's good, no need to call back. If you got an issue or need anything, give us a ring at 216-862-0005. Drive safe.",
    analysisPlan: ANALYSIS_PLAN,
    artifactPlan: {
      recordingEnabled: true,
      videoRecordingEnabled: false,
      transcriptPlan: { enabled: true },
    },
    startSpeakingPlan: {
      waitSeconds: 0.4,
      smartEndpointingEnabled: true,
      transcriptionEndpointingPlan: {
        onPunctuationSeconds: 0.1,
        onNoPunctuationSeconds: 1.5,
        onNumberSeconds: 0.5,
      },
    },
    stopSpeakingPlan: {
      numWords: 2,
      voiceSeconds: 0.2,
      backoffSeconds: 1,
    },
  };
}

/**
 * wave-181.58 · inject VAPI_WEBHOOK_SECRET into config.server.secret
 * before any PATCH/POST to /assistant. VAPI's nested `server` PATCH
 * replaces the WHOLE object; without injecting the secret here, every
 * server-initiated assistant update would clear it and silently break
 * webhook signature validation (same root cause as wave-181.50, but
 * for the tRPC-triggered update path that the standalone script fix
 * didn't cover).
 *
 * Mutates the passed config in place + returns it. Logs a warning if
 * the env var is missing — does NOT abort, because the previous secret
 * stays set on VAPI's side if we send the field as null/undefined
 * (verified empirically). Aborting here would block legitimate
 * non-secret updates on misconfigured deploys.
 */
function injectWebhookSecret(config: VapiAssistantConfig): VapiAssistantConfig {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (config.server && secret) {
    config.server.secret = secret;
  } else if (config.server && !secret) {
    log.warn("VAPI assistant PATCH/POST · VAPI_WEBHOOK_SECRET missing from env — server.secret left unset (preserves prior value on VAPI if any).");
  }
  return config;
}

export async function createFollowUpAssistant(serverUrl?: string): Promise<{
  success: boolean;
  assistantId?: string;
  error?: string;
}> {
  try {
    const config = injectWebhookSecret(buildFollowUpAssistantConfig(serverUrl));
    const res = await vapiFetch("/assistant", {
      method: "POST",
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const text = await res.text();
      log.error("Vapi follow-up assistant create failed", { status: res.status, body: text.slice(0, 500) });
      return { success: false, error: `${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as { id: string };
    log.info("Created Vapi follow-up assistant", { id: data.id });
    return { success: true, assistantId: data.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Create failed" };
  }
}

export async function updateFollowUpAssistant(assistantId: string, serverUrl?: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const config = injectWebhookSecret(buildFollowUpAssistantConfig(serverUrl));
    const res = await vapiFetch(`/assistant/${assistantId}`, {
      method: "PATCH",
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `${res.status}: ${text.slice(0, 200)}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Update failed" };
  }
}

export async function createProductionAssistant(serverUrl?: string): Promise<{
  success: boolean;
  assistantId?: string;
  config?: VapiAssistantConfig;
  error?: string;
}> {
  try {
    const config = injectWebhookSecret(buildAssistantConfig(serverUrl));
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

/**
 * wave-141 · Merge the LIVE (dashboard-managed) transferCall destinations
 * into a freshly-built assistant config so a full re-push preserves the
 * operator's transfer number instead of resetting it to the code default.
 *
 * buildAssistantConfig ships the code-default transfer number (the shop
 * landline). The operator sets the real destination — a manager cell that
 * changes often — via the VAPI dashboard. Without this merge, every admin
 * "re-push" (updateAssistant) silently reset that number. Mirrors the
 * preserve logic in scripts/vapi-update-assistant.ts.
 *
 * Pure (no I/O) so it's unit-testable. Mutates + returns `config`. If the
 * live tools carry no transferCall destination, the code default stands.
 */
export function preserveLiveTransferDestinations(
  config: VapiAssistantConfig,
  liveTools: Array<Record<string, unknown>>,
): VapiAssistantConfig {
  const liveTransfer = liveTools.find((t) => t.type === "transferCall");
  const liveDestinations = liveTransfer?.destinations as Array<Record<string, unknown>> | undefined;
  if (!liveDestinations || liveDestinations.length === 0) return config;
  const idx = config.model.tools.findIndex((t) => t.type === "transferCall");
  if (idx < 0) return config;
  const codeTool = config.model.tools[idx];
  if (codeTool.type !== "transferCall") return config;
  codeTool.destinations = liveDestinations.map((d) => {
    // Preserve a dashboard-set transferPlan (e.g. warm-transfer) so a code
    // re-push doesn't silently revert to a blind transfer that can't connect
    // from a Vapi number. Fall back to the code default's transferPlan.
    const transferPlan =
      (d.transferPlan as { mode: string; message?: string } | undefined) ??
      codeTool.destinations[0]?.transferPlan;
    return {
      type: (d.type as "number") || "number",
      number: d.number as string,
      message: (d.message as string) ?? codeTool.destinations[0]?.message,
      description: (d.description as string) ?? codeTool.destinations[0]?.description,
      ...(transferPlan ? { transferPlan } : {}),
    };
  });
  return config;
}

export async function updateAssistant(assistantId: string, serverUrl?: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const config = injectWebhookSecret(buildAssistantConfig(serverUrl));

    // self-improving loop (phase 2) · append the highest-confidence learned
    // lessons to the system prompt on THIS manual re-push only. buildAssistantConfig
    // stays pure (its test asserts the static prompt); the append lives here so
    // lessons reach the receptionist exclusively via the operator's "Push Latest
    // Config" — updateAssistant has no automated caller. getPromptLessons returns
    // "" until a lesson has reinforced to >=0.65 (a real recurring pattern), so a
    // one-off never alters the prompt. Best-effort: a memory read failure never
    // blocks a legitimate prompt/tool push.
    try {
      const { getPromptLessons } = await import("./nickMemory");
      const lessonsBlock = await getPromptLessons();
      const sysMsg = config.model?.messages?.[0];
      if (lessonsBlock && sysMsg && typeof sysMsg.content === "string") {
        sysMsg.content += lessonsBlock;
      }
    } catch (lessonErr) {
      log.warn("Vapi updateAssistant · lesson-append skipped", { error: lessonErr instanceof Error ? lessonErr.message : String(lessonErr) });
    }

    // wave-141 · pre-fetch the live assistant + carry its dashboard-managed
    // transferCall destination into the config, so this re-push updates the
    // prompt + tool list WITHOUT resetting the operator's transfer number.
    // Best-effort: if the pre-fetch fails, fall through with the code default
    // rather than block a legitimate prompt/tool update.
    try {
      const preRes = await vapiFetch(`/assistant/${assistantId}`);
      if (preRes.ok) {
        const preLive = (await preRes.json()) as { model?: { tools?: Array<Record<string, unknown>> } };
        preserveLiveTransferDestinations(config, preLive.model?.tools ?? []);
      } else {
        log.warn("Vapi updateAssistant · transfer-preserve pre-fetch non-OK", { status: preRes.status });
      }
    } catch (preErr) {
      log.warn("Vapi updateAssistant · transfer-preserve skipped", { error: preErr instanceof Error ? preErr.message : String(preErr) });
    }

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

/**
 * Place an outbound call via VAPI · wave-181.87 (operator preference ·
 * keep VAPI · don't add AgentPhone or Twilio as a second voice vendor).
 *
 * Uses the wave-181.50 FOLLOW-UP assistant (`pickFollowUpAssistantId`)
 * which is wired with the brand-voice prompt + escalate +
 * sendConfirmationSms (wave-140 dropped the stray transferCall — an
 * outbound call we placed never forwards). For
 * confirmation + voice-recovery use cases we override the systemPrompt
 * + firstMessage at call-time so the same assistant handles both
 * outbound contexts without needing 2 separate VAPI agents.
 *
 * VAPI requires a registered phoneNumberId for outbound calls · wave-145
 * resolveVapiPhoneNumberId() derives it automatically from the shop's VAPI
 * line (+12164249249) — VAPI_PHONE_NUMBER_ID env still works as an override
 * if the operator wants outbound caller ID to differ from inbound.
 *
 * Returns VAPI's call id on success · used as the join key in the
 * confirmation_calls + alg_estimates.voice_recovery_call_id columns.
 */
export interface VapiPlaceCallParams {
  /** Customer phone in E.164 format · e.g. "+12168620005" */
  customerNumber: string;
  /** Override the assistant's default firstMessage. OMIT to keep the
   *  assistant's own firstMessage (templated via variableValues). */
  firstMessageOverride?: string;
  /** Override the assistant's default systemPrompt. OMIT to use the
   *  assistant's base prompt — e.g. the trust-call FOLLOW_UP_SYSTEM_PROMPT,
   *  filled via variableValues (the wave-143 follow-up cadence does this). */
  systemPromptOverride?: string;
  /** Optional · max 90s default · keeps cost predictable */
  maxDurationSeconds?: number;
  /** wave-143 · LiquidJS variables to fill {{name}} / {{lastService}} etc.
   *  in the assistant's base prompt + firstMessage when not overriding them. */
  variableValues?: Record<string, string>;
  /** Voicemail message to leave when AMD detects an answering machine.
   *  If provided, enables VAPI voicemail detection. The AI won't improvise
   *  on voicemail — it plays this exact message and hangs up. */
  voicemailMessage?: string;
}

export interface VapiPlaceCallResult {
  success: boolean;
  callId?: string;
  error?: string;
}

export async function placeVapiOutboundCall(params: VapiPlaceCallParams): Promise<VapiPlaceCallResult> {
  if (!process.env.VAPI_API_KEY) {
    return { success: false, error: "VAPI_API_KEY not configured" };
  }
  const phoneNumberId = await resolveVapiPhoneNumberId();
  if (!phoneNumberId) {
    return { success: false, error: "No VAPI outbound number — set VAPI_PHONE_NUMBER_ID or register +12164249249 in VAPI" };
  }
  // Env-direct lookup · the pickFollowUpAssistantId() helper requires
  // the full assistants array which we don't fetch at call time · just
  // read the pinned env var (operator sets VAPI_FOLLOWUP_ASSISTANT_ID).
  const assistantId = process.env.VAPI_FOLLOWUP_ASSISTANT_ID;
  if (!assistantId) {
    return { success: false, error: "VAPI_FOLLOWUP_ASSISTANT_ID env not set" };
  }
  if (!/^\+\d{10,15}$/.test(params.customerNumber)) {
    return { success: false, error: `Invalid customerNumber: ${params.customerNumber}` };
  }

  try {
    // wave-143 · build overrides conditionally. Callers either FULLY override
    // the prompt (confirmation/recovery) OR keep the assistant's base prompt
    // and just fill variableValues (the follow-up cadence reuses the
    // trust-call FOLLOW_UP_SYSTEM_PROMPT via {{name}} / {{lastService}}).
    const assistantOverrides: Record<string, unknown> = {
      maxDurationSeconds: params.maxDurationSeconds ?? 90,
    };
    if (params.firstMessageOverride !== undefined) assistantOverrides.firstMessage = params.firstMessageOverride;
    if (params.systemPromptOverride !== undefined) {
      assistantOverrides.model = { messages: [{ role: "system", content: params.systemPromptOverride }] };
    }
    if (params.variableValues) assistantOverrides.variableValues = params.variableValues;

    // Voicemail detection — when a voicemailMessage is provided, enable
    // VAPI's AMD so it detects the beep and leaves a clean message instead
    // of the AI improvising (burning 30-60s of credit talking to a machine).
    if (params.voicemailMessage) {
      assistantOverrides.voicemailMessage = params.voicemailMessage;
      assistantOverrides.voicemailDetection = {
        provider: "twilio",
        enabled: true,
        voicemailDetectionTypes: ["machine_end_beep", "machine_end_silence"],
        machineDetectionTimeout: 30,
        machineDetectionSpeechThreshold: 3500,
        machineDetectionSpeechEndThreshold: 2000,
      };
    }

    const res = await vapiFetch("/call", {
      method: "POST",
      body: JSON.stringify({
        assistantId,
        phoneNumberId,
        customer: { number: params.customerNumber },
        assistantOverrides,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { success: false, error: `VAPI /call returned ${res.status}: ${errText.slice(0, 150)}` };
    }
    const data = (await res.json()) as { id?: string };
    if (!data.id) return { success: false, error: "VAPI response missing call id" };
    return { success: true, callId: data.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Brand-voice system prompts for outbound use cases · separate from the
 * inbound FOLLOW_UP_SYSTEM_PROMPT (which targets returning-callback flows).
 *
 * Operator-tunable via the assistantOverrides at call time so they can
 * iterate per-cohort without creating new VAPI assistants.
 */
export function buildOutboundConfirmationPrompt(params: {
  customerName: string;
  service: string;
  preferredDay: string;
  vehicleRef?: string;
}): string {
  const vehicleClause = params.vehicleRef ? ` on ${params.vehicleRef}` : "";
  return [
    `# IDENTITY`,
    `You're calling from Nick's Tire & Auto in Cleveland — courtesy call about ${params.customerName}'s ${params.service}${vehicleClause}.`,
    ``,
    `# HOW YOU TALK`,
    `Cleveland casual. Warm. 60 seconds max. This is a quick heads-up, not a conversation.`,
    ``,
    `# FLOW`,
    `Open: "Hey ${params.customerName}, it's Nick's Tire — you still good for that ${params.service} ${params.preferredDay}?"`,
    ``,
    `YES → "Pull up anytime, first-come first-served. We're at 17625 Euclid Ave. See you then." End.`,
    `NO / reschedule → "No problem — come by whenever works, we're open 7 days. 17625 Euclid Ave." End.`,
    `"Actually I have a problem with the last work" → "Got it — tell me what's going on, I'll have someone call you back today." Get the issue. Call escalate({ name: "${params.customerName}", phone: "<their number>", reason: "Post-repair issue: <summary>", urgency: "high" }). End.`,
    `Confused / wrong number → "216-862-0005 anytime. Have a good one." End.`,
    ``,
    `# NEVER SAY`,
    `- "appointment" / "scheduled" / "reservation" (we're walk-in, first-come first-served)`,
    `- "I appreciate your business" / "Thank you for choosing"`,
    `- Any repair price`,
    `- "Is there anything else I can help you with?"`,
    `- "I am an AI" (unless directly asked — then: "Yeah, I'm Nick's AI — just confirming for him.")`,
  ].join("\n");
}

/** Voicemail message for confirmation calls — specific, short, no "appointment" */
export function buildConfirmationVoicemail(params: {
  customerName: string;
  service: string;
  preferredDay: string;
}): string {
  return `Hey ${params.customerName}, Nick's Tire calling about your ${params.service} ${params.preferredDay} — we're at 17625 Euclid Ave, pull up anytime, first-come first-served. If anything changes, 216-862-0005. See you then.`;
}

export function buildOutboundRecoveryPrompt(params: {
  customerName: string;
  service: string;
  amountDollars: number;
}): string {
  // Safety-relevant services get a soft urgency nudge (not a hard sell)
  const isSafety = /brake|bearing|hub|steering|suspension|ball.?joint|tie.?rod|control.?arm/i.test(params.service);
  const safetyLine = isSafety
    ? `\nIf they seem on the fence, you can add (softly, once): "just want to make sure you're safe on the road — that's all."`
    : "";
  return [
    `# IDENTITY`,
    `You're calling from Nick's Tire & Auto in Cleveland — checking in on a quote.`,
    ``,
    `# CONTEXT`,
    `${params.customerName} got a $${params.amountDollars} quote for ${params.service} about 5-6 weeks ago. Didn't come back. SMS follow-ups got no response.`,
    ``,
    `# HOW YOU TALK`,
    `Cleveland casual. Zero pressure. 60-90 seconds. This is a relationship call — if they say no, you say "all good" and mean it.`,
    ``,
    `# FLOW`,
    `Open: "Hey ${params.customerName}, it's Nick's Tire — you had a quote with us for ${params.service} a few weeks back. That still on your radar?"`,
    ``,
    `INTERESTED → "That quote's still good. Pull up any open day, first-come first-served. We're at 17625 Euclid Ave." End.`,
    `NOT INTERESTED → "No pressure — we're here when you need us. Drive safe." End.`,
    `"Went somewhere else" → "All good, glad you got it taken care of." End gracefully.`,
    `"Can't afford it" → "We got Acima payment plans if that helps — no credit needed, breaks it into chunks. Or just come by, no pressure, we can talk through it." End.${safetyLine}`,
    `Busy / annoyed → "No worries — 216-862-0005 when you're ready." End fast.`,
    ``,
    `# NEVER SAY`,
    `- "I appreciate your business" / "Thank you for choosing"`,
    `- "you really should get this done" / any guilt trip`,
    `- "Is there anything else I can help you with?"`,
    `- "appointment" / "scheduled" (walk-in shop)`,
    `- "Anything we can do to help you decide?" (brochure closer)`,
    `- "I am an AI" (unless asked — then: "Yeah, I'm Nick's AI — just following up for him.")`,
    `- NEVER push back if they decline. End gracefully.`,
  ].join("\n");
}

/** Voicemail message for recovery calls — short, no pressure */
export function buildRecoveryVoicemail(params: {
  customerName: string;
  service: string;
}): string {
  return `Hey ${params.customerName}, Nick's Tire — that ${params.service} quote from a few weeks back is still good if you want it. 216-862-0005 anytime. No rush.`;
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
export { FOLLOW_UP_SYSTEM_PROMPT, FOLLOW_UP_FIRST_MESSAGE, buildFollowUpAssistantConfig };

// ─── Wave-105: On-duty manager phone (VAPI transfer destination) ───
// Returns the phone number that VAPI's transferCall tool currently
// forwards live calls to. That's the on-duty manager. We use this for
// "alert the manager" notifications (booking_created, lead_captured,
// etc.) so alerts always go to whoever is actually answering calls.
//
// 5-min cache to avoid hammering the VAPI API on every event. Falls
// back to MANAGER_PHONE env var if VAPI is unreachable.

interface OnDutyManagerCache {
  number: string | null;
  expiresAt: number;
}
let onDutyManagerCache: OnDutyManagerCache | null = null;
const ON_DUTY_TTL_MS = 5 * 60 * 1000;

export async function getOnDutyManagerPhone(): Promise<string | null> {
  // Cache hit
  if (onDutyManagerCache && Date.now() < onDutyManagerCache.expiresAt) {
    return onDutyManagerCache.number;
  }

  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) {
    return process.env.MANAGER_PHONE || null;
  }

  try {
    const aRes = await fetch(`${VAPI_BASE}/assistant?limit=10`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!aRes.ok) throw new Error(`assistant list ${aRes.status}`);
    const assistants = (await aRes.json()) as Array<{ id: string; name?: string }>;
    if (!assistants.length) throw new Error("no assistants");

    // wave-113b — was assistants[0] blindly; now picks the inbound
    // Receptionist (not the outbound Follow-Up Caller) so manager-on-
    // duty alerts go to the same phone callers actually get forwarded to.
    const picked = pickReceptionistAssistantId(assistants);
    if (!picked) throw new Error("no receptionist assistant found");
    const assistantId = picked.id;

    const dRes = await fetch(`${VAPI_BASE}/assistant/${assistantId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!dRes.ok) throw new Error(`assistant detail ${dRes.status}`);
    const assistant = (await dRes.json()) as {
      model?: { tools?: Array<{ type: string; destinations?: Array<{ type?: string; number?: string }> }> };
    };
    const tools = assistant.model?.tools || [];
    const transfer = tools.find((t) => t.type === "transferCall");
    // wave-116 — pick number-type destination explicitly (same class as
    // the assistants[0] bug fixed in wave-113b).
    const numberDest = transfer?.destinations?.find((d) => d.type === "number") ?? transfer?.destinations?.[0];
    const number = numberDest?.number || null;

    onDutyManagerCache = { number, expiresAt: Date.now() + ON_DUTY_TTL_MS };
    return number;
  } catch (err) {
    log.warn("getOnDutyManagerPhone failed; falling back to MANAGER_PHONE env", {
      error: err instanceof Error ? err.message : String(err),
    });
    return process.env.MANAGER_PHONE || null;
  }
}

/** Invalidate the on-duty manager cache (call after setTransferDestination). */
export function invalidateOnDutyManagerCache(): void {
  onDutyManagerCache = null;
}
