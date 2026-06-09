# Stale-Info Forensic Report — Truth + Intelligence Wave

> **Date:** 2026-06-09 · **Branch:** `statenour-truth-intelligence-wave` (off `main` @ `acad664b`)
> **Author:** Claude (autonomous wave) · **Status:** Phase 1 audit — drives the Phase 2 cleanup.
> This is a dated audit snapshot. Read [`../CURRENT-TRUTH.md`](../CURRENT-TRUTH.md) for live truth.

## Phase 0 — verified current truth (the ground these findings are measured against)

| Fact | Verified value | Source |
|---|---|---|
| App location | `apps/statenour/` in monorepo `nourdean22/MAINnicks-tire-autoNEW` | `AGENTS.md` §1, git remote |
| Production deploy | branch `main` → **Railway** (service statenour-web), served at **bdnick.info** | `AGENTS.md` §1, `config/crons.ts` header, `scripts/verify-crons.ts:10` |
| Retired for prod | standalone `nourdean22/statenour-os` repo · `codex/ollama-local` branch · `statenour-master` branch/mirror · **Vercel** (all) | `AGENTS.md` §1/§Git-flow |
| Retired local path | `C:\Users\nourd\NOUR-OS` (canonical is `C:\Users\nourd\NOURCITY`) | repo CLAUDE.md |
| Provider/model truth | **live code** `lib/ai/provider.ts` (`AI_PROVIDER` env = venice\|ollama; models env-driven) + `lib/ai/domain-routing.ts` — never a prose model name | `lib/ai/provider.ts:92-101,437,468` |
| Cron truth | `config/crons.ts` (verified by `pnpm check:crons`) | file header |
| Repo truth | `config/repos.ts` mirrors `docs/REPO-MAP.md` | file header |
| Migration truth | column-first; `scripts/` + schema sentinel + `docs/DB-MIGRATION-POLICY.md`; applied only via the guarded `apply-pending-migration` endpoint | `AGENTS.md` §7 |
| Test gate | `pnpm verify:hard` (typecheck·lint·test·raw-sql·crons·prompt-size·prisma validate); push gate = `.husky/pre-push` turbo build | `package.json:12`, repo CLAUDE.md |
| Commands | `pnpm typecheck`/`check` (`tsc --noEmit`) · `pnpm test` (vitest) · `pnpm lint` (eslint) | `package.json` |

**Active source-of-truth docs (clean — verified BENIGN):** `AGENTS.md`, `docs/RECONCILIATION.md`, `docs/RUNBOOK.md`, `docs/REPO-MAP.md`, `docs/AGENT-CONTRACT.md` — these mention Vercel/codex only in explicit *retired/was* context.

## Findings

Risk: **C** critical (misleads deploy behavior) · **H** high (stale provider/path) · **M** medium · **L** low.

| # | File:line | Stale claim | Current truth | Risk | Action |
|---|---|---|---|---|---|
| 1 | `docs/project/MASTER-CONTEXT.md:31-36,198` | "Deployed on: Vercel" · "Push to BOTH codex/ollama-local AND statenour-master (Vercel production = statenour-master)" · "Repo: github.com/nourdean22/statenour-os" · "Local path: C:\Users\nourd\NOUR-OS\apps\statenour-os" · "Dania neglect nudge" | monorepo/main/Railway; standalone repo + both branches + Vercel retired; relationship-nag scrubbed from live surfaces (2026-06-03 wave) | **C** | Quarantine → `docs/archive/historical-v7/` + pointer stub. Already HISTORICAL-bannered but body reads as live instructions and sits in the active tree. |
| 2 | `docs/project/UPGRADE-PLAN.md:28,38-39,183-184,558` | rule "Single push to codex/ollama-local (deploys directly to bdnick.info)" · "Prod branch: codex/ollama-local … Vercel project config" · "Vercel dashboard → Project statenour-os → … Production Branch" · `cd C:/Users/nourd/NOUR-OS/...` | same as #1 | **C** | Quarantine → `docs/archive/historical-v8/` + pointer stub. |
| 3 | `config/repos.ts:58-73` | personal-ring **core** entry `statenour-os` / `nourdean22/statenour-os` w/ `productionUrl: bdnick.info` + note "Mirror branch statenour-master is fast-forwarded by CI on green push." | bdnick.info now deploys from the monorepo `apps/statenour` on `main`; the statenour-master CI mirror is retired (the `pre-push-check.sh` that referenced it is a dead artifact per `AGENTS.md`) | **C** | Fix in place: relabel the entry as the **retired standalone** repo (`status:"archived"`, `monitored:false`, correct purpose/notes, drop bdnick.info as its prod URL). Read by the live `/system/repos` page — correct fields, don't delete the entry. |
| 4 | `AGENTS.md:130` | resume step `cd C:\Users\nourd\OneDrive\Desktop\nickstire-repo-staging\apps\statenour` | canonical checkout `C:\Users\nourd\NOURCITY` | **H** | Fix in place. |
| 5 | `docs/BUSINESS-LANDSCAPE.md:187` | "Venice — … Nour's primary provider" (no historical banner) | provider chain is env/code-driven (`lib/ai/provider.ts`) | **H** | Fix in place → point to code. |
| 6 | `docs/ARCHITECTURE.md:~316` | "Venice (fallback · GLM-4.7-flash-heretic)" | model names are env-driven; `GLM-4.7` is stale | **H** | Fix in place → point to `lib/ai/provider.ts`. |
| 7 | `docs/CONSOLIDATION-PLAN-2026-05-16.md:228` | "Update vercel.json deployment branch ref (statenour-master → codex/ollama-local)" in an IN-PROGRESS plan | no `vercel.json`; Railway | **M** | Add HISTORICAL banner (dated plan; Wave 56 fallout long shipped). |
| 8 | `docs/UPGRADE-PLAN-V6.md:32` | V6-era provider order "Venice (1st) → Ollama …" | env/code-driven | **M** | Already V6-named/historical; covered by guard warn-level + add banner if missing. |
| 9 | `scripts/pre-push-check.sh` | references `codex/ollama-local` / `statenour-master` | dead Vercel-era artifact; **not** the active hook (`.husky/pre-push` is) | **M** | `AGENTS.md` already says "ignore it." Add a one-line `# RETIRED — not the active hook` header so a future agent doesn't run it. |

**Already-safe historical (no action):** everything under `docs/archive/**`, dated snapshots (`cohort-*`, `state-of-autonicks-*`, `session-handoff-*`), `adr/*`, `audits/*`, `docs/runbooks/*` cutover runbooks, and the active SoT docs in the BENIGN list above.

## Guard requirement

A new `scripts/check-stale-docs.ts` (`pnpm check:stale-docs`) must catch future regressions of findings #1-#9 in **active** (non-archive) docs: critical banned terms hard-fail under `STALE_DOCS_STRICT=1`, provider terms warn. Archive + lines containing safe-context words (historical/retired/archived/do-not-execute/obsolete/not current) are exempt. Backed by a unit test.
