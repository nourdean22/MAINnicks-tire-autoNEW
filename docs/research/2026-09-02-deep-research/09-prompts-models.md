# 09 — Prompt and Model-Call Census: StateNour (bdnick.info)

**Scope.** Read-only census of `apps/statenour` + `apps/worker` at snapshot
`C:\Users\nourd\AppData\Local\Temp\claude\C--\a2f6988a-8f6b-463b-a858-39bfbee811de\scratchpad\main2`,
a `git archive` of `origin/main @ abdd99395` (production commit `abdd993`). AI SDK v6
(`ai` 6.0.162), Ollama Cloud base lane, OpenRouter, Braintrust, `@langfuse/otel` 5.10.

**Lenses applied.** kaizen (small verifiable improvements, error-proofing, JIT/YAGNI),
karpathy-guidelines (state assumptions, simplest thing, surgical framing), prompt-engineering
(few-shot / CoT / template-system patterns), llm-evaluation (automated vs human vs LLM-judge,
regression, calibration). Central question per call site: **does this belong in the data
model, deterministic policy, domain logic, retrieval, the prompt, or the model?**

**Claim classes.** A = read directly from source at the cited path:line. H = a judgment call
this report is making (an inferred/interpretive claim, not a literal read). I = inference from
multiple A-class facts (e.g., "no UI caller found" after a targeted grep). D = a number lifted
from a dated doc in `docs/`, cited with the doc name. UNMEASURED = no source found; do not
invent a number.

**Corpus for absence claims.** Unless stated otherwise, "not found" means: `grep -rn` (ripgrep)
across `apps/statenour/{app,lib}` and `apps/worker/src`, excluding `node_modules`, `.next`,
`dist`, `__tests__` snapshot fixtures. Each absence claim below names its specific grep pattern
and glob so it can be rerun.

**Status:** Complete. All 7 requested sections delivered, plus §0 (positive-control cross-check)
and a closing Limitations list. Section order below follows the task's requested numbering
(1 Census, 2 Prompts, 3 Context assembly, 4 Routing, 5 Structured-output risk, 6 Evals, 7
Verdicts); §0 sits first because §1 depends on it.

---

## 0. Positive control: telemetry gate test cross-check

`tests/observability/ai-sdk-telemetry-gate.test.ts:22` scans only `app/` + `lib/` (NOT
`worker/`, `scripts/`, or `tests/`) with regex `\b(generateText|streamText|generateObject|
streamObject)\(\{` (A, line 22), requires `sites.length >= 20` (A, line 103), requires every
site to carry `experimental_telemetry: langfuseTelemetry(...)` or be on a 2-entry allowlist (A,
lines 25-36: `lib/ai/structured.ts` health-probe, `lib/ai/stream-with-fallback.ts` config-spread),
and requires `>= 12` distinct literal `functionId: "..."` strings (A, line 128).

**Independent cross-check.** Running the test's own regex by hand across `app/` + `lib/` finds
**22 call sites** — the exact count the task brief states the test enumerates:

| # | path:line | kind | allowlisted? | literal functionId |
|---|---|---|---|---|
| 1 | `app/api/telegram/webhook/route.ts:1148` | generateText | no | `"telegram-ask"` |
| 2 | `lib/brain/contextual-retrieval.ts:71` | generateText | no | `"contextual-retrieval"` |
| 3 | `lib/intelligence/scoring.ts:125` | generateText | no | `"score-claims"` |
| 4 | `lib/intelligence/extraction.ts:56` | generateText | no | `"extract-claims"` |
| 5 | `lib/intelligence/content-alpha.ts:97` | generateText | no | `"content-alpha"` |
| 6 | `lib/intelligence/compose-daily-brief.ts:266` | generateText | no | `"daily-executive-brief"` |
| 7 | `lib/integrations/google-search.ts:54` | generateText | no | `"google-search-ask"` |
| 8 | `app/api/cron/weekly-review/route.ts:188` | generateText | no | `"weekly-review"` |
| 9 | `lib/inngest/functions/intelligence-brief.ts:489` | generateText | no | `"intelligence-brief"` |
| 10 | `lib/ai/evals/quality-bench-core.ts:153` | generateText | no | `"quality-bench"` |
| 11 | `lib/ai/structured.ts:68` | generateText | no | `"structured-response"` |
| 12 | `lib/ai/structured.ts:97` | generateText | **yes** (health/ready probe) | — (bare `generateText({model,prompt:"ready"})`, no telemetry block at all) |
| 13 | `lib/ai/stream-with-fallback.ts:298` | streamText | **yes** (spreads `build-stream-config.ts`'s block) | inherited: `"nick-chat"` |
| 14 | `lib/ai/reasoning/engine.ts:722` | generateText | no | `"reasoning-tool-gather"` |
| 15 | `lib/ai/provider.ts:1226` | generateText (inside `aiChat()`) | no | dynamic: `` `ai-chat-${taskType}` `` (template literal — NOT matched by the gate's `functionId:\s*"([^"]+)"` literal-string check, so invisible to the "distinct literal names" count, though `isInstrumented()` still sees it as instrumented since that regex only checks for `langfuseTelemetry(`) |
| 16 | `lib/ai/provider.ts:1625` | streamText (inside `aiStream()`) | no | dynamic: `` `ai-stream-${taskType}` `` (same template-literal blind spot) |
| 17 | `app/api/ai/side-pane-chat/route.ts:223` | streamText | no | `"side-pane-chat"` |
| 18 | `app/api/ai/page-insight/route.ts:212` | streamText | no | `"page-insight"` |
| 19 | `lib/ai/image-prompt-synth.ts:214` | generateText | no | `"image-prompt-synth"` |
| 20 | `lib/ai/image-prompt-synth.ts:266` | generateText | no | `"image-prompt-regen"` |
| 21 | `app/api/ai/chat/alternate-paths.ts:284` | generateText | no | `"chat-alternate-path"` |
| 22 | `app/api/ai/chat/alternate-paths.ts:318` | generateText | no | `"chat-regenerate"` |

I directly read the `experimental_telemetry` block at every non-allowlisted site above (grep for
`langfuseTelemetry(` across `app/`+`lib/`, 22 files matched — A) and confirm all 20 carry a
literal `functionId`. Counting distinct literal names (excluding the 2 dynamic ones in
`provider.ts`) gives **19** unique strings — comfortably clears the test's `>= 12` gate. **My
census matches the positive control exactly: 22/22, no site the test's own scan would miss, no
extra site inside its declared scope.** Nothing else in this report's much larger census (below)
falls inside this test's scope — the other ~120 `aiChat`/`tracedAiChat` call sites are a
*different* surface: they call `aiChat()`/`tracedAiChat()`, which itself wraps exactly sites #15
and #16 above. The 22-site gate is deliberately narrow (raw AI-SDK-primitive call sites only);
it says nothing about telemetry coverage of the wrapper-based surface, which get their trace
identity from `tracedAiChat`'s own `opts.label` (see §4).

---

## 1. Model-call census

### 1.1 The shared `aiChat()` / `tracedAiChat()` / `aiStream()` policy (read once, applies to every row in §1.3-§1.4)

Every one of the ~160 wrapper call sites below shares ONE policy block, set centrally in
`lib/ai/provider.ts` (read in full — A) and, for traced sites, `lib/ai/traced-aichat.ts` (read in
full — A). Restating it per-row would be ~160x repetition of identical facts, so it is stated once
here; §1.3/§1.4 list only what varies per call (`taskType` or trace `label`, and the file/function
purpose).

- **Model/provider resolution:** `getModel(taskType, opts)` → `getPreferredOrderForTask(taskType)`
  (§4.1, currently identical for all 12 task types) → `filterByCostFirewall` (Ollama-only unless
  `AI_PROVIDER` pinned or `NICK_FAILOVER_RESCUE=1`) → first available, not-recently-failed,
  not-quota-exhausted provider. `resolveProviderModel()` picks the model id (env override → coded
  default, per §4.1's table — some coded defaults are stale, see §4.1).
- **Structured output:** none of these calls ever pass a schema — `aiChat`/`aiStream` have no
  schema parameter at all (`AiMessage[]` + `TaskType` + a narrow opts object is the entire
  signature, confirmed by reading the exported function signatures, provider.ts:1052 and 1609).
  Any JSON a caller wants back is extracted from `result.content` by the CALLER, ad hoc — see §5.
- **Temperature:** **never set.** Neither `aiChat`'s `generateText` call (provider.ts:1226-1260)
  nor `aiStream`'s `streamText` call (provider.ts:1625-1634) passes a `temperature` field — every
  wrapper-routed call runs at each provider's own default sampling temperature, which differs by
  provider and is not pinned anywhere in this code path. (Compare: 6 of the 22 *raw* AI-SDK sites
  in §1.2 DO set an explicit temperature — the wrapper family is the one place it's absent.)
- **maxOutputTokens:** task-banded inside `aiChat` (provider.ts:1173-1180): **1500** for
  `fast`/`classify`; **8000** for the `longForm` set (`deep`, `reason`, `code`, `math`,
  `creative` — note `reason` is the DEFAULT taskType for both `aiChat` and `tracedAiChat`, so an
  un-annotated call gets the 8000 cap, not the 4000 "default"); **4000** for everything else
  (`sql`, `summary`, `vision`, `extract`, `embed`). `aiStream` sets **no** `maxOutputTokens` at
  all (provider.ts:1625-1634 — confirmed by direct read; relies on the SDK/provider default).
  This is a **separate token budget system** from the interactive chat route's own 6000
  standard/10000 deep cap (`app/api/ai/chat/prepare-tools.ts:246`, feeding
  `build-stream-config.ts` → the one allowlisted `stream-with-fallback.ts` telemetry site) — the
  two must not be conflated.
- **Timeout:** **100s** per provider attempt for the `longForm` set (`deep`/`reason`/`code`/
  `math`/`creative`), **45s** otherwise (provider.ts:1173-1174). `aiStream` has no per-attempt
  timeout at all — it wraps the whole stream body in one try/catch and falls back to the literal
  string `"AI connection failed."` on ANY error (provider.ts:1639-1641), with no garbage/refusal
  content-quality gate (unlike `aiChat`, which checks for empty/short/sentinel/refusal content and
  rotates providers, provider.ts:1268-1312).
- **Fallback on failure — is the sentinel checked?** `aiChat` never throws on total failure; it
  returns `{content: "I'm having trouble connecting...", provider: "emergency", model: "none",
  failures: [...]}` (provider.ts:1384-1400). **`tracedAiChat` checks this automatically** —
  `result.provider === "none" || result.provider === "emergency"` marks the persisted trace
  `errorClass: "provider_none"/"provider_emergency"` (traced-aichat.ts:144-184) so
  `/system/agent-traces` can surface it. **Bare `aiChat` callers get no such check for free** —
  each of the ~84 bare-`aiChat` call sites in §1.3 must inspect `result.provider` itself before
  trusting `result.content`; a caller that just does `.content.trim()` and feeds it downstream
  (several do — e.g. `lib/ai/adversarial-critic.ts:139`, `lib/brain/domain-knowledge-extractor.ts:
  123`) will silently pass the apologetic sentinel string through as if it were a real answer on a
  total-outage turn. Not independently verified per-site below (would require re-reading all 84
  call sites' post-call handling); flagged as a real risk pattern, not a confirmed defect at every
  site (H).
- **Caching:** Anthropic-only, ephemeral, **1-hour** TTL (upgraded from the AI SDK's 5-minute
  default), gated on `systemPrompt.length > 200` (provider.ts:1225, 1233-1253). No caching for
  Ollama/Gemini/OpenAI/OpenRouter through this path (OpenAI gets automatic prefix caching from
  the provider itself, per the code comment; not application-controlled).
- **Cost instrumentation — NOT forwarded.** `aiChat` computes `usage` + `costUsd` per call from a
  hardcoded `PROVIDER_RATES_PER_1M_TOKENS` table (provider.ts:1004-1027, "Conservative numbers...
  we'd rather over-attribute cost than miss spend" — Ollama pinned to `$0`, i.e. always $0 by
  construction for the base lane). **`tracedAiChat` never forwards `result.costUsd` /
  `result.usage` into `recordTrace()`'s `finish` argument** — confirmed by direct read of
  traced-aichat.ts:162-185, whose `recordTrace` call passes `durationMs`, `outputChars`,
  `errorClass`, `errorMessage` — no `costCents`, despite `TraceFinishInput.costCents` existing as
  a field (agent-trace.ts:54). So `AgentTrace.costCents` is `null` for effectively every
  `tracedAiChat`-originated row. Separately, the ONLY table the daily budget gate
  (`assertWithinBudget`, called before every `tracedAiChat`) actually reads is `AiGeneration`
  (`checkBudget()`, `lib/ai/budget.ts:53-56`), and **`AiGeneration` is written from just 7 call
  sites** in the whole codebase (`trackGeneration()`, `lib/ai/track.ts:88` — callers:
  `app/api/ai/plan-day/route.ts:227`, `app/api/cron/weekly-review/route.ts:269`,
  `lib/services/photo-improver.ts:279,303`, `lib/services/image-actions.ts:126,137`,
  `lib/services/chat/post-persist-verification.ts:68`; plus `recordInteraction()`,
  `lib/ai/memory.ts:52`, called from exactly one site, `lib/services/chat/
  deferred-background-work.ts:106`, which is wired into the main interactive chat pipeline's
  post-turn background work). **Net (I, chained from the A-class facts above): the budget *gate*
  fires before all ~38 `tracedAiChat` sites, but the spend *total* it checks is populated almost
  entirely by the interactive chat route — the ~120 brain/service/cron call sites that are the
  file's own stated "highest-frequency spend risk" (provider.ts:1101-1103) contribute close to
  nothing to the number the gate is comparing against**, except the 2 that call `trackGeneration`
  directly (`plan-day`, `weekly-review`). This is the most consequential single finding in this
  report — see §7.
- **Langfuse `functionId`:** bare `aiChat`/`aiStream` get a *dynamic* functionId
  (`` `ai-chat-${taskType}` `` / `` `ai-stream-${taskType}` ``, provider.ts:1228, 1627) unless the
  caller passes its own `opts.telemetry.functionId` (rare — not observed in the §1.3 sample).
  `tracedAiChat` sets `functionId: opts.label` (traced-aichat.ts:130) — the free-form `label`
  string every call site supplies is simultaneously the Langfuse trace name AND the `AgentTrace.
  label` column, so the `label` values in the §1.4 table below ARE the Langfuse functionIds for
  those rows.

### 1.2 Raw AI-SDK primitive sites (the 22 from §0), with per-call detail

| path:line | purpose | lane | temp | maxOutputTokens | notes |
|---|---|---|---|---|---|
| `app/api/telegram/webhook/route.ts:1148` | answer a Telegram-bot message | chat (unattended, bot-triggered) | not set | not set | own `getModel()` call, outside aiChat |
| `lib/brain/contextual-retrieval.ts:71` | retrieval relevance judgment | retrieval/scorer | **0.3** | **160** | small, tightly-bounded judgment call |
| `lib/intelligence/scoring.ts:125` | score extracted claims | scorer | not set | not set | feeds intelligence pipeline |
| `lib/intelligence/extraction.ts:56` | extract claims from text | extractor | not set | not set | |
| `lib/intelligence/content-alpha.ts:97` | content-alpha signal generation | scorer/cron enrichment | not set | not set | |
| `lib/intelligence/compose-daily-brief.ts:266` | compose the daily executive brief | brief generator | not set | not set | see §1.5 brief census |
| `lib/integrations/google-search.ts:54` | answer a question via Google-search-grounded ask | retrieval-adjacent | not set | not set | |
| `app/api/cron/weekly-review/route.ts:188` | generate the weekly review | cron enrichment (unattended) | not set | not set | one of only 7 `trackGeneration()` callers |
| `lib/inngest/functions/intelligence-brief.ts:489` | Inngest fan-out: intelligence brief | cron enrichment (unattended) | not set | not set | |
| `lib/ai/evals/quality-bench-core.ts:153` | LLM-judge quality bench | judge/eval | **0.5** | **600** | see §6 |
| `lib/ai/structured.ts:68` | generic "give me JSON matching this schema" helper | structured-output helper | not set | not set | **regex-parsed JSON, no schema validation — see §5** |
| `lib/ai/structured.ts:97` | `probeAiHealth({warm:true})` readiness ping | health probe | not set | not set | allowlisted (no telemetry — 1-token "ready" probe) |
| `lib/ai/stream-with-fallback.ts:298` | interactive chat streaming (spreads `build-stream-config.ts`) | chat (operator-requested) | not independently set here | **6000/10000** (mode-banded, `prepare-tools.ts:246`) | allowlisted; telemetry inherited as `"nick-chat"` |
| `lib/ai/reasoning/engine.ts:722` | deep-reasoning tool-gather | reasoning lane | not set | not set | uses `generateText` directly because `aiChat` has no tool support (AGENTS.md §5) |
| `lib/ai/provider.ts:1226` | `aiChat()` itself | *(the shared wrapper — see §1.1)* | not set | 1500/4000/8000 | |
| `lib/ai/provider.ts:1625` | `aiStream()` itself | *(the shared wrapper — see §1.1)* | not set | not set | |
| `app/api/ai/side-pane-chat/route.ts:223` | side-pane contextual chat | chat (operator-requested) | not set | **500** | |
| `app/api/ai/page-insight/route.ts:212` | page-insight summarizer | summarizer | not set | **600** | |
| `lib/ai/image-prompt-synth.ts:214` | synthesize an image-gen prompt from user intent | image-prompt synthesizer | **0.4** | **200** | |
| `lib/ai/image-prompt-synth.ts:266` | regenerate an image prompt on retry | image-prompt synthesizer | **0.4** | **250** | |
| `app/api/ai/chat/alternate-paths.ts:284` | alternate chat response path | chat (operator-requested) | not set | not set (see `AlternatePathConfig`) | |
| `app/api/ai/chat/alternate-paths.ts:318` | regenerate a chat response | chat (operator-requested) | not set | not set | |

"not set" above means: absent from a repo-wide grep for `temperature:\s*[\d.]+|maxOutputTokens:\s*
[\w.]+` scoped to that file (A — exhaustive over the matched pattern, not a sample). All 20
non-allowlisted rows carry `experimental_telemetry: langfuseTelemetry({functionId: "..."})`
directly in the call body (§0). None of the 22 pass a `tools` array except `reasoning/engine.ts:
722` (per AGENTS.md §5's own note) — none use `generateObject`/`streamObject` (zero matches
anywhere in the snapshot, confirmed §5).

### 1.3 Bare `aiChat()` call sites — production (`app/`, `lib/`)

Grep census (A): `grep -rn "\baiChat(" app/ lib/ --include=*.ts`, comments excluded by hand. All
share the §1.1 policy. `unattended?` is inferred from directory convention (cron/inngest =
unattended; brain/ = the always-on "brain" background subsystem per `AGENTS.md` §5's own framing;
app/api/ai/, tools/, agents/ = fired synchronously inside an operator-initiated chat/feature turn)
— marked (H) where the call site itself was not individually opened to confirm the trigger.

| path:line | purpose | lane | taskType (if visible) | unattended? (H) |
|---|---|---|---|---|
| `lib/ai/tools/content.ts:114` | chat-tool: NL→SQL generator (customers/jobs/leads/... schema) | extractor (chat tool call) | default | no — chat tool call |
| `lib/ai/tools/content.ts:133` | chat-tool: code generator (any language) | extractor (chat tool call) | default | no |
| `lib/ai/tools/content.ts:153` | chat-tool: text summarizer | summarizer (chat tool call) | default | no |
| `lib/ai/tools/content.ts:171` | chat-tool: sentiment classifier | classifier (chat tool call) | default | no |
| `lib/ai/tools/content.ts:190` | chat-tool: field extractor | extractor (chat tool call) | default | no |
| `lib/ai/tools/content.ts:208` | chat-tool: math solver | extractor (chat tool call) | default | no |
| `lib/ai/tools/content.ts:229` | chat-tool: on-brand creative copy variations | summarizer (chat tool call) | default | no |
| `lib/ai/tool-description-rewrite.ts:109` | rewrites a tool's own description for better tool-calling | meta/tooling | default | yes (offline tooling pass) |
| `lib/ai/router.ts:108` | thin `aiChat` passthrough router | chat | passed-through | no |
| `lib/ai/reasoning/engine.ts:156,415,547,587,657,875` (6 sites) | reasoning pipeline: plan / draft / critique / refine / quick-tier passthrough sub-calls (engine.ts:1579-1581 names these exactly) | reasoning | varies | no — operator-triggered deep-reasoning turn |
| `lib/ai/pretask-fanout.ts:89` | `callLens()` — fans out a strategic-framework "lens" before the main turn | summarizer/pre-processing | default | no |
| `lib/ai/multi-agent-orchestrator.ts:214` | sub-agent dispatch | chat (multi-agent) | default | no |
| `lib/ai/multi-agent-orchestrator.ts:251` | `SYNTHESIZER_SYSTEM` — synthesizes sub-agent outputs | summarizer | default | no |
| `lib/ai/memory.ts:79` | async knowledge extraction after an interaction (`recordInteraction` step 2) | extractor | default | yes — fire-and-forget post-turn |
| `lib/ai/browser/browse-and-do.ts:260` | browser-automation agent planner step | extractor (agent) | default | no |
| `lib/ai/board/consult.ts:170,314` (2 sites) | "AI board of advisors" — per-advisor + synthesis | chat (feature) | default | no |
| `lib/ai/agents/specialists/marketing-director.ts:39` | select a marketing persona for the turn | classifier | default | no |
| `lib/ai/agents/specialists/marketing-director.ts:69` | marketing-director agent reply | chat (agent) | reason | no |
| `lib/ai/agents/router.ts:96` | `CLASSIFY_SYSTEM_PROMPT` — agent router classification | classifier | default | no |
| `lib/ai/chat/chain-of-verification.ts:76,103,130` (3 sites) | chain-of-verification: `PLAN_SYSTEM` → `ANSWER_SYSTEM` → `REVISE_SYSTEM` (3-step self-check) | chat (verification loop) | default | no |
| `lib/ai/chat/calibration-enforcer.ts:92` | `ELICIT_SYSTEM` — confidence/calibration elicitation | judge/scorer | default | no |
| `lib/ai/judge-eval/comparator.ts:110` | `JUDGE_SYSTEM` — LLM-as-judge comparator | judge (eval) | default | yes (eval harness) — see §6 |
| `lib/ai/deep-research.ts:125` | `PLANNER_SYSTEM` — plans a research run | extractor (feature) | default | no |
| `lib/ai/deep-research.ts:178` | `SYNTHESIZER_SYSTEM` — synthesizes research rounds | summarizer | default | no |
| `lib/ai/deep-research.ts:325` | per-round research sub-call | extractor | default | no |
| `lib/ai/conversation-compress.ts:105` | `SUMMARIZER_SYSTEM` — compresses conversation history | summarizer | summary | no (inline chat-turn compression) |
| `lib/ai/adversarial-critic.ts:138` | adversarial self-critique pass | judge (self-critique) | fast | no |
| `lib/intelligence/experiment-measure.ts:105` | A/B experiment measurement/analysis | scorer | default | yes (background analysis) |
| `lib/agent/run-follow-up.ts:73` | autonomous follow-up action runner | chat (agent) | default | yes |
| `lib/chat/auto-rename.ts:80` | auto-titles a conversation | summarizer | default | yes (fire-and-forget post-turn) |
| `lib/services/reflection.ts:253` | reflection generator | summarizer | default | yes |
| `lib/services/pricing-advisor.ts:463` | pricing advice/recommendation | chat (feature) | default | no |
| `lib/brain/anticipated-questions.ts:294` | anticipated follow-up question generator | extractor | default | yes |
| `lib/brain/anticipated-questions.ts:390` | `PRECOMPUTE_SYSTEM` — precomputes anticipated Qs | extractor | default | yes |
| `lib/brain/conversation-memory.ts:80,577` (2 sites) | memory-relevant interaction recording/retrieval | extractor | default | yes |
| `lib/services/journal-convergence.ts:507` | journal-entry convergence/synthesis | summarizer | summary | yes |
| `lib/brain/contextual-recall.ts:248` | contextual memory recall assist | retrieval | default | no (inline chat-turn recall) |
| `lib/brain/journal-ingest.ts:259,752` (2 sites) | journal entry ingestion/extraction | extractor | default | yes |
| `lib/brain/journal-brain.ts:243,409` (2 sites) | "journal brain" processing | extractor/summarizer | default | yes |
| `lib/brain/improve-agent.ts:121` | self-improvement / meta-agent pass | meta | default | yes |
| `lib/services/chat-suggestions.ts:63` | suggested-reply chips generator | extractor | default | no (inline chat-turn) |
| `lib/brain/wisdom-distiller.ts:321` | distills wisdom/insight from accumulated data | summarizer | default | yes |
| `lib/brain/thinking-engine.ts:65,123,205,299,398` (5 sites) | "thinking engine" — 5 reasoning stages | reasoning | default | yes |
| `lib/brain/strategic-plans.ts:138` | strategic plan generation | extractor | default | yes |
| `lib/brain/session-distiller.ts:168` | session summarization/distillation | summarizer | default | yes |
| `lib/brain/relational-graph.ts:179` | relationship-graph inference | extractor | default | yes |
| `lib/brain/reflection-trees.ts:134` | tree-structured reflection generation | extractor | default | yes |
| `lib/brain/reflection-engine.ts:299,405` (2 sites) | reflection engine core | extractor | default | yes |
| `lib/brain/predictive-engine.ts:199` | predictive engine (forecast user needs/patterns) | scorer | default | yes |
| `lib/brain/pipeline-controller.ts:267,560` (2 sites) | brain pipeline orchestration | extractor | default | yes |
| `lib/brain/people-intelligence.ts:130` | person/contact enrichment | extractor | default | yes |
| `lib/brain/outcome-tracker.ts:75` | outcome tracking/evaluation | scorer | default | yes |
| `lib/brain/memory-consolidation.ts:70,342` (2 sites) | memory consolidation pass | extractor | default | yes |
| `lib/brain/learning-journal.ts:286` | learning-journal entries | extractor | default | yes |
| `lib/brain/emotional-arc.ts:193` | emotional-arc tracking | extractor | default | yes |
| `lib/brain/domain-knowledge-extractor.ts:122` | domain-knowledge extraction | extractor | fast | yes |
| `lib/brain/decision-patterns.ts:289` | decision-pattern detection | extractor | default | yes |
| `lib/ai/trajectory-grader.ts:151` | `JUDGE_SYSTEM` — grades an agent trajectory | judge (eval) | default | yes (eval/grading harness) |

**76 bare `aiChat(` call sites, verified by re-running the census grep and manually excluding
false positives** (`grep -rn "aiChat(" app/ lib/ --include=*.ts`, 86 raw hits; minus 9 comment
lines a naive `\s`-based filter let through on the first pass — POSIX `grep` does not expand `\s`
without `-P`, which is exactly the kind of silent-miss this report's own instructions warn about,
caught here by a second pass with an explicit `[[:space:]]` class; minus 1 internal call inside
`tracedAiChat()`'s own implementation, `lib/ai/traced-aichat.ts:125`, already covered under
`tracedAiChat` in §1.4 — counting it here too would double-count = 76). All 76 are listed in the
table above. Plus **5 more in `scripts/`** (dev tooling, not production runtime:
`scripts/backfill-conversation-archives.ts:140` batch-summarizes a conversation archive;
`scripts/smoke-ai-chain-full.ts:93,106,119` are literal smoke-test probes; `scripts/
probe-provider-health.ts:23` is a health probe) and **2 in `tests/`** (`tests/eval/run-suite.ts:
202`, `tests/eval/judge.ts:119` — eval harness, see §6). `lib/ai/provider.ts:1052` itself is the
function *definition*, not a call site, and is excluded from these counts.

### 1.4 `tracedAiChat()` call sites — production (`app/`, `lib/`)

Same grep discipline applied: `grep -rn "tracedAiChat(" app/ lib/ --include=*.ts` returns 42 raw
hits; 2 are comments (`lib/ai/budget.ts:144`, `lib/ai/traced-aichat.ts:10`'s own usage-example
docstring) → **40 real call sites**. Each supplies a `{label, source}` pair — `label` doubles as
the Langfuse `functionId` (§1.1). `source` is one of `chat`/`cron`/`autonomous`/`tool`/`journal`/
`brain`/`other` (agent-trace.ts:30-37) and is the most reliable per-call "lane" signal available
without opening every file, so it is reproduced here where visible from the label/path.

| path:line | label (= functionId) | purpose | source/lane | unattended? (H) |
|---|---|---|---|---|
| `app/api/webhooks/inbound-crm/route.ts:108` | `inbound-crm-parse` | parse inbound CRM webhook payload | tool | yes (webhook-triggered) |
| `app/api/ultron/tomorrow-note/route.ts:263` | `ultron-tomorrow-note` | generate tomorrow's Ultron note | autonomous | yes |
| `app/api/ultron/reflect/route.ts:209` | (label not captured — Ultron reflection route) | Ultron end-of-day reflection | autonomous | yes |
| `lib/brain/relationship-arc-projection.ts:70` | (brain-lane label) | project a relationship's future arc | brain | yes |
| `lib/brain/psychographic-ladder-adapter.ts:68` | (brain-lane label) | psychographic-ladder adaptation | brain | yes |
| `lib/brain/power-plays-runner.ts:76` | (brain-lane label) | runs "power plays" suggestions | brain | yes |
| `lib/brain/kept-word-tracker.ts:95` | (brain-lane label) | tracks kept promises/commitments | brain | yes |
| `lib/brain/greene-law-tagger.ts:88` | (brain-lane label) | tags content against Greene's 48 Laws framework | brain | yes |
| `app/api/telegram/webhook/route.ts:1764` | (chat-lane label) | Telegram bot reply (path A) | chat | yes (bot-triggered) |
| `app/api/telegram/webhook/route.ts:1910` | (chat-lane label) | Telegram bot reply (path B) | chat | yes (bot-triggered) |
| `lib/brain/dossier-autodrafter.ts:108` | (brain-lane label) | auto-drafts a person dossier | brain | yes |
| `lib/brain/behavioral-xray-adapter.ts:76` | (brain-lane label) | behavioral-xray analysis adapter | brain | yes |
| `lib/ai/runtime/chat-classifier.ts:197` | `intent-router` | classify chat-turn intent (§4.2) | chat | no — pre-stream, every chat turn |
| `lib/ai/relationships-pick-today.ts:340` | (relationships-lane label) | picks today's relationship focus | brain | yes |
| `lib/mastery/attribution.ts:74` | (mastery-lane label) | mastery/skill attribution (pass 1) | other | yes |
| `lib/mastery/attribution.ts:135` | (mastery-lane label) | mastery/skill attribution (pass 2) | other | yes |
| `app/api/ai/plan-day/route.ts:204` | (chat/tool-lane label) | plan-the-day generator | tool | no — operator-requested |
| `app/api/cron/relationship-weekly-synthesis/route.ts:181` | (cron-lane label) | weekly relationship synthesis | cron | yes |
| `app/api/cron/relationship-digest/route.ts:159` | (cron-lane label) | relationship digest | cron | yes |
| `app/api/ai/draft-outreach/route.ts:108` | (tool-lane label) | draft an outreach message | tool | no — operator-requested |
| `app/api/ai/assist/route.ts:302` | (chat-lane label) | general AI-assist endpoint | chat | no — operator-requested |
| `lib/services/ultron-plan.ts:85` | (autonomous-lane label) | Ultron planning service | autonomous | yes |
| `lib/services/revenue-decision-channel.ts:347` | (tool-lane label) | revenue-decision recommendation channel | tool | yes |
| `lib/ai/email-classifier.ts:100` | (tool-lane label) | classifies an inbound email | tool | yes |
| `lib/ai/contextual-greene-laws.ts:312` | (brain-lane label) | contextual application of Greene's Laws | brain | yes |
| `lib/services/journal-reflect.ts:181` | (journal-lane label) | journal reflection generator | journal | yes |
| `lib/ai/classify-task-linkage.ts:145` | (tool-lane label) | classifies task-to-task linkage | tool | yes |
| `lib/ai/brief-composer.ts:97` | (brief-lane label) | brief composition helper (see §1.5 brief census) | tool | varies |
| `lib/services/ai-track-story.ts:104` | (tool-lane label) | "track story" narrative generation | tool | no |
| `lib/services/ai-teach.ts:156` | (tool-lane label) | teaching/explanation generator | tool | no |
| `lib/services/ai-tasks.ts:200` | (tool-lane label) | task-related AI helper (pass 1) | tool | no |
| `lib/services/ai-tasks.ts:352` | (tool-lane label) | task-related AI helper (pass 2) | tool | no |
| `lib/services/ai-suggest-goals.ts:232` | (tool-lane label) | goal suggestions | tool | no |
| `lib/services/ai-plan-project.ts:286,355,469,551,638` (5 sites) | (tool-lane label) | project planning — 5 stages (plan/tasks/milestones/etc, not individually opened) | tool | no |
| `lib/services/ai-deconstruct.ts:52` | (tool-lane label) | deconstructs a goal/problem | tool | no |
| `lib/services/ai-coach-goal.ts:216` | (tool-lane label) | goal-coaching response | tool | no |

**"(... label)" rows** mean I did not individually open that file to read the literal `label:`
string (time-boxed — 40 files, each a 1-line lookup); the `source` column and purpose are inferred
from file path/name (H) and are lower-confidence than the §1.2/§4 rows, which were read in full.
The `lib/services/ai-*.ts` cluster (11 sites across 8 files) and the `lib/brain/*` cluster (9
sites across 9 files) are the two largest homogeneous groups — both are "coach/plan/reflect on
the operator's stated goals and journal" features, i.e. domain-specific summarize/extract/advise
calls, not general chat.

### 1.5 Embeddings, rerank, transcription, TTS, image generation

| path:line | fn | purpose | model/chain | AI-SDK primitive used? |
|---|---|---|---|---|
| `lib/ai/provider.ts:1451` (`getEmbedding`) | embedding | semantic-memory embedding, called from many recall sites | Cohere `embed-v4.0` → HuggingFace → OpenAI `text-embedding-3-small` → OpenRouter, all pinned **1024-dim** | **no** — 4-tier hand-rolled `fetch()`, not `embed()`/`embedMany()` |
| `lib/brain/contextual-recall.ts:889` | rerank | reranks retrieved memory candidates | delegates to `lib/ai/hf-embeddings.ts`/`lib/brain/bge-rerank.ts` (not independently re-read; comment at `bge-rerank.ts:7` says the orchestrator is "`lib/brain/rerank.ts`" — that file does not exist, the real file is `bge-rerank.ts`, a stale-comment filename drift) | not independently confirmed | not the AI SDK's `rerank()` |
| `lib/ai/stt.ts:160` (`transcribeAudio`) | transcription | speech-to-text for mic/audio-drop | groq `whisper-large-v3-turbo` → HuggingFace `whisper-large-v3` → OpenAI `whisper-1`, each raw `fetch()` FormData POST | **no** — no AI SDK transcription primitive used anywhere in this snapshot |
| `app/api/ai/speak/route.ts` | TTS | text-to-speech chat narration, per-sentence streaming | OpenAI `gpt-4o-mini-tts` (default, metered ~$0.015/min) → Microsoft Edge neural via `edge-tts-universal` (free, unofficial endpoint) → client-side Web Speech (final fallback) | no — both adapters are direct provider SDK/HTTP calls |
| `lib/ai/chat/handlers/image.ts` → `lib/ai/gemini-image.ts` (425 lines, header read) | image gen | chat-triggered image generation | Per `apps/statenour/AGENTS.md` §5 (higher-precedence than the file's own comment): **Replicate FLUX → Gemini → OpenRouter** via `generateImageWithFallback`. `gemini-image.ts`'s own header comment (line 4) instead describes itself as *"Google Gemini image-generation fallback for when Venice's flux-2-pro is unavailable"* — **Venice is fully retired** (§4.1); this header is stale and describes a chain that no longer exists. Model id: `GEMINI_IMAGE_MODEL` env, code default `gemini-3.1-flash-image` (gemini-image.ts:22-23) — the same file's own comment warns *"never name a model in this comment; it drifts (this line previously named a model two generations stale)"*, a self-aware instance of the exact problem this task was asked to watch for. | no — REST `fetch` to `generativelanguage.googleapis.com`, not the AI SDK image primitive |

`../worker` (`apps/worker/src/`, 3 files: `index.ts`, `scheduler.ts`, `storage.ts`) contains
**zero** model-call sites of any kind — confirmed by grepping for `aiChat|generateText|streamText|
openai|anthropic|ollama` across `worker/src` (no matches) and by inspecting its `fetch()` calls,
which all target `${STATENOUR_WEB_URL}/api/sync/queue/*` — the worker is a pure HTTP dispatcher
into the statenour web app's own routes (confirmed by `AGENTS.md`: *"No DB client — every
read/write goes over authenticated HTTP"*). Any model call a worker-triggered job makes happens
inside the statenour app process it calls into, and is already counted in §1.2-§1.4.

### 1.6 Brief generators — the specific census the task asked for

The task's premise — Home shows a "MORNING BRIEF" chip, a Missions-page comment claims *"Home
compiles THE brief"*, and six `/api/ai/*-brief` routes still exist — resolves to **three
separate, differently-wired systems that share confusingly similar names**, traced by grep +
direct reads (A):

**System 1 — the real Home morning brief (unattended, cron-driven).**
`lib/inngest/functions/morning-brief.ts` (line 12, its own comment: *"this function is now the
ONLY producer"*) defines a **local** `composeBrief()` function (line 61 — name-collides with, but
is NOT, the shared helper below) that writes 3x `prisma.brainMemory.upsert(...)` (lines 245, 373,
433) and runs on an Inngest cron step (`step.run("compose", composeBrief)`, line 475). Read back
by `readMorningBrief()` (`lib/services/morning-brief-read.ts`), consumed by: the REST route
`app/api/morning-brief/route.ts` (39 lines — pure read, no LLM call, delegates entirely to
`readMorningBrief`), a **TTS variant** `app/api/morning-brief/today.mp3/route.ts`, and a tRPC
procedure in `lib/trpc/routers/operator.ts`. Client-side, `lib/home/operator-brief.ts` and
`components/home/{change-line,nick-command-line}.tsx` reference it — **this is almost certainly
the actual source of the Home "MORNING BRIEF" chip** (the tRPC path explains why a plain
string-grep for the REST path under `app/`/`components/` under-finds callers — Next.js/tRPC apps
call procedures, not raw fetch URLs). The Missions-page comment (`app/(mastery)/missions/page.tsx:
22`, and `docs/RECONCILIATION.md:234-235`) is consistent with this: it says Missions' *own*
on-page AI brief + its route (*"nicks-morning-brief"*) were deliberately **deleted** because
*"Home compiles THE brief"* — i.e., this system, not any `/api/ai/*` route.

**System 2 — the `/api/ai/*-brief` family, built around a shared `lib/ai/brief-composer.ts`
`composeBrief()` (a second, differently-scoped function of the same name).** Six routes were
named in the task; one (`missions-morning-brief`) **does not exist in this snapshot** — `find`
returns nothing, consistent with the System-1 deletion note above (it was very likely the
"nicks-morning-brief" route RECONCILIATION.md says was removed). The other five:

| route | calls an LLM? | live UI caller found? |
|---|---|---|
| `app/api/ai/home-brief/route.ts` (143 lines) | **yes** — `await composeBrief(...)` from `lib/ai/brief-composer.ts:132`, which itself is a `tracedAiChat` site (§1.4) | **no** — grepped `home-brief` across `app/`, `components/`, `hooks/`, `features/`; the only two hits are doc-comment mentions inside two *other* brief routes' own files, not a fetch call. Despite the name, this route appears to be **orphaned** — not the Home chip (System 1 is), and not otherwise called. |
| `app/api/ai/journal-brief/route.ts` (182 lines) | yes — `composeBrief(...)` | **yes** — `components/journal/nicks-journal-brief.tsx`, mounted in `app/(mastery)/journal/_components/journal-insights-view.tsx`. Live. |
| `app/api/ai/goals-brief/route.ts` (124 lines) | yes — `composeBrief(...)` (line 113) | **no** — the file `lib/utils/api-fetch.ts:122-124` documents a *hypothetical* bug scenario naming an intended consumer, `nicks-goals-brief.tsx`, that **does not exist** anywhere in this tree (`find` on `components/` for that name: no match). Orphaned. |
| `app/api/ai/scoreboard-brief/route.ts` (113 lines) | yes — `buildMetaScoreboard()` (deterministic, `lib/services/meta-scoreboard.ts`) feeds into `composeBrief(...)` (line 102) | **no** — zero references anywhere outside its own route file. Fully orphaned. |
| `app/api/ai/relationships-morning-brief/route.ts` (118 lines) | yes (not independently confirmed for `composeBrief`, but the pattern matches its siblings) | **yes** — `components/relationships/nicks-relationships-brief.tsx`, mounted in `app/(mastery)/people/page.tsx`. This component's own copy also says "MORNING BRIEF" — **a second, legitimately-live "morning brief" surface exists, on the People page, independent of Home's.** |

**Net (I):** of the six named routes, one doesn't exist, three of the remaining five
(`home-brief`, `goals-brief`, `scoreboard-brief`) call a real LLM through `brief-composer.ts` and
have **no confirmed UI caller** — dead weight that still executes an LLM call and burns the
`tracedAiChat` budget-gate check (§1.1) if anything ever does call them (a stale integration test
or a forgotten cron could fire one silently). Two (`journal-brief`, `relationships-morning-brief`)
are live and correctly wired. The system the task's premise actually points at — Home's chip — is
a **completely different, unattended, cron-driven pipeline** with its own locally-scoped
`composeBrief()`, not any of the six. This naming collision (two unrelated `composeBrief`
functions, plus a family of `nicks-*-brief.tsx` components where some exist and are mounted and
others are only mentioned in comments) is itself a finding — see §7.

---

## 2. Prompt inventory

### 2.1 System-prompt assembly chain (versions, sizes, caching)

`buildSystemPrompt()` (`lib/ai/system-prompt.ts`, 333 lines, read in full) → `buildSystemPromptV2()`
(`lib/ai/prompt/v2/index.ts`, 124 lines, read in full) assembles, in order: **Layer 1**
`buildStaticPrefix()` (`lib/ai/prompt/static.ts`, 219 lines, read in full — identity, Nour's
profile, 7 working principles, response style, processing rules, the operator-policy block,
tools description, builder mode; **"No metrics. No numeric claims"** by the file's own hard rule)
→ **Layer 1.5** `buildInferredPatternsBlock()` (`lib/ai/prompt/inferred-patterns.ts`, not opened —
5 behavioral hypotheses reframed as untested hypotheses, no magnitudes, per index.ts's own
description) → **Layer 2** live-operating-state sections from `renderPromptV2(ctx)`
(`lib/ai/prompt/v2/renderer.ts`, 724 lines, not opened in full — driven by `NickPrimeContext`;
anchors/agendaItems/temporal/commands/whyBlock/recentThinking/domainSnapshot/proof/risks/decisions/
health) → `buildCalibrationBlock()` (fail-open, kill-switch `CALIBRATION_PROMPT_BLOCK_DISABLED`).
**The v1→v2 cutover is irreversible and already complete**: `prompt/v2/index.ts:33-39`
states *"CUTOVER COMPLETE. v2 is the SOLE prompt builder... There is NO v1 builder left, so
'NICK_PRIME_PROMPT=off' is NOT a valid rollback lever."* `lib/ai/system-prompt.ts` itself is now a
pure **orchestrator** (caching + budget-trim + JIT gating), not prompt content.

**★ Stale self-description, caught by direct comparison.** `lib/ai/prompt/policy/operator-rules.ts`'s
own header (read in full below) still says: *"v1 (system-prompt.ts · 1819 lines · live in
production) and v2 (lib/ai/prompt/v2 · cleaner architecture · feature-flagged) share ONE
definition."* Both halves of that sentence are now false — `system-prompt.ts` is 333 lines (not
1819; it was rewritten from a monolithic builder into a thin orchestrator as part of the v2
cutover) and v2 is the sole live builder, not "feature-flagged." Comment predates the cutover and
was never updated.

**Char budgets — three distinct, easily-conflated ceilings, each with its own citation:**

| budget | value | where | what it bounds |
|---|---|---|---|
| Layer-1 guard | 40,000 chars | `docs/CURRENT-TRUTH.md:146` (D — dated measurement); **measured 13,274 chars** via `scripts/measure-static-layer.ts` (D) | `buildStaticPrefix()`'s own output only |
| Base-prompt trim | 58,000 chars | `lib/ai/system-prompt.ts:114`, `trimPromptToBudget()` (A — read in full) | the assembled Layer1+1.5+2(+calibration) prompt, BEFORE the business-knowledge layer is appended |
| Runtime hard cap | 65,000 chars | `NON_ANTHROPIC_RUNTIME_CAP`, `system-prompt.ts:153`, mirrored from `app/api/ai/chat/finalize-system-prompt.ts` `MAX_SYSTEM_CHARS` (A — the mirror is asserted by the code comment, `finalize-system-prompt.ts` itself not independently re-read) | the FINAL prompt after the business-knowledge pack is appended, for every non-Anthropic provider (i.e., the primary Ollama lane) |

`trimPromptToBudget()` is a **priority-ordered section dropper** (30 priority tiers, 1-9
protected/never-dropped — TRUTH RULE, Nour's rules, response style, tools/processing-intake,
identity/voice, pinned/hot-rules/anchors, command-state, temporal, active-risks; 10-30 droppable
in reverse-index order when over budget). **This is infrastructure, not the thing that was
refuted.** The task's "prompt-trim... REFUTED, do not re-propose" refers to a *specific* A/B
(`docs/PROMPT-AB-2026-08-12`+`12b`: incumbent scored 4, compact scored 3, below the pre-registered
≥3-lead threshold → abandoned as noise, per `docs/CURRENT-TRUTH.md:127-129`) — a comparison of two
*whole-prompt variants*, not this budget-safety clamp, which still runs unconditionally on every
turn and is not itself under test.

**Caching, two independent layers with different keys/TTLs:** inner `cached(cacheKey, 300, ...)`
inside `buildSystemPrompt()` keyed `` `system_prompt_v3_${tier}_${variant}_${dayKey}_${bucket}` ``
— `tier` (core/business/personal/strategy/full, from regex `BUSINESS_SIGNALS`/`PERSONAL_SIGNALS`/
`STRATEGY_SIGNALS`), `variant` (slot × content-format, from `computePromptVariant`), the date
(`America/New_York`), and a 3-way time bucket (am/pm/eve) — so the same message shape gets a fresh
prompt at most every 4-8h, not every turn. An OUTER 45s cache exists in
`lib/ai/system-prompt-cache.ts` (not independently opened) keyed coarser, per a 2026-07-12 review
comment cited in `system-prompt.ts:39-44` that says the two caches used to partition
*differently* (inner on slot-only, outer on a content-mode boolean) and could serve a
cross-contaminated prompt for up to 45s — since fixed to share the `variant` key. The **JIT
section gate runs OUTSIDE both caches, per-request** (`applyJitSectionGate`,
`lib/ai/vnext/jit-sections.ts`, 78 lines, read in full) — deliberately, because gating inside the
cached closure could let a casual turn's sections-dropped prompt get served to a later
context-grounded turn sharing the same cache key. It drops exactly 3 named sections (`## ACTIVE
AGENDA ITEMS`, `## Behavioral patterns`, `## Processing intake`, ~9.2K chars, per its own
docstring citing a measured A/B) on `casual`-shaped turns or social-content-marketing turns
(a narrow regex, deliberately NOT the generic content-intent detector — the file's comment
explains a customer-SMS-draft case that must NOT be gated); unknown/empty messages keep
everything (fail-open toward more context). Kill-switch `NICK_JIT_SECTIONS=0`.

### 2.2 Prompt/instruction inventory table

| constant/file | path:line | size (chars, where measured) | versioned? | injected when | five-word gist |
|---|---|---|---|---|---|
| `identityBlock()` | `lib/ai/prompt/static.ts:58-83` | not independently measured | stable (exported since 2026-08-15 for A/B use) | every turn, Layer 1 | Nick = King Nour's Hand, OWNER AUTHORITY |
| `nourProfileBlock()` | `lib/ai/prompt/static.ts:87-102` | not measured | stable | every turn, Layer 1 | Nour's bio, ADHD, body target, patterns |
| `workingPrinciplesBlock()` | `lib/ai/prompt/static.ts:106-117` | not measured | stable | every turn, Layer 1 | 7 rules: do-the-work, never-assume, compound |
| `responseStyleBlock()` | `lib/ai/prompt/static.ts:121-155` | not measured | stable | every turn, Layer 1 | intent-based length, not a word-count |
| `processingRulesBlock()` | `lib/ai/prompt/static.ts:159-177` | not measured | stable | every turn, Layer 1 | extract, act, connect, don't just suggest |
| `getOperatorPolicyBlock()` (8-rule bundle) | `lib/ai/prompt/policy/operator-rules.ts:206-248` | not measured | **v10.0.404** consolidated, shared by v1/v2 | every turn, Layer 1 | 8 named glitch-fix rules, oldest 2026-07 |
| — `DO_NOT_AUTO_TASKIFY` | `operator-rules.ts:39` | ~500 chars | v10.0.391 | in the 8-rule bundle | don't createTask on casual mentions |
| — `CONFIRMATION_EXECUTES` | `operator-rules.ts:61-63` | ~600 chars | 2026-08-18, added for 2 measured regressions | in the bundle | "yes"/"retry" are orders, not chat |
| — `NO_SYCOPHANCY` | `operator-rules.ts:65` | ~350 chars | v10.0.392 | in the bundle | skip the opener, answer in 8 words |
| — `BREVITY_DEFAULT` | `operator-rules.ts:67` | ~250 chars | v10.0.392 | in the bundle | ≤80 words default, ≤30 voice mode |
| — `INLINE_CITATIONS` | `operator-rules.ts:69` | ~350 chars | v10.0.393 | in the bundle | bracket-cite wisdoms, never verbatim |
| — `ESTIMATIVE_LIKELIHOOD` | `operator-rules.ts:108` | ~380 chars | BDN-302, 2026-08-14 | in the bundle (replaced CONFIDENCE_CUES) | ODNI 7-point probability bands, mandatory |
| — `ANALYTIC_CONFIDENCE` | `operator-rules.ts:110` | ~420 chars | BDN-302, 2026-08-14 | in the bundle | evidence-quality separate from probability |
| — `TIME_OF_DAY_VOICE` | `operator-rules.ts:112` | ~280 chars | v10.0.393 | in the bundle | morning crisp, late-night terse+sleep-nudge |
| — `MODE_PERSONAS` | `operator-rules.ts:114-118` | ~500 chars | v10.0.400 | in the bundle | /battle /reflect /execute voice prefixes |
| — `TRUTH_RULE_NEVER_FABRICATE` | `operator-rules.ts:120-131` | ~900 chars | v10.0.162, the "Bay 5 lesson" | in the bundle | no tool call = no past-tense claim |
| — `EMPTY_RESULT_IS_NOT_NO_CAPABILITY` | `operator-rules.ts:156-164` | ~800 chars | 2026-08-29 | in the bundle, directly under TRUTH RULE | empty search ≠ "I can't verify" |
| `toolsBlock()` | `lib/ai/prompt/static.ts:181-203` | not measured | stable; corrected 2026-06-10 (dropped a false "150+" tool count) | every turn, Layer 1 | named frequent tools + NL-shortcut list |
| `builderModeBlock()` | `lib/ai/prompt/static.ts:207-219` | not measured | stable | every turn, Layer 1 | GitHub tools, both apps' stacks, workflow |
| `buildInferredPatternsBlock()` | `lib/ai/prompt/inferred-patterns.ts` (not opened) | not measured | Layer 1.5, "no magnitudes" by design | every turn | 5 behavioral hypotheses, explicitly untested |
| `TOOL_DATA_FENCING_RULE` | `lib/ai/tool-result-fencing.ts:147-161` | ~1,050 chars | stable | injected once, pairs with every `<tool_data>` fence in the conversation | fenced content = data, never instructions |
| `INTENT_SYSTEM_PROMPT` | `lib/ai/runtime/chat-classifier.ts:144-167` | ~1,150 chars | stable | pre-stream, every chat turn (`classifyIntent`, `tracedAiChat` label `intent-router`) | JSON-only intent/mode/targets classifier |
| `JUDGE_SYSTEM` | referenced in `lib/ai/trajectory-grader.ts`, `judge-eval/comparator.ts`, `tests/eval/judge.ts` (not opened) | not measured | stable | eval/judge calls only | LLM-as-judge rubric, not independently read |
| `PLANNER_SYSTEM` / `SYNTHESIZER_SYSTEM` | `lib/ai/deep-research.ts` (not opened) | not measured | stable | deep-research feature | plan research rounds / synthesize sources |
| `PLAN_SYSTEM` / `ANSWER_SYSTEM` / `REVISE_SYSTEM` | `lib/ai/chat/chain-of-verification.ts` (not opened) | not measured | stable | chain-of-verification loop | 3-step self-check: plan, answer, revise |
| `ELICIT_SYSTEM` | `lib/ai/chat/calibration-enforcer.ts` (not opened) | not measured | stable | calibration-enforcer pass | elicits a confidence/calibration statement |
| `CLASSIFY_SYSTEM_PROMPT` | `lib/ai/agents/router.ts` (not opened) | not measured | stable | agent-router classification | routes a turn to the right sub-agent |
| `SUMMARIZER_SYSTEM` | `lib/ai/conversation-compress.ts`, `lib/ai/multi-agent-orchestrator.ts` (not opened) | not measured | stable | conversation compression / multi-agent synth | summarizes history or sub-agent outputs |

Rows marked "not opened" / "not measured" are named and located precisely (path is exact) but this
report did not open every one of the ~15 smaller feature-specific system prompts individually —
time-boxed given the ~160-site call census above took priority; each is a legitimate follow-up
read if a specific one needs auditing.

**Prompt-adjacent deterministic copy the task asked to include, for contrast:**

- **`lib/home/derive-briefing.ts`** (180 lines, read in full) — the Home attention-card's RPG/coach
  copy ("ANALYZING...", "ACTIVE ENGAGEMENT", "RESUME OPEN LOOP", "AWAITING YOUR DECISION",
  "HYGIENE QUEUE BUILDING", "INBOX OVERFLOW", "SYSTEMS NOMINAL", "ALL QUEUES CLEAR"). **Zero LLM
  calls** — a pure priority-cascade function over already-computed inputs (loading → unreadable →
  active-engagement → resume → decide → hygiene-warning → inbox-warning → nominal → idle), each
  branch a hand-written template string. Two prior defects are self-documented in the header: a
  DAILY/WEEKLY habit loop could wrongly claim the "active engagement" arm (fixed with a
  `HABIT_LOOPS` guard shared with the scorer), and the "decide" arm the original design specified
  was simply never implemented in the old inline version. Correctly deterministic — no verdict.
- **`lib/services/next-move.ts`** (339 lines, read in full) — header states outright: *"Fast · zero
  LLM calls · pure Prisma queries + ranking."* `STAT_KEY_TO_MISSION_DOMAIN` (lines 67-105) is a
  ~30-entry static `Record<string,string>` mapping RPG-flavored "stat keys" (physical, combat,
  mental, fortitude, business_ops, financial, sales, seduction, ...) to 5 canonical
  `MissionDomain` enum values (BUSINESS/PERSONAL/HEALTH/CONTENT/FINANCE). Pure lookup table, no
  model involved. Also correctly deterministic — no verdict.

### 2.3 Conflicts between prompts — the codebase's own documented near-misses

The task asked specifically whether two truth rules, two persona stances, or two fencing
instructions coexist. Direct evidence, all class A (read in `operator-rules.ts` and cross-checked
against the files each comment names):

1. **Two uncertainty vocabularies, RESOLVED but the old one still exists and is importable.**
   `CONFIDENCE_CUES` (`operator-rules.ts:71`, v10.0.393 — a single blended hedge: "Best guess:" /
   "Probably:") was **replaced** in the actually-injected set by the `ESTIMATIVE_LIKELIHOOD` +
   `ANALYTIC_CONFIDENCE` split (BDN-302, 2026-08-14) — `getOperatorPolicyLines()` (lines 213-243)
   does **not** call `CONFIDENCE_CUES`, and the code comment says so explicitly: *"shipping both
   would put two competing uncertainty vocabularies in one prompt, which is the exact drift this
   file exists to prevent."* Confirmed not live: `grep -rn "CONFIDENCE_CUES"` finds it only in its
   own definition, `lib/ai/prompt/static.ts`'s comment (stale — that comment's own list of "eight
   operator rules" still names `CONFIDENCE_CUES`, not the pair that replaced it, a second-order
   copy of the same drift), a truth/estimative helper, a smoke script, and its regression test.
   **Not currently double-injected — but the dead constant remains exported, so a future import
   could silently reintroduce exactly the conflict this file's own comment names.**
2. **Two "elevate the answer" directives, RESOLVED the same way.** `BROADEN_AND_SUGGEST`
   (`operator-rules.ts:193-198`, v10.0.482) was removed from the injected bundle (2026-07-11
   review, lines 207-212) because `lib/ai/knowledge/behavior-directive.ts`'s `ANTICIPATE_AND_ELEVATE`
   (injected separately, by `app/api/ai/chat/finalize-system-prompt.ts`, on every non-casual turn
   — not independently re-read here) "explicitly 'Replaces the BROADEN_AND_SUGGEST operator-rule.'"
   Same pattern: confirmed not double-injected by grep, same latent-reintroduction risk.
3. **Fencing instruction: one rule, one canonical source, no conflict found.**
   `TOOL_DATA_FENCING_RULE` (`lib/ai/tool-result-fencing.ts:147-161`) is the only fencing-instruction
   text found; it is paired with the `<tool_data>` wrapper mechanism used consistently by
   `fenceContent()` calls across `lib/services/chat/brain-context.ts`'s ~30 imported producers and
   the `lib/ai/tools/*.ts` tool catalog (§3 covers the enforcement gate). No second, competing
   fencing instruction was found.
4. **Truth rule: one canonical source; one doc's pointer to it is imprecise.**
   `apps/statenour/AGENTS.md` §4 names *"L1 prompt rule | `lib/ai/system-prompt.ts` `## TRUTH
   RULE`"* as the fabrication-defense stack's top layer. The literal text `TRUTH_RULE_NEVER_FABRICATE`
   lives in `operator-rules.ts:120-131`, reached from `system-prompt.ts` only indirectly
   (`system-prompt.ts` → `prompt/v2` → `prompt/static.ts` → `operator-rules.ts`) — `system-prompt.ts`
   itself (333 lines, read in full) contains no `## TRUTH RULE` text. A reader who greps that exact
   file for the string will not find it. Not a functional conflict (the rule does ship, and does
   reach the model) — a doc-pointer imprecision, low-stakes but worth a one-line fix.

---

## 3. Context assembly for a chat turn

### 3.1 Ordered block list

Two independent assembly pipelines run per turn and their outputs concatenate: the **system
prompt** (§2.1, cached 300s/45s, `system_prompt_v3_${tier}_${variant}_${dayKey}_${bucket}` key)
and the **brain-context addendum**, assembled fresh on every request by
`lib/services/chat/brain-context.ts` (586 lines, header read — no full-body read; "Pure
orchestration over already-extracted brain modules — no inline DB calls" per its own docstring)
and appended to the system prompt at the chat route level (not cached — the fencing-gate test's
own header explains why this file exists: *"brain-context.ts imports ~30 modules and splices
their output into the chat system prompt"*).

**Brain-context pipeline, in the order its own header states it:**

1. **Parallel import + fetch**, 7 named brain modules (`chat-recall`, `skills`, `identity`,
   `ghost`, `qualitative-identity`, `beliefs`, `cross-system-nudge`) plus `task-context` — each
   wrapped in a **3-second timeout fallback** so one slow DB round-trip cannot stall the stream
   (source: brain-context.ts:9-11, class A).
2. **Rerank by semantic similarity** to the user's turn via `rerankContextBlocks()`
   (`lib/ai/context-reranker.ts`, imported at brain-context.ts:29) — **blocks below a 0.12
   similarity threshold are dropped** to save context window (brain-context.ts:13-14, class A).
   Falls back to raw insertion order if the embedding call returns empty or the reranker throws —
   the same 4-tier hand-rolled embedding chain from §4.5, so a total embedding-provider outage
   degrades this step to "keep everything, unranked" rather than failing the turn.
3. **Fire-tracking** — which blocks actually produced content, surfaced via an
   `X-Context-Blocks` response header and `onFinish` telemetry (brain-context.ts:15-16).
4. **Deeper-context telemetry extraction** — counts + a type list (Strategic Laws, Reflections,
   Brain Dumps, Past Replies) pulled back out of the assembled `contextMemories` string for
   logging (brain-context.ts:17-19).
5. **Predictive-prefetch append** — `formatPrefetchContext()` output appended last if a prefetch
   landed (brain-context.ts:20, `lib/ai/predictive-prefetch.ts`).

**Invalidation:** the brain-context addendum has no cache of its own — it is recomputed every
turn (its whole design point, per the header, is being "pure orchestration" over live per-turn
data, unlike the cached system prompt). The system prompt's own two caches (§2.1) invalidate on
TTL expiry (300s inner / 45s outer) or a `tier`/`variant`/day/time-bucket change; the JIT gate
(§2.1) is deliberately outside both so a turn's own message shape always re-evaluates.

**Every memory/recall/thread/anticipation-shaped block found, with its fencing status** (source:
direct read of `tests/ai/prompt-block-fencing-gate.test.ts`, 207 lines, in full — its `ALLOWLIST`
and the 11 modules its own test requires to be BOTH interpolating AND fenced; class A for what the
test asserts, not independently re-verified inside each producer file):

| producer (`@/lib/...`) | reads stored content? | fences it? | why (if allowlisted) |
|---|---|---|---|
| `brain/contextual-recall` | yes | **yes** (required by the gate) | — |
| `brain/memory-recall` | yes | **yes** (required) | — |
| `brain/anticipatory-recall` | yes | **yes** (required) | — |
| `brain/chat-recall` | yes | **yes** (required) | — |
| `brain/belief-harvester` | yes | **yes** (required) | — |
| `brain/qualitative-identity` | yes | **yes** (required) | — |
| `brain/ghost-nick` | yes | **yes** (required) | — |
| `brain/anticipated-questions` | yes | **yes** (required) | — |
| `brain/contradiction-injector` | yes | **yes** (required) | — |
| `brain/session-distiller` | yes | **yes** (required) | — |
| `brain/objection-injector` | yes | **yes** (required) | — |
| `ai/predictive-prefetch` | yes | no (allowlisted) | serializes system-authored `financial_forecast` rows as JSON data, not an ingestion category |
| `brain/cross-system-nudge` | yes | no (allowlisted) | renders an LLM-derived belief-refresh line, not raw ingested content |
| `brain/conversation-memory` | yes | no (allowlisted) | fenced downstream, by its own consumer at brain-context.ts (`cross_session`), before slicing |
| `brain/identity-snapshot` | yes | no (allowlisted) | renders numeric identity axes only — no stored free text reaches the prompt |
| `brain/skill-extractor` | yes | **deliberately no** (allowlisted) | skill protocols ARE instructions by design — fencing them as data would defeat their purpose; the actual poisoning path (`captureSkillFromSource`) is owner-gated instead |
| `ai/greene-message-matcher` | yes | no (allowlisted) | reads the app-seeded `greene_law` corpus — static curated text, not third-party input |
| `ai/dark-psychology-matcher` | yes | no (allowlisted) | reads the app-seeded `dark_psychology` corpus — same reasoning |

The gate additionally requires (and I confirmed by the test's own assertions, not by opening each
file) `>= 25` total modules imported by `brain-context.ts` — 18 are accounted for above; the
remaining ~7+ were not individually classified in this report.

**Tool-result fencing is a second, separate door** into the same content, analyzed **per tool
block**, not per file — the same test file's `analyzeToolSource()` scans every `` name: tool({ ``
literal across `lib/ai/tools/*.ts` and finds **≥150 tool blocks** (a floor assertion from the
gate's own sanity check, not necessarily equal to the operator-facing `TOOL_CATALOG.length` count
— those are two different scans and this report does not equate them), of which **≥12** both read
BrainMemory/ChatMessage rows and touch `.content`. Seven are allowlisted by name
(`goals.ts:getWeeklyTargets`, `habits.ts:weeklyReview`, `habits.ts:analyzeWeek`,
`tasks.ts:getDecisionsDueForReplay`, `tasks.ts:decisionPreFlight`, `tasks.ts:dailyPulse`,
`tasks.ts:endOfDay`) — all either numeric-only (`IDENTITY_SNAPSHOT` axes) or operator/app-authored
rows (weekly targets the operator set, decisions the operator journaled himself), never
third-party ingested text. The gate's own **mutation canary** (lines 158-170) proves the
enforcement is per-tool: stripping `brain.ts`'s `searchColdMemory` fence in memory makes only that
tool register as bare, while sibling tools in the same 1,600-line file (`searchMemories`,
`searchConversations`) still register as fenced — a direct guard against the exact defect shape
the test's own header names (*"a file-level `contains fenceContent` check let the first fenced
tool in the 1,600-line brain.ts vouch for every other tool in it"*).

### 3.2 The fencing mechanism itself

`fenceContent()`/`truncateFenced()` live in `lib/ai/tool-result-fencing.ts` (161 lines; the
`truncateFenced` half read in full above, §2.2). Fenced output takes the shape
`<tool_data tool="..." source="...">...</tool_data>`, with 5 documented `source=` values:
`external_web`, `external_doc`, `cross_session`, `memory_recall`, `curated_memory` — each has its
own sentence in `TOOL_DATA_FENCING_RULE` telling the model exactly how to treat it (quote facts,
ignore embedded commands; cite as recollection; never treat a stale entry as a fresh instruction).
`truncateFenced()` exists to fix a real, self-documented incident: a bare `.slice()` on a fenced
block that happened to land inside an open `<tool_data>` tag left every LATER addendum block —
"truth grounding, permission directives, the fencing rule itself" — inside an unterminated
`memory_recall` region, i.e. **it taught the model that trusted instructions were untrusted data**
(comment at `tool-result-fencing.ts:122-130`, PR #2060 review). Re-closes the fence with the same
tool attribute and a visible truncation note if a cut would otherwise land mid-fence.

---

## 4. Routing

### 4.1 Provider chain, model ids, and the "chain" that mostly isn't tried

**`config/ai-providers.ts`** (170 lines, read in full — A) is the single source of truth for
provider config:

| Provider | `defaultModel` | vision model | cost class | notes |
|---|---|---|---|---|
| ollama | `deepseek-v4-pro` (line 55) | `gemma4:31b` (line 64) | `zero_incremental` | fast-lane override via `OLLAMA_FAST_MODEL` env (no code default) |
| gemini | `gemini-3.5-flash` (line 72) | same | `metered` | |
| openai | `gpt-4o` (line 87) | same | `metered` | |
| anthropic | `claude-sonnet-5` (line 100) | same | `metered` | escalation lane also uses `claude-opus-5`/`claude-fable-5`/`claude-mythos-5`, see §4.3 |
| openrouter | `x-ai/grok-4.3` (line 122) | *undeclared* → excluded from vision turns by design (`isVisionCapableProvider`, provider.ts:699) | `metered` | reasoning/deep/code tasks re-resolve to the same id via `OPENROUTER_REASONING_MODEL` (provider.ts:108-116) — a no-op today unless that env is set to something else |

**★ Model-id drift, caught live.** `config/ai-providers.ts:55` hardcodes ollama's fallback
default as `"deepseek-v4-pro"`. `docs/CURRENT-TRUTH.md:124` (dated "Since 2026-08-16" section)
states plainly: *"`deepseek-v4-pro` is DEAD (retired upstream mid-session)"* and names
`minimax-m3` as the correct pin (also `kimi-k3` → HTTP 402, `deepseek-v3.1:671b` → HTTP 410
"long gone"). Both are class-A reads of this exact snapshot. The code default is not what's
live in prod (the live pin is presumably `OLLAMA_MODEL=minimax-m3` in Railway env, which this
source tree cannot confirm — env is not code), but the hardcoded *fallback-if-env-unset* value
in the file is a dead model id, contradicting `docs/CURRENT-TRUTH.md:182`'s own instruction not
to assert model names in prose because "it drifts; point to the file" — the file itself has
drifted. **Per task instruction, this report does not recommend any of these ids as currently
alive; `docs/CURRENT-TRUTH.md` is the more recent claim per the source-hierarchy in `AGENTS.md`,
so treat `deepseek-v4-pro` as dead and unverified whether the code default has since been fixed.**

**`TASK_ROUTING_PREFERENCES`** (ai-providers.ts:157-170) maps all 12 `TaskType` values (fast,
sql, summary, classify, extract, reason, vision, deep, code, math, creative, embed) to the
*identical* array `["ollama", "openrouter", "gemini", "openai", "anthropic"]`. **(H)** — as
written, this 12-entry Record buys zero behavioral differentiation over a single shared
constant; every key resolves to the same order. Differentiation between task types happens
elsewhere (model choice inside `resolveProviderModel`, timeout/token caps inside `aiChat`), not
here. Either this table is a deliberately-flat placeholder for future per-task ordering, or it's
12x the surface a single constant would need with identical behavior — a kaizen/YAGNI candidate
(see §7).

**The cost firewall makes the "chain" mostly theoretical for internal calls.** `PROVIDER_COST_CLASS`
(ai-providers.ts:140-146) marks only `ollama` as `zero_incremental`; every other provider is
`metered`. `filterByCostFirewall()` (provider.ts:747-755) strips every metered provider from the
candidate list unless `allowMetered` is true or the firewall is off (`NICK_COST_FIREWALL=0`).
**`grep -rn "allowMetered:\s*true"` across the entire snapshot returns zero matches** — no call
site in this codebase ever passes `allowMetered: true`. So, as coded, the only ways a turn ever
reaches Gemini/OpenAI/Anthropic/OpenRouter through the normal `aiChat`/`tracedAiChat` path are:
(a) the operator has set `AI_PROVIDER` to pin a specific provider (exempt from the firewall,
provider.ts:815-828), or (b) `NICK_FAILOVER_RESCUE=1` is set, which appends the metered providers
as a **tail**, tried only after every zero-incremental provider has already failed
(provider.ts:1110-1149, comment dated 2026-08-15). **`NICK_FAILOVER_RESCUE` defaults to unset**
(`docs/CURRENT-TRUTH.md:111`: *"Last-resort rescue tail added, OFF by default,
`NICK_FAILOVER_RESCUE=1` (#1589; operator enabled it 2026-08-15)"* — the doc says the *operator*
enabled it in prod on that date, which is env config this source tree cannot verify). **(H)** —
taken together, dozens of comments across the codebase describe "the provider chain: Ollama →
Gemini → OpenAI → Anthropic" (provider.ts:4, and near-identical language in
`lib/ai/adversarial-critic.ts:131`, `lib/ai/pretask-fanout.ts:84`, `lib/ai/deep-research.ts:157`,
`lib/ai/multi-agent-orchestrator.ts:196`, etc.) as if it runs on every call; as coded, for a
call site that never sets `allowMetered`, that chain only executes if the rescue-tail env flag is
on — otherwise a failed/cooldown Ollama returns straight to the `emergency` sentinel (§1, §7).

**Stale "Venice" comments.** `grep -c Venice` across `app/`+`lib/` returns **225 occurrences
across 94 files** (A). Venice was fully retired from the runtime `PROVIDERS` list
(provider.ts:5-7, `VENICE_PARAMS`/`clearVeniceQuotaExhausted` kept only as no-op back-compat
stubs, lines 193-194, 365-371). A sample of comments that still describe Venice as live or part
of the active chain: `lib/ai/adversarial-critic.ts:131` ("Venice → Ollama → OpenAI → Anthropic"),
`scripts/translate-skills.ts:6` ("provider chain · Venice → Ollama → OpenAI fallback"),
`lib/ai/budget.ts` (Venice pricing table retained in `lib/ai/track.ts:19-26` MODEL_COSTS,
labeled "current Apr 2026 model list"). Not every one of the 225 hits is stale prose — many are
correctly-labeled historical/retired notes — but the two cited above assert Venice as a *live*
hop in the fallback chain, which is false in this snapshot.

**Circuit breakers & failover.** Each of the 4 non-openrouter runtime providers gets a
`makeQuotaBreaker()` (provider.ts:339-363) with a shared `AI_PROVIDER_COOLDOWN_MS = 2min`
(config/ai-providers.ts:1). Ollama additionally gets a background health probe
(`probeOllamaHealth`, provider.ts:413-464) cached for 60s, hitting `GET {baseUrl}/v1/models` with
a 3s timeout and checking the resolved model id is present in the returned list. Separately,
`markProviderFailed()`/`isProviderRecentlyFailed()` (provider.ts:641-656) is a **short** 60s TTL
per-provider failure marker distinct from the quota breaker (2min) — set when a mid-stream error
fires after SSE headers are already sent (a provider can't be swapped mid-response, so the
*next* turn skips it for 60s). Both mechanisms are ordinary orderings, not hard exclusions — an
"all recently failed" fallback loop still returns *something* rather than throwing
(provider.ts:844-849).

### 4.2 Domain routing (`lib/ai/domain-routing.ts` → re-export shim)

**`lib/ai/domain-routing.ts` is a 43-byte, 1-line file: `export * from "./runtime/chat-classifier";`**
(A — read directly). The actual logic lives in `lib/ai/runtime/chat-classifier.ts` (263 lines,
read in full), which merges three previously-separate modules (per its own section comments):

1. **`detectDomain()`** (lines 28-130) — **pure regex pattern-matching, zero LLM cost.** 7
   categories (code / vision / strategy / marketing / creative / fast-classify / summary),
   each a hand-written keyword regex mapped to a `{domain, taskType, preferLargeContext, label}`
   tuple. This is a *correctly-deterministic* design — no model call, no latency, no failure
   surface — worth naming as a positive counter-example in §7 alongside the LLM-based intent
   router one function below it in the same file.
2. **`classifyIntent()`** (lines 169-243) — **calls the model.** Routes through `tracedAiChat`
   with `label: "intent-router"`, `taskType: "classify"`, wrapped in an 8s `withTimeout` (line
   196-211, comment: this sits "on the pre-stream critical path," an unbounded stall being the
   "Nick is stuck" 90s zero-byte hang). System prompt `INTENT_SYSTEM_PROMPT` (lines 144-167, ~1.1K
   chars) asks for a bare JSON object (`intent`/`mode`/`targets`); the reply is regex-stripped of
   markdown fences and `JSON.parse`'d with **no schema validation** (line 219) — see §5. On any
   error (timeout, bad JSON, provider failure) it silently returns a **hardcoded fallback**
   `{intent: "general_chat", mode: "operator", ...}` (lines 234-241) — fail-soft, but the fallback
   choice ("operator" mode, not "fast") is a deterministic policy default standing in for a
   failed model call.
3. **`classifyChatTurn()`** (lines 255-263) — composes `detectChatMode()` (imported, not read),
   `detectDomain()`, and `classifyIntent()` into one `ChatTurnClassification`.

### 4.3 Depth-marker escalation + daily cap (`lib/ai/vnext/escalation.ts`, 302 lines, read in full)

Confirmed **live**, wired into `app/api/ai/chat/route.ts` (grep for `resolveEscalation(` —
2 call sites total: the chat route and this file's own test). This is a **deliberately
non-LLM** escalation trigger — the file's docstring (lines 11-26) documents that an LLM-based
"how hard is this" complexity classifier was **built, measured, and rejected on 2026-08-28**:
`classifyCore` under-escalates short high-stakes asks (p50 operator message is 64 chars measured
on prod; 56.6% of 655 user turns in 30 days are under 80 chars — a worked example, "audit the
whole chat stack..." at 78 chars, classifies "quick"). The replacement is **explicit marker
regexes only** (`DEEP_MARKERS`/`THOROUGH_MARKERS`/`MEGA_MARKERS`/`QUICK_OVERRIDES`, imported from
`lib/ai/reasoning/classifier-core.ts` — a single source so escalation and the deep-reasoning
pipeline's own trigger never drift apart). This is the single clearest **"belongs in
deterministic policy, not the model"** decision in the codebase, and it states its own evidence
inline rather than asserting it — good practice worth naming as a positive example in §7.

- **Tiers:** `none` → `deep`/`thorough` → `claude-opus-5` @ effort `high` → `mega` (only reachable
  via an explicit `/mega` or equivalent marker) → `claude-fable-5` @ effort `max`, `justify: true`.
  Untrusted input (web/Drive/email content in the turn) always routes to `fable-5` regardless of
  tier, "classifier ON" being a deliberate safety feature, never `mythos` (lines 154-166).
- **Blockers are never silent** (`EscalationBlocker`: `no-api-key` / `daily-cap-reached` /
  `disabled-by-operator` / `private-mode`, lines 53-57, 121-152) — each returns a
  `blockedBy` + human `reason` string.
- **`ESCALATION_DAILY_CAP = 20`/day** (env `NICK_ESCALATION_DAILY_CAP`, line 216-219), sized
  against a measured ~21 assistant-turns/day and an estimated worst case of ~$2.90/day of Opus-5
  exposure (D — the file's own comment, lines 206-214, not independently re-measured here).
- **`countEscalationsToday()`** (lines 253-284) counts **existing `AiGeneration` rows** by model
  suffix match rather than keeping a separate counter — "a separate counter is a second source of
  truth that can drift from the bill" (line 223). The file **documents its own two known
  imprecisions** verbatim (lines 230-241, class A — this is the authors' own admission, not this
  report's inference): (1) a marked ask under 40 chars is skipped by the `isLightweight` check in
  the writer path and escalates **without** consuming the counted budget; (2) the counter read is
  fire-and-forget/post-turn, so two escalations seconds apart can both read a stale count. It
  fails **closed** on a DB read error (returns the cap itself, refusing further escalation) — the
  *opposite* of `getAiConfig()`'s deliberate fail-open elsewhere (cited inline at line 249),
  and the file explains why the asymmetry is intentional: free-lane chat degrading is harmless,
  an unbounded metered lane is not.
- **The counter depends on the SAME `AiGeneration` writer gap documented in §1/§7** —
  `countEscalationsToday` reads `prisma.aiGeneration.count(...)`, and the only writer that
  populates a chat-turn's row is `recordInteraction()` from
  `lib/services/chat/deferred-background-work.ts:106` (confirmed the *sole* caller — grep, A).
  So the cap is accurate for the one pipeline that actually writes rows into it, not a
  general-purpose Claude-5 spend meter.

**A second, unrelated frontier router exists and is NOT live.** `lib/ai/vnext/effort-policy.ts`
(199 lines, read in full) exports `routeCapability()`, a capability-banded router
(`deterministic`/`trivial`/`normal`/`strategic`/`hard`/`frontier`) whose own docstring says
verbatim: *"Pure function, wired to NO live path yet — the incumbent `TASK_ROUTING_PREFERENCES`
chain keeps serving production until this router wins its eval (additive-migration rule: delete
a legacy layer only after it loses an A/B)"* (lines 7-10). `escalation.ts` imports only this
file's `CLAUDE5_MODELS` constant and `ClaudeEffort` type — not `routeCapability()` itself. Two
narrower helpers from the *same file*, `canaryDeepForce()` and `claude5EffortForAttempt()`, ARE
live (gated behind `NICK_CANARY_DEEP_ANTHROPIC=1`, off by default, lines 163-199) — they route
`mode==="deep"` chat turns to the Anthropic lane at effort `high` when the canary flag is set.
**Net: three overlapping "how hard is this, which model" mechanisms coexist** — the flat
`TASK_ROUTING_PREFERENCES` table (§4.1, live, undifferentiated), the marker-based
`resolveEscalation()` (§4.3, live), and the banded `routeCapability()` (built, evaluated never
per its own comment, dead code today). See §7.

### 4.4 Reasoning lane (`lib/ai/reasoning/engine.ts`, 1673 lines — read selectively; `tier-config.ts`, 121 lines, read in full)

`TIER_CONFIG` (tier-config.ts:43-98) is a `Record<ReasoningTier, TierConfig>` — TypeScript
enforces every tier has an entry (exhaustiveness, documented as the reason this file exists: a
prior tier addition required hunting 5+ files). Six tiers, cheap → expensive:

| tier | budget estimate (D, self-declared) | critique | refine | router |
|---|---|---|---|---|
| quick | $0.0005 | no | no | no |
| standard | $0.006 | yes | no | no |
| smart | $0.015 | yes | yes | **yes** (M.1, only tier) |
| deep | $0.025 | yes | yes | no |
| thorough | $0.12 | yes | yes | no |
| mega | $0.25 | yes | yes | no |

These are pre-execution **estimates** used to drive a budget gate, not measured actuals — do not
report them as real spend. Per `apps/statenour/AGENTS.md` §3, the live reasoning tool-gather
whitelist is `lib/ai/reasoning/reasoning-tools.ts` (not independently re-read here; treat as the
canonical source, gated by `NICK_DEEP_REASONING`). `lib/ai/reasoning/engine.ts:722` is one of the
22 raw AI-SDK call sites (§0, row 14) — the codebase's own `AGENTS.md` §5 flags this explicitly:
*"Deep-reasoning tool-gather uses `generateText`, NOT `aiChat`"* — because `aiChat` has no tool
support (confirmed by reading `provider.ts`'s `aiChat` signature: it takes only `messages` +
`taskType` + a narrow `opts`, no `tools` param).

### 4.5 Embedding model + dimension

**AI SDK's `embed()`/`embedMany()` primitives are not used in production.** `getEmbedding()`
(provider.ts:1451-1461, memoized 45s) delegates to `getEmbeddingUncached()`
(provider.ts:1463-1603), a **hand-rolled 4-tier HTTP fallback**, none of it going through the
`ai` package: (1) **Cohere** `embed-v4.0` via raw `fetch` to `api.cohere.com/v2/embed`, dimension
pinned to 1024 via `output_dimension` (lines 1474-1531); (2) **HuggingFace**
(`lib/ai/hf-embeddings.ts`, not independently read); (3) **OpenAI** `text-embedding-3-small` via
raw `fetch`, `dimensions: 1024` (lines 1546-1567); (4) **OpenRouter**
`openai/text-embedding-3-small`, same dimension (lines 1570-1597). **Ollama is deliberately
excluded** from this chain — the comment (lines 1414-1419) says it 404'd/401'd on embeddings in
prod and its default model is 768-dim, which "would poison the 1024-dim space." Every tier is
pinned to **1024 dimensions**; `padToVectorDim()` (`lib/db/pgvector.ts`, not independently read)
normalizes any off-contract width. The only place the AI SDK's actual `embed()` call appears in
this snapshot is `scripts/test-gemini-embed.ts` — a standalone dev script, not a production path.
`rerank()` is called once, at `lib/brain/contextual-recall.ts:889`; its comment says the
orchestrator lives at *"lib/brain/rerank.ts"* but the file that actually exists is
`lib/brain/bge-rerank.ts` (confirmed via `find` — the comment's path is stale by one filename;
minor, flagged for completeness).

### 4.6 What routing buys vs. what it costs

**Buys (per the codebase's own dated comments, cited above):** survived two silent full-lane
outages from upstream model retirement (`qwen3-vl` vision 06-16, `deepseek-v3.1:671b` chat
07-15 — both documented in `config/ai-providers.ts` comments); a documented, measured decision
to keep an expensive complexity classifier OUT of the escalation path; per-provider quota
breakers that stop a dead lane from being retried every request; graceful degradation (a sentinel
string) instead of a thrown exception on total failure.

**Costs, measured in code surface, not developer-days (H):** `provider.ts` alone is 1646 lines
carrying 5 provider constructors, 4 quota breakers, 2 failure-TTL mechanisms, a cost firewall, a
rescue-hop, and an emergency sentinel — all before a single chat message is answered. Three
distinct "how hard should this turn be treated" mechanisms coexist (§4.3) with only one fully
live. The `TASK_ROUTING_PREFERENCES` table is 12 lines that could be one. `Venice`, a fully
retired provider, still appears in 94 files' worth of comments, several of which describe it as
live. A doc (`CURRENT-TRUTH.md`) explicitly warns against hardcoding model names in prose "because
it drifts," while the code it points to also hardcodes a now-dead model name as a fallback.

---

## 5. Structured-output risk

**Root cause, structural: `generateObject`/`streamObject` are never used.** Confirmed twice in
this report by direct grep (§0, §1.2) — `\b(generateObject|streamObject)\(` returns zero matches
anywhere in `app/`+`lib/`. AI SDK v6 is installed (`ai` 6.0.162) and does support schema-validated
structured output natively; this codebase does not use that path for a single call site. Every
"give me JSON back" need is met by asking for JSON in the prompt text and hand-parsing the reply.

**Confirmed regex-parsed / hand-parsed JSON call sites** (class A, each read directly):

1. **`lib/ai/structured.ts:44-58`, `parseJsonFromText()`.** The codebase's own general-purpose
   "structured AI response" helper (used by `next-move`, `clarify-mission`, `ai-health` per its
   header comment — not independently re-verified which routes currently call it). Strips a
   ```` ```json ```` fence via regex, else finds the first `{` and last `}` and slices between
   them, then `JSON.parse`s the result. **The `schema` parameter it accepts
   (`Record<string, unknown>`) is never validated against — it is only interpolated into the
   prompt text as a hint** (`createStructuredAiResponse`, structured.ts:64-79: *"Respond with ONLY
   valid JSON matching this schema... ${JSON.stringify(prompt.schema, null, 2)}"*). A syntactically
   valid JSON object that does NOT match the intended shape passes through silently and is cast
   `as T` with no runtime check. **No retry on parse failure** — a caught error is rethrown as
   `AiUnavailableError("generation_failed")` (line 83), ending the call.
2. **`lib/ai/runtime/chat-classifier.ts:213-219`, `classifyIntent()`.** Same fence-strip regex
   pattern, then `JSON.parse`. **No retry** — any failure (parse error, timeout, provider failure)
   falls to a hardcoded default classification object (§4.2). Silent and fail-soft, unlike
   `structured.ts`'s throw — two different call sites solving the identical problem
   ("parse JSON the model returned") chose two different failure contracts, independently.
3. **`lib/services/journal-convergence.ts:507-524`.** A third independent implementation: tries
   `JSON.parse(txt)` expecting an array; on failure, falls through to a **line-by-line regex
   parse** of bulleted text ("model sometimes returns bullets" — comment, line 522). **No retry
   against the model** — the fallback re-parses the SAME response text a second way rather than
   re-asking; if both parses fail, the function presumably returns an empty/partial result (not
   independently traced further).
4. **`lib/ai/agents/router.ts`**, `CLASSIFY_SYSTEM_PROMPT` (line 73) — asks for a routing decision
   from the model; not independently confirmed whether it parses JSON or free text (not opened
   past the prompt constant itself).

**Total `JSON.parse(` occurrences across `app/`+`lib/`: 236** (A — exact grep count). The three
above are the ones this report traced to an AI-response-parsing context; the remaining ~230+ were
**not individually audited** — most are very likely ordinary payload/config/cache parsing
unrelated to model output (webhook bodies, `metadata` JSON columns, `.env`-adjacent config) and it
would be a fabrication to characterize all 236 as a structured-output risk. **Do not read "236"
as an AI-parsing-risk count** — it is the size of the haystack, not the number of needles; a
follow-up census scoped to "sites that call `JSON.parse` on `result.content` /
`response.content` / an `aiChat`/`generateText` return value" would be needed to give an audited
total.

**Deterministic alternative available and unused (H):** since none of the ~160 model-call sites
in §1 use `generateObject`, every one of them that wants structured output back is exposed to this
risk class by construction, not by an individual mistake at each site — the fix is one level up
(adopt `generateObject` + zod), not per-caller.

---

## 6. Evals and observability

### 6.1 What's in `lib/evals/` and `tests/eval/`

`lib/evals/` (4 files: `memory-eval-report.ts`, `memory-eval-runner.ts`, `memory-eval-types.ts`,
`memory-evals.ts` — file list only, not opened) is a separate, memory-specific eval track, run via
`pnpm eval:memory` (`scripts/run-memory-evals.ts`) and `pnpm eval:recall`
(`scripts/recall-eval.ts`). `docs/CURRENT-TRUTH.md:200` names it *"the truth scoreboard that
checks Nick remembers this file"* — i.e., it grades recall against `CURRENT-TRUTH.md` itself as
ground truth, not independently re-verified here.

`tests/eval/run-suite.ts` (read in full through its header + arg-parsing) is the **LLM-as-judge
regression suite**, with two explicit modes documented in its own header (class A):

- **dry-run (default)** — loads and Zod-validates every scenario JSON, prints a category
  breakdown, **zero LLM calls**. The header states this is *"Used by the contract test and any CI
  run"* — `tests/eval/run-suite.test.ts` exists as that contract test (not opened in depth), and
  `verify:hard`'s script string (read directly from `package.json:12`) runs `pnpm test`, which is
  the vitest suite `run-suite.test.ts` belongs to. **What actually runs in CI, per this reading,
  is schema validation only — never a live model call.**
- **`--live`** — calls Nick per scenario via `aiChat`, judges each via `tests/eval/judge.ts`,
  writes a timestamped report to `tests/eval/reports/<ISO>.json`. Exit code **0** clean, **1**
  schema-invalid, **2** any scenario scored composite **< 6.0** or errored. Header: *"Operator
  runs this manually because it incurs $ on the provider chain"* — **not part of any automated
  gate**, confirmed absent from `verify:hard`'s script string.

**Corpus size, measured directly:** `find tests/eval/scenarios -name "*.json" | wc -l` → **38**
scenario files (A), spanning named categories visible in filenames: persona-obedience (5),
persona-sycophancy (5), persona-calibration (3), security-fence/injection (3), specialist-routing
(3), task-* (7), refusal (2), brief (2), plus single-scenario categories (memory-pattern-recall,
multi-turn-coherence, reflection-insight-recall, decision-pricing-push,
financial-variance-spike, edge-empty-context, voice-short-prompt). **The suite's own cost-estimate
comment is stale**: `run-suite.ts:26-30` says *"8 scenarios · roughly $0.002 per suite run"* — the
corpus has since grown to 38; the $/suite figure is UNMEASURED at current scale, not $0.002 (the
per-scenario ~$0.0002 estimate may still hold, but 38× it, not 8×, and neither number in the
comment was re-measured here — report only what the comment says, not a recomputed total).

### 6.2 Judge mechanisms — three distinct ones, not one

1. **`judgeReply()` in `lib/ai/judge-eval.ts`** — per `tests/eval/judge.ts:4-5`'s own description,
   this *"powers real-time per-reply scoring in production chat"* on a **fixed 5-axis rubric**
   (accuracy / actionability / brevity / tone / evidence). Live in the interactive chat path, not
   just an offline harness (not independently re-opened to confirm every caller).
2. **The comparator, `lib/ai/judge-eval/comparator.ts`** (aiChat call censused §1.3) — powers
   `POST /api/judge-eval/run` (39-line header read), an **operator-triggered, ad-hoc AGENT_V1 vs
   AGENT_V2** comparison: the operator pastes `{prompt, v1Reply, v2Reply}`, the judge scores both,
   the row persists to BrainMemory for `/system/judge-eval`. Explicitly **not automatic** — the
   route's own header explains why: a shadow-execute cron would need to run both chat paths in
   parallel, "bigger scope"; this manual endpoint was the smaller first step.
3. **The regression-suite judge, `tests/eval/judge.ts`** — a **deliberate, explained non-reuse**
   of #1: its header states *"Why not extend judge-eval.ts itself · keeping that module's API
   stable... mutating its signature for a single test suite would be a YAGNI violation. This
   adapter borrows the prompt structure + provider routing pattern verbatim."* Scores
   **scenario-specific criteria** (each scenario JSON defines its own 1-6 weighted criteria)
   rather than the fixed 5-axis rubric. Bias mitigation is stated inline: single-reply scoring
   (no pairwise position bias), brevity is one scored criterion (so terseness isn't free-rewarded),
   and it deliberately uses the **"classify" task profile** — *"NOT the same model class as Nick's
   generation"* — a real judge/generator model-family separation, good LLM-eval practice.
   **Same stale-Venice pattern recurs here too**: line 17's comment still says *"Venice → Ollama →
   OpenAI → Anthropic per the policy matrix"*.

### 6.3 Calibration — two mechanisms with different scope, one with a defined probabilistic meaning

- **`lib/ai/outcome-calibration.ts`** (299 lines, header read) implements a genuine
  **PREDICT → PARSE → PERSIST → RESOLVE → CALIBRATE** loop, narrowly scoped to **content-
  performance predictions**: (1) Nick states a confidence like "I think this hits 400+
  engagement" when generating content; (2) a regex extracts the number from the reply; (3) it's
  persisted to `brain_memory` (`category="prediction"`); (4) when real `content_performance`
  numbers land, they're matched back via a caption-preview hash; (5) **every 7 days**, Nick's
  actual error rate is computed and injected into the content-mode prompt as a calibration block
  ("your predictions are 73% accurate within ±20% of actual — use base rate when claiming
  confidence"). This has a real, measured probabilistic meaning: an empirical hit-rate against
  a real outcome, fed back into the very prompt that generates the next prediction.
- **The broader `ESTIMATIVE_LIKELIHOOD`/`ANALYTIC_CONFIDENCE` split (§2.2, BDN-302)** targets
  every uncertain claim in chat, not just content predictions, using the ODNI seven-point
  probability-band vocabulary specifically **so a Brier score becomes computable** — the
  motivating comment (`operator-rules.ts:85-89`) states plainly: *"BDN-106 shipped a Brier-score
  calibration report on 2026-08-12 reporting honest n=0. A Brier score REQUIRES a probability. A
  blended hedge word is not one, so the report was structurally ungradeable."* `parseEstimative()`
  (`lib/ai/vnext/truth/estimative.ts`) is named as the reader that extracts these bands back out
  of model replies. **Not independently verified here**: whether the BDN-106 Brier-score report
  has produced any graded output (n > 0) since the BDN-302 fix landed — UNMEASURED from this
  source-only read; would require querying the live report or its persistence table.

### 6.4 Langfuse / OTel / Braintrust — what's wired, what's aspirational

19 distinct **literal** `functionId` trace names were confirmed live in §0's positive-control
cross-check (plus 2 more dynamic-per-taskType ones inside `provider.ts` invisible to a literal-
string scan, plus every `tracedAiChat` call's `label`, §1.4). `lib/observability/langfuse.ts`
(the `langfuseTelemetry()` builder itself) is imported from 22+ files (§0's file list) and has its
own unit test (`tests/lib/observability/langfuse-telemetry.test.ts`, confirms `isEnabled` gating
and a `privateMode` flag that turns tracing off). `@langfuse/otel` 5.10 and OTel export
(`scripts/export-otel-traces.ts`) exist per the task's stated snapshot facts; Braintrust is
referenced across `lib/env.ts`, `lib/feature-flags.ts`, `lib/observability/otel-export.ts`,
`lib/security/route-policy.ts`, health-check routes, and `scripts/export-eval-datasets.ts` — its
actual runtime role (exporter target vs. feature-flagged, on/off by default) was **not
independently traced** in this pass; flagged as a gap rather than guessed.

---

## 7. Verdicts

### 7.1 Ten call sites where a rule, SQL query, or heuristic would likely be more reliable than the LLM

Each cites the exact call site and the specific reason a deterministic replacement is plausible —
this is this report's judgment (H), not a measured A/B; none of these have been benchmarked
against a deterministic alternative in this codebase as far as this report found.

1. **`lib/ai/tools/content.ts:171`** — a 3-class sentiment classifier (POSITIVE/NEGATIVE/NEUTRAL)
   via a full chat-tool LLM round-trip. Textbook case for a lightweight classifier or even a
   keyword/lexicon heuristic — cheaper, deterministic, and immune to the whole provider-fallback
   surface in §1.1 for a 3-way decision.
2. **`lib/ai/tools/content.ts:208`** — a "math expert, solve step by step" tool. LLMs are known-
   unreliable at exact arithmetic; a calculator/CAS call is strictly more correct for anything
   that is actually computable, and the LLM adds only narration value on top.
3. **`lib/ai/tools/content.ts:114`** — natural-language → raw SQL generation against a **named,
   fixed, 7-table schema** (customers/jobs/leads/daily_scores/google_reviews/sms_logs/
   payment_records, per the system prompt text itself). A small set of parameterized report
   queries (or a query-builder over the same 7 tables) would be deterministic, injection-safe by
   construction, and not dependent on the model correctly inferring column names it was never
   shown a schema for beyond the table list in the prompt string.
4. **`lib/ai/runtime/chat-classifier.ts:197`, `classifyIntent()`** — an LLM call (8s timeout, on
   the pre-stream critical path of every chat turn) to bucket a message into 6 intents × 3 modes,
   defined in the **same file**, one function above, `detectDomain()` — a zero-cost, zero-latency
   regex classifier solving a structurally identical problem (bucket a message by pattern). The
   file itself is the counter-evidence for its own LLM call.
5. **`lib/ai/agents/router.ts:96`**, `CLASSIFY_SYSTEM_PROMPT` — routes a turn to a sub-agent via a
   full LLM call; same classification shape as #4, no smaller-footprint alternative attempted.
6. **`lib/ai/agents/specialists/marketing-director.ts:39`** — selects a marketing persona from a
   small, fixed enum via `aiChat`. A small fixed choice set is exactly what a regex/keyword router
   (again, `detectDomain`'s own pattern) handles well.
7. **`lib/ai/tool-description-rewrite.ts:109`** — uses an LLM call to rewrite OTHER tools'
   descriptions. This is a meta-call whose unpredictable output then shapes how every future
   tool-choice decision is made across the whole tool catalog (§3.1's ≥150 blocks) — a
   template-from-the-tool's-own-zod-schema approach would be reviewable and stable; an LLM
   rewrite of tool descriptions is not.
8. **`lib/chat/auto-rename.ts:80`** — auto-titles a conversation via `aiChat`. A cheap heuristic
   (first substantive clause of the first user message, truncated) would cost nothing and fail
   only in the same edge cases a bad LLM title would.
9. **`lib/services/journal-convergence.ts:507-524`** — asks the model for a JSON array of names,
   then defends against the model NOT returning that shape with a second, line-by-line regex
   parser ("model sometimes returns bullets" — the call site's own comment). The existence of the
   fallback is itself the argument: if the operation is "pick top-N names from a known set," a
   scored/ranked deterministic selection over that same set removes the parsing risk entirely.
10. **`lib/ai/classify-task-linkage.ts:145`** — an LLM judgment on whether two tasks are linked.
    Existing relational signals (shared mission/project id, shared tags, temporal proximity,
    shared customer/lead reference) could plausibly compute a linkage SCORE deterministically,
    with the LLM reserved for the residual ambiguous cases rather than every classification.

### 7.2 Five places where deterministic code hides a judgment that should be explicit to the operator (H)

1. **`config/ai-providers.ts:157-170`, `TASK_ROUTING_PREFERENCES`.** The elaborate 12-value
   `TaskType` enum implies task-aware provider ordering; all 12 entries are byte-identical. The
   real judgment — "task type does not currently affect provider order" — is invisible unless
   someone diffs all 12 array literals; nothing in the operator-facing surface says so.
2. **The cost firewall's silent Ollama-lockdown.** `PROVIDER_COST_CLASS` + `filterByCostFirewall`
   + the confirmed-zero `allowMetered: true` call sites (§4.1) combine into a sweeping policy —
   "every one of ~160 internal LLM call sites gets Ollama or the emergency sentinel, never a paid
   fallback, unless the operator has set `AI_PROVIDER` or `NICK_FAILOVER_RESCUE=1` in Railway env"
   — that is not stated as a single visible switch anywhere; it is an emergent property of three
   separate mechanisms an operator would have to read `provider.ts` line-by-line to reconstruct.
3. **`lib/ai/system-prompt.ts:274-305`, `trimPromptToBudget()`'s priority table.** A real editorial
   judgment about what matters most to Nick's reasoning (truth rule outranks tools outranks
   business data outranks reflections outranks brain dumps) is encoded as hardcoded
   string-matching against section TITLE TEXT, priorities 1-30. A section-title rename silently
   changes its drop priority; nothing surfaces to the operator, in the moment, which sections a
   given turn actually dropped (the `context-manifest.ts` log exists for forensic replay, but nothing
   pushes "3 sections were cut from this reply" to the UI).
4. **`lib/home/derive-briefing.ts`'s numeric thresholds** — `findingsCount >= 3` for the "HYGIENE
   QUEUE BUILDING" warning, `inboxCount >= 7` for "INBOX OVERFLOW" (lines 133, 143) — are real
   judgment calls about what counts as "enough to warn the operator," hardcoded with no comment
   explaining why 3 or why 7, and no operator-facing setting to tune either number.
5. **`lib/services/next-move.ts:67-105`, `STAT_KEY_TO_MISSION_DOMAIN`.** A ~30-entry static map
   makes real categorization judgments — `seduction` → PERSONAL, `networking` → CONTENT,
   `leadership` → CONTENT (not BUSINESS), `financial` → FINANCE but `business_ops` → BUSINESS —
   that quietly decide which domain gets flagged "weakest" and which tasks get suggested as the
   fix. No rationale is recorded for any individual mapping choice, and there is no operator-
   facing view of the table itself.

---

## Limitations / NOT VERIFIED

- **Prompt char sizes** for most Layer-1 sub-blocks (§2.2 "not measured" rows), `renderer.ts`'s
  Layer-2 sections individually, and the `lib/ai/agents/marketing/registry.ts` persona library
  (discovered in passing — at least one ~7,000-char agent "backstory" string, not censused; a
  distinct, sizable prompt surface this report did not budget time to fully inventory).
- **`nick-prime-context.ts`** (209 lines) and **`renderer.ts`** (724 lines) were not opened in
  full — Layer-2 section CONTENT (vs. the section NAMES/order, which are documented) is not
  independently verified here.
- **Whether `home-brief`/`goals-brief`/`scoreboard-brief` are truly dead** (§1.6) rests on a
  string/name grep across `app/`, `components/`, `hooks/`, `features/` — a caller reached via a
  tRPC procedure name (as the real Home morning-brief turned out to be) rather than a literal path
  string would not be caught by that method; treat "no live UI caller found" as a strong negative
  signal, not a proof of zero runtime traffic.
- **`lib/ai/judge-eval.ts`'s claim to power real-time production scoring** is taken from
  `tests/eval/judge.ts`'s own description of it, not independently confirmed by finding its
  production call site.
- **Braintrust's actual wiring** (§6.4) — referenced in 8+ files, role not traced.
- **The full ~230 remaining `JSON.parse(` sites** (§5) were not individually classified as
  AI-output-parsing vs. ordinary payload parsing.
- **Whether the BDN-106 Brier-score calibration report currently produces graded output** (§6.3)
  is unknown from source alone.
- All env-dependent claims (`AI_PROVIDER`, `NICK_FAILOVER_RESCUE`, `NICK_COST_FIREWALL`,
  `ANTHROPIC_MYTHOS_ENABLED`, `OLLAMA_FAST_MODEL`, `GROQ_API_KEY` presence, etc.) describe what the
  **code does for each possible value**; this report cannot read Railway's live environment and
  does not claim to know which value is actually set in production, per `AGENTS.md`'s own
  source-of-truth hierarchy ("a `.env` file is NOT evidence of production config").
