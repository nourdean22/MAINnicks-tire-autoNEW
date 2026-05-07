# AI Evaluation Harness

> Per docs/AI_ORCHESTRATION.md: production AI features need an evaluation
> harness BEFORE shipping prompt changes. Without evals, behavior silently
> regresses.

## What lives here

Each AI feature in production gets a directory:
- `blog-seeder/` — content-generator.ts evals
- `chat-assistant/` — admin /chat NL-query evals
- (future features as added)

Each directory contains:
- `eval-set.json` — golden examples (input + expected output traits)
- `eval-runner.ts` — harness that runs the eval set against current prompt
- `criteria.ts` — pass/fail predicates (automatable)

## How to run

```bash
pnpm test:ai-evals                    # all features
pnpm test:ai-evals -- --feature blog  # one feature
```

The runner:
1. Loads the eval set + the current prompt (from production code)
2. Invokes the LLM for each example
3. Applies criteria predicates
4. Reports pass/fail summary
5. Exits non-zero if any example fails (CI-blocking)

## When to add evals for a new feature

Trigger conditions (any of):
- Feature is user-facing in production
- Feature output gets stored to DB or sent externally
- Feature has a system prompt > 50 lines
- Feature has been edited 3+ times in a quarter (signal it's high-touch)

## Adding a new eval

1. Create dir: `server/lib/ai/evals/<feature>/`
2. Write 10-20 golden inputs in `eval-set.json`
3. Define traits each output MUST have in `criteria.ts`
4. Add the runner script entry to `package.json` test scripts

See `blog-seeder/` for a complete example.

## Cost discipline

Each eval run = N inferences. Default: 10 examples × $0.005/inference =
$0.05/run. Run on every prompt change (CI). Manual cost cap if it
exceeds $1/day.

Reduce frequency on noisy outputs by:
- Deterministic eval examples (fixed seed if model supports)
- Pass/fail thresholds (90% of traits pass = OK; not 100%)
- Skip evals for whitespace-only prompt changes
