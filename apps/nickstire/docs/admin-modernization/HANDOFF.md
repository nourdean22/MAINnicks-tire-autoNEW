# Admin Modernization — Continuation Handoff

> Branch `nickstire/admin-modernize` · worktree `C:\Users\nourd\NOURCITY\.worktrees\admin-modernize`. **4 verified commits on the branch — NOT pushed, NOT deployed, NOT prod-applied.** Rebased onto current `origin/main` (2026-06-01).

## Commits this session (all gates green: typecheck + brand-voice + source-lint + hooks + routes)
1. `9e1009be` — Phase 1.1 · promote ghost `drip_enrollments` into `drizzle/schema.ts` (table already in prod via inline DDL → no migration needed; just makes Drizzle aware).
2. `6ef3d273` — docs · exploration profile + validated plan + deconfliction.
3. `e68f8480` — Phase 2 · **prune 44 dead intelligence tRPC procedures** (418→162 ln). Kept the 8 LIVE; services untouched (cron uses them); tsc=0 proves no client broke.
4. `c2f6c098` — Phase 3 · **opt-in neutral theme** (Linear/Vercel calm) scoped to `.admin-shell[data-admin-theme="neutral"]`.

## Biggest findings (these REWROTE the plan — don't re-derive)
- **The SMS data layer is sibling-owned.** Concurrent nickstire session already shipped status-honesty (`30759483`), conv-key normalize (`26341543`), + drafted `0064` phone-normalize/merge migration (`dd65a4a0`). My Phase-1 SMS items (#1 status, #2 phone, #3 dedup, #6 opt-out) = DROPPED (would duplicate + conflict).
- **The "Stream + Command" IA is already ~70% BUILT — restyle, don't rebuild.** Stream = `OverviewSection.tsx` (May-2026 rebuild: MorningBrief→stat pills→`nextBestActions`→Priority Queue→AI insights→WaveMetricWins). Command = `CommandSearch.tsx`, wired in `Admin.tsx:18,586` with Cmd+K.
- **"Bundle Today's 11 queries" is a TRAP** — they carry tuned refetch cadences (15s shopPulse … 300s masterReport); one bundle = one cadence = degraded. Cut. (Core 5 already bundled via `adminDashboard.overviewMediumBundle`.)
- **Intelligence API was 85% dead** (8 of 52 procs had consumers) — pruned.
- Theme works because Tailwind v4 `@theme` is `inline` → utilities resolve `var()` at runtime → overriding ~30 CSS vars on one element re-skins the whole 20k-line admin subtree. Customer site (plain `:root`) untouched.

## How to preview the neutral theme (needs a deploy first — it's branch-only)
`/admin?adminTheme=neutral` (persists to localStorage) OR the new **Theme toggle in the sidebar footer**. Revert: `=grit` or toggle back. Default is grit (live look) — zero change until opted in.
- **8 minor hardcoded-gold leaks remain** (ComplianceSection ×1, MembershipsSection ×2, OverviewSection ×1, shared.tsx ×4) — polish AFTER the operator approves the direction (don't over-polish pre-validation).

## Next (gated / options — operator to steer)
- **DEPLOY DECISION (gated):** all 4 commits are code-only (no migration). Pushing to `main` → Railway deploys nickstire live. Needs operator OK (live-site change + shared-main build gate). Push via fetch→rebase→explicit-path→pre-push turbo build · never `--no-verify`/force.
- **God-file consolidation** (the big "cleaned up" ask): Voice 1678 / Revenue 1593 / Customers 1495 / shared.tsx 1265. Biggest value, biggest risk — own careful pass (likely agent-assisted).
- **Phase 1 #8** — non-SMS unique indexes (`cronAlertsFired (alertKey,firedFor)`, `voiceFollowups (bookingId,touch)`): additive, mine, conflict-free; dedup-FIRST at apply time. + canonical customer identity (deferred behind sibling's `0064`).
- **Retire `/admin/content` duplicate route** + entity-page growth from `CustomerDrawer`.

## Gotchas
- `pnpm install` in worktree exits 1 on statenour's postinstall (`'true' not recognized`, Windows) — BENIGN; node_modules populated, check + hooks work.
- `git commit -m "...\`x\`..."` — backticks in double-quoted -m trigger bash command-substitution (ate the word "inline" in `c2f6c098`'s message). Use single quotes / no backticks.
- Bash cwd resets to `C:\` between calls; Grep/Glob cwd tracks the last Bash `cd`. Prefix `cd` or use absolute paths.
- `nickstire-verify` = local gate; brand-voice lint scans client/server source only.
