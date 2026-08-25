# Nickstire Bridge Endpoints · Spec for the Voice-Assistant Pipeline

**Audience:** the session/dev working on `nickstire.org/admin` (Auto Labor Guide).

This doc specifies 3 write-side bridge endpoints that statenour-os
expects on nickstire admin. They're called by the VAPI voice-assistant
tools when a caller drops off / requests a callback / gets looked up.

Architecture decision · business data lives in nickstire admin (Auto
Labor Guide CRM). statenour-os is the personal OS · it forwards voice
data to nickstire admin via these endpoints, and keeps a local
brainMemory backup so the data isn't lost during a temporary admin
outage.

---

> ## UNBUILT SPEC — measured 2026-08-23, none of these endpoints exist
>
> Reproduce: `git ls-tree -r --name-only origin/main | grep api/bridge` -> exactly one route,
> `apps/statenour/app/api/bridge/health/route.ts`. **`/api/bridge/dropoff`,
> `/api/bridge/callback` and `/api/bridge/shop-snapshot` return 0 route files and 0 code
> references.** `lib/bridge-auth.ts` exists and has exactly one consumer: `bridge/health`.
>
> This document is written in the present indicative — "All 3 endpoints authenticate via…",
> "already set", "the existing read-bridge" — which reads as live API surface. A nickstire
> developer could implement a client against it and get 404s. It is a **proposal that was never
> built**, and the only thing wrong with it is the tense.
>
> Left in place rather than deleted: the shapes are still the design, and `BRIDGE_API_KEY` +
> `bridge-auth.ts` are real, so this is the spec to build from if the lane is revived. But the
> header now says so, because "already set" and "existing" are exactly the phrases that stop a
> reader checking.

## Auth

All 3 endpoints authenticate via `X-Bridge-Key` header. The shared key
is `BRIDGE_API_KEY` (env var on both apps · already set, same key the
existing read-bridge `/api/bridge/shop-snapshot` uses).

Reject without the header → 401.

---

## 1 · POST `/api/bridge/dropoff`

Logs a drop-off request from the voice assistant. The caller wants to
bring their car in. Land this as a lead / ticket in Auto Labor Guide.

### Request body

```json
{
  "source": "vapi:nick",
  "vapiCallId": "string · the VAPI call uuid · use as idempotency key",
  "capturedAt": "ISO-8601 timestamp",
  "name": "string | null · caller's first name",
  "phone": "string | null · phone (any format)",
  "vehicle": {
    "year": "string | number | null",
    "make": "string | null",
    "model": "string | null"
  },
  "concern": "string | null · short description of the issue",
  "preferredTime": "string | null · free-form (e.g. 'tomorrow afternoon')",
  "driveable": "boolean | string | null",
  "returningCustomer": "boolean | string | null"
}
```

### Response (200)

```json
{
  "id": "string · the new ticket / lead id in Auto Labor Guide",
  "ticketUrl": "string · optional · a link to the new ticket in admin"
}
```

### Notes

- Idempotency · use `vapiCallId` as a uniqueness key so a retry from
  statenour doesn't create a duplicate ticket.
- If only `name` is provided (no phone), still accept · the caller may
  follow up.
- Match `phone` against existing customers · if found, link the new
  ticket to that customer.

---

## 2 · POST `/api/bridge/callback`

Logs a callback request. The voice assistant escalates here when it
can't fully help live (price questions Nick won't quote, Spanish
callers needing a Spanish-speaking team member, angry callers, etc.).

### Request body

```json
{
  "source": "vapi:nick",
  "vapiCallId": "string · idempotency key",
  "capturedAt": "ISO-8601 timestamp",
  "name": "string | null",
  "phone": "string | null",
  "reason": "string | null · why the callback was requested",
  "urgency": "'normal' | 'urgent'",
  "preferredTime": "string | null · free-form",
  "language": "'english' | 'spanish' | 'arabic' | string · default 'english'"
}
```

### Response (200)

```json
{
  "id": "string · the new callback record id",
  "ticketUrl": "string · optional"
}
```

### Notes

- `urgency: 'urgent'` should fire whatever fast-alert mechanism the
  shop uses (Telegram / SMS / floor-buzzer · whatever exists).
- `language: 'spanish'` should route to a Spanish-speaking team member
  if one's available · otherwise queue with the language flag visible.

---

## 3 · GET `/api/bridge/customer-lookup?phone=NORMALIZED`

Looks up a customer by phone. The voice assistant uses this early in
the call to recognize returning customers naturally.

### Query

- `phone` · the last 10 digits of the phone (statenour normalizes
  before sending). E.g. `2168620005`.

### Response (200) · found

```json
{
  "found": true,
  "name": "string · customer's first name (or full name)",
  "phone": "string · normalized 10-digit phone",
  "visitCount": "number · total prior visits / tickets",
  "lastVisitAt": "ISO-8601 | null",
  "notes": "string | null · short shop note (e.g. 'prefers drop-off, broke promise twice')"
}
```

### Response (200) · not found

```json
{ "found": false }
```

### Notes

- Match against the canonical customer table in Auto Labor Guide.
- If the phone exists in multiple records, return the most-recent /
  primary record.
- Performance · this is on a live call · target < 1 second response.

---

## What statenour-os does on success / miss

Each of the 3 statenour endpoints (`/api/vapi/schedule-dropoff`,
`/api/vapi/submit-callback`, `/api/vapi/lookup-customer`) does ·

1. Forwards to the matching nickstire endpoint above.
2. **If success** · returns the success response to VAPI AND mirrors
   the record to statenour's `brainMemory` (category `dropoff_request` /
   `callback_request` / `customer`) with the upstream `id` linked.
3. **If miss** (network error, 5xx, env unset) · falls back to
   `brainMemory` only, tells the caller "I'll have someone follow up,"
   and logs `bridge_post_*_error` so the miss is visible on
   `/system/lens-stats` / `/system/errors`.

This means · once nickstire admin has these endpoints, the data flows
to Auto Labor Guide automatically without any change on the VAPI side.
Until then, the voice assistant works · data just lives in statenour
brainMemory + on `/system/vapi-calls` dashboard.

---

## Test sequence (when nickstire side is built)

1. Set `BRIDGE_API_KEY` on both apps (already set).
2. Deploy nickstire endpoints.
3. Call Nick at `+1 216 424 9249` and say "I want to drop my car off
   tomorrow morning, my name is Test, my phone is 555-1234."
4. Expect a new ticket in Auto Labor Guide AND a `brainMemory` row in
   statenour (visible on `/system/lens-stats` if you grep
   `dropoff_request`).
5. Call again from the same number 5 min later · expect Nick to greet
   as a "returning customer" via the lookup tool.

If anything mismatches, check `/system/errors` on statenour for
`bridge_post_*_error` log lines · they have the exact failure mode.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
