# Business Continuity — Nick's Tire & Auto
Generated: 2026-03-29

## Critical Systems Map

| System | What breaks without it | Recovery time |
|--------|----------------------|--------------|
| Railway (server) | All bookings, SMS, AI features down | ~5 min to redeploy |
| TiDB (database) | All data unavailable | TiDB SLA: 99.95% |
| Twilio | No SMS confirmations, no review requests | Switch to backup, notify manually |
| OpenAI | AI chat/diagnosis/search broken | Non-critical — forms still work |
| Google OAuth | Admin panel login broken | Owner has active session cookie (1yr) |

---

## If the server goes down (Railway crash)

1. Check Railway dashboard → Deployments tab
2. Look at build/deploy logs for the failing deployment
3. If startup crash: check for missing env vars (FATAL log lines)
4. Redeploy last known-good deployment (Railway "Redeploy" button)
5. Verify: `GET /api/health` returns `{ "status": "healthy" }`

**Contact**: Nour (owner) — all Railway access is under `@nour` account

---

## If Twilio goes down

- SMS confirmations stop sending
- Review request queue backs up (will drain when Twilio is back — no lost requests)
- Fallback: call customer directly using `OWNER_PHONE` in env
- Check `https://status.twilio.com/`

---

## If database goes down

- `/api/ready` returns 503
- All bookings fail with DB error
- Forms still show (client-side) but submissions fail
- Contact TiDB support: `https://tidbcloud.com/support`
- TiDB has automatic failover — usually self-heals

---

## Data backup

| Data | Backup location | Recovery |
|------|----------------|---------|
| Bookings | Google Sheets CRM (synced on create) | Export from Sheets |
| Leads | Google Sheets CRM (synced on create) | Export from Sheets |
| Customer DB | TiDB managed backups (daily) | TiDB restore |
| Photos | S3/CloudFront | AWS console restore |

---

## Secrets inventory (for rotation)

All secrets are stored in Railway Variables. If any of the following is compromised, rotate immediately:

| Secret | Where to rotate | Impact if compromised |
|--------|----------------|----------------------|
| `JWT_SECRET` | Railway → generate new | All admin sessions invalidated |
| `TWILIO_AUTH_TOKEN` | Twilio Console | SMS sending compromised |
| `OPENAI_API_KEY` | OpenAI Dashboard | OpenAI charges |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google Cloud Console | Admin login flow |
| `STRIPE_SECRET_KEY` | Stripe Dashboard | Payment charges |
| `FB_APP_SECRET` | Meta Developer Console | Messenger bot spoofable |

---

## Emergency contacts

- **Railway support**: `https://help.railway.app`
- **Twilio support**: `https://help.twilio.com`
- **TiDB support**: `https://tidbcloud.com/support`
- **OpenAI support**: `https://help.openai.com`

---

## Pre-incident checklist (run monthly)

- [ ] Verify `/api/health` returns healthy
- [ ] Verify booking form sends SMS to test number
- [ ] Verify admin panel login works
- [ ] Check Railway usage/billing (no runaway costs)
- [ ] Check OpenAI usage/billing (AI cost spike detection)
- [ ] Check `pnpm audit` — any new critical vulns?
