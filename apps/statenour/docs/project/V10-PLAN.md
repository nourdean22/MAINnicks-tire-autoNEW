# STATE NOUR v10 · Prime Reliability + Control Layer — HISTORICAL · DO-NOT-EXECUTE

> **HISTORICAL PLANNING DOC — no longer the active execution source (truth-substrate audit #22, 2026-07-21).**
> Last reconciled **2026-05-08** and never since, while the app kept shipping; the `v10.0.X` versioning scheme it uses is itself retired (see `AGENTS.md`). Do NOT execute this as a current plan.
> **For current state:** [`docs/CURRENT-TRUTH.md`](../CURRENT-TRUTH.md) (one-screen truth) and [`docs/RECONCILIATION.md`](../RECONCILIATION.md) (verified ship-by-ship log) are canonical.
> Kept only for the v10 control-layer design context below.

**Status:** HISTORICAL — superseded; retained for context. Drafted 2026-04-30 post-v9.1.28.
**Last reconciled:** 2026-05-08 (v10.0.484 EOD · 43-version sprint v10.0.442-484 closed · see `cohort-2026-05-08-eod-summary.md`). NOT reconciled since — treat as a snapshot, not live.
**Mission (as originally drafted):** Make STATE NOUR reliable, auditable, recoverable, and live-controlled before expanding automation.

> v10 is **not** the sci-fi release. v10 is the **control release**.

> **v10.0.442-484 sprint highlights** · prompt-builder v1↔v2 drift closed
> (5 audit findings) · v2 cutover plan published with 5 criteria + 4 phases ·
> 10 ADRs backfilled · editorial accessibility pass (contrast + reduced-motion
> + 17 keyframes) · mobile composer recovered · image-gen routed to Venice
> flux-2-pro · creativity dial bumped + BROADEN_AND_SUGGEST rule added.
> Schema timestamp migration parked at `prisma/migrations-pending/` pending
> prod DB connectivity.

---

## Current state (as of v9.1.28)

| Surface | State |
|---|---|
| HEAD | `f63a856` on `codex/ollama-local` — **retired** branch snapshot (as of v9.1.28; production is now `main` → Railway, see CURRENT-TRUTH.md) |
| Tests | 506/506 pass |
| Pre-push gates | 9/9 green (sensitive-GET in HARD mode since v9.1.17) |
| Production | every commit through v9.1.27 READY on bdnick.info |
| Schema | synced to Neon (this session — Cascade→Restrict + BrainMemory deletedAt index) |
| `NICK_PRIME_PROMPT` | `shadow` (set this session — soaking) |
| Bugs fixed in code-review hardening | 65+ across Round 1 + Round 2 audits |

**v9 wave is done.** v10 starts from this baseline, not from a hypothetical pre-audit state.

---

## Mission

> STATE NOUR knows the truth, watches the ecosystem, shows what matters,
> and gives NICK one clean operating picture — without hidden stale logic
> or silent failures.

## v10 Includes

- Frontend dashboard audit (52 mastery pages)
- Durable brain-bus replay (closes at-most-once gap)
- Test coverage sweep (cache invalidation, journal sanitization, autonomous-engine reorder, transactional spawn, reflection idempotency)
- Schema/migration history surface
- Same-turn provider fallback (pre-first-token only in v10)
- NICK Prime prompt-v2 default-on
- v1 builder deletion (~1700 LOC)
- CommandCenterState universal adoption
- Risk/proof normalization (display shape only — no new tables)
- Repo ecosystem dashboard (read-only)
- Live deployment truth surface
- AI/agent trace standardization

## v10 Excludes

- Full autonomous NICK actions
- New `Command` / `ProofEntry` / `RiskSignal` tables (derive instead)
- Multi-agent orchestration
- Voice / device expansion
- Major UI redesign
- Silent mid-stream provider blending
- Post-first-token mid-stream recovery (v10.1)
- New repo creation

---

## Execution model · parallel tracks

The previous v10 doc ordered phases serially. Reality permits parallel work:

```text
Track A · time-gated     → shadow soak (24-48h) → flip to =1 → delete v1 builder
Track B · code-heavy     → frontend audit → brain-bus durable → test coverage
                            → schema ledger → same-turn fallback
Track C · refactor       → CommandCenterState universal → risk normalization → proof expansion
Track D · docs/operator  → REPO-MAP stamping → satellite repo decisions → docs reconciliation
Track E · build-on-top   → /system/repos + /system/schema + /system/risk-deck + repo briefings
```

**Dependencies:** A blocks C. B blocks E. D is continuous. A and B run concurrently from day 1.

---

## Track A · NICK Prime cutover (time-gated)

**Status as of session start:** `NICK_PRIME_PROMPT=shadow` is live. Shadow runs are populating
SystemMetric rows (`prompt.shadow.chars_delta`, `chars_delta_pct`, `sections_only_v1`,
`build_failures` per v9.1.13).

### A.1 · 24-48h smoke window (NOT 7 days)

The 7-day window in earlier docs was cargo-culted. In a single-user system with ~30-100
chat replies/day, 24-48h gives statistically equivalent signal. Wait for evidence, not
calendar.

**Flip criteria (all must be true):**

- Zero `prompt.shadow.build_failures` SystemMetric rows in the last 24h
- 24h-avg `chars_delta_pct` within ±5%
- "Only in v1" sections list either empty or only the documented lower-leverage rows
  (smart-devices, integration-syncs, camera-intel, automation-rules)
- Manually eyeballed 5-10 representative chat replies show v2 = quality of v1

### A.2 · Flip to `=1`

```text
vercel env rm NICK_PRIME_PROMPT production
echo "1" | vercel env add NICK_PRIME_PROMPT production
git commit --allow-empty -m "chore(env): NICK_PRIME_PROMPT=1 — v9.2 cutover"
git push
```

Keep v1 builder warm for 48h post-flip. Watch for chat-quality regressions.

### A.3 · Delete v1 builder (v9.2 ship)

Once A.2 is stable for 48h:

- Delete `lib/ai/system-prompt.ts` (~1700 LOC)
- Delete `lib/ai/system-prompt-cache.ts` v1 cache path
- Delete the shadow-mode logging branch in chat route
- Update `RECONCILIATION.md` to note the retirement
- Repurpose `/system/prompt-comparison` as v2-only (or retire)

**Acceptance:** chat route no longer imports anything from `lib/ai/system-prompt.ts`.

---

## Track B · Reliability work (code-heavy)

### B.1 · Frontend dashboard audit

**Why first in this track:** 52 mastery pages, only `system/crons` was sampled in Round 2
(found a 1s setInterval re-render bug). Other 51 pages may hide N+1 fetches, stale
closures, missing error states, polling leaks.

**Actual page inventory** (verified live):

```text
non-system (22 pages):
  /, /chat, /tasks, /journal, /knowledge, /mastery,
  /brain, /brain/categories, /brain/continuity, /brain/galaxy,
  /devices, /devices/[id],
  /body, /financial, /integrations, /intel, /pins, /plan,
  /settings, /social, /photo-improver, /content/history

system (30 pages):
  /system/* — already partially covered by Round 2
```

**Audit checklist per page:**

1. API call count on load
2. Duplicate fetches
3. Polling interval + cleanup
4. Stale-closure risks
5. Missing loading/error/empty states
6. Unbounded list/table rendering
7. Bypass of `authedFetch`
8. Direct Prisma reads that should go through CommandCenterState
9. Freshness chip presence
10. N+1 patterns

**Output:** `docs/audits/FRONTEND-DASHBOARD-AUDIT.md` — table of all 52 pages with
red/yellow/green status + linked fix tasks.

**Acceptance:** Every red page has a fix or tracked issue. Every poll has cleanup.

### B.2 · Durable brain-bus replay

**Why:** v9.1.16 fixed the brain-bus probe lying about LISTEN health, but didn't address
at-most-once delivery. If consumer is offline when NOTIFY fires, the message is gone.

**Design:**

```text
producer:
  INSERT INTO brain_bus_events (...)  -- durable
  pg_notify('brain_bus', event.id)    -- wake bell

consumer (LISTEN):
  on NOTIFY: pull event by id, process, mark done

consumer (POLL — backfill):
  every 60s: SELECT pending events, process, mark done
```

**Schema addition:**

```prisma
model BrainBusEvent {
  id          String   @id @default(cuid())
  topic       String
  eventType   String
  payload     Json
  dedupeKey   String?  @unique
  status      String   @default("pending")  // pending|processing|done|failed|dead
  attempts    Int      @default(0)
  availableAt DateTime @default(now())
  lockedAt    DateTime?
  lockedBy    String?
  processedAt DateTime?
  lastError   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([status, availableAt])
  @@index([topic, createdAt])
}
```

**Surfaces:** New `/system/brain-bus` panel — listener heartbeat, last NOTIFY, oldest
pending, pending count, failed count, dead count, last polling backfill.

**Tests:**
- Event written while listener down → processed on next poll cycle
- Failed event retries with backoff → eventually marked dead
- Duplicate `dedupeKey` → second INSERT no-ops

### B.3 · Test coverage sweep

Helpers shipped in v9.1.22-v9.1.27 without their own tests:

| Helper | Surface | v |
|---|---|---|
| `invalidateMutationCaches` | services/tasks.ts + services/missions.ts | v9.1.23 |
| Journal sanitization wire-up | brain/journal-ingest.ts | v9.1.24 |
| Reflection idempotency wire-up | brain/reflection-engine.ts | v9.1.24 |
| Autonomous engine lock-first-then-fire reorder | brain/autonomous-engine.ts | v9.1.23 |
| `maybeSpawnNextPhase` transaction | services/tasks.ts | v9.1.24 |
| Wisdom Jaccard dedup | brain/wisdom-distiller.ts | v9.1.25 |
| Importance scorer TTL | brain/importance-scorer.ts | v9.1.25 |
| `claimWorkItems` TOCTOU exclusion | services/runner-state.ts | v9.1.26 |
| Entity-audit on chat task.update | api/ai/chat | v9.1.19 |

**Output:** `docs/audits/TEST-COVERAGE-GAPS.md` + new test files for each.

**Rule going forward (already enforced for new code):** No helper ships without direct
tests if it mutates data, sanitizes input, invalidates cache, controls auth, or writes
audit logs.

### B.4 · Schema/migration history surface

Prisma uses `db push` (no migration files), so there's no SQL audit trail.

**Schema addition:**

```prisma
model SchemaChangeLedger {
  id           String    @id @default(cuid())
  changeKey    String    @unique
  title        String
  reason       String
  changeType   String    // add_column, drop_column, alter_index, fk_change, etc.
  method       String    // db_push, migrate, raw_sql
  environment  String    // local, preview, production
  sqlSummary   String?
  prismaDiff   String?
  destructive  Boolean   @default(false)
  approvedBy   String?
  appliedBy    String?
  appliedAt    DateTime?
  rollbackPlan String?
  status       String    @default("planned")  // planned|applied|rolled_back|failed
  createdAt    DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}
```

**Surface:** `/system/schema-history` — last N changes with method/destructive/applied
state.

**Policy doc:** `docs/DB-MIGRATION-POLICY.md`
- Short-term: `db push` allowed but every change needs a ledger entry
- Medium-term: production schema changes use migration files, `db push` becomes
  emergency-only

### B.5 · Same-turn provider fallback

**Already shipped:** v9.1.27 cross-request rotation via `markProviderFailed` + 60s
sticky + 4 regression tests.

**Still missing (this phase):**
- Pre-first-token same-turn retry: if Venice fails BEFORE any token streamed, restart
  the streamText invocation with the next provider. User sees one clean response.
- `ProviderAttemptTrace` table or audit log for cross-attempt debugging.

**Out of scope for v10 (defer to v10.1):**
- Post-first-token mid-stream recovery (silent blending or visible-fallback-note)

**Tests:**
- Provider fails before first token → next provider serves the turn cleanly
- Provider fails after first token → existing v9.1.22 onError stub kicks in (no regression)
- Both attempts logged with traceId
- No duplicate ChatMessage row written

---

## Track C · Refactor (after Track A flip)

### C.1 · CommandCenterState universal adoption

Already partial:
- Ultron home: CommandSpinePulse since v9.1.2
- Chat route: NickPrimeContext when `NICK_PRIME_PROMPT=on` (active post-flip)

**Remaining work:**
- `/brain` page: read pinned context + hot rules from CommandCenterState instead of
  bespoke queries
- `/tasks`, `/missions`, `/plan`: read active command from CommandCenterState
- Mobile quick-status surfaces: same

**Acceptance:** `grep -r 'prisma.task.findFirst.*status.*DOING' --include='*.ts'` returns
ZERO matches outside `command-center-state.ts`.

### C.2 · Risk normalization (display shape only)

**No new table.** Unify the EXISTING risk sources into one TypeScript shape rendered
identically everywhere.

```ts
type RiskCard = {
  id: string;
  source: "drift" | "brain" | "computed" | "cron" | "ai" | "repo" | "schema" | "automation";
  severity: "info" | "watch" | "warning" | "critical";
  title: string;
  evidence: string[];
  recommendedAction: string;
  status: "open" | "acknowledged" | "snoozed" | "resolved";
  createdAt: string;
};
```

**Sources to normalize (all already exist as data):**

- `DriftAlert` rows → `source: "drift"`
- `BrainMemory` `*_alert` categories → `source: "brain"`
- Stale tasks (>7d untouched, computed) → `source: "computed"`
- noProofDay (computed) → `source: "computed"`
- Cron failures (CronJobLog) → `source: "cron"`
- AI error spike (AiGeneration) → `source: "ai"`
- Schema drift (sentinel) → `source: "schema"`
- Repo deploy unknown (B.4 once live) → `source: "repo"`

**Surface:** `/system/risk-deck` — unified panel + actions (acknowledge / snooze /
resolve / create-task / ask-NICK).

### C.3 · Proof expansion (no new table)

Use existing `Task.proof` JSON + rollups.

**New surface signals:**
- Today's proof / this week's proof (have)
- Proof from successful crons (CronJobLog)
- Proof from autonomous actions (AutonomousAction)
- Proof from commits (GitHub API via repos config)
- Proof from deployments (Vercel API — already wired)

---

## Track D · Docs + operator-side (continuous)

### D.1 · `RECONCILIATION.md` stamping

Already current as of v9.1.28. Add:
- Live "next required action" pointer
- v10 plan reference

### D.2 · `REPO-MAP.md` stamping

Each of 8 repos gets:
- `monitored: yes/no`
- `nickWriteAccess: none|read-only|approval|manual`
- `next_action`

### D.3 · `README.md` count cleanup

Drop hardcoded counts ("31 active crons" etc) — point to RECONCILIATION.

### D.4 · Stale-doc banners

Apply `> Status: Historical. For current truth, read RECONCILIATION.md.` to:
- old V8/V9 alpha plans
- archived roadmap dumps
- anything pre-v9.1

### D.5 · Satellite repo decisions

Operator-side. Document in `REPO-MAP.md`:
- `easy-nickstire` — keep separate or fold into nickstire.org?
- `nicks-tire-social` — keep posting cron or archive?
- `nour-os-bootstrap` — archive (per existing REPO-MAP recommendation)
- `NICKS-TIRE-NEW-GITHUB` — archive (per existing recommendation)

---

## Track E · Build-on-top (last)

### E.1 · `/system/schema`

Live deploy/Neon truth surface.

Show:
- App version + git SHA
- Expected schema version (from local schema.prisma hash)
- Live DB schema status (introspect comparison)
- Last migration / last db push (from SchemaChangeLedger)
- Pending schema action
- Health color (green/yellow/red)

### E.2 · `/system/repos`

Read-only ecosystem view.

```ts
// config/repos.ts
export const REPOS = [
  // HISTORICAL 2026-04-30 snapshot of config/repos.ts — these values are now
  // RETIRED (standalone statenour-os repo + Vercel + codex/ollama-local). See
  // the live config/repos.ts; statenour now deploys from main -> Railway.
  {
    name: "statenour-os",
    fullName: "nourdean22/statenour-os",
    ring: "personal",
    tier: "core",
    host: "vercel",
    branch: "codex/ollama-local",
    status: "active",
    monitored: true,
    nickWriteAccess: "none",
  },
  // ... 7 more
];
```

Page shows: ring, tier, status, host, branch, last commit (GitHub API), last deploy
(Vercel API for autonicks-tracked repos), health color, next action.

### E.3 · GitHub ecosystem briefings

Daily + weekly NICK briefings using REPOS config + GitHub API:

> "STATE NOUR shipped 12 commits this week. Nick's Tire repo deployed clean. Cron worker
> stayed healthy. Social engine has not posted in 2 days — flag."

Surfaced via `/system/repos`, `/system/command-center`, weekly review, and chat.

### E.4 · `/system/deployment-truth`

(Missing from previous docs.) One panel answering:

- "What commit deployed last?"
- "When?"
- "Does Neon column match local schema.prisma?"
- "Are env vars in expected state (no missing/stale critical secrets)?"
- "Last successful CI run?"

### E.5 · AI/agent trace standardization

(Missing from previous docs.) Unified format for every AI call across the system:

```ts
type AgentTrace = {
  traceId: string;       // shared across the chain (chat → tool → brain → audit)
  parentId: string | null;
  source: "chat" | "cron" | "autonomous" | "tool";
  provider: string;
  model: string;
  startedAt: string;
  finishedAt: string | null;
  inputChars: number;
  outputChars: number;
  errorClass: string | null;
  costCents: number;
  toolCalls: number;
};
```

Powers: `/system/ai-trace`, debugging "why did NICK do X?" questions, cost attribution.

---

## v10 Release Gate

v10 ships when ALL true:

| ✅ | Item |
|---|---|
| ☐ | Track A complete: prompt-v2 = production default, v1 builder deleted |
| ☐ | Track B.1: 52-page frontend audit done, all red pages fixed |
| ☐ | Track B.2: brain-bus durable replay shipped + tested |
| ☐ | Track B.3: 9 helpers with new direct tests |
| ☐ | Track B.4: schema-change ledger + `/system/schema-history` live |
| ☐ | Track B.5: pre-first-token same-turn fallback shipped + tested |
| ☐ | Track C.1: zero bespoke active-command queries outside command-center-state.ts |
| ☐ | Track C.2: `/system/risk-deck` unified |
| ☐ | Track C.3: proof signals from cron/commits/deploys surfaced |
| ☐ | Track D: RECONCILIATION + REPO-MAP + README stamped, stale-doc banners applied |
| ☐ | Track E.1: `/system/schema` live (Neon vs schema.prisma diff visible) |
| ☐ | Track E.2: `/system/repos` live with all 8 repos |
| ☐ | Track E.4: `/system/deployment-truth` live |
| ☐ | Track E.5: AgentTrace shipping with chat + cron + autonomous calls |
| ☐ | All 9 pre-push gates green |
| ☐ | All HIGH/CRITICAL findings from any v10 audit shipped |

## v10 Does NOT Include

- Full autonomous NICK actions
- New `Command` / `ProofEntry` / `RiskSignal` / `RepoStatus` tables (derive instead)
- Multi-agent orchestration
- Voice / device expansion
- Major UI redesign
- Silent mid-stream provider blending
- Post-first-token mid-stream recovery (v10.1)
- New repo creation
- Repo write access from NICK (read-only monitoring only)

---

## Out-of-scope but tracked for v10.1+

- Post-first-token streamText recovery (visible-fallback-note or silent continuation)
- `Command` durable command ledger (if proven necessary by v10 usage)
- `ProofEntry` table (if proof JSON pattern hits scale limits)
- Cron risk/value classification policy
- BrainMemory category-split refactor (alerts → DriftAlert, telemetry → SystemMetric, etc.)
- Multi-tenant skeleton activation (v8.5 stub)
- `RiskSignal` durable risk store (only if v10's display-shape approach hits limits)

---

## Acceptance posture

This plan favors **discipline over scope**. Every phase has explicit acceptance criteria.
The "do not include" list is binding. If something feels like a v10 feature but isn't on
the list, it's v10.1.

Last updated: 2026-04-30 post-v9.1.28.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
