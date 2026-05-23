# ADR-0019 · Explicit operator-state model · LeCun-lens consolidation

**Status:** ACCEPTED · 2026-05-23
**Companion code:** `lib/services/operator-state.ts` · `lib/services/judge-calibration.ts` · `app/(mastery)/system/operator-state/page.tsx` · `system.operatorState` + `system.judgeEvalCalibration` tRPC procedures
**Tasks:** #22 slice 5.3 (operator-state) · 5.4 (diagnostic surface) · 5.5 (judge calibration) · 5.6 (this doc)

## Context

Nick — statenour's embedded operator coach — adapts tone to the
operator's emotional + cognitive state. Today that adaptation is
purely **autoregressive**: the model reads the current chat turn,
infers from word choice + content density + recent reactions whether
the operator seems energized / stuck / scattered, and adjusts.

This is the failure mode Yann LeCun keeps naming. Autoregressive
inference of state has two structural problems:

1. **The signal is weak.** The chat turn is a thin slice of the
   operator's day. State on Sunday afternoon when the operator is
   resting is different from state on Tuesday morning when 19 tasks
   are open — but the model only sees the keystrokes of the moment.
2. **The errors are silent.** When the model gets it wrong, there's
   no telemetry. Nick pep-talks an exhausted operator and the
   operator just gets more exhausted; nobody catches the miscall.

Meanwhile the application database has the actual ground-truth
signals — TaskEvent stream, Task counts by status, recent completion
rate, baseline-completion rate, open-DOING vs closed-recently ratio.
These are deterministic, observable, and have no shared blind spot
with the LLM doing chat.

The parallel problem on the AI-quality stack: judge-eval (V1 vs V2)
runs an LLM judge over LLM outputs. Both share priors. If the V2
prompt encodes a regression that flatters the judge's preferences,
the comparator says "V2 wins" and we ship the regression. Same
LeCun failure — no ground truth in the loop.

## Decision

Introduce **two complementary world-model surfaces**, each
deterministic + ground-truth + queryable, that future AI surfaces
can opt into:

### 1. Operator-state model

A pure 5-dimensional snapshot computed from existing DB signals.

| Dimension | Source | Range | Default |
|---|---|---|---|
| focus | last-24h TaskEvent completion-rate over completion+start | 0-1 | 0.5 |
| capacity | today completions vs 7-day-baseline | 0-1 | 0.5 |
| drift | open DOING tasks vs recent completions | 0-1 | 0 |
| momentum | first-3-days vs last-3-days of 7-day rolling completions | 0-1 | 0.5 |
| mood | qualitative tag derived from the four numerics | enum | "neutral" |

Plus a confidence score (0 when no DB data; rises with signal volume)
and a list of typed signals (the raw counts behind the dimensions ·
exposed for inspection).

Pure functions are unit-tested; the top-level `currentOperatorState()`
does 3 Prisma queries and degrades to zero-confidence defaults on
error. The model is read-only and idempotent — safe to call per turn.

`formatOperatorStateBlock(state)` produces a ~5-line system-prompt
fragment that any AI surface can opt into. **It is NOT wired into
`/chat` in this ADR's scope** — the chat path is off-limits per
operator directive while the substrate proves out. The diagnostic
surface at `/system/operator-state` shows exactly what Nick would
see if a surface opted in, so the operator can audit before opting
anything in.

### 2. Judge-eval ground-truth calibration

A second deterministic check, this one on the AI-quality loop. Joins
`PROMPT_COMPARISON_RUN` rows (judge verdicts) against
`ChatMessage.feedbackScore` (operator's real thumbs reactions on the
V2 reply) via `sourceMessageId`.

4-cell confusion matrix:

|  | human +1 | human −1 |
|---|---|---|
| **judge picked v2** | agree (judge predicted V2 was good · operator confirmed) | disagree · false positive |
| **judge picked v1** | disagree · false negative | agree (judge said V2 lost · operator confirmed) |

Verdict bands: well-calibrated (≥70% agreement · n≥30), moderate
(50-69%), miscalibrated (<50%), preliminary (n<30).

The calibration metric is exposed on `/system/judge-eval` next to
the existing V1→V2 verdict chip. The V2 cutover plan's Phase-1
"safe" verdict is no longer sufficient on its own — the calibration
verdict must ALSO read "well-calibrated" or "moderate" before
canary expansion.

## Consequences

### Positive
- **Decouples Nick's tone adaptation from autoregressive inference.**
  Any AI surface can now opt into deterministic state grounding.
- **Closes the AI-quality ground-truth gap.** V1→V2 cutover decision
  now has a falsifiable check that doesn't share priors with the
  thing being measured.
- **No new schema.** Both metrics ride existing tables (TaskEvent +
  Task for operator-state · BrainMemory(PROMPT_COMPARISON_RUN) +
  ChatMessage for calibration). Zero migration risk.
- **Cheap.** Operator-state = 3 Prisma queries; calibration = 2
  queries + in-memory join. Both safe to call per-page-load.
- **Auditable.** `/system/operator-state` shows the prompt block
  that would be injected; `/system/judge-eval` shows the confusion
  matrix that informed the calibration verdict. The operator can
  inspect both before trusting either downstream.

### Negative
- **Operator-state is not yet wired into any consumer.** Substrate
  only · payoff requires a follow-up slice to opt a specific AI
  surface in. A future ADR (or extension of this one) will document
  the wiring decision per surface.
- **Calibration sample size grows slowly.** Operator gives
  feedback (+1/-1) on a small fraction of chat replies; preliminary
  verdict ("n<30") will likely persist for weeks. This is an
  acceptable cost · the metric is more important than its
  frequency.
- **One more thing to maintain.** Two new services + page + tests
  + tRPC procedures. Mitigated by the pure-function design
  (operator-state component fns are 5-20 lines each).

### Neutral
- The 5-dimension choice is deliberate · matches the operator's
  natural taxonomy ("am I focused / depleted / drifting / building
  momentum?") rather than the model's preferred dimensions. If a
  6th dimension proves necessary (e.g. "external interruption
  rate"), extend the type and re-add fields.

## Alternatives considered

1. **Wire operator-state directly into `/chat`'s system prompt now.**
   Rejected · the chat path is the highest-blast-radius surface in
   the app and the operator has a standing directive to keep changes
   off it during the LeCun consolidation. Substrate-first is safer.
2. **Train a small classifier to predict mood from chat text.**
   Rejected · re-creates the autoregressive failure mode with extra
   ML overhead. The whole point is to escape the LLM-on-LLM trap.
3. **Defer the calibration metric until "we have enough samples".**
   Rejected · the metric needs to exist BEFORE samples accumulate,
   otherwise we ship V2 on judge verdict alone and discover
   miscalibration after the fact.
4. **One big "operator state" object that includes calibration.**
   Rejected · these are different ground-truth signals (operator's
   workload vs operator's chat preferences) and conflating them
   complicates future consumers. Keep them separate.

## Open items

- Pick the first AI surface to opt into operator-state. Candidates:
  daily morning brief (low blast radius · high payoff for tone
  matching), `/api/ai/page-insight` (already a small surface),
  NickSuggestions chip generator (heavy state-sensitivity).
- Decide what to do when calibration reads "miscalibrated" · pause
  the V2 canary? Re-train the judge? Surface the disagreement
  cases for manual review? (Answer likely depends on which cases
  are disagreeing · the per-intent breakdown on the dashboard
  will surface this once n≥30.)
