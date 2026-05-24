# Runbook · statenour

Operational playbook. When something breaks or drifts, start here.

> statenour runs as the `statenour-web` service in the
> `nourdean22/MAINnicks-tire-autoNEW` monorepo (`apps/statenour/`),
> deployed by **Railway** from branch `main`. Prod URL:
> `bdnick.info`.

---

## Fast triage

```
something's wrong
     │
     ├── statenour prod won't load
     │       → /api/system/heartbeat   (public)
     │       → Railway dashboard (natural-appreciation project)
     │       → Neon status page
     │
     ├── Nick is silent / errors out
     │       → /system/deployment-truth  (v10 — single-pane state of build + env + cron)
     │       → /system/errors   (look for recent prisma/venice errors)
     │       → /system/ai-cost  (check error rate + burn rate)
     │       → /system/command-center  (NICK Prime mode + parity health)
     │       → /system/crons    (is brain-intelligence failing?)
     │       → verify at least one AI_PROVIDER_KEY is set (pnpm check:env)
     │       → v9.1.27 auto-rotates failed providers for 60s (cross-request,
     │         sticky window). Recently-failed providers skipped, then retried
     │         after window. v10 streamWithFallback adds same-turn rotation
     │         pre-first-token (4 attempts: venice → ollama → openai → anthropic).
     │
     ├── a cron keeps failing
     │       → /system/crons → find it → open the last error
     │       → kill switch (ON/OFF toggle) while you debug
     │       → fix + trigger manually via "run" button
     │
     ├── device bridge dead
     │       → /api/health devices count vs /api/system/pulse
     │       → check local-agent/agent.log on the Windows box
     │       → if agent dead, restart via install-service.ps1
     │
     ├── numbers look stale
     │       → pnpm check:env      (is DATABASE_URL right?)
     │       → pnpm check:crons    (is data-cleanup + refresh-identity scheduled?)
     │       → check SystemMetric fresh-row timestamps
     │
     └── mystery symptom
             → /system (top-level) — look at all drill-downs at once
             → /system/deployment-truth (build SHA + schema drift + env + cron health)
             → /system/repos (any sister repo dead? GitHub last-commit feed)
             → grep git log for the feature name
             → check /system/schema-history for recent prisma db push
```

---

## Environment setup checklist

When bringing the Railway service online or resetting a machine:

1. **Required env vars** — all must be set for production:
   ```
   DATABASE_URL, DIRECT_URL
   AUTH_SECRET, AUTH_GOOGLE_CLIENT_ID, AUTH_GOOGLE_CLIENT_SECRET, AUTH_ALLOWED_EMAIL
   CRON_SECRET, STATENOUR_SYNC_KEY
   VENICE_API_KEY                    (or at least one other AI provider)
   ```
   Verify with `pnpm check:env`.
2. **Runtime env** (degrades gracefully if missing):
   ```
   RESEND_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TWILIO_*
   BRIDGE_API_KEY, REDIS_URL, VAPID_PUBLIC_KEY/PRIVATE_KEY
   GOOGLE_PLACES_API_KEY, OPENWEATHER_API_KEY, APOLLO_API_KEY
   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
   NEXT_PUBLIC_APP_URL
   ```
3. **Platform-set** (Railway/Node supplies automatically — never hand-set):
   ```
   NODE_ENV, RAILWAY_ENVIRONMENT, RAILWAY_GIT_COMMIT_SHA
   ```
4. Full spec: [`lib/env.ts`](../lib/env.ts). Template: [`.env.example`](../.env.example).

---

## Cron catalog

Source of truth: [`config/crons.ts`](../config/crons.ts) — the complete
cron catalog. Verified via `pnpm check:crons` when the manifest
changes. Each entry is `active` (on a schedule), `folded` (runs inside
a parent cron — most fold into `mega-evening`), or `retired`.

> The table below covers the high-traffic actives. For the complete
> manifest with mode (active / folded / retired), schedule, foldedInto
> parent, and deletion-window dates, read `config/crons.ts` directly
> or run `pnpm exec tsx scripts/verify-crons.ts` for a live print.

| Category | Cron | Schedule (UTC) | Purpose |
|---|---|---|---|
| **compose** | `mega?slot=morning` | 9:00 | morning composite — pulse + brief + daily-report + predict |
|  | `mega?slot=evening` | 2:00 | evening composite — reflect + consolidate + weekly-digest eligibility |
| **ingest** | `ingest-gmail` | 8:00, 20:00 | Gmail pull |
|  | `ingest-calendar` | 8:15 | calendar pull |
|  | `ingest-drive` | Sun+Wed 2:30 | Drive pull |
|  | `knowledge-sync` | every 6h | knowledge base normalization |
| **brain** | `brain-intelligence` | 2:00 | nightly intelligence engine pass |
|  | `brain-cycle` | every 3h | continuous decay + memory-manager |
|  | `embed-backfill` | :30 each hour | vector embedding backfill |
|  | `distill-sessions` | every 3h + 30m | fold idle chat sessions → summaries |
|  | `extract-skills` | Sun 3:00 | weekly skill harvest from DONE tasks |
|  | `refresh-identity` | 4:30 | roll 8-axis self-model forward |
|  | `auto-calibrate` | 2:30 | belief recalibration (replaces manual START) |
|  | `auto-linker` | 4:00 | link brain memories by relation + embedding |
|  | `predict` | 6:00 | morning bet-desk predictions |
|  | `think` | every 3h | contradictions + identity + causal + env |
|  | `reflect` | 22:00 | daily reflection engine |
| **signals** | `drift-check` | 20:00 | drift detection |
|  | `watcher` | every 3h | anomaly scan |
| **hygiene** | `pin-hygiene` | Sun 6:00 | stale-pin review |
|  | `backlog-triage` | 7:00 | task backlog scrub |
|  | `stale-tasks` | 17:00 | flag stale tasks |
|  | `data-cleanup` | Sun 3:00 | retention policy enforcement |
| **review** | `weekly-review` | Sun 2:00 | week-in-review note |
|  | `weekly-digest` | Sun 23:00 | weekly digest email |
|  | `operating-rhythm` | 12:00, 16:00, 21:00 | thrice-daily rhythm check |
|  | `daily-report` | 11:30 | yesterday recap |
|  | `journal-checkin` | 1:00 | proactive journal-ask via Telegram |
| **alert** | `error-telegram-push` | every 5m | fatal/error rows → Telegram |
|  | `alert-telegram-push` | every 15m | drift/cost/schema alerts → Telegram |

**Folded** (run inside a parent cron, no independent schedule). The big
mega-evening consolidator absorbs most of them (consolidate, learn,
voice-clone-train, memory-bloat-watch, image-rot-scan, schema-drift-
watch, storage-quota-watch, audit-retention, creation-spike-detect,
update-spike-detect, stale-conversation-archive, brain-bus-probe,
brain-bus-backfill, etc.). Plus intelligence → brain-intelligence.
See `config/crons.ts` for the full `mode: "folded"` set with parent
references.

**Retired** — the device crons (`device-command-reap`, `device-sync`,
`device-health`, `status`) and `notification-sender` were deleted
with their route files; the device subsystem retirement was finalized
earlier. The `verify-crons.ts` script warns when any remaining
`mode: "retired"` cron is past its deletion-window date.

**Add / change a cron:**
```bash
# 1. edit config/crons.ts (the single source of truth)
# 2. if new, scaffold the route
mkdir -p app/api/cron/<name> && touch app/api/cron/<name>/route.ts
# 3. verify the manifest matches the filesystem
pnpm check:crons
pnpm typecheck
```

---

## Error triage flow

Open `/system/errors`. You'll see:
- **Fingerprints · top 20** — errors grouped by message with last-seen
- **Recent · last 50** — individual rows with expand-to-stack

Triage process:

1. **Pattern check** — is this the same root cause repeating? If count ≥ 5, it's a real bug; if = 1, likely an edge case.
2. **"→ task" button** — creates a task in `/tasks` with the error message. Keeps the bug on the backlog.
3. **Expand the row** — stack trace + JSON context. Match against git log to find introducing commit.
4. **Quick fixes:**
   - **Prisma schema mismatch** (e.g. `Expected Int, provided String`) — check the model; usually a caller bug.
   - **Venice 5xx** — check `/system/ai-cost` for burn; provider may be degraded; temporarily pin `AI_PROVIDER=openai`.
   - **Cron auth 401** — CRON_SECRET not set or mismatched; check Railway env.
   - **Unauthorized on `/api/*`** — user not in `AUTH_ALLOWED_EMAIL` allowlist.
   - **Bridge sync 401** — `STATENOUR_SYNC_KEY` mismatch between nickstire and statenour.
5. **Resolved errors** — marked via `resolvedAt` field (write pattern still manual; UI button coming in W12).

---

## AI cost management

Open `/system/ai-cost`:
- **Burn rate card** — today's cost ÷ 7d average. Green < 1.1×, amber < 1.5×, rose > 1.5×.
- **14-day trend** — if a spike lasts > 3 days, investigate.
- **By feature** — identifies which Nick surface is costing most. Common offenders: `chat`, `strategy/daily`, `weekly-review`.
- **By model** — Venice vs OpenAI mix. If OpenAI calls dominate → Venice is down → check provider health.

**Knobs available now:**
- Provider override: set `AI_PROVIDER=openai` env in Railway.
- Model override: set `VENICE_MODEL=...` or `OPENAI_MODEL=...`.
- Feature kill: temporarily comment out the feature's system-prompt inclusion.

**Knobs coming (W11 power panel):**
- Daily cost cap → refuse calls beyond cap
- Strict mode → refuse expensive calls (> $X estimate)
- Shadow mode → A/B-test new prompts without user-visible output

---

## Autonomous action audit

Open `/system/actions` when you suspect Nick is doing something
unexpected:
- **Rule leaderboard** — which rules fire most? Which have < 70% success?
- **Click a rule row** → filters recent feed to just that rule.
- **Approval filter** — `pending` needs your sign-off (W11 approval UI); `rejected` are bails; `auto` is the default silent path.
- **Expand a row** — full payload JSON + error block; see what was attempted and what it produced.

**Kill switch for a rule:** write a `BrainMemory` row
`category: "rule_control", key: <ruleName>, content: { enabled: false }`.
(Power panel UI comes in W11.)

---

## Deploy + rollback

statenour lives in the `nourdean22/MAINnicks-tire-autoNEW` monorepo at
`apps/statenour/`. Railway watches branch `main` and auto-deploys the
`statenour-web` service on every push that touches `apps/statenour/**`.

Normal path:
```
1. develop on main (monorepo)
2. pre-push hook runs: `turbo build` for the affected apps
   (catches Next.js prerender errors before Railway)
3. push to origin/main
4. Railway picks up the push (per-service watch path) and deploys
   apps/statenour → bdnick.info
```

**Emergency rollback:**
```bash
# Identify the last known-good SHA from commit history
git log --oneline origin/main

# Revert the bad commit forward (preferred — preserves history)
git revert <bad-sha>
git push
```

For an urgent rollback that can't wait for a build, use the **Railway
dashboard**: open the `statenour-web` service → Deployments → pick the
last known-good deployment → redeploy / roll back to it. Railway keeps
deployment history, so reverting to a prior build is a dashboard
action — faster than a git revert + rebuild.

---

## Database

Provider: Neon Postgres, pooled + direct URLs. Two-connection model:
- `DATABASE_URL` — pooled (PgBouncer), default for lambda reads.
- `DIRECT_URL` — direct connection, used for migrations.

### Migrations

```bash
# dev — creates + applies a new migration
pnpm db:migrate

# deploy — applies pending migrations in prod
pnpm db:migrate:deploy

# push — schema → DB without a migration (careful; skips audit trail)
pnpm db:push
```

### Schema drift

If `prisma db push` fails with legacy drift:
```bash
pnpm exec prisma migrate resolve --applied <migration_name>
```
Then reconcile. Last resort: `pnpm exec prisma migrate reset` —
**destructive, never in prod**.

### Backup

Nightly backups run on Neon (point-in-time recovery, 7 days on free
tier). Manual dump:
```bash
pg_dump $DIRECT_URL > backup-$(date -I).sql
```

### Restore

Last-resort recovery from a Neon branch:
1. Neon dashboard → Branches → create a branch from a PITR timestamp.
2. Update `DATABASE_URL` + `DIRECT_URL` in Railway env to point at the branch.
3. Redeploy. Verify.
4. Promote the branch to main (Neon UI).

---

## Auth + secret rotation

- **AUTH_SECRET rotation** — generate new: `openssl rand -hex 32`. Update Railway + local .env. Every session will need to re-sign-in (JWT strategy).
- **CRON_SECRET rotation** — generate new, update Railway. No cron interruption if done < 60s (in-flight crons use header set at start).
- **STATENOUR_SYNC_KEY rotation** — coordinate with nickstire admin env; both sides must match.
- **Google OAuth client credentials** — `AUTH_GOOGLE_CLIENT_ID` + `AUTH_GOOGLE_CLIENT_SECRET`; new client from Google Cloud Console.
- **AI provider keys** — rotate independently; app falls back through provider chain.

**Never commit secrets.** `.gitignore` covers `.env*`, `local-agent/.env`, `local-agent/.ring_token`. Audit: `git log --all --full-history -- <path>`.

---

## Incident playbook

**Severity 1 — statenour prod is down.**
1. `curl https://bdnick.info/api/system/heartbeat` — note the error.
2. Railway dashboard — check the `statenour-web` service status + logs.
3. Neon status page (if DB is the problem).
4. Recent deploy in the Railway dashboard → roll back to the last
   known-good deployment if it correlates.
5. If DB connection pool exhausted (look for `P2024`): redeploy to refresh the service.

**Severity 2 — Nick is broken but UI loads.**
1. `/system/ai-cost` — is error rate pulsing rose?
2. `/system/errors` — recent ai-chat route errors?
3. Try a different provider: set Railway env `AI_PROVIDER=openai`, redeploy.
4. If circuit breaker tripped: check `lib/ai/provider.ts` status via logs.

**Severity 3 — a cron is failing.**
1. `/system/crons` — open that cron's recent logs.
2. Kill switch it while you fix.
3. Once fixed: "run" button to manual-trigger + verify success.
4. Turn back on.

**Severity 4 — weird UX glitch.**
1. Browser console.
2. `/system/errors` for backend counterpart.
3. File task via `/system/errors` → task.

---

## Observability quick links

| Symptom | Look here |
|---|---|
| DB latency | `/system` → header status bar |
| Cron drift | `/system/crons` → summary `drifted` counter |
| Error spike | `/system/errors` → new-since-last-refresh badge |
| AI cost runaway | `/system/ai-cost` → burn rate |
| Rogue Nick actions | `/system/actions` → approval=auto + result=failed |
| Device offline | `/api/health` devices block vs `/api/system/pulse` |
| Queue backlog | `/system` page → queue pending count |
| Integration stale | `/system` page → integrations last-sync |

---

## Bug-class containments (kaizen poka-yoke ledger)

When a bug ships to prod, fix it AND add a layer that makes the
class structurally impossible. New rows go in date-asc.

| Date | Bug class | Where it manifested | What protects against it now |
|---|---|---|---|
| 2026-05-04 | Venice `<think>`-burn empty content | suggestions endpoint silently failing 100% (5+ days) | `disable_thinking` required on every Venice chat-completions call |
| 2026-05-04 | Soft-fail tools logged as success | All bridge / GitHub / Drive tools 100% "success" while emitting `{error}` | `lib/services/chat/persist-assistant-turn.ts:474` checks `result.error` not just `call.error` |
| 2026-05-04 | 8 unauth GET leaks | Conversation history readable by ID enumeration | per-handler-body auth scope check via `scripts/check-sensitive-get-auth.ts` |
| 2026-05-04 | Image attachment fallback fail | 26 chat-turn `'file part media type ' functionality not supported` / 72h | Single-source `resolveMediaType()` in `lib/ai/chat/message-fields.ts` · always returns valid MIME |
| 2026-05-04 | AI provider thundering herd | 50% emergency rate on ai-memory at 02 UTC mega-evening | `app/api/cron/mega/route.ts` concurrency limit (6 workers) via `lib/utils/concurrent.ts:withConcurrency` |
| 2026-05-04 | OpenClaw scaffolding leak | IDENTITY/SOUL/USER.md untracked at repo root | `.gitignore` entries for OpenClaw artifacts |
| 2026-05-04 | Anti-slop drift (Inter / purple gradients) | Future-risk only; baseline is /brain/link-review (DFII 15) | git-grep block in `scripts/check-anti-slop.sh` |
| 2026-05-04 | BrainMemory category abuse | 8 domains crammed into KV store; queries paid for unrelated drift | Phase-1 dual-write playbook · 5 tables extracted (ToolTelemetry, ProviderPing, ToolVerbRatio, AutonomousEvent, SemanticEdge) |
| 2026-05-04 | isInboxMission TS↔SQL drift | Two regexes for the same predicate | `tests/db/inbox-mission-drift.test.ts` · 15 fixtures asserting parity at CI |

---

## Today's session quick probes

| Want | Run |
|---|---|
| Schema-debt snapshot | `node --env-file=.env.local scripts/probe-schema-debt.mjs` |
| Embedding orphans | `node --env-file=.env.local scripts/probe-embedding-orphans.mjs` |
| Tool telemetry (real failures) | `node --env-file=.env.local scripts/probe-tool-telemetry.mjs` |
| Conversation→mission cosine | `node --env-file=.env.local scripts/probe-cosine-distribution.mjs` |
| Provider failures (last 72h) | `node --env-file=.env.local scripts/probe-provider-failures.mjs` |
| Archive backfill (39 convos) | `pnpm exec tsx scripts/backfill-conversation-archives.ts --dry-run` |
| Conversation→mission link | `pnpm exec tsx scripts/backfill-conversation-mission-links.ts --dry-run` |
| Embed orphan cleanup | `pnpm exec tsx scripts/backfill-embedding-cleanup.ts --dry-run` |
| Health all-in-one | `pnpm exec tsx scripts/health.ts` (v10.0.200) |

---

**Reconciled 2026-05-21** · infra sweep — incident/deploy/env steps
rewritten for the Railway monorepo deploy (was Vercel /
`codex/ollama-local` / `statenour-master`, all retired). If a claim in
this doc contradicts code reality, the code wins · open an issue.

---

## Retiring the `autonicks.com` Vercel ghost project · operator action

**Status:** the statenour codebase is CLEAN of live `autonicks.com`
references as of 2026-05-24 (Wave N). The only remaining drift is
the Vercel project itself, still sitting in your account doing
nothing.

**Why this matters:** abandoned Vercel projects can hold:
- env vars containing real secrets (Anthropic keys, DB URLs, Neon creds)
- a GitHub deploy hook still wired to `main` (so commits could
  silently spin up phantom builds that 500 and waste minutes)
- a custom-domain claim on `autonicks.com` that prevents reuse if
  you ever want to point that DNS elsewhere

**Pre-flight (verify before deleting):**

1. **Confirm no live consumer points there.** From your terminal:
   ```
   curl -sI https://autonicks.com/ | head -1
   curl -sI https://www.autonicks.com/ | head -1
   ```
   Both should now resolve to `bdnick.info` (the Railway custom
   domain) or fail / 404. If either resolves to a live Vercel
   deployment, STOP — there's still traffic flowing to it.

2. **Confirm DNS is detached from Vercel.** Cloudflare dashboard
   → `autonicks.com` → DNS · the `A`/`CNAME` records for `@` and
   `www` should point to Railway (`statenour-web-production.up.railway.app`),
   NOT `cname.vercel-dns.com` or `76.76.21.21`.

3. **Confirm no current callback URL uses it.** Common spots:
   - Google Cloud Console → OAuth client → authorized redirect URIs
   - Anthropic / OpenAI / Venice dashboards → webhook URLs
   - VAPI dashboard → webhook URLs
   - any third-party (Buffer, Make, Telegram bot) → callback URLs

   If any still reference `autonicks.com`, swap to `bdnick.info`
   FIRST. Then come back here.

**Delete the Vercel project (operator-only · cannot be done by
the agent):**

1. Log into `https://vercel.com/dashboard` with your account.
2. Find the project (likely named `statenour-os` or `statenour-web`
   from the Vercel-era days).
3. Project settings → "Delete Project" at the bottom of General.
4. Type the project name to confirm.

**Aftermath:** the GitHub deploy hook on that Vercel project
auto-detaches. Any env vars stored there die with the project ·
they were already decoupled from Railway. The `autonicks.com`
domain claim releases (so you can fully retire the DNS if
desired, or point it at a 301 redirect to `bdnick.info`).

**If something breaks after deletion:** unlikely · the codebase
hasn't shipped to Vercel since the Railway migration. If a
webhook 404s, it's pointing at the wrong URL · grep your vendor
dashboards for `autonicks.com` and replace.
