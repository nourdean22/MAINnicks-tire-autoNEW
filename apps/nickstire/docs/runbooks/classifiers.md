# HuggingFace Classifier Service · Runbook

**Owner:** operator (Nour)
**Module:** `apps/nickstire/server/services/classifiers.ts`
**Skill-port:** Category 3 of `docs/eval-rubrics/huggingface-model-strategy.md`
**Last updated:** 2026-05-26

## What this is

Two specialist HF classifiers that pre-filter customer input before any expensive LLM call:

1. **`screenPromptInjection(text)`** · catches "ignore previous instructions" attacks at the input boundary. Closes a security gap not covered by zod or rate-limiting.
2. **`classifyIntent(text, labels?)`** · routes inbound SMS by intent (price / scheduling / complaint / opt-out / off-topic) without burning a Claude call per message.

Both are **feature-flag-gated** and **fail-open** · they never block customer-facing flow if HF is down. They're additive: existing call sites work unchanged until a feature surface explicitly opts in.

## Activation (operator-action)

### Step 1 · Get an HF Inference API key

1. Sign up at https://huggingface.co/join (free)
2. Settings → Access Tokens → Create New Token
3. Permissions: **read** is enough (Inference API endpoint)
4. Copy the `hf_xxx...` value

### Step 2 · Set the env var on Railway

```
HF_API_KEY=hf_xxxxxxxxxxxxxxxxx
```

Optional · override the default models:

```
CLASSIFIER_PI_MODEL=protectai/deberta-v3-base-prompt-injection-v2   # default
CLASSIFIER_INTENT_MODEL=MoritzLaurer/deberta-v3-large-zeroshot-v2.0 # default
```

The defaults are the recommended picks · only override if you've benchmarked alternatives.

### Step 3 · Enable feature flags (gradual rollout)

From admin tab via `featureFlags.toggle` mutation OR /admin/system/flags UI:

```
classifier_prompt_injection_enabled = true   # start here · pure defense
classifier_intent_routing_enabled  = true    # turn on once you've wired call sites
```

**Recommended rollout:**
1. Enable `classifier_prompt_injection_enabled` first · zero behavior change unless someone tries an injection
2. Verify HF reachability via `/api/health?classifier=true` (returns reachable: true)
3. Wire prompt-injection screening into VAPI webhook + chat input one at a time
4. Once stable, enable `classifier_intent_routing_enabled` + wire into SMS-router pre-filter

### Step 4 · Verify reachability

```typescript
const { checkClassifierHealth } = await import("./services/classifiers");
const h = await checkClassifierHealth();
// { promptInjection: { enabled: true, reachable: true },
//   intent: { enabled: true, reachable: true } }
```

If `reachable: false` with `error: "model_loading"`, wait 60s and retry · HF cold-loads models on first request (~30-60s) then keeps them warm for ~15 min of idle.

## How to use

### Prompt-injection screening · VAPI input

In `apps/nickstire/server/routes/webhooks/vapi.ts`, gate inbound transcript with a fail-open check:

```typescript
import { screenPromptInjection } from "../../services/classifiers";

const transcript = event.artifact?.transcript ?? event.transcript ?? "";
const screen = await screenPromptInjection(transcript);

if (screen.ok && screen.isInjection) {
  log.warn("VAPI input flagged as prompt-injection", {
    score: screen.score,
    callSid: event.call.id,
  });
  // Don't pass to the agent · short-circuit to a safe canned response
  return res.status(200).json({
    result: "I didn't catch that · could you say it again or press 0 to speak to a human?",
  });
}
// Continue normal flow
```

### Prompt-injection screening · chat widget

In `apps/nickstire/server/routers/nick/chat.ts` (the customer-facing chat tRPC), screen before any LLM call:

```typescript
const screen = await screenPromptInjection(input.message);
if (screen.ok && screen.isInjection) {
  return {
    reply: "I can only help with car-service questions. What can I help you with?",
    flagged: true,
  };
}
```

### Intent classification · SMS routing pre-filter

In `apps/nickstire/server/services/smsResponseParser.ts` (existing intent parser), use HF classifier as the first stage before keyword-based parsing:

```typescript
import { classifyIntent, NICKSTIRE_SMS_INTENT_LABELS } from "./classifiers";

export async function parseSmsResponseWithClassifier(body: string) {
  const cls = await classifyIntent(body, { labels: NICKSTIRE_SMS_INTENT_LABELS });
  if (cls.ok && cls.topScore > 0.6) {
    // High-confidence HF classification · short-circuit keyword path
    return {
      intent: mapHfLabelToIntent(cls.topLabel),
      confidence: cls.topScore,
      source: "hf-classifier",
    };
  }
  // Fall through to existing keyword-based parser
  return parseSmsResponse(body);
}

function mapHfLabelToIntent(label: string): string {
  if (label.includes("opt") || label.includes("STOP")) return "opt_out";
  if (label.includes("price")) return "price_question";
  if (label.includes("brake")) return "brake_inquiry";
  if (label.includes("oil")) return "oil_inquiry";
  if (label.includes("appoint")) return "scheduling";
  if (label.includes("complaint")) return "complaint";
  if (label.includes("spam") || label.includes("off-topic")) return "off_topic";
  return "general";
}
```

## Cost & latency

| Item | Cost | Latency |
|---|---|---|
| Per HF Inference API call | ~$0.0001 | 200-400ms (warm) · 30-60s (cold-load) |
| 10,000 calls / day | ~$1.00 | n/a |
| 100,000 calls / day | ~$10/mo | n/a (warm) |

**Promotion to Inference Endpoints** · when monthly bill exceeds $50 ($50 / $0.0001 ≈ 500k calls), migrate to HF Inference Endpoints (dedicated GPU box · ~$0.05/hr · breakeven near 100k calls/day). The classifiers.ts module supports this via `CLASSIFIER_*_MODEL` env var override pointing to a custom endpoint URL.

## Anti-patterns

### "Block customer-facing flow on classifier outage"

The classifier is a PRE-FILTER, not a gate. If HF is down, the caller proceeds as if no classifier ran. The fail-open pattern is enforced in `classifiers.ts` · do NOT bypass with `await ... || throw`.

### "Use injection threshold below 0.5"

False positives block legit customers. Default threshold 0.7 is conservative on purpose. Raising to 0.85 if you see false-positive complaints; lowering to 0.6 only if you see successful injections in logs.

### "Send classifier output directly to customer"

The classifier produces a label · the CALLER decides the customer-facing response. Never echo "this looks like spam" back · use canned safe replies that don't reveal the screening.

### "Skip the keyword parser once HF is on"

Keep the keyword parser as fallback. HF accuracy is ~92% on this label set · the keyword parser catches the 8% misses on critical intents (especially "STOP" which is TCPA-critical · the keyword path MUST always run for opt-out).

## Monitoring

Once both flags are on, add to operator dashboard:

| Metric | Target |
|---|---|
| Classifier call volume / day | Track baseline |
| Classifier latency p95 | <500ms |
| HF API error rate | <1% |
| Prompt-injection detections / day | Track · expect ~0 (rare attack) · investigate spikes |
| Intent classifier agreement with keyword parser | >85% (lower = parser drift) |

Sample SQL · adding to `dashboardStats` query in `nick/intelligence.ts`:

```sql
SELECT
  DATE(createdAt) as day,
  COUNT(*) FILTER (WHERE metadata->>'classifier_source' = 'hf') as hf_calls,
  COUNT(*) FILTER (WHERE metadata->>'classifier_pi_flagged' = 'true') as pi_blocks
FROM sms_messages
WHERE createdAt >= NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1 DESC;
```

## Rollback

If the classifier causes UX regressions:

1. Toggle the relevant flag OFF · existing call sites continue without the signal
2. Investigate logs · was it false-positive rate? Latency? Cold-load?
3. Tune threshold OR switch to a smaller model (e.g. `meta-llama/PromptGuard-86M` for PI · 4× faster)
4. Re-enable when fixed

No deploy required · pure flag-flip rollback.

## Skill-port lineage

Category 3 of `docs/eval-rubrics/huggingface-model-strategy.md`. Pairs with:

- `docs/eval-rubrics/security-audit.md` Domain 1 (input validation) · prompt-injection screening is the missing security domain
- `docs/eval-rubrics/tool-use-guardian.md` · classifier output feeds the guardian's risk-tier decision
- `docs/eval-rubrics/agent-ready-apis.md` · classifiers expose via `tRPC.classifiers.*` for the agent (per A2)
- `docs/runbooks/nickgpt-finetune.md` · NickGPT drafter can be gated by intent classifier (only auto-draft for low-risk intents)

Future · once NickGPT ships + classifier agreement with keyword parser ≥ 95%, consider auto-replying to "asking about hours/location" intents without operator review (saves operator 5-10 SMS replies/day).
