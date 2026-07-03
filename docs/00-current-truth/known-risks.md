# Known Risks & Architectural Constraints

This document lists critical technical constraints, API failure recovery rules, and frontend quirks that must be respected during all development cycles.

---

## ⚡ 1. Google Places Cache Lock & Social Proof Failback

In Nick’s Tire review engine (`apps/nickstire/server/google-reviews.ts`):
*   **Behavior**: The system queries Google Places API. If the API key fails or duns, it increments a `failCount`. If `failCount >= 3`, it locks the cache for `MAX_FAIL_BACKOFF * failCount`.
*   **Mitigation**: During cache locks, the site falls back to rendering static metrics (`reviewCount` and `reviewRating`) from the `shop_settings` DB table. These values must be kept up-to-date to prevent zeroed-out reviews on the customer site.

---

## 📱 2. iOS PWA suppressed Alert and Dialog Suppressions

Both applications are configured to run as **standalone iOS PWAs**:
*   **Behavior**: iOS PWAs suppress standard browser dialogs (`window.alert()`, `window.confirm()`, and `window.prompt()`) completely. Triggering them results in silent failure.
*   **Mitigation**: Always implement in-DOM confirmation prompts (such as a two-tap pattern or custom HTML modal dialogs) instead of native browser prompts.

---

## 🔒 3. SSRF Protections in Scraper Integrations

The web scraper system (`lib/integrations/firecrawl.ts`) uses Firecrawl to parse URL targets:
*   **Constraint**: Standard SSRF defenses are implemented to check that the URL resolver points to a public IP. Do not query internal loopback addresses or internal domain endpoints.

---

## 💾 4. Postgres pgvector Index Migration Risks

Statenour's database utilizes `pgvector` for memory-search vector recall:
*   **Constraint**: Prisma migrations do not natively support database-specific vector index creation without manual SQL customization. Hand-apply prisma schemas carefully to avoid dropping the `pgvector` index.

---

## 🔁 5. Idempotency backstops are DB UNIQUE constraints + app-level guards (both required)

Two payment/order paths rely on a **two-layer** dedup (added in the July-2026 forensic audit):
*   **Constraint**: `orders.stripe_session_id` (statenour/Neon) and `invoices.bookingId` (`uniq_invoice_booking`, nickstire/TiDB) are **UNIQUE**. The app-level guards — the Stripe webhook's find-or-skip and `autoCreateInvoiceFromBooking`'s existing-invoice check — are the primary defense; the UNIQUE indexes are the backstop against a concurrent race. **Do not remove either layer.** Both columns are nullable, so multiple NULLs are allowed (non-Stripe / non-booking rows are unaffected).

---

## 📨 6. Inbound SMS auto-replies are LIVE by default but flag-gated

`smsOrchestrator.getRolloutMode` defaults `inbound_sms` to `live_send` (was `shadow`):
*   **Constraint**: The rollout mode alone does **not** send anything. An inbound auto-reply fires only when BOTH `smart_sms_auto_reply` and `nickgpt_low_risk_autosend_enabled` feature flags are ON (both default OFF — `AUTO_ENABLE_FLAGS = []`), the message classifies as low-risk (≥0.85), it is not a complaint/legal intent, and the number is not opted out. Complaints and complex/low-confidence intents route to human review. A `sms_orch_inbound_sms_mode` row in `appSecretKv` overrides the default.
