# STATENOUR-OS · UPGRADE PLAN — Active Execution Source

> **🗄 STATUS: HISTORICAL.** This file documented the v8.x mega-
> overhaul wave (April 28-29, 2026). v8 + v9 + the early v10
> waves have all shipped. For the active execution source see
> [`V10-PLAN.md`](./V10-PLAN.md). For verified current state see
> [`../RECONCILIATION.md`](../RECONCILIATION.md).
>
> **Owner:** Nour Dean.
> **Active wave (this file):** v8.x mega-overhaul (closed).
> **Active wave (the system):** v10 — see V10-PLAN.md.
> **Last reconciled (this file):** 2026-04-29 (v8.25 pass).
> **Last reconciled (the system):** see RECONCILIATION.md header.
>
> Future horizons live in [`ROADMAP.md`](ROADMAP.md).
> Shipped feature log in [`CHANGELOG.md`](CHANGELOG.md).
>
> Below is the v8.x narrative — preserved for historical context only.
> Cross-session memory at `~/.claude/projects/C--/memory/v8_mega_overhaul.md`.
>
> **Operating rules (immutable):**
> 1. NEVER ASSUME. Verify code, git history, DB, logs before acting.
> 2. No agents for detail work. Detail is my job.
> 3. Interesting data + clever ideas inside AND outside the box.
> 4. Power + control — every surface should give Nour a knob.
> 5. Alive + dynamic UI — no static boring elements.
> 6. Checkpoint after every wave; commit is the checkpoint.
> 7. Single push to `codex/ollama-local` (deploys directly to autonicks.com).
> 8. Fortune-500 quality minimum. "Good enough" is NOT good enough.

---

## 0 · Reality snapshot (verified 2026-04-29 18:55Z · HEAD `08237d9`)

| Fact | Value | Source |
|---|---|---|
| HEAD | `08237d9` on `codex/ollama-local` | `git rev-parse --short HEAD` |
| Prod branch | `codex/ollama-local` (deploys directly to autonicks.com) | Vercel project config |
| Mirror to `statenour-master` | `.github/workflows/mirror-to-master.yml` on green CI | repo |
| Commits last 7 days | 208 | `git log --since='7 days ago'` |
| Typecheck | 0 errors | `pnpm typecheck` |
| ESLint | 0 errors · 430 warnings (tolerated) | `pnpm lint` |
| Tests | 41 files · 459 tests · all green · ~3s | `pnpm test` |
| Pre-push hook | Installed · 8 gates · all green | `bash scripts/pre-push-check.sh` |
| CI workflow | `.github/workflows/ci.yml` mirrors local gates | repo |
| Active crons | **34** · 24 folded · 5 retired · 6 slots headroom under Vercel Pro 40-cap | `verify-crons.ts` |
| Prisma models | 66 · 19 `@relation` · 2 migrations | `prisma/schema.prisma` |
| API routes (`route.ts`) | 313 | `find app/api -name route.ts` |
| `(mastery)` pages | 50 | `find 'app/(mastery)' -name page.tsx` |
| Auth coverage gate (warn) | 59 legacy routes flagged for triage | `AUTH_GATE_HARD=1 ./pre-push-check.sh` |
| Build script (Vercel default) | `prisma generate && next build` (safe) — `build:push-schema` retains the dangerous variant for explicit invocation | `package.json` (v8.25 fix) |

---

## 0.5 · Active wave at-a-glance (v8.x · Apr 29)

The v8.x mega-overhaul shipped 25 commits across v8.0 → v8.24 on Apr 29
(208 commits in last 7d total counting earlier v6/v7 waves). High-level
themes:

- **Phase 1 hardening** (v7.6-v7.9.1): ChatMessage Batch A, universal
  idempotency, AsyncLocalStorage actor, universal soft-delete.
- **Phase 2 — observability + composition** (v8.0-v8.5):
  entity-audit log + brain-bus (LISTEN/NOTIFY) + schema-drift sentinel
  + pgvector skeleton + 5-category Telegram alert pipeline + tenant
  skeleton.
- **Cron budget consolidation** (v8.7.1/v8.7.2): 50 → 34 actives under
  Vercel Pro 40-cap; 24 folded into mega composers.
- **Operator surfaces** (v8.11-v8.18): /system/alerts ·
  /system/embedding-coverage · /system/cron-runs[/jobName] (with
  sparkline + run-now + staleness highlighting + auth-via-manifest).
- **Closed-loop intelligence** (v8.22-v8.23): chat sees brain alerts
  in system prompt · journal entries auto-embed into pgvector · Telegram
  /goals /predict /search /stats remote-read commands · brain-bus
  consumer activated via folded cron.
- **Security hardening** (v8.21): TELEGRAM_WEBHOOK_SECRET mandatory
  (throws on missing) · 8-gate pre-push (added env-secret bypass guard
  + API auth coverage gate, warn mode) · 4 silent-bypass risks fixed.
- **Soft-delete retrofit + mobile responsive sweep** (v8.24): top 5
  high-impact files (commitments, brain/pinned, todo-desk, stale-tasks)
  + 3 system pages mobile-fixed (performance, decision-drift,
  anti-patterns).

Full per-version detail: see `~/.claude/projects/C--/memory/v8_mega_overhaul.md`.

---

## 0.6 · Active priorities (the next moves)

Picked from the audit + reconciliation pass. Each is small enough to
finish in one commit; ship a push when 3-5 land green.

- [ ] **P1 · Manual** Set `GITHUB_TOKEN` in Vercel env (unlocks 8
  GitHub-integration tools). Token-creation steps on Vercel dashboard;
  Claude can't do this for you.
- [x] **P2** ✅ shipped v8.26. 51 legacy unauthed routes wrapped with
  `requireSession(req)` via one-shot tsx migration; auth-coverage gate
  flipped to fail-closed default. Recognized-pattern regex broadened to
  include `syncHandler`, `assertRunnerRequest`, `EXPECTED_SECRET`,
  `SYNC_KEY` (always-legitimate auth that the gate didn't know about).
  `AUTH_GATE_SOFT=1` is the emergency override.
- [x] **P3** ✅ pass 1 v8.24 (5 files), pass 2 v8.27 (9 files). 14 high-
  impact files now filter `deletedAt: null`. ~30 less-trafficked admin/
  one-shot files remain — covered by future grep-driven sweeps.
- [x] **P4** ⏸️ DEFERRED indefinitely (Nour decision 2026-04-30). Not
  inevitable — only matters if conversations regularly exceed 2000
  messages. Lazy-render covers 80-1000 cleanly; revisit only when
  evidence emerges from real usage. No bundle weight added on spec.
- [ ] **P5** Adopt structured logger across `lib/`. STAGED in
  `scripts/migrate-logger.ts` but not run — regex approach breaks
  multi-line console calls. Needs ts-morph AST rewrite before applying.
  Currently 89 `console.warn` + 26 `console.error` in lib/ live in
  production untouched.
- ✅ **v9.0 SHIPPED 2026-04-30** (Command Spine). 5 waves: alpha
  v8.31 (392e201) → beta v8.32 (7503a7e) → Telegram hotfix v8.33
  (7a7e820) → rc v8.34 (061fc01) → final v8.35. See
  [`V9-PLAN.md`](V9-PLAN.md) for full ship log. Active wave is now v9.1
  (consumer migration; flip prompt-v2 default once shadow-run parity
  holds 7+ days).

- [x] **P6** ✅ shipped v8.28. 103 client-side files / 253 call sites
  migrated from bare `fetch("/api/...")` to `authedFetch(...)` via
  `scripts/migrate-authed-fetch.ts`. Drop-in API-compatible — adds
  `credentials: "include"` + 401 retry + redirect-on-fail.
- [x] **P7** ✅ shipped v8.30. Decision (2026-04-30): `archivedAt` IS
  the soft-delete column for `ChatConversation`. No separate `deletedAt`
  column added. Read-side queries split: sidebar / continuity / session
  distiller filter `archivedAt: null` (3 callers retrofitted); search
  intentionally keeps archived rows visible (that's how Nour finds
  them). Convention documented in `DATA-MODEL.md`.

**Status · 5/7 P-items shipped, 1 manual flagged, 1 staged.**
- ✅ P2 (auth) · P3 (soft-delete partial) · P6 (authedFetch) · P7
  (archivedAt convention) · P4 (deferred indefinitely)
- 📋 P1 (manual: GITHUB_TOKEN on Vercel)
- 🔬 P5 (logger adoption — staged, needs ts-morph rewrite)

Next pickup beyond active priorities: see [`ROADMAP.md`](ROADMAP.md)
horizons.

Beyond P7: see [`ROADMAP.md`](ROADMAP.md) for high-level future
horizons.

---

## 1 · Guiding philosophy for this wave

The user loves: **power, control, devastating lead, nothing missing, alive UI, interesting data, clever inside+outside ideas, never-assume rigor**.

Translate that into concrete design rules:

- Every page exposes at least one **knob** (filter, toggle, manual trigger, threshold).
- Every data surface shows **freshness** ("42s ago") and **provenance** (source chip).
- Every log is **drillable** — click row → full context + related records.
- Every cron has a **kill switch** + **manual-run** button + **last-N-runs** strip.
- Every error has **Nick's take** + **dismiss** + **open issue**.
- Every AI call has **cost** + **latency** + **provider** + **re-run w/ alt provider** button.
- Every number with a history has a **sparkline**.
- Every state transition has a **micro-animation** (150–250ms).
- Every input has a **keyboard shortcut**.
- Zero dead links, zero dead buttons, zero "not implemented yet" placeholders.

---

## 2 · Master wave list (HISTORICAL · v11.0 plan from Apr 21)

> **Reconciliation note (Apr 29):** the v11.0 wave list below was
> written Apr 21 and is preserved for historical traceability. Most
> items shipped during the v8.x mega-overhaul (Apr 28-29). New work
> picks up from `§0.6 Active priorities` above; do NOT execute the
> v11 wave list top-to-bottom unprompted — many items are now
> obsolete (e.g., W4 cron triage shipped as v8.7.x consolidation;
> W6 chat split shipped as v8.12-v8.18 hook decomp; W2 system pages
> shipped as the v8.x operator surfaces; W10 docs is THIS pass).
> Treat as a checklist for confirming nothing was forgotten, not a
> sequential plan.

### WAVE 1 · FOUNDATION (ship-critical, same session) — est 6h

**Goal:** stop the bleeding. Every fix here prevents future regressions.

- [ ] **W1.1** Confirm Vercel production branch (manual verification needed — user has dashboard access; this plan records the answer).
  - **Verification:** Vercel dashboard → Project `statenour-os` → Settings → Git → Production Branch = ?
  - **If `statenour-master`**: execute `git push origin codex/ollama-local:statenour-master` to force-sync.
  - **If `codex/ollama-local`**: remove dual-push instruction from CLAUDE.md/MASTER-CONTEXT; add branch-mirror GHA in W1.7.
  - **Output:** record truth in this file section `§0`.
- [x] **W1.2** Write this plan file (`UPGRADE-PLAN.md`) + checkpoint tracker.
- [ ] **W1.3** Kill dead code in one commit:
  - 8 empty API dirs: `admin · brief · day · operator · patterns · reports · scheduled-actions · voice`
  - 15 orphan components (verify each via grep before rm): `actions/task-lanes · chat/venice-status-dot · devices/device-controls · forms/{mission-form,task-form,task-status-button} · layout/{desktop-rail,mobile-tabs} · tasks/task-skill-hint · ui/{activity-heatmap,connection-indicator,live-clock,spinner,status-dot} · ultron/top-strip/pulse-stack`
  - Ollama residue: `ollama/` dir (3 files)
  - 10 stale prompts from Mar 27: `AI_TOOLS_DEPLOYMENT_PROMPT · CLAUDE_CODE_CONTENT_CREATION_PROMPT · MEGA_INTEGRATION_PROMPT · NICKS_TIRE_KILLER_PROMPT · NOUR_BRAIN_ACTIVATION_PROMPT · NOUR_FINAL_CLAUDE_CODE_SESSION · NOUR-OS-QUICK-GUIDE · OLLAMA_MODEL_PACK_PROMPT · TUNEUP_PROMPT` — move to `docs/archive/prompts/`.
  - Deprecated top-level markdown with Apr-12+ superseded content: move to `docs/archive/`.
  - **Verification:** `tsc --noEmit` + `vitest run` both still pass.
  - **Commit:** `chore(cleanup): kill 8 empty dirs + 15 orphans + Ollama + 10 stale prompts`
- [ ] **W1.4** Fix ESLint config (install `@typescript-eslint` plugin + parser, confirm `eslint .` runs).
  - **Commit:** `fix(lint): restore @typescript-eslint plugin to flat config`
- [ ] **W1.5** Install pre-push hook (`scripts/pre-push-check.sh` → `.git/hooks/pre-push`).
  - Make it **fast**: typecheck-only for push from `codex/ollama-local`, full build on `statenour-master` push.
  - **Commit:** *not a code change — hook installation noted here.*
- [ ] **W1.6** Add GitHub Actions CI: `.github/workflows/ci.yml` running `pnpm install --frozen-lockfile && pnpm tsc --noEmit && pnpm test && pnpm lint`.
  - Add PR-gate workflow.
  - **Commit:** `ci: typecheck + test + lint on push and PR`
- [ ] **W1.7** Branch-mirror workflow: `.github/workflows/mirror-to-master.yml` — on push to `codex/ollama-local`, fast-forward `statenour-master` iff CI passes.
  - **Commit:** `ci: auto-mirror codex/ollama-local → statenour-master on green CI`
- [ ] **W1.8** Lock file decision: commit to `pnpm`. Delete `package-lock.json` after `pnpm install` parity check.
  - **Commit:** `chore(deps): consolidate on pnpm, remove package-lock.json`
- [ ] **W1.9** Env hygiene:
  - Add the 22 missing vars to `.env.example` with comments.
  - Remove the 8 unused.
  - Unify the 3 OAuth naming schemes on `AUTH_GOOGLE_*` (matches auth.ts).
  - Grep-replace legacy refs.
  - Add `scripts/check-env.ts` that fails loudly on missing required vars at boot.
  - **Commit:** `fix(env): unify OAuth naming + refresh .env.example + boot-time check`
- [ ] **W1.10** Secrets audit: verify `.gitignore` covers `.env*`, `local-agent/.env`, `local-agent/.ring_token`, `local-agent/agent.log*`. Run `git log --all --full-history -- local-agent/.ring_token` to check history.
  - **Output:** report findings in §Secrets-audit below.

**Wave 1 exit criteria:**
- [ ] ESLint runs clean; all tests pass; typecheck clean; build succeeds.
- [ ] CI + pre-push installed.
- [ ] Branch-mirror automated.
- [ ] Dead code gone.
- [ ] Env example accurate.
- [ ] COMMIT CHECKPOINT #1 pushed.

---

### WAVE 2 · VISIBILITY + CONTROL (4 system pages + enrichments) — est 10h

**Goal:** every Nick action, every cron run, every error, every $ spent visible + controllable.

- [ ] **W2.1** `lib/system-views/` helper: shared query + typing for the 4 new pages + `SystemMetric`, `CronJobLog`, `ErrorLog`, `AiGeneration`, `AutonomousAction`, `ApiRequestLog`.
  - Cache-keyed fetch (60s) + Zod-validated contracts.
- [ ] **W2.2** `/system/crons` — every cron, last 50 runs per cron, duration histogram, pass/fail rate, **manual-trigger button**, **kill-switch toggle**, calendar heatmap, drift detector ("last run was 35m late").
  - **Alive elements:** live tick clock ("next run in 4m 12s"), duration bar pulses during active run, sparkline of durations.
  - **Power knob:** per-cron enable/disable, per-cron schedule override (stored in DB), force-run, tail-log drawer.
- [ ] **W2.3** `/system/errors` — last 500 errors grouped by fingerprint, expansion panel with stack + related logs, **Nick's take** (AI-summarized root cause from similar past errors), **dismiss-until-next-occurrence**, **open as task** button.
  - **Alive:** auto-refresh every 30s, pulse dot on new error.
- [ ] **W2.4** `/system/ai-cost` — daily/weekly/monthly cost, by provider/tier/tool/route, **budget bar** (configurable cap in `OperatorPreference`), **alert when 80% burned**, cheapest-model-suggestion for hot tools.
  - **Power knob:** per-provider enable/disable, daily cost cap enforcement in `lib/ai/budget.ts`, **"strict mode" toggle** that refuses expensive calls.
  - **Interesting data:** cost-per-tool heatmap, $/100-tokens by provider live, ROI estimate (if linked to AutonomousAction value).
- [ ] **W2.5** `/system/actions` — Nick's autonomous actions audit. Every `executeActions` call logged with: tool, args, result, outcome rating. **Rollback** button where possible (task creation → delete, memory write → archive, notification → recall). **Replay** button.
  - **Interesting data:** trust score per tool (success rate over time).
- [ ] **W2.6** `/system/requests` — API request volume heatmap (by route × hour × day-of-week), p50/p95/p99 latency, 4xx/5xx rate, top-N slowest. Bonus: cold-start indicator from `AWS_LAMBDA_FUNCTION_NAME`.
- [ ] **W2.7** `/system/devices` — each of 21 devices: last-seen, command backlog, online/offline reason, **ping now**, **restart agent** (sends command via bridge).
  - Light up the **20-offline problem**. See W3.1.
- [ ] **W2.8** `/system/secrets` — env var roster: required vs optional, last rotated (from git history of `.env.example`), in-use this week (from logs), stale/unused.
  - **Power knob:** per-integration "disable at runtime" toggle.
- [ ] **W2.9** `/system/migrations` — schema state: migrations applied, raw-SQL applied (tracked via manual log), drift detector via `prisma migrate status`, **"squash & seal" button** (generate migration from current state).
- [ ] **W2.10** `/system/logs` — tail live log stream with filter by level/route/user. Backed by `SystemMetric` + `ErrorLog` + a new `AppLog` if we decide to add one.
- [ ] **W2.11** `/system/power` — master control: pause all crons, cut all AI, quiet mode (no nudges), global override on provider/model, session-replay toggle.
  - **Big red buttons** (literally) with confirm modal.
- [ ] **W2.12** Top-strip telemetry extension on Ultron: heartbeat dot per category (crons healthy? AI healthy? devices healthy? DB healthy?), active provider + latency, daily cost vs budget (thin bar), error count last hour.
  - **Commit wave:** `feat(system): 11 observability + control surfaces + top-strip telemetry`

**Wave 2 exit criteria:**
- [ ] 11 `/system/*` pages ship, all wired to real data, all with at least one knob.
- [ ] Top-strip telemetry live.
- [ ] COMMIT CHECKPOINT #2 pushed.

---

### WAVE 3 · DEVICE BRIDGE REHAB — est 4h

- [ ] **W3.1** Diagnose 20/21 offline: read `local-agent/agent.log` for last errors, check Ring/Eufy/Tuya/Google credentials in `local-agent/.env`, run `python agent.py` manually in console.
- [ ] **W3.2** Decision: (a) revive local agent, (b) retire bridge, or (c) move to cloud-only webhook integrations.
  - If (a): install as Windows service (`install-service.ps1` exists), add health endpoint (`health_server.py` exists), schedule restart on failure.
  - If (b): remove `local-agent/` dir, retire `SmartDevice` / `DeviceCommand` / `DeviceEvent` models, gray out `/devices` page.
  - If (c): add cloud-only integrations via Ring/Eufy APIs where possible.
- [ ] **W3.3** Device bridge hardening (if kept):
  - Heartbeat every 60s from agent → server.
  - Server marks device offline if no heartbeat in 5m (`device-command-reap` cron handles this?).
  - Retry failed commands with exponential backoff.
  - Circuit breaker per device.
  - Command idempotency via nonce.
- [ ] **W3.4** Devices page rebuild (if kept): live grid with pulse indicators, each card shows model/signal/last-command, drag-to-group, bulk actions.
- [ ] **W3.5** Surface device anomalies in Situation card (e.g., "3 cameras down for 48h").

**Commit:** `feat(devices): bridge hardening + heartbeat + live grid + anomaly surfacing`

---

### WAVE 4 · CRON TRIAGE — est 3h

**Decision grid** per cron:

| Cron | Action | Why |
|---|---|---|
| brain-cycle | SCHEDULE hourly OR fold into mega | Already has logic; name suggests hot path |
| consolidate | FOLD into `mega?slot=evening` | Sleep-model memory consolidation |
| daily-report | SCHEDULE 7:30am ET | Morning recap feed |
| data-cleanup | SCHEDULE weekly Sunday 3am | Retention policy enforcement (W5 dep) |
| device-health | FOLD into `device-command-reap` | Already reaping every 5m |
| device-sync | SCHEDULE every 10m | Bridge polling |
| intelligence | RENAME + fold into brain-cycle | Ambiguous |
| journal-checkin | SCHEDULE 9pm | Evening prompt |
| learn | FOLD into `weekly-review` | Same cadence |
| predict | SCHEDULE 6am | Morning predictions |
| reflect | SCHEDULE 10pm | Already in vision |
| stale-tasks | SCHEDULE daily noon | Hygiene |
| status | DELETE (superseded by `/api/health`) | — |
| think | SCHEDULE every 3h | Continuous thinking |
| trigger | INSPECT — may be internal | — |
| weekly-digest | SCHEDULE Sunday 6pm | Week recap |

- [ ] **W4.1** Create `config/crons.ts` — single source of truth: `{ name, schedule, memory?, maxDuration?, enabled, description, category }[]`.
- [ ] **W4.2** Script `scripts/generate-vercel-crons.ts` — reads `config/crons.ts`, writes `vercel.json` crons block.
- [ ] **W4.3** Script `scripts/verify-crons.ts` — fails CI if any `app/api/cron/*` directory has a `route.ts` not in `config/crons.ts` (or not in explicit `ALLOWED_UNSCHEDULED` list).
- [ ] **W4.4** Decide + wire each of 16 dark crons per grid above.
- [ ] **W4.5** Every cron writes to `CronJobLog` with `{ name, startedAt, finishedAt, durationMs, status, error?, output? }`. Middleware wrapper in `lib/cron/wrapper.ts`.
- [ ] **W4.6** CRON_SECRET verification centralized (audit every cron route uses the wrapper).

**Commit:** `feat(cron): single-source schedule config + wrapper + triage of 16 dark jobs`

---

### WAVE 5 · DATA LAYER HARDENING — est 6h

- [ ] **W5.1** Retention policy: `config/retention.ts` with TTL per log-shape model:
  ```ts
  AiGeneration:        90d
  ChatMessage:         forever (pin-respecting)
  SystemMetric:        30d
  ApiRequestLog:       7d
  CronJobLog:          30d (keep 1 successful + 1 failed per cron forever)
  ErrorLog:            60d (keep unresolved forever)
  AutonomousAction:    forever (audit trail)
  StateLog:            30d
  SituationLog:        90d
  SessionReport:       forever
  DeviceEvent:         14d
  ```
- [ ] **W5.2** `data-cleanup` cron writes into `CronJobLog` what it truncated + freed-bytes estimate.
- [ ] **W5.3** Schema relation pass — add 10 `@relation` declarations for top parent/child pairs:
  - `Task.goalId` ↔ `LifeGoal`
  - `Task.missionId` ↔ `Mission`
  - `ChatMessage.conversationId` ↔ `ChatConversation`
  - `DeviceCommand.deviceId` ↔ `SmartDevice`
  - `DeviceEvent.deviceId` ↔ `SmartDevice`
  - `Reflection.taskId` ↔ `Task` (nullable)
  - `WorkResult.workItemId` ↔ `WorkItem`
  - `StagedRecoveryItem.entityKey` — polymorphic; skip or typed-union
  - `PersonalDailyLog.date` unique constraint
  - `Commitment.taskId` ↔ `Task` (nullable)
- [ ] **W5.4** Migration: `pnpm prisma migrate dev --name add_relations_v11`. Reconcile with legacy drift — may need `prisma migrate resolve --applied`.
- [ ] **W5.5** Dedup log models: `StateLog` vs `SituationLog` vs `SessionReport`. Write 1-pager decision; if merging, write migration + backfill.
- [ ] **W5.6** Add missing timestamps: audit 69 models, add `createdAt` / `updatedAt` where absent.
- [ ] **W5.7** Backup script: `scripts/backup-db.ts` — dumps Neon via `pg_dump` → S3 or local file → reports size + row counts per table.
- [ ] **W5.8** Restore runbook: `docs/RUNBOOK.md` restore section.

**Commit:** `feat(data): relations + retention policy + backup + schema alignment`

---

### WAVE 6 · AI STACK SURGERY — est 12h (biggest)

- [ ] **W6.1** `lib/ai/tools.ts` split strategy:
  - Inventory every tool (extract names + inputs + handlers).
  - Group by domain: `tasks/ · brain/ · devices/ · nickstire-bridge/ · capture/ · calendar/ · drive/ · gmail/ · image/ · knowledge/ · system-ops/ · meta/` (~12 files).
  - Each file exports: `schemas` (Zod), `handlers` (keyed by name), `catalog` ({ name, description, category }).
  - Barrel `lib/ai/tools/index.ts` assembles master registry.
  - **Shape-snapshot tests** (`tests/ai/tool-schemas.snapshot.test.ts`) — serialize every tool schema to JSON, snapshot-compare. Breaks CI if any tool's shape changes silently.
- [ ] **W6.2** Split `app/api/ai/chat/route.ts` (1,729 lines):
  - `route.ts` — thin (HTTP + auth + streaming setup) ~100 lines.
  - `lib/ai/chat/pipeline/` stages:
    - `01-classify.ts` — detect intent, mode, shape
    - `02-assemble.ts` — system prompt + context rerank + compress
    - `03-tools.ts` — tool selection + pruning
    - `04-stream.ts` — streamText + tool loop
    - `05-sanitize.ts` — output sanitizer + critic + reply-gate
    - `06-persist.ts` — chat message + generation + telemetry write
    - `07-fact-check.ts` — post-hoc verification
  - Every stage has its own unit test.
- [ ] **W6.3** Split `lib/ai/system-prompt.ts` (1,054 lines):
  - `lib/ai/prompt/base.ts` — identity + voice
  - `lib/ai/prompt/subsystems/` — one file per injected subsystem (8 currently)
  - `lib/ai/prompt/assemble.ts` — composition root
  - `lib/ai/prompt/versions/` — dated snapshots for A/B + rollback
- [ ] **W6.4** Prompt size budget enforcement: `scripts/measure-prompt-size.ts` already exists — add CI assertion that system prompt stays under budget (e.g., 8K tokens).
- [ ] **W6.5** Tool embedding + pruning review: verify `lib/ai/tool-embeddings.ts` still routes correctly after split.
- [ ] **W6.6** Per-tool telemetry dashboard — already wired via `tool-telemetry.ts`; surface at `/system/ai-cost` tools tab.
- [ ] **W6.7** Provider failover test: kill Venice, verify OpenAI fallback. Add chaos-test script.
- [ ] **W6.8** Decide Anthropic fate: memory says retired; if truly unused, remove `@ai-sdk/anthropic` + any `lib/ai/provider.ts` code referencing it. Otherwise document why it stays.
- [ ] **W6.9** Nick quality metric: rolling avg of `output-critic` scorecards → single number exposed on /system/ai-cost + top-strip. "Nick-quality: 8.3/10 (7d avg)".
- [ ] **W6.10** Shadow mode flag: `lib/ai/shadow-mode.ts` exists — wire a toggle in `/system/power` that runs next-gen prompt/model in shadow, logs scorecard diff, never shows user.

**Commit:** `refactor(ai): tools.ts → 12 files + chat route pipeline + prompt versioning + tests`

---

### WAVE 7 · TYPE + STRICT — est 8h

- [ ] **W7.1** Typing sweep (top offenders):
  - `components/chat/nick-message.tsx` (23 anys) — type tool-result payloads via discriminated union keyed by `toolName`.
  - `app/api/command/data/route.ts` (17 anys).
  - `app/api/ai/chat/route.ts` (12 anys).
  - `lib/brain/conversation-memory.ts` (11 anys).
  - `lib/ai/tools.ts` (9, already split in W6).
  - `lib/ai/nick-agent.ts` (6).
- [ ] **W7.2** Flip `tsconfig.strict = true`. Expect ~400–700 errors. Categorize:
  - `noImplicitAny` — fix via explicit types.
  - `strictNullChecks` — fix via narrowing or `!` asserts (sparingly).
  - `strictFunctionTypes` / `strictBindCallApply` — usually auto-fixable.
- [ ] **W7.3** Migrate file-by-file via `// @ts-strict-ignore` escape hatch; track progress in `docs/STRICT-MIGRATION.md`.
- [ ] **W7.4** Target: 100% strict in 2-3 sub-waves.

**Commit:** `chore(types): strict-null migration wave 1 — top 6 files + strict=true`

---

### WAVE 8 · `lib/` RESTRUCTURE — est 6h (do after W3 cleanup)

See `docs/ARCHITECTURE.md` target layout. Execute as pure move + re-import.

- [ ] **W8.1** Write codemod `scripts/lib-restructure.ts` (ts-morph) that moves files AND updates all `import "@/lib/*"` paths.
- [ ] **W8.2** Dry-run; diff-review; apply.
- [ ] **W8.3** Verify `tsc --noEmit` + `vitest run` still green.
- [ ] **W8.4** Commit atomically with move-only diff.

**Commit:** `refactor(lib): subdomain restructure — brain/memory, brain/learning, ai/chat, ai/tools, services/personal, services/business, platform/*`

---

### WAVE 9 · UX / ALIVE LAYER — est 10h

Alive layer isn't optional; it's the differentiator. Power + control IS the UX.

- [ ] **W9.1** **Global Cmd+K** extension: add scoped search across brain + tasks + journal + chat + pinned + commitments + decisions + people + knowledge + docs. Fuzzy match + recency-weighted + Nick-rerank top-5.
  - **Power knob:** filter chips (`@tasks`, `@brain`, `@chat`), date range, source attribution.
- [ ] **W9.2** **Keybind cheatsheet** (`?`): overlay with all shortcuts by category, searchable.
- [ ] **W9.3** **Vim-style navigation:** `g h` = home, `g c` = chat, `g b` = brain, `g t` = tasks, `g j` = journal, `g k` = knowledge, `g s` = system, `g d` = devices, `g f` = financial, `g y` = body.
- [ ] **W9.4** **Pinned everything:** `Cmd+Shift+P` pins current view to Ultron.
- [ ] **W9.5** **Dopamine micro-animations:** completion haptic (mobile) + visual (spring + confetti spark) — subtle, not cartoonish.
- [ ] **W9.6** **Shimmer skeletons** on every data-backed component (replaces static "Loading…").
- [ ] **W9.7** **MODE-driven ambient aura:** background gradient shifts per MODE (BATTLE = faint red pulse, SURGICAL = gold, RECOVERY = blue, SHUTDOWN = dim).
- [ ] **W9.8** **Number roll-up** on every metric change (200ms count-up via rAF).
- [ ] **W9.9** **Sparklines everywhere:** any number with ≥7 history points auto-sparkline.
- [ ] **W9.10** **Freshness chips:** `<FreshChip lastAt={...}/>` renders "12s ago" → green, "3h ago" → amber, ">24h ago" → red.
- [ ] **W9.11** **Provenance chips:** every piece of AI content shows `[brain:ID]` / `[tool:name]` / `[ingest:gmail]` clickable to source.
- [ ] **W9.12** **Streak cascades:** habit + journal + etc. streaks trigger a 400ms glow on the pulse chip.
- [ ] **W9.13** **Panic button** (`Cmd+Shift+0`): instant quiet-mode toggle + kill Nick streaming + dim UI.

**Commit:** `feat(ux): global search + cheatsheet + vim nav + alive layer foundation`

---

### WAVE 10 · DOCS REBUILD — est 4h

- [ ] **W10.1** `README.md` rewrite: 5-min onboarding, architecture one-pager, dev/build/deploy commands, link to everything else.
- [ ] **W10.2** `docs/ARCHITECTURE.md`: subsystem diagram + module boundaries + data flow.
- [ ] **W10.3** `docs/DATA-MODEL.md`: ERD of 69 models (mermaid), log-model retention table, relation map, common-query cookbook.
- [ ] **W10.4** `docs/RUNBOOK.md`: cron catalog, error triage flowchart, secret rotation, backup/restore, incident playbook.
- [ ] **W10.5** `docs/SECURITY.md`: auth model, public-route list, secrets policy, CSP, rate limits.
- [ ] **W10.6** `docs/AGENT-CONTRACT.md`: what every future agent needs to know — state, conventions, kill-switches, in-flight waves, where to look first.
- [ ] **W10.7** `docs/KEYBINDINGS.md`: every shortcut.
- [ ] **W10.8** `docs/ULTRON-VISION.md`: update OR mark superseded; reconcile with v10.4 collapse.
- [ ] **W10.9** `ROADMAP.md`: trim to next 3 waves only; move shipped to CHANGELOG.

**Commit:** `docs: rebuild README + architecture + data model + runbook + security + agent contract`

---

### WAVE 11 · ONBOARDING + POWER PANEL — est 4h

- [ ] **W11.1** First-run flow: detect empty state → show "Let Nick ingest your life" wizard (Drive + Gmail + Calendar permission + brain seed).
- [ ] **W11.2** Daily dashboard empty states: every zone has a friendly "Nothing yet. Here's why + how to populate."
- [ ] **W11.3** `/system/power` master panel (from W2.11): consolidate every knob into one place with big clear sections:
  - Crons (pause all / per-cron)
  - AI (cost cap / provider override / quiet mode / strict mode)
  - Devices (kill bridge / reset queue)
  - Data (pause retention / emergency export)
  - Nick (confidence threshold slider / persona override / shadow mode)
- [ ] **W11.4** "Nothing missing" page (`/system/gaps`): lists every coded-but-not-surfaced thing — unscheduled crons, orphan components, unused env vars, models without recent writes, routes not referenced. Automated discovery via a scan script.

**Commit:** `feat(ux): onboarding + empty states + power panel + gaps surface`

---

### WAVE 12 · META-INTELLIGENCE (the devastating-lead layer) — est 6h

Ideas the user doesn't know to ask for. These differentiate from every other "personal OS":

- [ ] **W12.1** **"Did Nick get better this week?"** — rolling AI quality chart: output-critic scorecard 7d/30d trend, reply-gate override rate, fact-check failure rate. Exposed at top of `/system/ai-cost`.
- [ ] **W12.2** **Decision drift scoreboard** — for every `MasteryDecision`, track whether subsequent behavior matched the decision. % "stuck with it" per week. Displayed in Brain.
- [ ] **W12.3** **Ghost Nour** — trained on past decisions/journal/calibration samples. Predicts what past-Nour would have done in current situation. Shown alongside Nick's recommendation on important decisions.
- [ ] **W12.4** **Anti-pattern library** — explicit log of "I tried X, it failed, reason Y". Surface when current intent matches historical failure.
- [ ] **W12.5** **Weekly self-debate** — Sunday ritual: Nick generates 3 pointed questions about the week. Nour answers in voice/text. Persisted as `SessionReport`.
- [ ] **W12.6** **Energy × output plot** — body score × tasks-completed × journal-mood scatter with rolling-regression line. Optimal-zone shading.
- [ ] **W12.7** **"The one thing" engine** — every morning, Nick picks ONE action that would most move the needle based on overdue commitments × blind-spots × energy forecast. One line, no menu.
- [ ] **W12.8** **Forgotten-thread resurrection** — brain dumps / captures >7d with unresolved action items re-surface once.
- [ ] **W12.9** **Bet calibration board** — per-domain Brier score for Nick's predictions. Forces Nick to commit probabilities, tracks reality, calibrates over time.
- [ ] **W12.10** **Prompt performance leaderboard** — A/B test prompt versions (W6.3), show win rates.

**Commit:** `feat(meta): 10 devastating-lead intelligence surfaces`

---

### WAVE 13 · PERF + HARDENING — est 4h

- [ ] **W13.1** Bundle analysis: `next build --profile` → flag any route over 500KB client JS.
- [ ] **W13.2** Cold-start budget: `/api/ai/chat` first-byte under 800ms p95.
- [ ] **W13.3** Dynamic imports on heavy deps (`@react-pdf/renderer`, `mermaid`, `recharts`).
- [ ] **W13.4** Redis layer review: confirm `REDIS_URL` set prod-side; every cache reads Redis first, falls back to in-memory, falls back to DB.
- [ ] **W13.5** Rate-limit middleware audit: `/api/ai/chat`, `/api/ai/chat/prefetch`, webhooks — all behind `lib/rate-limit`.
- [ ] **W13.6** Idempotency keys: webhook routes + Telegram + device commands.

**Commit:** `perf: bundle analysis + dynamic imports + cache layer review`

---

### WAVE 14 · FINAL COMMIT + DEPLOY — est 1h

- [ ] **W14.1** Run full local build (`pnpm run build`).
- [ ] **W14.2** Run all tests.
- [ ] **W14.3** Run endpoint smoke against local server.
- [ ] **W14.4** Push to `codex/ollama-local` (CI mirrors to `statenour-master`).
- [ ] **W14.5** Verify autonicks.com live; click-test every `/system/*` page.
- [ ] **W14.6** Update `CHANGELOG.md` with v11.0 block.
- [ ] **W14.7** Update `ROADMAP.md` moving all v11 items to shipped.
- [ ] **W14.8** Memory snapshot: update `C:\Users\nourd\.claude\projects\C--\memory\truth_os.md` with new state.

---

## 3 · Checkpoint log

> Append one line per commit. Future agents read this first to find "where are we?".

```
[x] 2026-04-21 21:05 W1  foundation            → 1177323
[x] 2026-04-21 22:25 W4  cron triage           → 8f15929
[x] 2026-04-21 23:00 W2  system pages          → 29dede9
[x] 2026-04-21 22:50 W5  retention (partial)   → 5fa4e2e
[x] 2026-04-21 23:15 W10 docs                  → 7fe1993
[x] 2026-04-21 23:25 W11.3 power panel         → aade9e3
[x] 2026-04-22 08:40 W6  tools.ts catalog      → TOOL_CATALOG(113) + schema fingerprint snapshot + contract tests
[~] 2026-04-22 08:55 W12 meta-intelligence     → Nick-quality trend (W12.1) + anti-pattern library (W12.4) live · decision-drift + Ghost Nour pending
[~] 2026-04-22 09:45 W9  Cmd+K + alive UI      → ⌘K extended w/ System Ops group · vim nav expanded to system deck · cheatsheet updated
[ ] 2026-04-22 __:__ W5.3 schema relations     → 10 @relation + migration
[x] 2026-04-22 09:40 W3  devices surface       → /system/devices + /api/system/devices + agent-liveness banner + pulse status-case fix
[ ] 2026-04-22 __:__ W7  strict-null (partial) → incremental per-file migration
[x] 2026-04-22 09:50 CI bugfix                 → prisma format drift-guard fixed (unblocks mirror → master) · 5786e0a
[x] 2026-04-22 10:05 CI hardening               → actions/checkout+setup-node v5→v4 · dropped fragile tsx inline · scripts/sync-master.sh · 6553bca
[x] 2026-04-22 10:10 prod sync                   → manual sync advanced master by 323 commits · Vercel deploying v11 · divergence = 0
[x] 2026-04-22 __:__ W1.8 lockfile fix            → deleted package-lock.json (−19,257 lines) · removed npm/pnpm auto-detect ambiguity that blocked preview deploys from applying the ai@6.0.162 patch · 48ac7d4
[x] 2026-04-22 __:__ prod verification            → all 9 v11 routes respond 401 on autonicks.com (crons · errors · actions · ai-cost · quality · anti-patterns · devices · power · pulse)
[ ] 2026-04-21 __:__ W11 onboarding + power
[ ] 2026-04-21 __:__ W12 meta-intelligence
[ ] 2026-04-21 __:__ W13 perf
[ ] 2026-04-21 __:__ W14 ship
```

---

## 4 · Resume-for-next-agent checklist

If you're picking this up mid-way, do this before editing:

1. `cd C:/Users/nourd/NOUR-OS/apps/statenour-os`
2. `git status` — note uncommitted changes; either commit them under current wave or stash with clear label.
3. Read **§0 Reality snapshot** above and run the same commands to verify nothing shifted (`git rev-list --left-right --count origin/statenour-master...codex/ollama-local`, `npx tsc --noEmit`, `npx vitest run`).
4. Read `docs/AGENT-CONTRACT.md` (when it exists, after W10.6).
5. Find first unchecked `[ ]` in Wave ordering above. Resume there.
6. Never skip waves. If a wave is too big, break into W-X.Y sub-commits — but don't leapfrog to "exciting" work before foundation holds.
7. Every commit: checkpoint log entry + wave progression update in this file.
8. Never push to `statenour-master` manually — the mirror workflow handles it.

---

## 5 · Secrets / history audit notes

*(fill in during W1.10)*

- [ ] `.gitignore` coverage of all `.env*` files
- [ ] `local-agent/.ring_token` git-history check
- [ ] `local-agent/.env` git-history check
- [ ] Any API key ever committed? (scan history)

---

## 6 · Open questions + assumptions (resolve as we go)

- **Vercel production branch:** UNVERIFIED (no token). **Assumption for now:** `statenour-master` per MASTER-CONTEXT (Apr 12). W1.1 resolves.
- **Anthropic provider:** Is `@ai-sdk/anthropic` referenced at runtime? W6.8 decides.
- **Local-agent fate:** revive vs retire. W3.2 decides.
- **Log-model dedup** (`StateLog` / `SituationLog` / `SessionReport`): merge or keep? W5.5 decides.
- **package-lock.json:** delete safely? Assumption: pnpm is source of truth (memory confirms `pnpm run build:local`). W1.8.

---

## 7 · Things I added beyond the user's list (flagged so nothing surprises)

- W2.6–W2.11: 6 additional /system pages beyond the 4 asked.
- W2.12: top-strip telemetry.
- W3.3: device bridge hardening.
- W4.1–W4.3: cron config manifest + generator + verifier.
- W4.5: cron wrapper for `CronJobLog`.
- W5.5: log-model dedup.
- W5.6: timestamp audit.
- W5.7–W5.8: backup + restore.
- W6.2: chat route pipeline split (not just tools.ts).
- W6.3: prompt versioning.
- W6.9: Nick quality metric.
- W6.10: shadow mode wiring.
- W9 entire wave: alive layer + keybinds + cmdk extension + micro-animations + panic button.
- W11.4: "Nothing missing" page.
- W12 entire wave: 10 meta-intelligence surfaces.
- W13 entire wave: perf hardening.

**Why these belong:** each is a concrete power knob, visibility gain, or "devastating lead" differentiator. None is vanity.

---

*End of v11.0 plan. Live edits continue in v11.1 below.*

---

# v11.1 MEGA WAVE · 2026-04-22 — The Devastating Lead Continued

> **Kickoff:** Nour explicitly requested a comprehensive todo that "doesn't leave out a single detail," aggressive execution, deploy-in-big-batches with regular checkpoints for universality. Reference: today's verbatim brief (stored in `docs/BUSINESS-LANDSCAPE.md` + `.claude/projects/memory/business_vision.md`).
>
> **Rules for this wave:** Every task below has (a) a clear verification step, (b) a commit message template, (c) a rollback plan if applicable. Execute top-to-bottom unless a task is blocked on external input (flagged as 🚧). Checkpoint = commit after each meaningful unit, push in batches when stable.
>
> **Current state snapshot (verified 2026-04-22 02:50Z):**
> - Prod HEAD: `aae0186` on `codex/ollama-local` — all today's fluidity + cleanup work live
> - Typecheck: 0 errors · tests: unknown (not run this session) · build: unverified this session
> - Neon quota: upgraded, no longer exhausted
> - Consolidate cron: first green run expected tonight 10pm ET (a9863bc applied)
> - Retired prisma shim hits per chat turn: 0 (down from ~14)
> - vercel.json: `statenour-master` preview disabled

## v11.1 MEGA WAVE TASK LIST

### ▸ BATCH A · ROOT-CAUSE REMAINING BUGS (ship tonight if possible)

- [ ] **A1 · `/api/skills` + `/api/brain/maturity` real error** (depends on Nour reloading /brain after `35b932f` deploy)
  - Verification: Nour pastes the real status code + body from the new diagnostic ErrorCard.
  - Hypothesis order: (i) auth-cookie timing on cold cache, (ii) Neon quota silent hit, (iii) apiHandler middleware error.
  - Rollback: n/a — root-cause fix.

- [ ] **A2 · Cron fleet triage — top 5 failing jobs**
  - Extend `scripts/check-cron-log.ts` to a fleet scan: aggregate last-7d CronJobLog by jobName + count failures + sample last error.
  - Write report to `docs/cron-health-2026-04-22.md` with per-job fix spec.
  - Fix the top 5 in priority order, commit each.
  - Verification: `SELECT jobName, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS fails FROM "CronJobLog" WHERE "createdAt" > NOW() - INTERVAL '7 days' GROUP BY jobName ORDER BY fails DESC`.

- [ ] **A3 · Delete RETIRED_MODELS shim in `lib/prisma.ts`**
  - Full repo grep for any remaining `prisma.X` where X ∈ RETIRED_MODELS → confirmed 0 after `aae0186`.
  - Delete `makeRetiredShim` + `RETIRED_MODELS` array + for-loop that installs proxies.
  - Keep `types/prisma-compat.d.ts` for a grace period (48h).
  - Verification: `pnpm typecheck` + `pnpm test` both green after removal.
  - Rollback: one-line revert.

- [ ] **A4 · Auth-cookie / session-timing hardening on mount-fetching panels**
  - Find all client components that `fetch("/api/...")` inside useEffect without awaiting session.
  - Gate each fetch on session-ready signal.
  - Affected (per grep): SkillLibraryPanel, BrainMaturityHeader, IdentityPanel, BeliefsPanel, ContradictionResolutionPanel, QualitativeIdentityPanel, NudgePanel, ToolTelemetryPanel, PinnedContextPanel, SuggestionTelemetryPanel.
  - Add a shared `useAuthedFetch` hook that wraps this pattern.
  - Verification: open /brain on a fresh incognito tab — no fetch-failed toast before first token.

### ▸ BATCH B · PERFORMANCE + ARCHITECTURE

- [ ] **B1 · Per-engine tier gating in `system-prompt.ts`**
  - Problem: `buildSystemPromptUncached` calls ~29 brain engines in `Promise.all`. `detectTopicTier()` computes tier but several engines ignore it.
  - Fix: Each `getXContext(tier)` should early-return `""` for irrelevant tiers. Build a matrix: engine × tier.
  - Verification: log engine-count per tier. Confirm "hey" only loads core engines (~5–7), not 29.
  - Win: 40–60% fewer DB + memory ops per casual chat turn.

- [ ] **B2 · Chat page decomposition into sub-hooks**
  - Source file: `app/(mastery)/chat/page.tsx` — 2,700 lines, 17 useEffects, ~40 useStates.
  - Extract:
    - `useChatTransport(apiPath)` — transport + body ref + header readers
    - `useChatPersonality(initialOverride)` — personality state + server-sync guard (safe version of the reverted one)
    - `useChatStall(messages, isStreaming)` — stall detection + auto-retry
    - `useChatHaptics(isStreaming)` — send + end haptic
    - `useChatKeyboard({ setInput, newChat, ... })` — Cmd+K/F/shortcuts
    - `useStreamingError(error, status)` — stale-error clear + cadence guard
  - Commit per hook.
  - Verification: page renders identically, ts passes, no new warnings in DevTools.

- [ ] **B3 · Virtualized message list**
  - Install if missing: `@tanstack/react-virtual`. Use on the content container inside use-stick-to-bottom's scrollRef.
  - Budget: only render messages within viewport ± 5. For 500-message convos this is a 10x+ perf win.
  - Gotcha: virtualization + stick-to-bottom must coordinate on total content height — Streamdown's memoized blocks make this simpler.
  - Verification: open a long convo, scroll top to bottom, FPS stays above 55 in DevTools perf monitor.

- [ ] **B4 · SSE reconnect hardening**
  - Current: `useStallDetection` kicks in at 15s silence → auto-retry → the 15s window is silent.
  - Target: 2s heartbeat ping · resumable stream (preserve partial response across reconnect) · silent banner "reconnecting…" within 3s of drop.
  - Server: emit a ping frame every 2s during stream. Client: watch for ping absence, reconnect via `AbortSignal` on transport.
  - Verification: unplug LAN mid-stream for 5s → chat resumes without losing tokens.

- [ ] **B5 · Server-side X-Persona auto-sync — safe version**
  - Prior attempt (5aef1a6) caused render loop; reverted in a5796d5.
  - New pattern: `useEffect` keyed on `lastAssistantMessageId` (not every response), with a ref that records last-seen persona and only calls `setPersonality` when the value CHANGES.
  - Effect dep array: `[lastAssistantMessageId]` only. No dependency on transport or fetch wrapper.
  - Verification: send a code question → Builder mode activates after assistant finishes → BuilderSandbox opens on desktop. Send a personal question → Master mode. No loops.

### ▸ BATCH C · BUSINESS CORRECTNESS

- [ ] **C1 · `queryNick()` audit — replace retired business prisma refs**
  - Background: the Apr cleanup removed `prisma.customer/lead/job/quote/...` calls but many callers expected REAL data (on nickstire.org) not empty arrays.
  - Audit: for every file in the `aae0186` diff, check if the replaced call was "nice-to-have" (empty-array-is-fine, e.g. chat pulling aux context) or "load-bearing" (empty-array-breaks-the-feature, e.g. revenue card).
  - Load-bearing ones must use `queryNick(...)` — the cross-ring query helper.
  - Also audit: what `queryNick` actions exist? Read `lib/nickstire/query.ts`. Extend with new actions as needed (leads_open, invoices_today, estimates_aging, etc.).
  - Verification: Nick chat: "how many open leads?" → returns real count, not "none" or blank.

- [ ] **C2 · Line-of-cars headline metric surfaced top-of-fold**
  - Primary business metric. Per `BUSINESS-LANDSCAPE.md` rank #1.
  - New card component `<CarsTodayCard>`. Render at top of `/` (HQ) and in Settings → System Ops health group.
  - Source: `queryNick("cars_today")` returning `{ invoicesToday, walkInsToday, dropOffsToday, deltaVs7d, hourlyHeat: number[] }`.
  - Alive element: pulsing count that ticks up when a new invoice lands (data-change event).
  - Verification: see a live number on autonicks.com/ when an invoice closes on nickstire.

- [ ] **C3 · Estimate→Invoice conversion tracker (the critical gate)**
  - Per `BUSINESS-LANDSCAPE.md` rank #4.
  - Card in HQ: this week's conversion %, previous week delta, aging-estimate leaderboard (who to chase first).
  - Action buttons per row: "Call", "Send follow-up SMS", "Mark lost".
  - Verification: every aged estimate has a working action that logs an activity.

### ▸ BATCH D · POWER + CONTROL SURFACES

- [ ] **D1 · Builder Sandbox — action buttons**
  - Current: info-only (deploys, repos, files).
  - Add:
    - "Open in VS Code" → `vscode://file/{path}` URL on file-list click
    - "Rollback deploy" → calls Vercel API to promote previous ready deploy (confirm modal)
    - "Clone commit locally" → copies `git checkout <sha>` to clipboard
    - "Run `pnpm typecheck`" → fires via remote build webhook OR just copies the cmd
  - Verification: each button visible + functional.

- [ ] **D2 · Speaker / ambient-listening mode**
  - Wake word already wired in `useWakeWord`.
  - Missing: on wake → start continuous listen → Nick replies via TTS with audio-ducking (lower browser media volume while TTS speaks).
  - UI: big mic button on HQ with a persistent "ambient" toggle. While ambient, a faint pulse ring.
  - Verification: phone on the counter, say "Hey Nick, revenue today" — get a spoken reply, other audio ducks.

- [ ] **D3 · Client-side error telemetry**
  - Add `components/ui/error-boundary.tsx` top-level boundary.
  - `window.addEventListener("error", …)` + `unhandledrejection` → POST to `/api/errors` (new route) with stack, userAgent, URL, session ID.
  - Backend: store in `StateLog` with `type="client_error"`, surface in `/system/errors` page.
  - Verification: throw a test error from DevTools console → row appears in /system/errors within 30s.

- [ ] **D4 · Calibration onboarding (bet/prediction card)**
  - Prior session Nour said "I don't understand this bet."
  - Empty-state for `/system/calibration`: short explainer ("Nick predicts outcomes. Grade them → trains his calibration.") + sample bet + CTA.
  - First-time tooltip on any bet card (dismissible, persists in localStorage).
  - Verification: clear localStorage, open /system/calibration → see explainer.

- [ ] **D5 · Power Panel — freshness + provenance on every surface**
  - Rule from guiding philosophy: "every data surface shows freshness + provenance."
  - Audit every card on `/brain`, `/system/*`, HQ — add "Nns ago · source: X" if missing.
  - Shared helper `<FreshnessChip lastFetchedAt source />`.
  - Verification: grep for `<GlassCard` → each has either a timestamp or an explicit exemption comment.

### ▸ BATCH E · DYNAMIC / ALIVE LAYER (Nour: "less static and boring, more alive")

- [ ] **E1 · Micro-animation audit** — every state transition 150–250ms. Spring or cubic-bezier, no linear.
- [ ] **E2 · Subtle pulses / breathing on live surfaces** — header dots, Nick orb, "Live" labels.
- [ ] **E3 · Sparkline on every historical number** — shared `<Sparkline />` component, 60×18px.
- [ ] **E4 · Count-up / count-down animations** — `<AnimatedNumber />` with 240ms rAF easing.
- [ ] **E5 · Empty states never static** — meaning + why + unlock-path + motion on every empty card.

### ▸ BATCH F · META-INTELLIGENCE (Nour's "devastating lead")

- [ ] **F1 · Cross-session memory continuity surface** — `/brain/continuity` page.
- [ ] **F2 · Correlation alarm clock** — every 6h, find new cross-domain r>0.7 correlations.
- [ ] **F3 · Decision-quality drift detector** — weekly rolling trend, alert on 15% drop.
- [ ] **F4 · Prediction-streak tracker** — per-category accuracy streaks with streak-break notif.
- [ ] **F5 · Blind-spot auto-surface** — high-conf blind spots auto-pin to HQ.

### ▸ BATCH G · HARDENING + INFRASTRUCTURE

- [ ] **G1 · Browserbase browser-use agent scaffold** 🚧 (blocked on `BROWSERBASE_API_KEY` env)
- [ ] **G2 · Snap Financing BNPL wiring** — verify rendered on estimate SMS.
- [ ] **G3 · `.env.example` audit** — regenerate from current code usage.
- [ ] **G4 · CI setup** — `.github/workflows/ci.yml`: typecheck + test + build + prisma-drift.
- [ ] **G5 · Pre-push hook install** — from existing `scripts/pre-push-check.sh`.
- [ ] **G6 · Devices — revive or retire** — 20/21 offline; decide outcome.

### ▸ BATCH H · DOCS + HANDOFF

- [ ] **H1 · Update `business_vision.md` memory** — dated reinforcement block.
- [ ] **H2 · Update `feedback_business_dna.md` memory** — timestamp reinforcement.
- [ ] **H3 · Add `feedback_verify_don_t_assume.md`** memory if missing.
- [ ] **H4 · Update `docs/AGENT-CONTRACT.md`** — post-v11.1 status subsection.
- [ ] **H5 · CHANGELOG.md** — add v11.1 entry.
- [ ] **H6 · `docs/BUSINESS-LANDSCAPE.md`** — keep permanently current (created this session).

### ▸ BATCH I · LONG-HORIZON RESEARCH (log for later, not this wave)

- [ ] **I1 · Multi-tenant RLS** — if NOUR OS ever opens to others.
- [ ] **I2 · AI provider cost-class routing** — route classifiers to cheap providers.
- [ ] **I3 · Neon budget dashboard** — query count, slow-query log, row-scan totals.
- [ ] **I4 · Uber/Lyft API partnership** — ride credit for tire drop-offs.
- [ ] **I5 · Competitor-price scraper revival** — AutoLabor + DKTire scrapers.

---

## Execution cadence

**Checkpoint rule:** commit after every meaningful unit, push in batches of 3–5 when green. Every push is a handoff point.

**Verification rule:** `pnpm typecheck` must pass before commit; `pnpm test` when tests are affected; build verification on big changes (virtualization, engine gating, etc).

**Commit message template:**
```
feat|fix|chore(scope): one-line summary

· What changed (2–4 bullets)
· Why it matters
· Verification steps

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

*End of v11.1 mega-wave plan. Start date: 2026-04-22. Target: complete A–G in batches; H parallel/ongoing; I future-file.*
