# Customer Confirmation Notifications — PREVIEW BY DEFAULT

Status: **whether anything sends depends on one env var, not on the code.** The
send path EXISTS, has two callers, and dry-runs unless
`ENABLE_CUSTOMER_CONFIRMATIONS === "true"`. Code verified 2026-08-23 against
`origin/main`; receipts below.

**This document does NOT assert the live value of that flag**, and no document
should: a flag value written into prose is a cache with no invalidation. Read it
with `apps/nickstire/scripts/probe-live-send-flags.mjs`, which exists for exactly
this question. An earlier draft of this very correction claimed the flag "is not
set to true" -- an unverified assertion, written while fixing unverified
assertions, on the surface where being wrong sends real SMS to real customers.

The service's own header comment
(`server/services/customerMessageTemplates.ts:148`) has always said this
correctly. Only this document claimed otherwise -- which is the more dangerous
place for it to be wrong, because a reader checking whether sending is possible
comes here first.

## What exists now

- `server/services/customerMessageTemplates.ts` — five pure template
  builders (request received · availability confirmed · payment received
  · order ready · manual-lookup received). SMS ≤320 chars + email each.
- `nickActions.customerMessagePreviews` — read-only admin query rendering
  them against a sample order.
- Ops Hub → Message Previews tab — review surface, banner states clearly:
  "customer messages are NOT being sent automatically."
- **The send path EXISTS and is env-gated.** Measured against `origin/main`
  2026-08-23; reproduce with
  `git grep -n "sendCustomerMessage\|ENABLE_CUSTOMER_CONFIRMATIONS" -- apps/nickstire`.
  - `sendCustomerMessage()` (`server/services/customerMessageTemplates.ts:151`)
    is a full implementation: it loads the order, renders the template, and
    calls `sendSms()` at `:216`.
  - It is gated by `ENABLE_CUSTOMER_CONFIRMATIONS === "true"` (`:155`). The
    guard is real and returns BEFORE the send: `if (!isEnabled)` at `:189`
    returns `{ dryRun: true }` at `:196` -- twenty-seven lines above the
    `sendSms` call, so the guard cannot be reached past.
  - **Two live callers**, both dynamic imports in
    `server/routers/gatewayTire.ts` — `:858` and `:1284`.
  - So nothing sends today **because the flag is off**, not because the path
    is absent. That distinction is the whole safety margin.
- Tests (`server/customer-message-templates.test.ts`) prove rendering, length
  bounds, claim safety (no "reserved"/"guaranteed"), and the dry-run path.

> **CORRECTED 2026-08-23 — the previous three sentences were all false**, and
> dangerously so on a customer-SMS surface. They read: *"The send path does not
> exist: `sendCustomerMessage()` always throws ("disabled by design") and
> nothing calls it. There is deliberately no env flag that can enable
> sending."* Measured: the function does not throw, it has two callers, and
> `ENABLE_CUSTOMER_CONFIRMATIONS` is exactly the env flag the sentence denied
> existing — `apps/nickstire/docs/social-pipeline-runbook.md:69` documents that
> same flag with "Set to `true`" to enable, so two docs in one app contradicted
> each other about whether customer SMS can be turned on.
>
> The damage of the old wording was not that it was wrong, it is that it
> **closed the question**: a reader checking "can this send?" got a confident
> no naming a mechanism that does not exist, and would have had no reason to
> treat `ENABLE_CUSTOMER_CONFIRMATIONS` as a protected flag. It is listed in
> `scripts/probe-live-send-flags.mjs` precisely because it is one.

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
