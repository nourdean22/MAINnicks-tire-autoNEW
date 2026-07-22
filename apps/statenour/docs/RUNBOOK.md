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
     │       → /system/errors   (look for recent prisma/provider errors)
     │       → /system/ai-cost  (check error rate + burn rate)
     │       → /system/command-center  (NICK Prime mode + parity health)
     │       → /system/crons    (is brain-intelligence failing?)
     │       → verify at least one AI_PROVIDER_KEY is set (pnpm check:env)
     │       → v9.1.27 auto-rotates failed providers for 60s (cross-request,
     │         sticky window). Recently-failed providers skipped, then retried
     │         after window. v10 streamWithFallback adds same-turn rotation
     │         pre-first-token (attempts: ollama → gemini → openai → anthropic).
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
   OLLAMA_API_KEY                    (or at least one other AI provider)
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
   AI provider + tool config (names only — VALUES are the source of truth in
   `config/ai-providers.ts`, do not pin model ids in docs):
   ```
   COHERE_API_KEY            embeddings (recall) — Cohere embed-v4.0, 1024-dim
   OPENAI_API_KEY            voice realtime (GA /v1/realtime/client_secrets) + embed fallback
   OLLAMA_MODEL              Ollama Cloud chat/reason lane model id
   OLLAMA_FAST_MODEL         Ollama Cloud fast lane (classify/extract/summary/sql)
   OLLAMA_VISION_MODEL       Ollama Cloud vision model (image chat turns)
   PERPLEXICA_CHAT_PROVIDER  perplexica synthesis provider type (openai|gemini)
   PERPLEXICA_CHAT_MODEL     perplexica synthesis model id
   GITHUB_TOKEN              Files (GitHub) tool — fine-grained, Contents: Read-only
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

Open `/system/logs`. You'll see:
- **Fingerprints · top 20** — errors grouped by message with last-seen
- **Recent · last 50** — individual rows with expand-to-stack

Triage process:

1. **Pattern check** — is this the same root cause repeating? If count ≥ 5, it's a real bug; if = 1, likely an edge case.
2. **"→ task" button** — creates a task in `/tasks` with the error message. Keeps the bug on the backlog.
3. **Expand the row** — stack trace + JSON context. Match against git log to find introducing commit.
4. **Quick fixes:**
   - **Prisma schema mismatch** (e.g. `Expected Int, provided String`) — check the model; usually a caller bug.
   - **Provider 5xx** — check `/system/ai-cost` for burn; provider may be degraded; temporarily pin `AI_PROVIDER=openai`.
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
- **By model** — Ollama vs OpenAI mix. If OpenAI calls dominate → Ollama is down → check provider health.

**Knobs available now:**
- Provider override: set `AI_PROVIDER=openai` env in Railway.
- Model override: set `OPENAI_MODEL=...` (or `OLLAMA_MODEL=...`).
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
2. `/system/logs` — recent ai-chat route errors?
3. Try a different provider: set Railway env `AI_PROVIDER=openai`, redeploy.
4. If circuit breaker tripped: check `lib/ai/provider.ts` status via logs.

**Severity 3 — a cron is failing.**
1. `/system/crons` — open that cron's recent logs.
2. Kill switch it while you fix.
3. Once fixed: "run" button to manual-trigger + verify success.
4. Turn back on.

**Severity 4 — weird UX glitch.**
1. Browser console.
2. `/system/logs` for backend counterpart.
3. File task via `/system/logs` → task.

---

## Observability quick links

| Symptom | Look here |
|---|---|
| DB latency | `/system` → header status bar |
| Cron drift | `/system/crons` → summary `drifted` counter |
| Error spike | `/system/logs` → new-since-last-refresh badge |
| AI cost runaway | `/system/ai-cost` → burn rate |
| Rogue Nick actions | `/system/actions` → approval=auto + result=failed |
| Device offline | `/api/health` devices block vs `/api/system/pulse` |
| Queue backlog | `/system` page → queue pending count |
| Integration stale | `/system` page → integrations last-sync |
| Web search never `arsenal/perplexica` | `GET /api/system/perplexica-diag` (Bearer `$CRON_SECRET`) → receipt: `health` (provider+model verification), `source`, `fallbackUsed`, `telemetry` (last success / latency / sourceCount). `sourceCount:0` + healthy config = SearXNG engines bot-blocked (see ledger 2026-07-22). |
| Browser agent "not_installed" / dead | `GET /api/browser/diagnostics` (owner-gated, open in an authed browser tab) → `{browserbase:{configured}, stagehand:{installed}, ready}`. NOTE: `railway ssh` + `require.resolve` false-negatives on Turbopack externals — trust the endpoint, not a bare node probe. Watch a run live/replay via the `browseAndDo` receipt's `replayUrl`. |

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
| 2026-07-22 | Edge-instrumentation build break | Both stagehand-bearing Railway deploys FAILED at `next build` (prod safely pinned on the old image; CLI logs for failed deploys are EMPTY — dashboard only). Next compiles `instrumentation.ts` for BOTH runtimes, so the edge pass bundled tool-embeddings → the whole tool universe → sharp; a lockfile hoisting shift made it fatal. | `if (process.env.NEXT_RUNTIME !== "nodejs") return;` first line of `register()` + `onRequestError()` — compile-time define dead-code-eliminates the edge bundle to EMPTY, immune to dependency-hoisting shape. After any merge, check `railway deployment list` — a green PR is not a deployed PR. |
| 2026-07-22 | Perplexica silent-empty (0 sources) | Chat "rarely produced arsenal/perplexica" — self-hosted SearXNG's engines (DuckDuckGo/Brave/Startpage/Google-CSE) all CAPTCHA/rate-limit Railway's datacenter IP → 0 results → 38s empty synth → silent fallback to Tavily. Config + timeout bugs masked it further. | Canonical native-API path (no MCP aliasing) + `PERPLEXICA_TIMEOUT_MS` (35s, was generic 8s) + `checkPerplexicaHealth()` provider/model verification + search-source telemetry + `GET /api/system/perplexica-diag` receipt. Root SearXNG bot-block is a datacenter-IP reality — needs an egress proxy or lean on the working Tavily/Exa fallback. |

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

## Retiring the Vercel projects · operator action

> **Reality check (2026-05-24 Wave O · post-MCP-audit):** the
> previous version of this section called autonicks.com a "ghost."
> That was wrong. Live pre-flight via the Vercel MCP + curl/DNS
> shows the `statenour-os` Vercel project is STILL SERVING a stale
> 2026-05-04 build at `autonicks.com` · DNS still points to Vercel
> anycast (`76.76.21.X`) and `www.autonicks.com` is CNAME'd to
> `cname.vercel-dns.com`. Don't delete the project first · cut
> DNS first.

**Vercel project inventory (team `nourdean22-4533s-projects`):**

| Project | Project ID | Custom domain | Last deploy | Order |
|---|---|---|---|---|
| `statenour-os` | `prj_CFa6JVJblNXaS5bIOOoLwkxh7g72` | **autonicks.com** | 2026-05-04 | last · DNS flip first |
| `nickstire` | `prj_jBUEOtkaHM7ba54Y6wCZBCsz82je` | none | 2026-05-08 (ERROR) | safe now |
| `easy-nickstire` | `prj_dGpV2VT94D7OjyPtoqm4Ugyq7akk` | none | 2026-04-13 | safe now |
| `elegant-yalow` | `prj_eHKTf7eOrNLnueQ3iiwtusmzlNYL` | none | 2026-04-14 | safe now |

The 3 "safe now" projects only have `*.vercel.app` URLs · nothing
on the public internet links to them · deleting them is risk-free.
`statenour-os` is different because of the custom-domain claim.

**Why DNS-first matters for `statenour-os`:** if you delete that
Vercel project while DNS still points to Vercel, `autonicks.com`
goes from "serving stale build" → "Vercel deleted-project page"
immediately. Old PWA installs, bookmarks, OAuth callback URLs,
email links that reference autonicks.com all break for 24-48h
until DNS propagates the new pointer. Cut DNS first.

---

### Phase 1 · DNS flip for `autonicks.com` (Cloudflare)

The agent cannot do this (account-bound destructive op). Steps:

1. Log into `https://dash.cloudflare.com` → select `autonicks.com`.
2. DNS tab · find the two records pointing to Vercel:
   - `A   autonicks.com    76.76.21.X` (root)
   - `CNAME  www  cname.vercel-dns.com` (www subdomain)
3. **Pick a path:**
   - **Option A · redirect to bdnick.info** (recommended ·
     preserves old bookmarks). Cloudflare → Rules → Page Rules ·
     add `https://autonicks.com/*` and `https://www.autonicks.com/*`
     → forwarding URL · 301 permanent → `https://bdnick.info/$1`.
     Then delete the old DNS records.
   - **Option B · park the domain.** Just delete the two DNS
     records. autonicks.com starts returning DNS NXDOMAIN. Cheaper
     but breaks any external link.
4. Verify: `curl -sI https://autonicks.com/` should now return
   either a 301 to bdnick.info (Option A) or fail with DNS error
   (Option B). NOT serve a Vercel build.

### Phase 2 · Wait 48h

Let DNS propagate + browser caches die. Most CDN+browser caches
respect TTL within 24h · 48h is the safe ceiling.

### Phase 3 · Delete the 3 dormant projects (anytime · independent)

These have NO custom domains and the latest deploys are 6-7 weeks
old. The agent cannot click "Delete" but you can do all 3 in 90 sec:

1. `https://vercel.com/nourdean22-4533s-projects/nickstire/settings/general`
   → scroll to "Delete Project" → type `nickstire` → confirm.
2. `https://vercel.com/nourdean22-4533s-projects/easy-nickstire/settings/general`
   → repeat with `easy-nickstire`.
3. `https://vercel.com/nourdean22-4533s-projects/elegant-yalow/settings/general`
   → repeat with `elegant-yalow`.

### Phase 4 · Delete `statenour-os` (only after Phase 1 + Phase 2)

After DNS flip + 48h wait:

1. `https://vercel.com/nourdean22-4533s-projects/statenour-os/settings/general`
2. Scroll to "Delete Project" → type `statenour-os` → confirm.

The `autonicks.com` custom-domain claim releases when the project
is deleted. Cloudflare DNS already points elsewhere (Phase 1) so
nothing changes from the user's perspective.

---

**Other places to audit for stale `autonicks.com` references:**
- Google Cloud Console → OAuth client → authorized redirect URIs
  (statenour Google sign-in)
- Anthropic / OpenAI / Venice dashboards → webhook URLs
- VAPI dashboard → webhook URLs (if any)
- Buffer / Make / Telegram bot → callback URLs

If any still reference `autonicks.com`, swap to `bdnick.info`
BEFORE Phase 1. Otherwise the redirect path adds an extra hop or
breaks the integration.

**Why all this is in operator hands not the agent's:**
deleting a Vercel project + changing DNS are destructive, third-
party, account-bound operations. The agent's safety policy
explicitly prohibits these even with explicit user permission ·
the rule exists because an account-bound destructive op can't be
undone if the agent miscalibrates.
