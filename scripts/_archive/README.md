# Archived Scripts

These 19 scripts are one-shots that already ran in production, completed
their purpose, and don't need to be invoked again. Archived 2026-05-07
(wave-78) via `pr-review-toolkit:code-simplifier` subagent triage.

Git history preserves the originals — recover with `git log --all --
scripts/<filename>` if a similar one-shot is needed in the future.

## Per-file disposition

### Migrations applied to production (won't run again)
- `apply-customer-events-migration.ts` — drift workaround, applied
- `apply-migration-0028.mjs` — gbp_post_log migration
- `apply-migration-0029.mjs` — ALG demand-driven probe budget
- `run-backfill.mjs` — Phase-33 customer DB import (1,972 records)
- `run-migrations.mjs` — superseded by `db-migrate.ts` (drizzle)
- `cleanup-junk-bookings.ts` — 2026-04 stabilization one-shot

### Seeds (already seeded)
- `seed-blog.mjs`
- `seed-blog-batch-2.mjs`
- `seed-blog-batch-3.mjs`

### Diagnostics (point-in-time investigations)
- `gmaps-key-probe.mjs` — Google Maps key diagnostic
- `places-diagnose.mjs` — Google Places API diagnostic
- `load-test.ts` — PIT-CREW deploy load test
- `msg-length.mjs` — SMS segment-length calc (Phase-37)
- `sms-audit.mjs` — Phase-37 SMS audit

### Already-applied patches
- `patch-vapi-analysis.mjs` — Vapi PATCH applied

### Stale dev launchers
- `dev-launcher.bat` — redundant with `pnpm dev`
- `dev-server.bat` — wrong absolute path (`C:\Users\nourd\MAINnicks-tire-autoNEW`)

### Phase-4 features no longer in arsenal
- `fetch-instagram.mjs` — IG feed not in current integration set
- `optimize-photos.mjs` — self-described "one-time photo optimization"

## NOT archived (still active)

- All scripts wired to `package.json` commands (`pnpm build`, `verify`,
  `lint:hooks`, `prerender`, `regen`, etc.) — staying in `scripts/`
- All manual SEO/GSC tools (recently used)
- VAPI assistant config (operator-controlled)
- Tunnel + RTSP camera scripts (5 files) — kept pending operator decision
  on whether the tunnel/camera infra is still in use
