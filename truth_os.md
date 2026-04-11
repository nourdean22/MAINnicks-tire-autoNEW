# Truth OS — nickstire.org (living snapshot)

**Purpose:** Single place to record what must be **true in production** for this repo. Update when you ship behavior or infra changes.

## Canonical business facts (code)

- **Address:** `17625 Euclid Ave, Cleveland, OH 44112` — source: `shared/business.ts` (`BUSINESS.address`).
- **Phone:** `(216) 862-0005` — source: `shared/business.ts`.
- **Public site:** `SITE_URL` env, default `https://nickstire.org`.
- **Review marketing line:** `BUSINESS.reviews` (`rating`, `count`, `countDisplay`) — canonical marketing floor. Live totals and admin overrides are merged in code (see below).

## Google review count (single rule)

**Display count = max(marketing floor, live Google, admin override).**

- **Marketing floor:** `BUSINESS.reviews.count` in `shared/business.ts` (and `countDisplay` for static trust copy).
- **Live Google:** Places `user_ratings_total` when the Maps API returns a positive value (`server/google-reviews.ts`).
- **Admin:** `shop_settings` keys `reviewCount` / `reviewRating` when set.

Implementation: `resolveReviewDisplay()` in `shared/business.ts`; `getGoogleReviews()` applies it on both API-success and DB fallback paths so the public site and admin health panel never show a total below the floor when GBP lags, and can show a higher number when Google or admin is ahead.

## Deploy

- **nickstire.org:** Railway (not Vercel for this app).
- **Build:** `pnpm run build`; full static SEO path: `pnpm run build:prerender`.

### Production: migration `0026` + Railway redeploy

1. **Apply SQL** `drizzle/0026_work_order_items_decline_recovery.sql` to production MySQL/TiDB (Railway database). Use your normal migration path (`drizzle-kit migrate`, or run the SQL file in the host’s SQL console). Required before declined-line `decline_outreach_*` / `decline_recovered_at` fields are trustworthy.
2. **Redeploy** the Railway nickstire service from the commit that contains the matching application code, then smoke-test booking/admin and declined-work flows.
3. **Optional check:** cron `statenourSync` should POST `200` to `STATENOUR_SYNC_URL` `/api/sync/business` (see `server/cron/jobs/statenourSync.ts`).

## Migrations pending awareness

- **`0026_work_order_items_decline_recovery.sql`** — adds `decline_outreach_*` and `decline_recovered_at` on `work_order_items` for declined-work recovery tracking. Apply to prod DB before relying on outreach/recovered fields.

## Invariants (do not break)

- **ShopDriver / ALG** integration is load-bearing for shop operations — do not remove without explicit owner decision.
- **Feature flags:** risky features should default off at the code path until explicitly enabled in DB.
