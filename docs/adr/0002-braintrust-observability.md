# ADR-0002 · Adopt Braintrust for eval + observability

- **Status**: Accepted · 2026-05-17
- **Operator**: nour
- **Author**: Claude (Wave-200 brainstorm session)
- **Supersedes**: home-grown `eval_result` BrainMemory category + nightly `agent-eval` cron + the `/system/eval-results` page backend (the page survives, the backend swaps)

## Context

Today's eval setup:
- Nightly `agent-eval` cron runs ~75 questions against the chat pipeline
- Results written as BrainMemory rows (category `eval_result`)
- `/system/eval-results` page (built today during the coherency sweep) shows the latest run
- `EvalRegressionCard` component renders the pass-rate trend on `/system/cockpit`

What's missing:
- **No in-flight production scoring**. The 75-question eval set is synthetic — it doesn't catch issues with real conversations.
- **No "production trace → eval case" pipeline**. When Nick says something wrong, we have no one-click path to add it as a regression test.
- **No LLM-as-judge on live traffic**. We only score the synthetic batch.
- **No CI gate**. Eval pass-rate can drop without alarms.

## Decision

Adopt **Braintrust** as the unified eval + observability platform.

Braintrust is the only platform that connects evals + production traces in one workflow:
- Every production trace becomes a potential test case (one-click conversion)
- LLM-as-judge runs **inline** on live traces (not just on synthetic batches)
- Online scorers surface quality regressions in real time
- CI integration: PRs run the full eval suite before merge

## Why Braintrust over the alternatives

| Option | Why rejected |
|---|---|
| **Helicone** | Maintenance mode after Mintlify acq · used to be the "lightweight proxy" default · now stuck. Production teams are migrating off. |
| **Langfuse** | Open-source · good observability · weaker on evals. The eval workflow is bolted on, not native. |
| **LangSmith** | LangChain-flavor only · we're not on LangChain. |
| **Laminar** | Smaller player · less mature SaaS · the kind of thing we'd self-host if we had infra time. |
| **Confident-AI** | Eval-only · no observability story · would need to pair with another tool. |
| **Roll our own (extend BrainMemory + nightly cron)** | We've been doing this. It's why /system/eval-results showed 0/75 passed when we hit it — the substrate works, the workflow doesn't. The cost of getting to Braintrust-parity ourselves is months. |

The decision-maker: **the production trace → eval case loop**. Every other tool requires manual eval-set curation. Braintrust automates it. That's the compounding effect.

## How it integrates with what we have

| Layer | Today | After Braintrust |
|---|---|---|
| Chat call | `/api/ai/chat/route.ts` calls AI SDK | Same · plus `wrap(model)` from `braintrust` package around the model call |
| Trace logging | nothing | Every call auto-logged · prompt + tools + output + latency + cost |
| Eval set | nightly cron · 75 synthetic questions | Same nightly cron · PLUS real production traces marked as gold/silver/skip |
| Live scoring | nothing | LLM-as-judge runs on every Nth production trace · scores 4 axes (correctness · tool-use · drift · brevity) |
| Pass-rate trend | `EvalRegressionCard` reads BrainMemory | Same card · reads Braintrust API · cleaner data |
| Alerts | none | Braintrust dashboard alerts on quality regression · webhook → Telegram |
| CI | none | GitHub Action runs evals on every PR · blocks merge if pass-rate drops |

## Consequences

### Positive
- Quality compounds automatically. Every production failure becomes a regression test for the next deploy.
- Zero manual eval-set curation after Phase 1 (operator stops writing synthetic questions).
- LLM-as-judge gives a numeric pass-rate every day, not every nightly run.
- CI gate prevents quality regressions from shipping.
- Cost-tracking + latency-tracking come for free.

### Negative
- Net cost: $0 on the free tier (1M spans/month) → ~$50/mo when we cross. Predictable.
- Data exits the org: production traces (including memory recalls + tool calls) go to Braintrust's API. Per Braintrust's docs they're SOC2 + GDPR · operator-acceptable for this use case.
- Wrapping every LLM call adds ~5ms latency (negligible vs the 500-2000ms LLM call itself).

### Neutral
- The existing `/system/eval-results` page survives. We just swap the backend from BrainMemory to Braintrust API. The UI stays.

## Implementation phases

See `docs/WAVE-200-PLAN.md` § "Sequenced execution".

- **Phase 0** (this commit): `braintrust` package installed · BRAINTRUST_API_KEY env stub added · no traces logged yet
- **Phase 1**: wrap the Mastra agent's model + 5 starter tools · seed 20-question Braintrust eval suite
- **Phase 2**: production traces flow live · LLM-as-judge scoring inline
- **Phase 3**: GitHub Action CI gate on PRs

## Operator action items (before Phase 1)

1. Visit <https://braintrust.dev> · sign up · create a project (suggest name: `statenour-nick`)
2. Generate an API key · copy
3. Set in Railway statenour-web env:
   ```
   BRAINTRUST_API_KEY=<the key>
   BRAINTRUST_PROJECT_NAME=statenour-nick
   ```
4. Tell Claude · Phase 1 cutover starts

## Verification

- Phase 0 acceptance: `pnpm tsc --noEmit` clean post-install · package importable
- Phase 1 acceptance: production trace count > 100 in Braintrust dashboard · eval pass-rate baseline established
- Rollback: remove `wrap(model)` calls · drop `braintrust` import · eval falls back to BrainMemory pattern

## References

- Braintrust docs: <https://www.braintrust.dev/docs>
- Agent observability comparison: <https://www.braintrust.dev/articles/agent-observability-complete-guide-2026>
- Helicone status: now in maintenance after Mintlify acquisition (Q1 2026)
