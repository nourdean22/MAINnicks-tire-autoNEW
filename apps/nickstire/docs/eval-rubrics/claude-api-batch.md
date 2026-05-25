# Anthropic Batch API Migration Plan

**Skill port:** A6 · claude-api (batch + caching + thinking + compaction + files + citations)
**Applies to:** background-cron Anthropic calls that don't need real-time latency. Specifically · `vapi-call-eval` daily cron, `improve-agent` daily cron, `agentic-auditor` daily cron, future `nightly-summary` agent.
**Authored:** 2026-05-26.

## Why this doc exists

Anthropic's Batch API offers 40-50% cost reduction vs synchronous calls, with a 24h max latency. For background crons that already run on 24h interval, this is a free win.

Per claude-monitor.md, three daily crons collectively burn $15-25/day in Anthropic calls · migrating to batch cuts this to $9-15/day · $180-300/month saved · pays for itself in operator time the FIRST month.

## Batch API basics

The Batch API takes a JSONL file of up to 10,000 requests, returns results within 24h (usually within 1-2h for small batches), at 50% the cost.

Synchronous flow (current):

```
[for each customer in 50]
  → POST /v1/messages (one call · ~$0.05 each)
  → wait ~5s
  → write eval to DB
[next customer]
```

Batch flow (target):

```
1. Build JSONL with 50 requests · upload to /v1/messages/batches
2. Poll status every 5 minutes
3. When done, download results · iterate · write evals to DB
```

50 calls × $0.05 = $2.50 sync. Batch: 50 × $0.025 = $1.25. Net daily savings depending on volume.

## Migration candidates (by ROI)

### Candidate 1 · `vapi-call-eval` daily cron

**Today:** for each unevaluated VAPI call from yesterday (~30-100 calls), make a sync Anthropic call to score it against the rubric (Wave R voice-agent eval).

**Sync cost:** 100 calls × ~$0.07 each = $7/day.
**Batch cost:** 100 calls × ~$0.035 each = $3.50/day.
**Daily savings:** $3.50/day · $105/month.
**Latency:** day-after-yesterday becomes day-after-tomorrow · acceptable for eval (not real-time).

### Candidate 2 · `improve-agent` daily cron

**Today:** scans recent chat memories + brain entries, generates suggestions for improvement. Single large call OR multiple calls depending on memory size.

**Sync cost:** ~$5-8/day.
**Batch cost:** ~$2.50-4/day.
**Daily savings:** $2.50-4/day · $75-120/month.
**Latency:** suggestions land next morning instead of tomorrow morning · imperceptible.

### Candidate 3 · `agentic-auditor` daily cron

**Today:** audits 50-100 recent agent actions (per Wave V autonomous-action tiers) · scores each for correctness.

**Sync cost:** ~$3-5/day.
**Batch cost:** ~$1.50-2.50/day.
**Daily savings:** $1.50-2.50/day · $45-75/month.
**Latency:** acceptable for audit.

**Total savings:** $7-10/day · $200-300/month · enough to pay for ~5h of operator time saved on cost monitoring.

## NOT good candidates

Don't migrate these to batch:

- **chat** · real-time · needs <2s latency
- **page-insight** · operator-triggered · needs <5s
- **autocomplete** · sub-keystroke · needs <300ms
- **consult-board** · operator-triggered · needs <10s
- **vapi tool calls** · voice-realtime · needs <1.5s
- **lane-check** · pre-send validation · needs <2s

Rule: if the call blocks the operator OR the customer, it's not a batch candidate.

## Implementation pattern

```typescript
// apps/nickstire/server/lib/anthropic-batch.ts

export async function runBatch(
  surface: "vapi-eval" | "improve-agent" | "auditor",
  requests: Array<{
    custom_id: string;
    params: Anthropic.MessageCreateParams;
  }>
): Promise<Map<string, Anthropic.Message>> {
  // 1. Submit batch
  const batch = await anthropic.messages.batches.create({ requests });

  // 2. Poll status (Anthropic's batch returns within 24h, usually <2h)
  let result;
  for (let i = 0; i < 144; i++) { // max 12h wait at 5min intervals
    await new Promise(r => setTimeout(r, 5 * 60 * 1000));
    result = await anthropic.messages.batches.retrieve(batch.id);
    if (result.processing_status === "ended") break;
  }
  if (result?.processing_status !== "ended") {
    throw new Error(`Batch ${batch.id} did not complete within 12h`);
  }

  // 3. Download results
  const stream = await anthropic.messages.batches.results(batch.id);
  const out = new Map<string, Anthropic.Message>();
  for await (const line of stream) {
    if (line.result.type === "succeeded") {
      out.set(line.custom_id, line.result.message);
    }
  }
  return out;
}
```

Each cron uses it like:

```typescript
// apps/nickstire/server/cron/jobs/vapiCallEval.ts
const requests = unevaluatedCalls.map(call => ({
  custom_id: call.vapiCallId,
  params: {
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1000,
    system: VAPI_EVAL_RUBRIC, // from Wave R
    messages: [{ role: "user", content: buildEvalPrompt(call) }],
  },
}));

const results = await runBatch("vapi-eval", requests);

for (const call of unevaluatedCalls) {
  const result = results.get(call.vapiCallId);
  if (result) {
    const score = parseEvalScore(result);
    await writeEvalToDb(call, score);
  }
}
```

## Idempotency

Batch API gives you a `batch_id` · safe to retry status polls. The cron should:
1. Check if a batch is in-flight before submitting a new one
2. Use the batch's `custom_id` field to map back to the source row (vapi_call_id, etc.)
3. Mark each source row as "batch_submitted" before submitting · "batch_completed" after writing result · prevents double-submit

## Failure modes

- **Batch timeout** · if Anthropic doesn't return within 24h, the cron should fall back to sync calls for that day's batch + alert operator. Should never happen in practice.
- **Partial failure** · some `custom_id`s return errors · log + skip · don't fail the whole batch.
- **Rate limit on batch submission** · max 100 batches per minute · way below cron frequency.

## Skill-port lineage

A6 from the audit's Round 2 deep-pass. Pairs with:
- B4 · claude-monitor (the cost-tracking that proves the savings)
- Wave R · prompt-caching deepening (the other 90% cost lever, complementary)
- Wave V · autonomous-action tiers (cron-level Tier-2 actions are batch-eligible)

Future · once 3 daily-cron surfaces migrate, the pattern scales to other batch-eligible workloads (e.g., nightly summarization of yesterday's customer interactions for the brain).
