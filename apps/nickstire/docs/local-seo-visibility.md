# Local SEO Visibility — Rank Tracker, Post Verification, Reviews & GSC

**Status: MODEL + READ SURFACE. Rank tracking is manual/future-API; the
armed-state and reviews-health checks are live read-only endpoints.**

## 1. Local rank tracker (model — `client/src/lib/localRankKeywords.ts`)
15 target keywords across auto-repair / tires / brakes / diagnostics /
emissions / oil / suspension / local-Euclid. `emptyRankReport()` returns
one row per keyword with `rank: null, source: "unmeasured"` — **ranks are
never fabricated.** Fill from GSC average position (already synced) or a
manual SERP check; record the source on each row.

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
