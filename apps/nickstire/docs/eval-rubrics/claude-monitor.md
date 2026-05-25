# Claude / Anthropic API Cost Monitoring

**Skill port:** B4 · claude-monitor
**Applies to:** every Anthropic API call across nickstire + statenour (chat route, page-insight, improve-agent, brain/board consult, agentic-auditor, vapi-call-eval, lane-check, suggestions, autocomplete, claim-warnings, etc.)
**Authored:** 2026-05-26.

## Why this doc exists

Audit findings #244, #245, #185 + the invokeLLM-bypass cluster · LLM API usage is largely unbudgeted across the codebase. A single buggy cron or a runaway chat session can burn $50-$200/day silently. No dashboard exists to see "how much did we spend on Anthropic this week, by surface?"

This doc defines the monitoring framework. Implementation is queued.

## The 3 levels of LLM cost monitoring

### Level 1 · Per-call observability

Every Anthropic API call writes one row to a structured log:

```typescript
type LLMCallLog = {
  id: string;
  timestamp: Date;
  surface: "chat" | "improve-agent" | "vapi-eval" | "consult-board" | "auditor" | "page-insight" | "autocomplete" | "lane-check" | "suggestions" | "claim-warnings";
  model: string;                  // "claude-3-5-sonnet-20241022" etc.
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;      // post Wave R prompt-caching deepening
  cache_creation_tokens: number;
  cost_usd: number;               // computed from tokens × model rate
  duration_ms: number;
  cache_hit: boolean;
  conversation_id: string | null; // ties back to user session
  customer_id: number | null;     // ties back to business event (if applicable)
};
```

Writes to `llm_call_log` table · indexed on (surface, timestamp DESC) for fast queries.

### Level 2 · Aggregated dashboard tile

Single tile on operator's Today page · 3-line pattern per Wave W dashboard-storytelling.md:

```
$47.32              ← yesterday's total spend
↓ 12% vs 7d avg    ← comparison
Chat leading.       ← surface narrative
```

Drill-through shows breakdown by surface:

| Surface | Yesterday | 7d avg | Trend |
|---|---|---|---|
| chat | $28.40 | $32.10 | ↓ 12% |
| improve-agent | $8.20 | $7.80 | ↑ 5% |
| vapi-eval | $6.10 | $5.90 | ↑ 3% |
| consult-board | $3.40 | $2.20 | ↑ 55% ⚠️ |
| auditor | $0.92 | $0.85 | ↑ 8% |
| page-insight | $0.30 | $0.20 | ↑ 50% |

Up-arrow on any surface > 50% week-over-week triggers a Telegram nudge ("check consult-board · spend +55% wk/wk").

### Level 3 · Per-surface budget gates

Each surface has a daily budget cap. When exceeded, the surface returns a graceful "budget-exhausted" message + alerts operator. The Wave H · activeProviderSupportsTools fix is the right pattern · explicit allowlist · graceful fail.

Default daily caps:

| Surface | Cap | Rationale |
|---|---|---|
| chat | $40 | Operator's main surface · high cap |
| improve-agent | $15 | Background · should be cheap |
| vapi-eval | $10 | Per-call eval · ~$0.50/call max |
| consult-board | $5 | 6 advisors × per-consult · low frequency |
| auditor | $2 | Background nightly |
| page-insight | $2 | Operator-triggered · low frequency |
| autocomplete | $1 | Per-keystroke · MUST cache |
| lane-check | $1 | Pre-send validation · low cost expected |
| suggestions | $1 | Prefetched · cached |
| claim-warnings | $1 | Per-claim · low frequency |

Total daily budget across surfaces · $78. Monthly · ~$2,300. Operator can raise caps via env var `LLM_BUDGET_CAP_<surface>_USD=N`.

## Cache discipline

Anthropic prompt caching cuts input-token cost 90% for cached portions. Wave R closed the page-insight gap; remaining surfaces should adopt the same pattern:

| Surface | Cache state | Action |
|---|---|---|
| chat (`/api/ai/chat`) | Live (Wave 446) | Verify cache hit rate >70% in metrics |
| page-insight | Wave R · just shipped | Monitor cache hit rate after Railway deploys |
| consult-board (6 advisors) | Unknown | Audit · likely missing cache · 6× cost potential |
| improve-agent | Unknown | Audit · daily cron · big context |
| vapi-eval | Unknown | Audit · per-call · transcript is the per-turn-fresh portion |
| auditor | Unknown | Audit |
| autocomplete | Should be cached aggressively | Audit |

Cache hit rate is a per-surface SLI (per slos.md) · target >70% on chat / page-insight / consult-board.

## Cost-cutting techniques (ordered by ROI)

1. **Prompt caching** · 90% reduction on cached portions · already partial · finish the audit
2. **Batch API** · 40% reduction on non-real-time bulk workloads · candidates · `vapi-call-eval` daily cron, `improve-agent` daily cron, `agentic-auditor` daily cron. Migration is non-trivial · but a single migrate of these 3 surfaces could cut $5-10/day. (A6 from audit's Round 2)
3. **Model downshifting** · Sonnet 4.6 vs Haiku · Haiku is 4x cheaper. Most internal surfaces (auditor, suggestions, claim-warnings) probably don't need Sonnet. Audit per surface · use Haiku where quality difference is invisible.
4. **Output token cap** · `maxOutputTokens: 600` (page-insight already does this) · most surfaces don't need 4096 tokens of output · cap aggressively
5. **Context pruning** · trim chat history at 8K tokens, not 100K · pass only recent + summary

## Anti-patterns

### "Unbounded chat history"

Sending the full conversation history every turn · costs scale with N². Audit each chat surface · cap history at ~10 turns OR use rolling summary.

### "Per-keystroke autocomplete without cache"

Autocomplete that hits Anthropic per keystroke without caching the system prompt · burns $0.001-0.01 per request · 100 keystrokes × 100 ops/day = $10-$100/day. ALWAYS cache.

### "Tools that hand the model 50-tool catalog every call"

Tool descriptions ARE input tokens · 138 tools × ~100 tokens each = 13,800 tokens of pure tool-list per call. Filter the tool catalog by surface (chat needs different tools than improve-agent) · or use lazy-tool-loading.

### "No surface attribution"

Calls log to `console.log` without a surface tag · impossible to attribute spend to a code path · impossible to know what to optimize. Every call MUST tag its surface.

## Implementation plan (queued)

1. Migration · create `llm_call_log` table per Level 1 schema
2. Wrap the Anthropic SDK client with a logging interceptor · every `.messages.create()` writes a row
3. Build `/admin/llm-spend` page with the Level 2 dashboard
4. Wire budget caps via env-var · refuse calls when cap exceeded · Telegram alert at 80%
5. Run the cache-audit · identify the gap surfaces · ship Wave R-style fixes per surface
6. A6 batch API migration for the 3 daily-cron surfaces (vapi-eval, improve-agent, auditor)

## Skill-port lineage

B4 from the audit's Round 2. Companion to:
- A6 · claude-api batch (the cost-cut implementation companion)
- Wave R · prompt-caching gap (the cache discipline this monitors)
- B2 · SLOs (LLM-cost-per-conversation is one of the SLIs)
- Audit #244 / #245 / #185 · the budget-bypass findings this fix renders observable

Future · once monitoring lands, the data drives RL of the prompts themselves · cheaper prompts that maintain quality · feedback loop · ~30% cost reduction achievable.
