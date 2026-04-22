# Uptime Monitoring — Free External Watchdog

## Why

Railway self-healing catches most things. It doesn't catch Railway itself going
down. External monitors cover that gap. 30-second setup. Pays for itself the
first time production falls over at 3am.

## UptimeRobot Setup (free tier — 5-min interval, 50 monitors)

1. Sign up: https://uptimerobot.com (free)
2. Add monitor:
   - Name: `nickstire.org /api/health`
   - Type: HTTP(s) keyword
   - URL: `https://nickstire.org/api/health`
   - Keyword: `"status":"healthy"`
   - Interval: 5 minutes
   - Alert: email to `nourdean22@gmail.com` (or Telegram via their integration)
3. Add a second monitor for autonicks.com:
   - Name: `autonicks.com home`
   - Type: HTTP(s)
   - URL: `https://autonicks.com/`
   - Interval: 5 minutes
4. Add a third monitor for the most important public endpoint:
   - Name: `nickstire.org booking form`
   - Type: HTTP(s)
   - URL: `https://nickstire.org/book`
   - Interval: 10 minutes
5. Get a public status page (optional):
   - In UptimeRobot → Status Pages → New
   - Name: "Nick's Tire & Auto Status"
   - Custom URL: `stats.nickstire.org` (set as CNAME later if wanted)
   - Include the 3 monitors above

## Healthchecks.io Setup (for cron heartbeats)

Use for jobs whose **absence** is the problem (e.g. the daily report never sent).

1. Sign up: https://healthchecks.io (free tier: 20 checks)
2. For each daily / 2hr critical cron:
   - Create a check
   - Get the ping URL (e.g. `https://hc-ping.com/abc123`)
   - At end of the cron handler, `fetch(pingUrl)` on success
3. If the ping doesn't land within the grace period, Healthchecks alerts.

Candidate crons to wire heartbeats to:
- `daily-report` (daily)
- `shopdriver-mirror` (15min — high grace)
- `review-monitor` (2hr)
- `retention-sequences` (daily)

## Status Badge on Admin

Ping UptimeRobot's read-only status API from an admin query and show a green
dot + last-incident count in the OverviewSection header. Badge URL:

```
https://api.uptimerobot.com/v2/getMonitors (with API key)
```

**T6.2 deliverable**: build this as a tRPC query `controlCenter.uptimeStatus`
that hits the UptimeRobot API server-side (so the API key stays server-side)
and returns `{ up, lastIncidentAt, incidentsLast7d }`.

## Cost

$0. UptimeRobot free tier is enough. Healthchecks free tier is enough.
If we outgrow: BetterStack ($29/mo), Sentry Error + Uptime bundle.

## Incident Runbook (when the alert fires)

1. Check Railway dashboard → restart if hung.
2. Check `/api/health` — which component is "down"?
3. Check recent deploys → any deploy in the last hour?
4. Check Cloudflare / Railway status pages.
5. If DB down: check TiDB dashboard, run recovery.
6. If AI gateway down: Venice or OpenAI outage — check circuit breaker state.
7. Post update in internal channel, track to resolution.
