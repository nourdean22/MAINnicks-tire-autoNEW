# Customer Confirmation Notifications — PREVIEW ONLY

Status: **no customer order-confirmation messages are sent today, by
anything.** This wave adds preview-only templates so the owner can
approve exact copy before any provider or send path exists.

## What exists now

- `server/services/customerMessageTemplates.ts` — five pure template
  builders (request received · availability confirmed · payment received
  · order ready · manual-lookup received). SMS ≤320 chars + email each.
- `nickActions.customerMessagePreviews` — read-only admin query rendering
  them against a sample order.
- Ops Hub → Message Previews tab — review surface, banner states clearly:
  "customer messages are NOT being sent automatically."
- **The send path does not exist:** `sendCustomerMessage()` always throws
  ("disabled by design") and nothing calls it. There is deliberately no
  env flag that can enable sending.
- Tests (`server/customer-message-templates.test.ts`) prove rendering,
  length bounds, claim safety (no "reserved"/"guaranteed"), and that the
  send path throws.

## Claim-safety rules baked into the copy

Staff confirms availability and fitment · payment does not reserve
supplier stock · drop-offs are first come, first serve · nothing implies
automatic supplier ordering or refunds.

## What enabling sends would require (separate, owner-approved PR)

1. Owner approves provider + cost (SMS: the existing F25e shop gateway or
   Twilio; email: a provider is configured for shop notifications today —
   customer email reuses it most cheaply).
2. Owner approves this exact copy (edit the templates first if not).
3. The send PR must add: per-order idempotency (one message per
   order+template), opt-out handling, a daily cap, an audit log row per
   send, and a kill-switch env var — and replace `sendCustomerMessage`.
4. TCPA note: transactional order messages to a number the customer just
   submitted are low-risk, but no marketing content may ride along.

## Wire points (future)

`placeOrder` → requestReceived · `updateOrder` confirmed → availability
Confirmed · `finalizeTireOrderPayment` → paymentReceived · `updateOrder`
delivered → orderReady. All exist as clean call sites already.
