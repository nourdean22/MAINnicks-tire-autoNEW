# statenour-web · deploy contract

**Live URL** · https://statenour-web-production.up.railway.app · custom domain `bdnick.info` (Railway-managed · attach in the service's Networking settings)

## Railway service

| Field | Value |
|---|---|
| Project | `natural-appreciation` |
| Project ID | `d78487fa-24c7-412e-9d2c-1055d9f8db93` |
| Service | `statenour-web` |
| Service ID | `c68ce7f7-63b1-47bf-9e9e-2d7dfe717d4e` |
| Environment | `production` (`84f0d4b4-efcd-480f-a761-27589e0a095f`) |
| Region | US West |
| Replicas | 1 |
| Build context | monorepo root (NOT `apps/statenour/`) |
| Dockerfile | `apps/statenour/Dockerfile` |

## Deploy trigger

Auto-deploys on push to **`main`** of `nourdean22/MAINnicks-tire-autoNEW.git` when a file
matching `apps/statenour/**` (or workspace deps via Turbo affected detection) changes.

Cross-app commits (e.g. nickstire-only) skip this service · expected behavior.

To force a redeploy: Railway dashboard → service → ⋮ → **Redeploy**. Will rebuild from
the same commit · use this when you suspect a cache poisoning bug, not for code changes.

## Pre-deploy validation (local, automatic)

The `.husky/pre-push` hook runs `turbo run build --affected` before every `git push`.
This catches Next.js 16 prerender errors (e.g. `useSearchParams()` outside Suspense)
locally instead of finding them in Railway logs hours later.

To validate manually:

```bash
pnpm build:stn          # builds statenour only via Turbo
pnpm verify:affected    # check + lint + test for changed apps
```

## Post-deploy smoke test (Tier-2-G follow-up · 2026-05-19)

After Railway finishes deploying (~3-5 min after push), run:

```bash
pnpm --filter @statenour/web smoke:prod
```

This hits the live URL and verifies:
1. `GET /` returns 200 (or auth redirect · either is healthy)
2. `GET /api/system/heartbeat` returns 200 (Railway healthcheck)
3. `GET /auth/sign-in` returns 200 (auth wall accessible)
4. No 5xx server errors

Zero deps · runs in ~1.2s · can be aliased to a different URL for staging:

```bash
pnpm --filter @statenour/web smoke:prod --url=http://localhost:3001
```

For full UI smoke (authenticated chat layout · Wave 40 assertions etc.) use
the standalone Playwright script at `~/.claude/skills/playwright-skill/`:

```bash
node ~/.claude/skills/playwright-skill/run.js /tmp/playwright-test-statenour-smoke.js
```

That requires operator credentials in the browser context · out of scope
for the lightweight `smoke:prod` check.

## Build pipeline

```
deps  → install pnpm@10.4.1 workspace deps · cached on package.json + lockfile hash
build → prisma generate · next build · emit .next/standalone
runtime → minimal alpine + just the standalone server
```

The Dockerfile uses BuildKit cache mounts (post-Tier-2-F) so consecutive deploys with
unchanged dependencies skip the pnpm install layer. Cache invalidates automatically on
`package.json` / `pnpm-lock.yaml` changes · no manual cache-bust comments needed.

## Env vars (Railway-managed)

CRITICAL (deploy fails if absent):
- `DATABASE_URL` · Neon Postgres pooled
- `CRON_SECRET` · cron endpoint auth

Common:
- `OPENAI_API_KEY` · fallback provider
- `ANTHROPIC_API_KEY` · fallback provider
- `OLLAMA_API_KEY` · Ollama Cloud Pro
- `STATENOUR_SYNC_KEY` · cross-service signing
- `TELEGRAM_WEBHOOK_SECRET` · ops alerts
- `MAKE_WEBHOOK_SECRET` · automation hub
- `GITHUB_TOKEN` · cross-repo health probes

Full list visible at Railway → service → **Variables**. Mirror in `apps/statenour/.env.local`
for local dev.

## Rollback

Two routes:

1. **Roll back to previous successful deploy** (preferred · fast):
   Railway dashboard → service → **Deployments** tab → previous green deploy → ⋮ → **Redeploy**

2. **Revert commit + push**:
   ```bash
   git revert <bad-sha>
   git push origin main
   ```
   Auto-deploys via the standard push trigger. Takes 3-5 min.

## Common failure modes

| Symptom | Diagnosis | Fix |
|---|---|---|
| Deploy says "SKIPPED · No changes to watched files" | Commit only touched files outside `apps/statenour/**` | Expected behavior · service stays on prior version |
| Build fails at `next build` with `useSearchParams() should be wrapped in a suspense boundary` | Client-side hook not wrapped | Wrap inner component in `<Suspense>` · page-level `force-dynamic` does NOT work for `"use client"` pages |
| Build fails at `prisma generate` | Schema drift between prisma/schema.prisma and Neon | Run `prisma migrate deploy` against prod · check `prisma/migrations-pending/` |
| Build fails at COPY package.json with checksum error | Stuck BuildKit cache on Railway | Tweak the Dockerfile content (any comment change works · post-Tier-2-F this should be rare) |
| Active deploy timestamp says "4h ago" after a push | Watch paths didn't match · OR build is queued/failing silently | Open Deployments tab · toggle "Hide Skipped" off · inspect latest build log |

## Related docs

- `apps/statenour/Dockerfile` · the build itself
- `docs/MIGRATION_PLAN.md` · monorepo cutover history
- `docs/ARCHITECTURE.md` · service topology
- `turbo.json` (root) · pipeline + cache config
