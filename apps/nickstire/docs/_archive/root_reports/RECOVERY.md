# Recovery Runbook

Quick reference for recovering from common failure states.

## Server Won't Start

```bash
# Check port conflict
netstat -ano | grep ":3000"
# Kill stale processes
taskkill //F //IM node.exe
# Restart
pnpm dev
```

If `'NODE_ENV' is not recognized`: use `npx cross-env NODE_ENV=development tsx server/_core/index.ts`

## Database Connection Failed

1. Check `DATABASE_URL` in `.env` — must include `?ssl={"rejectUnauthorized":true}` for TiDB
2. Verify TiDB cluster is running at tidbcloud.com
3. Test: `curl -s http://localhost:3000/api/health | python -m json.tool`
4. DB status should show `"status": "up"`

## Ollama Not Responding (AI Fallback Active)

1. Check if Ollama is running: `curl http://localhost:11434/api/tags`
2. If not: start Ollama from system tray or `ollama serve`
3. Circuit breaker resets automatically after 2 minutes
4. If model cold-start timeout: wait 30-60s for model to load into memory
5. Gateway falls back to OpenAI automatically — no user-facing disruption

## Tunnel Not Working (Remote Access Down)

Quick tunnel:
```bash
scripts/start-quick-tunnel.bat
```
URL changes every restart — check `tunnel-url.txt` or console output.

Named tunnel (permanent URL requires DNS at globaldomaingroup.com):
- CNAME: `dev` → `6193177a-0bd6-45cf-b2f8-0e3ef9162113.cfargotunnel.com`

## Railway Deploy Broken

1. Check Railway dashboard for build/deploy logs
2. Common issues:
   - Missing env vars (check `.env.example` for required vars)
   - Build fails: `pnpm build` locally first
   - Runtime crash: check `railway logs`
3. Rollback: Railway dashboard → Deployments → click previous successful deploy → Redeploy

## Google OAuth Not Working

Required env vars:
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`

If 500 on login: verify redirect URI matches in Google Cloud Console.
OAuth project: see `memory/google_oauth_credentials.md` for details.

## SMS Not Working

There are two SMS paths post wave-103. Diagnose which one is broken before fixing.

### Quick triage (15 sec)

Open `nickstire.org/admin` → SMS section. The **Gateway Status card** at top shows both paths.

### Shop SMS Gateway (primary, 216-862-0005, F25e)

Required env vars: `SHOP_SMS_GATEWAY_USERNAME`, `SHOP_SMS_GATEWAY_PASSWORD`, `SHOP_SMS_GATEWAY_URL`, `SHOP_SMS_GATEWAY_WEBHOOK_SECRET`.

If status shows "OFFLINE":
1. Plug in the F25e (battery dead = #1 cause)
2. Verify wifi/LTE
3. Open the SMS Gateway app once — toggle Cloud Server ON if needed
4. Verify "Start on boot" is still ON

Full runbook: `docs/SHOP_SMS_GATEWAY_SETUP.md`.

### Twilio (fallback + bulk)

Required env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`.
- Check: `SMS_KILL_SWITCH=true` blocks ONLY the Twilio path. Set to `false` (or unset) to re-enable.
- Check: feature flags in DB (`feature_flags` table) — SMS features may be disabled.

## Cron Jobs Not Running

1. Jobs use `setInterval` — they start on server boot
2. Check logs for `[cron]` prefix
3. If a job is stuck: restart server (running flag resets)
4. Safety timeout: jobs auto-kill after 5 minutes
5. Job list: `controlCenter.getOverview` → check server startup logs

## Smoke Test

Run anytime to verify core health:
```bash
bash scripts/smoke-test.sh
```
Expected: 21/21 pass. Any failure = investigate that specific endpoint.

## Full System Restart Checklist

1. Kill all node processes: `taskkill //F //IM node.exe`
2. Verify port 3000 is free
3. Start server: `pnpm dev`
4. Wait 10-15s for cron jobs to register
5. Run smoke test: `bash scripts/smoke-test.sh`
6. Open `/cc` in browser
7. Verify: DB connected, AI gateway healthy, cron jobs running

## Disaster Recovery (data loss / corruption / cluster loss)

The sections above cover *availability* (restart, reconnect). This covers *durability* —
recovering customer/lead/order data after deletion, corruption, or a lost TiDB cluster.

### Targets (commitments, not aspirations)

| Metric | Target | Meaning |
|---|---|---|
| **RPO** (max data loss) | ≤ 24h via daily snapshot · **minutes** if PITR is enabled | How far back a restore lands |
| **RTO** (max downtime) | ≤ 2h | Detect → restore → repoint → redeploy → verify |

### TiDB Cloud backup model — VERIFY in console (do not assume)

TiDB Cloud provides automated snapshot backups and, depending on tier/config,
point-in-time restore (PITR). The exact retention window and whether PITR is ON
are **operator-verifiable facts, not assumptions** — confirm them now:

1. tidbcloud.com → cluster → **Backup** tab. Record: automatic-backup schedule,
   retention days, and whether **PITR** is enabled. If PITR is available and OFF, turn it ON
   (it is the difference between losing a day vs. losing minutes).
2. Note the cluster tier (Serverless vs Dedicated) — restore options differ by tier.

### Restore procedure (NEVER overwrite prod in place)

1. **Stop the bleeding:** if corruption is actively spreading, set `SMS_KILL_SWITCH=true` +
   `VAPI_KILL_SWITCH=true` and pause write-heavy crons (Railway env) so the bad state
   doesn't compound while you restore.
2. TiDB Cloud → Backup → **Restore** → restore the chosen snapshot/timestamp to a
   **NEW cluster** (never restore over the live one — you need the live one for forensics
   and as a fallback).
3. Validate the restored cluster: row counts on `leads`, `tire_orders`, `sms_messages`,
   `callbacks` against expectations for that timestamp.
4. **Cut over:** update Railway `DATABASE_URL` (service `MAINnicks-tire-auto`) to the new
   cluster's connection string (keep the `?ssl={"rejectUnauthorized":true}` suffix) → redeploy.
5. `curl -s https://nickstire.org/api/health` → DB `"status":"up"`. Re-enable kill switches.
6. Retire the corrupted cluster only AFTER the restored one is confirmed healthy in prod.

### What a DB restore does NOT cover (close these gaps separately)

- **Railway env vars / secrets** — a single point of failure no DB backup touches. Export the
  `MAINnicks-tire-auto` variables and store them in a sealed secrets vault; without them a
  fresh deploy cannot boot. Re-export whenever secrets rotate.
- **Committed prerendered HTML** — lives in git (`apps/nickstire/prerendered/`); recovered via git, not DB.
- **S3 / CloudFront media assets** — separate durability domain; confirm bucket versioning is ON.

### Drill cadence + role separation

- **Quarterly restore drill:** restore the latest backup to a throwaway cluster, validate row
  counts, then delete it. Record date + result in `truth_os.md`. An untested backup is a
  hope, not a recovery plan.
- **Who can restore:** owner-operator only. Restores create new clusters + rotate
  `DATABASE_URL` — never delegate without supervision.
