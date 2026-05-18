# Migration · Prompt Builder V1 → V2

**Started:** v10.0.442-484 sprint (2026-05-07)
**Strategy:** Strangler fig with env flag (`AGENT_V2=true`)
**Status:** V2 active in prod · V1 still mounted as fallback · **Phase 0 judge-eval comparator + parity dashboard SHIPPED in Phase V** · awaiting V1 trace baseline corpus (30 days)

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

### Phase 0 · prerequisites
- [x] **Judge-eval comparator wired** · Phase V (2026-05-18 PM) ·
      `lib/ai/judge-eval/comparator.ts` · LLM-as-judge across 4
      dimensions (accuracy · clarity · conciseness · operator-fit) ·
      structured Judgment output · 12 parser tests
- [x] **Parity dashboard shipped** · Phase V · `/system/judge-eval`
      surface · `trpc.system.judgeEvalSummary` procedure · per-
      intent-class breakdown · Phase 1 canary verdict (safe / watch /
      regressing / insufficient-data)
- [x] **Ad-hoc trigger endpoint** · Phase V · `POST /api/judge-eval/run`
      lets the operator build the corpus from real prod replies without
      requiring shadow-execute infra yet
- [ ] **At least 30 days of V1 trace data captured for baseline** ·
      time-dependent · the operator can backfill by posting historical
      V1 replies via the `/run` endpoint OR a future cron can
      shadow-execute V1 against a 10% canary slice of new requests
- [ ] **Daily cron to sample & judge** · Phase V+ scope · once the
      shadow-execute pattern is designed, wire a cron that picks ~10
      recent V2 turns + re-runs each through V1 + judges + persists

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

## Current state (as of Phase V ship)

- `AGENT_V2=true` env flag is the ACTIVE default
- V1 code path still reachable when env flag is false (back-compat)
- Phase 0 prerequisites: **judge-eval comparator + parity dashboard
  SHIPPED in Phase V**
- Safety net is now WIRED for any sample the operator posts via
  `POST /api/judge-eval/run` · the `/system/judge-eval` page shows
  win rate per intent + canary verdict in real time
- Still pending · 30-day baseline corpus capture (time-dependent;
  the gating mechanism + dashboard exist · the corpus just needs to
  fill up via either backfill of historical replies or live capture)

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

~~Ship Phase 0 prerequisites~~ **DONE in Phase V (2026-05-18 PM).**

Next steps to unblock Phase 1 canary:

1. **Build the 30-day baseline corpus** · either backfill via
   `POST /api/judge-eval/run` with historical V1 replies the
   operator pastes in, OR design the shadow-execute cron that
   re-runs a small sample of V2 turns through V1 in parallel
2. **Watch the `/system/judge-eval` verdict** as the corpus fills ·
   it auto-flips from `insufficient-data` → `safe` / `watch` /
   `regressing` once 50+ runs accumulate
3. **Only then** flip to Phase 1 canary (10% of turns routed to V2
   while V1 is the default · or vice-versa depending on what the
   verdict says)
