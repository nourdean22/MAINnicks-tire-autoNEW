# CURRENT-TRUTH.md — Statenour

> **The one-screen answer to "where am I and what's real?"** If any other doc
> contradicts this file as a *present-tense instruction*, this file and live
> code win. Last verified **2026-07-20**. When in doubt, **verify in code, git,
> the DB, or logs** — not in prose.

## Where this runs

- **App location:** `apps/statenour/` inside the monorepo **`nourdean22/MAINnicks-tire-autoNEW`**.
- **Production deploy:** branch **`main`** → **Railway** (service `statenour-web`) → **https://bdnick.info**. Pushing `main` auto-deploys via per-service watch paths.
- **Companion app:** `apps/nickstire/` (Railway → nickstire.org) — a separate ring; see `docs/REPO-MAP.md`.

## Retired — do NOT treat as current (these are the landmines)

- **Vercel** — **retired** for Statenour production. There is no `vercel.json` crons block; scheduled jobs run via the Inngest mega fan-out.
- `codex/ollama-local` and `statenour-master` branches — **retired**. Never push there; never claim either is the production branch.
- Standalone `nourdean22/statenour-os` repo — **retired** for production. Statenour now lives only in the monorepo above. (As of 2026-07-25 the repo still exists on GitHub and is NOT yet archived there; `config/repos.ts` marks it `stale` pending the actual archive flag.)
- Local path `C:\Users\nourd\NOUR-OS` — **retired**. Canonical checkout is `C:\Users\nourd\NOURCITY`.
- `scripts/pre-push-check.sh` — **retired** Vercel-era artifact (references the retired branches). It is NOT the active hook; the active hook is the repo-root `lefthook.yml` `pre-push` (turbo build --affected); Husky is not used.

## Source-of-truth hierarchy (highest first)

1. `apps/statenour/AGENTS.md` — where we are, how we work, active backlog.
2. `apps/statenour/docs/RECONCILIATION.md` — verified ship-by-ship log (top entry = latest).
3. `apps/statenour/docs/RUNBOOK.md` — operational procedures.
4. `apps/statenour/docs/REPO-MAP.md` — cross-ring repo layout.
5. `apps/statenour/docs/AGENT-CONTRACT.md` — AI agent contract.
6. `apps/statenour/config/repos.ts` — typed repo manifest (mirrors REPO-MAP).
7. `apps/statenour/config/crons.ts` — typed cron manifest (single source; `pnpm check:crons`).
8. **Live code, tests, scripts, git history** — beats any doc on a factual conflict.
9. Archived docs (`docs/archive/**`) — **historical context only, never active instructions.**

## Truth lives in code, not prose (don't hardcode these in docs)

- **Provider / model:** read `lib/ai/provider.ts` (the `AI_PROVIDER` env selects `ollama`|`gemini`|`openai`|`anthropic`; model ids are env-driven) and `lib/ai/domain-routing.ts`. Do **not** assert a model name (e.g. a specific Venice/GLM/Ollama model) as "current" in prose — it drifts; point to the file.
- **Crons:** `config/crons.ts` is the manifest; `pnpm check:crons` verifies it against the filesystem and the Inngest fan-out (`lib/inngest/jobs.ts`).
- **Repos:** `config/repos.ts` + `docs/REPO-MAP.md`.
- **Tailwind colour utilities:** this app is **Tailwind v4** (no `tailwind.config`; `postcss.config.mjs` + `@import "tailwindcss"`). A colour utility exists **only** if its token is registered in the `@theme inline` bridge in `app/styles/tokens.css`. A bare `--primary:` custom property in `:root` does **not** create `bg-primary` — the class silently emits **zero CSS**, with no error, no warning and no visual clue. This shipped: the full shadcn palette was authored in `:root` but never bridged, so `bg-primary` / `border-border` / `text-muted-foreground` were dead app-wide, and the weekly-recurrence weekday picker rendered its selected state identically to unselected — the operator reported the buttons as broken when the click handler was fine (#972/#973, 2026-07-20). All 18 used tokens are now bridged and pinned by `__tests__/theme-token-utilities.test.ts`. **Before styling with a new colour token, check the bridge — do not assume a `:root` variable is enough.**
- **Migrations:** column-first, hand-applied. See `docs/DB-MIGRATION-POLICY.md`, the schema sentinel (`lib/db/schema-sentinel.ts`), and the migration `scripts/`. A migration is "applied to prod" only when run via the guarded `apply-pending-migration` endpoint **and** verified (`prisma migrate status`) — never claim applied otherwise. Never `--accept-data-loss` (drops pgvector/tsvector).

## Active vs historical docs

- **Active:** `AGENTS.md`, `CURRENT-TRUTH.md` (this file), `docs/RECONCILIATION.md`, `docs/RUNBOOK.md`, `docs/REPO-MAP.md`, `docs/AGENT-CONTRACT.md`, `docs/ARCHITECTURE.md`, `docs/runbooks/**`. There is **no** separate "active plan" doc — `RECONCILIATION.md` (ship log) + `AGENTS.md` (backlog) are the live sources; a plan doc that stops being reconciled is historical (see below).
- **Historical (do not paste into agents as current):** `docs/archive/**`, `docs/project/V10-PLAN.md` (v10 control-layer plan, last reconciled 2026-05-08 — HISTORICAL per audit #22), `docs/project/MASTER-CONTEXT.md` (v7-alpha, quarantined), `docs/project/UPGRADE-PLAN.md` (v8.x, quarantined), `docs/UPGRADE-PLAN-V6.md`, dated snapshots (`cohort-*`, `state-of-autonicks-*`, `session-handoff-*`), `adr/*`, `audits/*`.

## Stale-doc guard

`pnpm check:stale-docs` scans active (non-archive) docs + agent-facing files for retired deploy/provider terms used as current instructions. Critical terms (Vercel-as-prod, the retired branches, the standalone repo URL, the retired local path) hard-fail under `STALE_DOCS_STRICT=1`; provider hardcodes warn. A line is exempt if it contains a safe-context word: `historical`, `retired`, `archived`, `do-not-execute`, `obsolete`, `not current`. **Never paste an archived doc into an agent as current context** — quote `CURRENT-TRUTH.md` or live code instead.

## See also

- `docs/runbooks/index.md` — agent operating runbooks (how to work safely here). Guard: `pnpm check:runbooks`.
- `lib/evals/` + `pnpm eval:memory` — the truth scoreboard that checks Nick remembers this file.
- `lib/ai/receipts/action-receipt.ts` — the action-honesty receipt contract (`canClaimDone`).
- `lib/knowledge/action-converter.ts` — knowledge→action suggestions (suggestion-only).
