# AGENTS.md · statenour-os

> **⚡ Current truth in one screen:** [`docs/CURRENT-TRUTH.md`](docs/CURRENT-TRUTH.md) — app location, production deploy path, what's retired, source-of-truth hierarchy. Read it if you only read one thing. Guard: `pnpm check:stale-docs`. Agent runbooks: [`docs/runbooks/index.md`](docs/runbooks/index.md).
>
> **Purpose:** any AI agent (Claude, Codex, Antigravity, Gemini, Cursor, etc.) opening this repo reads this file FIRST. Wave-by-wave ship history is canonical in [`docs/RECONCILIATION.md`](docs/RECONCILIATION.md) — when a wave lands, add the full entry THERE and update only the stamp below (do NOT grow this header; see the `statenour-wave-reconcile` skill).
>
> **Last refreshed:** 2026-06-12 · post the **settings deep-triage audit, security redactions, and runbook integration wave** (PR #103 merged): cron quick links to runbooks in CronControlPanel, recursive `redactSensitive` error tail + metric tag scrubbing (fully tested), strict journal tRPC feed bounds clamping, and Windows Turborepo file lock fixes. Gates at merge: tsc 0 · 3480 tests passed · check:crons clean · prompt size green. Full detail: RECONCILIATION top entry.

## 1 · Where we are right now

**Project:** statenour-os (NOUR OS · personal mastery system for Nour Dean). Lives in the `nourdean22/MAINnicks-tire-autoNEW` monorepo at `apps/statenour/` — `main` auto-deploys to Railway, served at `bdnick.info` (custom domain). The old Vercel deploy and the standalone `statenour-os` repo are retired. Companion business-ring app `nickstire` lives in the same monorepo at `apps/nickstire/` (Railway → nickstire.org).

**Stack:** Next.js 16 · React 19 · Prisma 7 · Neon Postgres (with raw-SQL pgvector + tsvector extras) · Tailwind 4 · AI SDK v6 · Vitest.

**Versioning:** the `v10.0.X` scheme is retired — commits use `fix · statenour · …` / `docs · statenour · …`.

**Tests:** 244 vitest files / 3480 tests (2026-06-12). ALL pass — but the suite EXITS 1 on ~12 pre-existing unhandled-rejection errors + an intermittent `tests/ai/agents/router.test.ts` mock-order flake, so read the vitest summary line NOT `$?`. Build `@statenour/lenses` first (`turbo build --filter=@statenour/lenses` from the repo root) or ~5 strategic-frameworks files fail on import.

## 2 · How we work

### Branching (operator rule 2026-06-11 — supersedes any older "push main" notes)

- **NEVER push `main`.** Named branches (`statenour/<task>` · `docs/<task>` · `chore/<task>`) + PR; the operator merges. Prefer a fresh `.worktrees/<name>` worktree off origin/main (concurrent sessions share this repo).
- Stage only your files by explicit path · never `git add -A` · never `--no-verify` · scope to the assigned task only.
- `apps/statenour/scripts/pre-push-check.sh` is a stale Vercel-era artifact — NOT the active hook; ignore it. The real hook is the repo-root `.husky/pre-push` (`turbo build` for affected apps).

### House rules

1. **Auto mode** — execute autonomously, prefer action over planning. Never destructive without explicit confirmation.
2. **Small ships** — 1–4 files + 1 test file per commit; a wave is 4–6 slices.
3. **The push must build clean.** Full local gate: `pnpm verify:hard` (typecheck · lint · test · raw-SQL audit · cron manifest · prompt-size · `prisma validate`).
4. Operator-private GET routes need `auth: "owner"`; mutating routes need an explicit auth wrapper.
5. **Pgvector lives in Prisma as `Unsupported(...)`** — Prisma sees the columns and won't drop them on `db push`; querying is raw SQL (`lib/db/pgvector.ts`); the HNSW index is raw-SQL only; `check:raw-sql` blocks `--accept-data-loss` patterns.
6. **Inbox missions ≠ user projects** — `lib/services/mission-helpers.ts isInboxMission()` is the single predicate (Plan view, Track tile, mission cap all depend on it).

When the operator invokes `/karpathy-guidelines`, `/kaizen`, `/superpowers-lab`, `/using-superpowers`, `/antigravity-workflows`, or `/prompt-library` — treat them as MANDATORY framing for the work.

### Commit format

`<type> · statenour · <one-line summary>` subject + context / implementation / verify paragraphs + `Co-Authored-By: <model name> <noreply@anthropic.com>`.

## 3 · Canonical sources of truth

| What you need | Where it lives |
|---|---|
| **Current truth (deploy/provider/retired)** | [`docs/CURRENT-TRUTH.md`](docs/CURRENT-TRUTH.md) — read first; `pnpm check:stale-docs` guards it |
| Agent operating runbooks | [`docs/runbooks/index.md`](docs/runbooks/index.md) — how to work safely here |
| Current state · ship history | [`docs/RECONCILIATION.md`](docs/RECONCILIATION.md) — refresh after every wave |
| Architecture · 7-layer map | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Nick agent · C4 system context | [`docs/NICK-AGENT-CONTEXT.md`](docs/NICK-AGENT-CONTEXT.md) |
| Repo map · cross-ring layout | [`docs/REPO-MAP.md`](docs/REPO-MAP.md) |
| Data model · table-by-table | [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) |
| Security posture · auth gates | [`docs/SECURITY.md`](docs/SECURITY.md) |
| AI agent contract | [`docs/AGENT-CONTRACT.md`](docs/AGENT-CONTRACT.md) |
| Cron manifest (single source) | [`config/crons.ts`](config/crons.ts) — verified via `pnpm check:crons`; jobs run through the Inngest mega fan-out |
| AutomationPolicy registry | DB · `automation_policies` · seed via `pnpm tsx scripts/seed-policies.ts` |
| Schema-drift guard | [`lib/db/schema-sentinel.ts`](lib/db/schema-sentinel.ts) (EXPECTATIONS list) |

## 4 · The fabrication-defense stack (don't break this)

| Layer | Where | What it does |
|---|---|---|
| **L1** prompt rule | [`lib/ai/system-prompt.ts`](lib/ai/system-prompt.ts) `## TRUTH RULE` | Never claim past-tense action without a tool call |
| **L2** pre-persist rewrite | [`lib/ai/chat/fabrication-rewriter.ts`](lib/ai/chat/fabrication-rewriter.ts) | Detected fabrication gets a verifier banner before persisting |
| **L3** history neutralization | [`lib/ai/chat/sanitize-history.ts`](lib/ai/chat/sanitize-history.ts) | Verifier-marked turns replaced so the model can't compound |
| **L4** truth grounding | [`lib/ai/chat/truth-grounding.ts`](lib/ai/chat/truth-grounding.ts) | Task counts pre-injected as system facts |
| **L5** operator chip | [`components/chat/action-claim-warning.tsx`](components/chat/action-claim-warning.tsx) | Red inline chip shows the diagnostic |

Detection regex: [`lib/ai/chat/action-claim-detector.ts`](lib/ai/chat/action-claim-detector.ts) — add new verbs as they appear; re-run its test file after changes.

## 5 · Active backlog (priority order · updated 2026-06-11)

1. P9 confirm-cards · judge-eval calibration verdict (needs n≥30) — low priority.

## 6 · How to resume in a fresh session

```bash
cd C:\Users\nourd\NOURCITY                       # repo root
git fetch origin && git worktree add .worktrees/<name> -b statenour/<task> origin/main
cd .worktrees/<name> && pnpm install --frozen-lockfile && cd apps/statenour
git log --oneline -10 && head -30 docs/RECONCILIATION.md   # current state
pnpm test                                        # read the summary line, not $?
pnpm verify:hard                                 # full local gate before any push
```

Operator standing rules: `C:\Users\nourd\.claude\CLAUDE.md` (operator on phone · default to action · direct + concise · never destructive without confirmation · Cleveland ET for everything).

## 7 · Common gotchas / lessons learned

- **Never `--accept-data-loss`** in scripts or CI — pgvector + tsvector extras get nuked; recovery scripts exist but don't go there.
- **`prisma migrate status` is the source of truth**, not "I ran release:db" — verify against prod before declaring schema work done.
- **`position: relative` containing-block trap** — adding it to a parent silently re-anchors `position: fixed` descendants (the state-aura 2545px regression).
- **Next.js dev-server module cache is sticky** — when swapping a module's behavior, make the old module internally delegate to the new one (defense-in-depth).
- **Side-effect gating is LIVE in the autonomous-engine** — rules with `approval: "ask"` defer + stash `payload.deferredItem`; changing the rule contract means updating `approval-queue.ts` too.
- **aiChat/tracedAiChat NEVER throw on total provider failure** — they return a SENTINEL; check `result.provider === "emergency" | "none"` before trusting `content`.
- **Image-gen routes through Venice flux-2-pro** via internal delegation in `lib/ai/openai-image.ts` ($0.04/img vs $0.19+ on gpt-image-1).
