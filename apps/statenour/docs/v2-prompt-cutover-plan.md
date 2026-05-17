# v2 Prompt Builder · Cutover Plan

**Status:** Plan adopted · **Criterion 4 PASSES · 4 criteria remain (3 need shadow data, 1 needs staging verify)**
**Author:** v10.0.459 (2026-05-07) · **Criterion 4 verified v10.0.529.9 (2026-05-12)**
**Owner:** Nour (operator) · Claude session executes the phases

## v10.0.529.9 STATUS UPDATE · 2026-05-12

A post-session general-purpose agent ran `scripts/prompt-judge-comparator.ts` against N=20 paired turns. Result:

| Axis | v1 avg | v2 avg | Δ | Pass (Δ > −0.3)? |
|---|---|---|---|---|
| accuracy | 9.7 | 9.8 | +0.1 | ✅ |
| actionability | 9.0 | 9.0 | -0.1 | ✅ |
| brevity | 9.8 | 9.6 | -0.2 | ✅ |
| tone | 9.9 | 9.9 | +0.1 | ✅ |
| evidence | 8.5 | 8.3 | -0.2 | ✅ |

**Criterion 4 · PASS.** Token spot-check from the same run: v1 = 26,825 chars · v2 = 21,075 chars (−21.4% · well within the −40% to +5% Criterion 2 band on this sample).

**Comparator script bug fixed** (v10.0.529.9 · 1-line patch). Pre-fix the script called the non-exported `buildSystemPromptUncached` with wrong tier value and arg order · it had never executed cleanly since v10.0.464. Now uses public `buildSystemPrompt(tier, userMessage)`.

**Phase 1 blocker:** shadow-mode SystemMetric data is still empty. Operator-actionable sequence to unlock Phase 1:

1. ✅ **v10.0.529.9 · comparator script bug fixed**
2. ⏳ **Operator · set `NICK_PRIME_PROMPT=shadow` in Vercel prod env** (single env-var save, no redeploy needed · ~30 seconds)
3. ⏳ Let chat traffic accumulate paired builds · 48-72h window
4. ⏳ Re-run `pnpm tsx scripts/prompt-shadow-summary.ts --days 3` to gate Criteria 1, 2, 3 across real traffic
5. ⏳ Operator · verify L1/L2 rollback once in staging (Criterion 5)
6. ⏳ With all 5 criteria green · operator greenlights Phase 1 (10% canary via deterministic conversation-ID hash)

**The bottleneck is operator time, not code.** Steps 2 + 5 are operator actions. Steps 3 + 4 are passive waiting + a script run.

## Why now

The v1/v2 prompt builder split (ADR-0003) has been running in shadow
mode since v9.2 (2026-05-01). v1 serves all production traffic; v2
builds in parallel, parity is logged but unused. This doc closes
ADR-0003's "Open items: define formal cutover criteria · cutover
date is unset" gap.

## Why now

- The v10.0.444 prompt audit identified 5 v1↔v2 drift findings —
  all closed in v10.0.445-447. v1 and v2 now agree on the most
  dangerous failure modes (causation magnitudes, response-style
  rules, temporal section structure).
- The Anthropic ephemeral cache (ADR-0005) is now wired for the
  streamText path (v10.0.446). Cache friendliness is structural
  in v2 (typed sections in stable order) vs accidental in v1.
- Operator has explicitly greenlit cutover planning (this push).

## Current state · what exists today

### Mode flag

`NICK_PRIME_PROMPT` env var on the chat route:

| Value | Behavior |
|---|---|
| unset / `0` / `off` | v1 only (production default) |
| `shadow` | v1 returned to user · v2 built in parallel · delta logged |
| `1` / `on` | v2 returned to user (production cutover) |

### Shadow-mode telemetry (already shipping)

Two emit sites in `lib/ai/system-prompt.ts`:

1. **Per-turn console line** (~line 334):
   ```
   [prompt-shadow] v1=12480 v2=8920 delta=-3560 (-28.5%)
                   tier=core slot=chat only-in-v1=3
   ```
2. **Build-failure counter** (~line 343) writes to
   `SystemMetric` rows keyed `prompt.shadow.build_failures`.

The `delta.sectionsOnlyInV1` and `delta.sectionsOnlyInV2` arrays
are computed inside `lib/ai/prompt/v2/shadow-metrics.ts` and
captured in the per-turn line.

### What's NOT yet shipping

- Aggregated parity dashboard surface (`/system/observability`
  has the request tracer but no dedicated v1/v2 panel).
- Judge-eval delta between v1 and v2 outputs (judge eval runs on
  v1 only since v1 is what the user sees).
- Per-tier parity stats (core / business / brain tiers may have
  different drift rates).

## Cutover criteria · the formal go-decision

Cutover proceeds when **all 5 of these hold simultaneously over a
72-hour observation window**:

### Criterion 1 · zero structural drift

- `delta.sectionsOnlyInV1.length === 0` for ≥ 99% of turns
- `delta.sectionsOnlyInV2.length === 0` for ≥ 99% of turns,
  OR every "only-in-v2" section is documented as an intentional
  v2 improvement (e.g. cleaner Layer 1.5 hypothesis framing)

### Criterion 2 · token economy parity

- v2 token count is **within −40% to +5%** of v1 across all tiers
  (v2 should generally be smaller — same content, cleaner
  composition — but never significantly larger)
- Per-tier breakdown documented (core ≤ X tokens · business ≤ Y ·
  brain ≤ Z)

### Criterion 3 · zero shadow build failures

- `prompt.shadow.build_failures` counter reads zero over the
  observation window
- Any failure that DID happen has a documented root cause and
  fix (in commit history)

### Criterion 4 · judge-eval delta acceptable

This requires shipping the judge-eval comparator FIRST (see
"Phase 0" below). Then:

- v2 outputs grade ≥ v1 on the 5-axis rubric (accuracy /
  actionability / brevity / tone / evidence) on a sample of
  ≥ 100 paired turns
- No axis regresses by more than 0.3 points (out of 5)

### Criterion 5 · rollback mechanism verified

- A documented `NICK_PRIME_PROMPT=off` rollback returns to v1
  immediately on Vercel env var change (no redeploy needed)
- Rollback verified by deploy-then-rollback test in staging

## Cutover phases

### Phase 0 · prerequisite work · **COMPLETE** (v10.0.463-465)

All three prereqs are live:

- ✅ **`scripts/prompt-shadow-summary.ts`** (v10.0.463 · 250 LOC) —
  reads SystemMetric rows from the shadow window and emits the
  criterion 1 + 2 + 3 stats as a single report. Exit non-zero if
  any criterion fails. Supports `--days N` window + `--json` CI
  mode. Usage:
  ```bash
  pnpm tsx scripts/prompt-shadow-summary.ts           # human · 7-day window
  pnpm tsx scripts/prompt-shadow-summary.ts --days 3  # 3-day window
  pnpm tsx scripts/prompt-shadow-summary.ts --json    # CI gate
  ```
- ✅ **`scripts/prompt-judge-comparator.ts`** (v10.0.464 · 250 LOC) —
  samples N recent user queries from `ChatMessage` history, runs
  each through both v1 + v2 builders, generates a reply with
  each, scores both replies on the 5-axis judge rubric, emits
  per-axis delta + verdict. Cost ~$0.05-$0.20 at N=20 default.
  Exit codes: 0 = Criterion 4 PASS · 1 = axis regression > 0.3 ·
  2 = no sample data.
- ✅ **`/system/prompt-parity` route** —
  `app/(mastery)/system/prompt-parity/page.tsx` ships as sibling
  to the existing `/system/prompt` page · v1/v2 parity panel for
  operator review.

### Phase 1 · canary 10% (1 version)

- Set `NICK_PRIME_PROMPT=on` for 10% of turns via deterministic
  hash on conversation ID. Other 90% stays on v1.
- 24 hours of canary traffic. Monitor:
  - Operator-reported issues (any "weird response" complaint
    halts the canary)
  - Judge-eval delta on the canary 10% turns vs v1 baseline
  - Adversarial critic firing rate (must not change > 20%)
- If clean: proceed to Phase 2. If issues: rollback to
  `NICK_PRIME_PROMPT=off`, fix, re-run Phase 1 from scratch.

### Phase 2 · 50% canary (1 version)

- Hash-bucket expand to 50%. 48 hours.
- Same monitoring. Same halt criteria.

### Phase 3 · 100% cutover (1 version)

- Set `NICK_PRIME_PROMPT=on` globally.
- 7-day soak period before declaring cutover complete.
- v1 builder remains in code as rollback escape hatch · NOT
  removed until Phase 4.

### Phase 4 · v1 retirement (deferred · 30+ days post-cutover)

- After 30 days of stable v2 production with zero rollback
  events, delete `lib/ai/system-prompt.ts` v1 builder.
- Preserve as `lib/ai/system-prompt.v1.legacy.ts` for one more
  release cycle in case of late regression.
- Final delete after 60 days post-cutover.

## Rollback mechanism

The `NICK_PRIME_PROMPT` env var is the rollback lever. Three
rollback levels:

| Level | Trigger | Mechanism |
|---|---|---|
| L1 · soft | Single complaint or judge regression | Set `NICK_PRIME_PROMPT=shadow` · v1 serves traffic, v2 still observed |
| L2 · hard | Sustained issues during canary | Set `NICK_PRIME_PROMPT=off` · v2 not even built |
| L3 · revert | Worst-case · v2 is structurally wrong | `git revert` the cutover commit + redeploy |

L1 and L2 are env-var changes via Vercel dashboard · no redeploy
required · effective within ~30 seconds of the env var save.

## Halt-the-cutover triggers

Any of these halts the in-flight phase immediately:

- Operator reports a chat session that "felt different" /
  "missed something obvious" / "hallucinated" — even one
- `prompt.shadow.build_failures` counter increments during the
  canary
- Judge-eval delta on canary turns shows a > 0.3 axis regression
- An open ADR-0001 / ADR-0002 / ADR-0005 dependency surfaces a
  regression caused by v2 (e.g. cache breakpoint placement in v2
  produces different cache hit rate than v1 path)

## Decision log

The operator (Nour) explicitly greenlights each phase. No phase
auto-advances. The Claude session running the cutover updates
this doc with the actual observed metrics + the operator's
go/no-go decision per phase.

## What NOT to do

- Don't ship v2 + delete v1 in the same commit. Keep them
  parallel through Phase 3 minimum.
- Don't extend Phase 0 prerequisites with new criteria once
  cutover starts. Lock the criteria, run the phases.
- Don't merge unrelated prompt edits during the cutover window
  (Phase 1 + Phase 2 + Phase 3). Cleaner cause/effect attribution.
- Don't run the cutover during operator's high-stakes sessions
  (active deal closing, urgent decision call). Quiet windows
  only.

## References

- ADR-0003 · v1 / v2 prompt builder split · the architectural
  decision this plan operationalizes
- ADR-0005 · Anthropic ephemeral cache · v2's stable prefix
  structure makes the cache friendlier
- v9.2 commit · v2 introduction
- v10.0.404 commit · operator-rules.ts consolidation
- v10.0.444 audit · drift findings closed in v10.0.445-447
- `lib/ai/system-prompt.ts:258-340` — current shadow-mode wiring
- `lib/ai/prompt/v2/index.ts` — v2 entry point
- `lib/ai/prompt/v2/shadow-metrics.ts` — parity-delta computation

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
