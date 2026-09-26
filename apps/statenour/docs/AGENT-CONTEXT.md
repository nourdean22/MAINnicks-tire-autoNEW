# AGENT-CONTEXT.md — Statenour OS (NOUR OS)
> Quick-load context for Antigravity and any AI agent working on `apps/statenour/`.
> For full context, read `AGENTS.md` in this directory. For one-screen reality check,
> read `docs/CURRENT-TRUTH.md`. For monorepo rules, read root `AGENT-OPERATING-PROFILE.md` and the [CIITTY framework](.agents/frameworks/ciitty/SKILL.md).
>
> Last verified: 2026-09-26 · Nick operator runtime + one-shot quality repair

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

## Current Nick Chat Contract (2026-09-26)

- **Solution + principle first.** On substantive asks, lead with the answer/move and briefly name the governing mechanism.
- **Proactive execution.** Recover context, use available tools/data, and take the obvious safe/authorized next step instead of handing work back to Nour.
- **Truth over agreement.** Seek disconfirming evidence; separate FACT / INFERENCE / UNKNOWN; current evidence beats memory or prior AI claims.
- **Facts, not the model's opinion.** Give mechanisms, options, consequences, and execution toward Nour's stated objective. Do not substitute model preferences/values/taste. Recommend only when Nour explicitly asks, then optimize for his objective/constraints.
- **Creative only when useful.** Non-obvious/cross-domain angles must materially change the move; forced cleverness is filler.
- **Finish + verify.** Code existence, a tool run, or a plausible plan is not completion.
- **One-shot quality repair before ship.** For factual/decision/creative/instructional/procedural/analytical turns on the buffered regen lane, a weak first draft gets one targeted repair using the measured critic + response-contract failures. The better candidate wins even if the repair is only partially better; a worse repair never replaces the first draft.
- **Safety/authority unchanged.** Mutation confirmations, fencing, injection surfacing, and other existing execution safeguards still apply.

**Live app receipt:** StateNour deployment `99ab4bda-931f-4dce-ba0d-807b91b8d9ec` = commit
`2b021632bf2806c95e7e275ba56b7c64117ba8b6` (#2680), Railway **SUCCESS**.
Repo HEAD later advanced to #2681 `36961a342` with Agent OS-only files; that deployment was correctly **SKIPPED** for `statenour-web`.
Do not infer deploy drift merely because repo HEAD is newer than the app SHA.

**Next proof owed:** read post-#2680 `verified_regen_path` logs after enough weak drafts exist. The live event emits `regenFired`, `regenAttempted`, `regenWasBetter`, `selectionReason`, first/regen overall scores and severities, and `intent`. `formatRegenTelemetry()` is currently unwired, so `chat.pre_stream_regen`, specificity deltas, and regen latency/cost are NOT production proof sources yet. Implementation + deploy are proven; repair win-rate in real production traffic is not yet.

---

## ⚠️ Retired Paths — Do Not Reference

| Retired Item | What to Use Instead |
|---|---|
| Vercel | Railway only |
| Retired local-model feature/deploy branch aliases | `main` only |
| Retired standalone StateNour mirror branch aliases | `main` only |
| `nourdean22/statenour-os` repo | This monorepo only |
| `C:\Users\[LOCAL_USER]\NOUR-OS` (or other local variants) | `[REPO_ROOT]` |
| `scripts/pre-push-check.sh` (deleted) | repo-root `lefthook.yml` pre-push |

**`pnpm check:stale-docs` guards against retired-path references in active docs.**

---

## Stack at a Glance

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI | React 19 + Tailwind CSS 4 |
| ORM | Prisma 6.19 |
| Database | Neon Postgres (+ pgvector + tsvector) |
| AI | AI SDK v6 · Ollama Cloud (primary, operator directive) · Gemini · OpenAI · Anthropic · OpenRouter. **Venice is RETIRED** |
| Tests | Vitest (~430 files / ~4,800 tests) |
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
| Auth | `auth.ts` + `proxy.ts` | Owner-only routes |

---

## Verify Gates (Run Before Every Push)

```bash
cd [REPO_ROOT]/apps/statenour

pnpm typecheck          # tsc --noEmit — MUST be 0 errors
pnpm lint               # eslint — ~359 pre-existing `any` warnings are non-blocking; only errors fail
pnpm test               # vitest — READ THE SUMMARY LINE, not $?
                        # A NON-ZERO EXIT IS REAL. The "passes but exits 1 on unhandled
                        # rejections" era is over — do not ship on red. (This line
                        # used to say ~12 errors were expected; that is no longer true
                        # and following it meant shipping over genuine failures.)
                        # needs @statenour/lenses built first (or ~5 strategic-frameworks files fail)
pnpm verify:hard        # MASTER GATE: typecheck · lint · test · raw-SQL · crons · prompt-size · prisma validate
pnpm check:stale-docs   # verify no retired terms used as current instructions
pnpm check:crons        # verify cron manifest vs filesystem
```

### Pre-Push Hook

repo-root `lefthook.yml` pre-push → `turbo build --affected`
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
AI_PROVIDER env selects one of RUNTIME_PROVIDERS (lib/ai/provider.ts):
ollama | gemini | openai | anthropic | openrouter. Ollama Cloud is ranked
first for every task type per operator directive. "venice" is NOT valid and
provider.ts THROWS "Unknown AI_PROVIDER" on it.
DO NOT hardcode AI_PROVIDER in production Railway config — disables failover
Model names are env-driven — do not assert a specific model name in docs (it drifts)

Structured JSON schema → use OpenAI invokeLLM() only (Ollama can't do strict schemas)
Image generation → lib/ai/gemini-image.ts (Replicate FLUX when REPLICATE_FLUX=true
and REPLICATE_API_KEY is set, else direct Gemini, else OpenRouter).
lib/ai/venice-image.ts no longer exists.
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

## Active State (2026-09-26)

- **Repo main:** #2681 `36961a342` at this snapshot; verify again before editing because sibling sessions are active.
- **Live StateNour app:** #2680 `2b021632...` on Railway deployment `99ab4bda...` (SUCCESS).
- **Prompt architecture:** Prompt V2 is live; the older prompt-cutover backlog is historical, not active work.
- **Quality loop:** critic + response-contract assessment feeds one targeted pre-stream repair on gated intents; deterministic candidate comparison chooses the better draft.
- **Operator posture:** facts/mechanisms/options/consequences first; no unsolicited model preference; recommendation only when asked; correct conflicting evidence once and then respect the operator's decision.
- **Evidence gate:** still a separate shadow-calibration system. Do **not** treat #2680's quality repair as evidence-gate promotion.
- **Primary follow-up:** measure real post-#2680 regen attempts/winners/score deltas before claiming the repair win-rate is production-proven.

## Current Follow-Up (Quality Loop Only)

1. Read `verified_regen_path` after enough real weak drafts have occurred.
2. Compare the fields it actually emits: first/regen severity, first/regen overall, `selectionReason`, `regenAttempted`, `regenWasBetter`, `regenFired`, and `intent`.
3. Do **not** claim specificity or second-attempt latency/cost from production yet: `formatRegenTelemetry()` is unwired. If those measurements become necessary, wire/persist the metric first and prove the writer.
4. Keep the evidence gate in shadow until its own precision/calibration case changes.
5. For the broader product backlog, use current `AGENTS.md` + `docs/CURRENT-TRUTH.md`; do not resurrect the June backlog below.

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

*Update after each wave. Last updated: 2026-09-26.*
