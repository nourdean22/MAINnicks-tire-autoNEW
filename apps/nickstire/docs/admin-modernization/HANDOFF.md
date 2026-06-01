# Admin Modernization — Continuation Handoff

> Branch `nickstire/admin-modernize` · worktree `C:\Users\nourd\NOURCITY\.worktrees\admin-modernize`. **7 commits, NOT pushed/deployed.** All code-only (no migration). Rebased onto `origin/main` (2026-06-01). Operator chose **"keep building, deploy once"** — batch then one Railway deploy.

## Commits (all gates green: typecheck + brand-voice + source-lint + hooks + routes)
1. `9e1009be` — P1.1 · promote ghost `drip_enrollments` into Drizzle (prod already had it; no migration).
2. `6ef3d273` — docs · exploration profile + plan + deconfliction.
3. `e68f8480` — **P2 · prune 44 of 52 dead intelligence tRPC procs** (418→162 ln). 8 LIVE kept, services untouched, tsc=0.
4. `c2f6c098` — **P3 · opt-in neutral theme** — scoped `.admin-shell[data-admin-theme="neutral"]` token override + sidebar toggle.
5. `6466f50f` — docs · handoff.
6. `e260d685` — P3 · theme honesty — tokenized 2 hardcoded-gold chrome leaks (Compliance tab + Memberships badge → `primary`).
7. `71e9557f` — **P1 · declare existing prod constraints in Drizzle** (cron_alerts_fired composite PK + voice_followups `uniq_booking_touch`). Def-sync, no migration.

## Status by phase
- **Phase 1 (data):** DONE for my lane. drip promoted; cron+voice constraints declared. SMS slice = sibling-owned (shipped). **Canonical customer identity (INT/VARCHAR(36)/BIGINT) = DEFERRED** behind sibling's `0064` phone-normalize migration (build the canonical key on their 10-digit keys once landed).
- **Phase 2 (API):** DONE. 44 dead procs pruned. ("Bundle Today's queries" = cut, it's a refetch-cadence trap. Stream emitters already exist.)
- **Phase 3 (UI):** theme done + honest. **REMAINING (need direction):** god-file consolidation, entity-page growth.

## Biggest findings (don't re-derive)
- **Stream (`OverviewSection`) + Command (`CommandSearch`, wired Admin.tsx:18/586) ALREADY BUILT** (May rebuild) → restyle, not rebuild.
- **SMS data layer = sibling-owned** (`30759483`/`26341543`/`dd65a4a0`) → dropped my Phase-1 SMS items (verified via `git log HEAD..origin/main`).
- **`/admin/content` is NOT a duplicate route** — single registration → real `AdminContent` page. Exploration's "duplicate" was imprecise. Don't delete.
- **"Missing unique indexes" was stale** — the constraints exist in prod; only the Drizzle def was missing them (def-sync, not migration).
- Theme works via Tailwind v4 `@theme inline` (utilities resolve `var()` at runtime).

## Next (operator to steer — these are the real forks)
- **God-file consolidation** (Voice 1678 / Revenue 1593 / Customers 1495 / shared 1265): biggest "cleaned up" item BUT low operator-felt-value + HIGH-risk churn (only safety net is tsc, which misses behavioral regressions). **Recommend: explicit go-ahead + a careful, behavior-verified, one-file-at-a-time approach (or a flag-gated parallel), not a rushed batch.**
- **Entity-page growth** (`CustomerDrawer` → full Customer page): higher felt-value, the "Entities" half of the IA. Feature build.
- **Deploy** (gated): push 7 commits to main → Railway. Run full `pnpm build` + `nickstire-shared-main-push` protocol (fetch→rebase→explicit-path→pre-push turbo build; never `--no-verify`/force).

## Preview the neutral theme (after deploy): `/admin?adminTheme=neutral` or the sidebar **Theme** toggle. Default = grit (live look).

## Gotchas
- `pnpm install` in worktree exits 1 on statenour postinstall (Windows) — BENIGN; node_modules populated, check/hooks work.
- No backticks in `git commit -m "..."` (bash command-substitutes them).
- Bash cwd PERSISTS between calls in this harness (the CLAUDE.md "resets to C:\" note is stale here) — but absolute paths are still safest.
