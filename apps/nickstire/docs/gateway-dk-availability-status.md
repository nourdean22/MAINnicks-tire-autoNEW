# Gateway / D&K Availability — Status (2026-06-10)

Status: **live feed DOWN · pipeline cache WORKING · no supplier ordering
exists in code · repair BLOCKED on external access.**

## What is true right now

- **What broke:** Dunlap & Kyle migrated b2b.dktire.com to a static SPA
  in 2026; the auth endpoint our `server/services/gatewayClient.ts`
  POSTs credentials to is gone (only `/token` + `/quicksearch` paths
  exist in our client — there has never been an ordering endpoint).
- **What works:** the daily pipeline cron still populates the price
  cache. Live QA 2026-06-10: a clean 205/55R16 search returned 15 real
  D&K tires (LANDSAIL/KENDA/KUMHO/LAUFENN…) at real per-size prices.
- **Fallback chain:** pipeline cache → curated catalog (fixed, size-blind
  prices) with an honest amber banner routing customers to a phone quote.
- **Hard consequence:** order-time availability rechecks are impossible —
  a customer can pay for a tire whose warehouse stock changed. Mitigated
  by instant staff alerts + "staff confirms availability" copy everywhere.
- **Known sharp edges:** `PRICE_CACHE_TTL` (4h) vs daily cron leaves the
  re-derivation cache cold most of the day (price-guard falls to the $50
  floor then); a transient miss caches catalog results for 15 min.

## What the owner/vendor must provide (the blocker)

1. Current D&K/Gateway API documentation for the new portal.
2. Working API credentials (or a dealer-rep contact who can issue them).
3. Confirmation whether an availability/stock endpoint exists at all.

## Repair plan (after access)

Separate PR: new auth adapter in `gatewayClient.ts` → restore live
search → add order-time `on_hand` recheck in `placeOrder` → persist
`dk_part_number` (needs an additive migration — proposal first).
**No supplier auto-ordering** is planned without its own approval.

## Operating rule until then

Estimates do not guarantee stock. Staff confirms availability with the
customer before fulfilling — this is stated on /tires, in the cockpit,
and in every message template.
