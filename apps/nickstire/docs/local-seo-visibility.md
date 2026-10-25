# Local SEO Visibility — Rank Tracker, Post Verification, Reviews & GSC

**Status: LIVE READ SURFACES. The search-position card, the armed-state
and the reviews-health checks are live read-only endpoints (2026-10-25).**

## 1. Search position per tracked keyword (LIVE — `trpc.localGrowth.targetKeywordRanks`)
The keyword list lives in `shared/localRankKeywords.ts` (the 15 curated
targets plus the 8 service queries Google already shows the shop for;
the old client model file and its unmeasured report shape are deleted).
`server/pipelines/targetKeywordRanks.ts`
reads the shop's own stored Search Console rows: two 28-day windows ending
the newest stored date, impression-weighted position across pages, devices
and countries, exact lowercase match, a change only when both windows carry
30 or more impressions, one action per keyword. A keyword with no recorded
impression has NO position (Google records a position only with an
impression, and about 93% of query impressions are anonymised), so the card
says "No recorded impressions", never a rank. Thresholds are named constants
in that file, adopted as rulings on 2026-10-25.

## 2. GBP post verification (manual weekly checklist)
GBP Posts API was deprecated in 2024 — `gbpAutoPost` can only generate
copy-paste text. So "verification" is a manual weekly check:
- How many posts are live and visible on the profile?
- Date of the latest post (anything > 7 days = post something).
- Any expired/old posts to refresh?
- Recommended next post (use the gbpContentGenerator output).
- Owner action needed?

## 3. Reviews / Place ID health (LIVE — `trpc.localGrowth.reviewsHealth`)
Read-only booleans + status: Maps/Places key present? live reviews
reachable, or has it silently fallen back to curated/DB stats? Surfaces
the audit's NOT_FOUND concern. **No keys are ever returned.**

## 4. Automation armed-state (LIVE — `trpc.localGrowth.automationArmedState`)
Answers "is the IG autoposter actually armed?" with booleans only:
`dryRun`, `envTokenPresent`, **`durableTokenPresent`** (the sweep's gotcha
— a token survives in the `app_secret_kv` row even after env removal),
`igUserIdPresent`, and the derived `couldPostLiveNow`. Includes the honest
disarm rule so nobody trusts deleting the env var alone.

## 5. GSC env-aliasing fix (shipped this PR)
`server/_core/index.ts` no longer gates the `GOOGLE_SEARCH_CONSOLE_KEY`
"configured" marker on `GOOGLE_MAPS_API_KEY`. GSC auths via the service
account; the marker now derives only from
`GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_KEY`. Losing the
Maps key no longer silently stops Search Console syncing.

## Safety
No scraping, no fabricated ranks, no posting, no key values printed. The
two `localGrowth` endpoints are read-only and admin-gated.
