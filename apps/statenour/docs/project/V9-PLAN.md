# STATE NOUR · v9.0 Plan — Command Spine (counter-plan)

> **🗄 STATUS: HISTORICAL.** v9.0 + v9.1 fully shipped. v10 active.
> For current truth, read [`../RECONCILIATION.md`](../RECONCILIATION.md).
> For active execution, read [`V10-PLAN.md`](./V10-PLAN.md).
>
> **v9.0 final** = commit `f3255ff` (2026-04-30).
> **v9.1 wave** = v9.1.0 → v9.1.28 (28 commits, last `59b8c89` on 2026-04-30).
> **Total v9 wave:** ~33 commits + 65+ bugs fixed in code-review hardening.
> **Owner:** Nour Dean.
>
> **Versioning note (2026-04-30):** dual `v8.X v9.Y-wave` tag retired
> post-v9.0. The v8 sequential counter and v9 release identity were
> tracking the same commits on different axes — redundant. Going
> forward: **semver only** (`v9.1.2`, `v9.2.0`, etc.). v8.X tags stay
> in the historical commit log; no new ones minted.
> **Successor source:** this file extends [`UPGRADE-PLAN.md`](UPGRADE-PLAN.md)
> for v9.x work. UPGRADE-PLAN remains the historical / active-execution
> doc; V9-PLAN is scoped to the v9 release wave.

This is a counter-plan to the proposed external "8.3 → 9.0" doc. Same
outcome (command-centered OS that NICK can reason from). Different
approach: use existing primitives, fewer schema additions, respect the
v8.25 reconciliation work, ship in 3-4 weeks not 9 phases.

---

## Why a counter-plan

The external proposal is philosophically right (foundation release,
defer autonomy, dual-write strategy) but specifically prescribes work
that's either **already done** or **adds new tables for problems
existing primitives already solve**.

| External claim | Reality |
|---|---|
| "Build script mutates DB" | Fixed in v8.25. `build` is `prisma generate && next build`; the dangerous variant is `build:push-schema`. |
| "Too many truth centers" | [`RECONCILIATION.md`](../RECONCILIATION.md) was created in v8.25 specifically to fix this. |
| "Auth coverage gate needed" | Shipped v8.26 in fail-closed mode. 51 routes retrofitted. Gate 8/8. |

> **Count is historical — measured 2026-08-23 it is 113, not 51.**
> `git grep -l requireSession -- apps/statenour/app/api | wc -l`. The retrofit succeeded and the
> surface kept growing, so the figure records the v8.26 moment, not the estate. Dated rather than
> bumped: it will drift with every new route, and the plan's point is that the gate is fail-closed,
> not that it covers a particular number.
>
> A first pass at this measurement grepped `getAuthedUser|requireAuth|withAuth` and returned **0**,
> which would have read as "auth is gone". The helper is `requireSession` (`lib/auth-guard`). A zero
> from a pattern that never matched anything is not a finding -- it is the instrument failing to see
> its subject, and it was one step from being reported as a regression.
| "Move AI to `lib/nick-prime/`" | Busywork — we already have clean separation. |

The high-leverage pieces from the external plan that we **should keep**
are: unified state endpoint, typed context contract, proof attachments,
and a `verify:hard` bundle. Everything else is either done or
over-prescribed.

---

## v9.0 = Command Spine, narrowly defined

> **v9.0 ships ONE thing: every NICK reply, every dashboard, every
> automation reads from the same operating-state contract.**

That's it. No multi-table command system, no proof-system rewrite, no
folder reshuffles. Foundation only.

After v9.0 settles in production, we decide based on actual operational
pain whether v9.1+ needs new tables.

---

## §0 · v8.x baseline (ground truth as of 2026-04-30)

| Primitive | Status | Where |
|---|---|---|
| Task / Mission / Commitment / LifeGoal | mature, soft-deleted, audited | `prisma/schema.prisma` |
| MasteryDecision | mature | `prisma/schema.prisma` |
| AutonomousAction | mature (Nick's command audit) | `prisma/schema.prisma` |
| ScheduledAction · AutomationRule | mature | `prisma/schema.prisma` |
| EntityAudit (field-level diff log) | shipped v8.0 | `lib/db/entity-audit.ts` |
| Universal soft-delete (`deletedAt`) | shipped v7.9; ChatConversation uses `archivedAt` per v8.30 | `lib/db/soft-delete.ts` |
| BrainMemory + 7 alert categories | mature | `lib/brain/` |
| brain-bus (LISTEN/NOTIFY) | shipped v8.4 / consumer activated v8.23 | `lib/db/brain-bus.ts` |
| pgvector dual-read | shipped v8.12 | `lib/brain/semantic-dedup.ts` |
| 8-gate pre-push (incl. auth coverage hard-mode) | shipped v8.21–v8.26 | `scripts/pre-push-check.sh` |
| `authedFetch` standardization | shipped v8.28 | every client surface |
| Operator surfaces | `/system/{alerts, embedding-coverage, cron-runs[/jobName]}` | `app/(mastery)/system/` |

What's **missing** (v9 work):
- Single endpoint that returns the full operator state.
- Typed context object every AI call consumes.
- Proof-attachment field on Task (URLs/screenshots/metrics).
- `verify:hard` script bundling existing checks.

That's what v9.0 ships.

---

## §1 · v9.0 deliverables

### v9.0-alpha · `/api/command-center/state` + `NickPrimeContext`

Single endpoint. Single typed contract. Composed from **existing
primitives** — no new tables.

**`/api/command-center/state` returns:**

```ts
{
  generatedAt: string;
  operator: {
    mode: "focused" | "drift" | "on_fire" | "recovering" | "shutdown";
    timeOfDay: "morning" | "midday" | "afternoon" | "evening" | "late";
    todayScore: number | null;
  };
  commands: {
    active: TaskSummary | null;          // Task with status DOING (top by priority)
    open: TaskSummary[];                  // INBOX + READY (top 10)
    commitments: CommitmentSummary[];     // active commitments
    scheduled: ScheduledActionSummary[];  // upcoming scheduled actions
  };
  proof: {
    today: ProofRollup;       // Tasks DONE today, AutonomousAction successes, cron OK
    last7d: ProofRollup;
  };
  risks: {
    driftAlerts: DriftAlertSummary[];     // unresolved DriftAlerts
    brainAlerts: BrainAlertSummary[];     // 7 v8.x alert categories, last 7d
    staleCommands: TaskSummary[];         // computed: status≠DONE, lastTouchedAt > 7d ago
  };
  decisions: {
    recent: MasteryDecisionSummary[];     // last 10
    needsReview: MasteryDecisionSummary[];// passed reviewDate, no actualOutcome
  };
  systemHealth: {
    crons: { active: number; silent: number; failures24h: number };
    ai: { recentCallCount: number; recentErrorRate: number };
    memory: { lastBrainCycleAt: string | null; embeddingCoveragePct: number };
  };
  automation: {
    activeRules: number;
    recentRuns24h: number;
    failures24h: number;
  };
}
```

Every field is a **read** from existing tables — no new writes, no new
columns.

**`lib/ai/context/nick-prime-context.ts`:**

```ts
export type NickPrimeContext = {
  operatorState: CommandCenterState["operator"];
  activeCommand: TaskSummary | null;
  openCommands: TaskSummary[];
  todayProof: ProofRollup;
  activeRisks: { drift: DriftAlertSummary[]; brain: BrainAlertSummary[]; stale: TaskSummary[] };
  recentDecisions: MasteryDecisionSummary[];
  systemHealth: SystemHealthSummary;
};

export async function buildNickPrimeContext(): Promise<NickPrimeContext>;
```

The builder pulls from `/api/command-center/state` (server-side: direct
Prisma; client-side: via `authedFetch`).

**v9.0-alpha exit criteria:**
- [ ] Endpoint returns valid shape with real data (any operator).
- [ ] `buildNickPrimeContext()` works server-side without HTTP.
- [ ] No schema changes.
- [ ] All 8 pre-push gates green.
- [ ] Operator surface (`/system/command-center` page) renders the state.

---

### v9.0-beta · System prompt consumes `NickPrimeContext`

Today `lib/ai/system-prompt.ts` assembles ~15 pieces ad-hoc inside one
huge function. v9.0-beta replaces the ad-hoc assembly with one call to
`buildNickPrimeContext()` + a thin renderer that turns the typed object
into the prompt block.

**Migration is gradual** — for v9.0-beta, the OLD assembly stays as the
fallback path. New `system-prompt-v2.ts` reads from the context and
produces the same output shape. A feature flag (`NICK_PRIME_PROMPT=1`)
flips between them. We measure: prompt size, build duration, response
quality scorecard, error rate. Once metrics are even, retire the old
path.

**v9.0-beta exit criteria:**
- [ ] `system-prompt-v2.ts` exists, consumes `NickPrimeContext`.
- [ ] Output identical (or stricter superset) to current prompt under
      same conditions.
- [ ] Feature flag works (one chat turn flips between paths).
- [ ] /system/quality dashboard shows no regression after 48h shadow run.

---

### v9.0-rc · Proof attachments on Task

Add a single JSON field — **not a new table**:

```prisma
model Task {
  // ... existing fields ...
  proof Json? @map("proof")
}
```

Shape:

```ts
type TaskProof = {
  urls?: string[];           // PR, deployed page, IG post, etc.
  screenshots?: string[];    // S3 / public URLs
  metrics?: Record<string, number>;  // { calls: 20, leads: 4, sales: 1 }
  notes?: string;            // freeform
  observedAt?: string;       // ISO
};
```

UI: Task detail drawer gets a "Proof" section. Marking DONE without proof
prompts: "Add proof or note 'no proof' reason." Soft enforcement —
doesn't block, but the operator-state endpoint flags `noProofDay` as a
risk when a busy day has zero proof attachments.

**v9.0-rc exit criteria:**
- [ ] `proof Json?` migration applied.
- [ ] DONE flow surfaces the proof prompt.
- [ ] `noProofDay` risk fires when applicable.
- [ ] Backfill: existing DONE tasks have `proof: null` (no migration
      needed; the field is nullable).

---

### v9.0-final · Release hardening

```json
{
  "verify:hard": "pnpm typecheck && pnpm lint && pnpm test && pnpm check:raw-sql && pnpm check:crons && pnpm prompt:size-check && pnpm exec prisma validate",
  "release:db": "prisma migrate deploy",
  "release:app": "prisma generate && next build",
  "release:full": "pnpm verify:hard && pnpm release:db && pnpm release:app"
}
```

All the underlying checks **already exist** — `verify:hard` just bundles
them. `release:db` and `release:app` make the implicit separation
explicit (the `build` script is already safe per v8.25).

**v9.0-final exit criteria:**
- [ ] `pnpm verify:hard` passes locally + in CI.
- [ ] Release scripts documented in README.
- [ ] V9-PLAN updated marking 9.0 shipped.

---

## §2 · NOT in v9.0 (deferred to v9.1+)

| Item | Why deferred | Where |
|---|---|---|
| `Command` table | We have 8 command-shaped tables already. A `v_command` SQL VIEW unioning Task + MasteryDecision + AutonomousAction would give the abstraction without a new table. Decide post-9.0 based on real pain. | v9.3 |
| `ProofEntry` table | JSON field on Task gives the value at 5% the cost. Re-evaluate after a month of usage. | v9.2 (only if needed) |
| `RiskSignal` table | We have 7 BrainMemory alert categories that already work. Consolidate the SHAPE (consistent metadata schema) before deciding on a new table. | v9.2 |
| `lib/nick-prime/` folder rename | Busywork. Real architectural progress = the typed context contract, which lives in `lib/ai/context/`. | never |
| `V9-ROADMAP.md` as new SoT | RECONCILIATION.md is the single source of truth (v8.25). This file (V9-PLAN.md) extends UPGRADE-PLAN for active wave work; doesn't replace it. | n/a |
| Full memory rewrite | v8.x already reformed memory (entity-audit + brain-bus + pgvector dual-read). | v9.4+ |
| Multi-agent / voice / full autonomy | Not until command spine has been live and reasoned-from for 6+ weeks. | v9.5+ |

---

## §3 · Risk controls

What must NOT break during v9.0:

1. **Chat works** — system-prompt-v2 is shadow-flag-gated. If it
   regresses, flag flips back instantly.
2. **DONE flow doesn't block on proof** — soft prompt only. Force-
   completion still works.
3. **Operator state endpoint is read-only** — no writes, no side
   effects.
4. **Schema migration is additive** — `proof Json?` is nullable;
   existing rows untouched.

If any pre-push gate fails, push rejects. No exceptions.

---

## §4 · Verification gates (additive to v8.21+)

v9.0 adds:

- **`/api/command-center/state` shape contract test** — Zod-validated
  fixture round-trip, run in `tests/api/command-center.test.ts`.
- **`NickPrimeContext` snapshot** — same fixture verifies the
  `buildNickPrimeContext()` output matches the endpoint shape.
- **Prompt-v2 vs v1 diff** — assert prompt size delta < 10% for the
  same operator state (catches accidental section drops).

---

## §5 · Migration plan (no big-bang)

1. **v9.0-alpha lands** → endpoint live, no callers yet.
2. **One read caller migrates per push** to use `NickPrimeContext`
   instead of bespoke fetches. Order: Ultron home → /brain → /chat →
   crons.
3. **system-prompt-v2 launches** behind flag, compared via shadow
   runs (lib/ai/shadow-mode.ts already exists).
4. **Once parity holds 7+ days**, flag flips default-on.
5. **v9.0-rc lands** → proof field + UI.
6. **v9.0-final** → verify:hard + release scripts + doc reconciliation.

Old code paths stay until v9.1 explicitly retires them. **Nothing rips
out in v9.0.**

---

## §6 · Schedule

| Wave | Target | Scope |
|---|---|---|
| v9.0-alpha | week 1 | endpoint + context contract |
| v9.0-beta | week 2 | system-prompt-v2 (shadow flag) |
| v9.0-rc | week 3 | proof field + UI + risk wiring |
| v9.0-final | week 4 | verify:hard + release scripts + RECONCILIATION update |

3-4 weeks. Pickable up by any agent (Claude / Codex / Cursor) at any
checkpoint by reading this file + RECONCILIATION.md + the latest
UPGRADE-PLAN §0.6 priorities.

---

## §7 · Naming

**STATE NOUR v9.0 — Command Spine.**

> *The release where every NICK reply, every dashboard, and every
> automation reads from the same typed operating-state contract.*

Subsequent waves:
- v9.1 — Memory governance polish (categorical consolidation, retention review).
- v9.2 — Risk signals as first-class (decide table vs category once we have data).
- v9.3 — Command unification (decide view vs table once we feel the pain).
- v9.4 — Proactive briefings (Nick reaches out unprompted, gated).
- v9.5 — Permissioned automation (controlled autonomy slices).
