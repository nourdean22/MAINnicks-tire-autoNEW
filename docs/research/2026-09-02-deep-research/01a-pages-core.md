# StateNour Core Surfaces Audit — Page/Surface Inventory

Snapshot: `git archive origin/main @ abdd99395` (== production abdd993, deployed 2026-09-02 13:23Z). Read-only, no runtime — all claims are static-code inference unless noted.

Evidence classes: **A** = verified in code (path:line quoted). **H** = inference from code shape (naming, adjacent patterns) without a direct assertion. **I** = not verified (would require runtime/DB/network to confirm).

Corpora grepped for "no reader/writer" claims are named per-claim (app/, components/, features/, lib/, hooks/, tools/, local-agent/, scripts/, tests/, prisma/, __tests__/).

---

## STATUS: COMPLETE — all scoped surfaces covered (Global Overlays, Home, Chat, Missions, Journal, Stats, error/not-found). See "NOT VERIFIED" section near the bottom for gaps.

## TABLE OF CONTENTS
1. Global Overlays (mounted by app/layout.tsx + app/(mastery)/layout.tsx)
2. `/` — Home ("Command Surface")
3. `/chat` — full Chat (Nick)
4. `/missions` — "Execution Deck"
5. `/journal`
6. `/stats`
7. app/(mastery)/error.tsx and app/not-found.tsx
8. Cross-cutting pattern (positive)
9. NOT VERIFIED

## GLOBAL OVERLAYS (mounted by app/layout.tsx + app/(mastery)/layout.tsx)

**A** `app/layout.tsx:96-98` mounts `CommandPalette`, `PWAInstallPrompt`, `ServiceWorkerRegister`, `Toaster` (sonner, top-center, 4000ms) once at the root, outside `(mastery)`. `ClientErrorTelemetry` (`app/layout.tsx:94`) captures `window.onerror`/`unhandledrejection` and posts to `/api/errors` (renders nothing).

**A** `app/(mastery)/layout.tsx:62-135` mounts, in order: `NeuralBackground`, `PageTracker`, `PageContextBridge`, `SwipeNavigation`, `KeyboardShortcuts`, `SessionExpiryBanner`, `AmbientAura` (wraps `<main>`, contains `ErrorBoundary name="mastery.page"` around `{children}`), `BottomTabBar` (contains `BottomPulseTicker`), `MoreSheet`, `DeepModeNudge`, `MegaConfirmHost`, `BrainDumpModal`, `AppBadge`. Wrapped in `TRPCProvider` > `NourStateProvider`.

**A** `app/(mastery)/layout.tsx:76-81` — code comment confirms `GlobalTopTicker` was deleted 2026-09-01 (matches repo context; not re-verified further here).

### Nav single source — confirmed
**A** `components/layout/nav-items.ts:55-93` — `NAV` array is the sole source read by `BottomTabBar`, `MoreSheet`, and `CommandPalette` (per file header comment, not independently re-verified against command-palette.tsx contents). `/business` is absent with an explicit removal comment (`nav-items.ts:81-88`, matches repo context — not re-verified). `BOTTOM_TABS` = Home, Chat, Missions, Journal (`nav-items.ts:57-60`); `/stats` is a `flatRow` MORE-sheet entry, NOT a bottom tab (`nav-items.ts:61`) — contradicts task framing that groups it with the 4 daily tabs; it is one tap further away (via More sheet) than Home/Chat/Missions/Journal.

### BottomPulseTicker (components/ultron/bottom-pulse-ticker.tsx)
**A** Two live queries: `trpc.operator.personalPulse.useQuery` (`:75-77`, `refetchInterval: 300_000` = 5min) and `trpc.operator.ticker.useQuery` (`:79-80`, `refetchInterval: 300_000`). `resolveCommitment` mutation (`:89`) calls `trpc.operator.resolveCommitment` (`lib/trpc/routers/operator.ts:662`) — inline resolve from the ticker strip. Client-side rotation via `setInterval(...,10_000)` (`:162`) advances the displayed item every 10s; not a data poll.

**A — traced the LIVE OBSERVATION ticker string.** "BRAIN ⚠ patience horizon 20 … (1/12)" is produced by `lib/services/ultron-ticker.ts:424-432` (medium-severity nudge branch: `symbol: "BRAIN"`, `label: \`⚠ ${medium.text}\``), fed by `lib/brain/cross-system-nudge.ts:107-108` (`patience_horizon` phraser: `` `patience horizon ${v}${arrow} — you're committing to same-week deadlines; try staging 2+ weeks out` ``). Consumed via `trpc.operator.ticker` → `ultron-ticker.ts:390-433` which dynamically imports `computeNudges()` from `cross-system-nudge.ts`. The "(1/12)" fraction is the ticker's own item-index/total-count display, not part of the nudge text (not traced further — see NOT VERIFIED).

**A** Separately, `lib/services/personal-pulse.ts:441-457` computes a DIFFERENT "MIND" chip (`label: "MIND"`, glyph `◆`, text `self-model ${avg}/100`) from `identitySnapshot` axes — this is NOT the same string as the observed "BRAIN" ticker item; the two queries (`personalPulse` vs `ticker`) return distinct item sets that both render through the same ticker component. A code comment at `personal-pulse.ts:454-456` explicitly warns this MIND avg diverges from the canonical `/brain` maturity rollup and was relabeled to stop "impersonating" it — i.e. a known-diverging number is still shown to the operator under a plain label, with the divergence disclosed only in a source comment, not in the UI.

### Other global overlays — quick pass
- **A** `MegaConfirmHost` (`components/operator/mega-confirm-dialog.tsx:92,140`) — comment states it explicitly replaces `window.confirm` for mega-tier cost gates; dialog at `z-[100]`.
- **A** `KeyboardShortcuts` (`components/hud/keyboard-shortcuts.tsx:118,128`) — help overlay ALSO at `z-[100]` — same layer as `MegaConfirmHost`; both are global singletons mounted in the same layout, so a shortcuts-help open during a mega-confirm (or vice versa) is a same-z-index stacking collision (**H**, not observed live).
- **A** `SessionExpiryBanner` (`components/hud/session-expiry-banner.tsx:78,95,117,163`) — polls `utils.system.sessionExpiry.fetch()` via `setInterval`, checked every 1s (`:95`) against a session-derived refetch interval (`:117`); banner fixed at `z-[60]`, above `BottomTabBar`'s `z-[55]`.
- **A** `AppBadge` (`components/hud/app-badge.tsx:28-36`) — two 60s-polled queries, `trpc.systemAutomation.getPendingApprovals` and `trpc.systemAutomation.approvals`, summed for the PWA badge count; comment claims parity with the Home header pending-approval pill (`home-identity-header.tsx:32`, not independently re-verified here — see Home section).
- **A** `PageTracker` (`components/brain/page-tracker.tsx:16`) fires `trpc.brain.pageVisit.useMutation()` — a page-view-logging mutation, fire-and-forget, no UI.
- **H** `NeuralBackground`, `AmbientAura`, `sw-register`, `PageContextBridge`, `ErrorBoundary`, `DeepModeNudge` — grepped for `useQuery`/`useMutation`/`window.confirm` with zero matches; these appear to be presentation/local-state/event-listener components with no direct data reads of their own (not fully read line-by-line — class **H**).

---

## SURFACE: `/` — Home ("Command Surface")

### 1. JOB + component tree
**A** `app/(mastery)/page.tsx:1-5` renders `HomeConsole` only. Per its own header comment (`components/home/home-console.tsx:4-27`), Home is "a compiled view of the operator's state, not a dashboard" — one server-built brief (`operator.brief`) feeds six fixed sections that render nothing (not empty chrome) when they have nothing true to say. Comment explicitly disclaims: no dashboard grid, no stat gauges, no Nick's Tire content — `/business` was deleted 2026-09-02 (matches repo context).

Tree (2 levels), all from `home-console.tsx:31-96`:
```
HomeConsole
├─ BriefStateLine   (state line: date, health chip, one sentence)
├─ [unreadable-error panel]  OR  BriefLead   (recommended move + alternatives)
├─ NickCommandLine  (composer, section "Nick")
├─ JudgmentQueue    (approvals/contradictions/commitments/follow-ups)
├─ HorizonLine      (one pointer per time scope)
└─ ChangeLine       ("since last visit" semantic diff)
```

### 2. DATA READS
| Query/Mutation | File:line | Interval |
|---|---|---|
| `trpc.operator.brief.useQuery` | `home-console.tsx:39-43` | staleTime 30_000, refetchInterval 60_000, refetchOnWindowFocus false |
| `trpc.operator.briefChanges.useQuery({since:cursor})` | `change-line.tsx:58-61` | enabled cursor>0, staleTime 60_000, no window-focus refetch |
| `trpc.operator.recordHomeSignal.useMutation` | `judgment-queue.tsx:59` | fire-and-forget telemetry |
| `trpc.operator.commitmentAccept.useMutation` / `commitmentDismiss.useMutation` | `judgment-queue.tsx:61-62` | on tap |
| `trpc.operator.agendaConvertFollowUp` / `agendaDismissFollowUp` | `judgment-queue.tsx:63-64` | on tap |
| `trpc.operator.nickRemembersContext.useQuery` | `judgment-queue.tsx:68-70` AND `nick-command-line.tsx:96-98` (called independently by BOTH components) | staleTime 60_000 |
| `trpc.operator.agendaSyncFollowUps.useMutation` | `judgment-queue.tsx:73-74` | fired once per distinct follow-up-titles signature via effect |
| `useChat` (ai-sdk v6) over `DefaultChatTransport({api:"/api/ai/chat", body:{privateMode:true}})` | `nick-command-line.tsx:101-113` | on submit |

Server brief composition: `lib/home/operator-brief.ts` (879 lines) reads `deriveBriefing` (`lib/home/derive-briefing.ts`), `homeHealthState`, `buildNextMove`, `buildSystemHub`, `buildTaskRescue`, `listPendingActions` (approval queue), `loadRecentContradictions`, `listProposed` (proposed commitments), `getMit`.

### 3. CONTROLS
- **Retry button** on brief-unreadable panel (`home-console.tsx:76-82`) calls `briefQ.refetch()`. Plain retry, no silent-success.
- **JudgmentQueue Accept/Dismiss** (`judgment-queue.tsx:306-320`) calls `onCommitmentVerdict(id,"accept"|"dismiss")` -> `trpc.operator.commitmentAccept`/`commitmentDismiss`. Well-built control: the `act()` helper (`judgment-queue.tsx:87-102`) sets a `busyKey` (disables in-flight), on failure sets `actionError = "That didn't save -- the item is still waiting."` (no optimistic lie), on success calls `utils.operator.brief.invalidate()` to refetch real state.
- **NickCommandLine send** (`nick-command-line.tsx:161-179`) calls `sendMessage()` via ai-sdk `useChat`, POSTs to `/api/ai/chat`.
- **Morning-brief chip** (`nick-command-line.tsx:320-329`) calls `fireBrief()` (`:127-131`) -> `sendMessage({text: WAKE_MESSAGE})` where `WAKE_MESSAGE = "Wake up. Give me the morning brief."` (`:76`). This is a chat message through the same `/api/ai/chat` pipe as every other Nick input -- it does NOT call a dedicated `/api/ai/home-brief` endpoint (see AI CHROME section below -- that endpoint has zero callers).
- **`/search` slash command** (`nick-command-line.tsx:169-173`) routes via `router.push()` instead of chatting -- the only Home control that navigates rather than calling AI.

### 4. STATES -- exemplary anti-fabrication pattern, quoted
**A** `home-console.tsx:46-49`: `unreadable = briefQ.isError && !brief`; `refreshFailed = briefQ.isError && !!brief` -- first-load failure renders a distinct "brief couldn't be built" panel (`:65-83`, quote: "The read failed -- state unknown, not empty. Nick still works below."); a stale-but-present brief on a failed background refetch renders the OLD brief plus a small "refresh failed - showing last confirmed brief" badge (`:59-63`) -- never silently swaps in zeros.

**A** `judgment-queue.tsx:113-115`: "Measured zero renders NOTHING -- unless part of the measurement failed, which must render as failure, never as quiet." A genuine empty queue and a failed-read queue are visually distinguished via a `failedSources` array.

**A** `lib/home/operator-brief.ts:11-14` doctrine comment: "UNKNOWN IS NOT ZERO. Every source is fetched behind its own guard. A failed read never renders as an empty queue or a green light -- it renders as 'unmeasured', named in `failedSources`." This is the strongest anti-fabrication pattern found on any surface in this audit -- Home reads as deliberately built against the exact "no reader/no writer renders as healthy" failure mode this audit is hunting.

**A** `lib/home/operator-brief.ts:19-22` doctrine: "NO FABRICATED CONFIDENCE... No calibrated probability model exists for the recommendation, so no percentage is shown." No confidence-% badge on Home's lead recommendation (contrast with /chat's tool-posture chrome -- see AI CHROME below).

### 5. AI CHROME

**Traced: "DECISIONS ARE BLOCKING THE SYSTEM" lead headline** (matches LIVE OBSERVATION). `lib/home/operator-brief.ts:586-594`, the `"decide"` arm of `mapLead()`: `headline: "Decisions are blocking the system"`, reasoning text `${pendingDecisions} deferred side effects are parked until you rule`, CTA "Review approvals" -> `/system/actions`. The arm is selected by `deriveBriefing()` (`lib/home/derive-briefing.ts`, not fully read) based on `pendingDecisions` count computed at `operator-brief.ts:361-375` from `listPendingActions()` plus a raw `approvalRequests` read, taking the oldest `createdAt` across both for the "oldest Nh" figure.

**Traced: judgment-queue AI-proposed COMMITMENT rows / ACCEPT.** Sole producer of `Commitment.status="proposed"` in the corpus (grepped `lib/`, `app/`, excluding tests): `lib/brain/journal-brain.ts:487`, inside `generateJournalTake()` -- an LLM call (`generateJournalTake`, `journal-brain.ts:394+`) extracts idea/challenge/nextAction/confidence from a journal entry; when `nextAction` is present it calls `proposeCommitment({statement: nextAction.action, domain, sourceRef: "journal-take:<id>"})` (`lib/services/commitments.ts:93-127`), idempotent on `sourceRef`. Comment at `journal-brain.ts:478-483` states this closes a prior audit finding ("nextAction display-only, never becomes actionable"). Trigger path: `enrichJournalEntry` is called from `lib/brain/journal-fanout.ts` and `lib/inngest/functions/journal-fanout.ts` (Inngest event fan-out on journal save -- **H**, fan-out trigger not independently traced past the function name to the actual save action). tRPC surface comment at `lib/trpc/routers/operator.ts:1719-1724` confirms: "Machine proposers (journal nextAction is the first) create status='proposed' rows; these three procedures are the operator's verdict surface on Home."

ACCEPT (`operator.ts:1732-1737` -> `acceptCommitment()`, `lib/services/commitments.ts:133-138`): `UPDATE Commitment SET status='active', updatedBy='operator' WHERE id=? AND status='proposed'`. That is the entire effect -- no task/mission row is created, no notification fires; the commitment simply moves from "proposed" to "active" on the books. DISMISS moves it to `status="abandoned"` (never re-proposed, since `sourceRef` idempotency spans all statuses -- `commitments.ts:98-101`).

**Traced: MORNING BRIEF chip.** Opens nothing (no modal/route) -- `nick-command-line.tsx:127-131,320-329` sends the fixed string "Wake up. Give me the morning brief." as a normal chat turn over `/api/ai/chat` (`privateMode:true`), rendered inline in the composer's own response pane (`:202-227`). Gated to once/day via a `localStorage` stamp (`lib/home/cognitive-partner-brief`, not independently read).

**`/api/ai/*-brief` endpoint audit** (corpus grepped: `app/`, `components/`, `lib/`, `hooks/`, `features/`):

| Endpoint | Route exists? | Live UI caller found? |
|---|---|---|
| `/api/ai/home-brief` | A - yes (`app/api/ai/home-brief/route.ts`) | A - NONE. Zero references anywhere outside its own route file. Dead endpoint. |
| `/api/ai/missions-morning-brief` | A - NO such directory under `app/api/ai/` in this snapshot | n/a -- only mentioned in a comment inside `relationships-morning-brief/route.ts:6` as a historical shape reference ("Wave AA") |
| `/api/ai/journal-brief` | A - yes | A - yes: `components/journal/nicks-journal-brief.tsx` (see Journal section) |
| `/api/ai/goals-brief` | A - yes | A - NONE live. The only textual reference to a consumer (`nicks-goals-brief.tsx`) is inside a hypothetical example in a doc-comment (`lib/utils/api-fetch.ts:122-124`); no such component file exists in the snapshot (`find` confirmed zero matches). `/goals` itself is a redirect stub to `/stats#goals` (`app/(mastery)/goals/page.tsx`). Dead endpoint. |
| `/api/ai/scoreboard-brief` | A - yes | A - NONE. Zero references outside its own route file; `/scoreboard` is a redirect stub to `/stats` (`app/(mastery)/scoreboard/page.tsx`). Dead endpoint. |
| `/api/ai/relationships-morning-brief` | A - yes | A - yes: `components/relationships/nicks-relationships-brief.tsx` (out of audit scope; /people not covered) |

**Net: of 6 named brief endpoints, 3 are dead code with zero live callers (home-brief, goals-brief, scoreboard-brief), 1 does not exist in the tree (missions-morning-brief), and only 2 (journal-brief, relationships-morning-brief) have a confirmed live UI caller.** None of the dead ones are called from the Home surface itself -- Home's own brief runs entirely server-side through `operator.brief` (a tRPC procedure backed by `lib/home/operator-brief.ts`), not through any `/api/ai/*-brief` REST route.

No XP/streak/gamification chrome found on Home -- grepped `components/home/*.tsx` for `xp|streak|level|badge|gamif` with zero matches (**H**, grep only, not a full line-by-line read).

### 6. MODALS/SHEETS this surface can open
`BrainDumpModal` and `MegaConfirmHost` are global (layout-mounted, not Home-specific -- see Global Overlays). Within `components/home/*.tsx`, grep for `Dialog|Sheet|Drawer|Popover|Modal|DropdownMenu|cmdk` returned no matches (**H**) -- Home itself opens no local modal; its only navigation is via `<Link href>`/`router.push` to other routes (`/system/actions`, `/brain`, `/missions`, `/system`).

### 7. Density/hierarchy
**A** Single-column `max-w-[720px]` container (`home-console.tsx:52`), six fixed sections, explicit doctrine against dashboard-grid/nested-cards/decorative chrome (`home-console.tsx:24-27`). Sections render `null` when empty (`judgment-queue.tsx:113` pattern) rather than reserving dead space. This is the most restrained surface in the audited set -- no motion/gradient chrome found in the 5 files grepped (**H**, not a full read).

---

## SURFACE: `/chat` — full Chat (Nick)

### 1. JOB + component tree
**A** `app/(mastery)/chat/page.tsx:1-26` renders `ChatIsland` (`features/chat-v2/components/chat-island.tsx`) inside a `fixed inset-0` box that re-declares its own safe-area padding (comment explains the (mastery) layout's padding does not reach a fixed child). Page metadata: `description: "The primary cognitive interface for NOURCITY."` (`chat/page.tsx:5`) -- that is the JOB, from code, not a comment.

Tree (2 levels), from `chat-island.tsx`:
```
ChatIsland
├─ header: "NICK" + ChatCapabilityIndicator + posture/depth/PRIVATE strip + Context/History buttons
├─ ChatMessageList        (messages, empty-state COMMANDS chips, retry-on-interrupt banner)
├─ ChatMediaFocusPanel    (desktop-only overlay panel, null unless opted in)
├─ MemoryInspectorSidebar (fixed right sidebar, z-50)
├─ [historyDrawerOpen] -> OperatorConversationDrawer (absolute left panel, z-50)
└─ ChatComposer           (textarea, slash menu, mic, image attach, send/stop)
```
`ChatComposer` itself further mounts `SlashCommandDropdown`, `VoiceWaveformOverlay`, `MentionDropdown` (not individually re-verified line-by-line).

### 2. DATA READS
| Query/Mutation | File:line | Notes |
|---|---|---|
| `useChat` transport -> `POST /api/ai/chat` | `use-chat-stream.ts:107-108` via `useChatTransport({apiPath:"/api/ai/chat", ...})` | body carries `conversationId`, `privateMode` (only when true), `posture`/`depth` (only when non-"auto"), `turbo`, `actionPermission`, `contextRoute` -- "ship only NON-DEFAULTS" (`use-chat-stream.ts:53-54`) |
| `trpc.system.providerHealth.useQuery` / `trpc.system.toolsHealth.useQuery` | `chat-capability-indicator.tsx:11-18` | both `refetchInterval:60_000, retry:1` |
| `trpc.chat.deleteMessage.useMutation` | `chat-composer.tsx:37` | used inside the edit-resubmit flow (delete old message, then resend), not a standalone user-facing delete |
| `trpc.brain.createPin.useMutation` | `chat-composer.tsx:64` | |
| `trpc.brain.recordMemory.useMutation`, `trpc.brain.harvestBeliefs.useMutation` | `chat-message-list.tsx:311-312` | |
| `trpc.brain.mediaMoments.useQuery` | `media-saved-moments.tsx:34` | |
| `trpc.chat.sendEmail.useMutation` | `email-draft-card.tsx:77` | |
| `trpc.chat.upscaleImage.useMutation` / `varyImage.useMutation` | `image-with-upscale.tsx:32-33` | |
| `trpc.nick.suggestions.useQuery` / `trpc.brain.recordSuggestionSignal.useMutation` | `nick-suggestions.tsx:138,148` | |
| `trpc.chat.messageProvenance.useQuery` | `reasoning-trace-modal.tsx:74` | drives the reasoning-trace modal |
| `trpc.task.undo.useMutation` | `tool-result-card.tsx:54` | |
| `trpc.chat.deleteConversation` / `renameConversation` / `updateConversation` (`.useMutation`) | `hooks/use-conversations.ts:66-68` | backs `OperatorConversationDrawer` |
| raw `fetch("/api/brain/recall?q=...&limit=8")` | `chat-island.tsx:213-216` | memory-inspector panel; fenced per repo context (not re-verified) |
| raw `fetch("/api/ai/transcribe", {method:"POST", body: form})` (multipart) | `hooks/use-voice-input.ts:133,221` | mic button transcription; see AI CHROME below for the provider chain |

### 3. CONTROLS
- **Send / Stop** -- standard `useChat` `sendMessage`/`stop`; Stop button at `chat-composer.tsx:464`.
- **Mic button** (`chat-composer.tsx:412-421`, `Mic` icon) toggles `voice.startRecording`/`stopRecording` (`hooks/use-voice-input.ts`). On a non-OK response the hook surfaces `toast.error("Voice transcription failed -- try again")` (`:141`) rather than swallowing it -- **fixed since a prior 7-day audit** (comment `:135-137` references a previously-silent 404). See AI CHROME for the live provider chain.
- **Delete conversation -- NO CONFIRMATION OF ANY KIND.** `OperatorConversationDrawer`'s trash button (`operator-conversation-drawer.tsx:106`) is a single `onClick={(event) => onDelete(conversation.id, event)}` wired straight to `chat-island.tsx:352-355` -> `conversations.deleteConvo(id, event)` (`hooks/use-conversations.ts:248-270`), which calls `deleteConversationMutation.mutateAsync({id})` on the very first tap. No `window.confirm`, no in-DOM two-tap pattern, no `usePromptDialog` (that hook IS imported and used elsewhere in the same file, e.g. rename -- just not wired to delete). This is a real destructive/irreversible action with zero confirmation gate of any kind, stronger than a "silently-suppressed window.confirm" finding because there is no confirm mechanism to even be suppressed. Contrast: `email-draft-card.tsx:81` has a comment acknowledging "window.confirm is suppressed in the standalone PWA" for a different destructive action and (per grep) contains no raw `window.confirm` call either -- not independently confirmed whether IT has a real replacement gate (not read in full).
- **Delete-safety pattern done right elsewhere**: `deleteConvo` itself (`use-conversations.ts:248-270`) does NOT optimistically remove the conversation from local state before the mutation resolves -- comment at `:248-256` explicitly documents this was a past bug ("previously the UI removed the conversation immediately even on a 500 or 404 ... now we only mutate state if the mutation resolved"). So the *optimistic-lie* failure mode is avoided here even though the *no-confirmation* one is not.
- **Context / History header buttons** (`chat-island.tsx:265-268`) toggle `memoryInspectorOpen` / `historyDrawerOpen` local state -- simple, no fabricated feedback.

### 4. STATES
**A** `chat-message-list.tsx:252-267` -- an interrupted/failed turn renders a distinct red "Response interrupted" panel (`"The reply was cut off."` vs `"This turn failed before any reply."` depending on whether partial text exists) with an explicit **Retry** button -- not folded silently into the transcript as if it succeeded.

**A** `chat-island.tsx:197-206` comment + code: the Context/Evidence panel's quality verdict (`replyQuality`) is computed only from the LAST assistant message and the comment states *"Live-streaming turns have no blob until the server finalize writes it -- the panel labels that honestly"* -- i.e., an in-flight turn is shown as "not yet scored" rather than defaulting to a fake pass/fail.

**A** Memory-inspector fetch failure (`chat-island.tsx:213-227`) is a bare `try { ... } catch { /* Abort and network failures preserve the last known memory view. */ }` -- a failed recall silently KEEPS the previous render rather than clearing to empty or showing an error; this is defensible (stated intent, not a fabricated success) but means a persistently-failing recall never surfaces to the operator as broken -- it just looks stale forever with no visible signal (**H** -- no distinct stale-badge found in this file for the memory panel, unlike Home's explicit `refreshFailed` badge).

### 5. AI CHROME
**Traced: "181 CATALOG TOOLS · auto posture · auto depth" header** (matches LIVE OBSERVATION exactly). `chat-island.tsx:243-262`: `<h1>NICK</h1>` + `<ChatCapabilityIndicator/>` + a strip reading `{posture==="auto" ? "auto posture" : posture} · {depth==="auto" ? "auto depth" : depth}` (`:254-256`, gold-colored only when non-default) `+ " · PRIVATE"` when `privateMode` is on. The tool count comes from `ChatCapabilityIndicator` (`chat-capability-indicator.tsx:15-18,25-33`) via `trpc.system.toolsHealth.useQuery` -> `buildToolsHealth()` (`lib/trpc/routers/system/health.ts:281` -> `lib/services/tools-health.ts:177-180`), which sums per-category tool counts derived from `TOOL_CATALOG` (`lib/ai/tools/catalog.ts`). Label built at `features/chat-v2/lib/capability-label.ts:70,76`: `` `${toolSummary.totalTools} catalog tools` ``. A source comment (`tools-health.ts:19-23`) documents this was FIXED from a hand-maintained literal that had drifted 30% stale (125 vs 177) -- now mechanically derived, so the number is live-accurate by construction (**A** for the derivation; not independently re-run to confirm 181 is today's true count).

**Traced: VOICE button vs "prod whisper key is dead."** Confirmed dead in code: `app/api/ai/transcribe/route.ts:87-88` comment, dated 2026-08-27: *"OPENAI_API_KEY revoked in prod (live-probed 401) killed the whisper-only lane."* **But the route already has a replacement chain** (`lib/ai/stt.ts`): free-first `groq -> hf -> openai` (`transcribe/route.ts:89-91`), with `source`/`degraded` fields so the client can name which lane actually ran and toast when an earlier lane failed first (`use-voice-input.ts:144-150`, not fully quoted). Per `lib/ai/stt.ts:11`, the `groq` lane is "dormant until GROQ_API_KEY lands in the env" (**H**, no env access to confirm current state) and a route comment claims the `hf` lane is "LIVE-PROVEN" (`transcribe/route.ts:89` -- a comment, so class **H/I** on whether it is actually working today, not **A**). **Net: the mic button is very likely functional via the hf fallback, not dead** -- contradicts a literal reading of "voice button rendered though the whisper key is dead" as "the button doesn't work." **Also flagging a doc-drift**: the file's own top-of-file docstring (`transcribe/route.ts:12-18`) still describes "Strategy: one provider ... OpenAI Whisper... Used when OPENAI_API_KEY is set" as if that's still the only lane -- stale relative to the actual fallback chain implemented below it and the newer 2026-08-27 comment in the same file. A future reader trusting the docstring over the code would misdescribe the system (textbook "comment is history, not fact").

**Traced: reasoning-trace modal's confidence-like numbers.** Opened from a message's long-press action sheet (`chat-message-list.tsx:592,605` sets `reasoningTraceMsg`, mounts `<ReasoningTraceModal>`), backed by `trpc.chat.messageProvenance.useQuery` (`reasoning-trace-modal.tsx:74`). Renders an 8-axis judge rubric (`ACC/ACT/BRV/TONE/EVD/OBEY/HNST/CAL`, `:180-200`) each 0-10, sourced from `lib/ai/judge-eval.ts` (not independently read). The "CAL" (calibration) axis is an LLM-judge's own subjective 0-10 rating of one response, NOT a statistically validated calibration metric against real outcomes -- a comment at `:37-39` states obedience/nonSycophancy/calibration are "persona axes ... excluded from `composite`". Separately, a fixed 2026-08-19 comment (`:20-24`) documents a PAST bug where recall-hit "confidence" was fabricated by inverting a sighting count, since corrected to a real cosine-similarity percentage (`:294`, `` match {Math.round((1-hit.knnDistance)*100)}% ``) -- i.e. the one true statistical percentage shown in this modal is a vector-similarity score, not a correctness probability.

**Dead endpoint (bonus, same shape as the Home brief audit): `/api/ai/chat-openers`** exists (`app/api/ai/chat-openers/route.ts`) but has ZERO callers anywhere in `app/`, `components/`, `lib/`, `features/`, `hooks/` (grepped). The empty-state prompt chips actually shown (`"Run my command brief"`, `"Find the biggest revenue leaks"` [traces the LIVE OBSERVATION preset exactly], `"Plan today around reality"`, `"Show verified recent actions"`) are a hardcoded `COMMANDS` array at `chat-message-list.tsx:270-275`, not fetched from any endpoint.

No XP/streak/gamification chrome found in `features/chat-v2/` or `components/chat/` (**H**, grep for `xp|streak|level\b|gamif` returned no hits worth reporting).

### 6. MODALS/SHEETS/DRAWERS + z-index stacking risk
| Surface | Trigger | Position/z-index |
|---|---|---|
| `MemoryInspectorSidebar` | header "Context" button (`chat-island.tsx:265`) | `fixed inset-y-0 right-0 z-50` (`memory-inspector-sidebar.tsx:52`) |
| `OperatorConversationDrawer` | header "History" button | `absolute inset-y-0 left-0 z-50` wrapper (`chat-island.tsx:338`), nested inside the chat island's own `relative` root (`:240`) -- NOT a `fixed` top-level stacking context |
| `ReasoningTraceModal` | message long-press action sheet -> "why this answer" (`chat-message-list.tsx:592,605`) | `fixed inset-0 z-[180]` (`reasoning-trace-modal.tsx:86`) |
| `RealtimeVoiceOverlay` | (trigger not traced in this pass) | `fixed inset-0 z-[200]` (`realtime-voice-overlay.tsx:91`) -- highest z-index found anywhere in the audited surfaces |
| `MessageActionSheet`, `SlashCommandDropdown`, `MentionDropdown` | long-press on a message / `/` or `@` in composer | not individually z-checked this pass |

**Concrete stacking-risk finding**: both `MemoryInspectorSidebar` and `OperatorConversationDrawer` render at `z-50`, which is BELOW the global `BottomTabBar`'s `z-[55]` (`components/layout/bottom-tab-bar.tsx:75`). Since `BottomTabBar` is mounted globally by `app/(mastery)/layout.tsx` as a `fixed` sibling of the chat page's own `fixed inset-0` container (`app/(mastery)/chat/page.tsx:22`, which sets no z-index of its own), the tab bar's fixed stacking context sits above the chat page's, so **the bottom edge of both the memory-inspector sidebar and the conversation-history drawer can render underneath the always-visible bottom tab bar** rather than in front of it -- on a phone-height viewport this could visually clip the last row of either panel behind the nav bar. Not observed live; inferred from the two z-index values and the DOM/stacking-context relationship (**H**).

### 7. Density/hierarchy
**A** Chat is by far the most feature-dense surface audited: 22 files under `components/chat/`, 20 under `features/chat-v2/components/` + `hooks/`/`lib/`/`stores/`, 49 slash commands (`hooks/use-slash-commands.ts`, counted via grep `cmd:\s*"` = 49 matches) spanning navigation, business-data prompts (revenue/leads/estimates/callbacks/customer/winback/weather/sms), content-generation modes (image variants, carousel, A/B, cross-platform reformat), and system/ops commands (`/db-vacuum`, `/run-cron`, `/triage-prune`). This is the single highest-surface-area control set in the audit (**A** for the count; not evaluated here for whether all 49 are wired to live handlers -- `SlashCommandDropdown` code shows every command routes through one of three uniform paths: `navigate`, `action`, or `prompt`-fire/fill, so a dead command would have to be a bad `navigate` target or a prompt the model can't act on, neither checked per-command in this pass).
**A** Two full-bleed overlay layers exist (`z-180` reasoning trace, `z-200` realtime voice) on top of the base chat surface -- more overlay depth than any other audited page.

### 8. Home vs `/chat` -- composer comparison
| | Home (`components/home/nick-command-line.tsx`) | Full Chat (`features/chat-v2/`) |
|---|---|---|
| Transport | `useChat` + inline `new DefaultChatTransport({api:"/api/ai/chat", body:{privateMode:true}})` (`nick-command-line.tsx:101-108`) -- privateMode is HARDCODED true, always | `useChat` + `useChatTransport({apiPath:"/api/ai/chat", ...})` (`use-chat-stream.ts:107-108`) -- privateMode is a user-toggleable store flag, false by default |
| Conversation persistence | Detached always -- comment (`use-chat-stream.ts:47-49`) confirms Private Lab (which Home's fixed `privateMode:true` matches) sends no `conversationId`, "no rows can be conversation-scoped" | Persists to a real `conversationId` (from `useChatUiStore`), with full history via `trpc.chat.*` (list/rename/delete/pin/archive) |
| `useChat` id | fixed string `"nick-command-line"` (`nick-command-line.tsx:111`) -- a single ephemeral thread, not tied to any conversation row | tied to `activeConversationId` state, switchable via the History drawer |
| Context injected | none found beyond the raw prompt + slash prefix -- no `contextRoute`/page-anchor body fields in `nick-command-line.tsx` (**H**, not exhaustively diffed against the transport hook's body-shipping logic) | `PageContextBridge`-sourced anchors (`lastTaskId`, `lastGoalId`, etc. -- `use-chat-stream.ts:17-27`) plus `contextRoute`, `posture`, `depth`, `turbo`, `actionPermission` -- substantially richer body |
| Same conversation model? | **No** -- Home's composer is architecturally a separate, always-private, always-freshly-mounted thread; it cannot resume or be resumed by a full-chat conversation (**A**, from the `privateMode:true` hardcode + fixed `useChat` id) |
| Slash commands | 5, hardcoded prefixes only: `/task /capture /search /review /execute` (`nick-command-line.tsx:57-63`) -- `/search` is the only one that navigates instead of chatting | 49, three behavior classes (navigate / action / prompt) (`hooks/use-slash-commands.ts`) |
| Voice input | Deliberately absent -- comment explicitly cites the dead whisper key as the reason NOT to ship a mic control here (`nick-command-line.tsx:26-29`) | Present (`Mic` button), routes through the STT fallback chain discussed above |
| Response rendering | Inline, ephemeral, below the composer, cleared on next page load (no persistence) (`nick-command-line.tsx:200-227`) | Full scrollback list, persisted, with per-message action sheet, reasoning trace, citations, tool-result cards |

**Net:** Home's Nick line and the full Chat page are the SAME underlying `/api/ai/chat` endpoint and the same `ai-sdk` `useChat` primitive, but they are NOT the same conversation model -- Home is architecturally locked to an ephemeral, unpersisted, always-private single-shot thread, while Chat is the full persisted-conversation experience. An operator typing into Home never sees that history again once they navigate away; the "Morning brief" chip's WAKE_MESSAGE turn is invisible to full Chat's history drawer for the same reason.

---

## SURFACE: `/missions` — "Execution Deck"

### 1. JOB + component tree
**A** `app/(mastery)/missions/page.tsx:3-25` header comment: "the working surface of the personal OS, complementary to Home's Command Surface (Home = what needs judgment; here = do the work and manage the queue)." Nine fixed sections in attention order (Next Move, readiness, triage/DECIDE, capture, MISSIONS board, LANES, RHYTHMS, WAITING, DONE TODAY). The same comment documents what was deliberately REMOVED in the 2026-09-01 rebuild: "the LVL/XP pill (mis-aggregated, reader-less ... the on-page AI brief (Home compiles THE brief), the always-on readiness strip, the RPG copy, and the level-up modal" -- one gamification element survives ("the completion sparkle on the row checkbox").

Tree (2 levels), from `missions/page.tsx`:
```
MissionsPageInner (Suspense-wrapped)
├─ HiddenRiskWarning        (filter-hidden-task warning banner)
├─ [executionModeActive] -> ExecutionPanel  (single focused task, full-screen-ish)
└─ [else] ->
   ├─ OmniCaptureModal, NickSidePane, CoachEventBanner
   ├─ DeckNextMove           (1 · the recommended move)
   ├─ DeckReadinessLine      (2 · renders null unless exception/unknown)
   ├─ DeckTriage             (3 · airlock, has its own 2-tap delete confirm)
   ├─ MissionsQuickAdd       (4 · capture)
   ├─ [+new mission / Focus / Filters buttons], TaskFilters, ActiveFiltersStrip
   ├─ MissionFeed            (5 · board, WIP-capped user projects)
   ├─ DeckLanes, DeckRhythms, DeckWaiting, DeckEvidence  (6-9)
   └─ MissionModalsManager   (MissionRetroModal, MissionEditDrawer, TaskEditSheet)
```

### 2. DATA READS
**A** `app/(mastery)/missions/hooks/use-missions-data.ts:22-45`:
| Query | Interval |
|---|---|
| `trpc.task.deck.useQuery` | `staleTime:20_000`, `refetchInterval:45_000`, `refetchOnWindowFocus:true` |
| `trpc.task.list.useQuery({})` | `refetchInterval:30_000`, no window-focus refetch (comment: slowed 15s->30s since the deck now carries fresh-scored ordering) |
| `trpc.task.missions.useQuery` | `refetchInterval:30_000` |
| `trpc.operator.commandCenterState.useQuery` | `staleTime:30_000` |

**Fixed anti-pattern, cited in code (2026-09-01, one day before the audited deploy)**: the same file's header comment documents THREE removed reads: `system.healthSummary` ("its read performed a bodyTracking UPSERT on every 30s poll -- a write-on-read"), `operator.characterSheet` ("fed a header LVL/XP pill that summed five per-domain levels ... into a number nothing read"), `task.byId(?taskId=)` ("fetched and discarded; no consumer ever read the result"). A genuine write-on-a-GET-style bug and two dead reads were removed together (**A**, doc-comment evidence only -- not diffed against a prior commit to independently confirm the "before" state, so the bug's existence is class **H** relative to this snapshot, but its ABSENCE now is directly observable **A**).

Mutations, `app/(mastery)/missions/hooks/use-mission-actions.ts:28-36`: `trpc.task.create/update/check/delete/createMission/decompose/reorderMission/reorderTask/park` -- nine mutations, one hook.

### 3. CONTROLS
- **DeckTriage delete -- proper 2-tap confirm.** `components/missions/deck-triage.tsx:34,103-112`: local `confirmDelete` state arms on first tap, a distinct "confirm ✕" label appears, second tap calls `onDeleteTask`. This is the correct iOS-PWA-safe pattern (no `window.confirm`) -- **a useful positive contrast to the /chat conversation-delete finding, which has no confirm step of any kind.** `handleDeleteTask` itself (`use-mission-actions.ts:174-185`) is a bare mutation call with no confirm inside the hook -- the confirm gate lives entirely in the CALLING component (DeckTriage does it; verify per-caller, not assume-by-hook).
- **`mission-edit-drawer.tsx:66` and `task-edit-sheet.tsx:95`** both carry a comment "iOS-PWA-safe confirm -- window.confirm() is silently suppressed in ..." confirming custom in-DOM confirms are used, not the native dialog (not read past the comment to verify the exact replacement widget in each file).
- **Pick Different** (`missions/page.tsx:132-140`, `handlePickDifferent`) -- does NOT call a mutation; it only sets local `queuedTaskId` state and shows `toast.success(...)`. This is queue-selection UI state, not a persisted decision -- reasonable given its role (a client-side queue pointer), but flagged per the audit's "handler that only sets local state or toasts" criterion.
- **Queue Next** (`:182-186`, `handleQueueNext`) -- same shape: local state + toast, no mutation.
- **ExecutionPanel remount-per-task** (`:225-229`) -- `key={focusedTask.id}` with an explicit comment: "the poll can swap focusedTask while an abandon/block/snooze confirm is open -- without a key the open confirm silently rebinds to the NEW task." A concrete, already-fixed confirm-integrity bug class (background poll rebinding an open destructive-action confirm to a different target object).

### 4. STATES -- same doctrine as Home, independently implemented
**A** `missions/page.tsx:270-273`: `` deckQuery.isError && <p>Deck unreadable — the read failed. State unknown, not empty.</p> ``
**A** `missions/page.tsx:399-404` (via `mission-board-read-state.ts`, `boardReadState === "unreadable"`): `` <p>Board unreadable — reads failed. State unknown, not empty.</p> `` with an adjacent comment: "Unknown-is-not-empty (2026-08-19): a failed task/mission read used to fall through to `<EmptyMissions />` -- a dead fetch rendered as a cleared board." **This is a named, dated instance of exactly the failure mode this audit was asked to hunt for (a failed read rendering as empty/healthy) -- confirmed FIXED, with the fix's own comment naming the prior bug.**
**A** `missions/page.tsx:407-410`: a distinct amber "stale" state -- `` boardReadState === "stale" && <p>Showing the last confirmed board — the latest refresh failed.</p> `` -- three-way state (fresh / stale-but-shown / unreadable) mirrors Home's `unreadable`/`refreshFailed` split.
**A** `missions/page.tsx:442-446`: `` deck.unmeasured.length > 0 && <p>unmeasured this pass: {deck.unmeasured.join(" · ")}</p> `` -- server-side partial-failure is named per-source, not silently dropped.
**A Traced: "HEALTH DATA IS 71 DAYS OLD"** (matches LIVE OBSERVATION exactly). `lib/missions/deck.ts:538-539`: `` age === null ? "No health log yet — readiness unknown." : `Health data is ${age} day${age === 1 ? "" : "s"} old — readiness unknown.` `` -- rendered by `DeckReadinessLine` (`components/missions/deck-readiness-line.tsx:13-27`), which itself documents its own predecessor bug: *"Replaces the always-on governor strip that printed 'Readiness: 96/100' off a health log of unbounded age"* (`:6-9`). The OLD always-on strip (`components/missions/health-governor-strip.tsx`) still exists in the tree but is now mounted only on `/stats` (`components/stats/body-section.tsx` -- confirmed via grep, zero other mounters) -- it was not deleted, just relocated off Missions.

### 5. AI CHROME
**A Traced: "today: 0 chosen · 0 min"** (matches LIVE OBSERVATION). `components/missions/deck-next-move.tsx:66`: `` today: {capacity.chosenCount} chosen · {minutesLabel(capacity.chosenMinutes)} ``, fed by `deck.capacity` from the server (`use-missions-data.ts` deck query).

**A Traced: "Fix basement bathroom ceiling … untouched 47d · roi 25 → 33"** (matches LIVE OBSERVATION). The `why` string is built server-side in `lib/scoring/task-priority.ts:243-262` and rendered via `deck-next-move.tsx:96` (`task.why.replace(/^picked because: /, "why: ")`). Exact construction: `parts` array conditionally includes `$dollars`, `overdue Nd`/`due in Nd`, `in progress`, `waiting on X`, `` `untouched ${touchDays}d` `` (only when `touchDays >= 3`), `habit ×N`, `shop ×N`, `mission #N`, and `` `roi ${task.roiScore}` `` (only when `roiScore !== 50`, i.e. non-default) -- joined by `" · "`, then the whole thing suffixed `` ` → ${score}` `` where `score` is the FINAL weighted-and-multiplied priority score. **Precision note**: "roi 25 → 33" is NOT the ROI score changing from 25 to 33 -- it is two different numbers: `task.roiScore = 25` (one term in the explanation) and `33` = the task's total computed priority score after all weights/multipliers (`task-priority.ts:240`). A reader could easily misparse "roi 25 → 33" as "ROI went from 25 to 33"; it did not -- the arrow separates the reason list from the unrelated final score.

**No fabricated confidence found**: the `why`/`explanation` string is entirely arithmetic-and-label based (dollar amounts, day counts, named multipliers) -- no percentage or probability is shown alongside the Next Move recommendation, consistent with Home's "no fabricated confidence" doctrine (not independently re-quoted from a doctrine comment in THIS file -- inferred from the string's own construction, class **H**).

**Gamification**: per `missions/page.tsx:20-24`, the LVL/XP pill and RPG copy were REMOVED (comment states the pill was "mis-aggregated, reader-less"); one element survives -- "the completion sparkle on the row checkbox" (not independently located/read this pass).

**NickSidePane presets** (`missions/page.tsx:263`): `["What's my next move and why?", "Which mission is stalling?", "Draft a plan for my top mission.", "What did I finish this week?"]` -- static array, same shape as the Chat empty-state `COMMANDS` array (not traced further whether NickSidePane shares the /api/ai/chat pipe -- **H**, presumed yes given the naming and prior pattern, not independently confirmed by reading `NickSidePane`'s own source in this pass).

### 6. MODALS/SHEETS/DRAWERS
`MissionModalsManager` (`app/(mastery)/missions/components/mission-modals-manager.tsx`) mounts three: `MissionRetroModal`, `MissionEditDrawer`, `TaskEditSheet` (imports confirmed at `:5-7`). `OmniCaptureModal` is mounted directly in the page (`:259`). Z-index values not individually checked this pass for these four (**NOT VERIFIED**).

### 7. Density/hierarchy
**A** Nine stacked sections, each conditionally rendered only when its data source has content (`deck &&` guards throughout, `:275-446`) -- sections collapse to zero height rather than reserving empty-state chrome, matching Home's pattern. `MissionsPageSkeleton` (`:456-467`) uses matched-width shimmer blocks specifically to avoid a hydration layout jump (comment: "Same width as the page (max-w-5xl) -- a narrower skeleton made the layout visibly jump on hydrate"). Execution Mode (`executionModeActive`) is a genuinely distinct density mode -- it hides the `PageHeader` and collapses the entire 9-section deck down to one `ExecutionPanel` for a single focused task, the most restrictive density state found on any audited surface.

---

## SURFACE: `/journal`

### 1. JOB + component tree
**A** `app/(mastery)/journal/page.tsx:42-48` -- `SectionHeader` subtitle: "thinking · reasoning · insights · decisions · reflections". Desktop split-pane: composer left (7 cols), an "Intelligence & Context" HUD right (5 cols, sticky), feed below the composer. Comment at `:53-67` documents a 2026-07-15 UI-audit fix: pre-fix the whole intelligence column stacked BELOW the entire feed on mobile (the operator's primary device), making it "effectively invisible" -- the 3-child grid reorder now puts it 2nd on mobile.

Tree (2 levels):
```
JournalPage
├─ JournalPageInner (Suspense)
│  ├─ SectionHeader, MissionBreadcrumb, CoachEventBanner
│  ├─ ReflectComposer          (left: entry composer)
│  ├─ JournalInsightsView      (right, sticky: brief + prompt + threads + insights + metacognition + radar/rail/suggestions + NotebookLM zone)
│  └─ JournalFeedView          (below: paginated entry feed)
└─ NickSidePane (page="journal", 4 static presets)
```

### 2. DATA READS
| Query/Mutation | File:line |
|---|---|
| `trpc.journal.feed.useInfiniteQuery` | `_hooks/use-journal-feed.ts:34` (cursor pagination) |
| `trpc.journal.reflect.useMutation` | `reflect-composer.tsx:137` (entry submission) |
| `trpc.journal.ghostCounterQuestion.useQuery` | `reflect-composer.tsx:550` |
| `trpc.journal.contradictionsForEntry.useQuery`, `savePrediction`/`confirmLink`.useMutation, `journal.receipt.useQuery` | `entry-row.tsx:274,320,417,500` |
| `trpc.journal.insightsPreview.useQuery`, `promoteNextAction.useMutation` | `journal-insights-preview.tsx:96,106` |
| `trpc.journal.threads.useQuery` | `journal-threads-strip.tsx:86`, also `thread-rail.tsx:59` |
| `trpc.journal.calibrationSamples.useQuery`, `calibrate.useMutation` | `memory-calibration.tsx:67,97` |
| `trpc.journal.metacognition.useQuery` | `metacognition-card.tsx:17` |
| `trpc.journal.convergence.useQuery`, `runConvergenceScan`/`createThread`/`dismissCandidate`.useMutation | `thread-radar.tsx:51,62,225-226` |
| `trpc.journal.suggestions.useQuery`, `acceptSuggestion`/`dismissSuggestion`.useMutation | `thread-suggestions.tsx:60,79-80` |
| `trpc.brain.captureThought.useMutation` | `notebooklm-context-zone.tsx:23` |
| raw `rawFetch("/api/ai/journal-brief")` | `nicks-journal-brief.tsx:34`, doc comment `:12`: "Cached daily server-side" |

### 3. CONTROLS
- **ThreadSuggestions accept/dismiss -- fixed silent-failure bug, cited in code.** Comment at `thread-suggestions.tsx:46-52`: prior to Wave R (2026-05-24) both accept/dismiss "wrapped mutateAsync in bare `catch {}` with a comment 'today: silent re-fetch' -- operator tapped a suggestion, server 401/500'd, UI just looped the same state. No log, no toast, no feedback -- indistinguishable from the mutation working slowly." Now: error logs to `/system/errors` and an inline banner surfaces the failure with a retry hint. **Directly on-point for this audit's brief** (a control whose failure was previously indistinguishable from success) -- confirmed fixed, not re-verified live.
- **ThreadSuggestions READ-path is deliberately silent on error** (`:56-58`, comment): "Errors still silently no-op (suggestions are advisory -- radar stays quiet) -- the component hides itself on loading/empty exactly as before." This is a scoped, acknowledged exception to the unknown-is-not-zero doctrine seen elsewhere -- defensible for a self-described advisory/decorative panel, but means a persistently-broken suggestions query is invisible to the operator forever (no stale-badge, no error state) (**A** for the code's own characterization; **H** for whether "advisory" fully justifies silent failure -- a judgment call, not verified against user expectations).
- **Memory Calibration verify/update/retire** (`memory-calibration.tsx:8-11`): three explicit mutation outcomes, each with a defined effect on the underlying `BrainMemory` row (`confidence+0.1`/reset to 0.8/`expiresAt=now`) -- not optimistic-only per the file's stated design (not independently re-traced into the mutation resolver in this pass).

### 4. STATES
**A** `app/(mastery)/journal/_components/journal-feed-view.tsx:129-136`: a "partial feed" banner (`` partial feed — failed source{s}: {degraded.join(", ")} ``) with an adjacent comment: "Feed v2 · degraded-source banner -- a failed silo query used to [silently drop that silo]." **This is the FOURTH independently-implemented instance of the same unknown-is-not-zero doctrine found in this audit** (Home's `operator-brief.ts`, Missions' `deckQuery`/board-read-state, and now Journal's multi-silo feed) -- strong evidence this is now a systemic, repeated pattern across the app rather than a one-off fix, though each implementation is a separate piece of code (not a shared utility -- **H**, not confirmed whether a shared helper exists vs. four independent reimplementations).

**A Traced: two DIFFERENT "confidence" concepts, worth distinguishing for the AI CHROME synthesis.** `memory-calibration.tsx:3-16` defines Journal's "confidence" as a **sighting/verification counter**, not a statistical probability: `verify -> confidence + 0.1`, `update -> confidence reset to 0.8`, `retire -> expiresAt = now`. A 2026-08-19 fix comment (`:27-29`) notes the row USED to print both `seen {seenCount}×` and `c{confidence*100}` side by side, which the fix removed because "confidence IS the sighting counter... the number dressed as a score was noise" -- i.e., a prior redundant/misleading-precision display was caught and simplified. This is a different "confidence" than Chat's judge-eval `CAL` rubric axis (an LLM's own 0-10 subjective self-rating per response, see Chat section 5) -- **neither is a calibrated probability in the statistical sense; both are labeled "confidence/calibration" to the operator without that caveat being visible in the UI itself** (the caveat exists only in source comments).

### 5. AI CHROME
**A** `/api/ai/journal-brief` has a confirmed live caller: `components/journal/nicks-journal-brief.tsx:34` (`rawFetch<{brief:string}>("/api/ai/journal-brief")`), doc comment states it is "Cached daily server-side" (`:12`, not independently re-verified for actual cache-hit behavior).
**A** `MissionBreadcrumb`, `CoachEventBanner`, `NickSidePane` are the same cross-surface AI-coaching chrome seen on Missions (`coachSurface="journal"`, 4 static presets: "What pattern keeps surfacing...", "Which blind spot am I dancing around?", "Which thread is the real story behind today?", "What would I tell a younger me about this entry?").
**A** `ThreadRadar`/`ThreadRail`/`ThreadSuggestions` implement a three-tier confidence-banded surfacing system per `thread-suggestions.tsx:3-16`: coalescing themes (top) -> pinned threads -> borderline joins (0.65-0.80 similarity band) -- the 0.65/0.80 thresholds are a real, code-defined confidence gate (cosine `similarity` field, `:32`), not a fabricated number, though the banding rationale itself is not shown to the operator in the UI (only "join or dismiss").

### 6. MODALS/SHEETS
No `Dialog|Sheet|Drawer|Popover|Modal` matches in a targeted grep of `components/journal/*.tsx` and the journal `_components` (**H**, quick grep only) -- entry actions (predict/confirm-link) appear to be inline row controls in `entry-row.tsx` rather than modal-gated. **NOT independently verified** whether any journal component opens `BrainDumpModal` or another global overlay beyond the layout-mounted ones.

### 7. Density/hierarchy
**A** Highest COMPONENT COUNT of any audited surface's single feature area: 11 files under `components/journal/` plus 3 under the route's own `_components/`, all mounted simultaneously in the sticky right column (`JournalInsightsView`: brief, today's-prompt, threads-strip, insights-preview, metacognition, thread-radar, thread-rail, thread-suggestions, NotebookLM context zone -- 9 stacked panels). Each is individually gated to render "quiet by default" (`thread-suggestions.tsx:15-16`: "All three are quiet by default. Page looks unchanged unless something fires.") -- the density risk is real (9 independently-polling panels in one sticky column) but each is designed to collapse to nothing when empty, similar to Home/Missions' null-render pattern (**H**, not every one of the 9 individually confirmed to null-render).

---

## SURFACE: `/stats`

### 1. JOB + component tree
**A** `app/(mastery)/stats/page.tsx:3-24` -- consolidates the retired `/scoreboard` + `/goals` + `/body` + `/life` + the `/learn` active-loop into one personal "me" surface. Operator quote embedded in the comment (2026-05-30): *"business shit belongs on nicks tire admin ... this page is about Nour: who he is, what he's climbing toward, his body, his learning."* Five tabs (`page.tsx:123-129`): Mastery, Goals, Body, Learning, Calibration. `resolveStatsTab()` falls back to the first tab on an unknown `?tab=` (e.g. a retired `/business?tab=money` deep link) instead of rendering an empty body -- comment cites issue `#2069`.

Tree (2 levels), mastery tab only (the default, matches LIVE OBSERVATION context):
```
StatsContent
├─ tab bar (sticky, z-20)
└─ [mastery tab]
   ├─ LevelUpDirectiveCard, IdentityArcCard   (lazy, ssr:false)
   ├─ RecurringEnemiesCard, GraduatedSkillsCard (lazy)
   └─ CharacterSheet                           (the RPG "hero" stat sheet)
[goals tab]   -> GoalBoard, ForecastDuel
[body tab]    -> BodySection (lazy)
[learning tab]-> LearningLoop / KommandoLearn (lazy)
[calibration tab] -> CalibrationSection (lazy, 962 lines)
```
Plus page-level: `CoachEventBanner`, `MissionBreadcrumb`, `NickSidePane`, `JourneyPanel`.

### 2. DATA READS
| Query/Mutation | File:line |
|---|---|
| `trpc.operator.characterSheet.useQuery` | `character-sheet.tsx:54` |
| `trpc.intelligence.calibrationReviews.useQuery` | `calibration-section.tsx:70`, `staleTime:60_000`, `refetchOnWindowFocus:true` |
| `trpc.intelligence.resolveCalibration.useMutation` / `bulkResolveCalibration.useMutation` | `calibration-section.tsx:93,103` |
| `GoalBoard` self-fetches `/api/goals` per `page.tsx:53` comment (not independently re-verified) | |
| Body/Learning sections self-fetch independently (not traced this pass -- **NOT VERIFIED**) | |

### 3. CONTROLS
- **Calibration Approve/Correct/Reject** (`calibration-section.tsx:118-132`, `handleResolve`) -- per-item mutation, no confirm dialog, but scoped to one prediction-review row at a time (low blast radius).
- **Bulk Approve-Low-Risk / Reject-Stale** (`:134-141`, `handleBulkAction`) -- `trpc.intelligence.bulkResolveCalibration.useMutation({action: "approve_low_risk"|"reject_stale"})` fires with **no client-side confirm** before a potentially multi-row mutation. Mitigated by server-side action naming that scopes it to "low risk" / "stale" items rather than an unscoped bulk-approve-all -- lower severity than the Chat delete-conversation finding (that one is unscoped, single-tap, irreversible; this is a named, pre-filtered batch action) (**A** for the code shape; **H** for how "low risk"/"stale" are actually defined server-side -- not traced into the resolver).
- No `window.confirm/alert/prompt` found in `calibration-section.tsx` or `character-sheet.tsx` (grepped).

### 4. STATES
**A** `character-sheet.tsx:22` doc comment: *"Degradation: self-hides on a transient query error (never breaks the [page])"* and code at `:92-98` renders a distinct error card (`message={query.error.message || "Stats data is unavailable right now."}`) rather than a blank or zeroed sheet -- consistent with the unknown-is-not-zero pattern seen elsewhere, independently implemented a fifth time.
**A** Same file, header comment: *"Self-hides on error · honest Day-1 zero"* (`page.tsx:44`) -- a genuinely-zero stat (a brand-new stat with no reps logged) is intended to render as an honest zero, distinguished from an unreadable query (which self-hides/errors instead of showing a fake zero). Not independently re-traced past the doc comment to the exact zero-rendering branch in this pass.

### 5. AI CHROME -- gamification is concentrated here, not removed app-wide
**A Important contrast with Home/Missions.** Both Home and Missions explicitly REMOVED RPG/XP/level chrome (see those sections). `/stats` is where it was consolidated instead: `character-sheet.tsx:6-10` -- *"Renders every mastery stat as an RPG-style level card -- icon, tier, big level number, an XP progress bar in the stat's own color, 'X / Y XP to Lvl N+1' ... the total-level metaphor (RuneScape-style) the operator asked for."* This is an intentional, operator-requested design, not leftover debt.

**A Traced, precise finding: the "mis-aggregated" total-level pattern Missions removed is still the headline number on /stats.** Missions' `use-missions-data.ts` header comment (see Missions section 2) says the OLD header LVL/XP pill was removed because it "summed five per-domain levels (baseline floors included) into a number nothing read," and states "/stats keeps the honest per-stat sheet." Checking that claim against `lib/mastery/character-sheet.ts:106-111`: each stat's `xp`/`level` is computed as `` baselineXp = xpForLevel(baseline self-rating) ``, then `` xp = baselineXp + earned `` -- i.e. **every per-stat level already includes its baseline floor**, exactly the characteristic the Missions comment flagged. `character-sheet.tsx:122-125` then sums these baseline-inclusive per-stat levels into one `totalLevel` (*"Total level -- the classic RPG aggregate. Sum, not average, so every level in every stat visibly counts toward one number"*) and displays it as the page's "overall-power hero" (`stats/page.tsx:8`). **So the Missions comment's claim that "/stats keeps the honest per-stat sheet" is accurate for the PER-STAT figures, but the SAME baseline-inflated-then-summed pattern the old pill was criticized for is still the flagship number on /stats -- it was relocated and given a real reader (this page), not corrected at the math level.** This is not necessarily a bug (baseline-seeded leveling may be the intended design), but it means the specific "mis-aggregated" characterization from the Missions removal comment does not fully hold once you follow the same sum onto /stats -- worth the operator's attention if "total level" is meant to represent pure earned progress rather than progress-plus-starting-point.

**A Traced, precise finding: THE genuinely calibrated confidence system in the app lives in `CalibrationSection` (`components/stats/calibration-section.tsx`), and it is real statistics, not a label.** `Scoreboard` interface (`:50-61`): `predictionCount30d`, **`rollingBrier30d`** (a real Brier score -- the standard proper scoring rule for probabilistic forecast calibration), `predictionAccuracyPct`, `taskRoiMae30d` (Mean Absolute Error), `taskRoiBias30d`, `taskOverestimateRate30d`, and two named verdicts: `calibrationVerdict: "well-calibrated"|"moderate"|"drift"|"unknown"` and `biasVerdict: "calibrated"|"overconfident"|"underconfident"`. Backed by `trpc.intelligence.calibrationReviews` comparing each `CalibrationReviewItem`'s `predictedOutcome` against its `approvedActualOutcome`/`accuracyScore` (`:31-46`) -- i.e. actual predictions the operator or Nick made, later graded against what really happened.

**Synthesis across all four audited surfaces: three unrelated things are all called "confidence" or "calibration" in this app, only one of which is a statistical calibration measure.**
1. Chat's reasoning-trace-modal "CAL" axis (`components/chat/reasoning-trace-modal.tsx:37-39,190`) -- an LLM judge's own 0-10 subjective self-rating per response, explicitly excluded from the composite score.
2. Journal's memory "confidence" (`components/journal/memory-calibration.tsx:8-16`) -- a manually-incremented sighting/verification counter (+0.1 per "verify," reset to 0.8 on "update"), not a probability.
3. **Stats' `CalibrationSection`** -- the one real implementation: rolling Brier score + accuracy % against actual graded outcomes.
None of the three is cross-referenced to the others in the UI -- an operator reading a "confidence" or "calibration" figure on one surface has no way to know, from that surface alone, which of these three very different things it is.

### 6. MODALS/SHEETS
Not exhaustively grepped this pass (**NOT VERIFIED**) -- `calibration-section.tsx` imports `Card`/`Badge`/`Button`/`Separator` (inline components, not overlay primitives); no `Dialog`/`Sheet` import seen in the files read.

### 7. Density/hierarchy
**A** Five lazy-loaded (`next/dynamic`, `ssr:false`) heavy sections (Body/Learning/CalibrationSection/IdentityArcCard/RecurringEnemiesCard/GraduatedSkillsCard) each with a bespoke shimmer fallback shaped to match their real content's height (`page.tsx:63-70,105-119`) -- explicit intent to avoid hydration layout jump, the same concern cited on Missions' page-width skeleton. `CalibrationSection` alone is 962 lines -- the single largest component file encountered in this audit, mixing a scoreboard, a review queue, per-item correction forms, and bulk actions in one file.

---

## app/(mastery)/error.tsx and app/not-found.tsx

**A** `app/(mastery)/error.tsx:1-47` -- Next.js route-segment error boundary (outer-most catch for the (mastery) group). Renders a clean two-escape recovery UI ("Try Again" -> `reset()`, "Back to home" -> `/`), with an explicit comment justifying both options: "a non-recoverable error (bad deploy, missing env) isn't a retry trap" (`:29-30`). **Only logs via `console.error` (`:15`) -- does NOT post to `/api/errors`.** This differs from the INNER `ErrorBoundary name="mastery.page"` mounted by the layout around `{children}` (`app/(mastery)/layout.tsx:109-111`), which per its own comment DOES "auto-report to /api/errors -> visible in /system/errors." Since `error.tsx` only fires for errors that escape the inner boundary (a rarer case, as the inner boundary wraps the same content), this is a narrow, low-likelihood gap: an error severe enough to blow past the inner `ErrorBoundary` is logged to the browser console only, not to the operator-visible `/system/errors` surface (**H** -- the exact conditions under which a Next.js segment `error.tsx` fires vs. an inner React error boundary catching first were not independently verified against React/Next error-boundary semantics in this pass).

**A** `app/not-found.tsx:1-24` -- simple, on-brand 404: `PageHeader` ("That screen does not exist.") + one `Panel` with a single "Back to Command Center" link to `/`. No data reads, no client-side logic (not a client component). No mention of what route was requested (no `usePathname()` echoed back to the operator or logged) -- a broken/mistyped deep link gives no diagnostic trail beyond the browser's own address bar (**H**, minor, not verified whether server-side request logging captures 404s elsewhere e.g. middleware or infra logs).

---

## CROSS-CUTTING PATTERN (positive, spans 5 independent implementations)

**A** The exact "a failed read must render as UNKNOWN, never as empty/zero/healthy" doctrine appears, independently coded, in at least five places across the four audited page surfaces plus the shared scoring layer:
1. Home: `lib/home/operator-brief.ts:11-14` (doctrine comment) + `home-console.tsx:46-49,59-83` (`unreadable`/`refreshFailed` split) + `judgment-queue.tsx:113-115`.
2. Missions: `missions/page.tsx:270-273` (deck) and `:399-410` (board, with a named prior-bug comment) + `deck-readiness-line.tsx:6-9` (replaced an "unbounded age" always-on strip).
3. Journal: `journal-feed-view.tsx:129-136` (per-silo degraded-source banner).
4. Stats: `character-sheet.tsx:22,92-98` ("self-hides on a transient query error... honest Day-1 zero").
Each is a SEPARATE implementation (different component, different wording) rather than one shared utility -- meaning the pattern is a well-internalized team norm post-2026-08-19-through-09-01 audits, but also that a SIXTH surface not yet touched (e.g. `/people`, `/brain`, `/system/*`) is not guaranteed to have it just because these four do (**H**, scope of this audit did not extend there).

## NOT VERIFIED (would require runtime, a broader grep, or a deeper read than this pass afforded)

- Whether `GROQ_API_KEY` / `HF_API_KEY` are actually set in the live Railway env right now, i.e. whether the chat mic button's STT fallback chain (`lib/ai/stt.ts`) is presently functional in production or falling through to the 502 "every lane failed" branch. Code shows the chain exists; only a live probe can confirm which lane answers today.
- Whether "181" is today's true `TOOL_CATALOG.length` -- the derivation is mechanically correct (`lib/services/tools-health.ts:177-180`) but the exact number was not recomputed from the snapshot's `catalog.ts` in this pass.
- Z-index / trigger audit for Missions' `MissionRetroModal`, `MissionEditDrawer`, `TaskEditSheet`, `OmniCaptureModal`; Journal's entry-row inline predict/confirm-link controls; Stats' calibration correction-form overlay (if any) -- component existence confirmed, internals not read.
- `NickSidePane`'s actual transport/endpoint -- assumed (by naming and pattern) to be the same `/api/ai/chat` pipe used elsewhere; not opened and independently confirmed.
- Global overlay internals grepped but not read line-by-line: `NeuralBackground`, `AmbientAura`, `sw-register`, `PageContextBridge`, `ErrorBoundary`, `DeepModeNudge`, `BrainDumpModal` (beyond its one `captureThought` mutation) -- confirmed no `useQuery`/`useMutation`/`window.confirm` via grep, but not read for other risk (e.g. unguarded `localStorage`/`fetch` calls the grep patterns wouldn't catch).
- Whether `email-draft-card.tsx`'s destructive action (referenced at `:81`, "window.confirm is suppressed") has a real replacement gate or is a second no-confirm control like the chat conversation-delete -- only the comment was read, not the surrounding handler.
- Per-command correctness audit of all 49 Chat slash commands (each command's target tool/route actually working) -- only the three routing SHAPES (navigate/action/prompt) were verified, not each of the 49 individually.
- Server-side definitions of `bulkResolveCalibration`'s `"approve_low_risk"`/`"reject_stale"` scoping logic on `/stats` Calibration tab.
- `GoalBoard`, `BodySection`, `LearningLoop` (all on `/stats`) -- not opened in this pass; their data reads, controls, and states are unaudited.
- Exact React/Next.js precedence between the inner `ErrorBoundary name="mastery.page"` and the outer `app/(mastery)/error.tsx` segment boundary -- flagged as a possible logging gap but not verified against framework semantics.
- Whether each of Journal's 9 sticky-column panels individually null-renders when empty (confirmed for `ThreadSuggestions` only, by comment).

## STATUS: COMPLETE

