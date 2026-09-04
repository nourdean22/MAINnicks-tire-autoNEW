# Current-State Diagnostic — bdnick.info (statenour) @ origin/main 81989ec17

Verified by direct code read on 2026-09-03. Facts below are **verified** unless marked HYPOTHESIS.

## Scale (verified)
| Metric | Value |
|---|---|
| TS/TSX files in `apps/statenour` | 2,581 |
| Prisma models | 103 |
| Registered chat tools | **181** |
| Tools exposed per turn | **24** (`NICK_TOOL_BUDGET`, floor 10) |
| Per-turn exposure ratio | **~13%** |
| `finalize-system-prompt.ts` | 415 LOC |
| `chat-mode.ts` (pruner) | 621 LOC |
| `prepare-tools.ts` | 258 LOC |

Already present and working: Inngest (durable jobs), Sentry + Langfuse (both proven live per
`#2080`/`#2082`/`#2083`), Playwright, vitest eval harness, MCP surface snapshot tests,
`check:prompt-injection`, `check:mutations:strict`, soft-delete + raw-SQL audits, `verify:hard`
with 20+ gates.

**This is a mature system. The correct posture is AUGMENT, not rewrite.**

## The tool-selection pipeline (verified)

`pruneTools()` in `lib/ai/chat-mode.ts` selects <=24 of 181 tools per turn via a **6-tier priority
cascade**:

| Tier | Source | Character |
|---|---|---|
| 1 | `CORE_TOOLS` | static list |
| 2 | `ACTION_CORE` | static list |
| 3 | Exact tool-name mentions | deterministic |
| 4 | **~40 hand-written keyword regexes** | brittle, unbounded maintenance |
| 5 | Semantic rank via `rankToolsBySimilarity` | only if `isToolEmbeddingCacheWarm()` |
| 6 | Default extras | fires only if tiers 1-2 matched nothing else |

`prepare-tools.ts` then **re-adds** alwaysOn / action-intent / web-search tools AFTER pruning, so a
tight budget cannot break a step-0 `toolChoice` force. Good design.

### The recovery lane (verified, added by PR #2093)
`searchTools` + `invokeTool` (`lib/ai/tools/meta.ts:472,598`) are force-added in
`prepare-tools.ts:128`. `invokeTool` is **fail-closed to read-safe tools only** — writes must load
through the normal path so approval gates apply. `finalize-system-prompt.ts` instructs the model to
call `searchTools` *before* claiming a capability is unavailable, with three enumerated conditions
under which it may say so.

**This is the right architecture.** The 2026-09-02 finding that "tools never work" was a *regex
miss making a tool not exist* has a real structural answer now.

### Telemetry (verified — my initial read was wrong)
`recordToolInvocation()` writes via `$executeRaw` atomic upsert (`tool-telemetry.ts:90-135`):
total_calls, success/fail counts, duration, last 5 errors, recomputed `failure_rate_pct`.
Called from `lib/services/chat/tool-telemetry-walk.ts:118` and `meta.ts:645`. There is an
in-process circuit breaker (`recordToolFailure` / `isToolBlocked` / `resetToolBreaker`) and
`isConfigurationError()` separates misconfiguration from genuine failure.

## THE REAL REMAINING GAP (verified by absence)

Execution telemetry is excellent. **Selection telemetry does not exist.**

Nothing records, per turn:
- which of the 181 tools were **considered and dropped**,
- which tier each selected tool came from,
- whether the budget **truncated** the candidate set (and what fell off the cliff),
- whether `searchTools` fired — i.e. **the model itself signalling the pruner missed**,
- whether the semantic tier was even available (`isToolEmbeddingCacheWarm()` false on a cold
  lambda ⇒ tier 5 silently skipped).

Consequence: the ~40 regexes in tier 4 can only be maintained **reactively**, one anecdote at a
time. The code comments confirm this pattern — e.g. `analyzeFitness` got a bespoke regex on
2026-07-11 after being found "unreachable on a cold lambda when the embedding cache is empty".
That is the same bug shape recurring, fixed by hand each time, with no instrument that would have
caught it in advance.

**`searchTools` firing is the single highest-signal event in the system** — it is the model
explicitly reporting a pruner miss — and it is currently unlogged as a selection event.

## Prioritized findings

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 1 | No tool-**selection** telemetry; pruner quality is unmeasurable | **HIGH** | absence verified across `chat-mode.ts`, `prepare-tools.ts`, `tool-telemetry.ts` |
| 2 | Tier-4 = ~40 hand-maintained regexes; unbounded maintenance, silent misses | **HIGH** | `chat-mode.ts:~440-530` |
| 3 | Tier 5 silently no-ops when embedding cache is cold; no counter | **MED** | `chat-mode.ts:577` guard + `tool-embeddings.ts` header comment |
| 4 | 13% per-turn tool exposure with no measurement of whether 24 is the right number | **MED** | `TOOL_BUDGET` default 24, never A/B'd |
| 5 | `invokeTool` read-only restriction is correct but means write-intent misses are unrecoverable in-turn | **LOW-MED** (by design) | `meta.ts:598` |

## Diagnostic plan (what to instrument before changing anything)

1. Emit a `tool_selection` event per turn: `{turnId, candidateCount, selected[], tierOf{}, budgetTruncated, embeddingCacheWarm, searchToolsFired, invokeToolFired, invokedName}`.
2. Join `searchTools(query)` → the tool it eventually found → **the tier that should have caught it**.
   That join is the training set for replacing tier 4.
3. Ship a `/system/tool-reachability` panel: top `searchTools` queries, top pruner misses,
   cold-cache rate, budget-truncation rate.
4. Only THEN tune the budget or replace regexes — with data, not anecdote.

**Design rule going forward:** every silent fallback must increment a counter. The recurring defect
class in this codebase (per the 2026-09-02 nine-tab audit: "a failed read rendering as a confident
zero") is the same shape as "a skipped tier rendering as a confident selection".
