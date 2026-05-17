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
