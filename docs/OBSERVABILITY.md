# Observability Strategy — Nickstire (Customer-Facing + Admin)

> SLI / SLO definitions, error tracking architecture, alert thresholds,
> and incident response patterns. Generated 2026-05-07 (wave-51) via
> observability-engineer + incident-responder + monitor-setup skills.

---

## What's already in place (audit)

- ✅ **Frontend ErrorBoundary** — wraps `<Router>` in App.tsx, catches React render errors
- ✅ **AdminSectionBoundary** — per-section boundary for admin (admin section can crash without taking the whole admin down)
- ✅ **CWV (Core Web Vitals) collector** — `client/src/lib/cwv.ts` initialized in App.tsx
- ✅ **Server-side logging** — `server/_core/index.ts` has request logging
- ✅ **VAPI call event tracking** — call events logged to DB via webhooks
- ✅ **Lighthouse CI** — runs on every PR
- ✅ **GitHub Actions CI** — Build & Deploy + Verify Prerender + Test/Lint
- ⚠️ **Sentry server-side** — `server/lib/sentry.ts` shim EXISTS with conditional integration (no-ops if `SENTRY_DSN` env unset). Just needs `pnpm add @sentry/node` + DSN env var to activate. Client-side Sentry NOT installed.
- ✅ **Structured logger** — `server/lib/logger.ts` already provides leveled JSON output (similar to pino) — wave-51's "install pino" recommendation is moot
- ⚠️ **No SLO targets defined** — what's "healthy" is implicit, not codified (this audit doc fixes that)
- ⚠️ **No alert routing** — errors logged but not pushed to a notification channel

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

### 1. Sentry — error tracking + performance monitoring

Already in package.json adjacent (the `sentry-automation` skill exists but
not integrated). Recommendation: install minimal Sentry SDK on both
client and server.

**Effort:** ~30 min config. **Spend:** ~$26/mo on developer tier.

**Wire-up:**
```ts
// client/src/main.tsx
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
  ],
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  environment: import.meta.env.MODE,
});

// server/_core/index.ts
import * as Sentry from "@sentry/node";
Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
```

**Captures:**
- Frontend JS errors with stack traces
- Server 5xx errors
- Slow tRPC calls (> 1s)
- React component errors via ErrorBoundary integration

### 2. Structured server logging

Current logging is `console.log` only. Recommendation: adopt a structured
logger like `pino` (lightweight, fast, JSON output).

```ts
// server/_core/logger.ts
import pino from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  formatters: { level: (label) => ({ level: label }) },
});
```

Then `log.info({ tRPC: "drops.create", userId, durationMs }, "drop created")`
instead of `console.log("drop created")`.

Railway captures stdout, so this lights up dashboards on the Railway side
without additional infra.

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

1. **Sentry on client + server** — catches the unknown-unknowns (JS errors,
   server 5xx) you don't even know to look for
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

2026-05-07 (wave-51).
