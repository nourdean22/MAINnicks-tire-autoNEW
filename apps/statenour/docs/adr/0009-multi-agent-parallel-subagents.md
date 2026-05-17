# ADR-0009 · Multi-agent parallel sub-agents · pre-task fan-out + deep-research worker

**Status:** Accepted
**Date adopted:** v10.0.372 → v10.0.374 (2026-05-06)
**Backfilled:** 2026-05-07 (v10.0.458)

## Context

By v10.0.370 the brain layer's quality bar had moved past "give a
correct answer" into "give the *strongest* answer" — meaning the
answer that would survive an adversarial review by an expert in
each relevant domain. A single LLM call, no matter how well-
prompted, is biased toward its own immediate context. It can't
truly "research the question from multiple lenses simultaneously"
because it only runs one inference at a time.

The judge eval (v10.0.366) and adversarial critic (v10.0.369) had
already demonstrated that *multiple LLM passes per turn* improved
quality. Both of those run AFTER the response is generated though —
they grade and counter, but don't improve the underlying recommendation.

The next move: run multiple LLM passes BEFORE generation, in
parallel, each with a different lens. Then synthesize.

## Decision

Adopt **two complementary multi-agent patterns**:

1. **Pre-task fan-out** (`lib/ai/pretask-fanout.ts` · v10.0.372)
   - For high-stakes operator turns (decisions · strategy ·
     code review · multi-step plans), fire 3 parallel LLM calls
     before the main generation:
     - **Research lens** — what's the relevant prior art / data /
       constraint Nour might not have surfaced?
     - **Risk lens** — what's the failure mode · the case against
       the obvious move · what does the adversarial critic miss
       on a happy-path question?
     - **Plan lens** — if the answer is "do X", what's the
        ordered sequence + the reversibility checkpoints?
   - The 3 lens outputs are short (~150 tokens each) and feed
     into the main generation as additional context, scoped to
     the current turn.

2. **Deep-research worker** (`lib/ai/deep-research.ts` · v10.0.373)
   - For research-heavy turns where the operator needs grounded
     evidence, spawn a longer-running async worker that runs
     multiple recursive searches against the brain corpus +
     external data + Perplexity (web search) and synthesizes a
     dossier. Returns within ~30s (vs the 2-3s primary chat
     budget) but the result is much higher quality on
     "investigate X" prompts.

The orchestrator (`lib/ai/multi-agent-orchestrator.ts` · v10.0.374)
gates which pattern fires per turn. Casual chat → no extra agents.
Decision/strategy/code → pre-task fan-out. Research-heavy → deep-
research worker. Operator can also explicitly request a mode via
the `/battle` `/reflect` `/execute` mode personas (see operator-
rules.ts).

## Consequences

**Positive:**

- Quality lift on the kinds of turns where Nour actually needs
  the OS to be smart. Casual chat gets the same fast Venice/Ollama
  generation as before; the multi-agent layer is opt-in based on
  intent classification.
- Each lens runs in parallel (`Promise.all`) so the latency cost
  is the SLOWEST of the 3, not the SUM. With 3 parallel calls at
  ~600-800ms each, total wall-clock is ~800ms (the slowest one)
  before the main generation begins.
- The 3-lens model maps to the 3 most common "missed" failure
  modes: **research** (didn't surface relevant prior art) ·
  **risk** (didn't think about what could go wrong) · **plan**
  (gave a verb without a sequence). Each lens is a discrete
  remediation for a discrete failure mode.
- Deep-research worker decoupled from chat latency budget · the
  operator can fire-and-forget a research task and check back
  for the synthesized dossier later.

**Negative:**

- Cost. 3 extra LLM calls per gated turn ≈ 3-4× the per-turn
  spend on those turns. Mitigated by the 4-provider chain
  (ADR-0001) so the lenses serve from cheap providers · the main
  generation can still go to a stronger model.
- Latency. Adds ~600-800ms before generation starts on gated
  turns. Acceptable for "decision/strategy" intent (the operator
  is pausing to think anyway) but unacceptable for casual chat
  (which is why the orchestrator gates).
- Cognitive load on prompt engineering. Each lens needs its own
  scoped prompt. Drift between the 3 lens prompts and the main
  system prompt is a real maintenance cost.
- Synchronization. If a lens fails (timeout, garbage), the
  orchestrator must decide whether to wait, drop, or retry.
  Currently drop-and-proceed; documented in withGuardian
  (ADR-0004).

## Alternatives considered

- **Single bigger LLM call with elaborate system prompt** —
  rejected. Tried at v10.0.305-ish. The quality lift was real
  but plateaued — the LLM still anchors on its first inferred
  answer and doesn't truly "consider alternatives" in a single
  pass.
- **Sequential chain-of-thought (think step-by-step)** —
  rejected. Adds latency without parallel-thinking benefit.
  CoT is good for arithmetic / structured reasoning; not for
  "what am I missing about this strategic decision."
- **Operator-driven manual lens invocation** (always require
  `/research` or `/risk` prefix) — rejected on ergonomics.
  The orchestrator's intent classifier should make this
  automatic for the operator.
- **MoE-style ensemble with weighted vote** — overkill at single-
  operator scale. The 3 lenses don't vote · they contribute
  context to a single final generation.

## References

- `lib/ai/pretask-fanout.ts` — 3-lens fan-out (research / risk /
  plan)
- `lib/ai/deep-research.ts` — async research worker
- `lib/ai/multi-agent-orchestrator.ts` — turn-level gating
- `lib/ai/intent-classifier.ts` — which intent → which agent path
- `lib/ai/prompt/policy/operator-rules.ts` MODE_PERSONAS —
  explicit `/battle` `/reflect` `/execute` mode opt-ins
- v10.0.372 commit · pre-task fan-out introduction
- v10.0.373 commit · deep-research worker
- v10.0.374 commit · orchestrator gating
- ADR-0001 · provider chain (cheap providers serve the lenses)
- ADR-0002 · CoALA recall (the lenses query the brain corpus)
- ADR-0004 · withGuardian (failure-handling for lens timeouts)

## Open items

- ~~Cost telemetry per-lens~~ · **CLOSED v10.0.472** · each lens
  fires through `instrumentedLens()` (`lib/ai/pretask-fanout.ts:127`)
  which writes a `SystemMetric` row keyed `pretask.lens.{research|
  risk|plan}` with `value=estimatedTokens`, `unit=tokens`, and tags
  `{lens, durationMs, success, outputChars}`. Telemetry is
  fire-and-forget so it never blocks the lens result. Aggregation
  queries can now answer "which lens delivers the most token-spend
  per unit quality" (quality signal via judge-eval cross-reference).
- Lens prompt drift detection · the 3 lens prompts currently
  live in 3 separate files. If drift accumulates between them,
  quality degrades unevenly. A periodic prompt-quality audit
  (per the v10.0.444 audit pattern) on the lens prompts
  specifically.
- Adaptive gating · today the orchestrator uses static rules
  for which intent fires which agent path. With enough turn-level
  data, the gate could be a learned classifier on past judge-eval
  scores ("turns that scored low on evidence axis would have
  benefited from research lens").

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
