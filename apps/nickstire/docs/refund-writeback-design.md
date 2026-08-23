# Refund / Writeback — Specification (APPROVED & LIVE)

Status: **APPROVED & LIVE** (as of 2026-06-29 under operator authorization).

## The manual workflow this REPLACED (pre-2026-06-29 — not current)

> **Frame marker added 2026-08-23.** Everything in this section describes the
> state BEFORE the writeback shipped, and it was written in the present tense
> under a heading reading "Today's". The header of this file has said
> "APPROVED & LIVE" since 2026-06-29, so the document asserted both states at
> once and the doc-claim sweep flagged the stale half — correctly.
>
> Specifically, *"Nothing writes back: `tire_orders.paymentStatus` stays `paid`
> (the `refunded` enum value exists but has no writer)"* is **false on
> `origin/main` today.** Measured; reproduce with
> `git grep -n "processStripeRefundEvent\|paymentStatus: \"refunded\"" -- apps/nickstire`:
>
> - `server/_core/index.ts:977` updates **`tireOrders`** — the exact table named
>   — with `.set({ paymentStatus: "refunded" })` from the `charge.refunded`
>   webhook, so out-of-band Stripe refunds sync back.
> - `:984` delegates invoice status and ShopDriver sync to
>   `services/refundWriteback.ts` → `processStripeRefundEvent`.
> - Three test files cover it: `refundWriteback.test.ts`,
>   `refund.integration.test.ts`, `triggerRefund.test.ts`.
>
> Kept rather than deleted: the before-state is why the design exists, and a
> spec with its motivation removed reads as arbitrary. But it needed a frame,
> because "Today's ... the only refund path" is the exact sentence shape that
> closes a search.


1. The Tire Orders cockpit flags cancelled-but-PAID orders (red banner +
   top-priority chip) and warns at cancel time.
2. Staff opens the Stripe dashboard → Payments → searches the order
   number (it's in payment metadata) → verifies eligibility → issues the
   refund by hand.
3. Nothing writes back: `tire_orders.paymentStatus` stays `paid` (the
   `refunded` enum value exists but has no writer). The banner clears only
   when staff knows it's handled.

## Implemented mutation (Approved & Shipped)

`gatewayTire.refundOrder` (adminProcedure):

- **Input:** `{ orderId, reason }` — amount always derived server-side
  from the Stripe PaymentIntent, never client-supplied.
- **Lookup:** resolve the order's `stripeSessionId` → PaymentIntent;
  refuse if `paymentStatus !== "paid"` or a refund already exists.
- **Idempotency:** pass `idempotencyKey: "refund-" + orderNumber` to
  Stripe so retries can never double-refund; also guard with an atomic
  conditional UPDATE (`paymentStatus = 'paid' → 'refunded'`) using the
  same claim pattern as `finalizeTireOrderPayment`.
- **Writeback:** on Stripe success set `paymentStatus: "refunded"`,
  append an admin note (who/when/why), update the linked invoice.
- **Confirmation gate:** in-DOM dialog (PWA-safe) restating amount +
  customer; the button is the ONLY caller.
- **Audit trail:** one row per attempt (actor, order, amount, Stripe
  refund id, outcome) — happens even on failure.
- **Webhook interaction:** subscribe to `charge.refunded` as belt-and-
  suspenders writeback if a refund is issued from the dashboard instead.
- **Rollback:** feature lives behind its own procedure; reverting the PR
  removes the capability cleanly. No schema change required
  (`paymentStatus` is varchar; `refunded` already modeled).

## Test strategy

Unit: claim guard (paid→refunded once), idempotency-key derivation,
refusal matrix (unpaid / already refunded / missing session). Mocked
Stripe adapter; live-mode test only via Stripe test keys locally.

## Why not enabled yet

It moves real money out. The owner must approve: the mutation shape
above, who may trigger it, and Stripe API key permissions (refund scope).
Approve by saying so on the future PR — nothing activates before that.
