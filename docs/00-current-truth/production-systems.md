# Production & Deployment Systems

This document serves as the Single Source of Truth for the monorepo's production deployment, scheduled task infrastructure (crons), and observability design.

---

## 🚀 Deployment Topology

The entire ecosystem is deployed on **Railway** and spans two primary database backends:

*   **App Server**: `statenour` ➔ Deployed on Railway. Serves Next.js app on `bdnick.info`.
*   **Service Ring**: `nickstire` ➔ Deployed on Railway. Serves public site on `nickstire.org`.
*   **Cron Worker**: `worker` ➔ Deployed on Railway as a background process.
*   **Prisma Database**: Hosted on **Neon** (serverless PostgreSQL).
*   **Drizzle Database**: Hosted on **TiDB Cloud Serverless** (serverless MySQL).

---

## ⏰ Cron Job & Scheduler Layout

The scheduled jobs are split between high-frequency tasks orchestrated by the background worker and daily/weekly schedules owned by Inngest or triggered by a Railway cron (see §2):

```
[apps/worker node-cron] ➔ Fires HTTP triggers ➔ apps/statenour/app/api/cron/[name]
                                             (Authorized via Bearer CRON_SECRET)
```

### 1. High-Frequency Scheduler (`apps/worker`)
The background worker process utilizes `node-cron` to trigger the following jobs by making internal HTTP requests to `statenour-web` (`apps/worker/src/scheduler.ts:124-170`):

*   **`brain-bus-drain`** (`*/15 * * * *`): Runs every 15 minutes. Drains the durable brain-bus event queue.
*   **`outbox-drain`** (`*/15 * * * *`): Runs every 15 minutes. Replays orphaned post-turn chat work.
*   **`device-heartbeat-sentinel`** (`*/15 * * * *`): Runs every 15 minutes. Flips cameras/bridges silent >20 min to OFFLINE (ADR-0017).
*   **`inngest-liveness`** (`0 13 * * *`): Daily 13:00 UTC. Out-of-band check that the Inngest scheduler is alive.
*   **Video render loop** (`*/15 * * * *`, `RENDER_SCHEDULE`, `scheduler.ts:179`): runs **in-process**, not forwarded. Polls `/api/sync/queue/render` for approved video drafts and renders them using the Remotion engine locally. (Was every 2 minutes until #1696.)

The earlier list here (`brain-bus-backfill`, `calendar-premeeting`, `bus-exhaustion-watch`, `provider-ping`) forwarded to routes deleted on 2026-05-28 and was removed from the worker on 2026-07-28 (`scheduler.ts:125-130`).

### 2. Daily & Low-Frequency Scheduler
Two scheduler classes own daily/weekly work. Which one owns a job is its row in `apps/statenour/config/crons.ts`:
*   **Inngest-native crons** (`inngest: true`, e.g. `operator-morning-brief`, `quality-bench-weekly`) carry their own Inngest triggers and do not touch the worker or the mega routes.
*   **Mega fan-out children**, described below.

Mega fan-out children ride in the Next.js runtime (`apps/statenour/app/api/cron/mega/route.ts`, `?slot=morning|evening`):
*   Entry points: the worker's `POST /cron/mega` and `POST /cron/mega-evening` (`apps/worker/src/index.ts:168,174`), which forward to `/api/cron/mega`. The Railway cron that calls them is set in the dashboard, not in `.railway/railway.ts`, so the repo cannot show whether it is firing. Check statenour `cron_job_logs` (`CronJobLog`). The Inngest `mega-fanout` function is registered too but skips every run unless `INNGEST_MEGA_V2=true` (`apps/statenour/lib/inngest/functions/mega-fanout.ts:341-347`).
*   Requires the `CRON_SECRET` Bearer header to trigger successfully.
*   Manual fire: `POST /api/settings/crons/trigger`, or run-now / kill switch on `/system/crons`. There is no `/api/system/crons/run` route.

---

## 📊 Observability & Telemetry

Observability in the monorepo is divided into three tiers:

### 1. Business & Strategy Tracing
LLM model calls are instrumented for **Langfuse** through the shared Statenour
telemetry helper. The deployed exporter has started on Railway, and the public
`/api/version` surface reports `langfuse: true`.
*   Environment Variables: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`
*   Privacy: private-mode turns are excluded; exported attributes are masked for keys and bearer tokens.
*   Product receipts remain first-party: `AgentTrace`, `/system/ai-cost`, and `tool_telemetry` are not replaced.

### 2. Error Logging
System errors, database failures, and bridge authentication failures write to
`ErrorLog` database tables and are instrumented for **Sentry** error monitoring:
*   Errors are surfaced dynamically inside the **Statenour Admin Cockpit** (`/system/logs`).
*   Bridge auth failures are logged by nickstire's `server/middleware/statenourAuth.ts` through its own `createLogger` (`log.warn`, line 52); there is no winston dependency.
*   Sentry is configured with `NEXT_PUBLIC_SENTRY_DSN` (client) and `SENTRY_DSN` (server/edge).
*   Default PII capture is disabled and performance tracing is disabled by default.

### 3. AI Provider Health
LLM provider health is read on demand. No cron polls it (the hourly `provider-ping` cron was deleted on 2026-05-28):
*   Route: `/api/system/provider-health`, a snapshot of `getProviderHealth()` (per-provider availability, cooldown, recent errors) cached for 30 s.
*   The route only reports. Failover between providers happens in the AI call path (`lib/ai/stream-with-fallback.ts`), not here.

---

## 📚 Related Current-Truth Docs

*   **[Antigravity Capability Arc (2026-07)](./antigravity-capabilities-2026-07.md)** — operator runbook for the 26-packet wave: new Telegram commands (/remind, tool-capable /ask, instant /qa), specialist shadow routing, nickstire time-clock ledger, self-improving content/persona loops, skill-registry maintenance.
