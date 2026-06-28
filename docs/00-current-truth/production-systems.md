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

The scheduled jobs are split between high-frequency tasks orchestrated by the background worker and daily/weekly schedules triggered by Railway system crons:

```
[apps/worker node-cron] ➔ Fires HTTP triggers ➔ apps/statenour/app/api/cron/[name]
                                             (Authorized via Bearer CRON_SECRET)
```

### 1. High-Frequency Scheduler (`apps/worker`)
The background worker process utilizes `node-cron` to trigger the following jobs by making internal HTTP requests to `statenour-web`:

*   **`brain-bus-backfill`** (`*/2 * * * *`): Runs every 2 minutes. Backfills brain-bus queues.
*   **`processVideoRenders`** (`*/2 * * * *`): Runs every 2 minutes. Polls `/api/sync/queue/render` for approved video drafts and renders them using the Remotion engine locally.
*   **`calendar-premeeting`** (`*/15 11-23,0 * * *`): Runs every 15 minutes. Prepares pre-meeting diagnostic cards.
*   **`bus-exhaustion-watch`** (`*/30 * * * *`): Runs every 30 minutes. Warns of stuck/exhausted tasks in the queue.
*   **`provider-ping`** (`0 * * * *`): Runs hourly. Check LLM provider latencies and health.

### 2. Daily & Low-Frequency Scheduler
Larger batch operations (e.g. daily/weekly dashboard rollups and Obsidian syncs) are managed directly inside the Next.js runtime:
*   Standard route endpoint: `/api/system/crons/run`
*   Requires the `CRON_SECRET` Bearer header to trigger successfully.

---

## 📊 Observability & Telemetry

Observability in the monorepo is divided into three tiers:

### 1. Business & Strategy Tracing
All LLM reasoning loops, prompts, tool calls, and agent outcomes are logged to **Braintrust**:
*   Environment Variable: `BRAINTRUST_API_KEY`
*   Wired via the central AI client wrapper `lib/ai/provider.ts` and `lib/ai/reasoning`.

### 2. Error Logging
System errors, database failures, and bridge authentication failures write to `ErrorLog` database tables:
*   Errors are surfaced dynamically inside the **Statenour Admin Cockpit** (`/system/logs`).
*   Bridge auth failures are logged in `statenourAuth` using standard winston/console logs.

### 3. AI Provider Health
LLM provider health, latencies, and fallback transitions are monitored hourly:
*   Route: `/api/system/provider-health`
*   Provides real-time failover rotation when a provider drops (e.g. rotating from Ollama to Gemini or OpenAI).
