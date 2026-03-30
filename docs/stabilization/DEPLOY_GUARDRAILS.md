# Deploy & Recovery — nickstire.org

## Deploy Branch: main
## Hosting: Railway (auto-deploys on push to main)
## Package Manager: pnpm 10.4.1 (via corepack)
## Build Command: pnpm build (vite build && esbuild server/_core/index.ts)
## Start Command: pnpm start (NODE_ENV=production node dist/index.js)
## Node Version: 20.20.2
## Region: us-west2

## Before Every Push
Run `./scripts/verify-before-push.sh`

## If the Site Goes Down
1. Check Railway dashboard — latest deploy status
2. If deploy FAILED: check build logs, fix locally, push again
3. If deploy SUCCEEDED but site broken: check Railway runtime logs
4. Emergency rollback: `git revert HEAD && git push origin main`

## If Railway Shows "Stale" Deploy
Railway keeps the last SUCCESSFUL deploy running. If new deploys fail,
old (potentially broken) code stays live. This is how the March 2026
outage happened. Always verify deploys succeed after pushing.

## Lockfile Rules
- NEVER commit package.json changes without running `pnpm install` and committing pnpm-lock.yaml
- Railway runs `pnpm install --frozen-lockfile` which rejects mismatched lockfiles
- The pre-push script catches this automatically

## Twilio Safety
The Twilio validation middleware must ONLY be scoped to the webhook router.
Never mount it globally. See server/middleware/twilioValidation.ts for details.
