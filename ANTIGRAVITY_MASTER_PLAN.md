# ANTIGRAVITY MASTER PLAN — Persona & Services Upgrade Wave

> **Generated:** 2026-07-09 · by Claude (Fable 5) from an 11-agent audit of the live codebase (1.96M tokens of probing, 675 tool calls).
> **Executor:** Antigravity IDE on Gemini 2.5 Flash. One packet per turn. This document is your single source of truth — but **re-verify every `file:line` anchor with a grep before editing**; the repo moves daily.
> **Epistemic key:** `[VERIFIED]` = confirmed by reading code + call-site tracing on 2026-07-09. `[SNAPSHOT]` = based on the committed `apps/statenour/vars.json` env dump — strong evidence, NOT runtime proof; verify on Railway before depending on it. `[ASSUMPTION]` = marked inline.

---

## 0 · EXECUTION PROTOCOL (read before every packet)

1. **NEVER push `main`.** Branch per wave: `git checkout -b feat/ag-wave<N>-<slug>`. PRs to main; the operator merges.
2. **One packet per turn.** Complete it fully: edit → verify gate → commit. Do not start a second packet in the same turn.
3. **Re-anchor first.** Every packet lists file:line references. Grep for the symbol before editing — if the line moved, adapt; if the symbol is gone, STOP and report instead of guessing.
4. **Verify gates are mandatory.** A packet is not done until its `VERIFY` block passes. No "should work". Run the command, read the output.
5. **Before commit:** `pnpm --filter statenour typecheck && pnpm --filter statenour vitest run <touched test files>` (statenour) or the nickstire equivalents. The repo skills `statenour-verify` / `nickstire-verify` define the full gates.
6. **NEVER touch `apps/statenour/prisma/migrations/`** — migrations are hand-applied by the operator (one wrong flag silently drops pgvector). New nickstire tables use the hand-applied railway-run DDL pattern: write the SQL file, do NOT auto-apply.
7. **Cron edits are three-part:** `lib/inngest/jobs.ts` + `config/crons.ts` + `pnpm check:crons` — all in the same change. `config/crons.ts` is a manifest, NOT ground truth (self-documented at its top).
8. **NEVER hand-edit** `apps/statenour/lib/ai/agents/marketing/registry.ts` (326KB generated file). Edit the sibling `marketing-*.md` files and run `scripts/compile-marketing-agents.ts`.
9. **Two unrelated "skills" systems exist.** `lib/skills/` = 1,424-entry registry recall. `lib/brain/skill-extractor.ts` = learned behavioral patterns (`buildSkillsContextBlock`, live in brain-context). Never confuse them.
10. **Preserve chat-route gate ordering.** `app/api/ai/chat/route.ts:940-1130` runs mutually-exclusive pre-stream paths (multiAgent > deep > regen > selfConsistency) with `__actionIntent` suppression at ~:1002. Breaking that ordering caused a live regression on 2026-07-06 (action turns narrated instead of executed). Any edit there keeps the priority chain and the suppression intact.
11. **Telegram webhook edits** must preserve the owner-ID gate (`route.ts:128,146`) and constant-time secret compare (`:50-59`).
12. **Prompt budget:** Venice cap is 65K chars and the base prompt already runs ~57-65K. Any new always-on directive stays under ~1K chars or is intent-gated.
13. **Do NOT invent a fifth persona system.** Four exist (see §2). Every persona change plugs into one of them.
14. **`scripts/embed-skills.ts` writes to the PROD `vector_embeddings` table.** Idempotent — run once per new entry, never in a loop.
15. **Keep green:** `tests/ai/chat/build-model-messages.test.ts` (PR #551 hollow-scrub fix) on any compression-path change.

---

## 1 · WHAT THE AUDIT FOUND (the one-paragraph thesis)

statenour is not missing capabilities — it is full of **finished machinery that was never plugged in**. A complete Sparring-Partner mode ships in every deploy and is never injected; `/strict` and `/chill` confirm "mode ON" and change nothing. The deep-research pipeline is live-wired but throws on a missing API key. The daily executive brief **mandates fabricated sections** (competitor prices, biomarkers) its data never contains, and four intelligence connectors feed hardcoded fiction into it. The richest ghostwriting assets (corpus-derived voice anchor, content-feedback recall) are write-only. Skill auto-injection died silently in the 2026-06-29 Prompt-V2 cutover. The advisory board — exactly the "team of advisors" pattern the operator wants — is trapped behind one UI tab. The tire shop's clock-out **destroys hours-worked data used for payroll, every day**. The plan below is therefore ~70% *wiring and truth-fixing* and ~30% net-new build.

## 2 · THE PERSONA MAP (answer to "where is the thought partner?")

Four persona systems exist `[VERIFIED]`:

| # | System | Location | Live? | What it is |
|---|--------|----------|-------|------------|
| 1 | **Typed persona library** | `apps/statenour/lib/ai/personas/index.ts` | live (sub-agents only) | 10 CrewAI-style personas + 27 marketing personas (37 total). Consumed by `runMultiAgent`, pretask-fanout, deep-research, reasoning engine. |
| 2 | **Specialist router** | `lib/ai/agents/` → chat route :110-159 | **dead in prod** (`ENABLE_SPECIALIST_ROUTING` unset `[SNAPSHOT]`) | 2-pass classifier → only `marketing-director` implemented; financial-analyst / decision-coach / schedule-keeper are vapor routes. |
| 3 | **Chat personality modes** | `app/api/ai/chat/finalize-system-prompt.ts:114-140` | **live every turn** | `master/builder/friend` blocks; picker in `components/chat/nick-header-v2.tsx`. THE live conversational-stance axis. |
| 4 | **Advisory board** | `lib/ai/board/` (5 boards × 52 lenses) | live, UI-only | Parallel advisor fan-out + divergence-preserving synthesis. Reachable ONLY via `/brain` → Board tab. |

**Thought partner: does not exist** (zero repo hits). Closest assets: dead `behavior-directive.ts` Sparring Mode, live `adversarial-critic.ts` (objections buried in a long-press modal), live contradiction-injector, `CONTRARIAN_CRITIC` persona.
**Tactician: does not exist** (zero hits). Substrate ready: ~164-entry Greene corpus in BrainMemory **with machine-usable `actions[]`** that the current renderer drops.
**Researcher: exists, prod-zombie** — `runDeepResearch` hardcodes Perplexity (`deep-research.ts:176-190`); no `PERPLEXITY_API_KEY` in prod `[SNAPSHOT]` → every sub-query throws, synthesis comes back empty.
**Business consultant: five disconnected subsystems** — board (UI-trapped, context-blind), pricing-advisor (complete, tested, **zero callers**), goal/project coaching (live), 1,632-line business knowledge pack (**orphaned from the prompt since the 2026-06-29 V2 cutover**), moneyprinter (misnamed vendored video-gen repo, not consulting).
**Ghostwriter:** voice profile live on chat; but the actual ghostwriting endpoint `operator.generateMarketingContent` applies **no voice, no critic, no revision loop**; corpus voice anchor + feedback recall have zero call-sites.
**Summarizer:** ~10 surfaces, zero shared infra; 3 fully-built brief routes have no callers; weekly email fetches a nonexistent route.
**HR admin: skeleton** — real `technicians` table + clock in/out, but clock-out NULLs the timestamp (hours destroyed), performance metrics computed then discarded, hiring applicants dumped into the sales-lead funnel.
**Personal assistant: strongest area** — 20+ Telegram commands, proactive push stack, Gmail/Calendar ingest. Gaps: plain (non-command) Telegram text silently dropped, `/ask` is tool-less, no reminder engine, a mock that **fabricates "SMS Dispatched" confirmations**.
**Skills recall:** tool-mediated recall live; **auto-injection dead since PR #432**; registry 2 months stale; recall loads all 1,424 embedding rows from Postgres per call.
**Orchestration:** chat auto-decompose LIVE (`NICK_MULTI_AGENT_AUTO=true` `[SNAPSHOT]`); sub-agents are tool-less 200-word one-shots; `scorePersonas()` has zero callers (learning loop dead-ended); guardian approval EXECUTE path fixed 2026-07-07 but its test suite is reported red.

---

## 3 · OPERATOR-ONLY ACTIONS (Antigravity: do NOT attempt these)

- **OP-1 · SECURITY:** `apps/statenour/vars.json` is a **committed UTF-16 dump of live prod env vars including secrets** (ADMIN_API_KEY, APOLLO_API_KEY, …). Rotate the exposed keys, remove the file from git, add to `.gitignore`. Until then, treat every key in it as burned.
- **OP-2:** Set `PERPLEXITY_API_KEY` (unblocks deep research at full quality) and `PERPLEXICA_API_URL` (or accept AG-16's code alias) on Railway statenour-web/worker.
- **OP-3:** Decide `ENABLE_SPECIALIST_ROUTING` — recommendation: ship AG-42's shadow mode first, flip later.
- **OP-4:** Decide relationship-digest cron: wire into WEEKLY_JOBS or delete (AG-05 lists it; it's an operator taste call).
- **OP-5:** After AG-10/AG-30 land, optionally set `NICK_CHAT_INTENSITY=HIGH` and later `NICK_DEEP_REASONING=true`, watching cost via `/system/agent-traces`.

---

## 4 · WAVE 0 — TRUTH & SAFETY (do these first; small diffs, immediate honesty)

### AG-01 · Fix the Telegram fake-SMS mock ⚠️ trust-critical
**Files:** `apps/statenour/app/api/telegram/webhook/route.ts` (~:274-293)
**Context `[VERIFIED]`:** The `intell_recall` approve branch console.logs `[Capevace Gateway Mock]`, then tells the operator "SMS Dispatched to {customer}" and marks the ActionReceipt SUCCESS. **No SMS is ever sent.**
**Do:** Replace the mock with the same `callNickstire('smsBot.send', {phone, message})` call the adjacent approve/deny path uses (~:350-371), including its FAILED-receipt error handling. If recall SMS is intentionally not live, instead change the message to `⚠️ MOCK — no SMS sent` and mark the receipt context. Never leave "SMS Dispatched" on a no-op.
**Verify:** Approve a recall alert in Telegram → either a real bridge call fires (ActionReceipt SUCCESS with executedAt) or the reply explicitly says MOCK. `grep "Capevace Gateway Mock"` returns nothing on the success path.

### AG-02 · Stop fabricated data entering the daily intelligence brief
**Files:** `apps/statenour/lib/intelligence/connectors/{sec,dealscouting,supplychain,performance}.ts`, `lib/intelligence/ingest.ts`, `lib/inngest/functions/intelligence-brief.ts` (~:107-127)
**Context `[VERIFIED]`:** `sec.ts` hardcodes competitor tire prices + fake revenue; three other connectors return invented listings/commodity prices/biometrics when unkeyed (they always are `[SNAPSHOT]`); `ingest.ts getMockContentForDomain` injects fake ai/seo reports. All flow → claims → OpportunityLog → the pushed Daily Executive Brief. Separately, the brief's system prompt **mandates** sections (competitor pricing, GSC gaps, biomarkers) its data never contains — forcing invention.
**Do:** (1) Mirror the fixed `gsc.ts` pattern: unkeyed → return empty arrays; drop hardcoded price/financial literals from sec.ts (keep the real filings list). (2) In ingest.ts, skip document+claim creation when content would come from `getMockContentForDomain` (log + `success:false 'source unconfigured'`). (3) In the brief prompt, delete the fabricated-section mandates and add: *"if no signal exists for a section, write exactly: no signal today — never invent data"* (journal-brief already uses this rule).
**Verify:** `pnpm --filter statenour vitest run tests/intelligence` (update fixtures); POST `/api/intelligence/briefs/generate` → brief no longer cites Discount Tire promos or listings that don't exist; grep confirms no `245.0`/hardcoded price literals remain in connectors.

### AG-03 · Fix the Sunday email's dead weekly-review fetch
**Files:** `apps/statenour/app/api/cron/weekly-digest/route.ts` (:115)
**Context `[VERIFIED 2026-07-09 by direct grep]`:** Line 115 fetches `/api/ai/weekly-review` — that route does not exist (real: `/api/cron/weekly-review`), so every Sunday email says "Weekly review unavailable." The data already sits in `BrainMemory(category='weekly_review', key='weekly:<monday>')`.
**Do:** Replace the fetch with a direct `prisma.brainMemory.findFirst` on that category/key; fall back to the previous week's row (weekly-digest runs before weekly-review in WEEKLY_JOBS order).
**Verify:** `curl` the route with `Authorization: Bearer $CRON_SECRET` → body no longer contains "Weekly review unavailable." when a weekly_review row exists.

### AG-04 · Fix docs that will mislead you (self-defense packet)
**Files:** `apps/statenour/docs/agents/specialists.md`, `lib/ai/style-adapter.ts` (header), `docs/adr/0007-skill-semantic-recall.md`, `lib/ai/tools/business.ts` (:539)
**Context `[VERIFIED]`:** specialists.md claims the layer is "not wired into live chat" (it IS, flag-gated, route.ts:110-159) and that financial-analyst exists with tests (it doesn't). style-adapter header claims chat applies the 8-axis addendum (it doesn't). ADR-0007 claims live auto-injection (dead since PR #432) and 1536-dim (actual 1024). business.ts:539 claims a Sunday pricing cron exists (nothing calls it).
**Do:** Correct each doc/comment to match code reality. Add the missing "add a dispatch branch in route.ts" step to specialists.md's checklist.
**Verify:** Each corrected statement matches a grep (e.g. `ls lib/ai/agents/specialists/` shows one file).

### AG-05 · Dead-code sweep (verified zero-importer clusters)
**Files (delete):** `lib/intelligence/{sensors/index.ts, sensor-grid.yml, engine.ts, delivery/morning-brief.ts, delivery/interrupt.ts}`, `lib/ai/prompt/sections/` (whole dir), `lib/ai/knowledge-compiler.ts` (`getKnowledgeDigest` export; keep `refreshKnowledgeDigest` only if `scripts/refresh-digest.ts` stays), `lib/skills/skill-recall.ts` `recallSkillsByCategory`.
**Context `[VERIFIED]`:** All have zero importers (sensor cluster's fetches are commented out; prompt/sections dead since V2 cutover; knowledge-compiler orphaned). **Do NOT delete** `lib/ai/knowledge/behavior-directive.ts`, `lib/ai/response-contract.ts`, `lib/brain/blind-spot-pinner.ts`, `lib/ai/ambiguity-detector.ts`, `skill-context.ts`, `pricing-advisor.ts`, `persona-corpus-importer.ts`, `content-feedback.ts` recall half — those are dead-but-about-to-be-wired by Wave 1/2 packets.
**Do:** Re-verify zero importers per file (`grep -r "<symbol>" apps/statenour --include='*.ts' --include='*.tsx'`), then delete. For buffett/naval/munger personas in `personas/index.ts`: delete consts + PERSONAS entries + test assertions (advisor board uses `@statenour/lenses` for the same figures).
**Verify:** `pnpm --filter statenour typecheck` green; `pnpm --filter statenour vitest run tests/intelligence tests/ai/multi-agent-personas.test.ts` green; greps for deleted symbols return nothing.

---

## 5 · WAVE 1 — WIRE WHAT'S ALREADY BUILT (highest leverage per line)

### AG-10 · Activate Sparring Partner Mode (thought-partner v0) ★ flagship
**Files:** `app/api/ai/chat/finalize-system-prompt.ts`, `app/api/ai/chat/route.ts`, (read-only: `lib/ai/knowledge/behavior-directive.ts`)
**Context `[VERIFIED by grep 2026-07-09]`:** `getBehaviorDirective` (ANTICIPATE→ANSWER→ELEVATE + HIGH "Sparring Partner Mode": adversarial check, strategic tension, time-shift) is fully written and unit-tested with **zero live callers**. `/strict` and `/chill` interceptors set `globalIntensityOverride` that nothing reads — operator-visible lies. Flag `NICK_CHAT_INTENSITY` is documented in `feature-flags.ts:281` and controls nothing.
**Do:** Add `userContent: string` to `FinalizeSystemPromptInput` (route.ts has it in scope at the call site). In finalize-system-prompt.ts, after the personality block: `const directive = getBehaviorDirective(userContent, intensity); if (directive && turnSignal.intent !== 'casual') systemPrompt += "\n\n" + directive`. Do NOT modify behavior-directive.ts content.
**Guards:** module-level `globalIntensityOverride` resets per instance/restart on Railway — accept per-instance semantics for v0 (note it) or persist to UserPreference. Keep the directive under ~1K chars appended AFTER truncation (finalize truncates at :96 before appending — verify still true).
**Verify:** `pnpm --filter statenour vitest run tests/ai/behavior-directive.test.ts` green; add a test asserting finalize output contains 'ANTICIPATE' at STANDARD, 'Sparring Partner Mode' at HIGH, and neither after `/strict` userContent. Live: send `/strict` then a question — reply must carry zero trailing elevation.

### AG-11 · Wire the response contract (brainstorm answerMode goes live)
**Files:** `app/api/ai/chat/route.ts` (after classifyTurn ~:315), `app/api/ai/chat/finalize-system-prompt.ts`
**Context `[VERIFIED]`:** `lib/ai/response-contract.ts` derives per-turn contracts incl. `answerMode:'brainstorm'`, exact-count enforcement, no-clarifying-question rules — imported only by tests/evals. Its header claims it feeds the system prompt; false.
**Do:** `const contract = buildResponseContract(userContent, turnSignal, queryShape)` (pure, <1ms) after classifyTurn; pass into finalizeSystemPrompt; append `buildContractDirective(contract)` (returns `''` for plain turns — zero cost on casual chat).
**Verify:** `vitest run tests/ai/response-contract.test.ts`; live: "brainstorm 5 hooks for the tire post, don't ask questions" returns exactly 5 items, no clarifying question.

### AG-12 · Team personas + persona staffing on the multi-agent tool
**Files:** `lib/ai/personas/index.ts`, `lib/ai/tools/system.ts` (arsenalMultiAgent inputSchema :731-740), `tests/ai/multi-agent-personas.test.ts`
**Context `[VERIFIED]`:** `runMultiAgent` supports `SubAgentTask.persona` with safe unknown-key fallback, but the tool schema omits the field — the chat model can never staff sub-agents; 34 of 37 personas unreachable from tool calls.
**Do:** (1) Append typed personas: `THOUGHT_PARTNER` (dialectic developer of ideas — steal CONTRARIAN_CRITIC's edge but goal = "develop the idea WITH the operator: strongest version, strongest attack, named tension"), `STRATEGIST` (long-horizon positioning, Greene/lenses-aware), `TACTICIAN` (short-horizon: the next 48h move, concrete, verb-first), `BUSINESS_CONSULTANT` (unit economics, pricing power, cash discipline), `GHOSTWRITER` (backstory distilled from `lib/ai/nour-voice-profile.ts` rules: hit-words, bans, specificity). Register in PERSONAS. (2) Add `persona: z.string().optional()` to the arsenalMultiAgent subAgents schema, pass through in execute, name 3-5 canonical keys in the tool description.
**Verify:** `vitest run tests/ai/multi-agent-personas.test.ts` (extend: `getPersona('tactician')` non-null); dev chat decomposable question → `/system/agent-traces` shows persona-named sub-agent results; BrainMemory `persona_usage` rows carry real keys.

### AG-13 · Unlock the advisory board: chat tool + Telegram commands
**Files:** `lib/ai/tools/system.ts`, `lib/ai/tool-families.ts`, `lib/ai/tools/catalog.ts`, `app/api/telegram/webhook/route.ts`
**Context `[VERIFIED]`:** `consultBoardAndPersist` (board-consult-record.ts) is live but reachable ONLY from the /brain Board tab. The council pattern (parallel advisors, divergence preserved, synthesis) is exactly the operator's "team" shape, with 20+ tests.
**Do:** (1) Tool `arsenalBoardConsult`: input `{boardId: z.enum(['strategic','invest','product','operator','full']), question: z.string().min(8)}`, execute → dynamic-import `consultBoardAndPersist`, return synthesis + compact per-advisor takes. Catalog: cost high, sideEffecting false. (2) Telegram `/board <boardId> <question>` → same call, reply = synthesis + per-advisor one-liners; `/team <question>` → `runMultiAgent` staffed with AG-12's five personas. Wrap in the webhook's existing error envelope; read-only AI, no approval gate needed.
**Verify:** Chat: "convene the invest board on the second alignment machine" fires board-consult traces + appears in Board-tab recents. Telegram: `/board strategic should I raise tire prices 5%?` replies within ~30s with consensus/divergence; BOARD_CONSULT BrainMemory row persisted.

### AG-14 · Strategist wiring: Greene corpus reaches live chat, moves included
**Files:** `lib/services/chat/brain-context.ts`, `lib/ai/greene-message-matcher.ts`, `lib/ai/dark-psychology-matcher.ts`, `app/api/ai/chat/finalize-system-prompt.ts` (:102)
**Context `[VERIFIED]`:** The Greene + dark-psych matchers (deterministic, sub-ms, self-gating) fire ONLY inside the rarely-used reasoning engine — normal chat gets Greene via just 2 capped vector hits. `renderGreeneBlock` drops the corpus's `actions[]` (the concrete moves). The 189-law prompt library is gated `provider === 'anthropic'` while the live primary is ollama — silently off.
**Do:** (1) In brain-context.ts add two parallel `withTimeout(...,3000,'')` blocks (same pattern as strategicFrameworksMod at :242): dynamic-import both matchers, render, append non-critical (reranker can drop). (2) In both matchers: carry `actions[]` (top 2) through the match and render one `→ move:` line per pick. (3) Change the :102 gate to `provider === 'anthropic' || provider === 'ollama'` (or gate on remaining MAX_SYSTEM_CHARS headroom).
**Guards:** keep matchers' minScore self-gating; blocks stay non-critical (dropThreshold 0.12) so casual turns don't carry tactics.
**Verify:** `vitest run tests/ai/greene-message-matcher.test.ts` (extend for `→ move:` lines); dev chat "how do I handle the power dynamics and leverage with this vendor" → `greene_fire_rate` BrainMemory row increments; `__finalized.strategicLawCount` ~189 with ollama active.

### AG-15 · Ghostwriter activation: connect the three orphaned voice assets
**Files:** `app/api/ai/chat/finalize-system-prompt.ts`, `app/api/ai/chat/route.ts` (:759-767 contentMode block), `lib/trpc/routers/operator.ts` (generateMarketingContent :988-1005), `lib/inngest/functions/intelligence-brief.ts`, `lib/intelligence/content-alpha.ts`
**Context `[VERIFIED]`:** `getPersonaAnchorPrompt` (corpus-derived voice, 15-min self-cache, `''` when no snapshot — safe no-op) has zero call-sites. `recallRecentContentFeedback`/`buildFeedbackPromptBlock` — the read half of the feedback loop — zero call-sites (captures since Apr 28 never re-injected). `scanRecentReplies` (persona-drift producer) has no scheduler, so live drift views read an empty store. `generateMarketingContent` and content-alpha drafts are voice-blind.
**Do:** (1) In finalize's voiceGuardIntents block (:186-188) also await `getPersonaAnchorPrompt()` and append when non-empty. (2) In route.ts contentMode block, append `buildFeedbackPromptBlock(await recallRecentContentFeedback())` (try/catch → ''). (3) In generateMarketingContent: append `buildNourVoicePrompt()` to the persona prompt; post-generate run `critiqueContent`; if score <60 regenerate once; store score in draft sourceMetadata. (4) Add `scanRecentReplies({windowHours:24})` as a step in the daily intelligence-brief cron (step.run + try/catch). (5) content-alpha: wrap systemPrompt with `applyOperatorStyle` + `buildNourVoicePrompt`.
**Verify:** Prompt diagnostics show '## Operator identity anchor' on analytical turns; after a "too generic" reaction, next content prompt carries the NOUR-SAID-RECENTLY block; /content drafts carry criticScore metadata; `GET /api/system/persona-drift` returns items after the cron runs.

### AG-16 · Researcher resilience: un-zombie deep research
**Files:** `lib/ai/deep-research.ts` (:175-190), `lib/ai/multi-search.ts` (:380, :405), `tests/integrations/multi-search.test.ts`, `lib/integrations/perplexica.ts` (:42, :139-141)
**Context `[VERIFIED code / SNAPSHOT env]`:** runDeepResearch's search phase is hardcoded to Perplexity; prod has no PERPLEXITY_API_KEY → every sub-query throws → empty synthesis, from chat, reasoning engine, and nick-agent alike. Separately `multiSourceSearch` divides quorum by `requested.length` while unkeyed sources stay in the set → max confidence 0.50 with 2 keys, but the tool description promises ≥0.66 for 2-source agreement. Perplexica needs `PERPLEXICA_API_URL`; prod only has `PERPLEXICA_MCP_URL`.
**Do:** (1) In deep-research step 2: when no Perplexity key (or per-query failure), route each sub-query through `multiSourceSearch(q, {recency:'month'})` and map consensus/citations into the round shape; keep Perplexity preferred when keyed. (2) Fix the confidence denominator to `available.length` (extend the exact rationale already written for perplexica at :212-220); update test assertions in the same change. (3) In perplexica.ts, derive base URL from `PERPLEXICA_MCP_URL` (strip `/mcp|/sse` path) when `PERPLEXICA_API_URL` absent.
**Verify:** `vitest run tests/integrations/multi-search.test.ts` green with new assertions; scratch script with PERPLEXITY unset + TAVILY/GEMINI set → `runDeepResearch` returns non-empty rounds + synthesis; live chat "research recent tire pricing trends, cite sources" shows roundCount>0 with citations.

### AG-17 · Revive skill auto-injection (dead since PR #432)
**Files:** `lib/services/chat/brain-context.ts` (~:140-185), `lib/skills/skill-recall.ts`, `lib/ai/tools/brain.ts`
**Context `[VERIFIED]`:** `getRelevantSkillsBlock` (top-3 skills + `skill.recall.injected` telemetry) lost its only caller in the V2 cutover (commit 54635bcec). Also: recallSkills fetches ALL ~1,424 embedding rows from Postgres per call; a provider-failover dim mismatch silently zeroes recall.
**Do:** (1) Add `getRelevantSkillsBlock(userContent)` as one more parallel brain-context block (dynamic import + `.catch(()=>null)` + `withTimeout(3000,'')`). (2) Module-level parsed-vector cache with TTL (mirror REGISTRY_TTL_MS pattern at :70-93). (3) Dim-mismatch guard: if all rows skipped for length, `log.warn('skill_recall_dim_mismatch')`. Replace hardcoded '1,423' counts in tool descriptions with neutral phrasing.
**Guards:** ~450 tokens/turn budget (ADR-0007's math) — land the cache in the same change; keep the 3s timeout so a slow Neon trip can't block the stream.
**Verify:** `pnpm tsx scripts/smoke-skill-recall.ts` passes; live message "audit this page for mobile UX" → `SELECT * FROM system_metrics WHERE metric='skill.recall.injected' ORDER BY created_at DESC LIMIT 1` returns a fresh row; unit test asserts findMany called once across two recalls.

### AG-18 · Personal-assistant round-out (5 small Telegram/cron fixes)
**Files:** `app/api/telegram/webhook/route.ts`, `app/api/cron/task-resurface/route.ts`
**Context `[VERIFIED]`:** Plain non-command text is silently dropped (:514-516) while a tested pure intent router (`lib/ultron/omni-capture-router.ts`) sits unused. Voice notes bypass journal-ingest extraction. `/schedule` never reads Google Calendar. Morning brief has no Telegram fallback. Task resurface flips WAITING→READY silently.
**Do:** (1) Default case → `routeCapture(text)`: ask→cmdAsk, task→cmdTask, dump/park→cmdDump, search→cmdSearch, decide→cmdAsk with decide-framing; reply "→ routed as <intent>". (2) handleVoice fallback → same `ingestJournal` call cmdDump uses; report tasksCreated. (3) cmdSchedule: prepend `📅 Calendar` section from `listEvents({daysAhead:1})` with CalendarApiError graceful-skip. (4) New `/brief` command reading `BrainMemory(morning_brief, key=today-ET)`, composing fresh if absent; add to /help. (5) task-resurface: when due>0, one batched `sendTelegram` (from `lib/services/telegram` — the HTML sender, NOT telegram-ops) listing ≤10 titles.
**Verify:** Text "call Mike about the alignment" (no slash) → task created + receipt reply; voice note → Tasks: N reply; `/schedule` shows real events; `/brief` returns the brief; snoozed task + cron hit → Telegram "⏰ Back on deck" message. `vitest run tests/lib/omni-capture-router.test.ts` green.

### AG-19 · Business consultant: revive the pricing advisor + context-aware board
**Files:** `app/api/cron/pricing-advisory/route.ts` (new), `lib/inngest/jobs.ts` (:133 WEEKLY_JOBS), `lib/ai/tools/business.ts` (:539), `lib/ai/board/consult.ts`, `lib/services/board-consult-record.ts`, `tests/ai/board/consult.test.ts`
**Context `[VERIFIED]`:** `composeAdvisory()` (pricing-advisor.ts:523) — complete, tested pipeline (ALG win-rate outliers → competitor prices → 3 experiments each) — has zero callers; all its read surfaces permanently empty. `consultBoard` receives only question text — advisors answer pricing questions without the shop's actual numbers.
**Do:** (1) New cron route (pattern-copy `app/api/cron/weekly-digest/route.ts`: CRON_SECRET auth): call `composeAdvisory()`; **persist yourself** (composeAdvisory does NOT write the weekly row): `brainMemory.create({category:'pricing_advisory', key:'weekly_<YYYY-MM-DD>', content: headline, metadata:{snapshot}})`; write a coach event `recordCoachEvent(kind:'pricing-advisory')` (renderer already exists at coach-event-banner.tsx:247); append route to WEEKLY_JOBS with the file's required 1-line annotation. Fix the business.ts:539 lie. (2) Board context: add optional `contextBlock?: string` to consultBoard threaded like the existing stateBlock (:148-158, :292-298); build it in board-consult-record.ts (allowed to touch services): `buildMetaScoreboard()` + (on pricing/revenue keywords) latest pricing_advisory row + `getRevenueStats('month')`; cap ~1,500 chars, label "CURRENT BUSINESS STATE (live numbers · cite when relevant)"; try/catch → context-blind degrade. Keep consult.ts Prisma-free per its purity contract.
**Verify:** Cron route with secret → `GET /api/system/pricing-advisory` returns hasAdvisory:true; chat "what's the pricing advisory" returns outliers. Board test asserts contextBlock appears in advisor prompts when provided; live consult shows real scoreboard numbers in traces. `pnpm check:crons` green.

### AG-20 · HR floor (nickstire): stop the data loss, show the team
**Files:** `apps/nickstire/server/services/staffPerformance.ts`, `server/routes/nour-os-query.ts`, `client/src/pages/admin/money/DispatchSection.tsx`, `client/src/pages/admin/{LeadsSection.tsx, leads/KanbanBoard.tsx}`
**Context `[VERIFIED]`:** `technicians.qc_pass_rate/comeback_rate` are READ by recommendTech scoring but NEVER written — the daily staff-performance cron computes real numbers and discards them (cron/index.ts:502). `dispatch.teamPerformance` endpoint has zero UI consumers. None of the bridge's 33 handlers expose staff — statenour is blind to the team. Careers applicants sit inside the sales kanban.
**Do:** (1) End of getTeamPerformance loop: `db.update(technicians).set({qcPassRate, comebackRate, totalJobsCompleted})` behind a `persist=true` param (cron passes true). (2) Add `team_performance` bridge handler (shape-copy `shop_pulse` at :439) returning metrics + clockedIn; update NICKSTIRE-QUERY-CONTRACT doc. (3) Team panel beside TechManager (:533) via `trpc.dispatch.teamPerformance.useQuery()` — jobs-30d, revenue-30d, QC%, comeback%; honor the '0% renders as 0%' test pattern (admin.test.tsx:143). (4) 'Applicants' filter tab (source='careers') in leads admin, excluded from sales counts.
**Verify:** Run the cron handler → `SELECT qc_pass_rate FROM technicians` differs from 1.00 defaults; bridge curl returns techs array; admin Dispatch shows metric cards; Careers submission appears only under Applicants. `pnpm --filter nickstire test` green.

### AG-21 · Close small loops: persona scores + guardian test
**Files:** `app/api/nick/reason/telemetry/route.ts`, `lib/trpc/routers/nick.ts`, `tests/tools/guardian-durable.test.ts`
**Context `[VERIFIED]`:** `scorePersonas()` computes good/ok/tune verdicts and has zero callers — weeks of telemetry invisible. `tests/tools/guardian-durable.test.ts` reported red on main (memory chip task_936e2de5) while the durable re-dispatch code landed 2026-07-07.
**Do:** (1) Include `personas: await scorePersonas()` in the reason telemetry response + a `nick.personaScores` operatorProcedure. (2) Re-align the guardian test's mocks to the current 4-tier dispatch (pendingExecutions → durableToolExecutors → TOOL_MAP → executeActionWithoutTracing). Test-only — do NOT touch guardian.ts.
**Verify:** `GET /api/nick/reason/telemetry` returns personas[] with runs/verdicts; `vitest run tests/tools/guardian-durable.test.ts` exits 0.

---

## 6 · WAVE 2 — THE PERSONA LAYER (net-new, built on Wave 1)

### AG-30 · `/spar` thought-partner mode: diverge → attack → converge
**Files:** `lib/ai/prompt/policy/spar-mode.ts` (new, model on `operator-rules.ts`), `app/api/ai/chat/finalize-system-prompt.ts`, `lib/ai/chat/handlers/patterns.ts`, `lib/services/chat/persist-assistant-turn.ts`, `lib/brain/objection-injector.ts` (new), `lib/services/chat/brain-context.ts`, `lib/ai/adversarial-critic.ts`
**Context `[VERIFIED]`:** No brainstorm mode exists on the live path — "brainstorm X" gets only temp 0.85 + creative model route. `adversarial-critic` objections are write-only (buried in the long-press trace modal; a severity-3 "the recommender is probably wrong" never re-enters context). `contradiction-injector` (brain-context.ts:239-262) is the proven pattern for re-entering context.
**Do:** (1) Detection: contract `answerMode==='brainstorm'` (AG-11) OR explicit `/spar` prefix (add to patterns.ts beside EARLY_STRICT). (2) New ~600-char policy block injected only on those turns: *produce 3-5 genuinely distinct options grounded in Nour's data → attack the strongest one yourself (reuse CONTRARIAN_CRITIC backstory verbatim as the attack framing) → name the tension, don't resolve unless asked → end asking which thread to develop.* (3) In persist-assistant-turn: spar-mode turns run `criticizeAsync` UNCONDITIONALLY (bypass looksLikeRecommendation); store `conversationId` in the objection's metadata (call site :1394 has convId in scope). (4) New `objection-injector.ts` mirroring contradiction-injector: most recent severity≥2 foundFlaw objection in THIS conversation, not yet acknowledged, 24h TTL, 1/conversation → block "## OPEN COUNTER-VIEW … raise it ONCE if the current turn touches the same decision; otherwise stay silent." Wire into brain-context next to the contradiction block, `critical:false`, 3s timeout.
**Verify:** Live: "spar with me on opening the second location" → numbered distinct options + explicit attack + named tension + which-thread question; traces show critic fired. Two-turn test: turn 2 same topic references the counter-view unprompted; unrelated turn 2 does not. Unit tests mirror response-contract test style.

### AG-31 · Tactician layer: "your next move" composer
**Files:** `lib/ai/tactician/next-move.ts` (new), `lib/services/chat/brain-context.ts`, `lib/ai/tools/brain.ts`, `lib/ai/chat/interceptors.ts`, `app/api/cron/embed-backfill/route.ts`, `lib/ai/greene-message-matcher.ts`, `tests/ai/tactician-next-move.test.ts` (new)
**Context `[VERIFIED]`:** Zero tactician exists. Raw material ready: ~164 Greene corpus entries with `triggers[]`/`actions[]`; per-person contextual laws (24h-cached); `analyzePowerDynamics` analyzer; PersonProfile.applicableLaws refreshed weekly by cron. The corpus is keyword-trigger-only — paraphrases miss (minScore 2 → most turns fire nothing) and BrainMemory greene_law rows are NOT embedded.
**Do:** (1) `next-move.ts`: deterministic-first composer — inputs: matcher picks WITH actions[]; cheap name-match of the message against ~50 cached PersonProfile names → when a tracked person is mentioned, pull `pickContextualLawsForPerson` + powerBalance; optional analyzePowerDynamics on power-intent keywords. Output: a 'NEXT MOVE' block instructing the model to end with exactly ONE concrete move (verbatim from corpus actions[] where possible, cited `[Greene · Law N]`). (2) Wire into brain-context (keyword-gated via the same families as chat-mode.ts:408) + a `recommendNextMove` chat tool. (3) `/battle` prefix (interceptors.ts) forces the block with relaxed thresholds (minScore 1, maxLaws 3). (4) Vector fallback: extend embed-backfill cron with a `greene_law` source (~164 one-time embeds); in the matcher, when triggers return `[]` and a precomputed userEmbedding is passed, cosine top-3 with ~0.30 floor, flagged `source:'vector'`.
**Guards:** don't copy the KEPT_WORD unfiltered-load pattern (contextual-greene-laws.ts:155) into new code; corpus is operator-seeded (injection-low) but never prompt-inject corpus text editable from chat.
**Verify:** Unit: "Marcus keeps undercutting me in front of the client" with seeded PersonProfile 'Marcus' + mocked corpus → block contains exactly one corpus action + power balance. Embed cron: `report.greene_law.remaining` reaches 0; paraphrase test ("my business partner takes credit for everything I build") returns ≥1 vector-sourced pick.

### AG-32 · Personas as selectable chat modes (the registration answer)
**Files:** `app/api/ai/chat/finalize-system-prompt.ts` (:114-140 personalityPrompts), `components/chat/nick-header-v2.tsx`, `lib/ai/skills/bundled-protocols.ts` + `lib/ai/skills/<persona>.ts` (new), `data/skills-registry.json`, `lib/ai/reasoning/engine.ts` (classifyStepIntent ~:230-266)
**Context `[VERIFIED]`:** The live conversational-stance axis is the personalityPrompts map (master/builder/friend) — `gate.ts:139-149` passes any string through and unknown keys fall back to master, so additions are safe. Skill-recall verdict: personas CANNOT ship as pure skills (recall is pull-based + prunable; SKILL.md bodies never deploy; tool-loaded protocols live one turn). Hybrid = code for always-on behavior + skill artifacts for discoverability.
**Do:** (1) Add `thought-partner` and `tactician` entries to personalityPrompts (10-line blocks matching the existing shape, distilled from behavior-directive sparring text and AG-31's move discipline) + picker entries in nick-header-v2. (2) For each Wave-2 persona, export the protocol string in `lib/ai/skills/<name>.ts`, register in bundled-protocols.ts, surgical-insert one entry into `data/skills-registry.json` (do NOT regenerate the file), then run `scripts/embed-skills.ts` once (idempotent, embeds only newcomers). (3) Extend `classifyStepIntent` verb families so consult/strategy plan-steps select the new personas.
**Verify:** Chat turn with personality='thought-partner' shows the block in the finalized prompt + a behavior shift; `suggestSkills('tactician')` returns the persona with hasProtocol:true; `getSkillProtocol` serves the body; existing prompt-v2 tests byte-identical when no persona active.

### AG-33 · First-class ghostwriter service
**Files:** `lib/ai/ghostwriter.ts` (new), `lib/trpc/routers/operator.ts`, `lib/intelligence/content-alpha.ts`, `app/api/telegram/webhook/route.ts`, `lib/content/drafts.ts`, `components/content/drafts-tab.tsx`, `tests/ai/ghostwriter.test.ts` (new)
**Context `[VERIFIED]`:** Composition only — every ingredient exists: `buildNourVoicePrompt`, `getPersonaAnchorPrompt`, feedback recall (AG-15 wires them into chat; this packet makes them a reusable service), `critiqueContent` (7-axis), SHAPE_LENGTH shapes, SMS_VOICE card in knowledge/detectors.ts. No email/long-form surface exists anywhere; `/twopass` is prompt theater; approval is binary with no revise path.
**Do:** (1) `ghostwriter.ts`: `buildGhostVoicePrompt(channel: 'social'|'email'|'sms'|'longform')` composing voice + anchor + feedback + per-channel shape card; `ghostwrite({brief, channel, personaKey?})`: generate → critiqueContent → if shouldRegen, ONE revision pass with offenders injected ("you used: <cliches>; replace with specifics") → `{text, score, offenders}`. (2) Adopt in the three bypassing surfaces: generateMarketingContent, content-alpha, new Telegram `/draft <channel> <brief>` command. (3) createDraft persists `{score, offenders}` in sourceMetadata; drafts-tab renders score chips (red <60, amber 60-75); new `operator.reviseDraft` mutation reruns the revision loop.
**Guards:** keep Nour's personal voice (statenour) separate from Nick's Tire brand voice (contentManufacturing + BRAND_VOICE cards) — channel/persona decides which pack loads; never mix. Create drafts only on explicit generate, not exploration, to avoid queue pollution.
**Verify:** `tests/ai/ghostwriter.test.ts`: generic-input fixture scores ≥60 after revision with zero ANTI_NOUR hits. Live: /content assistant drafts carry scores; `/draft sms follow up with the fleet lead` returns in-voice copy; 7-day NICK_QUALITY content-turn average rises vs baseline.

### AG-34 · Researcher async: "go research X", delivered to your phone
**Files:** `lib/inngest/functions/deep-research.ts` (new), `lib/inngest/functions/index.ts`, `lib/ai/tools/system.ts`, `lib/ai/tools/catalog.ts`, `app/api/telegram/webhook/route.ts`, `lib/ai/deep-research.ts`
**Context `[VERIFIED]`:** Research only works inside an open chat SSE session; Telegram has zero research tools; DeepResearchReports are ephemeral (never persisted — a 5-search cited report vanishes with the turn).
**Do:** (1) Persist: after non-empty synthesis, write a document/BrainMemory row (kind 'deep-research', question + synthesis + citations) via the existing document-ingest path; pre-plan, semanticSearch prior reports — a strong <7-day match returns cached instead of re-spending. (2) Inngest event fn `research/on-demand` `{question, deliverTo:'push'|'telegram'}`: runDeepResearch (works keyless post-AG-16) → persist → deliver via the intelligence-brief push pattern or Telegram sendMessage. (3) Cheap chat tool `queueDeepResearch` (returns "research queued — you'll get a push") + Telegram `/research <question>` command.
**Verify:** `/research <topic>` on Telegram → cited synthesis arrives within ~2 min; Inngest run green; re-asking the same question within a day returns cached:true in <2s; new-conversation `searchDocuments` finds the report.

### AG-35 · Re-inject the business knowledge pack into Prompt V2
**Files:** `lib/ai/system-prompt.ts`, `lib/ai/prompt/v2/index.ts`, `lib/ai/system-prompt-cache.ts`, `tests/ai/business-knowledge-gates.test.ts`
**Context `[VERIFIED]`:** Since the 2026-06-29 V2 cutover, `getBusinessKnowledge` (1,632-line pack: PRICING_POLICY, SHOP_OPS_CARD, BRAND_VOICE, seasonal playbooks) reaches only a diagnostics page — Nick advises on the business without its pricing policy in context.
**Do:** In the V2 assembly (where tier+slot are computed), call `getBusinessKnowledge(tier, userMessage)` and append as a layer when tier ∈ {business, strategy, full} or the content/sms slot fired. **Constraints:** preserve detectors.ts tier gating (full pack blows Venice 65K); bump/flush the prompt cache per `system-prompt-cache.ts:127` guidance; keep passing userMessage so sub-tier detectors work. Also add a cheap staleness canary: compare pack hours/phone against the bridge shop_pulse once and log drift.
**Verify:** `GET /api/system/prompt` with msg='how should we price alignments this month' shows PRICING_POLICY sections + tier='business'; with 'hey' absent. `vitest run tests/ai/business-knowledge-gates.test.ts` green; live probe cites the $60 used-tire hook correctly.

---

## 7 · WAVE 3 — COMPOUNDING LOOPS (after Waves 0-2 stabilize)

### AG-40 · Shared brief-composer + quality gate + incremental compression
One `lib/ai/brief-composer.ts` (`composeBrief({label, cacheCategory, cacheKey, systemPrompt, signalBlock, taskType, maxChars})`) owning cache read/write, tracedAiChat, think-tag scrub, trim, and the universal grounding footer ("never invent data"). Migrate the six copy-paste `*-brief` routes + the intelligence drift pair (`intelligence-brief.ts` ↔ `briefs/generate`) onto it, keeping response shapes byte-identical. Add the two-tier quality gate (deterministic canary: ≥1 signal-block proper-noun/number must appear in output, retry once then self-hide; fire-and-forget judge-eval composite into AgentTrace metadata; weekly per-label trend in weekly-review). Convert `conversation-compress.ts` to fold-forward incremental (prior summary + only new messages; constant cost on 100-msg conversations) keeping the cache shape + 4s race + PR #551 tests green. Also wire the missions brief header (`nicks-morning-brief.tsx:65`) to POST `/api/ai/missions-morning-brief` instead of the never-generated static file, then decide home/scoreboard-brief (wire or delete).

### AG-41 · PA power features
(1) **Reminder engine on existing rails:** `/remind <time expr> <text>` → createTask WAITING + snoozedUntil (deterministic ET parser: 'in 2h', 'at 3pm', 'tomorrow 9am'); hourly due-check step in `proactive-push.ts` flips READY + one deduped Telegram line per reminder (`markPushSent` pattern). (2) **Tool-capable `/ask`:** bounded generateText loop, maxSteps 4, 25s budget, SMALL tool subset only (getTodaySchedule, proposeCalendarEvent, createTask, memorySearch) — NOT the full nourTools catalog; keep the 3500-char cap + trace parity. (3) **Kill /qa's 24h latency:** extract the execute-approved core from nick-action-execute; new Inngest fn on event `nick-action/approved` (pattern-copy bulk-sms-approval.ts); cmdQa emits after updateMany; cron stays as backstop; idempotencyKey blocks double-execution. (4) **Gmail loop:** honest cadence (light 30-min urgent-check Inngest fn work-hours-only reusing classifyEmail + nudge dedup; fix config/crons.ts to describe reality) then draft-reply: gmail.compose scope + createDraft + 'Draft reply' inline button → AI draft saved to Gmail drafts, **never auto-send**. (5) **lib/personal reconciliation:** wire sleep-context as the single quiet-hours source or delete; wire energy-router into the 9pm push or delete; same for task-timing-predictor.

### AG-42 · Team orchestration maturity
(1) **Persona-member boards:** board/types.ts resolves memberIds against PERSONAS when not in the lens REGISTRY (consult.ts already drops unknown ids — additive); add a `team` board = {thought-partner, research-analyst, strategist, tactician, business-consultant}; reachable via AG-13's tool. (2) **Tool-capable sub-agents:** optional `allowTools:'readonly'` per task — lift the engine's read-only tool-gather (engine.ts:871-893) into a shared helper; one bounded gather pass prepended to the sub-agent prompt; raise timeout to ~25s for tooled tasks only; opt in for researcher-persona tasks. (3) **Scorer→selection loop:** thread REAL confidence into recordPersonaUsage (engine.ts:341 hardcodes 0.7/0.2 — fix the write before the read); then demote-only substitution: verdict 'tune' with ≥10 runs and a 'good' sibling → swap + SystemMetric log; 30s-cached scorePersonas. (4) **Specialist routing via shadow mode:** add 'shadow' flag value — routeMessage logs SystemMetric decisions, never dispatches; review a week of data; implement only the routes that actually fire; then flip. Fix the safety-parity issue first: the specialist block runs BEFORE interceptors and the budget gate (route.ts:110-159 vs :372) — reorder or hoist assertWithinBudget. (5) **Guardian dedupe staleness:** approval dedupe (guardian.ts:483-518) matches identical toolId+payload across ALL terminal statuses with no time bound — a repeated action silently returns the OLD result; add a time bound (e.g. 24h) before routing team actions through it.

### AG-43 · HR durable (nickstire)
(1) **time_clock_entries table** (id, technicianId FK RESTRICT, clockInAt, clockOutAt nullable, source) — hand-applied TiDB-safe DDL per the railway-run pattern; clockIn inserts (closing dangling entries defensively), clockOut sets clockOutAt, keep the boolean in sync; `staffHours.getWeeklyHours` (cap open entries at 12h flagged); `dispatch.weeklyHours` procedure + hours table in DispatchSection; optional Monday Telegram summary for payroll prep (Mumu). **This is the packet where waiting has permanent cost — every day loses unrecoverable payroll hours.** (2) **Applicant tracking lite:** `applicantStage` column on leads (TiDB-safe one-column ALTER); skip scoreLead for source='careers' (fixed score 'Job applicant'); setApplicantStage mutation + 6-column mini-kanban; **audit every lead-based outreach/bulk-SMS selection for a `source != 'careers'` filter** (bulk-SMS is LIVE in prod — messaging job applicants is the failure mode). (3) **Team admin page:** UI for the orphaned technicians CRUD router (extend its zod to accept role/skills/phone — columns exist at schema.ts:936-945); delete confirm-gated per nickstire-ios-pwa-primitives; surface FK RESTRICT errors gracefully. (4) **statenour staff visibility:** typed bridge wrappers; 'Shop Team' card where shop_pulse renders; /people employee profiles linked via `metadata.nickstireTechId` (Json field exists — no Prisma migration) render live clockedIn + 30d stats.

### AG-44 · Research & content depth
(1) **Deep-research reads pages:** top 2-3 citation URLs (dedup by host) → Firecrawl scrapeUrl (keyed in prod), 8s timeouts, allSettled, ~2K chars each appended to the dossier; one gap-check classify pass emitting ≤2 follow-up queries; cap plan(5)+scrape(3)+gap(2); fence all scraped text. (2) **Real competitor watch:** scrape discounttire.com/promotions + conrads.com/specials via Firecrawl in a new `connectors/competitor-watch.ts`, emitting scraped markdown through the existing extraction→grounding→scoring pipeline (replaces AG-02's deleted fiction with reality; 1 fetch/source/day via the cron cadence). (3) **Publish→performance loop:** weekly Inngest step pulls Meta Graph insights for published SocialPublishQueue rows → sourceMetadata metrics + top-3 captions to BrainMemory `content_winners` → ghostwriter appends a "RECENT WINNERS — reuse these hook patterns" block. (4) **Creative regen:** extend pre-stream-regen gating to creative+contentMode turns scored with critiqueContent (flag-gated as today, default byte-identical).

### AG-45 · Skills registry freshness + learning loop
(1) **Merge-mode rebuild:** `build-skill-registry.ts --merge` preserving manual entries (maxforge-alpha), scanning all plugin marketplaces generically, printing added/removed/changed diff, storing `~`-portable paths (stop leaking `C:\Users\nourd` into prod tool output). **Never naive-rebuild from a drifted machine — standing memory rule.** (2) `scripts/audit-skill-embeddings.ts`: registry names vs vector_embeddings sourceIds → missing = embed worklist, orphans = recall pollution. (3) **Usage learning loop** (needs AG-17 live ≥1 week): `scripts/report-skills.ts` joins `skill.recall.injected` metrics with judge-eval quality by conversation → which skills correlate with high-quality replies; feed the quarterly top-50 re-curation; update ADR-0007 in the same PR.

---

## 8 · SEQUENCING & DEPENDENCY GRAPH

```
WAVE 0 (independent, any order): AG-01 AG-02 AG-03 AG-04 AG-05
WAVE 1: AG-10 AG-11 (route.ts neighbors — land in this order, small PRs)
        AG-12 → AG-13 (tool before board/team commands)
        AG-14 AG-15 AG-16 AG-17 AG-18 AG-19 AG-20 AG-21 (independent)
WAVE 2: AG-30 needs AG-11 (contract) + AG-15 (convId in objections)
        AG-31 needs AG-14 (matchers in chat)
        AG-32 needs AG-12 (personas exist)
        AG-33 needs AG-15; AG-34 needs AG-16; AG-35 independent
WAVE 3: AG-40..45 after their Wave-1/2 prerequisites; AG-43(1) time-clock is
        URGENT-independent — may be pulled forward any time.
```

**Cost note:** three expensive reasoning paths are already ON in prod (multi-agent auto, deep reasoning per flag state, self-consistency `[SNAPSHOT]`); the chat route's mutually-exclusive gates are the only cost control. Watch `/system/agent-traces` + the AI budget after each Wave-1 landing.

## 9 · PACKET TEMPLATE (for anything not covered above)

```
CONTEXT: <what is verified true, with file:line>
DO: <surgical steps, no refactors beyond the ask>
GUARDS: <what must not change>
VERIFY: <exact command(s) + observable behavior>
```
Karpathy rules bind every packet: state assumptions, minimum code, touch only what the packet names, every change traces to the packet's goal. If reality contradicts this plan — **the code wins**; report the discrepancy, don't force the plan.
