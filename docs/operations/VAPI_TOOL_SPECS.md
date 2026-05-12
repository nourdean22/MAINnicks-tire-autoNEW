# Vapi Tool Specs — Nick AI Receptionist

**Last updated:** wave-179 · 2026-05-12

This is the canonical list of tools the Nick AI assistant on Vapi can call
into our backend. Each tool entry includes:

1. The function name (must match the `case "X":` dispatch in
   `server/routes/webhooks/vapi.ts`)
2. The JSON-Schema parameters Vapi will validate caller-side
3. A short "when AI should call this" hint for the Vapi system prompt

**To wire a NEW tool into the live Vapi assistant:**
Vapi Dashboard → Assistants → Nick → Functions tab → Create Function →
paste the function name + JSON Schema below.

The backend dispatcher in `server/routes/webhooks/vapi.ts` already
handles routing each function name to the corresponding tRPC procedure.

---

## Shop info + status

### `shopInfo`
*Returns business name, phone, address, hours, financing providers,
languages spoken. AI should call once per call if the caller asks "what
are your hours" / "where are you" / "do you speak Spanish".*

```json
{
  "name": "shopInfo",
  "description": "Get Nick's Tire & Auto business info — hours, address, financing options, languages spoken.",
  "parameters": { "type": "object", "properties": {}, "required": [] }
}
```

### `capacityCheck`
*Returns today's/tomorrow's general capacity. AI uses this to set realistic
expectations BEFORE pitching a same-day visit.*

```json
{
  "name": "capacityCheck",
  "description": "Check whether the shop has capacity for new work on a given day.",
  "parameters": {
    "type": "object",
    "properties": { "day": { "type": "string", "description": "today | tomorrow | YYYY-MM-DD" } },
    "required": []
  }
}
```

### `getCurrentWaitTime` *(wave-179 NEW)*
*Real-time read of the active booking queue. Returns "open" / "busy" / "loaded"
with an AI hint string. AI calls this when caller asks "how busy are you
right now" or "can I just walk in".*

```json
{
  "name": "getCurrentWaitTime",
  "description": "Get the current shop wait estimate (open | busy | loaded) based on active bookings.",
  "parameters": { "type": "object", "properties": {}, "required": [] }
}
```

---

## Pricing + quoting

### `quoteRange`
*Returns price range + walk-in availability for a service category. AI
should call BEFORE giving any specific price.*

```json
{
  "name": "quoteRange",
  "description": "Get the price range for a service (tires/brakes/oil/etc) on a specific vehicle.",
  "parameters": {
    "type": "object",
    "properties": {
      "service": { "type": "string", "description": "Service slug or name" },
      "vehicleYear": { "type": "number" },
      "vehicleMake": { "type": "string" }
    },
    "required": ["service"]
  }
}
```

### `tireSizeFromVehicle` *(wave-179 — now wired)*
*Caller says "F-150" → AI calls this → returns the OEM tire size
("265/70R17") so AI can pitch the right tire. Was always in the backend;
wave-179 wired it into the webhook dispatcher.*

```json
{
  "name": "tireSizeFromVehicle",
  "description": "Get the factory tire size for a specific vehicle year/make/model.",
  "parameters": {
    "type": "object",
    "properties": {
      "year": { "type": "number" },
      "make": { "type": "string" },
      "model": { "type": "string" }
    },
    "required": ["year", "make", "model"]
  }
}
```

---

## Customer recognition *(wave-179 NEW)*

### `lookupCustomer`
*The single highest-impact tool for retention. AI greets returning customers
by name, references prior service, doesn't ask for info we already have.*

**Usage example in system prompt:**
> "When a call starts, immediately call `lookupCustomer` with the caller's
> phone number. If `found: true`, greet them by `firstName` and reference
> `lastVisitDays` ('it's been about X days since your last visit').
> If `found: false`, proceed with a normal new-caller flow."

```json
{
  "name": "lookupCustomer",
  "description": "Look up the caller in our customer database by phone number. Returns name, visit history, vehicle on file if matched.",
  "parameters": {
    "type": "object",
    "properties": {
      "phone": { "type": "string", "description": "Caller phone number (any format)" }
    },
    "required": ["phone"]
  }
}
```

### `getDeclinedEstimate`
*Targets the $321K declined-work pipeline. When a customer with an open
unconverted estimate calls, AI can naturally re-engage on it.*

**Usage example in system prompt:**
> "After `lookupCustomer` returns a match, also call `getDeclinedEstimate`
> with the same phone. If `found: true`, the customer has an open quote
> waiting on a decision. Use the `aiHint` field to decide whether to
> mention it — only bring it up if the caller is revisiting the same
> topic, never pitch hard."

```json
{
  "name": "getDeclinedEstimate",
  "description": "Check if the caller has an unconverted ALG estimate awaiting decision. Returns the estimate details + AI guidance on how to handle it.",
  "parameters": {
    "type": "object",
    "properties": {
      "phone": { "type": "string", "description": "Caller phone number (any format)" }
    },
    "required": ["phone"]
  }
}
```

---

## Booking actions

### `bookSlot`
*The primary conversion event. AI calls this AFTER collecting name + phone
+ service. Creates a real `bookings` row.*

```json
{
  "name": "bookSlot",
  "description": "Book a drop-off slot for a customer. Creates a real booking record.",
  "parameters": {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "phone": { "type": "string" },
      "service": { "type": "string" },
      "vehicle": { "type": "string", "description": "Free-form year/make/model" },
      "preferredDay": { "type": "string", "description": "today | tomorrow | YYYY-MM-DD" },
      "callId": { "type": "string", "description": "Vapi call ID for audit trail" }
    },
    "required": ["name", "phone", "service"]
  }
}
```

### `tireInquiry` *(wave-179 — now wired + hardened)*
*Warm-lead capture for tire questions that don't commit to a booking.
Wave-178 hardened it from publicProcedure to voiceAgentInternalProcedure.
Wave-179 wired it into the webhook dispatcher.*

```json
{
  "name": "tireInquiry",
  "description": "Log a warm-lead tire inquiry that didn't book yet. Captures size + vehicle so the shop can follow up.",
  "parameters": {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "phone": { "type": "string" },
      "tireSize": { "type": "string" },
      "vehicle": { "type": "string" },
      "newOrUsed": { "type": "string", "enum": ["new", "used", "either"] },
      "installationNeeded": { "type": "boolean" },
      "callId": { "type": "string" }
    },
    "required": ["name", "phone"]
  }
}
```

### `scheduleCallback` *(wave-179 NEW)*
*After-hours capture. Writes to `callback_requests` so the front desk
sees every overnight/Sunday-night call as a first-thing-morning queue.*

```json
{
  "name": "scheduleCallback",
  "description": "Schedule a callback for an after-hours caller. The shop will call them back during business hours.",
  "parameters": {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "phone": { "type": "string" },
      "reason": { "type": "string", "description": "What the caller wanted to discuss" },
      "preferredTime": { "type": "string", "description": "Free-form like 'tomorrow morning' or 'after 3pm'" },
      "callId": { "type": "string" }
    },
    "required": ["name", "phone"]
  }
}
```

---

## Escalation + confirmation

### `escalate`
*When the caller needs a human (complaint, complex repair, emergency) or
the AI is over its head. Fires SMS to whoever Nour has configured as the
on-duty manager number.*

```json
{
  "name": "escalate",
  "description": "Escalate to a human when the AI is over its head or the caller is upset.",
  "parameters": {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "phone": { "type": "string" },
      "reason": { "type": "string" },
      "urgency": { "type": "string", "enum": ["low", "medium", "high"] },
      "callId": { "type": "string" }
    },
    "required": ["name", "phone", "reason"]
  }
}
```

### `sendConfirmationSms`
*Post-booking confirmation. AI calls this AFTER `bookSlot` succeeds to
text the caller a summary of what they booked + Google Maps link.*

```json
{
  "name": "sendConfirmationSms",
  "description": "Send a confirmation SMS with booking summary + map link.",
  "parameters": {
    "type": "object",
    "properties": {
      "phone": { "type": "string" },
      "summary": { "type": "string", "description": "Short human-readable booking summary" },
      "mapLink": { "type": "string" }
    },
    "required": ["phone", "summary"]
  }
}
```

---

## Recommended Vapi system-prompt addition

Add this paragraph to the Nick assistant's system prompt on Vapi dashboard:

> When a call starts, you have the caller's phone number from Vapi metadata.
> Immediately call `lookupCustomer` to see if this is a returning customer.
> If they're a returning customer, also call `getDeclinedEstimate` — they
> might be following up on an existing quote. Greet returning customers by
> first name. Reference their vehicle on file before asking. If you're
> outside business hours (8a-6p M-Sat, 9a-4p Sun), and the caller wants
> something other than emergency help, offer `scheduleCallback` as the
> primary path. For tire-size questions, call `tireSizeFromVehicle` rather
> than guessing. Before quoting any wait time, call `getCurrentWaitTime`.

---

## Tool dispatch verification

To verify all 10 tools route correctly from Vapi → webhook → tRPC:

```bash
# Test webhook endpoint with a synthetic Vapi tool-call payload
curl -X POST https://nickstire.org/api/webhooks/vapi \
  -H "x-vapi-signature: $(node -e 'console.log(...)')" \
  -d '{"message":{"type":"tool-calls","toolCalls":[{"id":"test","function":{"name":"shopInfo","arguments":"{}"}}]}}'
```

Expected: 200 OK with the tool's result wrapped in Vapi's expected format.
