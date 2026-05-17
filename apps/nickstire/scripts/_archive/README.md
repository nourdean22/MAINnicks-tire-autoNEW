# Archived Scripts

These scripts are one-shots that already ran in production, completed
their purpose, and don't need to be invoked again. Original archive
2026-05-07 (wave-78) via `pr-review-toolkit:code-simplifier` triage.
**14 more added 2026-05-08** (wave-101 cleanup) — see ALG audit
discovery scripts at the bottom.

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

## Wave-101 batch (added 2026-05-08)

Discovery + one-shot scripts from the wave-95 → wave-101 ALG audit
session. These proved facts about the ALG REST API or one-shot data
fixes. Conclusions documented inline + in commit messages.

### ALG endpoint discovery (proved a fact, won't re-run)
- `diagnose-alg-deep-link.ts` — proved `/ticket/{id}` is SPA-routed (use it for OPEN IN ALG button)
- `diagnose-deep-ticket.ts` — proved no per-ticket detail endpoint exists in REST
- `diagnose-getTicketSearch-shape.ts` — confirmed getTicketSearch returns headers only
- `diagnose-line-items.ts` — 39 endpoint variants probed for line items, all 404
- `diagnose-pagination-and-detail.ts` — proved pageSize is server-capped at 50
- `diagnose-recent-html-dump.ts` — proved `/recent` is React SPA shell, no parseable HTML
- `diagnose-ticket-sessions.ts` — proved sessions don't contain line items
- `diagnose-ticket-shape.ts` — found ticketType discriminator (0=invoice, 1=estimate)

### One-shot data audits (state has moved on)
- `diagnose-phone-format.ts` — proved phone format mismatch between customers + alg_estimates (fixed in wave-100 fuzzy join)
- `diagnose-recent-invoices.ts` — wave-99 spot-check of last 7d invoices
- `diagnose-service-desc.ts` — wave-100 description coverage audit (no fix possible)
- `diagnose-uuid-invoices.ts` — wave-97 leaked-row count (cleaned up via cleanup-invoice-pollution.ts)

### Superseded
- `backfill-cleanup-leaked-estimates.ts` — replaced by `cleanup-invoice-pollution.ts` which handles 3 classes (UUID dupes / orphan migrate / Unknown $0 garbage) instead of just one

