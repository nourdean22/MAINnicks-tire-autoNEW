# Competitor GBP Monitor

**Status (2026-10-25): live read built. `trpc.localGrowth.competitorSnapshot`
returns live Google ratings for Nick's and 15 competitors. The admin
Competitors tab is its consumer and is the client lane's next change.**

## What is read live, on demand
- `server/services/competitorMonitor.ts` `getCompetitorSnapshotCached()`, behind
  the admin-only procedure `localGrowth.competitorSnapshot`.
- Per listing: name, place_id, rating, total review count, and the times of the
  newest reviews Places returns (at most 5, `reviews_sort=newest`) as
  `recent: { count, newestAt, oldestAt }`. Read it as "N reviews between
  oldestAt and newestAt", never as a rate without that window.
- Each competitor carries `group`: `local` (Moe's Tire Center, St.Clair Tire,
  Bro's Tires, EJ'S Tire & Auto Repair, Confident Tire, Euclid Tire) or `chain`.
  Nick's own row is returned separately as `nicks`, with `rank` by rating and by
  volume over every row returned.
- Failures are `{ ok: false, reason }`: `unconfigured` (no key), `denied`
  (Google rejected the key, status in `message`), `error` (anything else). A
  failed read is never an empty list, and it is not cached.
- `localGrowth.reviewsHealth` now reports the real total (`totalReviews`) and
  rating. Before 2026-10-25 it counted the 5 reviews Places returns and showed
  "5 reviews".

## What is never stored
- The result lives in process memory for 60 minutes (same rule as
  `server/google-reviews.ts`), gone on restart. No rating, count, review time,
  review text or author name is written to the database, a file or a log.
- `competitor_snapshots` holds place_ids only (source `place_id`, Q-48,
  2026-09-23, issue #2614). No cron pre-fetches ratings.

## Why: Google's terms
- Google Maps Platform Service Specific Terms, "Last modified October 15,
  2026", https://cloud.google.com/maps-platform/terms/maps-service-terms
  section 3, Google ID Caching: "Customer may cache the Google ID values from
  the Services that return such field and allow caching ... (a) place_id from
  Places API". Section 14.3 allows caching Places latitude and longitude for up
  to 30 days. Ratings, counts and reviews have no carve-out.
- Places API policies (page updated 2026-10-23),
  https://developers.google.com/maps/documentation/places/web-service/policies:
  "You must not pre-fetch, cache, or store Places API content beyond the
  allowed exceptions"; place ID values may be stored indefinitely.

## Display rules for the tab
- Without a Google Map on the page, show the Google logo next to Places data.
- Reviews shown on screen must credit the author. This procedure returns no
  review text, so the tab shows counts and dates only.

## Retired
- The hand-typed 2026-06 baseline (`client/src/lib/competitorGbpMonitor.ts`)
  and the manual weekly check are deleted by the client lane in the same job.
