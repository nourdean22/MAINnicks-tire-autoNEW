# ADR-0001 · AI provider chain · Venice → Ollama → OpenAI → Anthropic

**Status:** Accepted
**Date adopted:** ~v8.x baseline (codified at v9.0)
**Backfilled:** 2026-05-07 (v10.0.450)

## Context

NOUR OS is an operator-grade personal OS that runs Nick (the AI Chief
of Staff) on Nour's phone. The AI layer must be:

- **Cheap at the per-message level** (Nour chats heavily · prosumer
  budget · cost-per-turn matters more than for an enterprise app)
- **Resilient to outages** (Nick is in the daily loop · a 30-min
  provider outage = a 30-min loss of the OS's primary surface)
- **Capable of large context** (8-12K system prompt + brain wisdom
  context + tool schemas + conversation history)
- **Tool-use capable** (Nick fires `createTask` · `searchColdMemory` ·
  `recordCommitment` · 113+ tools as of v10.0.444)
- **Privacy-respecting** (Nour's brain memory, business data, and
  personal context flow through the prompt every turn)

No single provider satisfies all four constraints simultaneously.

## Decision

Use a **4-provider chain with priority order**:

1. **Venice AI** (primary) — uncensored, OpenAI-compatible, low cost
   per token, supports tool calls. Default for all task types.
2. **Ollama Cloud Pro** (co-primary, large-context promotions) —
   when `preferLargeContext: true` is set on the request. Some Venice
   models cap at 32K context; Ollama serves 128K when needed.
3. **OpenAI** (fallback #1) — GPT-4o-mini for the adversarial critic
   (see ADR-0004 sibling), GPT-4o for tool-heavy turns when Venice
   tool-calling fails.
4. **Anthropic** (fallback #2 · also primary for `aiChat()` non-stream)
   — Claude 3.5 Sonnet. Used when the first three are exhausted, AND
   for `aiChat()` calls (judge eval · adversarial critic side path)
   to leverage explicit `cacheControl: ephemeral` (90% prompt-cache
   discount on the 8-12K system prefix · see ADR-0005).

The chain rotates via `markProviderFailed(name, 60s)` (cross-request
sticky window from v9.1.27) plus same-turn fallback for synchronous
streamText throws (v10 Track B.5 · `lib/ai/stream-with-fallback.ts`).

## Consequences

**Positive:**

- Cost: most chat turns serve from Venice or Ollama at ~10-20% the
  per-token price of Anthropic. Across a heavy-use day this is the
  difference between a sustainable personal OS and a credit-card melt.
- Resilience: 4-deep fallback means a single-provider 5xx storm
  does not take Nick offline. Verified across multiple Venice
  outages where the chain rotated within the same turn.
- Tool capability preserved: Venice supports OpenAI-compatible
  function-calling, so the 113+ tool catalog works on the cheap path.
- Anthropic's `cacheControl: ephemeral` is reachable via `aiChat()`
  (judge + adversarial side calls) AND now via `streamText` after
  v10.0.446 — so when Anthropic does serve a turn, the 8-12K system
  prefix gets the 90% cache discount.

**Negative:**

- Quality variance: Venice models occasionally return malformed JSON
  or `<think>` blocks the wrong way. Mitigated by the response quality
  gate in `provider.ts` (line ~1043 garbage detection · falls through
  to next provider on garbage).
- Adversarial critic is pinned to OpenAI (response_format JSON mode +
  temperature 0.4) so a missing/rotated `OPENAI_API_KEY` silently
  no-ops the entire adversarial layer (mitigated by silent-failure
  breadcrumbs added v10.0.448).
- Chain complexity: 4 providers means 4 sets of API keys, 4 sets of
  rate limits, 4 sets of feature support tables to keep in mind.

## Alternatives considered

- **Single provider (Anthropic-only)** — rejected on cost grounds. At
  Nour's chat volume, Anthropic-primary would be ~5-10x the spend.
- **OpenAI-primary** — rejected on uncensored content needs (Venice
  handles operator-grade direct language better; OpenAI tends to
  moralize on aggressive business framing).
- **Self-hosted Ollama only (no cloud)** — rejected on availability:
  the operator's MacBook isn't always running, and the OS must be
  reachable from phone with a sub-2s response budget.
- **Venice-only with no fallback** — rejected after the first Venice
  outage made Nick unreachable for 40 minutes during a workday.

## References

- `lib/ai/provider.ts` — chain orchestration, `getModel()`,
  `markProviderFailed()`, garbage gate
- `lib/ai/stream-with-fallback.ts` — same-turn fallback for streamText
  synchronous throws (v10 Track B.5)
- `lib/ai/domain-routing.ts` — task-type → provider preference matrix
- v9.1.27 commit · cross-request rotation
- v10 Track B.5 commit · same-turn fallback
- ADR-0005 · Anthropic ephemeral cache (depends on Anthropic in chain)

## Related decisions

- The decision to use a custom fetch wrapper for Venice's
  `venice_parameters` field (vs a vanilla OpenAI SDK) is downstream
  of this choice and lives in `lib/ai/provider.ts` (~line 100).
- The 12 task-type profile mapping (factual/procedural/creative/...)
  → temperature + provider preference is downstream and lives in
  `lib/ai/turn-classifier.ts`.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
