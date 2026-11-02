# W6 intent surface: Nick composes the screen from typed cards

> Spec, 2026-11-01, job 2026-11-01-chat-humanizer-w6. Approved by the manager 21:40Z (alternative A). Lives at
> `apps/statenour/docs/design/ui-v3/W6-INTENT-SURFACE.md`, the first commit of branch `statenour/ui-v3-w6`, cut
> fresh from `origin/main` after PR 3499 (one typed-card registry) merges. No code before that merge.
> Labels: FACT (read this session, source given) · STRONG INFERENCE · CLAIM · UNKNOWN.

## 1. What Nour asked for, and what this spec assumes

- **His words.** 2026-11-01: "register them", "plus any more too", "Go" (on W6). `docs/design/ui-v3/PLAN.md:66`: "an
  intent surface where Nick composes the screen from typed cards ... It removes the question 'which page do I open'."
- **Outcome.** He says what he wants to see ("shop today", "who needs me", "is everything running"), and gets ONE
  screen of cards, with no prose to read and no page to pick. He can refresh it and come back to it.
- **Assumptions (his to overrule):** one owner user; phone first (390 px); read-only (the surface never writes, never
  sends); behind a flag, off by default; not a Home replacement until the kill reads pass.

## 2. What exists (so nothing is rebuilt)

| Piece | Where | Label |
|---|---|---|
| One card registry: 63 entries (label/subtitle/rich body); typed cards add a zod/mini `outputSchema` (2 so far) | `components/chat/tool-result-registry.tsx`, `components/chat/typed-cards.tsx` (PR 3499) | FACT |
| One card renderer with honest states (running, failed, "Not done", schema miss draws no body) | `components/chat/tool-result-card.tsx` | FACT |
| Read-only tool allowlist, reviewed per tool (87 tools) | `lib/ai/tools/read-only-tools.ts:66` `READ_ONLY_TOOLS` | FACT |
| The surface's vocabulary today = read-only AND registered: **19 tools** (searchMemories, searchColdMemory, searchReflections, getRecentReflections, getCronStatus, toolHealth, getBrainHealth, rankNextActions, getBlindSpots, findCustomer, getBodyData, getFinancialSnapshot, compareLiveRevenue, getMarketingAttribution, weeklyReview, endOfDay, dailyPulse, getFleetTruth, getTopDecisions). No card for tasks, missions, commitments, people picks or the calendar | vitest count on branch `statenour/ui-v3-w6-registry`, 2026-11-01 | FACT |
| Every tool's input schema (zod, `tool({ inputSchema })`) | `lib/ai/tools/*.ts`, assembled as `nourTools` (`app/api/ai/chat/prepare-tools.ts:22`) | FACT |
| Tools run outside chat today, gated: Telegram `/ask` runs a `nourTools` subset in `withTurnContext` with `generateText` | `app/api/telegram/webhook/route.ts:1456-1600`, `lib/agent/turn-context.ts:78` | FACT |
| Env-typed flag registry | `lib/feature-flags.ts` | FACT |
| Six-feet v3 distance gate with DEMO fixtures and `baselinePending` for new pages | `tests/e2e/visible-transformation-v3.spec.ts`, `tests/e2e/vt-render.ts` `V3_PAGES` | FACT |
| Chat itself already lets the model pick tools and draws their cards, under prose | `app/api/ai/chat/*` (owned by the chat sessions; this spec does not touch it) | FACT |

## 3. Benchmarks (read 2026-11-01)

- **A2UI**, https://a2ui.org/ : "Agents can only use pre-approved components from your catalog" (client-owned catalog;
  the agent sends UI as data). Adopted: the catalog rule. Rejected for now: the wire protocol (no external agent
  renders into this app; `docs/UPSTREAMS.md:96` verdict PATTERN, protocol only if that changes).
- **Vercel AI SDK generative UI**, https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces : tool parts are typed
  `tool-<name>`, rendered by `part.state` (input-available, output-available, output-error). Adopted: render tool
  OUTPUT through the component registry, by state. This app already does it in chat.
- **CopilotKit**, https://docs.copilotkit.ai/generative-ui : `useComponent` = `name` + zod `parameters` + `render`,
  "the simplest form of Generative UI"; the docs split generative UI into Controlled, Declarative and Open-ended.
  Adopted: the split, as the axis the two alternatives below differ on. The Declarative sub-page
  (`/generative-ui/declarative`) returned HTTP 404 on 2026-11-01 (WebFetch).
- **assistant-ui**, https://github.com/assistant-ui/assistant-ui : "render tool calls and JSON as React components";
  verdict PATTERN (`docs/UPSTREAMS.md:87`). Its tool-UI doc pages (`/docs/guides/ToolUI`, `/docs/guides/tools`) both
  returned HTTP 404 on 2026-11-01, so its per-tool state names stay CLAIM (via the chat-upgrades research doc).

## 4. Two alternatives that differ in kind

### A. Controlled: Nick picks the reads, the server runs them, the registry draws them (PICK)

1. Page `/now` (flagged). One input line plus up to 4 saved intents as chips. 44 px targets.
2. `POST /api/intent/compose` (owner auth) runs ONE `generateText` with only the surface's tools: the ones in
   BOTH `READ_ONLY_TOOLS` and `TOOL_CONFIG`, taken from `nourTools` (so every gate in the wrapper stays on).
   `toolChoice: "required"`, `stopWhen: stepCountIs(1)` (the model calls its reads in one step, in parallel),
   `abortSignal: AbortSignal.timeout(20_000)`, inside `withTurnContext`. Prior art, copied not invented: Telegram
   `/ask`, `app/api/telegram/webhook/route.ts:1456-1600` (`getModel("reason")`, `withTurnContext({}, ...)`,
   `stepCountIs(4)`, 25 s abort, `recordTrace`).
3. Trust boundary: the SDK validates each call's args against that tool's `inputSchema`; the route keeps only calls
   whose name is in the allowlist (the tool set is the allowlist, so the model cannot reach anything else), drops
   duplicates, and refuses past 6 calls (a counting wrapper on `execute`, refused calls are counted, never run).
4. The route returns `{ parts: [{ type: "tool-<name>", state, output }] }` from `result.steps[0].toolResults` and
   tool errors: the AI SDK part shape the registry already reads.
5. The client draws each part with `ToolResultCard`, OPEN (not behind a receipt line), in the model's order. A failed
   read draws its failure words, never a zero. No prose.

6. **Register the missing reads ("plus any more too").** The starter intents need cards that do not exist: `getTasks`, `getMissions`, `getCommitments`, `getRelationshipPicks`, `getTodaySchedule`, `getHabitStreaks` (all read-only, none in `TOOL_CONFIG`). Each gets a registry entry; the ones with a stable producer type get a typed card with `outputSchema` pinned to that type at compile time, as PR 3499 did for `getFleetTruth`.

Cost: one route, one page, one flag, six registry entries, about 400 lines plus tests. Data path: tool outputs, already typed by the registry.
Risk settled: tools run outside chat today (Telegram `/ask`) inside `withTurnContext`; A does the same (FACT).

### B. Declarative: Nick writes a layout, the client binds it to read models

1. Nick returns an A2UI-shaped surface spec: rows and columns of catalog components, each with a data binding
   (`{ kind: "goals.snapshot" }`, `{ kind: "pulse.feed", source: "system" }`).
2. The client resolves each binding through the existing tRPC read models (the ones Home and Pulse already use) and
   renders the component; layout is Nick's, data is the client's.

Cost: a layout schema, a binding map from every card kind to a tRPC read, and new card components for Home/Pulse
read models that have no tool card today. A second data path beside tool outputs. About 3x A.
Gain over A: live data without re-asking Nick; layouts can be saved and replayed for free.

Ruling (manager, 2026-11-01 21:40Z): alternative A over B - a client-bound layout language is a second vocabulary the registry was merged to remove - cost if wrong: one more wave to add layout freedom later.

**Pick: A.** It is the smaller one, it reuses the registry PR 3499 just made single, and it needs no second data
path. B is the upgrade path if A passes its kill reads and Nour wants saved screens that refresh without a model call.

## 5. The 10x option (not built)

Nick composes the screen BEFORE he asks: the overnight pass (the sleep-time lane in the chat-upgrades research doc)
writes tomorrow's `/now` composition from goals, Pulse, declined work and the calendar, and Home opens on it. The
question "which page do I open" disappears because nothing has to be opened. Needs A's compose step, a stored
composition, and the card-feedback loop (chat-upgrades upgrade 8). Not before A's kill reads.

## 6. Build scope for PR 2 (alternative A)

- Flag `W6_INTENT_SURFACE` in `lib/feature-flags.ts`, off by default; `/now` 404s and the route refuses when off.
- `app/(mastery)/now/page.tsx` + one client component; Command Deck grammar (ruled rows, no glass panels, sentence
  case, no em dashes in copy), antislop-ui pass. Two-tap in-DOM controls only, no `window.confirm/alert/prompt`.
- `app/api/intent/compose/route.ts`, owner auth, read-only, no writes, no sends, no schema change.
- Six new registry entries (step 6 of A), typed where the producer has a type; each with a render test on a real-shaped fixture.
- Saved intents: device-local (try/catch), max 4. Server storage only if the kill reads pass.
- Telemetry: one `recordTrace` per compose (`lib/ai/agent-trace`, label `intent-surface`, as Telegram's
  `telegram-ask`) with intent length, cards asked, refused, failed, latency. No intent text stored beyond what chat traces already store.
- Six-feet gate: `/now` added to `V3_PAGES` with a DEMO fixture (`page.route` on `/api/intent/compose`), marked
  `baselinePending` until the capture dispatch on main.

## 7. Tests (red first)

1. Trust boundary: the tool set handed to the model is exactly read-only AND registered (a write tool, an
   unregistered read: absent); a 7th call is refused and never run; a duplicate is dropped; a valid set of calls
   passes. Mutation: widen the tool set to `nourTools`, remove the cap, remove the dedupe.
2. A failed or timed-out read returns `state: "output-error"` and the page says the read failed, never "0" or "none".
3. Flag off: page 404, route 404. Flag on, no owner session: 401.
4. Render: parts draw through the REAL `ToolResultCard`, open, in order; a typed card with a schema miss shows its
   receipt and no body.
5. Positive control for the six-feet fixture: the fixture page renders at least one card.

## 8. Kill criteria and live checks

- Flag on 2026-11-15 at the latest (after PR 2 merges). Read on **2026-11-29** (14 days):
  1. Nour opened `/now` and composed at least 6 times (`intent-surface` trace count).
  2. At least 80% of compositions drew at least one card that is not a failure.
  3. p50 compose latency under 10 s.
- Any one missed: delete the page, route and flag in one PR; the registry stays. All three met: propose B or the 10x
  option to Nour with the numbers.
- Real-iPhone check before the flag goes on: compose "shop today" on bdnick.info; one screen, cards open, no prose.

## 9. Out of scope

Writes or approvals from the surface; chat route changes (`app/api/ai/chat/*`, `lib/services/chat/*`); Home
replacement; any Prisma change; MCP Apps / A2UI wire protocol.

## 10. Open questions for Nour (none block the build)

1. Route name: `/now` (proposed) or another word?
2. Should the four saved intents start as "Shop today", "Who needs me", "Is everything running", "My day"?
