# Observability - Nickstire (customer-facing + admin)

> Current state first (rewritten 2026-10-16, branch `nickstire/observability-proof`);
> the SLO strategy below it is the 2026-05-07 (wave-51) plan and is still a plan.
> Rule this doc follows: an instrument is working only when a planted positive
> came back. Env var present, a "started" log and a green badge prove nothing
> (the 2026-09-02 placeholder-DSN incident: keys set, zero events).

---

## Current state (2026-10-16)

| Instrument | Code | How to prove it | State today |
|---|---|---|---|
| **Sentry (server)** | `server/lib/sentry.ts`. `@sentry/node` 10.59 is a real dependency (installed). Release = the deployed commit via `resolveNickDeployIdentity` (`RAILWAY_GIT_COMMIT_SHA`), not `RAILWAY_DEPLOYMENT_ID`. Traces sample rate 0 by design. `sendDefaultPii` off; cookies and auth headers stripped in `beforeSend`. | `POST /api/system/observability-probe` (Bearer `ADMIN_API_KEY`) plants one info message tagged `probe_id` + `commit`, flushes, and reports `ok` only when Sentry's transport answered 2xx (`afterSendEvent` hook). Find it in Sentry by tag `probe_id`. | DSN is set on Railway (events reached project NICKSTIRE, e.g. issue NICKSTIRE-D). Probe not yet run against production. |
| **Sentry capture scope** | `lib/error-telemetry.ts` forwards non-operational errors from tRPC `onError` and `unhandledRejection`. Express route errors and cron failures do NOT reach Sentry. | n/a | Widening capture is a separate decision (Sentry quota). |
| **Sentry client-side** | none | n/a | Not installed; separate PR. |
| **Langfuse (AI calls)** | `server/lib/langfuse-ingest.ts`: `fetch` to `POST {LANGFUSE_BASE_URL}/api/public/ingestion`, basic auth `public:secret`, batched `trace-create` + `generation-create`, bounded queue (200 events), one HTTP batch every 3 s, never throws into or blocks the caller. No SDK, no OpenTelemetry. | The same probe (target `langfuse`) sends one synthetic generation named `observability-probe` (no model call). Read back: `GET /api/public/observations?name=observability-probe`. A 207 with per-event `errors` counts as a failure. | OFF: `LANGFUSE_*` unset on the nickstire Railway service. Status route says UNKNOWN until Nour sets them (below). |
| **Status route** | `GET /api/system/observability-status` (Bearer `ADMIN_API_KEY`), `server/lib/observabilityStatus.ts` | HEALTHY / DEGRADED / UNKNOWN per instrument with `since`, `detail` and the raw receipts. | Counters are in-process: every deploy resets them to UNKNOWN until the next event or probe. |
| **/api/health `checks.sentry`** | `server/lib/health.ts` | `status: dsn_set / dsn_unset` (presence only, named honestly) plus `last_event_id`, `events_sent_since_boot` (transport 2xx) and `events_captured_since_boot` (locally issued ids). | It used to say `configured` from the DSN alone. |
| **Structured logger** | `server/lib/logger.ts` (leveled JSON). `console.log/warn/error` are banned in `server/` by `pnpm lint:source`. | n/a | In place. |
| **LLM ledger** | `services/llmLedger.ts` writes `llm_calls` for every `invokeLLM` (gated by `LLM_LEDGER_ENABLED`). Langfuse is the cross-provider trace; the ledger is the DB record. | n/a | Separate from Langfuse. |

### State rules (status route)

- **Sentry:** DSN unset = UNKNOWN. DSN set but init failed = DEGRADED. At least one event acked (2xx) since boot = HEALTHY. Events captured but none acked = UNKNOWN. A capture error or a non-2xx after the last ack, or a flush that did not drain = DEGRADED.
- **Langfuse:** keys unset = UNKNOWN. Keys set, nothing sent yet = UNKNOWN. Last ingestion 2xx (no per-event errors) within 12 h = HEALTHY; older = UNKNOWN. Last ingestion failed = DEGRADED.
- Missing telemetry is never HEALTHY.

### What Langfuse receives (masking)

- Every input/output excerpt goes through `services/callerTextRedaction.ts` (phones, names, emails, VINs, addresses) and is capped at 400 characters. Provider error text is masked the same way.
- The prompt is sent only as a sha256 (`metadata.promptSha256`), never as text. Images, audio and video are never sent (`[image]`, `[audio]` placeholders).
- A call marked `private: true` is counted under `skipped.private` and never queued. No nickstire call site sets it today (no private/do-not-record mode was found in the nickstire server on 2026-10-16); the seam exists for one.
- Trace names: `<lane>:<site>`, e.g. `llm:<calling function>`, `gateway:openai`, `nickgpt:ollama`, `vision:gemini`.

### AI call sites and tracing (2026-10-16)

Gate: `server/langfuseTraceGate.test.ts` fails when a server file names a provider endpoint and never calls `traceChat(` / `traceGeneration(` (comments stripped; a planted untraced fetch proves it fires).

| Site | Provider | Traced |
|---|---|---|
| `_core/llm.ts` `invokeLLM` (about 48 importing files: receptionist, replay lane, critic, reel generation, most AI) | OpenAI / Gemini / Ollama | yes, success and failure |
| `lib/ai-gateway.ts` `callOpenAI` | OpenAI / Gemini | yes |
| `services/nickgpt-client.ts` (Ollama, Anthropic, Gemini, OpenAI fallbacks) | 4 | yes, each |
| `services/igAutopost.ts` image generation (Gemini direct, OpenRouter) | 2 | yes |
| `services/vision-analyzer.ts` `analyzePhoto` (4 backends) and `describeImagesOpenAiCompatible` | Replicate / HF / Gemini / Ollama | yes, at the entry points |
| `services/classifiers.ts` prompt-injection screen + SMS intent | Hugging Face | yes |
| `services/voice-clone.ts` `cloneVoice` | Replicate / Modal XTTS | yes |
| `_core/imageGeneration.ts` | Gemini / DALL-E | yes |
| `_core/voiceTranscription.ts` | Whisper | yes (masked transcript excerpt only) |
| `services/veoStudio.ts` submit | Veo | yes (submit; polls are not generations) |
| `routes/nour-chief-strategist.ts`, `psych-dominance.ts`, `nour-strategy.ts`, `simulator.ts` | OpenAI | yes |
| `services/higgsfieldStudio.ts` / `higgsfieldApiClient.ts` | Higgsfield video | NO (not an LLM endpoint; the gate does not cover it) |

Known limits: the gate is per file, so a second untraced fetch inside a traced file passes; network errors thrown by `fetch` itself (before a response) are traced at `invokeLLM` and the wrapped entry points, not at the raw-fetch sites; queued events are lost on a deploy (up to 3 s of traces; there is no shutdown flush).

### Nour's steps (not done by any agent)

1. Set the Langfuse keys on the nickstire service (same project or a new one in Langfuse Cloud, US region):
   `railway variables --service MAINnicks-tire-auto --set LANGFUSE_PUBLIC_KEY=pk-lf-... --set LANGFUSE_SECRET_KEY=sk-lf-... --set LANGFUSE_BASE_URL=https://us.cloud.langfuse.com`
2. After the deploy, run the probe and read the status:
   `curl -s -X POST -H "Authorization: Bearer $ADMIN_API_KEY" https://nickstire.org/api/system/observability-probe`
   `curl -s -H "Authorization: Bearer $ADMIN_API_KEY" https://nickstire.org/api/system/observability-status`
   Expect `sentry.ok: true` with an `eventId`, `langfuse.ok: true`, and both instruments HEALTHY.

---

## SLI / SLO definitions

A SLI (Service Level Indicator) is a measurable signal of service health.
A SLO (Service Level Objective) is the target threshold for that signal.

### Customer-facing site SLIs

| SLI | Metric | SLO target | Measurement source |
|---|---|---|---|
| **Availability** | % of requests returning 2xx/3xx (not 5xx) | 99.5% (43m downtime/mo) | Railway edge logs + server `/api/_health` |
| **Latency p50** | 50th percentile TTFB on / | < 600ms | CWV collector + Lighthouse CI |
| **Latency p95** | 95th percentile TTFB on / | < 2000ms | Same |
| **LCP** | Largest Contentful Paint | < 2.5s @ p75 | CWV collector |
| **CLS** | Cumulative Layout Shift | < 0.1 @ p75 | CWV collector |
| **INP** | Interaction to Next Paint (replaced FID May 2024) | < 200ms @ p75 | CWV collector |
| **Conversion path** | /booking submit success rate | ≥ 99% (form submission) | Booking tRPC mutation logs |
| **Phone CTA click rate** | % of /booking visits that click phone | ≥ 8% (lower bound — anything < 5% suggests hero issue) | trackPhoneClick fires |

### Admin SLIs

| SLI | Metric | SLO target |
|---|---|---|
| **Admin availability** | % of admin requests succeeding | 99.9% (admin downtime is operational risk) |
| **Admin page load** | TTFB on /admin | < 800ms |
| **Admin data freshness** | Max staleness of dispatch board data | < 60 seconds |
| **Admin error rate** | % of admin tRPC calls that error | < 1% |

### Backend SLIs

| SLI | Metric | SLO target |
|---|---|---|
| **DB query p95** | 95th percentile query time | < 200ms |
| **DB connection pool saturation** | Active connections / max | < 70% |
| **tRPC procedure error rate** | % of tRPC calls returning errors | < 0.5% |
| **Cron job success rate** | % of scheduled jobs completing | ≥ 99% |
| **VAPI webhook ingestion** | % of VAPI events successfully recorded | ≥ 99.5% |

### Integration SLIs

| SLI | Metric | SLO target |
|---|---|---|
| **Shop SMS Gateway uptime** | F25e last-seen age (cron `sms-gateway-health`) | < 30 min always |
| **Shop SMS Gateway deliverability** | % of `via:"shop"` sends that reach `sms:delivered` | ≥ 98% |
| **Twilio SMS deliverability** (fallback path) | % of sent SMS that deliver | ≥ 95% |
| **Resend email deliverability** | % delivered | ≥ 95% |
| **Stripe webhook ingestion** | % successful | ≥ 99.5% |

---

## Error budget computation

Per the SLI/SLO discipline, every SLO has an error budget:

**Example:** Customer-facing availability SLO = 99.5%. Error budget = 0.5%
of monthly traffic = 4.32 hours per month allowed downtime.

**Rule:** if error budget for the month is exhausted before month-end,
freeze non-critical deploys until next month. Use the time to investigate
+ fix root cause.

This is a behavioral commitment, not a tech commitment. The point is to
prevent deploying into an already-bleeding system.

---

## Recommended observability stack (additions)

### 1. Sentry - DONE for the server (see Current state)

Client-side Sentry (`@sentry/react`) is still not installed: separate PR, gated on quota.

### 2. Structured server logging - DONE

`server/lib/logger.ts`. The pino recommendation from wave-51 is moot.

### 3. Synthetic monitoring (uptime checks) — SKIPPED per Nour

External uptime check (UptimeRobot / BetterStack / Cronitor pinging
`/api/_health`) was originally recommended here. Nour has indicated
this isn't a priority — Railway's own health monitoring + Sentry
error capture is sufficient coverage at current scale.

If site availability becomes a felt problem (customers reporting
"site was down for an hour I didn't know about"), revisit. Until
then, this layer stays unimplemented.

### 4. Real User Monitoring (RUM) dashboard

The CWV collector already gathers Core Web Vitals from real users. Build
an admin section that visualizes:
- p75 LCP, INP, CLS over time
- Per-page Core Web Vitals breakdown
- Performance trend during deploys (catch regressions)

This is wave-54+ work; the data collection is in place, the visualization
is the gap.

### 5. Alert routing

Even with Sentry + structured logs, alerts need to reach Nour. Routing
options:

**Tier 1 (immediate, business-critical):**
- Customer-facing site down → SMS to Nour (via Twilio)
- Booking flow broken → SMS
- Payment processing broken → SMS

**Tier 2 (within 1 hour):**
- Error rate spike > 2× baseline → Email
- Performance regression > 30% on LCP/INP → Email
- VAPI webhook ingestion failing → Email

**Tier 3 (next business day):**
- Lighthouse score regression → daily digest
- Deploy with "warn"-level CI step → daily digest
- Schema migration ran successfully → daily digest

---

## Alert threshold guidelines (avoid alert fatigue)

The wrong threshold is more dangerous than no alert. Rules:

1. **Alerts should be ACTIONABLE.** "Error rate is 0.6%" without a
   suggested action = noise. "Error rate is 0.6%, was 0.1% baseline,
   spike likely caused by deploy SHA xyz" = signal.

2. **Page only on user-facing impact.** Internal warnings stay in
   email/digest. Don't SMS Nour at 2am for a broken cron job that
   re-runs in 4 hours.

3. **Use anomaly detection over static thresholds.** "Error rate >
   2× rolling 7-day average" is more useful than "Error rate > 1%"
   (which fires every time on quiet days).

4. **Quiet hours.** Tier-2/3 alerts shouldn't fire 11pm-7am unless
   user-facing impact is confirmed. Even Tier-1 should have a
   "snooze if user count < 5" override for genuinely low-traffic
   periods.

---

## Incident response patterns

### Incident severity levels

| Level | Definition | Response |
|---|---|---|
| **SEV-1** | Customer-facing site fully down OR booking flow broken | Tier-1 SMS alert; rollback recent deploy if applicable; post-mortem within 48 hr |
| **SEV-2** | Performance regression OR partial feature broken | Tier-1 email; investigate within 4 hr |
| **SEV-3** | Internal admin issue OR error budget burning fast | Tier-2/3 alert; fix in normal sprint |
| **SEV-4** | Cosmetic issue OR low-traffic edge case | Backlog ticket |

### Runbook templates

For each common SEV-1 pattern, a runbook should exist:

1. **"Site is down"** — check Railway dashboard, check DNS, check edge cache, last-deploy SHA, rollback procedure
2. **"Booking submissions failing"** — check tRPC mutation logs, check DB connection pool, check Stripe webhook health, manual booking workaround
3. **"VAPI receptionist not answering"** — check VAPI dashboard, fall back to mobile call forwarding, check Twilio status
4. **"Database connection exhaustion"** — check pool saturation, identify slow queries, restart pool
5. **"Deploy regression"** — git revert to last known good SHA, hotfix branch, redeploy

These runbooks live in `docs/runbooks/SEV1-*.md` (wave-51+ creates them
as needed).

---

## What to instrument FIRST (priority order)

1. **Sentry on client + server** — server side done and provable by the probe
   (2026-10-16); client side not started
2. **Structured server logging** — already in place via server/lib/logger.ts
3. ~~External uptime check~~ — SKIPPED per Nour (Railway health + Sentry
   coverage is enough at current scale)
4. **Booking-flow-specific tracking** — every step of the booking funnel
   has analytics events; track funnel drop-off
5. **Error budget dashboard** — admin section showing current SLO compliance
6. **Alert routing via Twilio + Resend** — wire alerts to actual channels

Each step is independently shippable. Don't try to ship all at once.

---

## What to AVOID

- ❌ **Logging everything.** Verbose logs have signal-to-noise problems. Log
  the things you'd act on.
- ❌ **Alerts for warnings.** Warnings are "FYI." If they need an action,
  upgrade to error.
- ❌ **Coupling alerts to deployments.** A deploy that touches ad code
  shouldn't fire deploy-monitoring alerts about ad load. Tag deploys.
- ❌ **Building custom monitoring infra.** Sentry / Datadog exist.
  Don't reinvent.

---

## Future observability work

- **OpenTelemetry tracing** — distributed traces across browser → tRPC →
  DB → external APIs. Makes "where did this request slow down?" answerable
  in seconds.
- **Replay sessions** — Sentry has session replay; useful for debugging
  hard-to-reproduce frontend bugs.
- **Synthetic transactions** — automated headless browser doing a full
  booking flow every 15 min, alerting on any step failure.

These are wave-52+ work, gated on whether observability becomes a
bottleneck.

---

## Last updated

2026-10-16: current state rewritten (observability proof). Strategy sections: 2026-05-07 (wave-51).
