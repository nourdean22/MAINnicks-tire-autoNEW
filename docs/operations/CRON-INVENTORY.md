# Cron Inventory — What Runs, When, Why

Every background job that touches the production DB, external APIs, or SMS/email.
Organized by the tier it runs in (`server/cron/scheduler.ts`).

If you add a new job, update this doc in the **same commit**.

Last audited: 2026-04-22

---

## Tier 1 — Heartbeat (every 5 min)

Purpose: critical health + data-accuracy surveillance. Short, cheap jobs.

| Job | Purpose | Notes |
|---|---|---|
| `self-healing` | Run AI gateway + DB + memory health checks, attempt auto-recovery | Always on |
| `alg-mirror-health` | Detect stale ALG data, surface in admin | **Shop-protected**: only runs when admin session active (`runIfAdminActive`) |
| `data-accuracy-check` | Orphaned invoices, stale leads (>7d), unanswered callbacks (>24h) | Logs issues to Nick memory + admin warning |

---

## Tier 2 — Pulse (every 15 min)

Purpose: keep dashboards fresh, vendor health known, customer-facing outreach
timely.

| Job | Purpose | Notes |
|---|---|---|
| `vendor-health` | Ping Stripe, Twilio, Resend, Venice, Google APIs | Status pushed to admin |
| `dashboard-sync` | Recompute admin stats snapshot | Business hours only |
| `cloud-camera-snapshots` | Pull snapshots from V380 / Ring / Eufy for admin | Business hours only |
| `shopdriver-mirror` | Full ShopDriver customer + invoice mirror | **Shop-protected**. 15-min cadence |
| `abandoned-forms` | Re-engage customers who started but didn't finish a form | Business hours only |
| `sms-scheduler` | Process 24h appointment-reminder SMS queue | Business hours only |
| `wo-overdue-check` | Flag work orders past promised time | Business hours only |
| `gateway-order-status-poll` | Detect stale/stuck tire orders | Business hours only |
| `revenue-pulse` | Live revenue pacing — alert Telegram on big jobs or pace shortfall | Business hours only |
| `statenour-live-sync` | Push fresh data to autonicks.com NOUR OS dashboard | |

---

## Tier 3 — Hourly (every 2 h)

Purpose: intelligence refresh, follow-up sequences, review monitoring.

Key jobs (not exhaustive — scheduler.ts is the source of truth):

| Job | Purpose | Notes |
|---|---|---|
| `review-monitor` | Pull new Google reviews, trigger AI drafts | |
| `review-requests` | Send 7-day review-request SMS to recent invoicees | |
| `stale-lead-followup` | Nudge leads that went cold | Business hours only |
| `cross-sell-outreach` | Suggest next-service to recent customers | |
| `retention-sequences` | 45/90/180/365-day win-back SMS | Business hours only |
| `warranty-alerts` | Remind customers of expiring warranties | |
| `auto-labor-guide-sync` | ALG ticket pull | **Shop-protected** |
| `customer-segment-refresh` | Recompute recent/lapsed/new segments | Business hours only |
| `intelligence-engines-live` | Lead scoring, LTV, attribution, declined-work analysis | Business hours only |

---

## Tier 4 — Daily (every 24 h)

Purpose: heavy aggregations, daily reports, overnight cleanup.

| Job | Purpose | Notes |
|---|---|---|
| `daily-report` | Generate + email previous-day summary to CEO | |
| `cleanup` | Purge old chat sessions, expired drafts, old telemetry | |
| `customer-segmentation` | Full segment re-classification | |
| `retention-90day` | Long-tail retention outreach | |
| `warranty-alerts-daily` | Batch warranty SMS | |
| `shopdriver-daily-ticket-pull` | Full ShopDriver sync | **Shop-protected** (60-min window) |
| `shopdriver-full-mirror` | Daily full data mirror | **Shop-protected** (60-min window) |
| `alg-auto-discovery` | Probe ALG API for new endpoints | **Shop-protected** (60-min window) |

---

## Vague-Named Jobs — Documented Here So Nobody Has To Wonder

### `chatFaqPipeline`
- File: `server/cron/jobs/chatFaqPipeline.ts`
- Purpose: Analyze recent chat sessions, extract repeated customer questions,
  promote them to the published FAQ page. Turns support volume into SEO content.
- Effect: Updates `mechanicQA` table + `/faq` page content.

### `intelligenceAutopilot`
- File: `server/cron/jobs/intelligenceAutopilot.ts`
- Purpose: Run the "auto-actions" intelligence layer — e.g. automatically assign
  a priority score to new leads, auto-snooze low-intent chats, auto-tag
  customers with segment labels. Kind of an "AI sidekick that tidies up the inbox."
- Effect: Writes to `leads`, `chatSessions`, `customers` with audit trail.

### `crudAutomation`
- File: `server/cron/jobs/crudAutomation.ts`
- Purpose: Automated state transitions for stale records — e.g. if a booking
  has `preferredDate < today` and `status = new` for > 3 days, mark `cancelled`
  with reason "no-show (auto)". Prevents dashboard rot.
- Effect: Updates `bookings.status`, creates audit entries.

---

## Shop Protection — Why Some Jobs Are Gated

ShopDriver Elite and Auto Labor Guide authenticate via a session cookie. When
our server probes their API, the shop counter's browser session gets kicked.
**This logs the staff out of their ticketing screen every time.**

Fix (2026-04-22): `runIfAdminActive()` wraps those probes. They only execute
when an admin API call has landed in the last 10 minutes (or 60 min for the
daily jobs). When inactive, the cron logs a skip reason instead of running.

Manual bypass: admin UI calls `shopdriver.forceSyncNow` mutation. That runs
the full mirror regardless of gate — use when you explicitly need fresh data
and accept the cost.

Protected jobs:
- `alg-mirror-health` (5-min, 10-min window)
- `shopdriver-mirror` (15-min, 10-min window)
- `auto-labor-guide-sync` (2-hr, 10-min window)
- `shopdriver-daily-ticket-pull` (24-hr, 60-min window)
- `shopdriver-full-mirror` (24-hr, 60-min window)
- `alg-auto-discovery` (24-hr, 60-min window)

---

## How to Add a New Cron Job

1. Add a file in `server/cron/jobs/<name>.ts` exporting an async handler
   that returns `{ recordsProcessed?, details? }`.
2. Register it in `server/cron/scheduler.ts` inside the appropriate tier.
3. Add a row to this doc.
4. If it auths against ShopDriver / ALG → wrap in `runIfAdminActive`.
5. If it runs external API calls at shop hours → set `businessHoursOnly: true`.
6. Test with a local `pnpm run dev` and watch `cron_log` table.

---

## How to Disable a Job Fast (Incident Response)

1. `UPDATE cron_log SET status = 'disabled'` — this is display only.
2. Real fix: comment out the registration in `scheduler.ts` and redeploy.
   OR: set `enabled: false` on the job entry.
3. OR: set `requiresEnv: "DISABLE_X"` and set `DISABLE_X=1` on Railway.

Document the reason in `docs/operations/LOAD_BEARING_SYSTEMS.md` if the
disable sticks past the incident.
