-- 0051 — tire_orders: online-payment columns (Stripe Checkout)
--
-- Lets customers pay for a new-tire order online via Stripe Checkout
-- (hosted payment page). Until now tire_orders carried no payment state —
-- an order was logged with a "pending" invoice and the customer paid by
-- phone or in person.
--
--   invoiceNumber    — links the order to its auto-created invoice so the
--                      admin + order tracker can show payment state.
--   paymentStatus    — unpaid | paid | refunded. Defaults to 'unpaid' so
--                      every existing row is correct with no backfill.
--   stripeSessionId  — the Stripe Checkout Session id (audit + idempotency).
--   paidAt           — timestamp the online payment cleared.
--
-- All columns are additive and nullable/defaulted — existing rows and the
-- currently-deployed code keep working unchanged. Apply this BEFORE the
-- deploy that ships the gatewayTire.createCheckout procedure.
--
-- Safe to apply any time; TiDB ADD COLUMN is an online DDL.
--
-- ROLLBACK:
--   ALTER TABLE tire_orders
--     DROP COLUMN invoiceNumber, DROP COLUMN paymentStatus,
--     DROP COLUMN stripeSessionId, DROP COLUMN paidAt;

ALTER TABLE tire_orders
  ADD COLUMN invoiceNumber   VARCHAR(50)  NULL,
  ADD COLUMN paymentStatus   VARCHAR(20)  NOT NULL DEFAULT 'unpaid',
  ADD COLUMN stripeSessionId VARCHAR(255) NULL,
  ADD COLUMN paidAt          TIMESTAMP    NULL DEFAULT NULL;
