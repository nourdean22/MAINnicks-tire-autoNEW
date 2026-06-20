# Repository map — Nour's GitHub

Living reference for the repos under `github.com/nourdean22/*`
so future sessions + any agent understand the layering without
grepping. Last refreshed 2026-05-21 (infra reconciliation — statenour
moved into the `MAINnicks-tire-autoNEW` monorepo at `apps/statenour/`,
deployed by Railway; the standalone `statenour-os` repo, the
`codex/ollama-local` branch, and Vercel are retired).

> **Live source:** [`config/repos.ts`](../config/repos.ts) is now the
> structured truth — typed entries with `ring`, `tier`, `host`,
> `branch`, `status`, `monitored`, `nickWriteAccess`. The dashboard
> at `/system/repos` (v10 E.1) renders this list with GitHub-API
> last-commit augmentation. **This file is the prose narrative**
> companion; if a field disagrees, `config/repos.ts` wins.
>
> **Nick write access:** `none` for every repo. Nick observes the
> repo health surface; he does not push code. Code edits stay manual.

---

## The two rings

Every repo slots into one of two operational rings — the **business
ring** (Nick's Tire & Auto) and the **personal ring** (Nour's command
center) — plus a small **desktop layer** for local-only IoT control.

```
                         ┌──────────────────────────────┐
                         │       nickstire.org          │
                         │   (MAINnicks-tire-autoNEW)   │
                         │   Express · Drizzle · TiDB   │
                         │   Railway · main branch      │
                         └──────────┬───────────────────┘
                                    │
               ┌────────────────────┼────────────────────────┐
               │                    │                        │
     ┌─────────▼──────────┐ ┌──────▼────────┐   ┌───────────▼────────┐
     │ nickstire-cron-    │ │ easy.nickstire│   │ nicks-tire-social  │
     │ worker (Railway)   │ │ (booking +    │   │ (IG autoposter +   │
     │ 11 scheduled jobs  │ │  reviews)     │   │  self-learner)     │
     └─────────┬──────────┘ └───────────────┘   └────────────────────┘
               │ every 4h → statenour-sync
               │
     ┌─────────▼──────────────────────────┐
     │   bdnick.info                      │
     │   (MAINnicks-tire-autoNEW          │
     │    monorepo · apps/statenour/)     │
     │   Next.js 16 · Prisma · Neon       │
     │   Railway · main branch            │
     └────────────┬───────────────────────┘
                  │ Apr 20 — device RPC bridge
                  │ POST /api/devices/command
                  │   ↓ enqueue
                  │ DeviceCommand status=pending
                  │   ↑ poll
                  │ GET /api/devices/queue (agent)
                  ▼
     ┌─────────────────────────────────┐
     │   nour-os-unified (Windows)     │   PowerShell local agent
     │   Ring · Eufy · Tuya · Google   │   polls + executes + acks
     └─────────────────────────────────┘

     ARCHIVED — scaffold graveyard + empty placeholder:
     ┌─────────────────────────────┐    ┌──────────────────────┐
     │ NICKS-TIRE-NEW-GITHUB       │    │ nour-os-bootstrap    │
     └─────────────────────────────┘    └──────────────────────┘
```

---

## BUSINESS RING — Nick's Tire & Auto (4 repos)

### `MAINnicks-tire-autoNEW` · nickstire.org
The business itself. Admin + customer-facing tire shop management.

- **Stack:** Express 4 · tRPC 11 · React 19 · Vite · Drizzle · TiDB MySQL
- **Deploy:** Railway, branch `main`
- **Local:** `C:\Users\nourd\MAINnicks-tire-autoNEW`
- **Key dirs:** `client/` · `server/` (47+ routers) · `drizzle/` · `scripts/`
- **Status:** ACTIVE · production

### `nickstire-cron-worker` · Railway
Standalone scheduler. HTTP-pings cron endpoints on nickstire.org so
Vercel lambdas don't have to run `setInterval` (saves ~20-30% memory).

- **Stack:** Node 20 · `cron` npm pkg · Dockerfile
- **Deploy:** Railway
- **Jobs (11):** sms-scheduler (5m) · review-requests (30m) ·
  daily-report (7pm) · cleanup (6h) · warranty-alerts (8am) ·
  dashboard-sync (15m Mon-Sat) · abandoned-forms (30m) ·
  stale-lead-followup (2h Mon-Sat) · **statenour-sync (4h)** ←
  this hits the statenour Railway service ·
  customer-segmentation (disabled) · retention-90day (disabled)
- **Status:** ACTIVE

### `easy-nickstire` · easy.nickstire.org
Customer portal split out from the main admin bundle. Separate so
customers load a tiny app instead of the full shop UI.

- **Stack:** Next.js 16 · React 19 (App Router)
- **Routes:** `/book` · `/review` · `/status` · `/api/*`
- **Deploy:** Vercel
- **Status:** ACTIVE

### `nicks-tire-social` · Instagram automation
Autonomous Instagram publishing engine. Posts themed content on
cron schedule, reacts to weather triggers, self-learns from engagement.

- **Stack:** Express · sql.js (SQLite in-process) · node-cron · nodemailer
- **Modules:** caption-generator · design-generator · IG publisher ·
  Notion logger · weather-reactor · self-learner · themes · brain-connector
- **Scripts:** `npm run post:theme` · `npm run auto` · `npm run learn`
- **Status:** ACTIVE

---

## PERSONAL RING — command center

### `statenour` · `apps/statenour/` in the monorepo ← you are here
Nour's personal OS. Nick chat + brain + pins + situation card +
goal/project/task bridge + tasks + journal + knowledge + devices.

- **Repo:** `nourdean22/MAINnicks-tire-autoNEW` monorepo, lives at
  `apps/statenour/` — the standalone `statenour-os` repo is retired.
- **Stack:** Next.js 16 · Prisma 7 · Neon Postgres · Tailwind 4 ·
  AI SDK v6 · pluggable provider chain (model ids + order live in `lib/ai/provider.ts`;
  same-turn fallback via `streamWithFallback`)
- **Deploy:** Railway (`statenour-web` service), branch `main` →
  `bdnick.info`
- **Local:** `C:\Users\nourd\OneDrive\Desktop\nickstire-repo-staging\apps\statenour`
- **Status:** ACTIVE · under heavy development
- **Nick write access:** `none`
- **Monitored:** `true`
- **Surfaces:** `/` (HQ Ultron) · `/chat` · `/brain` · `/tasks` ·
  `/journal` · `/plan` · `/pins` · `/intel` · `/social` ·
  `/photo-improver` · `/content/history` · `/knowledge` · `/devices` ·
  `/body` · `/financial` · `/system` (incl `/system/history` ·
  `/system/costs` · `/system/prompt` · `/system/errors`) · `/settings`
- **DB hardening (v7.6 → v8.0 · 2026-04-29):**
  - ChatMessage Batch A — 16 cols + tsvector FTS + branch/edit/cost
  - Universal idempotency (6 tables) + UNIQUE PARTIAL INDEX
  - Universal `createdBy/updatedBy` (6 tables) + AsyncLocalStorage actor
  - Universal `deletedAt` soft-delete (9 tables) + helper module
  - Universal `entity_audits` provenance log (Phase 2A)
  - Schema-drift sentinel (Phase 2C) — `GET /api/system/schema-drift`
- **Helper modules:** `lib/db/idempotency.ts` · `lib/db/actor.ts` ·
  `lib/db/soft-delete.ts` · `lib/db/entity-audit.ts` ·
  `lib/db/schema-sentinel.ts` · `lib/utils/http-parse.ts` ·
  `lib/utils/sanitize-error.ts` (v529.4 · ADR-0012 · scrubs leak
  vectors before JSON 500) · `lib/ai/tool-quota.ts` (v529.4 · ADR-0013
  · per-tool daily quota via `BrainMemory(category="tool_quota_daily")`)
  · `lib/ai/tool-result-fencing.ts` (v529.5 · ADR-0014 · `<tool_data>`
  fences for prompt-injection defense) · `lib/services/decision-replay-coach.ts`
  (v528 · ADR-0015 · daily replay queue builder)
- **New surfaces (v528-v529):** `app/api/cron/decision-replay/route.ts`
  · `app/api/system/decision-replays/route.ts` (+ `[id]/mark/route.ts`
  v529.7) · `app/api/system/agent-traces/[traceId]/timeline/route.ts`
  · `components/ultron/decision-replay-card.tsx` · `components/chat/
  reasoning-trace-{drawer,timeline}.tsx`
- **Scripts:** `scripts/apply-pending-migration.ts` (v529.1 ·
  autocommit pg driver · CONCURRENTLY migration runner that bypasses
  Prisma's implicit transaction wrap)
- **Crons:** declared in `config/crons.ts` (the single source of
  truth) — each entry is `active` (own schedule), `folded` (runs
  inside a parent cron, most fold into `mega-evening`), or `retired`.
  The device crons (`device-command-reap`, `device-sync`,
  `device-health`, `status`) and `notification-sender` were deleted
  with their route files.
- **ADRs:** `docs/adr/0001-0015-*.md` (0012-0015 added v529.10 ·
  sanitizeError · tool-quota · tool-result-fencing · decision-replay-coach)

---

## DESKTOP LAYER (1 repo)

### `nour-os-unified` · Windows local agent
PowerShell-based local agent. Runs on the desktop itself (not web).
IoT bridges for smart-home devices, audio transcription, browser
automation, daily briefings.

- **Stack:** PowerShell 5+ · little Python (IoT bridges) · a Node
  bridge per vendor
- **Modules:** `audio/` · `automation/` · `briefing/` · `browser/` ·
  `energy/` · `iot/{eufy,google,ring,tuya}`
- **Setup:** `setup.ps1` installs a `nour` CLI alias in the user profile
- **Status:** ACTIVE · kept for Windows-only control (Ring, Eufy, Tuya,
  Google Home) that the cloud stack can't do.
- **Apr 20 — bridge to statenour:** the desktop agent can
  poll `GET /api/devices/queue` for pending `DeviceCommand` rows,
  execute them locally via its vendor bridges, and PATCH the
  status back. See `docs/DEVICE-RPC.md` for the contract.

---

## ARCHIVED / DEAD (2 repos)

### `NICKS-TIRE-NEW-GITHUB`
The original scaffold. Contains `_project/` (Express + Drizzle,
same stack as MAIN) plus zipped phase snapshots (phase2/4/5 zips,
original nickstire zip, 2.0.zip).

- **Last commit:** 2026-03-21 — "Add _project scaffold"
- **Status:** SUPERSEDED by `MAINnicks-tire-autoNEW`. Content is in
  MAIN; the zips are historical-phase snapshots.
- **Recommendation:** Archive on GitHub (Settings → Archive) for
  read-only reference. No active development.

### `nour-os-bootstrap`
Empty placeholder. One file (`.gitattributes`).

- **Last commit:** 2026-03-20 — "Initial commit"
- **Status:** Never developed.
- **Recommendation:** Delete or archive. Zero value kept.

---

## Cross-repo sync points

Where the rings actually talk to each other:

| Sync | From | To | Mechanism | Cadence |
|------|------|-----|-----------|---------|
| `statenour-sync` | nickstire-cron-worker | nickstire.org → statenour | HTTP webhook chain | every 4h |
| Google OAuth ingest | statenour cron | Gmail / Calendar / Drive | OAuth refresh | 8am+8pm / 8:15am / Sun+Wed 2:30am |
| Device command RPC (2026-04-20) | statenour | nour-os-unified | pending-queue poll + ack | agent polls every 15-30s |
| Brain continuity | any chat turn | BrainMemory (Neon) | on onFinish | per reply |

---

## Deployment matrix

| Repo / app | Host | Env | Branch | Auto-deploy |
|------|------|-----|--------|-------------|
| MAINnicks-tire-autoNEW (`apps/nickstire/`) | Railway | prod | `main` | yes |
| MAINnicks-tire-autoNEW (`apps/statenour/`) | Railway | prod | `main` | yes |
| nickstire-cron-worker | Railway | prod | `main` | yes |
| easy-nickstire | Vercel | prod | `main` | yes |
| nicks-tire-social | Railway | prod | `main` | yes |
| nour-os-unified | none (local) | desktop | `main` | manual `setup.ps1` |

---

## Key principles

1. **Business ↔ Personal separation is deliberate.** The business
   runs on Express/Drizzle/TiDB (matching its operational needs).
   Personal runs on Next/Prisma/Neon (matching its interactive
   needs). Both deploy on Railway from the shared monorepo; they
   share data via scheduled sync, not a shared DB.

2. **The whole stack runs on Railway.** `nickstire-cron-worker` runs
   24/7 and HTTP-pings the nickstire service when a job is due.
   statenour owns its own crons — declared in `config/crons.ts`,
   driven by the mega fan-out + the Inngest evening job list.

3. **`main` is the production branch for the whole monorepo.**
   Railway watches `main` with per-service watch paths; a push that
   touches `apps/statenour/**` auto-deploys the `statenour-web`
   service.

4. **Legacy tables linger in Neon.** `daily_scores`, `labor_operations`,
   `morning_briefs`, `open_loops`, `projections`, `tires` — dropped
   from schema but still in DB. Blocks `prisma db push`; use raw
   SQL for additive changes (see `scripts/add-pinned-index.ts`).

5. **Nick's personality is central, everything else wraps it.**
   `statenour-os`'s chat layer is the primary interface; brain +
   pins + situation feed the system prompt; tasks/journal/knowledge
   feed tools. When in doubt about where code belongs, ask: does
   Nick need to see it?

---

## When adding a new repo

Before creating a 9th repo, ask:

1. **Does it fit a ring?** Business or personal?
2. **Could it be an app in the monorepo?** Most new web code should
   land as `apps/<name>/` alongside `statenour` and `nickstire`.
3. **Does it deploy?** → Railway, like the rest of the stack.
4. **Is it a local desktop thing?** → extend `nour-os-unified`, don't spawn new.
5. **Is it a spike or experiment?** Keep it in a branch, don't
   create a repo until it ships.

The trap: spawn a repo per experiment → 20 repos in a year, 15 dead.
The fix: experiments live in branches or `scripts/` subdirs of the
parent ring. Promote to repo only when it has its own deploy.

---

## Quick actions

- Archive `nour-os-bootstrap`: https://github.com/nourdean22/nour-os-bootstrap/settings
- Archive `NICKS-TIRE-NEW-GITHUB`: https://github.com/nourdean22/NICKS-TIRE-NEW-GITHUB/settings
- See device RPC contract: [`docs/DEVICE-RPC.md`](./DEVICE-RPC.md)
- See endpoint hygiene: [`docs/ENDPOINT-HYGIENE.md`](./ENDPOINT-HYGIENE.md)
- See roadmap: [`ROADMAP.md`](../ROADMAP.md)

---

**Reconciled 2026-05-21** · infra sweep — the statenour rows were
rewritten for the monorepo + Railway reality (was the standalone
`statenour-os` repo / Vercel / `codex/ollama-local`, all retired). If a claim in this doc contradicts code reality, the
code wins · open an issue.
