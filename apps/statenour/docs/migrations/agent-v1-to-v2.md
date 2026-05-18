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
- [x] **Candidate prompts sampler** · Phase W (2026-05-18 PM) ·
      `lib/ai/judge-eval/sampler.ts` reads recent V2 assistant replies
      from ChatMessage + pairs each with its preceding user prompt ·
      filters out already-compared rows via `sourceMessageId` ·
      `trpc.system.judgeEvalSamples` procedure + a "Candidate prompts"
      dashboard section render the queue with copy-to-clipboard
      buttons. Operator workflow: copy prompt → run through V1 (see
      below) → paste both into the ad-hoc form.
- [x] **X-Force-Agent header override** · Phase W · the `/api/ai/chat`
      route now reads `x-force-agent: v1`/`v2` per-request (owner-only ·
      session check runs first). Lets the operator (or a future cron)
      fire the SAME prompt through V1 then V2 to get matched pairs
      without flipping the deploy-wide `AGENT_V2` env flag. This is the
      mechanism the Phase V+ shadow-execute cron will use.
- [ ] **At least 30 days of V1 trace data captured for baseline** ·
      time-dependent · operator can now run pairs via:
      `curl /api/ai/chat -H "x-force-agent: v1"` + `... -H "x-force-agent: v2"`,
      then `POST /api/judge-eval/run` with the two outputs.
- [ ] **Daily cron to sample & judge** · Phase V+ scope · automate the
      manual loop above via a scheduled job · ~10 turns/day sampled.

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

## Current state (as of Phase W ship)

- `AGENT_V2=true` env flag is the ACTIVE default
- V1 code path still reachable when env flag is false (back-compat)
- Phase 0 prerequisites: judge-eval + dashboard (V) + sampler +
  force-override (W) ALL SHIPPED · the manual + scriptable workflow
  to build the corpus is complete end-to-end
- Safety net WIRED · `/system/judge-eval` shows the verdict chip
  + per-intent breakdown · sampler shows the fresh candidate queue
- Still pending · 30-day baseline corpus capture (time-dependent;
  the gating mechanism + dashboard + sampling + V1/V2 force-fire
  all exist · the corpus just needs to fill up via the manual loop
  the operator can now run from `/system/judge-eval` or curl)

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
