# ADR-0013 · Per-tool daily quota via BrainMemory · cost-DoS defense

**Status:** Accepted
**Date adopted:** v10.0.529.4 (2026-05-12) · race-fix v10.0.529.8

## Context

The security audit (`docs/audits/security-stride-owasp-2026-05-12.md`)
flagged **D-2** (Denial of Service / cost exhaustion). Two chat tools
have real per-call dollar cost:

- `runPython` · E2B sandbox boots and runs Python code · ~$0.0003 per
  invocation
- `ingestDocumentFromUrl` · arbitrary external fetch + chunking +
  embedding generation · embedding cost dominates (~$0.0005-0.002 per
  document depending on size)

The chat route already caps tool calls **per turn** via
`stopWhen=stepCountIs(N)` (`lib/ai/chat-mode.ts`). But a prompt-injection
loop that survives across turns (or a runaway agent that the operator
left running) could fire the cost-heavy tools repeatedly. A worst-case
math run · `runPython` at $0.0003 × 100 calls/minute × 60 min = $1.80
in one hour · is small in absolute terms but the unbounded shape is
the problem, not the magnitude.

The audit graded D-2 as a HIGH severity finding (cost trajectory · not
catastrophic alone but combined with E-3 prompt-injection becomes
weaponizable).

## Decision

Add a daily per-tool counter stored as a `BrainMemory` row with
`category="tool_quota_daily"`. The module
`lib/ai/tool-quota.ts` exposes one function:

```ts
checkAndIncrementToolQuota(toolName: string, capOverride?: number)
  : Promise<{ ok, count, cap, resetAt }>
```

Both cost-heavy tools call it at the top of their handler · if `ok ===
false`, return a structured `{ ok: false, error: "quota_exceeded" }`
result so the chat model can gracefully tell the operator instead of
silently failing.

Defaults are 10× typical-day usage:

- `runPython` · cap 100 (typical 5-10/day)
- `ingestDocumentFromUrl` · cap 50 (typical 2-5/day)
- Other tools fall back to a cap of 1000 (effectively unlimited but
  not unbounded)

Reset cadence · the storage key is `<tool>_<YYYY-MM-DD>` in the
operator's America/New_York timezone (matches `morning-brief`'s
calendar convention). Rows roll naturally at midnight ET. Old rows get
reaped by `lib/services/memory-decay.ts` on its weekly run.

### The atomic-upsert wrinkle (v529.8 fix)

The v529.4 first implementation was read-then-upsert:

```ts
const row = await findFirst(...);
const newCount = (row?.metadata?.count ?? 0) + 1;
await upsert(... { count: newCount } ...);
```

Post-session review caught the race · two concurrent calls could both
read the same count and overwrite each other's increment. Silent
undercounting · the cap was technically unenforced under any
parallelism. Fixed in v10.0.529.8 with a raw-SQL atomic upsert:

```sql
INSERT INTO "brain_memories" (..., metadata, ...)
VALUES (..., '{"count":1, ...}'::jsonb, ...)
ON CONFLICT (category, key) DO UPDATE
  SET metadata = jsonb_set(
    brain_memories.metadata,
    '{count}',
    ((COALESCE((metadata->>'count')::int, 0) + 1)::text)::jsonb
  ),
  updated_at = NOW()
RETURNING ((metadata->>'count')::int) AS count
```

The row lock is held by the WRITE itself · concurrent calls serialize.
Net effect: under tight concurrency the cap may be exceeded by exactly
1 (the rejected call still incremented the row before the application
layer noticed). Acceptable · the cap is a budget not a hard wall.

### Fail-open posture

Any DB error in the quota module returns `{ ok: true, count: 0 }`. A
quota subsystem hiccup must NEVER block the chat surface · a quota
system that breaks chat fails worse than the threat it defends against.

## Consequences

**Positive:**

- **NO new schema migration** · reuses `BrainMemory` with a new
  `category` value. Ships immediately to prod without coordinating a
  Neon migration window.
- Single-row-per-day-per-tool storage · the table grows by 2 rows/day
  (one per cost-heavy tool) and gets reaped weekly. Trivial footprint.
- Atomic upsert means the cap is enforced under any concurrency level
  the Node runtime can produce (the JS event loop can fan-out async
  but the DB serializes the row write).
- DST-aware reset · the `isCurrentlyEdt()` helper queries the runtime's
  timezone offset right now rather than hard-coding a date table. The
  reset rolls cleanly through spring-forward / fall-back.
- Operator can override the cap per-tool via the `capOverride` arg ·
  useful for an admin-triggered batch ingest that legitimately needs
  more headroom.

**Negative:**

- Using `BrainMemory` as a counter table is a slight semantic stretch
  (`category=wisdom / wisdom_personal / decision_replay_outcome` are
  the "real" categories · `tool_quota_daily` is bookkeeping). Mitigated
  by the clear category prefix and the weekly reaper · the rows don't
  pollute semantic-recall scans because they're filtered by category.
- Raw SQL escape hatch (Prisma's typed API can't express `jsonb_set`
  cleanly) · adds one more `$queryRaw` site to audit when refactoring
  the BrainMemory schema. The schema-index-audit script already covers
  raw-SQL queries.
- Per-day granularity only · doesn't catch a "100 calls in 60 seconds"
  burst that happens to stay under the daily cap. A per-minute layer
  would be the natural Phase 2 if abuse patterns emerge.

## Alternatives considered

- **Dedicated `ToolQuotaCounter` table.** Rejected · costs a Prisma
  schema migration + a Neon prod-apply coordination + a new model to
  maintain. The single-row-per-day pattern fits BrainMemory's shape
  cleanly. The "rolling tool-pattern" already used by morning-brief
  and decision-replay (each is a category-tagged row family in
  BrainMemory) sets the precedent · we're following an established
  convention not inventing a new one.
- **Redis / Upstash counter with TTL.** Rejected · adds infrastructure
  (Upstash account · env vars · network round-trip cost vs the
  in-DB row write). The operator's stack philosophy is "Postgres
  unless absolutely otherwise." A Redis counter would be the better
  technical fit for sub-second rate limits but the daily-cap shape
  doesn't need that granularity.
- **In-memory counter in the Node process.** Rejected · Vercel cold
  starts reset the counter, undermining the cap. Even on persistent
  Railway, multi-process deployment fragments the counter across
  workers.
- **Rate-limit at the IP / session layer (Upstash rate-limit).** Out
  of scope · the audit's R-1 rate-limit item is tracked separately
  (the v10.0.529.3 commit shipped rate limits on a different set of
  routes). D-2 is specifically about per-tool budgets not per-request
  velocity.

## References

- `lib/ai/tool-quota.ts` — the module + atomic upsert
- `lib/ai/tools.ts` — the two consumer tools call the quota gate at
  the top of their handler
- `docs/audits/security-stride-owasp-2026-05-12.md` — D-2 finding
- `lib/services/memory-decay.ts` — the weekly reaper that prunes
  expired counter rows
- `lib/ai/chat-mode.ts` — the `stopWhen=stepCountIs` per-turn cap
  (the other half of the defense)
- v10.0.529.4 commit (`04a36b8`) · initial ship
- v10.0.529.8 commit (`63f4146`) · race fix via atomic upsert
- ADR-0006 · pgvector on Neon · explains why we lean Postgres-native
  (relevant to the "Redis or DB" alternative)

## Open items

- Watch the counter rows in `BrainMemory` for a week post-ship to
  confirm the storage assumption (single row per tool per day · no
  accidental duplication). Spot-check via the brain dashboard.
- If the operator's typical-day usage trends up (more runPython work
  · more document ingestion), revise the caps. The values are
  conservative by design but should not become friction.
- Decide whether to surface `quota_exceeded` to the operator via the
  Telegram alert channel · today it surfaces via the model's reply
  text only.
- Per-minute layer (Phase 2 only if abuse pattern emerges).

---

**Reconciled at v10.0.529.9** · 2026-05-12 EOD · ADR shipped alongside
the cost-DoS hardening wave so the rationale is durable before context
rotates.
