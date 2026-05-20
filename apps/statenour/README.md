# statenour-os · bdnick.info

> Nour Dean's personal operating system. Nick (the AI) + Ultron (the
> cockpit) + Brain (the memory) + Tasks + Journal + Knowledge + Devices
> + System ops. One repo, one operator, one machine — the surface
> through which Nour runs everything that isn't Nick's Tire & Auto.

**Status:** production · Vercel · Neon Postgres · Next.js 16 · Prisma 7
· React 19 · Tailwind 4 · deployed from `codex/ollama-local` (mirror
workflow auto-FFs `statenour-master`).

**Verified ground truth:** [`docs/RECONCILIATION.md`](docs/RECONCILIATION.md)
holds the current reality snapshot — counts, gates, doc hierarchy. Read
that first. If a number in this README disagrees with RECONCILIATION,
RECONCILIATION wins (and this file should be patched).

**Companion repo:** [`nickstire`](https://github.com/nourdean22/MAINnicks-tire-autoNEW)
(the business ring — Express + tRPC + TiDB on Railway). See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the two-ring map.

---

## Onboard in 5 minutes

```bash
# 1. clone + cd
git clone https://github.com/nourdean22/statenour-os && cd statenour-os

# 2. install (pnpm is canonical — locked via packageManager field)
pnpm install --frozen-lockfile

# 3. env — copy then fill (see .env.example for the full catalog)
cp .env.example .env.local
#   minimum required: DATABASE_URL, DIRECT_URL, VENICE_API_KEY
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
pnpm check:crons      # cron manifest vs vercel.json vs filesystem
pnpm typecheck        # tsc --noEmit (0 errors)
pnpm lint             # eslint . (0 errors, ~430 warnings tolerated)
pnpm test             # vitest run — current count in RECONCILIATION.md
bash scripts/pre-push-check.sh   # full 9-gate pre-push (typecheck +
                                 # lint + tests + raw-sql + cron-budget +
                                 # AI-catalog + env-secret + mutating-auth +
                                 # sensitive-GET HARD)
```

---

## Daily routes

Every page lives inside the `(mastery)` route group — Nour-only,
auth-gated, wrapped in `NourStateProvider` + `AmbientAura` +
`KeyboardShortcuts` + `BrainDumpModal`.

| Route | Purpose |
|---|---|
| `/` | **Ultron** — top-strip pulse + Today's 3 + Situation + omni-capture. Vision lives at [`docs/ULTRON-VISION.md`](docs/ULTRON-VISION.md) |
| `/chat` | Nick — streaming chat, tool calls, output critic, lane-correction |
| `/tasks` | Action deck — NOW / PLAN / TRACK / LEARN, goal↔project bridge |
| `/journal` | Thought stream — voice + text + Obsidian-flavored |
| `/knowledge` | Knowledge base (Drive ingest lives here) |
| `/brain` | Memory browser + graph explorer + reset |
| `/devices` | Smart-home bridge (Ring / Eufy / Tuya / Google Home) |
| `/body` · `/financial` · `/mastery` · `/integrations` | Depth surfaces |
| `/system` | **System Command Center** — see below |
| `/settings` | App config, cron control, push notifications |

**System ops deck** (v8.x → v10 · fully observable, every knob exposed):

| Route | What you see / control |
|---|---|
| `/system` | Top-level status + drill-down nav chips |
| `/system/health` | DB latency, device count, commitments, loops |
| `/system/crons` | active crons · kill-switch + run-now per cron · sparkline history · drift detector · 8-category filter |
| `/system/cron-runs` | All-jobs index — every cron at a glance · success rate · failures-first sort · staleness highlighting · click-thru (v8.18) |
| `/system/cron-runs/[jobName]` | Per-job history — last 200 runs · duration sparkline · expandable error preview · run-now button (v8.14/v8.18/v8.19) |
| `/system/alerts` | Cross-category brain-alert inspector · 7 categories · drill into audit trail (v8.11.2) |
| `/system/embedding-coverage` | pgvector migration dashboard · dual-write coverage % · per-sourceType breakdown · backfill + dedup runs (v8.13) |
| `/system/errors` | ErrorLog grouped by fingerprint · "→ task" button · recent feed with expand-to-stack |
| `/system/ai-cost` | Today/7d/30d cost + latency + error rate · 14-day trend bars · breakdown by feature × model · burn rate vs 7d avg |
| `/system/actions` | Nick's autonomous-action audit · rule leaderboard w/ SVG success-rate rings · expand for payload JSON |
| `/system/command-center` | NICK Prime control room (v9.0+) — prompt mode toggle + parity health |
| `/system/repos` | Cross-repo health (v10 E.1) — 8 repos by ring · last commit + freshness via GitHub API |
| `/system/schema-history` | Schema-change ledger (v10 E.2) — every `prisma db push` reasoned + reviewed |
| `/system/deployment-truth` | Single-pane deploy fact-sheet (v10 E.4) — build SHA + schema drift + env health + cron 24h |

The **FloatingHome orb** (bottom-right, draggable) tints live by
system state: gold=calm, amber=watch, red=alert. The expanded menu
shows SYSTEM OPS with live badges so you never need to navigate to
spot a problem.

---

## Architecture in one paragraph

statenour-os is a Next.js 16 App Router app deployed to Vercel. Prisma
7 talks to Neon Postgres (current model count in RECONCILIATION). Nick
runs through a pluggable provider chain (Venice primary → Ollama Cloud
→ OpenAI → Anthropic → Gemini fallback) via `lib/ai/provider.ts`, with
v10 E.5 `streamWithFallback` providing pre-first-token same-turn
rotation. System prompt assembly + tool selection + output critique
live in `lib/ai/*`. Scheduled crons manage ingestion (Gmail/Calendar/
Drive/Fireflies), brain maintenance (memory consolidation, identity
refresh, skill extraction, semantic dedup, pgvector backfill), and
hygiene (retention, pin review, stale-conv archive, brain-bus
backfill). All declared in [`config/crons.ts`](config/crons.ts) with a
CI drift guard + Vercel Pro 40-cap budget gate. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full diagram.

---

## Developer workflow

```
codex/ollama-local  ← your feature branch (dev + preview + PROD deploy)
       │
       │  push → pre-push hook (9 gates · v10):
       │    1. tsc --noEmit
       │    2. eslint --quiet (warnings tolerated)
       │    3. vitest run
       │    4. raw-sql column audit
       │    5. cron manifest drift + 40-cron budget cap
       │    6. AI tool-catalog contract
       │    7. env-secret bypass guard (process.env.X ?? "" patterns)
       │    8. mutating-route auth gate
       │    9. sensitive-GET auth gate (HARD mode · v9.1.17)
       │    (+ full production build on statenour-master)
       │
       ▼
  Vercel production   → bdnick.info (deploys directly from codex/ollama-local)
       │
       ▼  CI (.github/workflows/ci.yml) — verify + build + cron-drift
       │
       ▼  on green
  mirror-to-master.yml  ← fast-forwards statenour-master to codex HEAD
```

**Never push directly to `statenour-master`** — it's downstream of the
mirror workflow. If mirror fails, master has diverged (should never
happen); reconcile manually.

---

## Project docs (read in this order)

1. [`docs/RECONCILIATION.md`](docs/RECONCILIATION.md) — **start here** · verified reality snapshot · counts · gate status · doc hierarchy
2. [`docs/AGENT-CONTRACT.md`](docs/AGENT-CONTRACT.md) — what any agent needs to know before editing
3. [`docs/project/UPGRADE-PLAN.md`](docs/project/UPGRADE-PLAN.md) — **active execution source** · current wave + checkpoint log
4. [`docs/project/CHANGELOG.md`](docs/project/CHANGELOG.md) — shipped features by wave
5. [`docs/project/ROADMAP.md`](docs/project/ROADMAP.md) — high-level future horizons (not a wave plan; see UPGRADE-PLAN for execution)
6. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — subsystem map + data flow
7. [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) — 69 Prisma models + retention
8. [`docs/SECURITY.md`](docs/SECURITY.md) — auth, CSP, secrets, boundaries
9. [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — cron catalog + incident playbook
10. [`docs/ENDPOINT-HYGIENE.md`](docs/ENDPOINT-HYGIENE.md) — primary vs helper routes
11. [`docs/REPO-MAP.md`](docs/REPO-MAP.md) — repos under `nourdean22/*`
12. [`docs/ULTRON-VISION.md`](docs/ULTRON-VISION.md) — product vision for `/`

Archived material (Mar 27 prompt files, Ollama modelfiles, prior
session notes, retired plans) lives at [`docs/archive/`](docs/archive/).

---

## WAVE-200 substrate (Mastra · Braintrust · Inngest · LiveKit)

The 6-phase Wave-200 rollout lives behind feature flags. Default state
is "everything degrades gracefully · operator pastes credentials to
activate each substrate". Status surfaces on `/api/health`:

```bash
curl https://bdnick.info/api/health | jq '.data | {inngest, braintrust, agentV2}'
```

Operator action items per substrate · each is a 5-minute paste:

| Substrate | Flip mechanism | Runbook |
|---|---|---|
| Mastra agent (AGENT_V2) | `pnpm smoke:agent-v2` → `AGENT_V2=true` | `docs/WAVE-200-PLAN.md` Phase 1 |
| Mastra memory persistence | `MASTRA_MEMORY_BACKEND=pg` | `docs/adr/0009-mastra-memory.md` |
| Braintrust tracing | paste `BRAINTRUST_API_KEY` | `docs/adr/0002-braintrust-observability.md` |
| Inngest workflows | paste `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` + connect URL | `docs/operator/inngest-setup.md` |
| LiveKit voice | new Railway service `statenour-voice` + paste 7 env vars | `apps/voice/README.md` |

Local dev for each substrate:

```bash
# Agent · smoke the Mastra path in-process (2 turns · memory check)
pnpm smoke:agent-v2

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
- `/api/health` · top-level state + `{inngest, braintrust, agentV2}` block
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
pnpm build:check                 # build only (no prisma generate) — used by pre-push on master
pnpm build:push-schema           # ⚠️ generate + db push --accept-data-loss + build.
                                 # Schema-conforming deploy — DROPS columns/tables not in
                                 # schema.prisma. Use only for explicit one-shot resyncs.

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
pnpm check:crons                 # cron manifest vs fs vs vercel.json
pnpm check:crons -- --fix        # rewrite vercel.json from config/crons.ts
pnpm prompt:size-check           # system prompt token budget
pnpm calibrate:dry               # dry-run auto-calibrate cron

# WAVE-200
pnpm smoke:agent-v2              # 2-turn in-process probe of Mastra path
pnpm inngest:dev                 # Inngest local dev runner (port 8288)
```

---

## Philosophy

- **Never assume.** Verify with code / git / DB / logs before acting. This is the root rule.
- **Power + control everywhere.** Every cron, every integration, every AI call has a kill switch and a manual run.
- **Alive over static.** Live counters, sparklines, freshness chips, pulse dots — the UI answers "is the system OK?" without opening anything.
- **Interesting data.** Breakdowns, sparklines, burn rates, cross-surface correlations. Not just lists.
- **Devastating lead.** Meta-intelligence surfaces (Nick-quality trend, decision-drift, Ghost Nour, anti-pattern library) on the roadmap — see [`docs/project/UPGRADE-PLAN.md`](docs/project/UPGRADE-PLAN.md) W12.
- **Solo operator.** One allowlist email. One Nour. The product is the leverage, not the platform.

---

**Quality gate live on every push**: `pre-push` hook + GitHub Actions
CI + cron-manifest guard + schema-drift check. Zero broken deploys
is the goal.
