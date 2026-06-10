# Tire Orders Cockpit

One admin destination for every online tire order. Consolidated 2026-06-10
from two parallel surfaces (PR #41's command center + PR #42's Money tab).

## Routes

- **Cockpit:** `/admin?tab=tireOrders` (sidebar → Tire Orders)
- **Legacy:** `/admin?tab=revenue&moneyTab=tireOrders` redirects to the
  cockpit — old bookmarks, Telegram links, and Overview alerts still work.
- The Overview payment-backlog alert deep-links straight to the cockpit.

## Staff workflow

Orders sort by next-action priority — the top card is always the next
move. Per order: confidence grade (how much to trust the quoted price),
risk flags, fulfillment timeline, and a Staff Action Card with the exact
instruction. Expand a card to update status, Gateway PO ref, expected
delivery, install date, and internal notes. Tap the phone number to call.

Lifecycle: received → confirmed → ordered → in_transit → delivered →
scheduled → installed (or cancelled).

## Warning banners (each appears only when real)

| Banner | Meaning | What to do |
|---|---|---|
| Stripe half-configured (red) | Charges succeed but paid events are DROPPED | Set `STRIPE_WEBHOOK_SECRET` on Railway same-day |
| Online payment OFF (amber) | `STRIPE_SECRET_KEY` unset; Pay Now degrades to call-to-pay | Restore the key if unintended |
| Sheets sync OFF (amber) | `GOOGLE_SHEETS_CRM_ID` unset; no CRM mirror | Cockpit + DB remain source of truth |
| PAID ORDERS WITH FAILED HAND-OFF (red) | Customer paid; email AND Telegram alerts both failed | Fulfil manually, then MARK HANDLED |
| CANCELLED + PAID — REFUND (red) | Cancelled order holds the customer's money | Refund in the Stripe dashboard (search the order #) — **refunds are not automatic** |
| OPEN CHECKOUT LINK on cancelled (amber) | An issued Stripe checkout page may stay payable ~24h | Expire the session in Stripe if in doubt |

Cancelling an order pops a confirmation; if the order is paid, it repeats
the refund instruction. Saving "cancelled" never moves money by itself.

## Google Sheets

Orders mirror to the CRM spreadsheet tab **`Tire Orders`** (24 columns,
headers set 2026-06-10). A missing tab drops the sheet row only — the
order, payment, and this cockpit are unaffected, and the server logs
exact fix instructions.

## Intentionally NOT automated

- **Supplier ordering** — staff order from Gateway (b2b.dktire.com) by
  hand and record the PO. Online payment does **not** reserve D&K stock.
- **Refunds** — Stripe dashboard only; nothing in the app moves money out.
- **Availability** — staff confirm with the customer before fulfilling;
  the D&K live feed cannot be re-checked at order time today.
