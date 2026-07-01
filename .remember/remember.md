# Session Handoff — 2026-07-01

## What Was Shipped

### PR #459 — Social Pipeline Status Endpoint + Runbook (merged → main)
- `server/routers/socialPipeline.ts` — unified admin tRPC query showing 8 env gates + 18 DB flags + composite readiness booleans
- `server/socialPipeline.test.ts` — 5 tests for env gate logic
- `docs/social-pipeline-runbook.md` — 206-line operational runbook with 6-wave phased enablement, rollback procedures, monitoring checklist

### PR #460 (pending) — Social Pipeline Admin UI
- `client/src/pages/admin/GrowthSection.tsx` — added `SocialPipelineHealth` component to LocalGrowthTab showing real-time flag status (env gates + DB flags + composite readiness) with 60s auto-refresh

## Current State of Flags
All social pipeline flags are currently **OFF** (default safe state). The operator needs to flip them per the runbook waves:
- Wave 1 (zero risk): `gbp_auto_posting`, `live_telegram_feed`, `daily_wins_digest`, `safety_monitor_enabled`
- Wave 2 (dry-run): `legacy_autopost_live`
- Wave 3 (live): `IG_AUTOPOST_DRYRUN=false` on Railway
- Wave 4 (reels): `REEL_GENERATION_ENABLED`, `REEL_PUBLISH_ENABLED`, `REEL_AUTOPOST_ENABLED` on Railway
- Waves 5-6: Content manufacturing + SMS flags

## Key Technical Details
- `IG_AUTOPOST_DRYRUN` has **inverted logic**: armed for live posting only when explicitly `"false"`
- **Disarm gotcha**: deleting the env var does NOT stop live IG posting — must also clear `meta_page_access_token` from `app_secret_kv` table
- `SMS_KILL_SWITCH` also inverted: Twilio path is open when NOT `"true"`

## Remaining Backlog
- [ ] D&K: get new portal API docs/credentials from the rep (operator-blocked)
- [ ] AEO Brand Radar baseline (blocked — Ahrefs units=0)
- [ ] Social pipeline Wave 1+ flag flipping (operator action via admin panel + Railway)
