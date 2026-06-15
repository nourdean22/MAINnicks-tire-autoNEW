# AGENT-CONTEXT.md — Statenour OS (NOUR OS)
> Quick-load context for Antigravity and any AI agent working on `apps/statenour/`.
> For full context, read `AGENTS.md` in this directory. For one-screen reality check,
> read `docs/CURRENT-TRUTH.md`. For monorepo rules, read root `AGENT-OPERATING-PROFILE.md` and the [CIITTY framework](.agents/frameworks/ciitty/SKILL.md).
>
> Last verified: 2026-06-10 · Post chat-error closeout + Journey Engine wave

---

## What This App Is

**Statenour OS / NOUR OS** — Nour Dean's personal mastery system. Goals, habits, journal,
AI brain memory, relationship intelligence, daily briefing, XP system, and operator insights.

This is a **personal operating system**, not a public product. Every decision reflects
Nour's life, habits, business, and growth strategy.

- **Production:** `https://bdnick.info`
- **Railway service:** `statenour-web`
- **Local path:** `[REPO_ROOT]/apps/statenour/`
- **Deploy:** Push `main` → Railway auto-deploys via per-service watch path on `apps/statenour/**`

---

## ⚠️ Retired Paths — Do Not Reference

| Retired Item | What to Use Instead |
|---|---|
| Vercel | Railway only |
| `codex/ollama-local` branch | `main` only |
| `statenour-master` branch | `main` only |
| `nourdean22/statenour-os` repo | This monorepo only |
| `C:\Users\[LOCAL_USER]\NOUR-OS` (or other local variants) | `[REPO_ROOT]` |
| `scripts/pre-push-check.sh` | `.husky/pre-push` |

**`pnpm check:stale-docs` guards against retired-path references in active docs.**

---

## Stack at a Glance

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI | React 19 + Tailwind CSS 4 |
| ORM | Prisma 7 |
| Database | Neon Postgres (+ pgvector + tsvector) |
| AI | AI SDK v6 · Venice (primary) · Ollama (local fallback) · OpenAI |
| Tests | Vitest (~3007 tests / 211 files) |
| Workflows | Inngest (durable crons + fan-out) |
| Deploy | Railway Docker |

---

## Key System Layers

| System | Files | Purpose |
|---|---|---|
| Brain / Memory | `lib/brain/**` | BrainMemory · pgvector recall · BGE reranker |
| Mastery / XP | `lib/mastery/**` | Goals · stats · character sheet · Ambition Engine |
| Nick AI | `lib/ai/**` | Chat pipeline · system prompt · fabrication defense |
| Journal | `app/(mastery)/journal/**` | Journey Engine · 7-mode capture |
| People / Intel | `lib/brain/people-intel.ts` | Power Atlas CRM scoring |
| Crons | `config/crons.ts` | Single source — verified by `pnpm check:crons` |
| tRPC API | `lib/trpc/routers/**` | Domain-split (was god-file, now split) |
| Auth | `auth.ts` + `middleware.ts` | Owner-only routes |

---

## Verify Gates (Run Before Every Push)

```bash
cd [REPO_ROOT]/apps/statenour

pnpm typecheck          # tsc --noEmit — MUST be 0 errors
pnpm lint               # eslint — ~359 pre-existing `any` warnings are non-blocking; only errors fail
pnpm test               # vitest — READ THE SUMMARY LINE, not $?
                        # ~12 pre-existing unhandled-rejection errors + 1 intermittent flake = expected
                        # needs @statenour/lenses built first (or ~5 strategic-frameworks files fail)
pnpm verify:hard        # MASTER GATE: typecheck · lint · test · raw-SQL · crons · prompt-size · prisma validate
pnpm check:stale-docs   # verify no retired terms used as current instructions
pnpm check:crons        # verify cron manifest vs filesystem
```

### Pre-Push Hook

`.husky/pre-push` → `turbo run build --filter=...[upstream]`
This runs for ALL affected apps — statenour build errors block even nickstire-only pushes.

---

## Migration Rules — pgvector Safety

```
NEVER: prisma db push --accept-data-loss
       → silently drops pgvector (embedding_vec, embedding_vec_1536) + tsvector columns
       → production killer — requires recovery scripts

CORRECT migration process:
  1. Write column-first SQL
  2. Apply via: /api/system/apply-pending-migration (guarded endpoint)
  3. Verify: pnpm tsx scripts/run-schema-sentinel.ts (14 expectations green)
  4. Confirm: prisma migrate status → compare to prod
  5. Document in docs/RECONCILIATION.md

pgvector lives at: vector_embeddings.embedding_vec + embedding_vec_1536
tsvector lives at: chat_messages.searchable_tsv (GENERATED column)
Both declared as Unsupported(...) in schema — Prisma sees them but won't drop them
(when --accept-data-loss is NOT used)
```

---

## AI Provider Rules

```
AI_PROVIDER env selects: venice | ollama (default: venice)
DO NOT hardcode AI_PROVIDER in production Railway config — disables failover
Model names are env-driven — do not assert a specific model name in docs (it drifts)

Structured JSON schema → use OpenAI invokeLLM() only (Ollama can't do strict schemas)
Image generation → Venice flux-2-pro ($0.04/img — do not switch to gpt-image-1 without billing check)
```

---

## Fabrication-Defense Stack (Do Not Break)

Nick AI (the chat persona) has a 5-layer fabrication defense. When working on chat:

| Layer | File | What It Does |
|---|---|---|
| L1 prompt | `lib/ai/system-prompt.ts` | Model told: never claim past-tense action without tool call |
| L2 rewrite | `lib/ai/chat/fabrication-rewriter.ts` | Detected fabrication gets verifier banner |
| L3 neutralize | `lib/ai/chat/sanitize-history.ts` | Verifier-marked turns get replaced to stop compounding |
| L4 grounding | `lib/ai/chat/truth-grounding.ts` | Task counts pre-injected as system facts |
| L5 chip | `components/chat/action-claim-warning.tsx` | Red inline chip shows operator diagnostic |

**Do not remove or bypass any of these layers.**

---

## Cron Safety Rules

```
Single source of truth: config/crons.ts
Verified by:           pnpm check:crons
Runs via:              Inngest mega fan-out (not vercel.json crons block — that's retired)

To add a cron:   Register in config/crons.ts → add route → test with pnpm check:crons
To remove:       Mark dormant first (don't delete running crons) → verify no callers
CRON_SECRET:     Must be set in Railway env for crons to fire
```

---

## Active State (2026-06-10)

- **Tests:** ~3007 tests / 211 files · all pass
- **Prod migrations:** 31 applied (column-first, hand-applied)
- **Latest ships:** chat `.match` crash fix · Journey Engine wave · morning-brief writer restored
- **AI tools:** Venice primary · Ollama fallback · OpenAI for structured output
- **5-layer fabrication defense:** Live and verified
- **Ambition Engine:** P1–P3 complete · P4+ deferred

## Active Backlog (Priority Order — Don't Re-Attempt Shipped Items)

1. Watch judge-eval calibration verdict (`/system/judge-eval` · needs n≥30 comparisons)
2. Phase 0 prerequisites for v2 prompt cutover (see `docs/v2-prompt-cutover-plan.md`)
3. Phase 1 v2 prompt-builder canary (flip `NICK_PRIME_PROMPT=on` for 10% of turns)
4. Calibration plot on `/brain` (math shipped; UI deferred until ≥10 resolved predictions)
5. Per-policy fire history view (full chronological history not yet rendered)

## Operator-Gated Items (Agent Cannot Do These)

- Set `CRON_SECRET` + `STATENOUR_SYNC_KEY` on Railway dashboard
- Verify Railway mega cron fires
- Set `GOOGLE_SERVICE_ACCOUNT_KEY` if still missing
- Check Inngest dashboard for silent crons

---

## Source of Truth Hierarchy

1. `AGENTS.md` — where we are, how we work, active backlog ← **READ THIS FIRST**
2. `docs/CURRENT-TRUTH.md` — one-screen reality check
3. `docs/RECONCILIATION.md` — verified ship-by-ship log (top entry = latest)
4. `docs/RUNBOOK.md` — operational procedures
5. `docs/AGENT-CONTRACT.md` — full AI agent contract
6. Live code, tests, scripts, git history — beats any doc on factual conflicts
7. `docs/archive/**` — HISTORICAL ONLY, never active instructions

---

## Session Resumption (Copy-Paste Ready)

```bash
# 1. Navigate to app
cd [REPO_ROOT]/apps/statenour

# 2. Check current state
git log --oneline -10
cat docs/CURRENT-TRUTH.md

# 3. Read last session
cat .remember/now.md

# 4. Check latest reconciliation (top entry)
head -30 docs/RECONCILIATION.md

# 5. Verify environment
pnpm typecheck
pnpm tsx scripts/run-schema-sentinel.ts   # 14/14 should be green

# 6. Full gate (before making changes)
pnpm verify:hard

# 7. Pick up active backlog from AGENTS.md section 5
```

---

## iOS PWA — Critical UI Rule

`bdnick.info` runs as a standalone iOS PWA on the operator's phone.

```
window.confirm()  → SILENTLY SUPPRESSED
window.alert()    → SILENTLY SUPPRESSED
window.prompt()   → SILENTLY SUPPRESSED

Replace with: in-DOM two-tap inline confirm component
This applies to ALL destructive actions in the UI.
See: /people delete button (already fixed as reference implementation)
```

---

## Design Philosophy (Non-Negotiable)

Every page/surface must have:
- **A knob** (filter, toggle, manual trigger, threshold)
- **Freshness** ("42s ago") on every data surface
- **Provenance** (source chip) on AI-generated content
- **Kill switch + manual-run** on every cron
- **Sparkline** on every number with history
- **Micro-animation** (150–250ms) on every state transition
- **Zero TODOs, zero dead buttons, zero "not implemented yet" placeholders**

---

*Update after each wave. Last updated: 2026-06-10.*
