# Admin Modernization — Continuation Handoff

> Branch `nickstire/admin-modernize` · worktree `C:\Users\nourd\NOURCITY\.worktrees\admin-modernize`. **11 commits, NOT pushed/deployed.** All code-only (no migration). Rebased onto `origin/main` (2026-06-01). Operator chose **"keep building, deploy once"** → batch then one Railway deploy.

## Commits (every one gate-green: typecheck + brand-voice + source-lint + hooks + routes)
- `9e1009be` P1.1 · promote ghost `drip_enrollments` into Drizzle (no migration; prod had it).
- `6ef3d273` docs · exploration + plan + deconfliction.
- `e68f8480` **P2 · prune 44 of 52 dead intelligence procs** (418→162).
- `c2f6c098` **P3 · opt-in neutral theme** (`.admin-shell[data-admin-theme="neutral"]` token override + sidebar toggle).
- `6466f50f` / `7c671846` docs · handoff.
- `e260d685` P3 · theme honesty (tokenized 2 gold leaks).
- `71e9557f` **P1 · declare prod constraints in Drizzle** (cron_alerts_fired PK + voice_followups unique). Def-sync, no migration.
- `d0df7cb1` **god-file · VoiceReceptionistSection 1678→410** (voice/ — format + 6 components).
- `958cdd74` **god-file · CustomersSection 1495→855** (customers/ — format + 4 components).
- `a59f4da8` **god-file · RevenueSection 1593→177** (money/ — revenueFormat + 7 components/views).

## Status — Phases 1, 2, 3-core all DONE
- **P1 (data):** done for my lane (drip + cron/voice def-sync). SMS slice = sibling (shipped). Canonical identity now UNBLOCKED (sibling applied `0064` — `87464cc3`) but likely sibling-owned; not started here.
- **P2 (API):** done (44 dead procs pruned).
- **P3 (UI):** neutral theme done + honest; **all 3 named god-files split** (Voice/Revenue/Customers) via verbatim extraction (move, zero logic change — verified by +N-imports-only diff signature + tsc=0 + lint:hooks=0 each).

## How the god-file splits stay safe (the method, for the next one)
Verbatim extraction: move self-contained top-level components + pure helpers/types into a co-located `<topic>/` subdir, import back. NO logic/JSX/className/hook-order change — only add `export` + adjust import paths. Verify: `git diff <file> | grep -cE '^\+[^+]'` should equal the import count (pure relocation), tsc=0, lint:hooks=0. Brand-voice lint scans moved COMMENTS — reword flagged words to a technical synonym (never `--no-verify`).

## Next (operator to steer)
- **DEPLOY** (gated, their OK needed): push 11 commits → main → Railway. Pre-push runs full turbo build (I pre-verified `pnpm build` locally). Use `nickstire-shared-main-push`: fetch→rebase→explicit-path→pre-push build; never `--no-verify`/force.
- **shared.tsx (1265)** = the 4th god-file BUT highest blast radius (every section imports it). Deliberately untouched — needs explicit go-ahead + extra care.
- **Entity-page growth** (`CustomerDrawer`/`Customer360Panel` → full Customer page) — feature build, the "Entities" half of the IA. (Offered; operator picked god-files instead.)
- **Canonical customer identity** — now unblocked by sibling's `0064`; coordinate (likely their lane).

## Preview neutral theme (after deploy): `/admin?adminTheme=neutral` or sidebar **Theme** toggle. Default = grit (live look, zero change until opted in).

## Gotchas
- Bash cwd PERSISTS between calls here (CLAUDE.md "resets to C:\" is stale) — but watch for doubled relative paths after a `cd` into apps/nickstire.
- No backticks in `git commit -m "..."` (bash command-substitutes them).
- `pnpm install` in worktree exits 1 on statenour postinstall (Windows) — BENIGN.
- Brand-voice kill-list lint scans source incl. comments — moved comments can trip it (reworded "unmatched"→"unlinked" in Customer360Panel).
