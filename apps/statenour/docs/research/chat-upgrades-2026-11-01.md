# Chat upgrades for Nick (bdnick.info): what to build next, ranked

Job 2026-11-01-chat-humanizer-w6 · research lane · base `cf775425b1` · written 2026-11-01.
Read-only: no code, no production writes, no installs, no paid APIs.

## The answer

Nick is not short on features. It falls down in four places, all measured this week:

1. **Every tool card disappears when the chat reloads.** 94 of 124 traced turns called tools, but 0 of 123 stored
   replies kept a tool part: `buildMessageParts` only ever saves text and reasoning
   (`lib/services/chat/message-parts.ts:60-76`). This is the "cards aren't showing" Nour reported.
2. **A turn takes 53 s at the median and 133 s at p90.** The model work is 34 s at the median. Then a verify tail of
   16 s median and 43 s at p90 runs after the last token, and 48 of 124 turns spent over 20 s in it.
3. **46% of tool calls are lookups for other tools.** Of 570 tool calls, 99 were `searchTools` and 164 were
   `invokeTool`. Each detour adds a model step: 10.5 s and about 15k input tokens at the median.
4. **About 1 reply in 18 is a fallback apology.** 7 of 123 replies were the empty-reply copy. The sibling session owns
   that bug (section 2.3).

The top 3 lane briefs are in section 5:

- **B1:** save the whole reply so cards survive a reload.
- **B2:** let a reply finish when its text does, with verification after.
- **B3:** cut the tool-lookup detours.

They are about 5 days of build in total, all on the free stack.

Research route: Claude in Chrome had no connected browser (`list_connected_browsers` returned `[]` at 13:50Z), so
there was no Perplexity run. Primary pages were read directly with WebFetch and WebSearch. The 2026-10-26 Perplexity
report (359 sources, memory `chat-speed-research-2026-10-26`) is reused, not redone.

Benchmarked against:
- Anthropic advanced tool use (https://www.anthropic.com/engineering/advanced-tool-use) · adopted: deferred tool
  definitions and tool-use examples · rejected: programmatic tool calling for now, because it needs a code sandbox and
  a model that writes reliable code.
- AI SDK message persistence (https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence) · adopted: store the
  whole `UIMessage` and validate it on load.
- Claude memory (https://claude.com/blog/memory) and ChatGPT memory (help.openai.com) · adopted: one editable memory
  summary and an inline "saved" notice.
- ChatGPT Pulse (press coverage, 2025-09) · adopted: card feedback steers tomorrow's cards.
- Letta sleep-time compute (https://www.letta.com/blog/sleep-time-compute) · already incumbent here, but failing
  (2.4).
- Gemini Deep Research (https://blog.google/products/gemini/google-gemini-deep-research/) · adopted: an editable plan
  before a long run.
- Pi (design write-ups only) · adopted: ask later about a plan he mentioned.
- assistant-ui and A2UI · already PATTERN verdicts, owned by the W6 card session.

Labels: **FACT** (measured or read this session, with source) · **STRONG INFERENCE** · **CLAIM** (someone else's
statement, not re-checked) · **UNKNOWN**.

---

## 1. What already exists (so nothing here is re-proposed)

| Area | What shipped | Source |
|---|---|---|
| Chat v2 wave, 2026-10-30/31 | 16 PRs: honest tool-error counts (3397), Approve fixes (3404, 3437, 3443), free browser voice (3409), message queue (3415), shop-fact honesty and task tools (3422), 10 photos per message (3431), Context & Evidence panel (3436), layout (3439), 35% recall floor (3441), pins/archive/search/pop-up mutes (3449, 3450, 3452), video cards (3451), audit-002 fixes (3455) | FACT: `apps/statenour/docs/RECONCILIATION.md` 2026-10-31 entry |
| Stream first | First word arrives before verification finishes (e12f6c0341, 2026-10-26); the client binds the saved reply after the tail (3355) | FACT: `git log origin/main`; memory `chat-verify-tail-3355` |
| Chat audit | 7 days clean; summary sweep pages; honest verifier banner (3351) | FACT: memory `bdnick-chat-audit-2026-10-29` |
| Speed research | 18 ranked levers, among them cache-stable prompt order, phase timers, post-reply passes via `after()`, keeping Ollama Pro's 3 slots free | CLAIM (Perplexity report, memory `chat-speed-research-2026-10-26`); not re-verified |
| Tool search | `pruneTools` semantic top-N (budget 24) plus `searchTools`/`invokeTool` recovery: UPSTREAMS verdict **NATIVE** for Anthropic tool search | FACT: `docs/UPSTREAMS.md` row "Anthropic Tool Search", `lib/ai/chat-mode.ts:183` |
| Generative UI | A2UI / AG-UI / assistant-ui = **PATTERN**: one renderer registry, not a new protocol; two registries exist today (`components/chat/tool-result-registry.tsx`, `features/chat-v2/components/typed-tool-cards.tsx`) | FACT: `docs/UPSTREAMS.md` lines 30, 87, 96. Owned by the W6 card session |
| Memory stacks | mem0 = PATTERN (reconcile at the existing commit gateway); Letta V1 server = DEAD; Graphiti = PATTERN; Open WebUI = REJECT (duplicate) | FACT: `docs/UPSTREAMS.md` lines 38, 217, 134, 83 |
| Resumable stream | `resumable-stream` + Redis = REJECT, keep the Postgres tail | FACT: `docs/UPSTREAMS.md` line 74 |

Dropped from consideration: Open WebUI, LibreChat as a platform swap, a Letta server, a third card protocol. All have
standing verdicts above. LibreChat has no UPSTREAMS row (the grep `librechat` came back empty), but swapping the
platform is the same question Open WebUI already answers: REJECT, duplicate of a working app.

## 2. Today's Nick, measured

Window: 2026-10-25 13:38Z to 2026-11-01 13:38Z, environment `production`.

Langfuse was read via `GET /api/public/v2/observations` with `fields` groups `core,basic,usage,model`, under
`railway run -s statenour-web`. The keys were never printed. Scripts are in the session scratchpad. Neon reads were
SELECT-only on project spring-art-47050555, counts only, no message text.

**Positive control.** Langfuse holds 124 `nick-chat:ai.streamText` roots; Neon holds 123 assistant rows in the same
window. A 1-row gap is consistent with a retry, so the reader reaches real traffic. The fallback query also found the
2026-11-01 fallback the sibling session reported at 12:57Z, so it matches a known record.

### 2.1 Volume and model

| Measure | Value | Label |
|---|---|---|
| Chat turns (user rows / assistant rows) | 123 / 123; by day 2, 6, 10, 34, 22, 37, 7, 5 (10-25 to 11-01, ET) | FACT, Neon |
| Model per step | minimax-m3 344 of 359 steps; glm-5.3-flash 9; gemma4:31b 6 | FACT, Langfuse doStream |
| Model steps per turn | 1 step: 35 turns · 2: 20 · 3: 29 · 4: 22 · 5: 5 · 6: 14 | FACT |
| Input tokens per step | p50 15,442 · p90 59,932 (not cached) | FACT |
| Cached share of prompt tokens | 48.6% of all prompt tokens across 359 steps | FACT. The 10-26 research set ~50% as the line under which a provider with a documented cache becomes worth a look (CLAIM) |
| Output tokens per step | p50 845; 0 steps with zero output | FACT. A zero-output count is not an empty-reply count; see 2.3 |
| Langfuse ERROR level on chat spans | 0 of 359 steps; 0 of 570 tool spans | FACT, but **UNMEASURED as health**: a tool that returns `ok:false` is not marked ERROR, so a zero here says nothing about tool failures |

### 2.2 Time per turn

| Phase | p50 | p90 | Label |
|---|---|---|---|
| Whole `streamText` span | 53.1 s | 133 s | FACT |
| Model phase (span start to last step end) | 33.6 s | 88.5 s | FACT |
| Tail after the last model step | 15.9 s | 43 s | FACT; 48 of 124 turns above 20 s |
| One model step | 10.5 s | 32.9 s | FACT |
| Chain-of-verification inside a chat trace | 9.9 s | 30.8 s | FACT; it ran in 91 of 124 turns |

One traced turn (2026-11-01 13:07Z, 3 model steps, 4 tools) shows the shape. The three model steps took
9.8 + 5.4 + 6.7 s, and the text was done at about 22 s. Chain-of-verification then ran 4 checks on glm-5.3-flash
(about 4 s each, in parallel) and one minimax-m3 pass of 41 s that wrote 5,087 output tokens. The span closed at
70.5 s. FACT, that one trace.

Every chat trace also carries side calls (FACT; counts are calls in chat traces / median latency):
- intent-router: 120 calls, 1.75 s, before the stream.
- conversation-memory: 119 calls, 17.4 s, in parallel with the stream.
- After the reply: ai-chat-classify 149 calls at 10.7 s, judge-eval 120 at 9.6 s, pipeline-controller 68 at 11.7 s,
  ai-memory 68 at 11.6 s.

All of it shares Ollama Pro's concurrent slots. The 3-slot figure is a CLAIM from the 10-26 report.

### 2.3 Empty and fallback replies

| Measure | Value | Label |
|---|---|---|
| Replies that are a fallback apology | 7 of 123 (5.7%): 10-26: 2, 10-28: 2, 10-29: 1, 10-30: 1, 11-01: 1 | FACT, Neon (`content LIKE` the three strings in `lib/ai/chat/empty-response-fallback.ts:47-52`) |
| Blank stored replies | 0 of 123 | FACT |
| Root cause | A step cut off by the output cap before any text goes to `salvageLengthCutoff`. Its `generateText` retry re-validates history, a Prisma `Date` in a tool result (searchMemories `updatedAt`) is not JSON, `AI_InvalidPromptError` is thrown, and the fallback is persisted | CLAIM: the sibling session "bdnick chat: empty reply after tools", staged on `claude/chat-empty-reply-665d29` (`lib/services/chat/salvage-event-text.ts`). Not re-diagnosed here, per the brief |

### 2.4 Tools and cards

| Measure | Value | Label |
|---|---|---|
| Turns that called a tool | 94 of 124; tool calls per tool-using turn p50 5, max 21 | FACT |
| Top tools (of 570 calls) | invokeTool 164 · searchTools 99 · queryNickstire 46 · searchReflections 46 · searchMemories 39 · createTask 29 · completeCommitment 14 · getTasks 14 · dailyPulse 13 · getCommitments 12 | FACT |
| Calls that only find or route to another tool | 263 of 570 (46%) | FACT |
| Stored reply part types, last 7 days | `text` 123; `tool-*`, `dynamic-tool`, `data-*` and `reasoning` 0 | FACT, Neon `jsonb_array_elements(parts)` |
| Why | `buildMessageParts` pushes `{type:"text"}` and optional `{type:"reasoning"}` only; its three callers (`persist-assistant-message.ts:430`, `deferred-background-work.ts:674`, `post-persist-verification.ts:294`) pass no tool parts | FACT, code read |
| Known since | Noted as a follow-up on 2026-10-29 ("stored assistant parts carry no tool parts (tool cards vanish on reload)"), never done | FACT, memory `bdnick-chat-audit-2026-10-29` |

### 2.5 Background brains

These all feed what Nick knows. The probe below reads every surface on the shared Langfuse project, so its
352-error total includes nickstire lanes such as igAutopost; the surfaces listed are statenour's.

| Surface | Errors, 7 days | Label |
|---|---|---|
| session-distiller | 80 error spans; 74 are 37 aborted calls (each failed call logs 2 spans) | FACT, `scripts/probe-langfuse-errors.mjs` (complete error read) |
| memory-consolidation | 59 spans; 58 are 29 aborted calls | FACT |
| thinking-engine | 33 spans; 28 are 14 aborted calls | FACT |
| conversation-memory | 24 spans, all 12 aborted calls | FACT |

**STRONG INFERENCE:** most are timeouts on minimax-m3 (186 of the 352 errors) and glm-5.3-flash (143). The sleep-time
work that Letta's design depends on already exists here, but much of it does not finish.

## 3. The best, by mechanism

All pages were read 2026-11-01.

| Product | Mechanism | What it avoids | Label, source |
|---|---|---|---|
| AI SDK v6 persistence | Save the whole `UIMessage[]` (all parts, tool parts included) from `toUIMessageStream({ originalMessages, onEnd })`. On load, run `validateUIMessages({ tools, dataSchemas })` before `convertToModelMessages`, and fall back to a clean history on `TypeValidationError`. Assistant ids come from the server (`generateMessageId`) | Cards and tool states lost on reload; a bad stored part crashing the next turn | FACT (doc read): https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence |
| Anthropic tool search | Tools marked `defer_loading: true` stay out of the prompt; a search expands only the matches into full definitions in context | About 77K to 8.7K upfront tokens (85% less); MCP tool accuracy 49% to 74% (Opus 4) and 79.5% to 88.1% (Opus 4.5) | CLAIM (vendor numbers): https://www.anthropic.com/engineering/advanced-tool-use |
| Anthropic tool-use examples | `input_examples` on a tool definition show the format, nesting and optional-field habits that a schema cannot | Wrong arguments on complex tools: 72% to 90% in their internal test | CLAIM, same page |
| Anthropic programmatic tool calling | The model writes code that calls tools in a sandbox; only the final output returns to context | 43,588 to 27,297 tokens on research tasks (37% less); 200 KB raw down to 1 KB | CLAIM, same page |
| Claude memory | Per-project memory held as ONE summary the user can view and edit; incognito chats neither read nor write it | Hidden memory drift; a work topic bleeding into another | FACT (page read): https://claude.com/blog/memory (2025-09-11, Pro/Max 2025-10-23) |
| ChatGPT memory | Two layers. Saved memories are explicit and stay until deleted; chat-history reference is fluid and the model picks what to keep. Managed in Settings > Personalization; temporary chats skip both | Remembering everything with equal weight; no way to see what is kept | CLAIM via search summary of help.openai.com/en/articles/8590148 (the page returned 403 to WebFetch) |
| ChatGPT Pulse | Overnight research from chat history, saved memory and optional calendar/Gmail produces a short stack of morning cards; thumbs up/down and "what to research daily" steer the next day | A blank chat box every morning; a feed that never ends | CLAIM: press coverage, 2025-09 (openai.com returned 403) |
| Letta sleep-time | Two agents: the primary talks and reads memory; a sleep-time agent edits the primary's memory blocks while idle and turns raw context into learned context | Memory edits slowing the live turn; memory that gets messier over time | FACT (page read): https://www.letta.com/blog/sleep-time-compute (no numbers on the page) |
| Mastra observational memory | Background agents compress older messages into observations once a token threshold is met; only unobserved messages stay in the thread | History that grows the prompt every turn | CLAIM via search of mastra.ai/docs/memory/observational-memory |
| Gemini Deep Research | Builds a multi-step plan that the user edits or approves before it runs; then iterative browsing, and a report with source links | A long run aimed at the wrong question | FACT (page read): https://blog.google/products/gemini/google-gemini-deep-research/ (2024-12-11) |
| Pi (Inflection) | Remembers a plan the user mentioned and asks later how it went; asks follow-ups instead of lecturing | Cold, transactional replies | CLAIM: design write-ups only (medium.com, ustwo.com); no technical source found |
| assistant-ui | One render component per tool name, with states `running`, `complete`, `incomplete` (error) and `requires_action` (approval) | One generic blob for every tool | CLAIM via search of assistant-ui.com/docs/copilots/make-assistant-tool-ui. Already PATTERN here (W6) |
| Vercel ai-chatbot | Next.js + AI SDK + Neon template with an artifacts side panel | Reference layout only | FACT (README read): https://github.com/vercel/ai-chatbot. The README does not document its persistence |

Empty searches, with tool and query:
- WebFetch `help.openai.com/en/articles/8590148-memory-faq`: 403.
- WebFetch `openai.com/index/introducing-chatgpt-pulse/`: 403.
- WebFetch `openai.com/index/memory-and-new-controls-for-chatgpt/`: 403.
- WebFetch `assistant-ui.com/docs/guides/ToolUI`: 404.
- WebSearch "Inflection Pi chatbot emotional intelligence design warmth how it responds mechanism": no technical source.
- Perplexity, LibreChat, Open WebUI and mem0 were not re-read; their verdicts stand in UPSTREAMS. Perplexity's
  cite-what-you-used mechanism is already in Nick as the Context & Evidence panel (3436).

## 4. Top 10 upgrades, ranked by value to Nour

Value means his time back and his trust: he sees what Nick did, a reply is never an apology, and shop money questions
get a fast, right answer. Size is build days for one lane.

| # | Upgrade | Tag | Mechanism, source | Reuses here | Size | Risk | Kill criterion (check date) | Lane |
|---|---|---|---|---|---|---|---|---|
| 1 | **Save the whole reply** so tool cards, approvals and evidence survive reload | reliable · beautiful | AI SDK whole-`UIMessage` persistence + `validateUIMessages` on load (3, row 1) | `buildMessageParts`, its 3 callers, both card registries (W6) | 1.5 d | Row size: tool outputs can be large. Cap stored tool output; validate on load | By 2026-11-15, at least 90% of tool-using turns reload with at least 1 tool part, and no load errors in error_logs. Else revert to text-only | statenour |
| 2 | **Empty-reply fix** (not this lane) | reliable | JSON-safe tool results before the salvage retry | sibling's staged diff | owned | n/a | Fallback replies fall from 7 per 123 to 0 or 1 per 100 turns by 2026-11-15 | statenour (sibling) |
| 3 | **Reply finishes when its text does**; verification posts after as a badge, and blocks only when the reply claims an action | reliable · smarter | Stream first is shipped; finish the move with post-reply passes via `after()` (10-26 lever 5, CLAIM) | `chain-of-verification.ts`, `action-claim-detector.ts`, verify-tail binding (3355) | 2 d | A wrong claim seen before its badge. Mitigated: action claims still block | Tail p90 under 10 s (today 43 s) by 2026-11-15, with the verifier's catch count not lower than the 7 days before | statenour |
| 4 | **Cut tool-lookup detours**: always load the tools `invokeTool` reaches most, add `input_examples` to the most-missed ones | smarter · reliable | Anthropic deferred loading + tool-use examples (3, rows 2-3) | `pruneTools` budget 24, `tool_selection_turns` telemetry, `searchTools`/`invokeTool` | 1.5 d | A bigger always-on set costs prompt tokens. Measure the cached share before and after | Detour share under 20% (today 46%) and steps per turn p50 down by at least 1, by 2026-11-15 | statenour |
| 5 | **Background brains finish**: per-surface timeouts and a retry window, sized to measured latency | reliable · smarter | Letta sleep-time design is incumbent; it only needs to finish (2.5) | session-distiller, memory-consolidation, thinking-engine | 1 d | More slot use at night; run them off-peak | Aborted calls on the top 4 surfaces under 10 a week (today 37, 29, 14, 12) by 2026-11-15 | statenour |
| 6 | **Cache-stable prompt order**: tools sorted, then static system, core memory, append-only history, per-turn block last; no ids or times in the prefix | smarter (speed) | 10-26 report lever 3 (CLAIM); Ollama caches implicitly | `finalize-system-prompt.ts`, `build-model-messages.ts` | 1.5 d | Small reorder bugs change answers. Pin with prompt snapshot tests | Cached share above 70% (today 48.6%) and step p50 under 8 s (today 10.5 s) by 2026-11-22 | statenour |
| 7 | **See what Nick remembers**: an inline "Saved to memory: X · Undo" line on any turn that writes memory, plus one editable memory summary | smarter · beautiful | Claude memory summary; ChatGPT saved vs history layers (3) | `pinMemory`, BrainMemory, the brain inspector (3436) | 2 d | Notice fatigue. Show only explicit saves, not every extraction | Nour uses Undo or edit at least once in 14 days, or the notice is cut, by 2026-11-29 | statenour |
| 8 | **Card feedback steers tomorrow**: a thumbs control on Home/Pulse cards, with the next morning's pick weighted by it | smarter · beautiful | ChatGPT Pulse feedback loop (3) | Home + Pulse (live 10-31), dailyPulse, W6 card registry | 2 d | Too few taps to learn from. Default to today's order | At least 10 taps in 14 days; else drop the control, by 2026-11-29 | statenour |
| 9 | **Follow up on open loops**: when Nour says he will do something on a date, Nick asks about it after that date, once | smarter (warmth) | Pi design (CLAIM) | commitments, people tracker, `dailyPulse` greeting | 1.5 d | Nagging. One ask, then drop | At least 1 in 3 follow-ups answered in 14 days, by 2026-12-01 | statenour |
| 10 | **Plan first for big asks**: a request that needs 4 or more tools gets a 3-line plan he can edit or approve before the run | beautiful · smarter | Gemini Deep Research plan step (3) | the W6 intent surface, the command registry | 2 d | An extra tap on easy asks. Gate it on predicted steps | Plan shown on at most 15% of turns, and he edits or approves at least half, by 2026-12-01 | statenour + W6 |

Considered, not ranked:
- **Programmatic tool calling.** Needs a code sandbox and a model that writes reliable code. Reopen if detours stay
  above 30% after upgrade 4.
- **Observational-memory compression.** History is not the measured cost: tool results inside one turn are (input p90
  60k). Reopen if per-turn history tokens are measured above 20k.
- **A provider with a documented cache.** Nour's spend decision. Reopen if upgrade 6 leaves the cached share under 50%.

## 5. Top 3 lane briefs (ready to dispatch)

### B1 · Save the whole reply, so cards survive reload (upgrade 1)

- **Lane:** statenour · **model:** opus/high · **size:** 1.5 d.
- **Goal:** a reloaded conversation shows the same tool cards, approval states and evidence it showed live.
- **Measured gap:** 0 of 123 stored replies carry a tool part; 94 of 124 turns used tools.
- **Files:**
  - `lib/services/chat/message-parts.ts`: accept the step's tool parts and data parts.
  - The 3 callers: `persist-assistant-message.ts:430`, `deferred-background-work.ts:674`,
    `post-persist-verification.ts:294`.
  - The `parts` reader in `features/chat-v2` hydration.
  - Coordinate with the W6 card registry session: it owns rendering. This brief only stores and loads.
- **Design:**
  1. Store AI SDK v6 `tool-<name>` and `dynamic-tool` parts with `state`, `input` and `output`.
  2. Cap any `output` over 8 KB to a summary plus `truncated: true`. The card needs the shape, not the raw rows.
  3. On load, run `validateUIMessages` with the registered tools. On `TypeValidationError`, drop the bad part, never
     the message.
  4. Make a stored tool result JSON-safe (Dates to ISO strings). This is the same defect the empty-reply sibling found.
- **Acceptance:**
  1. A red-first test: persist a turn with 2 tool calls, reload, get the 2 parts back with their states.
  2. A test that an oversize output is capped.
  3. A test that a corrupt stored part loads as text only.
  4. 7 days after deploy, a Neon count shows at least 90% of tool-using turns have at least 1 tool part.
  5. Real-iPhone check: open an old chat and see its cards.
- **Kill:** row p90 above 200 KB, or any load error in error_logs, then revert.

### B2 · The reply finishes when its text does (upgrade 3)

- **Lane:** statenour · **model:** opus/high · **size:** 2 d.
- **Goal:** the Stop button and "Checking the reply…" end when the text ends. Verification lands later as a badge on
  the reply.
- **Measured gap:** tail after the last token p50 15.9 s, p90 43 s; 48 of 124 turns over 20 s; one trace's verifier
  wrote 5,087 tokens in 41 s.
- **Files:**
  - `lib/ai/chat/chain-of-verification.ts` and its caller `lib/services/chat/persist-assistant-turn.ts:392`.
  - `lib/services/chat/post-persist-verification.ts`, which is fabrication-defense layer L2
    (`apps/statenour/AGENTS.md` section 4). Its banner path must still patch the stored row and reach the open
    chat.
  - `lib/ai/chat/action-claim-detector.ts`: keeps the block when a reply claims an action ("I've added", "sent").
  - The client badge strip from 3355.
- **Design:**
  1. Persist and close the stream at text end.
  2. Run CoV in `after()`. Write the outcome to the stored row and push it to the badge when the client is still open.
  3. Keep today's blocking path only when the reply claims an action, and cap the CoV output tokens there.
- **Acceptance:**
  1. A red-first test that a reply with no action claim settles before CoV resolves.
  2. A test that an action claim still waits.
  3. Phase timers in the PR body: tail p50/p90 before and after, from the Langfuse script in section 2.
  4. The verifier's 7-day catch count is reported before and after.
- **Kill:** the catch rate drops, or a wrong action claim reaches Nour unbadged, then revert to blocking.

### B3 · Cut tool-lookup detours (upgrade 4)

- **Lane:** statenour · **model:** opus/high · **size:** 1.5 d.
- **Goal:** Nick calls the tool it needs in the first step.
- **Measured gap:** 263 of 570 tool calls (46%) are `searchTools` or `invokeTool`; each detour costs a model step
  (p50 10.5 s, about 15k input tokens).
- **Files:**
  - `lib/ai/chat-mode.ts` (`pruneTools`, `TOOL_BUDGET`), `app/api/ai/chat/prepare-tools.ts`.
  - The `searchTools` / `invokeTool` definitions; `tool_selection_turns` telemetry.
- **Design:**
  1. Read the last 14 days of `invokeTool` targets and `tool_selection_turns` (offered vs budgeted out).
  2. Pin the top targets into the always-on set.
  3. Add 1-2 `input_examples`-style examples to the descriptions of the tools the model most often calls wrong.
  4. Keep the full list stable in order, for the cache (upgrade 6).
- **Acceptance:**
  1. The 14-day target table goes in the PR body, counts only.
  2. A census test: the top 30 shop and task phrasings reach their tool without a detour.
  3. Langfuse after 7 days: detour share and steps per turn p50, before and after.
- **Kill:** cached share or answer quality drops (judge-eval mean), or the detour share stays above 30%, then revert
  the pins.

## 6. Cross-lane needs

1. **W6 card session:** B1 stores tool parts that W6's registry must render from stored state. Agree the stored part
   shape before either PR merges.
2. **Empty-reply sibling:** its JSON-safe tool result fix should be the one helper B1 reuses. Do not write two.
3. **Manager:** Langfuse's legacy routes stop on 2026-11-16, and the scripts used here are on v2 already. Copy
   `lf-chat7d*.mjs` from this session's scratchpad into `apps/statenour/scripts/` as a real probe if the kill reads
   should be repeatable.
4. **Nour (spend decision, not now):** a provider with a documented cache, only if B3 plus upgrade 6 leave the cached
   share under 50%.
5. **Perplexity re-run when Chrome works:** "ChatGPT Pulse and Claude memory mechanisms 2026, primary sources". The
   OpenAI pages were 403 to direct fetch, so those rows stay CLAIM.
