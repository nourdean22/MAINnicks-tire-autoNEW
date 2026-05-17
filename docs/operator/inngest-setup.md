# Inngest setup · operator runbook

> **For**: the operator (Nour) · personal OS deploy at autonicks.com
> **Audience**: someone who's never used Inngest, has 10 minutes,
> wants the cutover done.

Inngest is the durable workflow control plane that runs the 4
WAVE-200 functions. The CODE is already shipped (see Phase 3 +
Phase 5 + Phase 6 entries in WAVE-200-PLAN.md). This runbook covers
the operator action items: account setup, env vars, dashboard wiring,
and the Railway cron decommission.

---

## What you get when you finish this runbook

- **Mega cron fan-out** (morning + evening) runs through Inngest with
  per-step retry · replay button · per-step failure visibility
- **Operator morning brief** delivers via Web Push + Cartesia audio
  (in addition to the existing Telegram push)
- **Customer preferences** recompute nightly for the last-90-day
  active customers · feeds the morning brief annotations
- **Telegram alerts** fire automatically when any Inngest function
  exhausts its retries · no more silent failures

Cost at our volume: $0/month (free tier covers ~1,800 runs/month vs
the 50,000/month free cap).

---

## 5-step setup

### 1 · Create the Inngest account

1. Go to **https://app.inngest.com**
2. Sign up with the operator's Google account (`nourdean22@gmail.com`)
3. Free tier · no credit card needed

### 2 · Create the app

1. Inngest dashboard → **Apps** → **Create app**
2. Name: **`statenour-web`**
3. Environment: **production**
4. Click create · the dashboard shows two keys: **Event Key** + **Signing Key**

### 3 · Paste the keys into Railway

For each key, run (or use the Railway dashboard UI):

```bash
railway variables set INNGEST_EVENT_KEY="<paste-event-key>" --service statenour-web
railway variables set INNGEST_SIGNING_KEY="<paste-signing-key>" --service statenour-web
```

Railway will auto-redeploy the service. Wait ~2 minutes for the new
deploy to go live.

### 4 · Connect the serve endpoint

1. Inngest dashboard → **Apps** → **`statenour-web`** → **Sync**
2. Paste: **`https://autonicks.com/api/inngest`**
3. Click **Sync app**
4. Inngest probes the endpoint via PUT · validates the signing key ·
   discovers all 4 functions

Verify on the dashboard:
- `mega-fanout-morning` (cron `0 9 * * *`)
- `mega-fanout-evening` (cron `0 3 * * *`)
- `operator-morning-brief` (cron `0 10 * * *`)
- `customer-preferences-recompute` (cron `0 11 * * *`)

If a function is missing, the sync failed · re-check the keys + URL.

### 5 · Verify the first scheduled run

After the next scheduled trigger (next 03:00 UTC for evening or 09:00
UTC for morning), the dashboard should show a run with green steps.

Cross-check against `https://autonicks.com/system/crons` · the
`/api/cron/mega` row should ALSO have a row for the same window
(legacy fan-out is still firing in parallel · expected during cutover).

---

## After 7 consecutive successful Inngest runs

The legacy `/api/cron/mega` route stays in place during the cutover
window. Once you have 7 days of green Inngest runs, decommission the
Railway cron:

1. Railway dashboard → **statenour-web** → **Settings** → **Cron**
2. Find the entries for `/api/cron/mega?slot=morning` and `?slot=evening`
3. **Disable** (not delete · keep them as a 1-click rollback if needed)

Rollback (anytime):
- Disable the Inngest app from the dashboard (or remove
  `INNGEST_EVENT_KEY` from Railway env)
- Re-enable the Railway cron entries
- Both paths share the same child cron URLs · zero data loss

---

## Local development

Test functions locally before they ever run in prod:

```bash
# Terminal 1 · run the Next.js dev server
pnpm --filter @statenour/web dev

# Terminal 2 · run the Inngest dev runner
pnpm --filter @statenour/web inngest:dev
```

The dev runner opens at **http://localhost:8288** · you can:
- Trigger any function manually
- Step through runs · see each step.run checkpoint
- View errors with full context
- Replay failed runs

The dev runner uses NO Inngest cloud account · purely local.

---

## Failure alerts

Every function has `onFailure: onInngestFailure` wired. When a function
exhausts its retries:

1. Inngest fires the failure handler
2. Handler formats a Telegram message: `⚠️ Inngest failure · <fn> · <err>`
3. Sent via the existing `sendTelegram` pipeline (wave-103 SMS gateway)

Requires `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` env vars (already
set per wave-103). No additional config needed.

If you want to test the alert without actually breaking a function,
trigger a function manually via the dashboard and watch the Telegram
chat as it intentionally fails on bad input.

---

## Health check

Visit `https://autonicks.com/api/inngest` (or the local equivalent) to
see the current state:

- **`{"ok": false, "configured": false}`** · keys not set yet
- **`{"ok": true, "configured": true, "functions": [...]}`** · ready

The endpoint also serves Inngest's own probes (GET + POST + PUT) ·
the friendly JSON only fires when Inngest hasn't yet connected.

---

## Troubleshooting

### "Inngest can't reach my endpoint"

- Verify `https://autonicks.com/api/inngest` returns 200 (or 503 with
  config hint when keys missing)
- Check Railway logs for the deploy that should have picked up the
  env vars · the dashboard sync runs through the live deployment

### "My function ran but Telegram didn't fire"

- The failure handler only fires after **all retries exhaust** (not
  on a single retry). Check the dashboard for the run state.
- Verify `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` are set
- Look for `[inngest/on-failure]` lines in `/system/logs`

### "I see double runs · once via Inngest, once via Railway cron"

- Expected during the cutover window. After 7 days of green Inngest,
  disable the Railway cron entries per step above.

### "I want to add a new mega-cron child"

- Edit `apps/statenour/src/inngest/jobs.ts` · add the URL to the right
  array (MORNING_JOBS · EVENING_JOBS · WEEKLY_JOBS)
- BOTH the legacy `/api/cron/mega` route and the Inngest fan-out
  function pick it up automatically · single source of truth

---

## References

- ADR-0005 · `docs/adr/0005-inngest-durable-workflows.md` · adoption
  decision + rejected alternatives
- ADR-0007 · `docs/adr/0007-morning-brief-multichannel.md` · morning
  brief workflow that runs on Inngest
- ADR-0008 · `docs/adr/0008-customer-360-predictive-brain.md` ·
  customer preferences workflow
- Code:
  - `apps/statenour/src/inngest/client.ts` · Inngest client
  - `apps/statenour/src/inngest/jobs.ts` · shared cron job arrays
  - `apps/statenour/src/inngest/functions/*.ts` · 4 function defs
  - `apps/statenour/src/inngest/on-failure.ts` · Telegram alert handler
  - `apps/statenour/app/api/inngest/route.ts` · serve endpoint
- Dashboard: https://app.inngest.com
