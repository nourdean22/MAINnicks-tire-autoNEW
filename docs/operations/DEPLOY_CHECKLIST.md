# Deployment Checklist — Nick's Tire & Auto
Generated: 2026-03-29

## Pre-Deploy (every deploy)

- [ ] `npm run build` passes locally
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)
- [ ] No new required env vars added without updating Railway / production env
- [ ] No `console.log` of secrets or sensitive customer data introduced
- [ ] Rate limits haven't been raised (verify AI=20/hr, forms=10/hr)

## For schema changes (DB migrations)

- [ ] Migration file reviewed — no destructive `DROP` without backup
- [ ] Migration tested on staging DB or TiDB branch first
- [ ] `drizzle-kit push` or `migrate` run and verified

## After deploy

- [ ] `GET /api/health` returns `{ status: "healthy" }` and `checks.database.status: "up"`
- [ ] `GET /api/ping` returns 200
- [ ] Check Railway deploy logs for any FATAL/startup errors
- [ ] Test booking form submission end-to-end (sends SMS + appears in DB)
- [ ] Check admin panel loads and data visible at `/admin`

## Rollback procedure

1. Go to Railway → Deployments → click previous deployment → **Redeploy**
2. Verify `/api/health` returns healthy after rollback
3. If DB migration was included: run the down migration or restore from backup

---

## Hotfix procedure

For critical production bugs:

1. Create branch: `git checkout -b hotfix/YYYY-MM-DD-description`
2. Apply minimal fix only — no other changes
3. Test locally: `npm run build && npm run dev`
4. Push to Railway: `git push origin hotfix/...` (auto-deploys if main is linked, otherwise push to main)
5. Verify `/api/health` after deploy
6. Merge branch back to main

---

## Environment variable changes

When adding a new env var:
1. Add to Railway dashboard → Variables
2. Add to `.env.example` with a description (not the real value)
3. If required at startup: add to `REQUIRED_ENV` array in `server/_core/index.ts`
4. Document in `docs/security/ENV_AUDIT.md`

---

## Secrets rotation

If a secret is compromised:
1. Rotate immediately in the provider (Twilio, OpenAI, etc.)
2. Update in Railway Variables
3. Redeploy (Railway picks up new env vars on next deploy)
4. Check logs to verify old secret is no longer used
