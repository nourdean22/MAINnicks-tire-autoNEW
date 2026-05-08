# Business Continuity — Nick's Tire & Auto

**Generated:** 2026-03-29 · **Refreshed:** 2026-05-07 (wave-80)
**Sister doc:** `docs/OBSERVABILITY.md` (SLI/SLO + alert routing) is the
authoritative incident-response playbook. This doc covers the
**business-side** continuity questions (what to do when X is down,
secrets rotation, monthly checks).

---

## Critical Systems Map

| System | What breaks without it | Recovery time |
|---|---|---|
| **Railway** (server, primary) | All bookings, SMS, AI, admin panel down | ~5 min to redeploy from last good SHA |
| **TiDB / MySQL** (database) | All data unavailable | TiDB SLA 99.95%; failover auto |
| **Shop SMS Gateway** (F25e at 216-862-0005, primary) | ~80% of customer-facing SMS; auto-falls-back to Twilio | Cron `sms-gateway-health` alerts within 30min; Twilio fallback covers the gap |
| **Twilio** (SMS fallback + bulk + voice receipt) | Bulk campaigns + drip sequences + review batches; backup for shop gateway | Set `SMS_KILL_SWITCH=true` on Railway to short-circuit (only blocks Twilio path; shop gateway still works) |
| **VAPI** (`+1 216 424 9249` voice receptionist) | After-hours calls hit voicemail; callback queue grows | Forward to mobile via Twilio fallback |
| **Venice / Ollama Cloud Pro** (primary AI) | AI features fall through to OpenAI → Anthropic | Provider chain auto-fails over |
| **OpenAI / Anthropic** (AI fallback) | All AI features fail if upstream + Venice + Ollama all down (rare) | Forms still work — manual call follow-up |
| **Google OAuth** (admin login) | Admin panel login broken | Owner has active session cookie |
| **Stripe** (payment) | New financing applications fail | Existing approved payment programs unaffected |
| **autonicks.com / NOUR OS** (operator dashboard) | Reduced operational visibility | Not customer-facing; nickstire.org keeps running |

**Note on AI provider order (per `MEMORY.md` arsenal_integrations):**
Venice + Ollama Cloud Pro co-1st (preferLargeContext promotes Ollama),
fallback chain Venice → Ollama → retry → OpenAI → Anthropic. Routing
matrix in `server/lib/ai-gateway.ts`.

---

## If the server goes down (Railway crash)

1. Check Railway dashboard → Deployments tab
2. Look at build/deploy logs for the failing deployment
3. If startup crash: check for missing env vars (FATAL log lines)
4. Redeploy last known-good deployment (Railway "Redeploy" button)
5. Verify: `GET /api/_health` returns `{ "status": "healthy" }`
6. If repeated crash, see `docs/runbooks/HOTFIX_RUNBOOK.md`

**Contact:** Nour (owner) — all Railway access under `@nour` account

---

## If Twilio goes down

(post-wave-103: Twilio is now the FALLBACK, not primary. Most customer-facing SMS continues through the shop gateway.)

- Bulk SMS (campaigns, drip sequences, review-request batches, daily report) stops sending — these intentionally stay on Twilio for opt-out compliance and rate-limit handling
- Customer-facing transactional SMS (booking confirms, drop-off recaps, status updates, lead confirms, etc.) continues — they route via:"shop" through the F25e
- Set `SMS_KILL_SWITCH=true` on Railway to short-circuit the Twilio path (skips 15s circuit-breaker timeout in voice flows). The kill switch does NOT block the shop gateway path.
- Inbound voice still routed via Twilio numbers; if entirely down, VAPI line stays up but Twilio-routed inbound is lost
- Fallback: call customer directly using `OWNER_PHONE` env var
- Check `https://status.twilio.com/`

---

## If the shop SMS gateway goes down (F25e offline)

- Customer-facing transactional SMS auto-falls-back to Twilio (with Telegram alert per fallback so you see it)
- Cron `sms-gateway-health` (15-min pulse) fires Telegram alert if F25e last-seen > 30min, recovery alert when back online
- Recovery checklist in `docs/SHOP_SMS_GATEWAY_SETUP.md`:
  1. Plug in the F25e (battery dead is #1 cause)
  2. Verify wifi/LTE
  3. Open the SMS Gateway app once — toggle Cloud Server on if needed
  4. Verify "Start on boot" is still ON
- If both shop gateway AND Twilio are down: customer flow through Telegram alerts to owner; admin can call back manually

---

## If VAPI goes down

- After-hours calls go to voicemail (Twilio configured fallback)
- Callback queue in admin grows — pulse tier `callback-escalation` keeps re-alerting on stuck items
- Settings: VAPI dashboard at vapi.ai (operator-controlled, do NOT modify config without report-first per ops rule)
- Check VAPI status page

---

## If database goes down

- `/api/_health` returns 503
- All bookings fail with DB error
- Forms still show (client-side) but submissions fail
- Contact TiDB support: `https://tidbcloud.com/support`
- TiDB has automatic failover — usually self-heals
- DB pool exhaustion: `getDb()` connection pool is bounded (see `server/db.ts`); if saturated, restart server pod

---

## If autonicks.com / NOUR OS goes down

- Operator dashboard at autonicks.com is **non-customer-facing** — nickstire.org keeps serving customers
- Cron job `statenour-live-sync` will fail; admin dashboard tile staleness will show in `/admin/system/observability`
- Recovery: separate Vercel deployment under autonicks.com; redeploy from `codex/ollama-local` branch

---

## Data backup

| Data | Backup location | Recovery |
|---|---|---|
| Bookings | Google Sheets CRM (synced on create) | Export from Sheets |
| Leads | Google Sheets CRM (synced on create) | Export from Sheets |
| Customer DB | TiDB managed backups (daily) + cron `db-backup` | TiDB restore or backup snapshot |
| Photos | S3/CloudFront | AWS console restore |
| ALG mirror (invoices) | Live copy from ShopDriver — not source | Re-sync via `auto-labor-guide-sync` cron |
| Brain memories (NOUR OS) | TiDB on autonicks.com side | Bidirectional sync via cron |

---

## Secrets inventory (for rotation)

All secrets are stored in Railway Variables. If any are compromised,
rotate immediately. Add new secrets to this table when introduced.

| Secret | Where to rotate | Impact if compromised |
|---|---|---|
| `JWT_SECRET` | Railway → generate new | All admin sessions invalidated |
| `TWILIO_AUTH_TOKEN` | Twilio Console | SMS sending compromised |
| `VAPI_API_KEY` | VAPI Dashboard | Voice receptionist control |
| `VAPI_WEBHOOK_SECRET` | VAPI Dashboard | Webhook spoofable |
| `VENICE_API_KEY` | Venice.ai dashboard | Primary AI provider compromised |
| `OPENAI_API_KEY` | OpenAI Dashboard | OpenAI charges + fallback AI |
| `ANTHROPIC_API_KEY` (if used) | Anthropic Console | Final fallback AI |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google Cloud Console | Admin login flow |
| `STRIPE_SECRET_KEY` | Stripe Dashboard | Payment charges |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard | Payment webhook spoofable |
| `FB_APP_SECRET` | Meta Developer Console | Messenger webhook spoofable |
| `FB_VERIFY_TOKEN` | Meta Developer Console | Messenger handshake |
| `META_PAGE_ACCESS_TOKEN` | Meta Developer Console (rotates ~Jun 27 per memory) | Page posting |
| `RESEND_API_KEY` | Resend Dashboard | Email sending |
| `STATENOUR_SYNC_KEY` | autonicks.com side | Bidirectional sync |
| `BRIDGE_API_KEY` | Both sides | NOUR OS bridge |
| `ADMIN_API_KEY` | Railway | Admin API access |

Recommended cadence: rotate JWT + API keys every 6-12 months OR on
team-change OR after any suspected compromise.

---

## Emergency contacts

- **Railway support:** https://help.railway.app
- **Twilio support:** https://help.twilio.com
- **TiDB support:** https://tidbcloud.com/support
- **VAPI:** https://vapi.ai (dashboard)
- **Venice.ai:** https://venice.ai (provider)
- **OpenAI:** https://help.openai.com
- **Stripe:** https://support.stripe.com
- **Cloudflare DNS:** https://dash.cloudflare.com (for nickstire.org)

---

## Pre-incident checklist (run monthly)

- [ ] Verify `/api/_health` returns healthy
- [ ] Verify booking form sends SMS to test number
- [ ] Verify admin panel login works (Google OAuth)
- [ ] Check Railway usage + billing (no runaway costs)
- [ ] Check Venice / Ollama / OpenAI usage + billing
- [ ] Check `pnpm audit` — any new critical vulns?
- [ ] Verify VAPI line answers + transfers correctly
- [ ] Spot-check a backup restore (TiDB snapshot OR Google Sheets export)
- [ ] Verify `pnpm verify` chain runs clean locally + in CI
- [ ] Review `docs/OBSERVABILITY.md` SLO error budgets — are we burning fast?

---

## See also

- `docs/OBSERVABILITY.md` — SLI/SLO + alert routing
- `docs/runbooks/HOTFIX_RUNBOOK.md` — emergency hotfix procedure
- `docs/runbooks/ROLLBACK_RUNBOOK.md` — rollback procedure
- `docs/SECURITY_AUDIT.md` — security posture
- `docs/operations/CRON-INVENTORY.md` — cron job inventory
