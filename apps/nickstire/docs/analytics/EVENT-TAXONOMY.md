# nickstire event taxonomy — customer_events source of truth

> Generated 2026-07-28 from a code scan of `client/src` `trackEvent("…")`
> call sites (30 distinct events). The persisted store is the
> `customer_events` table (funnel source of truth — GA4 mirrors, umami is
> dead); the `/api/analytics/conversion` hook writes rows with
> `eventData.source="conversion_hook"` and full UTM/session attribution.
> Before ADDING an event, grep this list — 2026-07-28's gap-fill attempt
> found its "missing" events (directions_click, financing clicks) already
> wired; the gap was discoverability, which this file closes.

## Conventions

- **Names:** snake_case, `<subject>_<action>` (`financing_apply_click`).
- **Attribution:** UTM params are captured automatically at event time
  (`utmSource/utmMedium/utmCampaign` columns). `sourcePage` is pathname
  only.
- **QR codes** (truck, counter cards, flyers): encode
  `https://nickstire.org/<page>?utm_source=qr&utm_medium=offline&utm_campaign=<placement>`
  — e.g. `utm_campaign=truck-door`, `counter-card`, `flyer-euclid`.
  No new event needed: every existing event fired in that session
  carries the QR attribution.
- **Known limitation:** `financing_completed` cannot be tracked
  client-side — approval finishes on Snap/Acima/Koalafi's own sites.
  `financing_apply_click` is the last observable step; anything deeper
  needs provider webhooks (not built; do not fake it with a proxy
  event).

## Inventory (30 events, from code)

- `acima_apply_click`
- `booking_cta_click`
- `brake_cta_click`
- `diagnose_booking_click`
- `diagnose_check_completed`
- `diagnose_check_failed`
- `diagnose_check_started`
- `diagnose_cta_click`
- `diagnose_directions_click`
- `diagnose_dropoff_link_click`
- `directions_click`
- `emissions_payment_options_click`
- `ezytire_tab_changed`
- `ezytire_widget_loaded`
- `financing_apply_click`
- `financing_compare_click`
- `form_completed`
- `hero_tertiary_cta_click`
- `nonstop_join_start`
- `nonstop_nick_hook_click`
- `nonstop_sunday_cta_click`
- `nonstop_topbar_click`
- `ribbon_photo_view`
- `services_cta_click`
- `sms_click`
- `sms_quote_click`
- `tire_option_selected`
- `tire_order_modal_opened`
- `tire_quote_cta_click`
- `tire_search_submitted`
