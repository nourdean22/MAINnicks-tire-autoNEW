# Forensic Bug Audit — July 2026

A read-only forensic audit of both apps (statenour + nickstire) that turned into
**56 verified bug fixes + 2 schema backstops**, all merged and (for the migrations)
applied to prod. This is the durable record; the per-change detail lives in the
PRs and commit messages.

## Method

- Read-only fan-out across every surface (API/middleware, crons, AI/SMS/VAPI
  pipelines, client PWA UI, DB layer, integrations) per app.
- **Adversarial verify-first**: every CRITICAL/HIGH finding was independently
  re-derived and attacked before it was accepted. This refuted 1 finding and
  caught **6 regressions in the fixes themselves** before they shipped (a
  golden-test opt-out flip, a pgvector over-correction, a type error, a
  shadow-mode gate mis-trace, and the `Order`-vs-`orders` migration index-name
  error).
- Fixed in verified waves; each wave typechecked (both apps) + ran targeted
  tests, and merged only when green.

## Results

| Severity | Fixed | Notable |
|---|---|---|
| CRITICAL | 4 | chat conversation misfiling · cron daily-tier restart-loop re-texting customers · campaign "Send to 5" blast-radius · SMS phone-format linchpin (E.164 vs 10-digit) + TCPA opt-out |
| HIGH | 19 | Messenger HMAC · confirmPayment replay/idempotency · cron zombie-lock double-fire · reasoning-engine dead tool data · calendar timezone · Stripe webhook fail-closed · GSC fabricated metrics · pgvector cache-poison |
| MEDIUM | 31 | five root themes: ET/UTC dates, silent-success crons, webhook fail-open, missing external-call timeouts, fabricated mock data — plus prompt-injection fencing, provider mis-routing, per-key debounce, non-atomic idempotency, spinner-forever states |
| LOW | 2 | middleware prefix over-match · vector-literal NaN sanitize |

**PRs:** #495 (waves 1–3), #496 (wave 4), #497–#501 (MEDIUM waves 5a–5e),
#502 (inbound auto-reply), #503 (nuanced MEDIUM wave 6), #504 (migrations).

## Operator decisions taken during the audit

1. **Loyalty award-by-phone RETIRED.** It credited a random `users` row
   (`customers.id` passed where a `users.id` was expected) — there is no correct
   customer→user bridge, so the server proc is a clear-erroring stub and the
   admin UI panel was removed. Reward-catalog management stays.
2. **Inbound SMS auto-replies ENABLED.** `getRolloutMode` now defaults
   `inbound_sms` to `live_send` (was `shadow`, which never sent). See the new
   invariant in [known-risks.md](./known-risks.md) — auto-send is still gated by
   two feature flags + low-risk classification + the opt-out cache.

## Schema backstops (applied to prod)

- `orders.stripe_session_id` **UNIQUE** (statenour/Neon) — backstops the Stripe
  webhook idempotency guard against a concurrent double-delivery race.
- `invoices.uniq_invoice_booking` **UNIQUE** on `bookingId` (nickstire/TiDB) —
  backstops the `autoCreateInvoiceFromBooking` dedup guard.
- Both pre-checks were clean (the app-level guards had kept the data dup-free).
  A speculative `invoices.refundedAmount` column was intentionally **skipped**
  (YAGNI) — the refund fix handles partial-vs-full via `paymentStatus`.

## Known limitation / follow-up

- Inbound auto-replies only fire once the operator turns ON both
  `smart_sms_auto_reply` and `nickgpt_low_risk_autosend_enabled` in the admin
  Feature Flags panel (both default OFF by design — see `AUTO_ENABLE_FLAGS = []`).
