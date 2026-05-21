# Design · suggestion-improve — suggestion-loop signals → improvement hypotheses

> **Status:** design validated 2026-05-21 (brainstorming session) · implementation pending.
> **Scope:** statenour-os · `apps/statenour/`.

## Understanding summary

- **What:** a new analysis pass that reads the `suggestion_loop` signals (operator
  act / dismiss / modified / deferred + outcomes on Nick's proactive suggestion chips)
  and emits operator-facing **improvement hypotheses** about which suggestion *kinds*
  are landing vs. noisy.
- **Why:** the suggestion-loop has captured operator reactions since ~2026-05-19, but
  nothing consumes them — the loop is open. This closes it, the same way `improve-agent`
  closed the reply-judgment loop.
- **Who:** the operator — reads hypotheses on `/brain/wisdom`, decides whether to retune
  the `/api/nick/suggest` aggregator.
- **Unit:** per suggestion *kind* (weak-axis, stuck-task, overdue, stalled-goal, pattern,
  orphan-nudge, contradiction, drift, unresolved-reflection, broken-promise, stale-pin).
- **Constraint:** low data — the loop is weeks old; a minimum-signal gate prevents noise.

## Non-goals

- No DPO / preference-dataset export (deferred until signal volume is real).
- No auto-tuning of the aggregator — overlaps the per-chip dismissal gate already shipped,
  and breaks improve-agent's "operator decides" principle.
- No auto-edit of `route.ts`.
- No LLM-synthesized concrete fixes in v1 (diagnose-only — a clean later extension,
  exactly as improve-agent added synthesis ten versions after it shipped).

## Assumptions

- **A1 — scope:** diagnose-only. Per-kind stats + a plain verdict; operator decides changes.
- **A2 — trigger:** rides `improve-agent`'s existing cron + `/api/brain/improve-agent`
  endpoint — one daily pass over both signals.
- **A3 — storage:** new brain category `suggestion_hypothesis`, distinct from
  `improvement_hypothesis`, so the two streams stay separable.
- **A4 — min-data gate:** a kind needs ≥ 5 action signals in a 30-day window before a
  hypothesis fires.
- **A5 — non-functional:** one `findMany` + in-memory math (cheap) · operator-only, no
  security surface · best-effort reliability (failures skip, never crash).

## Decision log

| # | Decision | Alternatives | Rationale |
|---|---|---|---|
| D1 | Output = operator-facing improvement hypotheses | DPO data prep; both | Loop is new/low-data → DPO has nothing to prep; hypotheses are useful now; mirrors improve-agent. |
| D2 | Scope = diagnose-only | diagnose + propose a fix; auto-tune | YAGNI; improve-agent itself started diagnose-only (synthesis added later); low data makes a synthesized fix low-confidence. |
| D3 | Trigger = rides improve-agent's cron/endpoint | separate cron/endpoint | One daily "improvement pass"; no new scheduling surface. |
| D4 | Storage = new `suggestion_hypothesis` category | reuse `improvement_hypothesis` | Keeps the two hypothesis streams separable on `/brain/wisdom`. |
| D5 | Gate = ≥ 5 signals / 30-day window | lower / no gate | Mirrors improve-agent's `< 5` guard; prevents noise from thin data. |
| D6 | Placement = new module `lib/brain/suggestion-improve.ts` | extend `improve-agent.ts`; generic engine | Lowest risk — live `improve-agent.ts` untouched; clean separation; self-documenting parallel name. Generic engine rejected (YAGNI — two cases share a shape, not a substance). |

## Final design

### Components

New file **`lib/brain/suggestion-improve.ts`** — mirrors `improve-agent.ts`:

- `analyzeSuggestionLoop(daysBack = 30): Promise<SuggestionHypothesis[]>` — calls
  `suggestionLoopStats(daysBack)`, walks `byKind`, applies the gate + threshold, returns
  one hypothesis per noisy kind.
- `persistSuggestionHypotheses(hyps): Promise<number>` — writes each as a
  `suggestion_hypothesis` brain memory, idempotent per kind+day.
- `runSuggestionImproveAgent(daysBack = 30): Promise<{ kindsAnalyzed, hypotheses, persisted }>`
  — one-shot, with a top-level try/catch returning an empty result on failure.

Supporting change — **`lib/brain/categories.ts`**: add `SUGGESTION_HYPOTHESIS:
"suggestion_hypothesis"` to `BRAIN_CATEGORIES` **and** to `RECALL_EXCLUDE_CATEGORIES`
(operator-facing meta-analysis must not leak into chat recall). No schema migration —
`category` is a plain string column.

### Data flow

```
suggestion_loop rows (BrainMemory)
   │  suggestionLoopStats()          ← existing
   ▼
{ byKind: kind → {acted,dismissed,modified,deferred,…} }
   │  analyzeSuggestionLoop()        ← new
   ▼
per-kind: signalCount, dismissRate → gate (≥5) + verdict
   │  persistSuggestionHypotheses()  ← new
   ▼
suggestion_hypothesis memories → /brain/wisdom
```

### Type + thresholds

`SuggestionHypothesis = { kind, signalCount, acted, dismissed, dismissRate, actionRate, verdict: "noisy", summary }`.

- Gate: `signalCount ≥ 5` action signals (acted + dismissed + modified + deferred) in the window.
- Verdict `"noisy"`: `dismissRate ≥ 0.5`, where `dismissRate = dismissed / signalCount`.
  Only noisy kinds emit a hypothesis (mirror improve-agent — surface problems, not praise).
- Keyed on `dismissRate` (explicit no, confidence 0.6), **not** low `actionRate` — a kind
  drowning in `deferred` (0.3, "operator busy") is not noise.
- `summary` (operator-facing): e.g.
  `"weak-axis · 12/15 dismissed (80%), acted 2 — you're rejecting this kind. Review its trigger in /api/nick/suggest."`

### Persisted memory

category `suggestion_hypothesis` · key `suggestion_hyp_<kind>_<YYYY-MM-DD>` (idempotent per
kind+day) · source `suggestion-improve` · metadata
`{ kind, signalCount, acted, dismissed, dismissRate, actionRate, verdict, windowDate }`.

### Edge cases

Empty `byKind` → `[]`, persist 0 · sub-gate kinds silently skipped · 0 dismissals → not
noisy · `dismissRate` computed only after the `≥5` gate, so never divides by zero ·
same-day re-run rewrites today's keys (no corpus pollution).

### Error handling

`runSuggestionImproveAgent` — top-level try/catch returns an empty result on failure: it
shares improve-agent's cron pass, so a failure here must not kill the reply-judgment run.
`persistSuggestionHypotheses` — per-write try/catch, skip on fail.

### Testing

`tests/brain/suggestion-improve.test.ts` — `vi.mock` `suggestionLoopStats`, feed controlled
`byKind` fixtures: noisy kind → hypothesis; sub-5 kind → none; low-dismiss kind → none;
`summary` content; persist key/category/metadata; `runSuggestionImproveAgent` swallows a
thrown `suggestionLoopStats`.

## Implementation checklist

1. `lib/brain/categories.ts` — add `SUGGESTION_HYPOTHESIS` to `BRAIN_CATEGORIES` and to
   `RECALL_EXCLUDE_CATEGORIES`.
2. `lib/brain/suggestion-improve.ts` — new module (the type + three functions).
3. `tests/brain/suggestion-improve.test.ts` — new test file.
4. Wire `runSuggestionImproveAgent()` into the `/api/brain/improve-agent` route handler and
   the cron that calls `runImproveAgent()`.
5. Verify — `pnpm typecheck` + `pnpm test`.
