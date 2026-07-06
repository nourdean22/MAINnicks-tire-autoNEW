# Chat route walkthrough · `app/api/ai/chat/route.ts`

A guided tour of the single hottest path in statenour-os. The POST handler
is ~1,400 LOC; this doc takes you from request → response so future-Nour
(or any contributor) can find the seam they need without reverse-engineering
the whole file.

> Last verified against `app/api/ai/chat/route.ts` (1,405 LOC) and the five
> extracted services under `lib/services/chat/*`. Behavior preserved by
> the May 02 chunk-split refactor; comments referenced inline still match.

---

## Map at a glance

```
POST /api/ai/chat
   │
   ├─ requireSession + AI rate-limit gate                       L40-L48
   ├─ withActor("nick", …)                                       L54
   │
   └─ chatPostInner (the real work)                              L58
        │
        ├─ Stage A · Cheap gates
        │     · runGate (rate · budget · body · overrides)       L70-L83
        │     · contentMode detection                            L98
        │     · runInterceptors (image / decision / brain-dump)  L113-L124
        │     · sanitizeMessageHistory (image markdown scrub)    L137-L139
        │     · persistUserTurn (fires in parallel)              L157-L164
        │
        ├─ Stage B · Routing decisions
        │     · mintTraceId                                       L172-L173
        │     · detectChatMode → "standard" | "deep"             L199-L200
        │     · detectQueryShape → token budget + tool-first      L223
        │     · classifyTurn → temperature + COT + shape          L234-L244
        │     · detectDomain → taskType + large-context           L252-L282
        │     · assertWithinBudget → daily cap gate                L291-L308
        │     · python-execute intent detection                   L317-L320
        │     · getModel(taskType, opts)                          L322-L346
        │
        ├─ Stage C · Parallel prefetch (the perf trick)
        │     · promptPromise (buildSystemPrompt + cache)         L399-L412
        │     · auxPromise (cross-session + recall + prefetch)    L417-L430
        │     · compressPromise (4s timeout)                      L449-L457
        │     · userEmbeddingPromise + recallPromise              L475-L508
        │     · Promise.all([…six pipelines])                     L513-L527
        │
        ├─ Stage D · Prompt assembly
        │     · brain-context addendum                            L632-L644
        │     · context-window truncation per provider            L662-L666
        │     · Greene laws block (anthropic only)                L668-L675
        │     · personality + COT + output-shape prompts          L706-L722
        │     · citation + voice + forbidden phrases              L727-L774
        │     · tool-first directive                               L779-L782
        │     · multi-mode (/all /ab /carousel etc.)              L821-L829
        │     · high-spec gate (env-flagged)                      L848-L862
        │     · customer-shape detector                            L876-L895
        │     · SEO/GSC pre-fetch + inject                         L914-L978
        │
        ├─ Stage E · streamText config
        │     · pruneTools (mode + semantic + keyword)            L987-L1014
        │     · convertToModelMessages (v6 UIMessage → CoreMsg)   L1042-L1104
        │     · streamWithFallback                                L1132-L1314
        │     · onChunk · onError · onFinish                      L1254-L1313
        │
        └─ Stage F · Response shape
              · buildChatResponse (SSE + headers + heartbeat)     L1350-L1362
```

---

## The POST handler envelope

```ts
// app/api/ai/chat/route.ts:39
export async function POST(req: Request) {
  await requireSession(req);
  const limited = checkAiRateLimit(req);
  if (limited) return limited;
  const { withActor } = await import("@/lib/db/actor");
  return withActor("nick", () => chatPostInner(req));
}
```

Three gates before any work happens:

1. **`requireSession`** — session-gated so only Nour can hit this route.
   Defined in `lib/auth-guard.ts`. Throws 401 if the cookie is missing.
2. **`checkAiRateLimit`** — 10 req/min/IP. Catches runaway clients
   (polling loop, auto-fire chains) without burning AI provider budget.
   Returns 429 cleanly before the heavy pipeline starts.
3. **`withActor("nick", …)`** — wraps the entire turn so every DB write
   downstream (AutonomousAction, BrainMemory persists from
   importance-scorer, Mission/Task creates from chat tool calls) gets
   tagged with `actor = "nick"` in the audit trail.

`maxDuration = 120` (line 37) — Vercel Pro plan can stretch to 300s but
the route is held to 120 to fail fast on a stuck Venice call.

---

## Stage A · Cheap gates and the user-turn write

### A1 · `runGate` (`lib/ai/chat/gate.ts`)

```ts
// app/api/ai/chat/route.ts:68-71
const gateTimer = stageTracker.start("gate");
const { runGate } = await import("@/lib/ai/chat/gate");
const gate = await runGate(req);
gateTimer.end();
if (gate.kind === "block") return gate.response;
```

A single call returns either `{ kind: "block", response }` (early-exit
JSON like budget exceeded, body parse failure, missing overrides) or
`{ kind: "pass", … }` with the parsed body. The destructure at line 74
pulls out `messages`, `conversationId`, `modeOverride`,
`providerOverride`, `taskTypeOverride`, `personality`, `userContent`.

### A2-A4 · Content-mode + interceptors + history sanitize

```ts
// route.ts:97-98 · content-mode detection (drives provider + cache key)
const contentMode = _detectContentIntent(userContent);

// route.ts:114-124 · NL interceptor fast path — 3 intents bypass the model
const interceptResult = await runInterceptors({ userContent, lastUserMsg, convId });
if (interceptResult.kind === "handled") return interceptResult.response;

// route.ts:136-139 · strip image markdown from history before model sees it
sanitizeMessageHistory(messages);
```

| Intent             | Interceptor behavior                                          |
|--------------------|---------------------------------------------------------------|
| Image generation   | Routes straight to Venice flux-2-pro, ~$0.04/img, no LLM cost |
| Decision log       | Writes a `masteryDecision` row + replies with confirmation    |
| Brain-dump capture | Writes a `BrainDump` row + extracts INBOX tasks               |

Why detection is at the **top** (before prefetch/embeddings): when
Venice rate-limits embedding calls, the rest of the prefetch can stall
30s+, even though "remember that I decided to X" doesn't need any of
that work. Fast-path returns in ~200ms.

`sanitizeMessageHistory` prevents venice-uncensored from seeing prior
`![Generated Image](/api/images/<id>)` markdown and emitting NEW
markdown with fabricated cuid IDs that 404. Replaces with
`[image rendered]`.

### A5 · `persistUserTurn` — DB write fires in parallel

```ts
// app/api/ai/chat/route.ts:157-164
const { persistUserTurn } = await import("@/lib/services/chat/persist-user-turn");
const dbWritePromise: Promise<string> = persistUserTurn({
  convId,
  lastUserMsg,
  userContent,
  log,
  recordError,
});
```

The user-turn DB write kicks off as a background promise that the
route awaits **alongside** the prompt pipeline below. Previously this
was blocking and added 200-800ms to every first-message request.

If the write fails, `convId` gets set to `"temp"` and the chat
continues — the chat works even if persistence is down. Errors flow
through `recordError` so DB rot is visible in the HUD.

---

## Stage B · Routing decisions

### B1 · `mintTraceId` (v10 E.5 agent-trace contract)

```ts
// app/api/ai/chat/route.ts:172-173
const { mintTraceId, recordTrace } = await import("@/lib/ai/agent-trace");
const __traceId = mintTraceId();
```

The traceId is minted **once** at the top of the turn so every
downstream call (auto-rename, distillation, tool invocations) can
chain to it via `parentId`. Without this the operator dashboard can't
answer "what did Nick do this turn?"

### B2 · Mutable refs (the closure-share trick)

```ts
// app/api/ai/chat/route.ts:180-189
const __firstTokenRef = { value: null as number | null };
const __partialRef = { text: "" };
```

Two refs are needed because the stream callbacks (`onChunk`, `onError`,
`onFinish`) were extracted to separate files and need to share state:

- `__firstTokenRef.value` — captured on first chunk for TTFT metric.
  `onChunk` writes, `onFinish` reads.
- `__partialRef.text` — accumulates text-delta chunks so `onError` can
  persist the actual partial reply (not just an error stub).

### B3 · Chat-mode detection

```ts
// app/api/ai/chat/route.ts:199-200
const mode: ChatMode =
  modeOverride || aiConfig?.defaultMode || detectChatMode(userContent, messages.length);
```

Three-layer priority:

1. Per-request override from the chat control bar (client body)
2. Global default from the AI config (Settings page)
3. Automatic detection via `detectChatMode(userContent, messages.length)`

Two modes today (quick was retired Apr 17):

- **`standard`** — `reason` task, temp 0.7-0.8, balanced, sub-3s TTFT
- **`deep`** — `deep` task, temp 0.3-0.4, strategic, up to 4000 tokens

### B4 · Query-shape detection

```ts
// app/api/ai/chat/route.ts:223
const queryShape = detectQueryShape(userContent);
```

Pure function, no I/O. Used twice:

1. To size `maxOutputTokens` (80 for casual, 150 for yes/no, 700 for
   explain, 1600 for plan)
2. To drive the `toolFirstDirective` injection later in the prompt

### B5-B6 · Turn signal + domain routing

```ts
// route.ts:234 · single-pass heuristic · <2ms · zero AI cost
const turnSignal = classifyTurn(userContent);
// drives: temperature · chain-of-thought · output-shape · two-pass critique

// route.ts:252-275 · domain-routed taskType + large-context preference
const domainRoute = detectDomain(userContent, { hasImageAttachments });
const finalTaskType = domainRoute.domain !== "general" ? domainRoute.taskType : taskTypeForMode;
const finalPreferLargeContext = contentMode || domainRoute.preferLargeContext;
```

| User signal           | taskType         | preferLargeContext |
|-----------------------|------------------|--------------------|
| Code question         | `code`           | false              |
| Image attached        | `vision`         | true (qwen3-vl)    |
| Strategic / planning  | `deep`           | true               |
| Marketing / brand     | `creative`       | false              |
| Fast classify         | `fast`           | false              |
| Default               | (mode-driven)    | (mode-driven)      |

### B7-B8 · Budget gate + Python provider override

```ts
// route.ts:291-308 · daily budget gate
const budget = await assertWithinBudget().catch(() => null);
if (budget && !budget.ok) return Response.json({ … }, { status: 402 });

// route.ts:317-346 · Python-execute intent → force Ollama (strict toolChoice)
const __pythonExecuteIntent = /\b(run|execute|invoke)\s+python\b|…/i.test(userContent);
model = getModel(finalTaskType, {
  preferLargeContext: finalPreferLargeContext,
  ...(__pythonExecuteIntent ? { forceProviderFirst: "ollama" as const } : {}),
});
```

`budget.ts` reads `UserPreference("ai.dailyBudgetCents", default 500¢)`
and sums today's `AiGeneration.costCents`, cached 60s in-process. 402
JSON when exceeded so the chat UI renders the message inline.

The Python override is **layer 1** of the 3-layer forcing pattern —
see the consolidated summary at the bottom of this doc.

---

## Stage C · The parallel prefetch (`Promise.all` over six pipelines)

> ⚠️ **Stale (as of 2026-07-05) — Stage C/D below predate two refactors.**
> The `auxPromise` / `recallPromise` shape and the separate `threadContext` /
> `contextMemories` appends described here were superseded by the 2026-05-31
> `lib/services/chat/brain-context.ts` extraction (recall is now bundled into
> `buildBrainContext().systemPromptAddendum`), and PR #554 (2026-07-05) folded
> `buildContextHints` + `buildBrainContext` **into** the main `Promise.all`
> (brainCtx chained on `userEmbedding` + `convId`) so recall overlaps the
> prompt build instead of running as a serial tail. The current batch is
> `[promptPromise, compressPromise, dbWritePromise, userEmbeddingPromise,
> contextHintsPromise, brainCtxPromise]`. Read the current `route.ts` +
> `docs/sessions/2026-07-05.md` for ground truth until this walkthrough is
> reconciled (tracked as a separate doc task).

This is the perf trick that takes the route from 4-8s of serial
work down to `max(each_pipeline)` ≈ 1-3s.

### C1 · `promptPromise` — cached or fresh prompt build

```ts
// app/api/ai/chat/route.ts:399-412
const promptPromise: Promise<PromptFetchResult> = cachedPrompt
  ? Promise.resolve({ systemPrompt: cachedPrompt, fromCache: true })
  : buildSystemPrompt(topicTier, userContent)
      .then((p) => {
        setCachedPrompt(provider, topicTier, p, contentMode);
        return { systemPrompt: p, fromCache: false };
      })
      .catch((err): PromptFetchResult => {
        log.error("build_system_prompt_failed", { … });
        return {
          systemPrompt: `You are Nick, Nour's Chief of Staff AI. …`,
          fromCache: false,
        };
      });
```

The cache key is `(provider, topicTier, contentMode)`. The build path
is graceful — if `buildSystemPrompt` throws, we degrade to a minimal
identity prompt so chat still works without grounded context.

### C2 · `auxPromise` — cross-session + recall + prefetch

```ts
// app/api/ai/chat/route.ts:417-430
const auxPromise = userContent.length > 10
  ? Promise.all([
      import("@/lib/brain/conversation-memory").then((m) => m.detectCrossSessionThread(userContent)),
      import("@/lib/brain/contextual-recall").then((m) =>
        m.getContextualMemories([userContent], mode === "deep" ? 10 : 5)
      ),
      prefetchIntents(userContent),
    ])
  : Promise.resolve([null, null, []]);
```

Under-10-char greetings ("hi", "thanks") skip to keep them snappy —
they don't need memory recall. All three sub-promises catch their own
errors so one slow pipeline doesn't take down the others.

### C3 · `compressPromise` — 4s hard timeout

```ts
// app/api/ai/chat/route.ts:449-457
const compressPromise = Promise.race([
  compressConversation(messages, convId).catch((err) => {
    recordError("chat:compression", err);
    return fallbackCompression();
  }),
  new Promise<ReturnType<typeof fallbackCompression>>((resolve) =>
    setTimeout(() => resolve(fallbackCompression()), 4000),
  ),
]);
```

If Venice doesn't summarize in time we fall through to uncompressed —
the model can handle the full recent history within its context
window, and the stream opens without a 30s block that trips "Nick is
stuck".

### C4-C5 · Tool embeddings + Promise.all mux

```ts
// route.ts:470-508 · tool embeddings (warm cache · user-embedding · recall chain)
warmToolEmbeddings().catch(…);  // fire-and-forget · 113 tool descriptions
const userEmbeddingPromise = userContent.length > 10 ? embedUserMessage(userContent) : Promise.resolve([]);
const recallPromise = userContent.length > 10
  ? userEmbeddingPromise.then((emb) => recallMemoriesForQuery(userContent, { embedding: emb, limit: mode === "deep" ? 8 : 5 }))
  : Promise.resolve(null);

// route.ts:513-527 · six pipelines join here
const [{ systemPrompt, fromCache }, aux, compression, resolvedConvId, userEmbedding, recallBlock] =
  await Promise.all([promptPromise, auxPromise, compressPromise, dbWritePromise, userEmbeddingPromise, recallPromise]);
convId = resolvedConvId;
```

`warmToolEmbeddings` runs once per lambda instance — cold start takes
~3-5s, subsequent calls return immediately. `recallPromise` chains off
the user-embedding so we don't pay for a second Venice call. The
Promise.all collapses six independent latencies into one
`max()` instead of `sum()`.

---

## Stage D · Prompt assembly (appending in priority order)

After parallel prefetch, the route appends blocks **in order of
importance** — the model weights later instructions more heavily, so
personality, COT, output-shape, voice come **last**. Each addition is
conditional so the prompt stays as lean as the turn allows.

### D1-D5 · Context blocks (each conditional · short-circuits when empty)

```ts
// route.ts:544-549 · cross-session + context memories
if (threadContext) systemPrompt += `\n\n# CROSS-SESSION THREAD\n${threadContext.slice(0, 1000)}`;
if (contextMemories) systemPrompt += `\n\n# CONTEXT MEMORIES\n${contextMemories.slice(0, mode === "deep" ? 2000 : 1000)}`;

// route.ts:558-573 · truth-grounding for named entities
//   Pre-fetches DB state for any project/mission in recent turns → injects as ground truth.
const groundingBlock = await buildTruthGroundingBlock(messages);
if (groundingBlock) systemPrompt += `\n\n${groundingBlock}`;

// route.ts:582-588 · hybrid recall (v10.0.92) · KNN + recency + confidence
//   Composes with contextual-recall · distinct prompt sections, no overlap.
if (recallBlock?.promptBlock) systemPrompt += `\n\n# ${recallBlock.promptBlock}`;

// route.ts:607-624 · strategic frameworks lens
//   Matches business/money/strategy/marketing intent → injects 1-3 frameworks
//   (Business Model Canvas, JTBD, Launch Strategy, Monetization, etc.)
const lensBlock = composeStrategicLensBlock(userContent);
if (lensBlock) systemPrompt += `\n\n${lensBlock}`;

// route.ts:632-644 · brain-context (7-module parallel rerank)
const brainCtx = await buildBrainContext({ userContent, mode, userEmbedding, contextMemories, prefetchResults, log });
systemPrompt += brainCtx.systemPromptAddendum;
```

`buildBrainContext` loads 7 brain modules in parallel with 3s timeouts
(skills, identity, ghost predictions, qualitative identity, beliefs,
nudges, contradictions), reranks by user-embedding similarity, surfaces
which context blocks fired for telemetry.

### D6 · Context-window truncation (route.ts:662-666)

| Provider  | System prompt cap | Notes                                           |
|-----------|-------------------|-------------------------------------------------|
| anthropic | 120k chars        | Claude Sonnet 4.6 · ~200K context window        |
| venice    | 65k chars         | model env-driven (see lib/ai/provider.ts) · 128K total · raised from 50k |
| ollama    | 65k chars         | (same cap, 1M-context models tolerate more)     |
| openai    | 65k chars         | gpt-4o-mini · 128K total                        |

### D7-D8 · Personality + turn-aware scaffolds (route.ts:681-755)

```ts
// Personality block (master / builder / friend) — appended LAST so model weights it most
systemPrompt += `\n\n${personalityBlock}`;

// Turn-aware scaffolds — conditional, zero tokens on casual turns
if (turnSignal.useChainOfThought) systemPrompt += `\n\n${buildChainOfThoughtPrompt()}`;
const shapePrompt = buildOutputShapePrompt(turnSignal.outputShape);
if (shapePrompt) systemPrompt += `\n\n${shapePrompt}`;
if (anyBrainBlockFired && turnSignal.intent !== "casual") systemPrompt += `\n\n${buildCitationPrompt()}`;
const voiceGuardIntents = new Set(["analytical","decision","creative","reflective","emotional","instructional"]);
if (voiceGuardIntents.has(turnSignal.intent)) systemPrompt += `\n\n${buildNourVoicePrompt()}`;
```

Three personalities: **master** (terse, actionable, 40-60 words —
default · sales floor focus), **builder** (technical partner · code
+ architecture + WHY), **friend** (casual, no data unless asked).

### D9 · Voice + tool-first guardrails (route.ts:767-782)

A FORBIDDEN PHRASES list scrubs Nick's voice via system-prompt
prevention (pleasantries, help filler, AI disclaimers, hedges,
self-reference, "However/Additionally/Furthermore" openings).
`toolFirstDirective(queryShape)` adds the tool-call-first directive
when the user asks a data question Nick has tools for.

Forbidden-phrases is the **prevention layer** for Nick's voice; the
sanitizer at `lib/ai/output-sanitizer.ts` is the **cure layer** for
the persisted history.

### D10 · Provider-specific chat layer + Greene laws (route.ts:786-807)

Anthropic gets the full chat-layer identity + Greene laws (its 120k
budget can hold them). Venice gets the truncated prompt only.

### D11-D13 · Conditional addendums

- **Multi-output mode** (route.ts:821-829) — detects `/all`, `/ab`,
  `/reformat`, `/twopass`, `/carousel` and appends a shape template
  so the model emits one structured stream renderable as multiple cards.
- **High-spec gate** (route.ts:848-862, env-flagged) — when
  `NICK_HIGH_SPEC_GATE=on`, factual/decision/instructional/procedural
  turns get a preemptive specificity directive prepended. Reversible
  test of "smaller-cost Tier 2".
- **Customer-shape detection** (route.ts:876-895, always-on) — regex
  detects phone digits, name-with-action, ownership phrasing, plate
  lookups; prepends a `findCustomer`-first directive. Cost of
  fabricating customer details > extra tool call.

### D14 · SEO/GSC pre-fetch + inject (route.ts:914-978)

The **bypass-the-model** pattern. When `SEO_QUERY_REGEX` matches the
user content, the route fetches the nickstire bridge BEFORE streamText
runs and injects the JSON result as a system-prompt addendum:

```ts
finalSystemPrompt = `# 🚨 LIVE GSC DATA INJECTED · ${windowLabel} · YOU MUST CITE THESE NUMBERS 🚨

\`\`\`json
${JSON.stringify(d, null, 2)}
\`\`\`

## HARD RULES (violations are failures):
- DO NOT START YOUR REPLY WITH "I cannot" / "Sorry" / "Unfortunately" — THE DATA IS RIGHT ABOVE.
- DO NOT FABRICATE "Google logging errors" / "data discrepancies" / …
- OPEN YOUR REPLY by stating the actual numbers …

${finalSystemPrompt}`;
```

The model has the real numbers in its context — fabrication becomes
structurally impossible. Cost: one bridge call per matching turn
(~200-500ms). Three branches: data-with-numbers, zero-but-genuine, and
bridge-failed; each has its own hard-rules block guiding the reply.

---

## Stage E · streamText configuration

### E1-E3 · Tools, tokens, message conversion

```ts
// route.ts:987-1014 · pruneTools(mode, all, content, embedding) → typed subset
//   + blocklist (aiConfig.disabledTools) + always-on (aiConfig.alwaysOnTools)
let prunedTools = pruneTools(mode, nourTools, userContent, userEmbedding);

// route.ts:1028-1031 · maxOutputTokens from queryShape · 80-1600 by shape
const maxOutputTokens = queryShape.tokenBudget > 0 ? queryShape.tokenBudget
                                                   : (mode === "deep" ? 4000 : 1200);

// route.ts:1042-1104 · convertToModelMessages with manual-fallback for v6 edge cases
const modelMessages = compression.compressed ? compression.messages
                                              : await convertToModelMessages(messages).catch(/* manual loop */);
```

Pruning lives in `lib/ai/chat-mode.ts:pruneTools`:

- **Core tools** always included (10 names): `classifyThought`,
  `searchMemories`, `getRecentReflections`, `searchReflections`,
  `rankNextActions`, `getBlindSpots`, `syncKnowledge`, `dailyPulse`,
  `setTaskPriority`, `runDeviceCommand`
- **Semantic layer** (when warm): top-15 standard, top-40 deep,
  cosine floor 0.25
- **Keyword fallback** when embedding cache is cold
- **Circuit-breaker blocked tools** stripped via `isToolBlocked(name)`

The AI SDK v6 conversion can choke on edge cases (legacy v4/v5 image
parts, missing `mediaType`). The fallback manually translates parts —
image parts to `{ type: "image", image: url, mediaType }`, file parts
to `{ type: "file", data, mediaType }`.

### E4 · `streamWithFallback` — same-turn provider rotation

```ts
// app/api/ai/chat/route.ts:1132-1314
const { streamWithFallback, inferProviderName } = await import("@/lib/ai/stream-with-fallback");
const __sameTurnFallback = streamWithFallback({
  taskType: finalTaskType,
  preferLargeContext: finalPreferLargeContext,
  buildConfig: (__fbModel) => ({ … }),
});
result = __sameTurnFallback.result;
```

If `streamText` throws **synchronously** (bad config, auth fail,
immediate connection error before any token), `streamWithFallback`
marks the provider failed and retries with the next provider in the
chain. v9.1.27's cross-request rotation handles the "next request"
case; this closes the same-turn pre-first-token gap.

**Mid-stream rotation post-first-token is NOT supported** — those
errors fall through to `onError` + v9.1.22 stub-message logic which
preserves the partial reply but doesn't resume from a different
provider mid-stream.

### E5 · streamText config (the key options)

| Option                  | Source                                                    |
|-------------------------|-----------------------------------------------------------|
| `model`                 | `streamWithFallback` rotates if first fails               |
| `system` / `messages`   | Anthropic folds system into msgs[0] with `cacheControl: ephemeral`; others use legacy `system:` |
| `tools`                 | `prunedTools` from E1                                     |
| `experimental_transform`| `smoothStream({ delayInMs: 10, chunking: "word" })`        |
| `stopWhen`              | `stepCountIs(deep ? 5 : 3)` — caps tool-call chains       |
| `maxOutputTokens`       | E2 — from query-shape or mode default                     |
| `temperature`           | `turnSignal.temperature` from B5                          |
| `toolChoice`            | See E6 below                                              |

### E6 · The toolChoice forcing pattern

```ts
// app/api/ai/chat/route.ts:1200-1235
...(() => {
  // Python-execute · most specific gate, checked first.
  if (/\b(run|execute|invoke)\s+(?:this\s+)?python\b|…/i.test(userContent)) {
    return {
      toolChoice: { type: "tool" as const, toolName: "runPython" as const },
    };
  }
  // Generic action-intent — force ANY tool call
  const intent = detectActionIntent(userContent);
  if (intent) return { toolChoice: "required" as const };
  return {};
})(),
```

Three tiers:

1. **`{ type: "tool", toolName: "runPython" }`** — specific tool forced
   when user says "run this python". Bypasses the model's discretion
   entirely; only choice left is what code to pass.
2. **`"required"`** — when user clearly issues an action ("add this
   task", "send the email", "schedule a follow-up"). Removes the
   option to narrate. Fabrication-by-narration becomes structurally
   impossible.
3. **`"auto"` (default)** — questions like "what tasks do I have?"
   fall through so reads stay flexible.

---

## Stage F · Stream lifecycle (the three callbacks)

### F1 · `onChunk` — captures TTFT + accumulates partial text

```ts
// app/api/ai/chat/route.ts:1254-1261
onChunk: ((chunk: unknown) => {
  if (__firstTokenRef.value === null) __firstTokenRef.value = Date.now();
  const c = chunk as { chunk?: { type?: string; text?: string } };
  const inner = c?.chunk;
  if (inner?.type === "text-delta" && typeof inner.text === "string") {
    __partialRef.text += inner.text;
  }
})
```

Notes from the inline comments:

- **Why only text-delta** (not reasoning-delta): the graceful-degradation
  message on error should match what the user saw on screen. Reasoning
  streams render in a separate collapsed UI region (or are hidden), so
  mixing reasoning into the assistant content would diverge from the
  user's view at failure time.
- **AI SDK v6 shape**: text-delta chunks expose `text: string` (not
  `textDelta`). Verified against
  `node_modules/ai/dist/index.d.ts:2601`.

### F2 · `onError` — extracted to `lib/services/chat/stream-error-handler.ts`

```ts
// app/api/ai/chat/route.ts:1272-1283
onError: buildStreamErrorHandler({
  convId, conversationId, model, traceId: __traceId, provider, modelId,
  startedAt, partial: __partialRef, log, recordTrace,
}) as Parameters<typeof streamText>[0]["onError"],
```

The handler factory (in `lib/services/chat/stream-error-handler.ts`)
owns four side effects on stream interruption:

1. **`markProviderFailed`** — mark the failing provider as recently
   failed (60s rehab) so the next turn rotates off the dead provider.
2. **Graceful-degradation persist** — write a `ChatMessage` with the
   partial text + error annotation, so reload doesn't vanish what the
   user already saw on screen. Falls back to a pure-error stub when
   partial < 20 chars (true cold failure).
3. **Agent-trace error row** — `errorClass: "stream_interrupted"`.
4. **ErrorLog append** for the operator dashboard.

The outer `try/catch` swallow is required — `onError` MUST NOT throw
or it crashes the stream lifecycle.

### F3 · `onFinish` — extracted to `lib/services/chat/persist-assistant-turn.ts`

```ts
// app/api/ai/chat/route.ts:1287-1312
onFinish: buildOnFinish({ log, convId, conversationId, provider,
  modelId, model, mode, modeOverride, personality, contentMode,
  finalSystemPrompt, systemPrompt, finalTaskType, userContent,
  turnSignal, contextBlocksFired, deeperContextCount, deeperContextTypes,
  startedAt, firstTokenRef: __firstTokenRef, traceId: __traceId,
  recordTrace, messages, topicTier }) as …
```

The 977-line lifted body owns the entire post-stream lifecycle. Six
logical phases:

1. **Salvage** · rawText → reasoningText → content → steps → reasoning
   (cascading fallback) → empty-response guard → sanitizer →
   image-hallucination guard.
2. **Score** · output critic (4-axis or 7-axis) + always-on quality
   scorecard `BrainMemory(nick_quality)` + citations parse + reply
   gate + fact-check + (env-gated) hallucination guard.
3. **Tool telemetry** · walk `event.steps[].toolResults`, dual-write
   `ToolTelemetry` + `ToolVerbRatio`, run temporal-consistency check,
   environment-state verifier; fabrication-rewriter prepends hedge
   banner when claims fired without tools.
4. **Persist** · dedup guard on `(convId, parentMessageId, branchId)`,
   then CREATE the assistant `ChatMessage` with full v7.6 field set +
   `parts` tree + branching parent + `tokenUsage` blob (traceId,
   contextBlocks, turnSignal, critic, citations, gate, factCheck).
5. **Telemetry async** · `judgeReplyAsync` 5-axis rubric +
   `criticizeAsync` for recommendation-shape replies + envelope build
   (`EnvelopeBuilder`) + `recordTrace` finalize.
6. **Dispatch async** (fire-and-forget) · `trackGeneration`,
   `recordInteraction`, `detectContentFeedback`, `extractPredictions`,
   `processConversation`, chat-pattern stats (every 10 msgs),
   `ingestJournal` (gated by `looksLikeBrainDump`),
   `summarizeAndStoreConversation` (4+ msgs), `maybeAutoRename`,
   `runPeopleIntelligence`, `parseActions`/`executeActions`,
   `warmSuggestionCache`.

The `looksLikeBrainDump` heuristic at the top of
`persist-assistant-turn.ts` is the safety against chat questions
turning into phantom INBOX tasks — pre-fix every long question Nour
asked Nick became 3-5 fake tasks on the todo list.

---

## Stage F · The response shape

```ts
// app/api/ai/chat/route.ts:1350-1362
const { buildChatResponse } = await import("@/lib/services/chat/response-shape");
return buildChatResponse({
  streamResponse: result.toUIMessageStreamResponse(),
  convId: convId!,
  traceId: __traceId,
  mode, modeOverride, personality, turnSignal,
  deeperContextCount, deeperContextTypes, contextBlocksFired,
});
```

`buildChatResponse` (pure function, no I/O) builds the SSE Response
with the proper headers:

- `X-Conversation-Id` — for the client to thread the response
- `X-Trace-Id` — for ops dashboards to link a stream to its trace
- `X-Mode`, `X-Personality`, `X-Turn-*` — telemetry the chat UI can
  render in dev mode
- Heartbeat wrapping via `withHeartbeat` — keeps the SSE connection
  alive on slow tool calls so the gateway doesn't kill the stream

---

## The 3-layer Python-execute forcing pattern · why it took v517-v523

The canonical example of forcing a model to actually use a tool
instead of narrating around it. Each layer alone wasn't enough; the
v520 smoke test still showed TOOLS=0 even with toolChoice forcing
because venice-uncensored has loose tool_choice adherence.

| Layer | Where                          | What it does                                                        |
|-------|--------------------------------|--------------------------------------------------------------------|
| 1     | route.ts:317-346               | Provider override: route to Ollama Cloud (strict toolChoice + 1M context) |
| 2     | route.ts:1200-1214             | `toolChoice: { type: "tool", toolName: "runPython" }` — specific tool, not "required" |
| 3     | tools.ts:635 (`runPython` desc) | "ALWAYS CALL THIS TOOL when the operator asks you to RUN, EXECUTE, COMPUTE …" — textual imperative |

**Net effect:** post-v523 python-execute intent fires `runPython`
100% with zero code-text fabrication ahead of the call. Missing
`E2B_API_KEY` surfaces as a structured error to the operator instead
of pretending to execute.

---

## Common seams future-Nour will look for

| Question                                                  | File · symbol                                          |
|-----------------------------------------------------------|--------------------------------------------------------|
| Where do I add a new chat-mode override?                  | `lib/ai/chat-mode-detect.ts:detectChatMode`            |
| Where do I add a new fast-path intent (image/decision)?   | `lib/ai/chat/interceptors.ts:runInterceptors`          |
| Where do I tune token budgets per query shape?            | `lib/ai/query-shape.ts:detectQueryShape`               |
| Where do I add a new domain-routed provider preference?   | `lib/ai/domain-routing.ts:detectDomain`                |
| Where do I gate a new tool always-on for chat?            | `CORE_TOOLS` in `lib/ai/chat-mode.ts:pruneTools`       |
| Where do I add a new system-prompt block?                 | `lib/ai/system-prompt.ts:buildSystemPrompt`            |
| Where do I add a new post-stream side effect?             | `lib/services/chat/persist-assistant-turn.ts:buildOnFinish` |
| Where do I tune the daily budget cap?                     | `lib/ai/budget.ts:assertWithinBudget`                  |
| Where do I add a pre-stream entity grounding?             | `lib/ai/chat/truth-grounding.ts:buildTruthGroundingBlock` |
| Where do I add a forced-tool intent?                      | `lib/ai/chat/action-intent-detector.ts:detectActionIntent` + the `toolChoice` block in route.ts:1200 |

---

## Pitfalls

1. **Closure-share refs (`__firstTokenRef`, `__partialRef`)** — these
   are the seam between the route, `onChunk`, `onError`, `onFinish`.
   Don't replace with `let` variables — the callbacks live in
   separate modules now and need shared references.
2. **`convertToModelMessages` fallback** — the manual loop at
   route.ts:1048 handles edge cases the SDK chokes on. If you upgrade
   the AI SDK, run the smoke tests against image attachments before
   shipping.
3. **Provider mid-stream rotation is NOT supported.** Once SSE
   headers ship, you can't switch providers. The same-turn fallback
   only catches pre-first-token failures.
4. **`onError` MUST NOT throw.** The handler has an outer
   `try/catch { /* swallow */ }` for this reason. Anything that
   could throw needs its own catch.
5. **`onFinish` runs after stream close.** The user already saw the
   reply. Any persisted correction (e.g. fabrication rewrite) only
   affects future turns + reload-from-history, not the live view.
6. **The dedup guard at persist-assistant-turn.ts:636** is critical —
   double-fire onFinish has happened in the wild (Cat 4 concurrency
   race per glitch taxonomy). Don't relax that check until the unique
   constraint migration ships.
