# statenour

> Nour Dean's personal operating system. Nick (the AI) + Ultron (the
> cockpit) + Brain (the memory) + Tasks + Journal + Knowledge + Devices
> + System ops. One operator, one surface — through which Nour runs
> everything that isn't Nick's Tire & Auto.

**Status:** production · Railway · Neon Postgres · Next.js 16 · Prisma 7
· React 19 · Tailwind 4. Lives in the `nourdean22/MAINnicks-tire-autoNEW`
monorepo at `apps/statenour/`, deployed from branch `main` to
Railway, served at `bdnick.info`.

**Verified ground truth:** [`docs/CURRENT-TRUTH.md`](docs/CURRENT-TRUTH.md)
is the one-screen "where am I and what's real" answer — read it first.
[`docs/RECONCILIATION.md`](docs/RECONCILIATION.md) is the ship-by-ship
log. If anything in this README disagrees with those two (or with live
code), they win and this file should be patched.

**Companion app:** `nickstire` (the business ring — Express + tRPC +
TiDB on Railway) lives in the same monorepo at `apps/nickstire/`. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the two-ring map.

---

## Onboard in 5 minutes

```bash
# 1. clone the monorepo + cd into the statenour app
git clone https://github.com/nourdean22/MAINnicks-tire-autoNEW
cd MAINnicks-tire-autoNEW/apps/statenour

# 2. install (pnpm is canonical — locked via packageManager field)
pnpm install --frozen-lockfile

# 3. env — copy then fill (see .env.example for the full catalog)
cp .env.example .env.local
#   minimum required: DATABASE_URL, DIRECT_URL, + one AI provider key (OLLAMA_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY)
#   production also needs: AUTH_SECRET, AUTH_GOOGLE_CLIENT_*,
#                          AUTH_ALLOWED_EMAIL, CRON_SECRET, STATENOUR_SYNC_KEY

# 4. prisma (generates client + validates schema)
pnpm db:generate

# 5. boot — dev server on http://localhost:3001
pnpm dev
```

Verify environment at any point:

```bash
pnpm check:env        # required vs runtime vs platform vars
pnpm check:crons      # cron manifest vs filesystem
pnpm typecheck        # tsc --noEmit (0 errors)
pnpm lint             # eslint . (0 errors; tolerated warnings pinned in .lintbaseline.json)
pnpm test             # vitest run — current count in RECONCILIATION.md
pnpm verify:hard      # full local gate: typecheck + lint + test +
                      # raw-sql + cron manifest + prompt-size + prisma validate
```

---

## Daily routes

Every page lives inside the `(mastery)` route group — Nour-only,
auth-gated, wrapped in `NourStateProvider` + `AmbientAura` +
`KeyboardShortcuts` + `BrainDumpModal`.

| Route | Purpose |
|---|---|
| `/` | **Home console** — identity header + Cognitive Partner + execution matrix + engines deck + brain graph. (Historical vision: [`docs/ULTRON-VISION.md`](docs/ULTRON-VISION.md)) |
| `/chat` | Nick — streaming chat, tool calls, output critic, composer authority controls |
| `/missions` | Missions — tasks / projects / recurring loops (absorbed the old `/tasks`) |
| `/journal` | Thought stream — voice + text + Obsidian-flavored |
| `/knowledge` | Knowledge base (Drive ingest lives here) |
| `/brain` | Memory hub — Memory / Board / Wisdom / Reason tabs |
| `/stats` | Stats + body log (absorbed `/body`, `/mastery`, `/plan`) |
| `/business` · `/money` · `/market` · `/people` · `/content` | Tabbed domain surfaces (absorbed `/financial`, `/funnel`, `/crm`, `/seo`, `/radar`, …) |
| `/system` | **System Command Center** — see below |
| `/settings` | App config, cron control, push notifications |

**System ops deck** (the 13 live pages + hub — a 2026-06 mega-delete
folded ~30 older `/system/*` subpages into these; `next.config.ts`
redirects the retired paths):

| Route | What you see / control |
|---|---|
| `/system` | Hub grid — health / governance / AI / data tiles + needs-attention strip |
| `/system/health` | Unified probe hub — DB latency, env, crons, errors, backlog, vectors |
| `/system/crons` | Cron deck — enable/disable + run-now per job (absorbed `/system/cron-runs`) |
| `/system/logs` | Unified log tail (`?view=errors` = fingerprint groups; absorbed `/system/errors`) |
| `/system/ai-cost` | Cost + latency + error rate · trend bars · feature × model breakdown (absorbed `/system/costs`, `/system/performance`) |
| `/system/actions` | Nick's autonomous-action audit + approvals (absorbed `/system/approvals`) |
| `/system/alerts` | Cross-category brain-alert inspector |
| `/system/calibration` | Eval / coverage / quality / operator-state lenses (absorbed the eval quadruplet) |
| `/system/camera` | Arrival Intelligence — vehicle detection + plate recognition cockpit |
| `/system/cockpit-observability` | Live metrics, execution traces, memory decay, prompt versions |
| `/system/inbox` | Memory-quarantine review — claims + contradictions before they land |
| `/system/proactive-preview` | Proactive-push dry-run preview |
| `/system/schema-history` | Schema-change ledger |
| `/system/tools` | Agent-tools registry |

Navigation is the **bottom tab bar + More sheet**
(`components/layout/bottom-tab-bar.tsx` · `more-sheet.tsx`). The old
FloatingHome orb is retired — only its smart-now picker survives in
`lib/floating-home/smart-now.ts` (consumed by the More sheet).

---

## Architecture in one paragraph

statenour is a Next.js 16 App Router app deployed to Railway. Prisma
7 talks to Neon Postgres (current model count in RECONCILIATION). Nick
runs through a pluggable provider chain (Ollama Cloud primary → Gemini
→ OpenAI → Anthropic fallback) via `lib/ai/provider.ts`, with
`streamWithFallback` providing pre-first-token same-turn rotation.
System prompt assembly + tool selection + output critique live in
`lib/ai/*`. Scheduled crons manage ingestion (Gmail/Calendar/Drive/
Fireflies), brain maintenance (memory consolidation, identity refresh,
skill extraction, semantic dedup, pgvector backfill), and hygiene
(retention, pin review, stale-conv archive, brain-bus backfill). All
declared in [`config/crons.ts`](config/crons.ts) — the single source
of truth — with a CI drift guard. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full diagram.

---

## Developer workflow

```
statenour/<task>  ← named branch (never push main directly) → PR → main
       │
       │  push → repo-root lefthook.yml pre-push hook:
       │    turbo build --affected
       │    — rebuilds every affected app, catching Next.js
       │      prerender errors before they reach Railway
       │      (Husky is retired; there is no .husky/ directory)
       │
       │  statenour's own full local gate is `pnpm verify:hard`:
       │    typecheck · lint · test · raw-sql audit · cron manifest
       │    · soft-delete audit · stale-docs · prompt-size · prisma validate
       │
       ▼
  Railway   ← watches `main` with per-service watch paths; a merge
              touching apps/statenour/** auto-deploys the
              statenour-web service →
              bdnick.info
```

---

## Project docs (read in this order)

1. [`docs/CURRENT-TRUTH.md`](docs/CURRENT-TRUTH.md) — **start here** · one-screen truth: deploy path, retired landmines, source-of-truth hierarchy
2. [`AGENTS.md`](AGENTS.md) — how agents work here · gates · gotchas · backlog
3. [`docs/RECONCILIATION.md`](docs/RECONCILIATION.md) — verified ship-by-ship log (top entry = latest)
4. [`docs/runbooks/index.md`](docs/runbooks/index.md) — agent operating runbooks
5. [`docs/AGENT-CONTRACT.md`](docs/AGENT-CONTRACT.md) — AI agent contract
6. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — subsystem map + data flow
7. [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) — Prisma models + retention
8. [`docs/SECURITY.md`](docs/SECURITY.md) — auth, CSP, secrets, boundaries
9. [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — cron catalog + incident playbook
10. [`docs/ENDPOINT-HYGIENE.md`](docs/ENDPOINT-HYGIENE.md) — primary vs helper routes
11. [`docs/REPO-MAP.md`](docs/REPO-MAP.md) — repos under `nourdean22/*`

Historical planning docs (`docs/project/UPGRADE-PLAN.md`,
`docs/project/ROADMAP.md`, `docs/project/CHANGELOG.md`,
`docs/ULTRON-VISION.md`) are **not** active instructions — see the
"Active vs historical docs" section of `docs/CURRENT-TRUTH.md`.
There is no separate "active plan" doc: RECONCILIATION (ship log) +
AGENTS.md (backlog) are the live sources.

Archived material (Mar 27 prompt files, Ollama modelfiles, prior
session notes, retired plans) lives at [`docs/archive/`](docs/archive/).

---

## WAVE-200 substrate (Mastra · Braintrust · Inngest · LiveKit)

The 6-phase Wave-200 rollout lives behind feature flags. Default state
is "everything degrades gracefully · operator pastes credentials to
activate each substrate". Status surfaces on `/api/health` (owner-gated
since the 2026-07-21 truth-substrate wave — an unauthenticated curl now
gets 401; use an authenticated session):

```bash
curl -H "Cookie: <operator session>" https://bdnick.info/api/health | jq '.data | {inngest, braintrust}'
```

Operator action items per substrate · each is a 5-minute paste:

| Substrate | Flip mechanism | Runbook |
|---|---|---|
| Braintrust tracing | paste `BRAINTRUST_API_KEY` | `docs/adr/0002-braintrust-observability.md` |
| Inngest workflows | paste `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` + connect URL | `docs/operator/inngest-setup.md` |
| LiveKit voice | new Railway service `statenour-voice` + paste 7 env vars | `apps/voice/README.md` |

Local dev for each substrate:

```bash
# Inngest · local dev runner (no cloud account needed)
pnpm inngest:dev                 # opens http://localhost:8288
# In another terminal: pnpm dev (so the serve endpoint exists)

# LiveKit voice · separate Python app
cd ../voice
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python agent.py dev
```

Health snapshot (after deploys):
- `/api/health` · top-level state + `{inngest, braintrust}` block
- `/api/inngest` · 503+hint if not configured, friendly JSON otherwise
- `/api/morning-brief/today.mp3` · audio for today (404 with hint if
  cron hasn't run yet · 200 + audio/mpeg otherwise)

---

## Common commands

```bash
# dev
pnpm dev                         # next dev --webpack -p 3001

# build (v8.25 · safe by default)
pnpm build                       # prisma generate && next build
pnpm build:local                 # same but writes to .next-prod (doesn't clobber .next)
pnpm build:check                 # build only (no prisma generate) — standalone prod-build sanity check
pnpm build:push-schema           # ⚠️ generate + prisma db push + build. Bypasses the
                                 # migration ledger. Prisma itself refuses destructive
                                 # diffs; NOTHING automated blocks --accept-data-loss —
                                 # the ban is policy (AGENTS.md: it silently drops
                                 # pgvector/tsvector). Use only for explicit one-shot resyncs.

# db
pnpm db:generate                 # prisma client only
pnpm db:migrate                  # prisma migrate dev
pnpm db:migrate:deploy           # prod migration apply
pnpm db:push                     # schema → DB without a migration (careful)

# quality
pnpm typecheck
pnpm lint
pnpm test

# system hygiene
pnpm check:env                   # env health vs lib/env.ts spec
pnpm check:crons                 # cron manifest (config/crons.ts) vs filesystem
pnpm prompt:size-check           # system prompt token budget
pnpm calibrate:dry               # dry-run auto-calibrate cron

# WAVE-200
pnpm inngest:dev                 # Inngest local dev runner (port 8288)
```

---

## Philosophy

- **Never assume.** Verify with code / git / DB / logs before acting. This is the root rule.
- **Power + control everywhere.** Every cron, every integration, every AI call has a kill switch and a manual run.
- **Alive over static.** Live counters, sparklines, freshness chips, pulse dots — the UI answers "is the system OK?" without opening anything.
- **Interesting data.** Breakdowns, sparklines, burn rates, cross-surface correlations. Not just lists.
- **Devastating lead.** Meta-intelligence surfaces (quality trends, decision-drift, calibration lenses) ship wave by wave — the live record is [`docs/RECONCILIATION.md`](docs/RECONCILIATION.md), not a plan doc.
- **Solo operator.** One allowlist email. One Nour. The product is the leverage, not the platform.

---

**Quality gate live on every push**: `pre-push` hook + GitHub Actions
CI + cron-manifest guard + schema-drift check. Zero broken deploys
is the goal.
 