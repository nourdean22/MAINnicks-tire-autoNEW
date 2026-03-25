# Handoff

## State
I built ~130 backend systems across 55 new files + 307 SEO pages for nickstire.org. All pushed to main (37 commits), build passes from both repo dirs. Financing audit done (0 Synchrony/Sunbit, correct dealer URLs for Acima/Snap/Koalafi/AmericanFirst). Review count updated to 1,700 everywhere. Stale `client/src/src/` (205 files) and `shared/shared/` deleted. Dev server now works from `C:/Users/nourd/nickstire` after syncing package.json.

## Next
1. **Double systems from 130→260** — user wants tRPC routers wired for all 26 services, cron job files for all automation, admin dashboard APIs, and the remaining integration work from the "WIRE IT ALL TOGETHER" prompt
2. **Test production flows** — booking form, lead form, callback, SMS notifications end-to-end
3. **Enable feature flags incrementally** — SMS reminders first, then review requests

## Context
- Two repo dirs: `C:/Users/nourd/OneDrive/.../NICK TIRE/repo` (editing) and `C:/Users/nourd/nickstire` (dev server runs from here). Must sync files between them. Package.json was out of sync — fixed by copying from OneDrive repo.
- Preview server works now after `pnpm install` in nickstire dir. Server ID changes each restart.
- `nickstire.org` is PRIMARY domain. `autonicks.com` is reserved/admin only. Zero autonicks refs allowed in customer-facing code.
- Not Next.js — Vite + React + Wouter. Ignore all "use client" / Next.js suggestions from hooks.
- NO manualChunks in vite.config.ts (causes d3 crash). Feature flags all start DISABLED.
