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

The scheduled jobs are split between high-frequency tasks orchestrated by the background worker and daily/weekly schedules owned by Inngest (see §2). Live Railway inspection on 2026-09-29 found exactly four services — Nick's, StateNour web, StateNour worker, Redis — and **no Railway cron services/jobs**.

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
*   **Video render loop** (`*/15 * * * *`, `RENDER_SCHEDULE`, `scheduler.ts:189`): runs **in-process**, not forwarded. Polls `/api/sync/queue/render` for approved video drafts and renders them using the Remotion engine locally. (Was every 2 minutes until #1696.) Since 2026-10-08 `renderPlan.ts` makes a customer-review video only from a declared review (name, 1-5 rating, text) and refuses anything that is neither a review nor an alert; it used to render every other draft as a five-star "Verified Customer" review of its own text.

The earlier list here (`brain-bus-backfill`, `calendar-premeeting`, `bus-exhaustion-watch`, `provider-ping`) forwarded to routes deleted on 2026-05-28 and was removed from the worker on 2026-07-28 (`scheduler.ts:125-130`).

### 2. Daily & Low-Frequency Scheduler
Two scheduler classes own daily/weekly work. Which one owns a job is its row in `apps/statenour/config/crons.ts`:
*   **Inngest-native crons** (`inngest: true`, e.g. `operator-morning-brief`, `quality-bench-weekly`) carry their own Inngest triggers and do not touch the worker or the mega routes.
*   **Mega fan-out children**, described below.

Mega fan-out children ride in the Next.js/Inngest runtime (`apps/statenour/lib/inngest/functions/mega-fanout.ts`):
*   Inngest registers morning at `0 9 * * *` and evening at `0 3 * * *`, plus manual events.
*   Q-36 removes the vestigial worker `POST /cron/mega*` entry points. Live Railway inspection on 2026-09-29 found no cron service/job and no cron schedule on the worker, so those HTTP routes had no platform caller.
*   The Inngest functions remain gated by `INNGEST_MEGA_V2=true`. The Railway OAuth connector confirms the variable exists but redacts its value, and this session could not query `CronJobLog` because the Neon connector requires a project ID that is not in repo/prior context. **Therefore actual production mega firing is UNVERIFIED in this checkpoint.** Verify from `cron_job_logs` / Inngest before claiming the cutover is live.
*   Manual fire remains available through the StateNour cron controls; child routes still require `CRON_SECRET`.

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

### 3. AI Provider / Model Health
General provider health and Ollama model liveness are separate surfaces:

*   **Provider snapshot:** `/api/system/provider-health` reads `getProviderHealth()` on demand (availability, cooldown, recent errors), cached for 30 s. The old hourly `provider-ping` cron was deleted on 2026-05-28. Failover between providers happens in the AI call path (`lib/ai/stream-with-fallback.ts`), not in this route.
*   **Ollama resolved-model liveness:** `/api/cron/ollama-model-liveness` is a real cron endpoint. Its executable mega-morning registration lives in `apps/statenour/lib/inngest/jobs.ts` (`MORNING_JOBS`); `apps/statenour/config/crons.ts` carries the corresponding manifest metadata. It resolves the same chat / fast / vision model IDs that StateNour web would use, sends live Ollama requests, writes `CronJobLog`, and alerts on failure; HTTP 410 is treated as model retirement rather than a retryable outage.
*   **2026-09-28 live receipt:** the cron correctly detected the retired fast model `deepseek-v4-flash:0731` (410) while chat `minimax-m3` and vision `gemma4:31b` were alive. After a live fast-lane bake-off, Railway was repinned to `glm-5.3-flash`; the exact deployed route then returned all three lanes alive/200 and `data.ok=true`. See `ollama-liveness-repair-2026-09-28.md`.
*   **Worker boundary:** `apps/worker/src` has no AI/model-call sites. It forwards cron HTTP calls to StateNour web **and** runs the local `processVideoRenders()` Remotion render/upload loop. Worker freshness is observed through persisted receipts surfaced by `/api/system/heartbeat`; that signal is not a duplicate Ollama model probe.

---

## 📚 Related Current-Truth Docs

*   **[Ollama liveness repair + worker freshness receipt (2026-09-28)](./ollama-liveness-repair-2026-09-28.md)** — exact model-retirement detection, replacement bake-off, Railway pins, final live cron receipt, and the worker/non-AI boundary.
*   **[Antigravity Capability Arc (2026-07)](./antigravity-capabilities-2026-07.md)** — operator runbook for the 26-packet wave: new Telegram commands (/remind, tool-capable /ask, instant /qa), specialist shadow routing, nickstire time-clock ledger, self-improving content/persona loops, skill-registry maintenance.
