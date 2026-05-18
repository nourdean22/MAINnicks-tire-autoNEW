# Migration · Prompt Builder V1 → V2

**Started:** v10.0.442-484 sprint (2026-05-07)
**Strategy:** Strangler fig with env flag (`AGENT_V2=true`)
**Status:** V2 active in prod · V1 still mounted as fallback · Phase 0 prerequisites pending

## Why

V1 prompt builder accumulated drift across 5 audit findings:
- Causation magnitudes (numbers in claims that weren't fact-checkable)
- LIVE SCOREBOARD dedup (same numbers surfaced twice in the prompt)
- Response-style unified (5 different style hints across sections)
- Identity section · pinned-memories overlap
- Strategic-frameworks section · selection drift

V2 rebuilt the section composer with a canonical contract:
- One section = one composed string · no inline mutation
- Token budget enforced per section · over-budget triggers truncation strategy
- Audit-able sections individually testable

## Cutover plan (per MEMORY notes)

### Phase 0 · prerequisites (in progress)
- [ ] Judge-eval comparator wired into daily harness
- [ ] Parity dashboard showing V1 vs V2 side-by-side per intent class
- [ ] At least 30 days of V1 trace data captured for the comparator baseline

### Phase 1 · canary (pending Phase 0)
- 10% of turns routed to V2 · 90% V1
- Daily judge-eval comparator runs · alerts on regression
- 7-day observation window before promotion

### Phase 2 · majority (post-Phase 1 + 7-day clean)
- 50% V2 · 50% V1
- 14-day observation window

### Phase 3 · default-V2 (post-Phase 2 + 14-day clean)
- V2 default · V1 only via `AGENT_V1_FORCE=true` env override
- 30-day observation window before V1 retirement

### Phase 4 · V1 retirement
- Remove V1 code paths from `lib/ai/prompt/sections/`
- Archive V1 section files under `lib/ai/prompt/_archive/`
- Update tests to V2-only

## Current state (as of P + Q ship)

- `AGENT_V2=true` env flag is the ACTIVE default
- V1 code path still reachable when env flag is false (back-compat)
- Phase 0 prerequisites NOT yet shipped (judge-eval comparator + parity dashboard)
- Therefore: we are running V2 in prod WITHOUT the safety net the plan called for

## Risk

Currently running V2 default with no automated regression detection.
Operator catches regressions manually via /chat experience. If V2
silently degrades on a specific intent class, no alert fires.

Recommendation: ship the Phase 0 prerequisites BEFORE the next major
prompt-section change · otherwise we're flying blind on regressions.

## Rollback levels

Per MEMORY: 3 rollback levels defined.

1. **Soft rollback:** unset `AGENT_V2=true` env · next request uses V1.
   No code change · ~1min to apply on Railway. Reversible.

2. **Code rollback:** revert the V2 router default in
   `lib/ai/prompt/v2/index.ts` so even `AGENT_V2=true` falls back to
   V1. Requires a single commit + push + Railway deploy. ~5min.

3. **Hard rollback:** delete the v2 directory entirely · revert to v1
   composer as the only path. Last resort if V2 has unfixable bugs.
   ~30min · requires careful merge of any V2-only features back into
   V1.

## Next milestone

Ship Phase 0 prerequisites:
1. Judge-eval comparator that scores V1 vs V2 outputs per intent
2. Parity dashboard that surfaces the comparator's findings

Until Phase 0 ships, this migration is STALLED at "V2 default · no
safety net" · which is a known risk position.
