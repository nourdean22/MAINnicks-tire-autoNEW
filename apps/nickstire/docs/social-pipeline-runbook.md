# Social Pipeline — Operational Runbook

> Last updated: 2026-07-01. Covers all content generation, social publishing,
> reel pipeline, and SMS automation kill-switches.

## Architecture Overview

The social pipeline has **3 independent layers** of gating. Each layer must
be armed before content flows to the next stage:

```
Content Generation  →  Reel Pipeline  →  Live Publishing
    (DB flags)          (env vars)         (env + DB)
```

All gates default **OFF**. The operator enables them sequentially via the
admin Feature Flags panel (DB flags) or Railway env vars (env gates).

## Verified Meta execution path

Explicitly authorized Instagram publishing uses the existing Meta Graph
implementation in `server/services/metaSocial.ts`, called through the app's
social publish path. The browser is a review surface, not the production media
transport.

Required Meta configuration:

| Variable / store key | Purpose |
|---|---|
| `META_PAGE_ACCESS_TOKEN` | Page token used for Graph calls; the service can also load durable `app_secret_kv.meta_page_access_token` |
| `META_IG_USER_ID` | Linked Instagram Business Account ID |
| `META_PAGE_ID` | Facebook Page ID for Facebook targets |
| `META_PAGE_ACCESS_TOKEN_EXPIRES_AT` | Operator warning metadata when a renewal date is known |

Readiness is two-stage: presence is not validity. First report only whether
the configuration is present, then make a read-only Graph identity check for
the configured Instagram account. Never print or place a token in logs,
captions, URLs, artifacts, or operator messages. The repository `.env` is
discovery-only; production readiness must be verified through the deployed
app/status path or a live Graph readback.

For a finished reel, the media must be at a permanent public HTTPS URL before
Meta container creation. Use the configured durable media bucket and its
public object URL; Meta cannot fetch a local file path. Create a `REELS`
container with `share_to_feed=true`, poll `status_code` to `FINISHED`, call
`media_publish` once, and verify both the returned media ID and read-back
permalink. A timeout after dispatch is `publish_ambiguous`, not a safe retry.
Reconcile recent media or the publish-attempt ledger first.

Recurring batches remain approval-gated. A user request such as "post this
reel" or an explicitly configured publish run is required before any live
side effect.

---

## Quick Reference — All Kill-Switches

### Env-Backed Gates (set on Railway)

| Variable | Default | Controls | Armed When |
|----------|---------|----------|------------|
| `IG_AUTOPOST_DRYRUN` | dry-run ON | IG/FB live posting | Set to `"false"` |
| `REEL_GENERATION_ENABLED` | OFF | FFmpeg reel assembly | Set to `"true"` |
| `REEL_PUBLISH_ENABLED` | OFF | Reel publish gate in `publishToSocial()` | Set to `"true"` |
| `REEL_AUTOPOST_ENABLED` | OFF | Daily 9am ET auto-reel from manifest | Set to `"true"` |
| `CONTENT_REPLENISH_ENABLED` | OFF | Content reserve replenishment (2h cron) | Set to `"true"` |
| `SMS_KILL_SWITCH` | OFF | Blocks Twilio SMS path (shop gateway unaffected) | Set to `"true"` to block |
| `ENABLE_CUSTOMER_CONFIRMATIONS` | OFF | Customer confirmation SMS/email | Set to `"true"` |

### DB-Backed Feature Flags (toggle in admin panel)

| Flag Key | Controls | Risk |
|----------|----------|------|
| `legacy_autopost_live` | Allows live IG posting (still needs `IG_AUTOPOST_DRYRUN=false`) | Medium |
| `gbp_auto_posting` | GBP auto-poster (Telegram preview only — API deprecated) | Zero |
| `sms_review_requests` | Auto-send review request 3 days post-service | Low |
| `sms_retention_sequences` | 90/180/365 day re-engagement SMS | Low |
| `sms_appointment_reminders` | 24h/2h appointment reminder SMS | Low |
| `smart_sms_auto_reply` | Auto-reply to inbound SMS by intent | Medium |
| `nickgpt_low_risk_autosend_enabled` | Auto-send low-risk NickGPT SMS drafts | High |
| `drip_campaigns_enabled` | Multi-step automated drip campaigns | Medium |
| `drop_off_sms_flow` | Drop-off → status → pickup SMS sequence | Low |
| `predictive_maintenance_alerts` | Warranty/maintenance SMS alerts | Medium |
| `sms_cross_sell_outreach` | Proactive cross-sell SMS | Medium |
| `live_telegram_feed` | Real-time job notifications to Telegram | Zero |
| `daily_wins_digest` | EOD summary to Telegram | Zero |
| `weather_triggered_sms` | Auto-SMS lapsed customers on weather events | Medium |
| `photo_assess_enabled` | Photo-damage MMS pipeline | Medium |
| `outbound_voicemail_enabled` | Voice-clone audio generation | Medium |
| `nickgpt_drafter_enabled` | NickGPT fine-tuned SMS drafter (Ollama) | Low |
| `safety_monitor_enabled` | Safety monitor Telegram alerts | Zero |

---

## Enablement Waves (Recommended Order)

### Wave 1 — Zero-Risk Telegram Surfaces

**What:** Enable content generation that sends to Telegram only. Nothing
posts live.

| Step | Action | Where |
|------|--------|-------|
| 1A | Toggle `gbp_auto_posting` → ON | Admin → Feature Flags |
| 1B | Toggle `live_telegram_feed` → ON | Admin → Feature Flags |
| 1C | Toggle `daily_wins_digest` → ON | Admin → Feature Flags |
| 1D | Toggle `safety_monitor_enabled` → ON | Admin → Feature Flags |

**Verification:** Check Telegram bot channel within 24 hours for GBP post
previews and job close notifications.

### Wave 2 — IG Content Generation (Dry-Run)

**What:** Enable the IG autopost pipeline in dry-run mode. Posts generate
and go to Telegram for review — nothing posts to IG/FB.

| Step | Action | Where |
|------|--------|-------|
| 2A | Toggle `legacy_autopost_live` → ON | Admin → Feature Flags |

**Verification:** Wait for the next cron tick (~1 hour). Check Telegram
for IG post previews with caption + image. Review 5-10 posts for quality.

### Wave 3 — Live IG/FB Posting

**What:** Flip IG autopost from dry-run to live. Posts go to your real
IG/FB pages.

| Step | Action | Where |
|------|--------|-------|
| 3A | Verify Meta token status | Admin → Growth → Automation Armed State |
| 3B | Set `IG_AUTOPOST_DRYRUN=false` | Railway env vars |

**Prerequisites:**
- Wave 2 completed and 5-10 dry-run posts reviewed
- Meta Page Access Token valid (not expired or expiring within 14 days)
- `META_IG_USER_ID` set on Railway

**Verification:** After Railway restarts, watch the first 2-3 posts on
Telegram AND check they appear on IG/FB. Monitor for 48 hours.

**Rollback:** Set `IG_AUTOPOST_DRYRUN=true` on Railway. Additionally,
to fully disarm, delete the `meta_page_access_token` row from the
`app_secret_kv` table (the durable token survives env removal).

### Wave 4 — Reel Pipeline

**What:** Enable AI reel generation, publishing, and daily auto-posting.

| Step | Action | Where |
|------|--------|-------|
| 4A | Set `REEL_GENERATION_ENABLED=true` | Railway env vars |
| 4B | Review 3-5 generated reels in admin | Admin → Content |
| 4C | Set `REEL_PUBLISH_ENABLED=true` | Railway env vars |
| 4D | Set `REEL_AUTOPOST_ENABLED=true` | Railway env vars |

**Safety:** All reels pass the 75-point quality gate server-side. Captions
are claim-safe (no prices, no guarantees, no kill-words). The daily cron
posts max 1 reel per day with ET date idempotency.

**Verification:** After 4A, confirm reels appear as pending in the admin
content queue. After 4C, confirm first published reel on IG. After 4D,
confirm the daily 9am ET auto-post fires.

### Wave 5 — Content Manufacturing

| Step | Action | Where |
|------|--------|-------|
| 5A | Set `CONTENT_REPLENISH_ENABLED=true` | Railway env vars |
| 5B | *(removed 2026-10-10)* The inventory publisher cron and its `SOCIAL_INVENTORY_PUBLISH_ENABLED` flag were deleted in the Instagram audit (A1); the variable on Railway is inert and can be removed by the operator. | — |

### Wave 6 — SMS Automations (One at a Time)

**Critical:** Enable these ONE AT A TIME with 48-hour monitoring between each.

**Low-risk first:**
1. `sms_appointment_reminders` — standard, opt-out built in
2. `sms_review_requests` — opt-out + 1-per-customer cooldown
3. `sms_retention_sequences` — opt-out + segment-based
4. `drop_off_sms_flow` — only fires during active work orders

**Medium-risk:**
5. `drip_campaigns_enabled` — multi-step, review sequences first
6. `smart_sms_auto_reply` — auto-reply to inbound SMS
7. `predictive_maintenance_alerts` — requires service history quality
8. `sms_cross_sell_outreach` — requires affinity model training
9. `weather_triggered_sms` — requires weather API key

**High-risk (last):**
10. `nickgpt_low_risk_autosend_enabled` — requires `smart_sms_auto_reply` ON first

---

## Admin Status Endpoint

A unified status endpoint is available at:

```
GET /api/trpc/socialPipeline.status
```

Returns all env gates, DB flags, and composite readiness booleans in one
call. Use this to verify the current armed state before and after each wave.

---

## Rollback Procedures

### Emergency: Stop All Social Posting

1. Set `IG_AUTOPOST_DRYRUN=true` on Railway
2. Unset `REEL_PUBLISH_ENABLED` on Railway
3. Unset `REEL_AUTOPOST_ENABLED` on Railway
4. Toggle `legacy_autopost_live` → OFF in admin Feature Flags

### Emergency: Stop All SMS

1. Set `SMS_KILL_SWITCH=true` on Railway (blocks Twilio path only)
2. Toggle all SMS flags OFF in admin Feature Flags

### IG Token Expired

1. Renew the Meta Page Access Token (60-day long-lived token)
2. Set new token as `META_PAGE_ACCESS_TOKEN` on Railway
3. Token auto-persists to `app_secret_kv` table on first use
4. Verify via Admin → Growth → Automation Armed State
5. Perform a read-only Graph identity check and confirm the first post by
   media ID plus permalink; do not infer live validity from key presence alone.

---

## Monitoring Checklist

After enabling any wave, monitor these signals:

- [ ] Telegram bot channel for expected previews/notifications
- [ ] IG/FB page for live posts (after Wave 3+)
- [ ] Railway logs for errors in `ig-autopost`, `reel-pipeline`, `social-publish`
- [ ] Admin → Feature Flags for flag state confirmation
- [ ] Admin → Social Pipeline Status for composite readiness
- [ ] Customer opt-out rate (after SMS waves)
- [ ] Review request response rate (after `sms_review_requests`)
