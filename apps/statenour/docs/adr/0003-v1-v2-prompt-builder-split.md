# ADR-0003 · v1 / v2 prompt builder split · shadow-mode parity

**Status:** Accepted
**Date adopted:** v9.2 (separation) → v10.0.404 (operator-rules consolidation)
**Backfilled:** 2026-05-07 (v10.0.450)

## Context

By v9.0 the system prompt had grown to ~1,800 lines of prompt-building
logic in a single flat function (`buildSystemPromptUncached` in
`lib/ai/system-prompt.ts`). It was producing real behavioral defects:

- **Hardcoded magnitudes treated as facts** — Nick was citing
  "missing 3+ workouts → revenue dip in 5 days" and "each hour
  unanswered = -15% conversion" as measured numbers when they were
  hypothesis-grade observations Nour had surfaced in conversation.
- **Cache-unfriendly construction** — dynamic timestamps and live
  data were interleaved with the static prefix, breaking any
  prefix-based caching (Anthropic ephemeral · OpenAI auto-cache).
- **Operator-policy duplication** — the same rules ("don't auto-
  taskify casual mentions" · "no sycophancy" · brevity defaults) were
  re-stated in 3-4 places across `system-prompt.ts` and inline in
  the chat route.

A clean rewrite was tempting but risky: the v1 builder had been
tuned through dozens of operator-feedback loops, and a hard cutover
could regress behaviors that were correct for non-obvious reasons.

## Decision

Adopt a **dual-builder architecture with shadow-mode parity testing**:

1. **v1 (`lib/ai/system-prompt.ts`)** · the legacy flat builder,
   continues to serve production traffic.
2. **v2 (`lib/ai/prompt/v2/index.ts`)** · a typed-struct builder with
   stable static prefix, hypothesis-framed pattern blocks
   (`inferred-patterns.ts`), centralized operator-rules, and clean
   cache breakpoint placement.
3. **Shadow mode** · gated by `NICK_PRIME_PROMPT` feature flag. When
   v2 is shadow-active, both builders run in parallel; only v1's
   output reaches the model. v2's output is logged to a
   `sectionsOnlyInV1` / `sectionsOnlyInV2` diff metric so we can
   measure parity drift before cutover.
4. **Centralized operator-rules** · `lib/ai/prompt/policy/operator-
   rules.ts` (v10.0.404) holds 8 named exports (`DO_NOT_AUTO_TASKIFY`,
   `NO_SYCOPHANCY`, `BREVITY_DEFAULT`, `INLINE_CITATIONS`,
   `CONFIDENCE_CUES`, `TIME_OF_DAY_VOICE`, `MODE_PERSONAS`,
   `TRUTH_RULE_NEVER_FABRICATE`). Both v1 and v2 import from this
   single source of truth — no more 3-way drift.

## Consequences

**Positive:**

- v1 keeps shipping production traffic while v2 is being parity-
  tuned · zero risk of cutover regression.
- The `inferred-patterns.ts` hypothesis-framing pattern (no
  hardcoded magnitudes) was developed in v2, then back-ported into
  v1 at v10.0.445 as part of the prompt-quality audit. Both
  builders now agree on the most-dangerous failure mode (Nick
  fabricating precision).
- Operator-rule changes happen in one file, automatically applied
  to both builders. The 8 rules are reviewable as code.
- Cache friendliness is structural in v2 (typed sections in stable
  order) vs accidental in v1 (any inline edit can leak dynamic
  content into the cached prefix).

**Negative:**

- Two builders to maintain · drift risk · the v10.0.444 prompt audit
  found 5 cases where v1 had diverged from v2 (causation magnitudes,
  response-style word counts, temporal section overlap, etc.). All
  closed in v10.0.445-447 but the maintenance cost is real.
- `sectionsOnlyInV1` metric is logged but not surfaced on the
  observability dashboard — operator can't easily see parity drift.
  Open item.
- Cutover date is unset. Shadow mode has been running since v9.2;
  cutover criteria (parity ≥ 95%? judge eval delta < 5%?) are not
  formally defined.

## Alternatives considered

- **Hard cutover from v1 to v2** — rejected. Too much accumulated
  tuning in v1 to risk a single-jump migration.
- **Branch-based parallel builds** — rejected. A long-running
  feature branch would diverge from `codex/ollama-local` faster than
  it could converge.
- **Refactor v1 in place** — rejected. The flat 1,800-line function
  was structurally resistant to incremental cleanup; each "small"
  refactor risked breaking a tuned section.
- **AI-generated diff between builders** — rejected as too noisy.
  The shadow-mode parity logging captures the same information at
  lower cost.

## References

- `lib/ai/system-prompt.ts` — v1 builder · production
- `lib/ai/prompt/v2/index.ts` — v2 builder · feature-flagged
- `lib/ai/prompt/v2/renderer.ts` — typed section renderer
- `lib/ai/prompt/static.ts` — v2 stable prefix
- `lib/ai/prompt/inferred-patterns.ts` — hypothesis-framed patterns
- `lib/ai/prompt/policy/operator-rules.ts` — 8 centralized rules
- v9.2 commit · v2 introduction
- v10.0.404 commit · operator-rules consolidation
- v10.0.445-447 commits · v1 backports closing the drift
- ADR-0005 · Anthropic ephemeral cache (depends on stable prefix
  shape that v2 makes easier)

## Open items

- Define formal cutover criteria (parity threshold + judge-eval
  delta + manual review checklist).
- Surface the `sectionsOnlyInV1` / `sectionsOnlyInV2` parity metric
  on `/system/observability` so the operator can see drift in real
  time.
- Decide whether to delete v1 post-cutover (vs keeping it as a
  rollback escape hatch).

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
