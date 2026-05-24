# AGENTS.md · statenour-os

> **Purpose:** any AI agent (Claude, Codex, Antigravity, Gemini, Cursor, etc.) opening this repo reads this file FIRST. It tells you where we are, how we work, what the active backlog is, and the canonical sources of truth. Refresh this file whenever a wave of work lands so the next session resumes cleanly.
>
> **Last refreshed:** 2026-05-24 MIDDAY · post Wave Q (extracted SystemOpsHub to components/settings/system-ops-hub.tsx · press-and-hold confirm on 3 critical autopilot disables via existing ConfirmHold primitive · settings/page.tsx 935→787 LOC). On top of: Wave P (/settings UX sweep · autopilot toggles grouped into 4 named categories · localStorage-SYNC initial state · inline mutation error feedback). On top of: Wave O (Vercel cleanup runbook v2 · DNS-first 4-phase sequence · operator deleted all 4 Vercel projects · autonicks.com DNS flip still pending). On top of: Wave N (unstamped counter split · autonicks runbook v1). On top of: Wave M (5 silent-failure fixes from parallel code-reviewer + silent-failure-hunter audit). On top of: Wave L + UI sweep (5th operator-state opt-in · 4 visual upgrades · 8 new tests). On top of: Wave I/J (3 more operator-state opt-ins · 19 new tests · Chrome ext F3 · ADR-0021). On top of: P1-P5 (parked migrations applied · OSS Phase 2 shim · first state opt-in · Chrome ext MVP · lenses publish-ready). On top of: overnight M1 wave (Q2 + Wave H + OSS workspace + Wave F + ADR-0020). LeCun-lens consolidation (5.3/5.4/5.5/5.6 · ADR-0019). Waves A-G. Monorepo branch `main`. **Tests:** 2797 across 184 vitest files. **Prod schema:** 31 migrations applied. **Chrome ext:** v0.2.1 · packages/chrome-extension/dist/ ready for unpacked install.

---

## 1 · Where we are right now

**Project:** statenour-os (NOUR OS · personal mastery system for Nour Dean). Lives in the `nourdean22/MAINnicks-tire-autoNEW` monorepo at `apps/statenour/` on branch `main` — pushes auto-deploy to Railway, served at `bdnick.info` (custom domain). The old Vercel deploy and the standalone `statenour-os` repo are retired. Companion business-ring app `nickstire` lives in the same monorepo at `apps/nickstire/` (Railway → nickstire.org).

**Stack:** Next.js 16 · React 19 · Prisma 7 · Neon Postgres (with raw-SQL pgvector + tsvector extras) · Tailwind 4 · AI SDK v6 · Vitest.

**Versioning:** the `v10.0.X` scheme was retired at the monorepo migration — commits now use `fix · statenour · …` / `docs · statenour · …`. The repo-level pre-push hook runs `turbo build` for affected apps; statenour's full local gate is `pnpm verify:hard`.

**Sprint history (recent waves · most recent first):**

| Wave | Versions | Sprint summary | Reference |
|---|---|---|---|
| Sprint reconciliation | v10.0.442 → v10.0.485 (43) | Prompt v1↔v2 drift closed · v2 cutover plan published · 10 ADRs backfilled · editorial accessibility pass · bug-fix wave (image-gen → Venice flux-2-pro · mobile composer · ideation regex · BROADEN_AND_SUGGEST · ProactiveInsightCard removed) · 36 docs reconciled | [`docs/cohort-2026-05-08-eod-summary.md`](docs/cohort-2026-05-08-eod-summary.md) |
| Brain + cognition | v10.0.346 → v10.0.385 (39) | RRF over 3 lanes · Cohere reranker · 4k token budget · CoALA architecture · BDI overlay · LLM-as-judge eval · adversarial critic · pre-task fan-out · deep-research worker · multi-agent parallel sub-agents · withGuardian wrapper · Anthropic prompt caching · 195 prod indexes · request tracer | (memory `session_may06_audit_block.md`) |
| Audit + structure | v10.0.237 → v10.0.330 (94) | 4-axis audit · 8 of 10 ranked moves · 6 cluster merges · 26 StandardPage adoptions · 11 component extractions · /tasks 2391→1842 LOC · brain 10→7 pages · /chat type escapes 3→0 | [`docs/state-of-autonicks-2026-05-06-pm.md`](docs/state-of-autonicks-2026-05-06-pm.md) |
| Reconciliation campaign | v10.0.166 → v10.0.236 | Cron audit waves · API auth audit · component layer audit · Wave A ghost-feeder migration | [`docs/RECONCILIATION.md`](docs/RECONCILIATION.md) |
| Post-audit consolidation | v10.0.148 → v10.0.166 | AutomationPolicy registry · explainability envelope · Brier scoring · approval queue · fabrication-defense L1-L5 stack · prompt library scaffold | [`docs/RECONCILIATION.md`](docs/RECONCILIATION.md) |

**Tests:** 2720 tests across 178 vitest files (2026-05-23 PM · `.next-prod` excluded · +20 board consult tests from the multi-advisor wave · +4 parent-inheritance + +4 effort-weighting tests from the subtask wave). **Pre-push gate:** the repo-root `.husky/pre-push` hook runs `turbo run build --filter=...[upstream]` — it rebuilds every affected app to catch Next.js prerender errors before Railway. statenour's own full local gate is `pnpm verify:hard` (7 checks: typecheck · lint · test · raw-SQL audit · cron manifest · prompt-size · `prisma validate`).

---

## 2 · How we work · operating principles

### Skills the operator invokes regularly

When the user says `/karpathy-guidelines`, `/kaizen`, `/superpowers-lab`, `/using-superpowers`, `/antigravity-workflows`, or `/prompt-library`, treat them as MANDATORY framing for the work:

- **Karpathy guidelines** — think before coding · simplicity first · surgical changes · goal-driven execution
- **Kaizen** — small improvements continuously · poka-yoke (error-proof by design) · standardized work · just-in-time
- **Superpowers** — invoke skills before action · skills evolve · check current version
- **Antigravity-workflows** — multi-phase orchestration · pick best-matching workflow · verify before next step
- **Prompt-library** — battle-tested templates · role-based · task-specific · composable

### House rules

1. **Auto mode** is usually on — execute autonomously, prefer action over planning, course-correct from user pushback. Never destructive without explicit confirmation.
2. **Small ships** — typical commit is 1–4 files, 1 test file, 1 ship per slice. The wave is 4–6 slices. Don't try to ship the whole wave in one commit.
3. **The push must build clean.** `.husky/pre-push` runs `turbo build` for affected apps — a Next.js prerender error blocks the push. Before pushing, run `pnpm verify:hard` (typecheck · lint · test · raw-SQL audit · cron manifest · prompt-size · `prisma validate`) to catch the rest locally.
4. **Soft caps** — operator-private GET routes need `auth: "owner"`; mutating routes need explicit auth wrapper.
5. **Pgvector lives in Prisma now** — `vector_embeddings.embedding_vec` and `embedding_vec_1536` + `embedding_dim` + `model` are declared as `Unsupported(...)` in the schema. Prisma SEES them and won't drop them on `db push`. Querying still requires raw SQL (`lib/db/pgvector.ts`). The `chat_messages.searchable_tsv` GENERATED column also lives in the schema as `Unsupported("tsvector")? @default(dbgenerated())`. The HNSW index on `embedding_vec_1536` is raw-SQL only — Prisma can't model index types. Schema sentinel still guards existence as defense-in-depth. The `check:raw-sql` step in `verify:hard` blocks `--accept-data-loss` patterns in shipping config.
6. **Inbox missions ≠ user projects** — `lib/services/mission-helpers.ts isInboxMission()` is the single predicate. Three surfaces depend on it (Plan view, Track tile, mission cap).

### Git flow

- Active branch: `main` (monorepo · pushing auto-deploys statenour to Railway via per-service watch paths)
- Pre-push hook: the repo-root `.husky/pre-push` runs `turbo run build --filter=...[upstream]` for affected apps
- `apps/statenour/scripts/pre-push-check.sh` is a stale Vercel-era artifact (it still references `codex/ollama-local` / `statenour-master`) — it is NOT the active hook; ignore it

### Commit message format

The `v10.0.X` version scheme is retired. Commits use a `type · scope ·
summary` subject (`fix · statenour · …`, `docs · statenour · …`):

```
<type> · statenour · <one-line summary>

<context paragraph: what triggered this, what was broken>

<implementation paragraph: files touched, how the fix works>

<verify section: tests passing, build clean, what's next>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## 3 · Canonical sources of truth

| What you need | Where it lives |
|---|---|
| Current state · ship history | [`docs/RECONCILIATION.md`](docs/RECONCILIATION.md) — refresh after every wave |
| Architecture · 7-layer map | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Nick agent · C4 system context | [`docs/NICK-AGENT-CONTEXT.md`](docs/NICK-AGENT-CONTEXT.md) |
| Repo map · cross-ring layout | [`docs/REPO-MAP.md`](docs/REPO-MAP.md) |
| Data model · table-by-table | [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) |
| Security posture · auth gates | [`docs/SECURITY.md`](docs/SECURITY.md) |
| AI agent contract | [`docs/AGENT-CONTRACT.md`](docs/AGENT-CONTRACT.md) |
| Cron manifest (single source) | [`config/crons.ts`](config/crons.ts) — verified against the filesystem via `pnpm check:crons`; scheduled jobs run through the Inngest mega fan-out, not a `vercel.json` crons block |
| AutomationPolicy registry | DB · `automation_policies` · seed via `pnpm tsx scripts/seed-policies.ts` |
| Schema-drift guard | [`lib/db/schema-sentinel.ts`](lib/db/schema-sentinel.ts) (EXPECTATIONS list) |

---

## 4 · The fabrication-defense stack (don't break this)

The Bay 5 Revive case (v10.0.160 diagnosis) drove a five-layer defense. When working on chat-quality code, understand the layers:

| Layer | Where | What it does |
|---|---|---|
| **L1** prompt rule | [`lib/ai/system-prompt.ts`](lib/ai/system-prompt.ts) `## TRUTH RULE` | Model is told never to claim past-tense action without a tool call |
| **L2** pre-persist rewrite | [`lib/ai/chat/fabrication-rewriter.ts`](lib/ai/chat/fabrication-rewriter.ts) | Detected fabrication gets a verifier banner prepended before persisting |
| **L3** history neutralization | [`lib/ai/chat/sanitize-history.ts`](lib/ai/chat/sanitize-history.ts) `neutralizeFabricatedHistory` | Verifier-marked turns replaced with `[VERIFIER NOTE]` so model can't compound |
| **L4** truth grounding | [`lib/ai/chat/truth-grounding.ts`](lib/ai/chat/truth-grounding.ts) | Project task counts pre-injected as system facts to prevent fabrication forming |
| **L5** operator chip | [`components/chat/action-claim-warning.tsx`](components/chat/action-claim-warning.tsx) | Red inline chip shows the diagnostic to the operator |

Detection regex lives in [`lib/ai/chat/action-claim-detector.ts`](lib/ai/chat/action-claim-detector.ts) — 15 verb patterns, 7 hedge patterns. Add new verbs as they appear in the wild.

---

## 5 · Active backlog (priority order · updated 2026-05-23 EVE)

1. ~~Pick the first AI surface to opt into operator-state~~ · **SHIPPED P3** · /api/ai/page-insight now injects formatOperatorStateBlock when confidence > 0. Future surfaces can copy the same pattern.
1c. ~~Phase 2 OSS extraction~~ · **SHIPPED P2** · statenour imports from @statenour/lenses · inline 49 framework files deleted · lib/ai/strategic-frameworks/ is a 3-file shim. Chat path untouched (shim aliases preserve the API).
1b. ~~Prompt-v2 shadow quality measurement~~ · **SHIPPED Wave Q2** (ADR-0020). shadow path samples ~10% + enqueues into PROMPT_SHADOW_JUDGE_QUEUE · judge-eval-shadow cron drains. SystemMetric `prompt.shadow.judge_score_delta` will accumulate as shadow turns fire.
1a. **2026-06-22 · subtask-usage audit (30-day check-in)** — now AUTOMATED via `app/api/cron/subtask-usage-audit/route.ts` (folded into mega-morning). Self-fires on/after 2026-06-22 · computes usage % and writes a nudge_pin_hygiene BrainMemory row · operator sees it in the daily-brief surfacing layer. ADR-0017 amendment A1's <5% gate is now a falsifiable mechanical check rather than a manual reminder.
2. **Watch judge-eval calibration verdict** — `/system/judge-eval` now shows the agreement % between judge and operator. Verdict will read "preliminary" until n≥30 comparisons with operator feedback accumulate. Re-check before promoting the V2 canary further.
3. **Phase 0 prerequisites for v2 prompt cutover** — see `docs/v2-prompt-cutover-plan.md`. Need: `scripts/prompt-shadow-summary.ts` (criterion 1+2+3 evidence), `scripts/prompt-judge-comparator.ts` (criterion 4 evidence), `/system/prompt-parity` route.
4. **Phase 1 v2 prompt-builder canary** — flip `NICK_PRIME_PROMPT=on` for 10% of turns via deterministic hash. 24h soak. Halt triggers documented.
5. **Per-lens cost telemetry** — pre-task fan-out (`lib/ai/pretask-fanout.ts`) tracks gated-vs-ungated split at orchestrator level but not per-lens cost breakdown. Useful for tuning which lenses are worth their spend (ADR-0009 open item).
6. **Box-shadow → opacity-on-pseudo for remaining keyframes** — 17 keyframes converted in v10.0.466-469; `state-aura` reverted in v10.0.474 due to containing-block trap. Audit remaining keyframes for safe conversion candidates.
7. **Calibration plot on `/brain`** — math layer (`lib/brain/calibration.ts`) shipped; UI deferred until ≥10 resolved binary predictions exist.
8. **Per-policy fire history view** — `/system/policies` shows `lastFiredAt` + `fireCount` only; full chronological history not yet rendered.

---

## 6 · How to resume in a fresh session

```bash
# 1. cd into the repo (monorepo — statenour is an app within it)
cd C:\Users\nourd\OneDrive\Desktop\nickstire-repo-staging\apps\statenour

# 2. Read this file (you just did)

# 3. Check current state
git log --oneline -10
cat docs/RECONCILIATION.md | head -30

# 4. Verify environment is sane
pnpm install --frozen-lockfile
set -a && . ./.env.local && set +a
pnpm tsx scripts/run-schema-sentinel.ts   # 14/14 expectations should be green

# 5. Run the test suite
pnpm test                                 # ~1855 tests across 140 files, ~10s

# 6. Run the full local gate
pnpm verify:hard                           # typecheck · lint · test · raw-SQL · crons · prompt-size · prisma validate

# 7. Pick up the active backlog (section 5 above)
```

If you're a fresh agent without context, the operator's standing rules in `C:\Users\nourd\.claude\CLAUDE.md` apply (operator on phone, default to action, minimize back-and-forth).

---

## 7 · Common gotchas / lessons learned

- **Never `--accept-data-loss`** in `package.json` scripts or CI. Pgvector + tsvector extras live outside Prisma's view and get nuked. Pre-push gate catches this; recovery is `scripts/recover-pgvector-from-text.ts` + `scripts/recover-pgvector-embedding-vec.ts`.
- **`prisma migrate status` is the source of truth, not "I ran release:db"** (v10.0.473 lesson). Local "release succeeded" messaging can be misleading when prod DB is unreachable or auth fails silently. Always verify against prod before declaring schema work done.
- **`position: relative` containing-block trap** (v10.0.474 lesson). Adding `position: relative` to a parent silently changes the anchor for `position: fixed` descendants throughout the subtree. Audit before adding to keyframe wrappers — state-aura caused a 2545px layout regression by becoming the containing block.
- **Next.js dev-server module cache is sticky** (v10.0.480 lesson). Top-level imports resolved at boot don't refresh on edits. When swapping a module's behavior, use **defense-in-depth**: make the swapped module internally delegate to the new target. `generateOpenAiImage()` now calls `generateVeniceImage()` internally for this reason.
- **Ideation regex must catch trigger-phrase-alone** (v10.0.483 lesson). "come up with", "brainstorm", "help me cook up" without specific nouns must block image-gen classifier. Regex lives in `lib/ai/chat/interceptors.ts` (`EARLY_IDEATION_NEG`).
- **Mobile composer chrome budget** (v10.0.478 lesson). Every always-visible button competes with the textarea on 375px screens. Default to `hidden sm:flex` for non-essential controls.
- **Inbox missions count differently than user projects.** Three surfaces (cap, Plan view, Track tile) all use `isInboxMission()` from `lib/services/mission-helpers.ts`. Don't introduce a fourth filter; use the helper.
- **Side-effect gating is LIVE in the autonomous-engine** as of v10.0.157. Rules with `approval: "ask"` defer execution and stash `payload.deferredItem`; the approval queue's `executeApprovedAction(id)` replays. If you change the rule contract, update `approval-queue.ts` too.
- **Fabrication detector is regex-based.** Adding new action verbs to `action-claim-detector.ts` requires re-running `tests/ai/chat/action-claim-detector.test.ts` to confirm no regressions in hedge patterns.
- **Prisma can't model `vector(N)` natively** — pgvector + tsvector columns are managed by raw SQL in scripts. Prisma `db push` will drop them silently if you don't have the `--accept-data-loss` pre-push guard. v10.0.171 declared them as `Unsupported(...)` so Prisma sees them.
- **Image-gen routes through Venice flux-2-pro** (v10.0.477) — $0.04/img vs $0.19+ on gpt-image-1 which hit billing cap. Defense-in-depth via internal delegation in `lib/ai/openai-image.ts`.

---

## 8 · Operator preferences (carried from `~/.claude/CLAUDE.md`)

- Operating from phone via remote Claude — execute, don't ask obvious questions
- Direct + concise > fluff
- Use everything: agents, tools, connectors, MCPs
- Power, control, visibility — surface what's broken before asking what to do
- Verify before claiming completion · regular checkpoints · continuous refinement
- Cleveland ET timezone for everything · Mon Apr–Oct DST math
- Never destructive without explicit confirmation
