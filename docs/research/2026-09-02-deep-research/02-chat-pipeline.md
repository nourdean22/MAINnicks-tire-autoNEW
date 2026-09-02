# StateNour Nick Chat/Agent Pipeline — Read-Only Audit

- Scope: read-only audit of the Nick chat/agent pipeline in apps/statenour (bdnick.info).
- Snapshot: git archive of origin/main @ abdd99395 (production commit abdd993), read from
  `scratchpad/main2/apps/statenour`. Nothing executed; no writes to the snapshot.
- Lenses applied: kaizen, karpathy-guidelines, production-code-audit (loaded via Skill tool),
  plus the task's explicit checklist: silent failures, races, idempotency, dead computations.
- Stack per task brief: Next.js 16, AI SDK v6 (`ai` 6.0.162), tRPC 11, Prisma 6 -> Neon, Redis,
  Inngest 4.4.
- Citation classes: **A** = verified directly in this snapshot's code (path:line quoted or
  paraphrased accurately). **H** = inference from code structure/naming, not directly executed
  or cross-checked. **I** = not verified in this pass (named explicitly, not silently assumed).
- Code existence is not runtime proof. Comments are history, not current behavior. A test proves
  only its own subject. Every absence claim below names the exact grep corpus searched.
- No confidence percentages are used anywhere in this report per instructions.

Status: COMPLETE — see §17 "Report status: COMPLETE" at the end of this file. Sections were
appended incrementally as verified; two hops (§11 attachments, §12 conversation model; §10 model
IDs/telemetry) were gathered by delegated sub-agents whose citations were independently
spot-checked against source by the orchestrating pass before being incorporated — noted inline at
the top of each such section.

---

## 1. Composer / UI — one chat surface, not two

**There is exactly one mounted chat UI.** `app/(mastery)/chat/page.tsx:1,23` renders
`<ChatIsland/>` from `features/chat-v2/components/chat-island.tsx` — nothing else is routed at
`/chat`. [A]

`components/chat/*` is **not** a second, competing chat implementation — it is a shared
component library that `features/chat-v2/*` imports from (composer, island, message-list, and
the stream hook all pull pieces from `components/chat/`: `page-context-bridge`,
`realtime-voice-overlay`, `slash-command-dropdown`, `message-diagnostics`, etc.). Verified by
grep: every file under `components/chat/` that has a consumer is imported only from
`features/chat-v2/**` or `app/(mastery)/layout.tsx` (`page-context-bridge`) /
`app/(mastery)/system/chat-states/page.tsx`. [A] Grep corpus: `grep -rl "from \"@/components/chat/"
app features` (4 hits, listed above); no hit outside those two trees, so no independent second
composer exists in this snapshot.

`app/api/chat/` is **not** a second POST endpoint — its only file is
`app/api/chat/export/[conversationId]/route.ts`, a conversation-export handler. The single chat
POST endpoint is `app/api/ai/chat/route.ts`, confirmed as the client's `apiPath` at
`features/chat-v2/hooks/use-chat-stream.ts:106` (`useChatTransport({ apiPath: "/api/ai/chat", ... })`). [A]

**Home's quick-Nick is a second client of the same endpoint, not a second pipeline.**
`components/home/nick-command-line.tsx:100-108` builds its own `DefaultChatTransport({ api:
"/api/ai/chat", body: { privateMode: true } })` and its own `useChat({ id: "nick-command-line" })`
— same server route, same fabrication defenses, but **`privateMode: true` is hardcoded on every
Home send**, unconditionally (no UI toggle; see §Private mode below). [A] Its own comment block
(`nick-command-line.tsx:1-16`) states this is deliberate: "privateMode:true -> zero persistence,
full provider fallback + fabrication defenses." Also deliberately absent: a mic button, because
"voice transcription rides the prod OpenAI key, which is dead (whisper 401, 2026-08-27 memory)" —
[I, comment-only claim, not independently verified against a live whisper call in this pass].

## 2. Slash commands — THREE independent, non-overlapping registries

Confirmed three separate command lists exist, only one guarded against drift:

1. **`lib/ai/chat/command-registry.ts`** (`COMMANDS`, 11 entries: `preview-pushes`, `today`,
   `rescue`, `what-changed`, `import-session`, `receipts`, `convert`, `stale`, `triage-prune`,
   `db-vacuum`, `run-cron` — `command-registry.ts:153-264`) — the real server-side interceptor,
   wired via `resolveCommand`/`runCommand`, imported by `lib/ai/chat/interceptors.ts:76,380`. [A]
2. **`hooks/use-slash-commands.ts`** (`SLASH_COMMANDS`, 37 entries, `:25-81`) — the chat-v2
   composer's menu (rendered through `components/chat/slash-command-dropdown.tsx`, consumed by
   `features/chat-v2/components/chat-composer.tsx:17,353`). This list is a superset that also
   carries client-only prefix-prompts (`/revenue`, `/leads`, `/image`, ...) and page-navigation
   shortcuts (`/brain`, `/tasks`, ...) alongside the 11 real backend commands.
3. **`components/home/nick-command-line.tsx:57-63`** (`SLASH_COMMANDS`, 5 entries: `/task`,
   `/capture`, `/search`, `/review`, `/execute`) — Home's own, textually **disjoint** registry.
   None of these five names match any of the 11 backend `COMMANDS` names, so they are not
   interceptor commands at all — each is a **local prefix string** prepended to the typed text
   and sent as an ordinary chat message (e.g. `/task` -> `"Create a task: " + rest`); `/search`
   is flagged `routes: true` and navigates instead of sending. [A]

**Drift coverage is asymmetric.** `tests/ai/command-drift.test.ts:1-13` (docstring) asserts every
backend `COMMANDS` entry is reachable from `hooks/use-slash-commands.ts`'s menu — it does **not**
check `components/home/nick-command-line.tsx`'s list against anything. Home's 5-command surface
is unguarded by any test in this pass (grep corpus: no `nick-command-line` reference inside
`tests/ai/command-drift.test.ts` or any other file under `tests/` matched by
`grep -rl "nick-command-line" tests/`). [A for the test's scope; I for whether a differently-named
test elsewhere covers it — none found in this pass]

**`/deep`, `/thorough`, `/mega` are a fourth, separate mechanism** — not slash commands at all.
They are raw-text regex markers matched by `lib/ai/reasoning/classifier-core.ts:54,60`
(`/\/thorough\b/i`, `/\/mega\b/i`) inside the escalation path (`lib/ai/vnext/escalation.ts`), and
appear in neither of the two UI dropdowns — a user has no menu affordance to discover them; they
are typed from memory/docs only. [A, absence confirmed by grep: `grep -rln "/deep\"\|/thorough\|/mega\b"
components features` returns only `components/operator/nick-reasoner.tsx`, an operator-only debug
surface, not the composer.]

## 3. Dead dependency — livekit installed, zero references

`package.json` declares `"livekit-client": "2.19.0"` and `"livekit-server-sdk": "2.15.3"` as
dependencies, but `grep -ril "livekit" --include=*.ts --include=*.tsx` across the entire snapshot
(app/lib/components/features/hooks) returns **zero matches**. [A] Positive control: the same
search finds both package names correctly inside `package.json` itself, so the grep corpus is
not silently empty. Voice is implemented independently via raw WebRTC + OpenAI Realtime API
(`hooks/use-realtime-voice.ts`, see §Voice below) — livekit is not the transport for anything
found in this pass. This is dead weight in the dependency tree (kaizen/YAGNI), not a runtime bug.

## 4. Voice — wired and live, not a dead button

The chat composer's Voice button (`features/chat-v2/components/chat-island.tsx:273-274`) toggles
`isVoiceDocked` in `useChatUiStore` (Zustand), and `chat-island.tsx:312` conditionally mounts
`<RealtimeVoiceOverlay open={isVoiceDocked} onClose={toggleVoiceDock}/>` from
`components/chat/realtime-voice-overlay.tsx`. [A] That overlay auto-starts
`useRealtimeVoice` (`hooks/use-realtime-voice.ts`) on open, which:
1. POSTs `/api/realtime/session` to mint an ephemeral OpenAI token server-side (`:99-117`),
2. opens a raw `RTCPeerConnection`, attaches the mic, and POSTs the SDP offer directly to
   `https://api.openai.com/v1/realtime/calls?model=gpt-realtime` from the **browser** using the
   ephemeral key (`:158-181`) — i.e. the browser talks to OpenAI directly after the server mints
   the short-lived credential; the audio/SDP path itself does not proxy through statenour, [A]
3. dispatches realtime function-calls to a **separate** endpoint, `/api/realtime/tool-call`
   (`:264-274`), which is NOT the same code path as the text-chat tool dispatcher — see the
   Approval Gate section below for whether this second dispatcher is covered by the same gate.

Swallowed exceptions on this path (kaizen/production-audit note, low severity — cleanup-only):
`use-realtime-voice.ts:81,83,85,88` (`try { ... } catch {}` on `dc.close()`/`pc.close()`/track
stop/audio srcObject clear) and `:153-155` (`JSON.parse` on a non-JSON data-channel message,
silently ignored). These are teardown/parse guards, not on the main text-chat turn path, and each
failure is idempotent-safe (closing an already-closed connection) — flagged for completeness, not
as a defect. [A]

---

## 5. POST /api/ai/chat — hop-by-hop trace

Route file: `app/api/ai/chat/route.ts` (1217 lines; the "1729 lines" figure in
`docs/ARCHITECTURE.md` is stale — that doc says "Last verified 2026-05-21" and the file has since
been split further into `alternate-paths.ts`, `build-stream-config.ts`, `finalize-system-prompt.ts`,
`build-model-messages.ts`, `prepare-tools.ts`, `derive-turn-signals.ts`, `augment-final-prompt.ts`,
`specialist-routing.ts` — all under `app/api/ai/chat/`). [A] `docs/ARCHITECTURE.md`'s named
functions (`classifyTurn()`, `detectChatMode()`, `pruneTools(mode)` called inline) do not appear
verbatim in current `route.ts` — the equivalent logic now lives in `derive-turn-signals.ts` and
`prepare-tools.ts`. Treat the ARCHITECTURE.md lifecycle diagram as directionally correct but
line/name-stale; this report's citations below supersede it.

### 5.1 Auth -> rate limit -> gate

1. `POST(req)` (`route.ts:49`) first awaits `loadFeatureFlagOverrides().catch(() => {})`
   (`:51`) — silently swallowed; see the Silent-failures section below.
2. `requireSession(req)` (`:53`) — session auth, throws/redirects on failure (not traced further
   in this pass; `lib/auth-guard.ts` not opened). [I — not opened this pass]
3. `checkAiRateLimit(req)` (`:60`, from `lib/rate-limit.ts:162-175`) — 10 req/min per
   `${pathname}:${ip}` key against `RATE_LIMITS.ai` (`lib/rate-limit.ts:144-149`); returns a 429
   Response directly, short-circuiting before the actor/turn-context wrap.
4. `withActor("nick", () => withTurnContext({}, () => chatPostInner(req)))` (`:75`) — every DB
   write from this point is tagged actor "nick" (v7.8 universal audit), and a turn-context scope
   opens (seeded empty; filled once `convId` resolves) so tools running later in the same turn can
   read which conversation/private-mode state they're in via `lib/agent/turn-context.ts`.
5. Inside `chatPostInner`, `runGate(req)` (`lib/ai/chat/gate.ts:120-237`) runs a second,
   independent set of gates before any expensive work: its own rate-limit check
   (`gate.ts:122`, `checkRateLimit("ai-chat:"+ip, RATE_LIMITS.ai)`), an AI-budget check
   (`checkAiBudget(0)` from `lib/services/power-panel.ts`, `gate.ts:147-164`), JSON body parse
   (`:168-175`, 400 on malformed JSON), message-array shape check (`:177-183`, 400 if not an
   array of 1-200 messages), then override/control extraction (mode/provider/taskType/personality,
   privateMode/posture/actionPermission via `parseChatControls()`, `:89-102`, plus 10
   pronoun/entity-anchor context fields).

**Duplicate rate limiter (kaizen finding, low severity).** `checkAiRateLimit(req)` (route.ts:60)
and `runGate`'s inline check (gate.ts:122) both enforce the identical policy — `RATE_LIMITS.ai`
= 10 req/min per client IP on this exact route (`lib/rate-limit.ts:145`) — through the same
`checkRateLimit(key, config)` primitive, but keyed with two different string prefixes
(`"${pathname}:${ip}"` vs `"ai-chat:${ip}"`, `lib/rate-limit.ts:164` vs `gate.ts:122`), so they
occupy two separate in-memory buckets. [A] Because `runGate` only ever executes for a request that
already passed `checkAiRateLimit` (route.ts:60-61 returns before `chatPostInner` is called), the
two buckets receive an identical stream of increments in lockstep — the second check can never
produce a different accept/reject outcome than the first for this route's real traffic. This is
redundant enforcement of the same policy, not a second independent layer (a true defense-in-depth
design would use a different threshold or dimension, e.g. per-session vs per-IP). Not a bug; wasted
branch plus a maintenance trap if one copy's threshold is edited without the other.

**Two budget gates, asymmetric failure logging (silent-failure finding).**
1. `gate.ts:147-152` — `checkAiBudget(0)` (power-panel daily $ cap) fails OPEN on any thrown error,
   but the `.catch()` explicitly calls `recordError("chat:request", err, { stage: "checkAiBudget",
   failedOpen: true })` before returning `{ allowed: true }` — the comment at `gate.ts:143-146`
   states this was fixed: "Now logged instead of silently swallowed, so a persistently-open gate is
   visible in /system/logs."
2. `route.ts:340-341` — a second, later budget check, `assertWithinBudget()` from
   `lib/ai/budget.ts` (reads `UserPreference("ai.dailyBudgetCents")`, default 500 cents, summed
   against today's `AiGeneration.costCents`, 60s in-process cache per its own comment at
   `route.ts:333-339`), is awaited as `await assertWithinBudget().catch(() => null)` — this catch
   has no `recordError` call, no log line, nothing. [A] When `assertWithinBudget()` throws
   (e.g. a Neon hiccup), `budget` becomes `null`, the `if (budget && !budget.ok)` guard
   (`route.ts:342`) short-circuits false, and the turn proceeds completely unmetered with zero
   visibility that the second budget gate ever failed — the opposite of the fix already applied
   one gate earlier in the same request for the same class of failure. This is the same defect
   shape the `gate.ts` comment describes having already fixed once, reintroduced one hop later in
   the same pipeline. Both gates are also independent systems (power-panel vs
   `UserPreference("ai.dailyBudgetCents")` + `AiGeneration` sum) — two different budget-tracking
   mechanisms stacked on the same route, not one shared implementation. [A, from reading both
   files' own doc comments plus the code; I did not independently verify the two caps' dollar
   values agree in a live environment.]

### 5.2 Interceptor fast path and specialist routing (both skipped under Private Lab)

- `runInterceptors()` (`lib/ai/chat/interceptors.ts`, called `route.ts:166-176`) — three
  deterministic intents (image generation, decision log, brain-dump capture) bypass the entire
  model pipeline and return in ~200ms; explicitly placed before the embedding/prefetch work so a
  slow Venice embedding call can't stall a plain capture (`route.ts:146-158` comment).
- `runSpecialistRouting()` (`./specialist-routing.ts`, called `route.ts:189-199`) — sub-agent
  dispatch, runs after interceptors and before the user-turn persist kickoff.
- Both are gated `if (!privateMode)` (`route.ts:164`, `:188`) — the comments at `:159-163` and
  `:185-187` explain why: both fast paths persist directly (titled conversation + user row +
  BrainMemory/Decision rows, or route metrics) before reaching the main pipeline's private-mode
  gate, so a private turn that hit an interceptor would leak to storage. Falling through to the
  main streamText path is deliberately the private-safe route. [A]

### 5.3 Conversation persistence (user turn) — fire-and-forget, parallel with prompt build

`persistUserTurn()` (`lib/services/chat/persist-user-turn.ts`) is kicked off as a promise
(`route.ts:229-254`) that runs in parallel with prompt assembly rather than being awaited up
front (this used to add 200-800ms per the inline comment, `:213-218`). It is wrapped in
`withTimeout(..., 5_000, "persist-user-turn")` and on either a timeout or the function's own
internal catch (`persistUserTurn` is documented as never rejecting on its own), the fallback is
`convId || "temp"` — the chat continues even if the DB write never lands (`:220-222` comment:
"the chat works even if persistence is down"). Under Private Lab this promise is never created at
all — `dbWritePromise` is just `Promise.resolve(convId || "private")` (`:239-240`); no
`ChatMessage` row, no conversation row, no `persistIfImportant` BrainMemory write. [A]

### 5.4 Model/provider selection — precedence and the cost firewall

Precedence, in the order the code itself documents (`route.ts:394-398`, verified against the
actual `??` chain at `:459-463`):
1. Tool-mandatory force — a python-execute or action intent pins `"anthropic"` for the
   `HIGH_STAKES_MUTATIONS` set (`person.create/delete/remove`, `gmail.sendDraft`,
   `gmail.createDraft`, `google.proposeEvent`, `telegram.send`, `shop.sendSms` —
   `route.ts:399-410`) or `"ollama"` otherwise (`:426-431`) — always wins, so strict `tool_choice`
   forcing is reliable.
2. Validated per-request user override (`validatedProviderOverride`, rejects any value not in
   the live runtime provider list — e.g. a retired "venice" override is dropped with a
   `provider_override_rejected` warn log, `:287-292`).
3. Escalation decision — `resolveEscalation()` (`lib/ai/vnext/escalation.ts`), gated by a cheap
   regex first: `detectEscalationTier(userContent) !== "none"` (`:448`) runs before any DB
   round-trip; only a turn that could actually escalate pays for `countEscalationsToday()`
   (`:452`) against `ESCALATION_DAILY_CAP`. Escalation additionally requires `ANTHROPIC_API_KEY`
   to be set (`apiKeyPresent`, `:451`), `NICK_ESCALATION_DISABLED !== "1"` (`:454`), and is
   refused under `privateMode` and for untrusted-input turns (`__webSearchIntent ||
   __webSearchRecency`, `:456`). A refused escalation is logged loudly on purpose
   (`escalation_blocked` warn, `:470-475`) — the comment calls out that a silent refusal here is
   exactly the "silent-gate defect this whole lane exists to end."
4. `canaryDeepForce(mode)` (`lib/ai/vnext/effort-policy.ts`) — lowest precedence.

**Cost firewall / "Turbo consent" gate** (`route.ts:483-496`): `allowMetered` is `true` only for
an explicit user override, `canaryDeepForce`, or an actual escalation — never for an internal tool
force. The code comment (`:488-492`) documents a previously-live silent-misrouting bug class: "The
force above is INERT without this line: getModel sorts the forced provider to index 0, then
filterByCostFirewall deletes it from BOTH selection loops because anthropic is cost-class
metered... Force and consent must move together or the turn silently serves from ollama with
nothing logged." [A, code comment describing the invariant; H that the underlying bug once shipped
— not independently reproduced in this read-only pass, but the comment is explicit about the
mechanism.] This remains a fragile coupling: `effectiveForce` and `allowMetered` are two
separately-computed variables that must be edited together forever, with no type-level or
assertion-level enforcement tying them; a future edit to either without the other silently
reintroduces the exact bug the comment describes.

**Dead computation on the default (flag-off) hot path.** `model = getModel(finalTaskType, {...})`
is computed at `route.ts:497-509` inside a `try` block whose `catch` (`:519-525`) is the only
place `model` is meaningfully used for fail-fast validation ("No AI provider configured" -> 503).
`model` is then passed into `runAlternatePaths()` (`route.ts:936`), which is flag-gated, default
OFF ("Flags off = zero change", `:929`) — but it is not passed to `streamWithFallback()`
(`route.ts:1008-1050`), the call that actually serves every default-configuration turn: that
call's parameter list is `taskType`, `preferLargeContext`, `forceProviderFirst`, `allowMetered`,
and an optional `modelOverride` from escalation — no `model:` key at all. [A, verified by reading
the full argument object at `route.ts:1008-1022`.] So on the default path, the roughly 40 lines of
`getModel()` precedence logic (`:364-509`) exist solely as an early configured-provider check and
as dead input to an off-by-default branch — the actual serving model is independently re-resolved
inside `streamWithFallback`/`getModel` using the same force/override signals, redundantly.
Confirmed by the adjacent `route.ts:1013-1019` comment recounting exactly this class of bug
already having shipped once: wiring `modelOverride` only into the unused `model` broke the
escalation lane so it "set X-Escalation-Applied:1 while silently serving the anthropic DEFAULT...
Caught in adversarial review" — i.e., this exact "the computed value looks used but isn't on the
hot path" shape is a repeat offender in this file, not a one-off.

---

## 6. Prompt assembly — every block, in append order

Assembly happens across four files, in this call order from `route.ts`:
`buildSystemPrompt()` (base layer, `lib/ai/system-prompt.ts`) -> `+ contextHintsBlock`
(`route.ts:742`, from `./context-hints.ts`) -> `+ brainCtx.systemPromptAddendum` (`route.ts:742`,
from `lib/services/chat/brain-context.ts`) -> `finalizeSystemPrompt()`
(`./finalize-system-prompt.ts`) -> `augmentFinalPrompt()` (`./augment-final-prompt.ts`). The
final string returned by `augmentFinalPrompt()` is `finalSystemPrompt`, what actually ships to
the model (`route.ts:796-805`).

### 6.1 Ordered prompt-block table

| # | Block | Source | Gate / condition | Budget interaction |
|---|---|---|---|---|
| 1 | Base identity + engines (v2 prompt) | `lib/ai/system-prompt.ts:87-121` -> `buildSystemPromptV2()` in `lib/ai/prompt/v2` | topic-tier + variant keyed, in-memory cached (`getCachedPrompt`/`setCachedPrompt`, `route.ts:562,580`) | Trimmed to **58,000 chars** here (`trimPromptToBudget(out.prompt, 58000)`, `system-prompt.ts:114`) — section-priority-aware (see 6.2) |
| 2 | Stitch prompt-engineering capability | `system-prompt.ts:112-121` | only when Stitch capability enabled (design-context resolves) | appended after the 58K trim, so untrimmed |
| 3 | Context hints (pronoun/entity anchors) | `./context-hints.ts` `buildContextHints()`, `route.ts:665-679` | always runs; returns `""` on no anchors | not re-checked against any cap |
| 4 | Brain context addendum (up to ~14 named blocks: recall, skills, identity, ghost, qualitative, beliefs, nudges, concerns, anticipated, physical, tasks, cross-session thread, context memories, anticipatory, hybrid recall, truth grounding, contradiction alert, strategic lens, greene frame, dark-psych frame, skill-registry recall, objection block, next move, predictive prefetch) | `lib/services/chat/brain-context.ts:404-440` `buildBrainContext()` | per-block: recall fires per query, `forceRecall` on command-intent phrases (`route.ts:600-602`); several marked `critical: true` (cross-session thread, context memories, truth grounding, contradiction alert, strategic lens, predictive prefetch) | not re-checked against any cap; individual blocks self-truncate (`truncateFenced(..., 1000-2000)`) |
| 5 | Per-provider truncation | `finalize-system-prompt.ts:118-132` | `MAX_SYSTEM_CHARS` = **120,000** (anthropic) or **65,000** (else) | **second, independent trim pass** on top of #1's 58K trim — see 6.2 |
| 6 | Greene strategic-law summary load | `finalize-system-prompt.ts:142-148` | Anthropic-only (comment: gated back to anthropic-only 2026-07-11 to match consumption — ollama/gemini never read `greeneSummary`) | DB read (`prisma.strategicLaw.findMany`), fails to `[]` silently on error (`.catch((): never[] => [])`) |
| 7 | Personality-mode block (master/builder/friend/thought-partner/tactician) | `finalize-system-prompt.ts:154-212` | keyed by `personality` from gate (explicit or inferred); `NICK_DEPTH_UNCAP` flag swaps the master variant | appended after trim #2 |
| 8 | Behavior directive (ANTICIPATE->ANSWER->ELEVATE) | `finalize-system-prompt.ts:222-225` via `getBehaviorDirective()` | self-gates empty on strict-mode phrases; skipped when `turnSignal.intent === "casual"` | " |
| 9 | Chain-of-thought scaffold | `finalize-system-prompt.ts:234-236` | `turnSignal.useChainOfThought` | " |
| 10 | Output-shape scaffold | `finalize-system-prompt.ts:237-240` | `turnSignal.outputShape` non-empty | " |
| 11 | Response-contract directive | `finalize-system-prompt.ts:245-248` | `input.contract` present (AG-11); `""` for unconstrained turns | " |
| 12 | SPAR mode scaffold | `finalize-system-prompt.ts:253-262` | brainstorm contract, `/spar` prefix, or `posture === "spar"` | " |
| 13 | Citation protocol | `finalize-system-prompt.ts:271-282` | any brain block fired AND intent != casual | " |
| 14 | Nour voice guardrails + persona-corpus anchor | `finalize-system-prompt.ts:289-310` | intent in {analytical, decision, creative, reflective, emotional, instructional}; anchor prompt self-caches 15min, `""` if no corpus imported | " |
| 15 | Brevity nudge ("under 60 words") | `finalize-system-prompt.ts:320-322` | casual intent, non-deep mode, non-builder persona | " |
| 16 | FORBIDDEN PHRASES voice guard | `finalize-system-prompt.ts:329-336` | always-on | " |
| 17 | HONESTY + RESPECT block | `finalize-system-prompt.ts:347-353` | always-on | " |
| 18 | Tool-first directive | `finalize-system-prompt.ts:358-361` | `toolFirstDirective(queryShape)` non-empty (factual query shapes) | " |
| 19 | Posture directive (EXECUTE / COUNSEL) | `finalize-system-prompt.ts:369-381` | composer `posture` selector, not during a spar turn | injected **after** the always-on HONESTY block deliberately (self-review #11 per comment) so it isn't out-weighted |
| 20 | Permission directive (READ-ONLY) | `finalize-system-prompt.ts:384-387` | `actionPermission === "read"` only; `"draft"` (default) injects nothing | " |
| 21 | Action-language contract (attempt-tense) | `finalize-system-prompt.ts:395-398` | `actionPermission !== "read"` | " |
| 22 | **`TOOL_DATA_FENCING_RULE`** | `finalize-system-prompt.ts:412`, rule text from `lib/ai/tool-result-fencing.ts` | always-on, appended **last** inside `finalizeSystemPrompt` | **appended after both trim passes** — see 6.2, confirms the task brief's premise |
| 23 | Chat-layer identity + Greene law index + business naming + `ACTION_CATALOG` | `augment-final-prompt.ts:47-68` | Anthropic only gets the full block; ollama/gemini keep the already-finalized prompt unchanged | appended after everything above, still uncapped |
| 24 | Multi-output mode addendum (`/all /ab /reformat /twopass /carousel`) | `augment-final-prompt.ts:75-83` | `detectMultiMode(userContent)` matches | " |
| 25 | Content-feedback recall | `augment-final-prompt.ts:91-104` | `contentMode` only; wrapped in `try{}catch{}` that **silently swallows** (comment: "Supplementary voice context — never blocks the stream") | " |
| 26 | `NICK_HIGH_SPEC_GATE` specificity directive | `augment-final-prompt.ts:123-136` | env flag `NICK_HIGH_SPEC_GATE === "on"` (default off) AND intent in a gated set | " |
| 27 | Customer-shape hint | `augment-final-prompt.ts:150-153` | regex match on first 1500 chars of user content; always-on | " |
| 28 | GSC pre-fetch block | `augment-final-prompt.ts:172-174` via `./gsc-prefetch.ts` | SEO/GSC regex match; injects real numbers or a "NO DATA AVAILABLE" stub on failure | " |

### 6.2 The size guard is a checkpoint, not a hard ceiling — verified

The task brief describes "a ~40k-char system-prompt guard with `trimPromptToBudget`." In this
snapshot the actual numbers are **58,000** chars (base layer, `system-prompt.ts:114`) and
**65,000 / 120,000** chars (finalize layer, `finalize-system-prompt.ts:118`, provider-dependent)
— not ~40,000 anywhere found by `grep -rn "40000\|40_000" lib/ai app/api/ai/chat` in this pass (no
match). Treat "~40k" as an approximation that has drifted from the current numbers; cite the
figures above instead. [A]

More importantly: **both trim calls run mid-assembly, and nothing re-measures or re-trims the
prompt after either one.** Blocks 2-4 are appended after trim #1; blocks 6-28 (roughly 20 blocks,
including the ~1.4KB `TOOL_DATA_FENCING_RULE` itself, per its own comment at
`finalize-system-prompt.ts:409`) are appended after trim #2. The only downstream visibility into
the true final size is a **log-only** measurement: `buildContextManifest(finalSystemPrompt)`
(`route.ts:813-827`, wrapped in a `try{}catch{ // instrumentation only }`) logs `promptChars` and
`promptHash` but never truncates or blocks on the result. [A] So the two "guards" bound only their
own intermediate snapshot of the string, not the prompt actually sent to the model — confirmed by
tracing every append site between the two `trimPromptToBudget` calls and the final `return
finalSystemPrompt` in `augment-final-prompt.ts:176`.

**`TOOL_DATA_FENCING_RULE` is deliberately placed after the trim, and the reason is documented and
sound** (`finalize-system-prompt.ts:400-411`): `trimPromptToBudget`'s section-priority dropper
(`system-prompt.ts:269-332`) treats any section it does not recognize as priority 30 (lowest,
dropped first), and the fencing rule is not one of the named "## " sections in the priority map —
so if it were appended *before* the trim, on a long conversation it could be silently dropped as
low-value, "exactly how this became unwired the first time" per the comment. Appending it after
the trim guarantees it always reaches the model. This is a genuine, intentional fix, not an
oversight — but it is also the mechanism by which the nominal budget stops being enforced past
that point (the same placement that protects the fencing rule protects everything appended after
it from ever being trimmed).

**Truncation-fallback logging cannot distinguish clean drops from a blind slice into protected
content.** `trimPromptToBudget()` (`system-prompt.ts:269-332`) protects sections with priority < 10
(TRUTH RULE, Nour's rules, behavior directive/identity/voice, response style, tools/processing
intake, pinned/hot-rules/anchor, command state, temporal, risks — `:282-290`) from the drop loop
(`:323` `if (candidate.priority < 10) continue;`). But if dropping every droppable (priority >= 10)
section still leaves the prompt over budget, the function falls through to a **character-level**
slice (`:328-330`, `finalPrompt.slice(0, maxLimit - 100)`) that is not section-aware and can cut
into the protected core. The only caller-side log line, `system_prompt_truncated`
(`finalize-system-prompt.ts:131`), unconditionally reports `sectionAware: true` regardless of
whether the clean drop path or the blind-slice fallback fired — so the telemetry cannot
distinguish "dropped some low-priority brain dumps" from "sliced through the TRUTH RULE guardrail
mid-sentence." [A, verified by reading both functions; H/I whether this fallback path has ever
actually fired in production — not measured in this pass, and `finalize-system-prompt.ts:120-128`'s
own comment frames it as a rare last-resort.]

### 6.3 Memory-rendering blocks are fenced — spot-verified against the task's #2062/#2064/#2065 claim

`tests/ai/prompt-block-fencing-gate.test.ts` (206 lines, header-dated 2026-09-02 — i.e. shipped the
same day as this snapshot's production commit) is a structural drift-guard with two halves:

1. **Prompt-block half** (`:173-206`): scans every `@/lib/*` module `brain-context.ts` imports,
   flags any whose source matches `INTERPOLATES` (reads `prisma.brainMemory`/`chatMessage`,
   `searchColdMemory`, `semanticSearch`, `recallMemoriesForQuery`, `getContextualMemories`, or
   `brainMemory.recall/search/get/list`, `:58`), and asserts every such module also matches
   `/\bfenceContent\(/` (`:76`) unless present in a 7-entry `ALLOWLIST` with a >20-char justification
   (`:35-45`, `:204`). It explicitly names 11 modules that must satisfy this (`:181-187`):
   `contextual-recall`, `memory-recall`, `anticipatory-recall`, `chat-recall`, `belief-harvester`,
   `qualitative-identity`, `ghost-nick`, `anticipated-questions`, `contradiction-injector`,
   `session-distiller`, `objection-injector` (all under `lib/brain/`).
2. **Tool-result half** (`:79-171`): the same check applied *per tool block* (not per file) inside
   `lib/ai/tools/*.ts`, with a mutation canary (`:158-170`) that proves the detector actually
   catches a stripped-out fence on one tool without false-flagging its siblings in the same file —
   direct evidence this is a working canary, not a cosmetic test (matches the repo's own
   "ship the canary, not just the control" standing rule).

**Independently spot-checked** (not just trusting the test's own claim): `grep -c "fenceContent("`
against all 11 named files under `lib/brain/` in this snapshot returns **>= 1 match in every
file** (`contextual-recall.ts` 1, `memory-recall.ts` 1, `anticipatory-recall.ts` 1, `chat-recall.ts`
2, `belief-harvester.ts` 1, `qualitative-identity.ts` 1, `ghost-nick.ts` 1,
`anticipated-questions.ts` 1, `contradiction-injector.ts` 1, `session-distiller.ts` 1,
`objection-injector.ts` 1). [A] This corroborates the fencing claim at the "a call to fenceContent
exists in the file" level — it does **not** prove the call wraps the correct content, fires on
every code path, or that the test suite currently passes end-to-end in CI; this pass did not
execute the tests. Treat "fenced" as source-verified, not runtime-verified, in this report.

Only **2 of the ~14 brain-context-addendum blocks in the array itself** (`brain-context.ts:404-440`)
call `fenceContent` inline (Cross-Session Thread `:428`, and Context Memories `:429` via
`truncateFenced` alone — its `contextMemories` variable is fenced upstream, at its own producer,
per the drift-guard's design principle of "fence at source" `:194`, not at the assembly site) — the
remaining blocks (recall, skills, identity, ghost, qualitative, beliefs, nudges, etc.) are fenced
inside their own producer modules (confirmed above), not in the array literal itself. This is the
intended architecture per the test's own docstring ("fence at source... or allowlist"), not a gap —
flagging only so a future reader does not mistake the array literal's low fence-call count for
under-coverage.

---

## 7. Tool exposure and the approval gate — two separate mutation paths, three approval mechanisms

### 7.1 Catalog -> pruner -> what reaches the model

- **Catalog**: `lib/ai/tools/catalog.ts` (`TOOL_CATALOG`, exported count `TOOL_COUNT =
  TOOL_CATALOG.length`). Measured in this snapshot: **181** `{ name:` entries (`grep -c "^  {
  name:" lib/ai/tools/catalog.ts`); per the app's own `AGENTS.md` this number is meant to be read
  from the file, not pasted as prose, so treat 181 as this-snapshot-only. `tests/ai/tool-catalog.test.ts`
  (referenced in `lib/ai/tools.ts:4-6`) asserts 1:1 alignment between the live `nourTools` object
  and `TOOL_CATALOG`.
- **Aggregation**: `lib/ai/tools.ts` composes `nourTools` from 7 domain barrels
  (`brain`/`tasks`/`business`/`content`/`social`/`system`/`meta`, `:19-31`) wrapped in
  `wrapToolsWithEmptyHandling(rawTools)` (`:98`, not traced further this pass — I — likely
  normalizes empty-result shapes). `tasks.ts` itself sub-aggregates `goals`, `habits`, `missions`,
  `health`, `finance`, `calendar` (verified via import grep — initially looked like dead files
  since they're absent from the top-level 7-barrel list, but each is imported by `tasks.ts:27-32`;
  not dead code).
- **Pruning** (`app/api/ai/chat/prepare-tools.ts:89-95`): `pruneTools(mode, nourTools, userContent,
  userEmbedding, {conversationTail})` — mode-based (quick/standard/deep) plus keyword/semantic
  ranking, bounded by `NICK_TOOL_BUDGET` (default 24, per the file's own comment `:63-65`), fed a
  4-message conversation tail so follow-up turns ("try again", "u sure?") don't lose the tool
  family the conversation needed (`:68-87`).
- **Forced back in, in this exact order** (`:97-163`): (1) `aiConfig.disabledTools` blocklist
  applied first — deleted regardless of mode; (2) `aiConfig.alwaysOnTools` forced in; (3)
  `searchTools`/`invokeTool` recovery lane always forced in — comment states `invokeTool` "runs
  READ-SAFE ones only, so no approval/mutation gate is bypassed" (`:118-123`); (4) the detected
  action-intent's expected tool forced in for `tool_choice` coherence (`:143-152`); (5) web-search
  tools forced in for the same reason (`:155-163`). Each force explicitly respects the
  `disabledTools` blocklist.
- **Read-mode hard strip, LAST** (`:172-182`): only when `actionPermission === "read"`,
  `stripMutatingTools()` (`lib/ai/capability-registry.ts`) removes every tool the capability
  registry marks mutating — fail-closed (a tool with **no catalog entry is treated as mutating by
  default**, per `capability-registry.ts:23`). **This is the only place `actionPermission` changes
  which SDK tools are even callable** — `"draft"` (default) and `"execute"` behave **identically**
  here; only `"read"` does anything. This matches (and gives code-level teeth to) `CURRENT-TRUTH.md`'s
  claim that the permission picker's draft/execute distinction is cosmetic server-side.
- Every turn logs the **final, post-strip** tool set as a `tool.surfaced` metric
  (`prepare-tools.ts:191-211`) specifically so the usage census can distinguish "never surfaced by
  the pruner" from "surfaced and never chosen" — a documented instrumentation fix, not a new gap.

### 7.2 Two structurally different "the model can act" paths

The codebase runs **two independent action-execution mechanisms** on the chat path, and the
task's named files split across them:

**(A) Live SDK tool calls** — the ~181-entry catalog, dispatched by the AI SDK during
`streamText()` itself (mid-stream, synchronously blocking the turn). A tool's `execute:` function
(e.g. `sendTelegram`, `lib/ai/tools/social.ts:16-43`) runs **immediately** when the model calls it
— confirmed by reading the handler body: `sendTelegram`'s `execute` calls the real
`sendTelegram(fullMessage)` service function directly inside `withToolIdempotency(...)`
(`social.ts:32-41`), with **no `checkApprovalGate` or `withGuardian` call anywhere in the
handler**. [A] The only two restraints on this path are (i) whether the tool made it through
pruning/stripping (7.1) and (ii) `withToolIdempotency` (`lib/ai/tools/tool-idempotency.ts`), which
prevents a **duplicate** send on turn re-execution (client auto-regen, manual retry, best-of-2
regen) via a content-hash-keyed marker claimed atomically through `BrainMemory`'s
`@@unique([category, key])` constraint (`tool-idempotency.ts:1-21`) — it does **not** gate the
first send, only repeats of an identical one within a window (5 min for `sendTelegram`, 10 min for
`stageCustomerAlert`). This is a real, well-designed idempotency guard, worth citing as a positive
control against the task's "non-idempotent writes on retry" concern — this particular class of
write is guarded.

**(B) Deferred action blocks** — the model can also emit ` ```action ``` ` fenced JSON or `[ACTION:
{...}]` inline markers in its prose (`parseActions()`, `lib/ai/nick-agent.ts:110-134`, regex-based,
each malformed block silently `catch`-skipped, `:120,131`). These are **not** executed during the
stream — `runDeferredBackgroundWork()` (`lib/services/chat/deferred-background-work.ts:326-331`)
parses and executes them **after the turn has already streamed and persisted**, which is exactly
why `finalize-system-prompt.ts:395-398`'s "ACTION LANGUAGE CONTRACT" forces the model into
attempt-tense wording ("Sending...", not "Sent") for this class of output. `executeAction()`
(`nick-agent.ts:141-...`) calls **`checkApprovalGate(type, params)` before every action**
(`:147`) — this is the **only** call site of `checkApprovalGate` in the entire snapshot (`grep -rn
"checkApprovalGate\(" lib app` returns exactly two hits: the export itself and this one call).
[A] `checkApprovalGate` (`lib/ai/runtime/approval-gate.ts:17-109`) consults
`evaluateToolAction()` (`lib/tools/tool-policy.ts`) for a decision in {allow, deny,
require_approval, require_owner, require_screenshot_approval}; for the gated decisions it looks up
the most recent `ApprovalRequest` row for that `toolId` (query is by `toolId` alone, `:46-54`;
payload-equality is then checked in application code via `JSON.stringify` comparison, `:58-62`,
before treating it as the same request — a fragile-but-functional dedup, sensitive to key-order
differences in an otherwise-equal payload object, not verified to matter in practice) and either
reuses its status or creates a new `pending_approval` row with a 24h expiry (`:85-99`). A
`guardianBypassStorage` AsyncLocalStorage flag (`lib/tools/guardian.ts:31`) can skip the gate
entirely when set (`approval-gate.ts:24-27`) — not traced further in this pass which contexts set
it. [I]

**So: `checkApprovalGate` gates only action blocks (path B), never live SDK tool calls (path A).**
The `HIGH_STAKES_MUTATIONS` set in `route.ts:399-410` (`person.create`, `gmail.sendDraft`,
`telegram.send`, `shop.sendSms`, etc.) are **action-block type strings** handled under
`lib/ai/agent-actions/*.ts` (confirmed: `gmail.sendDraft` -> `lib/ai/agent-actions/google-actions.ts`),
not SDK tool names — so the provider-forcing logic that pins Anthropic for these names
(route.ts §5.4) is making the *emission* of the action block reliable, not gating its *execution*;
the execution-time gate is `checkApprovalGate`, reached only later, in the deferred background
pass, off the SSE stream entirely.

**A third, independent approval pattern exists for customer-facing SMS**, structurally different
from both of the above: `stageCustomerAlert` (`lib/ai/tools/social.ts:45-...`) is itself a **live
SDK tool** (path A), but its handler does not send anything — it creates a `prisma.actionReceipt`
row with `status: "PENDING"` and `action: "shop.sendSms"` and pushes a Telegram message with
approval buttons (`:69-75` onward, not fully read this pass) — a bespoke approval flow using the
`ActionReceipt` table, not `ApprovalRequest`. [A for the tool's existence and its PENDING-receipt
pattern; I did not trace the button-callback handler that flips it to sent in this pass.] Net:
**three distinct "does this need a human to confirm" mechanisms coexist** —
`ApprovalRequest`/`checkApprovalGate` (action blocks only), the bespoke `ActionReceipt`
PENDING-then-approve pattern (at least `stageCustomerAlert`), and no gate at all for lower-risk
live SDK tools like `sendTelegram` (a message to the operator, not a third party). This is not
necessarily wrong — the risk tiers plausibly differ — but it is genuinely three separate code
paths implementing "hold for approval," not one shared implementation, which is worth surfacing
under the task's "duplicate implementations" lens.

---

## 8. Streaming config, persistence, and the post-turn outbox

### 8.1 Per-attempt stream config (`build-stream-config.ts`)

`buildStreamConfigFactory()` (`app/api/ai/chat/build-stream-config.ts:46-384`) returns a
per-fallback-attempt config closure consumed by `streamWithFallback` (§5.4). Confirmed inline,
verbatim:

- **Langfuse wiring**: `experimental_telemetry: langfuseTelemetry({ functionId: "nick-chat",
  privateMode, sessionId: conversationId || undefined, tags: ["nick-chat", mode], metadata: {mode,
  modelId, provider} })` (`:138-144`). The adjacent comment is explicit and precise: "`isEnabled`
  is a REAL gate: true only when the LangfuseSpanProcessor actually started at boot AND the turn
  is not private-mode (spans carry prompt + completion content; private turns never leave the
  process). With no started processor the flag is false and the AI SDK builds no spans at all —
  zero overhead." [A, comment; corroborated by a parallel independent check of
  `lib/observability/langfuse.ts` itself — see the Cost/latency subsection below once that check
  lands.]
- **Step caps**: `stopWhen: stepCountIs(mode === "deep" ? 5 : 3)` (`:202`) — confirms the task
  brief's framing exactly.
- **`toolChoice` ladder** (`:230-311`), most-specific-first, each branch forcing `toolChoice:
  "none"` on the final allowed step so a turn can never end with only tool cards and no prose (the
  documented "silent-tool-turn fix", `:246-253`): python-execute step-0 pin -> web-search step-0
  pin -> generic action-intent `"required"` -> unforced default. **All three forced branches are
  skipped when `actionPermission === "read"`** (`:260`, `:293` — "READ permission... must not be
  contradicted by structural tool forcing"), so read-mode both strips mutating tools (7.1) and
  never forces the model's hand toward calling one.
- **`onChunk`**: captures first-token time once (`__firstTokenRef`) and accumulates `text-delta`
  chunks into `__partialRef.text`, throttle-flushed to `__onPartial` for durable partial capture
  (`:330-341`) — `undefined` under private mode or when no `convId` exists (route.ts:1006-1007).
- **`onError`**: `buildStreamErrorHandler(...)` (`lib/services/chat/stream-error-handler.ts`) —
  the comment states plainly why this exists: "Without this, a mid-stream provider error... causes
  onFinish to NEVER fire — meaning the partial assistant text streamed to the user's screen
  vanishes from history on next reload. Now we capture the partial text + error and write a
  placeholder ChatMessage" (`:343-352`). Also resolves `resolveOnFinish` (same resolver `onFinish`
  uses) so the SSE stream doesn't hang to `maxDuration` after a stream error — "resolving a promise
  twice is a no-op" (`:365-369`).
- **`onFinish`**: `buildOnFinish(...)` from `lib/services/chat/persist-assistant-turn.ts` — the
  full post-stream pipeline, traced next.

### 8.2 Assistant-turn persistence pipeline (`persist-assistant-turn.ts`, 554 lines)

`buildOnFinish()` returns the streamText `onFinish` callback. In order:

1. **Private-mode short-circuit** (`:189-197`): the entire pipeline below is skipped; the only
   action taken is `deps.onWorkComplete?.()` — the comment marks this as a fix for
   "self-review blocker #2": skipping this call used to hang the SSE stream until `maxDuration`
   because the route awaits `onFinishPromise` before closing the stream.
2. **Stream reconciliation**: `reconcileStreamText(event.text, partialRef.text)`
   (`lib/services/chat/reconcile-stream-text.ts`, not opened this pass) compares the AI SDK's own
   final `event.text` against the `onChunk`-accumulated text, logging `stream_text_reconciled`
   with a `relation` field when they disagree and recovering the longer version — a defense
   against AI SDK v6 shapes where the final event's text field under-reports what was actually
   streamed. [A, existence and call site; I did not open `reconcile-stream-text.ts` itself]
3. **Event-text salvage** (`./salvage-event-text.ts`): cascading fallback across
   rawText/reasoningText/content/steps/reasoning array. **Empty guard**: if nothing is salvageable,
   the save is deliberately skipped — "Saving empty content polluted conversation history with
   blank 'Nick is stuck' turns" (`:236-239`). This is the concrete mechanism behind the task's
   "empty content" error-path question.
4. **Sanitizer + image-ghost stripping**: `sanitizeResponse(text)` strips generic-LLM filler from
   the **stored** copy only (the user already saw the raw stream, `:241-245`).
   `validateImageReferences(cleanedText)` strips fabricated `/api/images/<id>` markdown against
   `audit_events`; wrapped in a `try/catch` that **persists the raw, unvalidated text** on a
   validator throw, logged as `image_validator_threw_persisting_raw` (`:277-281`) — a deliberate
   fail-open (don't block persistence on a broken validator), not a silent one (it is logged).
5. **NICK_COVE** (Chain-of-Verification): flag-gated, default off; wrapped in try/catch logging
   `cove_skipped` on failure (`:312-316`) — never blocks the turn.
6. **Output critic + always-on scorecard**: writes a `BrainMemory(category=NICK_QUALITY)` row
   inside `withErrorCapture(..., { timeoutMs: 3_000, silentTimeout: true })` (`:338-372`) —
   `silentTimeout: true` means a scorecard write that exceeds 3s is dropped with **no log line**
   for that specific case (lower stakes than the budget-gate finding in §5.1 since this is a
   quality-metric side-write, not a control gate, but the same shape).
7. **Citations, reply gate, fact-check, known-truth guard**: all four are explicitly documented as
   **telemetry-only on this path** — "the reply is already flushed + persisted; the gate never
   mutates it" (`:385-388`, repeated `:407-414` for the known-truth guard, which the comment notes
   "was pure dead code (only tests/evals called it)" before this wiring). None of these four change
   what the user saw or what gets persisted as the primary text — they log summaries and fold
   results into `tokenUsage` metadata for later reading. Worth flagging precisely: these are
   "guards" in name that do not gate anything on the default streaming path; they are observability
   only, by explicit design (not a bug — the comment is upfront about it), but a reader expecting
   "reply gate" to block bad output will be wrong for this specific code path.
8. **Documented prior fix (kaizen prior art)**: the file explicitly records that a second inline
   `checkClaims()` hallucination-guard call used to run here too, duplicating an expensive LLM
   check "to log a warning it then discarded" — removed to avoid double-invoking it per turn
   (`:420-426`). Cited here as evidence the team already self-audits for exactly the "dead/duplicate
   computation" class this report's lens is looking for; not a currently-live defect.
9. **Tool telemetry walk** (`./tool-telemetry-walk.ts`) -> `recordToolInvocation()`
   (`lib/ai/tool-telemetry.ts:49-131`) — writes to the `ToolTelemetry` Prisma model
   (`prisma/schema.prisma:1609`) via a raw-SQL `INSERT ... ON CONFLICT (tool_name) DO UPDATE`
   (`:67-115`). **This is an aggregate row per tool name** (total_calls, success_count, fail_count,
   `last_errors` capped at 5, a rolling `failure_rate_pct`), not a per-invocation audit log — a
   reader expecting row-per-call granularity from "ToolTelemetry" will not find it there. Failures
   here are caught and logged (`logError` + `console.warn`, `:122-129`) but never thrown — "must
   never break chat." A tool-level circuit breaker (`recordToolSuccess`/`recordToolFailure`) also
   updates from this same call, not traced further this pass.
10. **Critical-path persist** (`./persist-assistant-message.ts`): creates the `ChatMessage` row.
    Race-safety confirmed: "dedup guard (app-level check + P2002 DB backstop)" — a partial unique
    index shipped 2026-07-11 so "a concurrent onFinish that loses the race now gets P2002"
    (`:135-138`, `:430-436` per grep) — a genuine, well-designed idempotent-insert guard against
    the exact "non-idempotent write on retry/race" class this audit's lens looks for. **Positive
    finding**, not a gap. Both of `persistAssistantMessage`'s "skip" outcomes still resolve
    `onWorkComplete` — the file notes this was itself a bug once ("pre-existing quirk flagged in PR
    #1064"): both skip paths used to return without resolving the promise, holding the SSE stream
    open until `maxDuration` (120s) on a duplicate-reply or empty turn (`:472-481`). Another
    documented, already-fixed instance of the same defect shape.
11. **Post-persist verification** (`./post-persist-verification.ts`): `trackGeneration` (writes
    `AiGeneration` — cost/tokens/duration/status per turn, per `docs/ARCHITECTURE.md`'s
    Observability table), `recordTrace` (finalizes the `AgentTrace` row minted at `route.ts:262-263`
    via `mintTraceId()` at turn start), claim-verifier checks, and "L2 fabrication rewrite + row
    patch." **Note on the fabrication-defense L2 label**: `apps/statenour/AGENTS.md`'s own table
    calls L2 "pre-persist rewrite" (`lib/ai/chat/fabrication-rewriter.ts`), but the traced call
    order here is persist-first (step 10 creates the row) then post-persist-verification (step 11)
    patches it — i.e. in the live `onFinish` flow, L2 executes as a **post-persist UPDATE**, not a
    pre-persist rewrite. [H — I did not open `post-persist-verification.ts` or
    `persist-assistant-message.ts` in full to confirm whether an earlier, separate pre-persist
    fabrication check also runs inside step 10's "honesty banners" sub-step (the persist-assistant-
    message.ts module comment does mention "SDK-receipt honesty banner, flag-gated known-truth
    banner" as part of its own work, which could be the actual pre-persist half) — flagging as a
    naming-vs-order discrepancy worth a closer look, not asserting a functional bug.]
12. **Post-turn outbox enqueue, inline run, complete** (`:518-552`) — traced in full below.

### 8.3 Post-turn outbox — durable, DLQ-capable, race-safe (`post-turn-outbox.ts`, 263 lines)

Confirmed **inline-first, durability-added** design exactly as the module header states
(`:1-18`): `enqueuePostTurnWork(ctx)` writes a `PostTurnOutbox` row (payload capped to the last 20
messages, `MAX_PAYLOAD_MESSAGES = 20`, `:24-58`) **before** `runDeferredBackgroundWork()` runs
inline; `completePostTurnWork(id)` marks it `done` only on inline success
(`persist-assistant-turn.ts:545-550`). A crash between enqueue and complete strands the row at
`pending`, or at `processing` if a drain had already claimed it.

- **Kill switch / gate, per row kind**: the table is shared by two `kind` values —
  `OUTBOX_KIND.deferredBackground = "deferred-background"` (always-on, every chat turn) and
  `OUTBOX_KIND.agentFollowUp = "agent-followup"` (added 2026-08-28). The comment at `:106-113`
  documents a **near-miss**: the `kind` column existed with a default since 2026-07-25 but nothing
  filtered on it, so the drain "claimed EVERY kind and ran it through
  `runDeferredBackgroundWork`" — harmless while only one kind existed, but "becomes a silent
  mis-execution the moment a second appears," which is exactly what happened when
  `agent-followup` rows were added; the filter fix is what makes today's behavior correct. This is
  the same "the code looked right but the invariant only held by coincidence" shape flagged
  elsewhere in this report (§5.4's cost-firewall coupling).
- **Trigger**: `app/api/cron/outbox-drain/route.ts` (`GET = cronHandler(...)`, `:26`) — runs under
  the standard `cronHandler` wrapper (`CRON_SECRET` auth + `isCronEnabled()` kill-switch +
  `CronJobLog` write, per `docs/ARCHITECTURE.md`'s cron-orchestration section).
- **Claim mechanics** (`claimOrphans`, `:119-169`): atomic via `updateMany` status-flip-as-lock (a
  losing concurrent drain matches zero rows, `:148-155`) over two OR branches — `pending` rows
  older than a 10-minute grace window **honoring `nextAttemptAt`** (`OUTBOX_ORPHAN_GRACE_MS`,
  `:28`, `:134`), and `processing` rows stale for 30+ minutes (`OUTBOX_PROCESSING_STALE_MS`,
  `:104,125,136`) — the second branch is explicitly the fix for "pre-fix these rows were stranded
  FOREVER — claims only ever looked at `pending`" (`:100-103`), matching agent-memory's
  `statenour-adoption-gates` note about stale-claim reclaim being a 2026-08-27-era fix.
- **Retry/DLQ**: `OUTBOX_MAX_ATTEMPTS = 5` (up from 3, "WP-8 · 2026-07-29", `:29-31`), capped
  exponential backoff with full jitter (`outboxRetryDelayMs`, 5min base doubling to a 60min cap x
  a `[0.5, 1.5)` random factor, `:34-49`) so a wave of simultaneous failures doesn't
  thundering-herd the next drain. Exhaustion transitions a row to `status: "dead"` (`finishClaim`,
  `:174-204`) — legacy rows from before 2026-07-29 used the name `failed` and are treated
  identically by `getOutboxHealth`/`redriveDeadOutboxRows` (`:206-208`). One-tap redrive resets
  `dead`/`failed` rows to `pending` with `attempts: 0` (`:250-263`).
- **Idempotency of the replay itself**: the module header states the deferred-work phases are
  "individually `withErrorCapture`-bounded and idempotent-or-harmless on replay (upserts, dedup
  guards, fire-and-forget audits), so a rare double-run after a crash is safe" (`:14-17`) — I did
  not independently re-verify every phase's idempotency in this pass; treat as [H] backed by a
  clear design statement, not a phase-by-phase audit.

**Follow-ups kill switch, layered** (matches the task's "trigger + kill switch each" ask): the
`agent-followup` outbox kind and its cron (`app/api/cron/agent-followups/route.ts`) are gated by
`NICK_AGENT_FOLLOWUPS` in **two independent places** — the cron entry point returns `{ skipped:
true, reason: "NICK_AGENT_FOLLOWUPS is not set — feature is off" }` when unset
(`agent-followups/route.ts:40`), and the follow-up generator itself re-checks the same env var and
refuses independently (`lib/agent/follow-up.ts:76,131`, `refuse("disabled", ...)`) — a genuine
double-gate, not a single point of failure, consistent with `.remember/now.md`'s note that three
separate switches (env var, per-cron kill switch, and jobs.ts wiring) must all be true "before a
single unprompted message can fire."

**Mission link — not found in the traced chat pipeline this pass.** `lib/db/conversation-mission-
linker.ts` exists as a module, and the app's own `AGENTS.md` names it as a reader of
`isInboxMission()`, but `grep -n "mission" lib/services/chat/deferred-background-work.ts` returns
no matches — the post-turn background phases I traced (content-feedback, hallucination check,
friction tracker, outcome-calibration predictions, journal ingest, people-intelligence,
conversation-memory summary, auto-rename, action-block execution, suggestion-cache warm) do not
include a mission-linking step. [I] Either mission linking is triggered elsewhere (e.g. at
mission-creation-tool time rather than as a post-turn chat phase) or it is not wired into this
pipeline at all — not resolved in this pass; naming it explicitly rather than silently omitting it.

---

---

---

## 9. Streaming protocol: cancel, resume/tail, retry, edit — no true branching

### 9.1 Cancel is client-local; the server keeps working

`chat.stop()` (AI SDK `useChat`) only abandons the **client's own reader** — the comment at
`features/chat-v2/hooks/use-chat-stream.ts:295-310` states this explicitly while explaining why
the stall-recovery action is "Reconnect" (`resumeStream()`) and never `regenerate()`: "`chat.stop()`
abandons only the CLIENT reader — route.ts calls `result.consumeStream?.()` and guarantees the
turn completes and persists after the client disconnects." [A] Confirmed server-side:
`route.ts:1152`, `result.consumeStream?.()`, called unconditionally right after the stream response
is built, with the comment "the full pipeline — onFinish, persist, receipts — completes even when
the client disconnects mid-stream (the documented ai@6 pattern: consumeStream removes backpressure
from the response reader)." A client-visible "cancel" therefore never stops the model call, the
tool calls it may make, or the persistence/outbox pipeline — it only stops the browser from reading
further bytes. This matters directly for the idempotency story in §7.1/§7.2: a tool side effect
that already fired before a user taps "stop" is not undone by stopping.

### 9.2 Resume/tail — Postgres-backed, not Redis, by deliberate choice

The durable-resume registry (`lib/services/chat/active-stream.ts`, 263 lines) stores state as
`BrainMemory(category="active_chat_stream", key="stream:<convId>")` rows — reusing the general
memory model rather than a dedicated table ("no DDL," `:12-13`). Two generations:

- **V1** (2026-07-29): `registerActiveStream`/`completeActiveStream` mark a turn active/complete;
  a reconnect after completion replays the **persisted** `ChatMessage.content` verbatim (never
  re-runs the model) via `findAssistantMessage()` + `streamOut()`
  (`app/api/ai/chat/[conversationId]/stream/route.ts:69-75,185-218`).
- **V2** (2026-08-28): live partial-tail. `onChunk` (build-stream-config.ts, §8.1) already
  accumulates every delta in-process (`__partialRef`); V2 durably flushes that accumulator via a
  throttled `createPartialPersister` (2s floor, `active-stream.ts:63,136-155`) into the row's
  `metadata` field — **deliberately never `content`** (`:30-38`): the header comment ties this
  directly to the 2026-07 memory-consolidation incident documented in
  `docs/CHAT-PIPELINE-STUDY-2026-08-27.md` (curated `pm_*` rows silently eaten by `mergeMemories()`)
  — writing multi-KB assistant prose into the recall-readable `content` column would reintroduce
  that risk on "a single numeric coincidence" (the row's fixed 0.1 confidence sitting under the
  0.3 recall floor). The category is additionally listed in both `RECALL_EXCLUDE_CATEGORIES` and
  `CONSOLIDATION_EXCLUDE_CATEGORIES` as a second, independent guard. This is a precise, verified
  cross-reference between the two source documents the task asked to read and the live code —
  the design explicitly learned from a documented prior incident. [A]

**GET `/api/ai/chat/[conversationId]/stream`** (`route.ts`, 218 lines) is what the client's
`X-Resume-Partial: 1`-triggered re-resume (use-chat-stream.ts:98-104, §composer section) actually
hits. Contract, verified by reading the full handler: 204 when there is nothing to resume (no
active record, sentinel `conversationId === "none"`, or zero accumulated partial bytes — an empty
resume bubble is explicitly avoided, `:78-82`); a completed turn replays the canonical persisted
row; an in-flight turn opens a live poll loop (`POLL_MS = 500`, bounded by `MAX_WAIT_MS = 20_000`,
`:44-50`) that emits new deltas as they land and closes cleanly with one of two distinct
end-of-tail markers embedded directly in the message text (not just a header, because "a header
can be dropped by a proxy or ignored by a future client; bytes in the bubble cannot," `:152-158`):
"_(still generating — reconnecting for the rest...)_" when the poll window simply expired, or
"_(reply was revised after this point — reload to see the final version)_" when the persisted
content no longer matches what was already streamed (divergence check at `:119-137`,
`message.content.startsWith(emitted)`). **The divergence path exists specifically because the
persisted row can differ from the raw streamed bytes** — the comment names the cause directly:
"the raw deltas (L2 fabrication-rewriter prepends a banner pre-persist)" (`:112-114`). [A] This
confirms — and refines — the §8.2 point 11 hedge above: the L2 banner-prepend is a **pre-persist**
step (consistent with `apps/statenour/AGENTS.md`'s own table naming), and whatever
"post-persist-verification... row patch" does (§8.2 point 11) is evidently a **separate, later**
rewrite path, distinct from the initial L2 banner. This report did not open
`post-persist-verification.ts` to identify exactly what that second patch is — flagged as an open
question, not resolved here [I].

`export const maxDuration = 30` on this resume route (`:42`) vs `120` on the main chat route
(`route.ts:47`) — both are Vercel/serverless-runtime constructs that `docs/CURRENT-TRUTH.md`
states are "inert on Railway" (the app's actual production host, confirmed by
`apps/statenour/AGENTS.md`'s repo topology table). The resume route's own `MAX_WAIT_MS = 20_000`
is chosen specifically to sit **under** `maxDuration` so "the route returns its own honest
terminator instead of being cut off mid-stream by the platform" (`:45-49`) — a correct and
reasonable bounded-poll design on its own terms, but its *stated* justification (defending against
a platform-enforced cutoff) does not apply on Railway per the project's own current-truth doc. Not
a functional bug — the 20s bound is doing useful, independent work regardless of platform — but
the comment's threat model does not match the documented deployment target.

### 9.3 Retry — auto and manual, both idempotency-aware

- **Auto-retry on network failure** (`use-chat-stream.ts:213-268`): only fires when the last
  assistant turn produced **no tool parts** (`hadToolPart` check, `:242-247`) — "a tool may have
  committed a real side effect... before the stream dropped. Auto-regenerating re-runs the turn and
  re-fires the tool = duplicate action." Also skipped for image-generation prompts (a "deterministic
  server fast path, not a safe model regeneration," `:255-259`) and for a turn sent under Private
  Lab once that mode is later turned off (`:260`, and `safeRegenerate` itself blocks this case with
  a toast, `:180-188`). Backs off `1500ms * retryCount`, capped at 2 attempts (`:262-266`).
- **Manual stall-recovery** (`use-chat-stall.ts` + the toast action in `use-chat-stream.ts:296-310`)
  is explicitly **"Reconnect" (`resumeStream()`), never "Retry"/`regenerate()`** — the comment spells
  out why in detail: a regenerate would start "a SECOND execution against a first that is still
  running: at best two competing assistant turns, at worst a mutating tool fired twice — and this
  chat can invoke `gmail.sendDraft`, `telegram.send` and `shop.sendSms`" (route.ts's
  `HIGH_STAKES_MUTATIONS`, §5.4). This is a deliberate, well-reasoned design choice protecting
  exactly the risk this audit's lens looks for.

### 9.4 "Branch/edit/replay" — edit exists, replay exists (§9.2); there is no branch

Traced the composer's "Edit and resend" action (`features/chat-v2/components/chat-composer.tsx:
128-159`, wired from the message action sheet and per-message edit button in
`chat-message-list.tsx:162-163,519,590`): editing an earlier user message **is destructive, not a
fork**. On save it (1) truncates the **client-side** message array at the edited index
(`chat.setMessages(prevMessages.slice(0, idx))`, `:143`), (2) cascade-deletes the message
**server-side** (`deleteMessageMutation.mutateAsync({messageId: editId})`, `:145`, comment names
the underlying operation `deleteMessageCascade` — implying every message after the edit point is
deleted too, not just the edited one), then (3) falls through to a normal send that regenerates
from that point. [A] **There is no conversation-branch/fork concept anywhere found in this pass** —
editing message N permanently removes every message after N; the only way to see the pre-edit
continuation again is if it was never actually deleted (it is). On a failed cascade-delete, the
code correctly rolls back the client-side truncation and restores the draft with a loud error toast
(`:150-158`) — so the failure mode is safe, but the success path is a one-way destructive rewrite,
not a branch. Grep corpus for the absence claim: `grep -rn "branch" features/chat-v2 components/chat
hooks/chat` (this pass) surfaces no conversation-forking code, only the unrelated `stillGenerating`
divergence-branch language in the resume route already covered above, and CSS/layout uses of the
word "branch" were not found either — treat this as a scoped, not exhaustive, absence check. [A for
the "Edit and resend" mechanism itself; I for whether a fork/branch feature exists somewhere
entirely outside `features/chat-v2`, `components/chat`, and `hooks/chat` — not searched.]

---

## 10. Model IDs, escalation, and cost/latency telemetry

*(This section's findings were gathered by a delegated sub-agent scoped to exactly these two hops,
then spot-checked directly against source by the orchestrating pass — three of its citations
(`config/ai-providers.ts:52` ollama default, `effort-policy.ts:7` "wired to NO live path yet" +
its dead `routeCapability()`, and `lib/observability/langfuse.ts:79,151`
`isLangfuseTelemetryEnabled`) were independently re-read and confirmed accurate. Citations below
are presented as verified [A] on that basis.)*

### 10.1 Model IDs and lanes

The literal model-id strings live in `config/ai-providers.ts:40-171` (`PROVIDERS_REGISTRY`), not
in `lib/ai/provider.ts` itself (which imports from it) — `docs/CURRENT-TRUTH.md:182`'s pointer to
"`lib/ai/provider.ts`" as *the* source of truth is one hop short of where the ids actually live.

| Provider | Default model id | Override env | Cost class |
|---|---|---|---|
| ollama | `"deepseek-v4-pro"` (`config/ai-providers.ts:52`) | `OLLAMA_MODEL` (fast lane: `OLLAMA_FAST_MODEL`, e.g. `glm-5.2`) | `zero_incremental` |
| gemini | `"gemini-3.5-flash"` | `GEMINI_MODEL` | `metered` |
| openai | `"gpt-4o"` | `OPENAI_MODEL` | `metered` |
| anthropic | `"claude-sonnet-5"` | `ANTHROPIC_MODEL` | `metered` |
| openrouter | `"x-ai/grok-4.3"` | `OPENROUTER_MODEL` | `metered` |

All 12 declared `TaskType`s route through the **identical** provider order
(`TASK_ROUTING_PREFERENCES`, `config/ai-providers.ts:157-170`: ollama -> openrouter -> gemini ->
openai -> anthropic) — the taxonomy differentiates model-id resolution per task, not provider
ordering; a minor kaizen observation (an elaborate 12-value enum feeding one uniform ordering
table), not a defect.

**Escalation lane model ids** (`lib/ai/vnext/effort-policy.ts:40-44`,
`CLAUDE5_MODELS = { fable: "claude-fable-5", mythos: "claude-mythos-5", opus: "claude-opus-5" }`):
`resolveEscalation()` (`lib/ai/vnext/escalation.ts:121-192`) assigns `.opus` for a `/deep`/`/thorough`
tier (effort `"high"`), `.fable` for `/mega` (effort `"max"`) and also `.fable` for any untrusted-input
turn regardless of tier (effort `"high"`). Live-wired: `route.ts:449` calls `resolveEscalation()`;
`:505-507` and `:1020-1022` thread `__escalation.model` into `getModel()`'s `modelOverride`.

**Dead computed model id — `"claude-mythos-5"` is a string in reachable code that no live path ever
selects.** `resolveEscalation()` only ever assigns `.fable` or `.opus`; `.mythos` is only *assigned*
inside `routeCapability()` (`effort-policy.ts:95`), a function whose own header comment states it
is "wired to NO live path yet" (`:7`). Confirmed by grep: `routeCapability(` has zero production
callers — only `effort-policy.ts` itself and two test files (`tests/ai/vnext/effort-policy.test.ts`,
`tests/ai/vnext/golden-signals.test.ts`). Positive control for the grep methodology: the same
search for `resolveEscalation(` finds the real caller at `route.ts:449` plus its own test, proving
the search finds genuine call sites when they exist. `claude-mythos-5` also appears defensively
inside `countEscalationsToday()`'s count query (`escalation.ts:275`), but nothing ever produces a
row with that value today.

**A live discrepancy between CURRENT-TRUTH.md and the code's own fallback default.**
`docs/CURRENT-TRUTH.md` states (in its "Since 2026-08-16 — chat quality" section) that
"**Model pins: `minimax-m3` is correct**... `deepseek-v4-pro` is **DEAD** (retired upstream
mid-session)." But `config/ai-providers.ts:52`'s hardcoded `defaultModel` for ollama is still
literally `"deepseek-v4-pro"` — the same id CURRENT-TRUTH later calls dead — with the file's own
comment (dated 2026-07-15, older than that CURRENT-TRUTH entry) explicitly labeling it "the
env-less fallback" for when `OLLAMA_MODEL` is unset. [A for both facts independently; the
reconciliation is direct — I did not verify what the live Railway `OLLAMA_MODEL` env value
actually is, so this is not a claim that production is currently calling a dead model, only that
the code's own committed fallback, if it were ever the effective value, would be. Per
`docs/CURRENT-TRUTH.md`'s own stated hierarchy, "a `.env` file is NOT evidence of production
config," and this snapshot contains no env values at all — this finding is scoped to the
**source-level default drifting stale relative to the project's own current-truth doc**, which is
itself a real, citable maintenance gap regardless of what Railway currently has set.]

**Venice/deepseek retirement — precise sourcing correction.** Venice is confirmed retired at the
**code** level (`lib/ai/provider.ts:5-7` comment: "Venice retired — removed from the runtime
PROVIDERS list"; `RUNTIME_PROVIDERS` omits it; `isVeniceAvailable()` hardcodes `return false`).
`docs/CURRENT-TRUTH.md` itself does **not** contain an explicit "Venice is retired" sentence
anywhere — it mentions "Venice" exactly once, as a "don't hardcode this" example. Citing this
precisely because conflating "the doc says X" with "the code says X" is exactly the kind of
sourcing error this audit's discipline exists to prevent.

### 10.2 Langfuse and cost/latency telemetry — verified, with one structural coverage gap

**Private mode is a real on/off gate, not a redaction.**
`isLangfuseTelemetryEnabled(privateMode)` (`lib/observability/langfuse.ts:79-81`) returns
`state().status === "started" && !privateMode`; `langfuseTelemetry()` (`:142-152`) sets
`experimental_telemetry.isEnabled` directly from that boolean. A private-mode turn therefore builds
**no spans at all** — confirmed at the definition, not just inferred from the call-site comment
quoted in §8.1. Separately, `maskLangfuseData()` (`:184-187`) applies a `SECRET_RE` regex (matching
`sk-`/`pk-`-prefixed keys and `Bearer <token>`) to every exported span via the
`LangfuseSpanProcessor`'s `mask` callback (`:229-233`) — broader than "prompt/completion only," it
scrubs secrets out of whatever content does get exported on non-private turns.

**`recordInputs`/`recordOutputs` are absent everywhere** — grep for `recordInputs|recordOutputs`
across the whole snapshot: zero matches. Positive control: the same corpus grepped for
`experimental_telemetry` returns 16 files with real call sites, so the empty result is meaningful.
Per AI SDK v6 semantics both flags default to `true` when absent [H — standard documented SDK
behavior, not re-verified against the installed package source in this pass] — so **prompt and
completion text is exported to Langfuse for every non-private-mode AI SDK call**, confirming the
task brief's premise exactly.

**Coverage is enforced by a real drift-guard test, not just convention.**
`tests/observability/ai-sdk-telemetry-gate.test.ts` statically scans every `.ts(x)` file for the
four AI SDK generation functions (`generateText`/`streamText`/`generateObject`/`streamObject`) and
asserts each call site is either wired to `langfuseTelemetry()` or explicitly allowlisted (2
entries: a 1-token health-probe in `lib/ai/structured.ts`, and `lib/ai/stream-with-fallback.ts`
itself, which is allowlisted because it *spreads* a config object that
`build-stream-config.ts:138` already built with `langfuseTelemetry()` inside it — a separate test,
`tests/ai/chat/build-stream-config-telemetry.test.ts`, pins that indirection). The test's own
header records the gap it closed: **"20 of 22 AI SDK call sites carried no `experimental_telemetry`
at all — only nick-chat was traced"** before this gate shipped — i.e. Langfuse coverage across the
non-chat AI surfaces (side-pane-chat, page-insight, weekly-review cron, the Telegram webhook,
deep-reasoning, image-prompt synthesis, brain contextual-retrieval, home-brief/intelligence
pipeline) is itself a fairly recent fix, not a long-standing property.

**Structural gap: image generation is invisible to this instrumentation by construction, not by
omission.** `lib/ai/gemini-image.ts`'s `generateImageWithFallback` (Replicate FLUX -> Gemini ->
OpenRouter, per `apps/statenour/AGENTS.md` §5) contains zero matches for any of
`generateText|streamText|generateObject|streamObject|experimental_telemetry` — the same grep
pattern that finds real hits elsewhere, so this is a meaningful empty result, not a broken search.
Image *prompt synthesis* (the text step that writes the prompt) is traced via
`image-prompt-synth.ts`; the actual pixel-generation call is a direct `fetch`-based integration
outside the AI SDK's four generation functions entirely, so Langfuse — which only hooks
`experimental_telemetry` on those four — cannot see image-generation cost/latency at all by this
mechanism, regardless of how complete the drift-guard's coverage of AI-SDK call sites is.

**`ToolTelemetry` located precisely** (closing the task's open item): `prisma/schema.prisma:1609-1629`
defines it as a typed, per-tool-name aggregate (`toolName @unique`, `totalCalls`, `successCount`,
`failCount`, `totalDurationMs: BigInt`, capped `lastErrors` JSON, `lastCallAt`) — matches and
confirms the direct read of `lib/ai/tool-telemetry.ts` in §8.2 point 9 above. Its own header
comment adds one more fact worth recording: it **superseded an earlier JSON-blob UPSERT
approach** ("JSON-blob UPSERT removed - all writes now go to the typed table") — i.e. this table
was itself a kaizen migration away from a less-structured predecessor. Consumed by
`components/brain/tool-telemetry-panel.tsx` (an operator UI surface) and `scripts/probe-tool-usage.mjs`.

**Other per-turn writes, confirmed present, not re-traced in depth**: `AiGeneration` cost tracking
(`lib/ai/track.ts`, holds a `MODEL_COSTS` per-1M-token rate table) and `AgentTrace`
(`lib/ai/agent-trace.ts`) both exist as described in the task brief and in §5.4/§8.2 above.

---

## 11. Attachments — images, PDF, audio intake

*(Gathered by a delegated sub-agent scoped to this hop; the orchestrating pass independently
spot-checked and confirmed four load-bearing citations — `lib/media/attachment-policy.ts:52`
(`MAX_BYTES_BY_KIND`), `:67` (`UPLOAD_LANE_KINDS = []`), `:152` (the video-refusal string, matched
verbatim), and `config/retention.ts:25-26` — all confirmed accurate against source. Presented below
as verified [A] on that basis, with the sub-agent's own [H]/[I] hedges preserved.)*

**Intake gate**: all three surfaces (file-picker, drag-drop, paste) in
`hooks/use-image-attachment.ts` funnel through one `acceptFile()` (`:44-57`), which calls
`decideAttachment()` (`lib/media/attachment-policy.ts:133-174`) — this is the shared gate the
app's own docs describe. It classifies by MIME then extension, rejects unknown types and 0-byte
files, and rejects video outright with a verbatim, verified-live message: "Video attach is disabled
— the upload backend was retired (it never worked). Audio, images and PDFs still attach; video
needs a storage backend first." (`:152`) — matches `docs/CURRENT-TRUTH.md`'s VideoDB-retirement
section precisely.

**Size limits are client-side only.** `MAX_BYTES_BY_KIND` (`:52-59`): image 10MB, audio 8MB, pdf
8MB, video 500MB (moot — video is refused before the size check ever runs). No matching
byte-size constant exists in `app/api/ai/chat/route.ts` itself (positive control: the sibling
`app/api/ai/chat/audio-transcribe/route.ts:38` *does* define `MAX_BYTES = 25 * 1024 * 1024`,
proving the search methodology finds real limits where they exist) — a request that reaches
`/api/ai/chat` directly, bypassing the composer, has no server-side attachment-size gate on this
route. [H for the "bypassing the composer" threat model itself — the route is still session-gated,
so this is a self-inflicted-payload concern more than an external one, given the single-operator
design noted throughout this codebase.]

**Where the bytes live — no blob store.** Every accepted kind takes the same inline lane
(`UPLOAD_LANE_KINDS` is an empty array, `:67`, so `laneFor()` always returns `"inline"`). The file
is read client-side via `FileReader.readAsDataURL` and embedded directly as a `data:<mime>;base64,...`
URL inside the message part. `persistUserTurn()` then writes that same base64 blob **twice per
row** — once into `ChatMessage.parts` (Json) and once into the legacy `ChatMessage.attachments`
(Json) column, "kept for back-compat" per its own comment. There is no S3/blob store anywhere on
this path — attachments live entirely as base64 inside Postgres JSON columns, duplicated.

**PDFs are never parsed on the composer path — a structurally different lane than the doc names
suggest.** `pdf-parse`/`mammoth` (via `lib/integrations/document-parser.ts`) are only reachable
through `ingestDocument()` (`lib/services/document-ingest.ts`), whose only production caller is
the model-invoked tool `ingestDocumentFromUrl` (`lib/ai/tools/system.ts`) — which fetches an
**external URL**, not a composer attachment. A PDF attached in chat is passed straight through as
a raw multimodal `{type: "file", data: <base64>, mediaType}` block to whichever provider is active
— never text-extracted, never chunked into `vector_embeddings`, never touched by `pdf-parse` at
all. Whether every configured provider can actually consume a PDF file-part usefully is not
verified in this pass [I].

**Fencing does not apply to the live attachment path — by construction, not omission.**
`fenceContent()` wraps the `searchDocuments` **tool's** results (the RAG path over
`ingestDocumentFromUrl`-ingested content) but is never called anywhere in the composer/
attachment-policy/message-fields/build-model-messages files — because the inline attachment never
becomes extracted text; it stays a native file part sent directly to the provider. The task
brief's "fence attachment text" framing does not have a target on this specific lane: there is no
extracted text to fence in the live intake path.

**Silent failures found**: `lib/services/document-ingest.ts:91-93` (a meta-row `BrainMemory.create`
failure swallowed via a bare `.catch(() => { /* non-fatal */ })`, no log — inconsistent with a
`log.warn` a few lines away in the same file for the vector-column write) and `:130-134`
(per-chunk embed/store failures inside the ingest loop caught with an empty `catch {}` and only a
comment — a document that fails to embed every chunk silently produces `chunkCount: 0` with zero
diagnostic trail). `hooks/use-image-attachment.ts:157` discards the real `FileReader.onerror`
detail, surfacing only a generic client toast with nothing logged server-side.

**Stale doc reference**: `lib/integrations/document-parser.ts:43` cites an upload-cap enforced by
`/api/ai/chat/documents` — no such route exists anywhere under `app/api/ai/chat/**` or
`app/api/chat/**` in this snapshot (confirmed via directory listing, positive-controlled against
the export route which *was* found by the same search).

## 12. Conversation model — threads, titles, search, export, delete, retention

**Thread creation**: `persistUserTurn()` (`lib/services/chat/persist-user-turn.ts:54-112`) creates
a `ChatConversation` lazily, inside one `prisma.$transaction` together with the first message
(`:198-223`) — explicitly to avoid an orphaned empty conversation if the process crashed between
two separate awaits. Title seeds to the first 80 characters of the first message.

**Titles / auto-rename**: `lib/chat/auto-rename.ts`'s `maybeAutoRename()` fires **once ever** per
conversation, gated by a minimum message count (4) and an `AuditEvent(eventType:"chat_renamed")`
marker so it never re-fires. **It is itself an AI call** (`aiChat(..., "classify")` via a traced
wrapper) — fire-and-forget from `deferred-background-work.ts`, wrapped in
`withErrorCapture(..., {timeoutMs: 15_000, silentTimeout: true})` (the same `silentTimeout: true`
shape flagged for the quality-scorecard write in §8.2 — a third instance of this specific
timeout-swallow pattern in the codebase, worth naming as a recurring idiom rather than three
unrelated incidents). An in-memory `inFlight` Set specifically dedupes two concurrent
fire-and-forget rename calls racing each other on the same conversation — a targeted, deliberate
idempotency guard.

**Search**: tRPC `chat.search` (`lib/trpc/routers/chat.ts`) runs a raw-SQL `tsvector`/
`plainto_tsquery` query against `chat_messages.searchable_tsv`. A header comment in that file
claims a REST alias "`GET /api/chat/search`" exists — it does not, in this snapshot (confirmed via
directory listing); the tRPC procedure is the only live entry point. Doc/comment drift, not a
functional gap.

**Export** (`app/api/chat/export/[conversationId]/route.ts`): auth is `requireSession()` only, no
per-conversation ownership filter — consistent with the schema (`ChatConversation` has no
`userId` column at all; single-tenant by construction, so this is not a cross-tenant leak risk).
Two formats: `md` (tool-call names + durations only, reasoning fenced behind `?include=reasoning`)
and `json`, which dumps `{role, content, model, tokenUsage, createdAt}` **verbatim per message,
including the full `tokenUsage` Json blob** — the JSON export surface is wider than the markdown
one for the same conversation. Neither format includes `parts`/`attachments`, so exported files
never carry attachment base64 bytes.

**Delete — hard delete, not soft.** `lib/services/chat-conversation.ts`: `deleteConversation()`
calls `prisma.chatConversation.delete(...)` directly (its own comment: "Hard-delete a
conversation"); **any** delete error, including a genuine DB-connection failure, is swallowed
identically via `.catch((): null => null)` so the function **always returns `{ok: true}`** —
confirmed verbatim against source. A caller cannot distinguish "deleted" from "the delete silently
failed." `ChatConversation` has no `deletedAt` column at all (full model read) — there is no soft
path, only this one hard one. Gated by `operatorProcedure` (owner-only) in the tRPC router.

**Cascade / orphan behavior on delete — verified against the full schema, not inferred:**
`ChatMessage.conversation` carries `onDelete: Cascade` — messages are removed by the DB foreign
key, not application code. Every other model this report has traced as chat-adjacent has **no**
FK to `ChatConversation` at all:
- `ActionReceipt` has no `conversationId` field of any kind — only `missionId`; it was never
  linked to chat, so the "does it orphan" question doesn't structurally apply.
- `AgentTrace` has no `conversationId` field either — no FK, no loose id column, only a free-form
  `metadata Json?`.
- `BrainMemory` has no `conversationId` field — it has its own independent `deletedAt` soft-delete
  unrelated to conversation lifecycle.
- `AiGeneration`, `ToolVerbRatio`, and `IntelligenceOutcome` each carry a **bare, non-FK**
  `conversationId String?` column — so deleting a conversation silently orphans every row these
  three models wrote against it (no cascade, no error, no cleanup — the rows simply reference an
  id that no longer resolves to anything).

Net: deleting a conversation cleans up exactly one table (`ChatMessage`, via DB cascade) and
silently strands loosely-referenced rows in at least three others. This is a genuine, precise
"orphan on delete" finding, not a hypothetical — verified against the live schema for every model
this report names elsewhere.

**Retention: chat history is explicitly kept forever, by declared policy, not by omission.**
`config/retention.ts:25-26` lists both `ChatMessage` (`days: "forever", enforcedBy: "none"`, "the
brain's primary training signal") and `ChatConversation` (`days: "forever", enforcedBy: "none"`,
"conversation headers must outlive any of their messages"). Independently confirmed:
`app/api/cron/data-cleanup/route.ts` never references `ChatMessage`/`ChatConversation` (positive
control: the same file *does* reference `AgentTrace`/`SystemMetric`/`ErrorLog`, proving the search
finds real matches where they exist) — the cleanup executor genuinely never touches chat tables,
matching the declared policy exactly.

---

## 13. Error paths — consolidated

Every distinct failure mode found on the chat path in this pass, with its exact surfaced behavior:

| Failure | Where caught | HTTP / signal | User-visible text | Class |
|---|---|---|---|---|
| Rate limit (10/min/IP, checked twice — §5.1) | `route.ts:60-61`, `gate.ts:122-134` | 429 | `"AI rate limit exceeded"` / `"Rate limit exceeded"` (two slightly different strings from the two checks) | A |
| Power-panel budget cap | `gate.ts:147-164` | 429 | `"Nick paused by power panel"` + reason | A |
| Malformed JSON body | `gate.ts:168-175` | 400 | `"Invalid JSON"` | A |
| Message array shape (not 1-200 items) | `gate.ts:177-183` | 400 | `"Invalid messages"` | A |
| Daily $ budget cap (`assertWithinBudget`, §5.1 — fails open **silently** on its own exception, see below) | `route.ts:340-357` | 402 | `"Daily AI budget reached ($X of $Y)..."` | A |
| No provider configured at all | `route.ts:519-525` | 503 | `"Nick AI is not available right now. No AI provider configured..."` | A |
| Empty/unsalvageable model output | `persist-assistant-turn.ts` event-text salvage, §8.2 | n/a (stream still completes) | assistant row is **not saved**; nothing renders as a new turn | A |
| Mid-stream provider error (post-first-token) | `build-stream-config.ts:353-370` -> `stream-error-handler.ts` | SSE `{type:"error"}` part, categorized | one of 5 authored strings (vision/quota/timeout/context-length, or the generic fallback) — see below | A |
| Total provider failure, pre-first-token, same-turn fallback exhausted (`streamWithFallback`) | `stream-with-fallback.ts:388` `throw wrapped` -> `route.ts:1078-1114` | 500 | `{"error": "Chat stream failed"}` (generic; no in-conversation message) | A |
| Total provider failure inside `aiChat`/`aiStream` (a **different** function, used by judge/adversarial/deep-reasoning/auto-rename etc., not the main chat stream) | `lib/ai/provider.ts:1388-1399` | n/a (returns a value) | graceful **"emergency" sentinel**: `provider: "emergency", model: "none"`, a conversational message ("I'm having trouble connecting to my AI providers right now... try again in a moment") that even names cost-firewall holds explicitly when relevant | A |

**The main interactive chat path gets a strictly worse total-failure UX than the rest of the
codebase already has built.** `streamWithFallback()` (used exclusively by the chat route,
§5.4/§8.1) `throw`s on total exhaustion (`stream-with-fallback.ts:388`) rather than returning the
same graceful `"emergency"`-tier response `aiChat()`/`aiStream()` return elsewhere in
`lib/ai/provider.ts` (`:1388-1399`, confirmed above). The thrown error becomes a generic 500 JSON
response (`route.ts:1110-1113`) with no assistant-style message at all; client-side, `onError`
(`use-chat-stream.ts:161-164`) only logs to console and sets connection state to `"degraded"` — the
composer does not inject a graceful in-conversation "I'm having trouble" bubble the way the
`aiChat` emergency tier is designed to produce. **The graceful-degradation pattern this codebase
already built (and documents as deliberately better than "a dead screen," `provider.ts:1381-1383`)
exists but is not reused on the one path that is actually user-facing in real time.** [A for both
code paths' behavior; this is a direct architectural comparison, not an inference — `aiChat` and
`streamWithFallback` are different functions with different total-failure contracts, verified by
reading both.]

**401 / auth-failure mid-stream has no dedicated category — it is indistinguishable from a
transient blip.** `categorizeStreamError()` (`stream-error-handler.ts:98-114`) matches exactly four
authored categories against the error's name+message text: vision/multimodal-unsupported,
quota/rate-limit/billing, timeout, and context-length. None of the four regexes match
`401`/`unauthorized`/`invalid api key`/`authentication` patterns, so an expired or revoked API key
failing mid-stream falls through to the generic `CLIENT_SAFE_STREAM_ERROR_TEXT`: "The AI provider
dropped mid-response — tap Retry to continue." [A] This is a precise, real gap: retrying after an
auth failure with the same bad credential will fail identically every time, but the operator sees
the same message as a genuine transient network blip and has no signal that the real fix is
rotating a key, not tapping Retry again.

**The budget-cap silent-fail-open asymmetry** (full detail in §5.1) is repeated here only as a
pointer: `route.ts:340-341`'s `assertWithinBudget().catch(() => null)` fails open with **zero**
logging, unlike the structurally identical gate one hop earlier (`gate.ts:147-152`) which was
explicitly fixed to log on the same failure mode. This is a genuine, cite-once-use-twice finding —
listed in the summary as one item, not double-counted.

**Mid-stream errors still persist a placeholder, honoring the partial-text accumulator** — the
`onError` handler's whole reason for existing (`build-stream-config.ts:343-352`) is writing a
placeholder `ChatMessage` from `__partialRef.text` so "the partial assistant text streamed to the
user's screen" does not "vanish from history on next reload." Also resolves the same
`onFinishPromise` resolver `onFinish` uses, so a stream error can never hang the SSE response to
`maxDuration` (`:365-369`).

## 14. Receipts / audit — brief

- **`ActionReceipt`** (`prisma/schema.prisma:3154-3171`) is the record for the bespoke
  `stageCustomerAlert`-style approval flow (§7.2) — `status: "PENDING"` rows created by that SDK
  tool, presumably flipped by a Telegram button-callback handler not traced in this pass [I]. It
  has no `conversationId` field (confirmed in §12's schema read), so it is not queryable
  per-conversation — only via `missionId`.
- **`ApprovalRequest`** (`prisma/schema.prisma:2914-...`) is the record for the action-block
  `checkApprovalGate` flow (§7.2) — queried by `toolId` with in-app payload-equality dedup.
- **`AuditEvent`**: referenced by `auto-rename.ts`'s once-ever marker (`eventType:
  "chat_renamed"`, §12) and by the image-hallucination-ghost validator (`validateImageReferences`
  checks `/api/images/<id>` references against `audit_events`, §8.2 point 4) — a general-purpose
  audit trail consumed by at least two chat-adjacent mechanisms; not exhaustively traced.
- **`lib/ai/receipts/action-receipt.ts`**'s `canClaimDone`/`toReceipt` (named in
  `docs/CURRENT-TRUTH.md`'s "action-honesty receipt contract") is imported into
  `deferred-background-work.ts:16` alongside the phantom-action-claim detector from
  `docs/CHAT-PIPELINE-STUDY-2026-08-27.md`'s Finding 2 (`detectPhantomActionClaims` deliberately
  **not** wired into `canClaimDone` yet, per that doc — a chip-only warning today, not a blocking
  gate) — not re-verified against source in this pass beyond the import site; treat as [H]
  corroborating the study doc, not independently re-read.

## 15. UI result — tool cards, provenance, diagnostics — brief

- **Tool cards**: `components/chat/tool-result-card.tsx` + `tool-result-registry.tsx` render
  per-tool-name output shapes; `features/chat-v2/components/typed-tool-cards.tsx` is a second,
  chat-v2-specific typed-card layer (both exist; not reconciled against each other in this pass
  for overlap/duplication — flagged as an open question, not a confirmed finding). [I]
- **Provenance**: `components/chat/citation-pills.tsx` + `context-block-badges.tsx` render the
  `[brain:TAG]` citations parsed post-stream (§8.2 point 7, `parseCitations`) and the
  `X-Context-Blocks`/`X-Deeper-Context-Count`/`X-Deeper-Context-Types` response headers
  (`use-chat-transport.ts:211-226`, read from `buildChatResponse`'s header set,
  `lib/services/chat/response-shape.ts` — not opened this pass).
- **Diagnostics**: `components/chat/message-diagnostics.tsx` is the L5 fabrication-defense
  surface named in `apps/statenour/AGENTS.md`'s table (§ task brief) — pairs with
  `lib/services/claim-warnings.ts`; not opened in full this pass, cited from the app's own
  documented table only. [H]
- **Reasoning trace**: `components/chat/reasoning-trace-live.tsx` / `reasoning-trace-modal.tsx`
  read the `X-Trace-Id` header (`use-chat-transport.ts:265-278`) to deep-link
  `/system/agent-traces?search=<traceId>` per that hook's own comment — ties the UI directly back
  to the `AgentTrace` row minted at turn start.

*(Sections 14 and 15 are intentionally brief — full-depth tracing of the receipt/UI-provenance
layer was out of budget for this pass given the depth already spent on the higher-priority hops
the task named explicitly; each claim above is still path-cited and class-tagged rather than
asserted from memory.)*

---

## 16. Ordered hop table (reference — see numbered sections above for full detail)

| # | Hop | Entry point | Section |
|---|---|---|---|
| 1 | Composer (single UI) | `features/chat-v2/components/chat-island.tsx` mounted by `app/(mastery)/chat/page.tsx:1,23` | §1 |
| 2 | POST route | `app/api/ai/chat/route.ts:49` `POST()` | §5 |
| 3 | Auth | `route.ts:53` `requireSession(req)` | §5.1 |
| 4 | Rate limit (x2) | `route.ts:60` + `lib/ai/chat/gate.ts:122` | §5.1 |
| 5 | Budget gates (x2) | `gate.ts:147-164` + `route.ts:340-357` | §5.1, §13 |
| 6 | Body parse / shape / control extraction | `gate.ts:166-236` | §5.1 |
| 7 | Interceptor fast path (image/decision/brain-dump) | `route.ts:164-177` -> `lib/ai/chat/interceptors.ts` | §5.2 |
| 8 | Specialist sub-agent routing | `route.ts:188-200` -> `./specialist-routing.ts` | §5.2 |
| 9 | User-turn persist (parallel, fire-and-forget) | `route.ts:229-254` -> `lib/services/chat/persist-user-turn.ts` | §5.3, §12 |
| 10 | Provider/model selection + cost firewall | `route.ts:364-525` | §5.4, §10.1 |
| 11 | Parallel prefetch (prompt, compression, embeddings, context-hints, brain-context) | `route.ts:576-716` | §6 |
| 12 | Prompt finalize + augment | `./finalize-system-prompt.ts` + `./augment-final-prompt.ts` | §6.1-6.3 |
| 13 | Tool prep (prune, blocklist, force, read-mode strip) | `./prepare-tools.ts` | §7.1 |
| 14 | Model-message build | `./build-model-messages.ts` | (not deep-traced) |
| 15 | Alternate paths (flag-gated, default OFF) | `./alternate-paths.ts` | §5.4 (mentioned) |
| 16 | Stream (per-attempt config + fallback) | `./build-stream-config.ts` + `lib/ai/stream-with-fallback.ts` | §8.1 |
| 17 | Live SDK tool dispatch | inside `streamText`, `lib/ai/tools/*.ts` | §7.2 |
| 18 | Assistant-turn persist (`onFinish`) | `lib/services/chat/persist-assistant-turn.ts` | §8.2 |
| 19 | Post-turn outbox (durable) | `lib/services/chat/post-turn-outbox.ts` | §8.3 |
| 20 | Deferred background work (title, memory, actions, follow-ups) | `lib/services/chat/deferred-background-work.ts` | §8.3, §12 |
| 21 | Deferred action-block execution + approval gate | `lib/ai/nick-agent.ts` -> `lib/ai/runtime/approval-gate.ts` | §7.2 |
| 22 | Streaming resume/tail | `app/api/ai/chat/[conversationId]/stream/route.ts` + `lib/services/chat/active-stream.ts` | §9.2 |
| 23 | UI render (tool cards, provenance, diagnostics) | `components/chat/*`, `features/chat-v2/components/*` | §15 |
| 24 | Error paths | (multiple) | §13 |

## 17. NOT VERIFIED in this pass (explicit)

- `lib/auth-guard.ts`'s `requireSession()` internals (session-check mechanics) — only its call
  sites were confirmed.
- `lib/services/chat/reconcile-stream-text.ts`, `lib/services/chat/salvage-event-text.ts`,
  `lib/services/chat/persist-assistant-message.ts`, `lib/services/chat/post-persist-verification.ts`
  — call sites and their documented responsibilities were confirmed; internals were not read line
  by line, except where directly quoted.
- `guardianBypassStorage` (`lib/tools/guardian.ts:31`) — confirmed to exist and to short-circuit
  `checkApprovalGate` when set; which code paths actually set it was not traced.
- `stageCustomerAlert`'s Telegram-approval-button callback handler — the PENDING-receipt creation
  side was confirmed; the approval-confirmation side was not traced.
- `lib/db/conversation-mission-linker.ts`'s trigger point — confirmed to exist, not found wired
  into the traced chat background-work pipeline; not chased further.
- `app/api/ai/chat/build-model-messages.ts` — read only by reference from `route.ts`'s comment,
  not opened directly.
- `components/chat/message-diagnostics.tsx`, `lib/services/claim-warnings.ts`,
  `lib/ai/chat/fabrication-rewriter.ts`, `lib/ai/chat/sanitize-history.ts`,
  `lib/ai/chat/truth-grounding.ts`, `lib/ai/chat/action-claim-detector.ts` — the fabrication-defense
  L1-L5 stack named in `apps/statenour/AGENTS.md` was cross-referenced by import site and by the
  stream-resume route's comment about pre-persist banners, but not independently re-read file by
  file in this pass.
- `components/chat/typed-tool-cards.tsx` vs `components/chat/tool-result-card.tsx`/
  `tool-result-registry.tsx` — flagged as a possible duplicate-implementation candidate (two card
  systems) but not reconciled; genuinely unresolved, not a confirmed finding either way.
- Whether every configured model provider can consume a raw multimodal PDF `file` part usefully
  (§11) — a code-shape fact (the part is sent as-is) without a runtime check of provider behavior.
- Runtime state of any test suite in this snapshot — `tests/ai/prompt-block-fencing-gate.test.ts`,
  `tests/ai/command-drift.test.ts`, `tests/observability/ai-sdk-telemetry-gate.test.ts`, and every
  other test cited in this report were read as source and reasoned about structurally; **none were
  executed**. "The gate exists and is logically sound" is not the same claim as "CI is currently
  green," and this report never asserts the latter.
- Live Railway environment variable values (`OLLAMA_MODEL`, `ANTHROPIC_API_KEY`, feature-flag
  overrides, etc.) — this snapshot is a static git archive with no `.env`; every claim gated on an
  env var's *runtime* value is explicitly marked [I] or hedged accordingly.

---

**Report status: COMPLETE** as of this line. All sections above (1-17) are the full deliverable.

