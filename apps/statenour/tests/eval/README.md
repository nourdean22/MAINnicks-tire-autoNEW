# Nick regression eval suite

LLM-as-judge regression suite for Nick. Replays a frozen seed of
scenarios, scores each via the existing `lib/ai/judge-eval.ts`
infrastructure adapted to scenario-specific criteria, writes a
timestamped report. This suite answers "did Nick's *quality* shift?"

It used to be described as the complement to a deterministic
`lib/eval/regression-runner.ts` harness that answered "did the basics
break?". **That harness was deleted on 2026-08-09** — it had no
production caller (its only importer was its own test), its
`/system/eval-results` page had already been redirected away in
`next.config.ts`, and the `eval_result` store it was meant to fill has
never had a live writer. This suite is now the only eval harness here.

## Run

```bash
# Default: dry-run · validates all scenario JSONs · no LLM calls · CI-safe
pnpm eval

# Live mode · calls Nick for every scenario · judges via aiChat · costs ¢
pnpm eval:live

# Filter by category (works in either mode)
pnpm eval --filter=decision
pnpm eval:live --filter=multi-turn

# Custom report path (live only)
pnpm eval:live --out=reports/nightly-2026-05-23.json
```

Live-mode reports land at `tests/eval/reports/<ISO-timestamp>.json` by
default. Exit codes: `0` clean, `1` schema violation, `2` any scenario
flagged (composite < 6.0 / errored).

## Scenario categories

| Category    | What it tests                                              |
|-------------|------------------------------------------------------------|
| `decision`  | Recommendation under trade-offs                            |
| `memory`    | Brain recall + fabrication-defense                         |
| `task`      | Prioritization, decisiveness                               |
| `brief`     | Structured short-form output                               |
| `edge`      | Underspecified / single-word inputs                        |
| `refusal`   | Out-of-scope handling                                      |
| `multi-turn`| Context coherence across turns                             |

## Adding a scenario

1. Drop a new `.json` file under `tests/eval/scenarios/` matching the
   Zod schema in `types.ts`. Use lowercase-slug filename ≈ scenario id.
2. Keep `judgeCriteria` between 1 and 6 entries — more dilutes signal.
3. Run `pnpm eval` to verify the schema passes.
4. Run `pnpm test tests/eval/run-suite.test.ts` to confirm uniqueness
   + breadth invariants still hold.

## What the judge measures

The judge call is scenario-specific (each scenario defines its own
criteria with weights), unlike `lib/ai/judge-eval.ts`'s fixed 5-axis
rubric. The composite score is the weighted mean of criterion scores.
Threshold `composite < 6.0` flags a scenario for review (matches the
production threshold in `judge-eval.ts`).

Provider routing follows the standard chain (`aiChat` → Venice →
Ollama → OpenAI → Anthropic per the policy matrix). The judge uses
the `classify` task profile (cheap models · gpt-4o-mini class).

## Why two modes

Dry-run is the default because:

  · It's deterministic and free
  · CI can run it on every PR without burning credits
  · It catches the most common scenario-authoring mistakes (missing
    fields, bad category enums, typos)

Live mode is operator-driven because:

  · Each run costs real money (small, but non-zero)
  · The output is most useful when comparing reports across model /
    prompt changes — not on a per-commit basis
  · The provider chain depends on env config that's typically only
    present on the operator's box

## Related infrastructure (reused, not duplicated)

  · `lib/ai/judge-eval.ts` — production LLM-as-judge (5-axis rubric)
  · `lib/ai/adversarial-critic.ts` — adversarial pre-flight critic
  · `lib/ai/output-critic.ts` — post-generation output critic
  · `lib/ai/provider.ts` — provider chain + task profiles
  · `lib/ai/judge-eval/replay.ts` — V1↔V2 prompt-builder comparator
  · `evals/nick-baseline.eval.ts` — Braintrust 20-question baseline
