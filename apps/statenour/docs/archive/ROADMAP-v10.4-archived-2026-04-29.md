# NOUR OS v10+ Roadmap — The Devastating Lead Playbook

**Last updated:** 2026-04-20 (session-end after v10.4 bridge layer + signal unification)
**Owner:** Nour Dean
**Mission:** Top spot in power. Devastating lead. Every interaction wins.
**Rules:** No agents for detail work. Interesting data + clever ideas inside/outside the box. Power + control — nothing missing. Thorough — good enough is NOT good enough. Never assume — verify history, archives, code, DB, logs. Wire principles everywhere. Continuous reinforcement.

This file is the **operational memory** for everything the chat can't
hold. Keep it updated. Another agent (or future me) can pick up from
any checkpoint here without losing context.

---

## ✅ Shipped — 2026-04-20 evening (v10.4 bridge + signal unification)

### Structural collapses
- **HQ: 7-card stack → 1 Situation card** (`/api/ultron/situation`,
  `lib/ultron/situation-synthesizer.ts`, `SituationCard`) with
  severity ranking, cross-source dedupe, ambient monitors, expand
  drawer. NarratorStrip + GhostNickStrip + BetDesk + BrainCarousel
  + MemoryCalibration + Rumination + TomorrowNote + ReflectNudge
  unmounted. Ghost Nick folded as a ghost-source candidate.
- **/tasks: 5 tabs → 4 tabs**. LEARN and REVIEW collapsed (identical
  render); LEARN absorbed the REVIEW intent via `<DailyBriefSection>`
  with time-of-day aware morning/midday/afternoon/evening/late
  briefs pulling from pulse-digest + cron reports.
- **Goal ↔ Project bridge on /tasks** — goal cards show linked project
  chips or "Plan it" seed; project cards show goal breadcrumb or
  `<LinkGoalPicker>` for one-click assignment. NEEDS ATTENTION
  callout retired.

### New capabilities
- **setTaskPriority tool** (Tier 1.8) — natural-language retag via
  chat with manualPriorityOverride + autoPriority + reason logging.
- **Chat export in header** — markdown + JSON on the current convo.
- **Mode pill shows ran-mode** via X-Nick-Mode response header.
- **Stream-stall reframe** — "thinking deeper · N tools pending" on
  `useStallDetection` warn/stalled.
- **Expandable tool cards** — `▸ raw output` reveals full JSON payload.

### Observability
- **16 synthesizer unit tests** (ranking / dedup / synthesis / monitors).
- **Suggestion metric persistence** — SystemMetric rows per request;
  `/api/ai/chat/suggestions/stats` returns live + history24.
- **Lane-check feedback loop** — tap/dismiss persists to SystemMetric
  for later regex tuning.
- **Auto-calibrate dry-run script** — `npm run calibrate:dry`.

### Infrastructure
- **Prefetch rate-limit fix** — per-tab client-id via sessionStorage,
  `X-Prefetch-Client-Id` header. Two Nours on same IP no longer
  cancel each other out.
- **Build-break fix** — `lib/ai/chat-mode-detect.ts` split unblocked
  11 stuck deploys (Turbopack was pulling googleapis → child_process
  into the client bundle via a lazy require inside pruneTools).
- **BrainMemory pinned index applied to Neon** — raw SQL via
  `scripts/add-pinned-index.ts` since `prisma db push` was blocked
  by legacy-table drift.

### Dead code sweep
- Deleted 7 components (bet-desk, brain-carousel, rumination-card,
  tomorrow-note, reflect-nudge, narrator-strip + empty dir, nick-
  noticed). Confirmed zero live imports before deletion.

### Commits (14 atomic)
```
cb0849f  feat(ai): setTaskPriority tool
2deecd7  feat(chat): stall reframe + expandable tool cards
5085ab2  feat(audit): prefetch client-id + lane feedback + dry-run
c3e74df  test(brain): 16 unit tests + suggestion metric persistence
aa33106  chore(cleanup): retire 7 dead components + fold Ghost Nick
73ec442  feat(chat+tasks): mode-ran + link-goal + export + ancestry
7171d11  feat(tasks): 5→4 tabs, LEARN+REVIEW merged with daily brief
2bde50a  feat(tasks): Goal ↔ Project bridge
2587d4b  fix(build): split chat-mode client detector [CRITICAL]
169f6e3  feat(chat): lane-correction chip + endpoint hygiene doc
af27150  feat(hq): unified Situation layer — one card replaces the 7-stack
df4c63f  fix(audit): wire dead writes + retire NickNoticed + apply pinned index
50e0a15  feat(hq): chat export + alive-UI starter + CHANGELOG v10.3
(+ earlier v10.3)
```

---

## ✅ Shipped — 2026-04-20 session (v10.2 + pins polish)

### Intelligence + control layer (v10.2)
- **Mode pill** — `components/chat/mode-pill.tsx` + chat-page wire. Live auto-detected mode shown, tap to force override. `body.modeOverride` already honored by route.
- **Smart replies** — `components/chat/smart-replies.tsx` + `/api/ai/chat/suggestions`. Venice-backed with heuristic fallback, 60s server cache, 3-chip row under the last assistant message, hides while typing or for short acks.
- **Pin-to-memory** — 📌 on every assistant message → `/api/brain/pinned` POST → `BrainMemory pinned_user` at confidence 1.0 + `expiresAt=null`. Idempotent (repin reinforces). Embedding fires.
- **Time-of-day + mission + stale-pin openers** — `/api/ai/chat-openers` reads top Mission (MIT surrogate), stale pins (>14d), phase-of-day task framing. Copy rotates by morning/afternoon/evening.
- **Pinned context injection** — `lib/ai/system-prompt.ts` reads top 5 pins every turn, renders "Pinned by Nour" block above hot-rules window. Label metadata surfaces as parenthetical.
- **sendOrQueue complete wiring** — every text-based sendpath on the chat page (reword, voice, `?q=`, flow start, undo, quick-actions, edit-resend, smart-reply tap) now respects `navigator.onLine` and queues offline.

### Pin management + cache warming (this afternoon's work)
- **PinnedContextPanel** on `/brain` — full CRUD (list / edit / label / unpin / reinforce). Live stats strip: fresh/stale/very-stale, estimated prompt tokens, injection cap indicator, over-cap warning. Staleness ring color: gold → amber (14d) → red (30d). Add-new drawer for typing pins directly from /brain.
- **/api/brain/pinned upgrades** — GET `?withStats=1` returns source breakdown + token estimate + oldest pin date. PATCH endpoint (edit content / label / source with re-embedding). Content cap raised to 2000.
- **Long-press pin wired to permanent** — `MessageActionSheet` Pin action now writes both the session pin AND `/api/brain/pinned`. Before this, long-press only updated ephemeral session state.
- **Suggestion cache server-side warm** — chat route `onFinish` primes heuristic suggestions into the `/api/ai/chat/suggestions` 60s cache while the lambda is hot. SmartReplies hit cache on first mount → instant render.
- **Suggestion cache client-side warm** — `hooks/use-suggestion-warm.ts` fires a `keepalive:true` POST 150ms after stream ends, before SmartReplies' 250ms mount delay. Belt-and-suspenders.
- **Cmd+Shift+P** → `/brain#pinned-context` + gold-ring pulse on arrival. Cheat sheet (Cmd+/) now documents Cmd+F / ⌘I / ⌘⇧L/D/V/P/T/E.

### Commits pushed to `codex/ollama-local` (2026-04-20 cluster)
```
8ee2d36  feat(chat): suggestion cache client-side warm + Cmd+Shift+P pin jump
3e15f20  feat(brain): pinned context panel + long-press pin + suggestion cache warming
da21098  docs: CHANGELOG v10.2
ab83ecc  feat(chat): route all send sites through sendOrQueue
ac9765a  feat(chat): pinned context slots injected into system prompt
5bd0cbf  feat(chat): time-of-day + mission + stale-pin starter openers
b6ae344  feat(chat): pin any assistant message as permanent context
de331a4  feat(chat): smart reply suggestions under latest assistant message
5ded0f1  feat(chat): mode indicator pill + manual override
```

---

## ✅ Previously shipped — 2026-04-15 v10.1

### Permanent principles (3-layer redundancy)
- `~/.claude/projects/C--/memory/feedback_work_style_v2.md` — file memory
- `lib/ai/system-prompt.ts` — hardcoded "Nour's Permanent Working Principles"
- 7 BrainMemory rows at confidence 1.0, category `feedback` (`principle_*` keys)

### Chat performance overhaul (8-item list)
- **Parallel prefetch**, **Predictive tool pre-routing**, **Conversation compression**, **Mode-based `maxOutputTokens`**, **Optimistic UI prefetch**, **Progressive tool rendering**, **Chat history search (Cmd+F)**, **Offline queue + smart reconnection**.

---

## Tier 1 — Next (this week) — highest bang-for-effort

Items shipped in v10.2 have moved to ✅. These are the aggressive
follow-ups that compound on what just landed. Each is 1-4 commits,
additive, non-destructive.

### 1.1 Mode pill → full override panel with token preview
The pill cycles modes. Next step: long-press the pill opens a mini
panel showing **estimated tokens** / **first-token latency p50** /
**which tools will load** for each mode, plus provider override,
task-type override, and a "try this message now in deep mode" button
that re-runs the last message without retyping. Uses existing
`chatPromptMetrics` telemetry already collected on every request.
- **Files:** `components/chat/mode-panel.tsx` (new), extend `mode-pill.tsx` long-press handler
- **Data:** `/api/ai/chat/prompt-metrics?mode=X` → p50/p95 first-token, token counts from last 20 requests
- **Effort:** 2 commits, ~90 min
- **Why:** Nour sees the *cost* of each mode, not just the name. Power + control.

### 1.2 Pin ranking + prompt-budget optimizer
Currently top-5 pins by `updatedAt`. Better: rank by a blended score
of (recency × label weight × seenCount) and auto-trim pins that push
the prompt over a budget (e.g. >1400 chars across all pins). Surface
a "Nick dropped this pin for budget" indicator in the panel so Nour
can manually promote it back.
- **Files:** `lib/ai/system-prompt.ts` (pin selection logic), `components/brain/pinned-context-panel.tsx` (dropped-for-budget indicator)
- **Effort:** 1 commit, ~45 min
- **Why:** pins compete for attention — make the competition visible

### 1.3 /brain pin import/export + share link
Pins are portable knowledge. One-click export to JSON (copy or
download) + paste-back import. Also generate a signed read-only
share link (UUID, 24h TTL) so Nour can paste a pinned-context
snapshot into a fresh ChatGPT/Claude tab for a second opinion.
- **Files:** `/api/brain/pinned/export` (GET json), `/api/brain/pinned/share` (POST → `share_links` row)
- **Effort:** 2 commits, ~60 min
- **Why:** Nour can carry his brain context across tools. No vendor lock.

### 1.4 Suggestion quality learning loop
When Nour taps a smart-reply chip, log which one + which position +
which message pair. Nightly cron analyzes: which chip styles get
tapped (action / deeper / lateral)? Boost Venice prompt weight
toward Nour's preferred style.
- **Files:** `app/api/ai/chat/suggestions/click/route.ts` (new, POST logger), `scripts/analyze-suggestion-taps.ts` (new), `app/api/ai/chat/suggestions/route.ts` (read learned weights into prompt)
- **Effort:** 2 commits, ~90 min
- **Why:** compound mini-interactions — chips get smarter every week

### 1.5 Prompt cache warmup on app load (not just typing)
Chat prefetch currently only fires while typing. Add a sibling
warmup on `/command` mount + on `/brain` mount so switching to `/chat`
lands warm even if Nour goes straight there from HQ without typing.
- **Files:** `app/(mastery)/command/page.tsx`, `app/(mastery)/brain/page.tsx`, shared `hooks/use-idle-warmup.ts` (new)
- **Effort:** 1 commit, ~30 min
- **Why:** free speed win — turns the warm-cache TTL into "always warm" during an active session

### 1.6 Chat export — conversation → markdown + PDF + JSON
`/api/chat/export/[conversationId]?format=md|pdf|json` with optional
`?include=tools|reasoning|all`. Exports include citation pills,
tool-call log, timing ribbon. PDF via react-pdf or puppeteer.
- **Files:** `/api/chat/export/[conversationId]/route.ts`, UI button in chat history list + conversation menu
- **Effort:** 2 commits, ~120 min
- **Why:** portability + control + paper trail

### 1.7 Predictive prefetch — product-specific intents
Extend `lib/ai/predictive-prefetch.ts` to recognize tire/brand/
product queries via a keyword-trigger table synced from the inventory
system (top 50 SKUs by volume). Pre-fetches inventory + margin +
velocity so Nick answers "how many Michelin LTX this month" without
a round-trip tool call.
- **Files:** `lib/ai/predictive-prefetch.ts`, `scripts/sync-product-keywords.ts` (new — reads from inventory, writes keyword table)
- **Effort:** 2 commits, ~90 min
- **Why:** aggressive + specific; makes product queries sub-second

### 1.8 Natural-language task priority control via tool
Nick can say "this is critical" or "bump priority on the battery
contract" — wire `setTaskPriority` as a tool so Nour's chat messages
can directly retag open loops without switching to `/tasks`.
- **Files:** `lib/ai/tools.ts` (new tool), `lib/brain/outcome-tracker.ts` (log the override)
- **Effort:** 1 commit, ~45 min
- **Why:** natural-language control of the task layer

### 1.9 Inline inline-action toolbar on long-press mobile
Long-press already opens the MessageActionSheet. Add a 2nd
gesture — swipe-right on a user message edits it, swipe-left pins
it. Haptic tick on each swipe. Works with `use-long-press.ts` +
new `use-swipe-gesture.ts`.
- **Files:** `components/chat/use-swipe-gesture.ts` (new), wire into message bubble
- **Effort:** 1 commit, ~60 min
- **Why:** one-thumb ops, thumb stays on-screen, zero tap-path lag

### 1.10 Pin reinforcement cron + nudge
Weekly cron scans `pinned_user` rows, flags any with `seenCount === 1`
AND `updatedAt > 14d`. Creates a soft nudge card on `/command`:
"Still pinned: '<content>' — reinforce or unpin?". Two-click decision.
- **Files:** `app/api/cron/pin-hygiene/route.ts` (new), extend `NudgePanel` renderer
- **Effort:** 1 commit, ~45 min
- **Why:** pins age; hygiene is a control surface

### 1.11 Voice-input while streaming (barge-in)
Today voice input locks while Nick is replying. Add barge-in: Nour
can hold mic → Nick stops mid-sentence (existing `stop()`) + the new
input queues. Used heavily when driving.
- **Files:** `hooks/use-voice-input.ts`, chat page keydown handler
- **Effort:** 1 commit, ~45 min
- **Why:** car-friendly; feels alive instead of transactional

### 1.12 Mode pill + pin badge in /command header
Surface a single 2-chip row on `/command` header: current chat mode
(auto-detecting from the most recent draft in NourState), pinned count
(click → /brain#pinned-context). Gives Nour visibility on the control
state even when not inside /chat.
- **Files:** `components/command/status-chips.tsx` (new), mount in `/command` header
- **Effort:** 1 commit, ~30 min
- **Why:** the control surface lives everywhere, not just in /chat

---

## Tier 2 — Intelligence upgrades (next 2 weeks)

The goal: Nick understands Nour better each week, not just has more
data. These are the compounding intelligence layers.

### 2.1 Identity drift detection
Nick compares Nour's current tone/decisions/priorities against his
2-months-ago profile. Flags drift: "You said 6 weeks ago 'I will
never work past 7pm' — you've worked past 7 on 11 of the last 15 days."
- **Files:** `lib/brain/identity-drift.ts` (new), `lib/brain/engines` index
- **Effort:** 2 commits, ~3 hours
- **Why:** self-accountability at the deepest level; compounds over months

### 2.2 Decision outcome tracking with confidence calibration
Every time Nick predicts an outcome ("call this lead, 60% close chance"),
store the prediction + the actual outcome. Over time, compute Nick's
calibration score. Feed it back into system prompt: "Nick's recent
prediction accuracy on lead-close calls is 48% — he's been overconfident,
adjust."
- **Files:** `lib/brain/prediction-tracker.ts` (extend existing outcome-tracker), `/api/brain/calibration`
- **Effort:** 2 commits, ~3 hours
- **Why:** forces Nick to earn his confidence; devastating lead = calibrated AI

### 2.3 Counterfactual history — "what if I had done X"
Store every decision Nour made with an explicit alternative he
considered. Later, replay: "3 weeks ago you chose A over B. Here's
what the data says about how B would have gone."
- **Files:** `lib/brain/counterfactual.ts` (new), `/api/brain/counterfactual` (new), UI in /decisions
- **Effort:** 3 commits, ~4 hours
- **Why:** teaches the decision engine; massively clever

### 2.4 Weekly pattern digest — pushed to Telegram Sunday evening
Every Sunday at 7pm, generate a dense 500-word digest: top 3 patterns
detected this week, biggest wins, biggest blind spots, recommended
Monday moves. Push to Telegram. Also store as a Reflection row.
- **Files:** new cron `/api/cron/weekly-digest-telegram` (OR extend existing weekly-digest)
- **Effort:** 1 commit, ~60 min
- **Why:** compound reinforcement; Nour gets a real reset signal every Sunday

### 2.5 Cross-domain correlation engine
Find non-obvious links: "Mondays after you skipped Sunday workout →
37% more stale estimates on Tuesday." Run nightly, surface top 3
correlations in the morning brief.
- **Files:** `lib/brain/cross-domain-correlations.ts` (new), morning-brief cron
- **Effort:** 2 commits, ~4 hours
- **Why:** the promise of interesting data — shows Nour his own patterns

### 2.6 Nick's inner monologue (visible reasoning for deep mode)
For deep mode queries, show Nick's reasoning steps streamed live:
"Checking memories... noticed drift from 3 days ago... cross-referencing
with your MIT... consulting Law 28..." → then the answer. Makes the
thinking visible.
- **Files:** `app/api/ai/chat/route.ts` (streamReasoning), `components/chat/nick-message.tsx`
- **Effort:** 2 commits, ~2 hours
- **Why:** clever inside the box; builds trust

### 2.7 Memory contradiction detector
When a new memory contradicts an existing high-confidence memory,
flag it for review. E.g. "You just said 'sales should be prioritized'
but 2 weeks ago you set a hard rule that 'ops always comes first'."
- **Files:** `lib/brain/contradiction-detector.ts` (extend memory-manager), `/brain` UI surface
- **Effort:** 2 commits, ~3 hours
- **Why:** thoroughness — nothing slips through

### 2.8 Embedding-based semantic search in ALL recall
`/journal` search currently uses substring. Upgrade to use Pinecone-
style vector search via the existing embeddings. Same for chat search.
- **Files:** `/api/chat/search`, `/api/journal`, `lib/brain/embedding-utils.ts` (extend)
- **Effort:** 2 commits, ~3 hours
- **Why:** "what was that thing I said about money" finds "cash flow concern" even though no words match

---

## Tier 3 — New surfaces (next month)

### 3.1 Admin control panel (`/admin/brain-controls`)
Single page with knobs for EVERY hidden default:
- Chat mode classifier thresholds
- Predictive prefetch intent keywords (add your own patterns)
- Memory confidence floor for inclusion in prompt
- System prompt size cap (per provider)
- maxOutputTokens per mode
- Cron schedule overrides
- Tool allowlist per mode (disable tools you don't use)
- Feature flags: new experiments, A/B tests
- Retention policy knobs

**Effort:** 4-6 commits, ~1 day
**Why:** power + control — every hidden default becomes surface-able

### 3.2 `/admin/data-flow` — visual pipeline dashboard
Live dashboard showing every ingest pipeline status:
- Gmail: last run, messages ingested, queue depth, next run
- Calendar: same
- Drive: same
- Chat → Journal: same
- Venice → OpenAI → Anthropic fallback chain: last errors
- Embedding coverage: %, missing count
- Cron schedule: what's running now, what's next

**Effort:** 3 commits, ~4 hours
**Why:** total visibility into the machine

### 3.3 `/lab` — experiment playground
A page where Nour can try new AI features before they ship to /chat.
Toggles for prompt variations, model comparisons, tool set experiments.
Every A/B result logged so good ideas bubble up, bad ideas die fast.
- **Files:** `app/(mastery)/lab/page.tsx`, `/api/lab/*`
- **Effort:** 5 commits, ~1 day
- **Why:** rapid iteration surface

### 3.4 Morning briefing audio — Daily "pull up to the shop" podcast
Auto-generate a 90-second audio briefing at 7am: "Good morning. Here's
yesterday's revenue, today's target, top 3 blockers, morning routine
reminder." TTS → audio file → push to Telegram as voice note OR as a
web player on /command.
- **Files:** new `/api/morning-audio/generate`, uses existing TTS
- **Effort:** 2 commits, ~3 hours
- **Why:** dynamic > static; hands-free morning

### 3.5 Voice-first inline commands
Say "Nick, set MIT to call DK Tire for quote" → the voice input hook
routes directly to `setMit` tool with parsed args, no AI round-trip.
Handful of common action verbs pre-mapped to tools for sub-300ms
response.
- **Files:** `lib/chat/voice-commands.ts` (new), `hooks/use-voice-input.ts` (extend)
- **Effort:** 2 commits, ~2 hours
- **Why:** aggressive speed; power move

### 3.6 Public share links for specific conversations
Generate a read-only link to share a conversation with Dania / a
customer / a vendor. Includes the chat transcript + any tool results.
Expires after N days.
- **Files:** `/api/chat/share/[id]`, public viewer page
- **Effort:** 3 commits, ~4 hours
- **Why:** bridge personal tool → external leverage

---

## Tier 4 — Deep quality + stability (ongoing)

### 4.1 System prompt caching at the provider level
Venice supports prompt caching via `prompt_cache_key`. Already wired
into `VENICE_PARAMS`. Verify it's actually hitting the cache by
logging `cache_read_input_tokens` from responses. If not, debug.
- **Effort:** 1 commit investigation, then fix
- **Why:** every cached read = free tokens

### 4.2 Prometheus-style metrics endpoint
`/api/metrics` returns text-format Prometheus metrics: chat_duration,
prompt_size, tool_calls_by_name, cache_hits, DB_query_count, error_rate.
Already have `trackGeneration()` — just expose it.
- **Effort:** 1 commit, ~45 min
- **Why:** observability > vibes

### 4.3 Database health endpoint + alerts
`/api/health/deep` runs a fast sanity check: row counts per table,
query latency, connection pool status, unhealthy integrations count.
Alerting via Telegram if anything regresses.
- **Effort:** 2 commits, ~2 hours
- **Why:** stability compounds

### 4.4 Schema debt sweep (per `schema_debt.md`)
The memory file `schema_debt.md` lists: 8 missing timestamps, 22 missing
indexes, 3 naming eras. Work through the highest-impact ones one
commit at a time. Indexes first — they're the biggest perf win.
- **Effort:** 4-6 commits over a week
- **Why:** pay down debt before it compounds

### 4.5 Universal journal feed — pull in email, calendar, drive, chat AS journal entries
Currently `/journal` aggregates BrainDump + Reflection + SituationLog +
DecisionReplay. Extend to include (opt-in via filter):
- Gmail outgoing as "communication" entries
- Calendar events as "schedule" entries
- Drive edits as "knowledge" entries
- Chat summaries as "conversation" entries
- Make journal truly the single feed of Nour's day.
- **Effort:** 2 commits, ~3 hours
- **Why:** one feed to rule them all

### 4.6 AI-assisted CHANGELOG auto-generation
After every commit, a Post-commit hook runs Venice on the diff and
appends a human-readable one-line to CHANGELOG.md. No manual doc
debt.
- **Effort:** 1 commit, ~45 min
- **Why:** self-reinforcing docs

### 4.7 Venice model comparison tool
`/api/ai/compare` runs the same prompt against multiple Venice models
(glm-4.7-flash-heretic vs venice-uncensored vs others) and shows diff.
Helps pick the best model per task type.
- **Effort:** 1 commit, ~60 min
- **Why:** escape local-optimum model choice

---

## Tier 5 — External leverage (month+)

### 5.1 Nick-as-a-service API (private)
Expose a limited read-only Nick API that Nour can call from his phone's
Shortcuts app, other tools, or a Zapier integration. OAuth-gated, rate-
limited, scoped.
- **Why:** power tool for power user

### 5.2 Nick answers the shop phone (outbound)
Integrate with the existing Telegram bot to forward missed calls to
Nick. Nick listens to a voicemail transcript, classifies the lead
type, extracts contact info, creates a lead row, texts Nour a summary.
- **Effort:** big — needs Twilio integration
- **Why:** captures the leads currently falling through

### 5.3 Competitive pricing scraper
Daily scrape of DK Tire / AutoLabor / Midas published pricing.
Compare to Nick's pricing. Alert on differential > 15%. Informs
pricing strategy without manual checking.
- **Files:** `/api/cron/competitive-scrape`, new CompetitorPrice model
- **Effort:** 3 commits, ~4 hours
- **Why:** market intelligence on autopilot

### 5.4 Customer sentiment monitoring
Daily scan Google Reviews for new reviews. Auto-classify sentiment.
Flag any negative review within 1 hour of posting so Nour can respond
before it hurts ranking.
- **Files:** `/api/cron/review-sentiment`
- **Effort:** 2 commits, ~3 hours
- **Why:** reputation is a moat — protect it real-time

### 5.5 Local SEO performance tracker
Daily rank-check for top 20 keywords. Surface in HQ as a sparkline.
Alert on drops > 3 positions.
- **Files:** `/api/cron/seo-rank-check`, SEO model
- **Effort:** 2 commits, ~3 hours
- **Why:** devastating lead in local search

---

## Tier 6 — Missing controls audit (power + control)

Per Nour's permanent rule: no value shown should be static. Every
screen audited for missing knobs. Updated as discovered:

| Screen | Missing control | Priority |
|---|---|---|
| /command → MoodTrendCard | Click sparkline → drilldown / compare ranges | med |
| /tasks → Critical lane | Custom priority thresholds | med |
| /chat → any message | Mark as "this is important, never forget" (pin to memory) | high |
| /chat → any message | Rewrite / improve this response | low |
| /journal → any entry | Merge two entries | low |
| /commitments → any commitment | Snooze for N days | high |
| /brain → memories | Edit content of a memory | med |
| /brain → memories | Manual confidence override | med |
| /strategy → Situation Room | Save situation as a "playbook" | high |
| /admin → all pages | Bulk CSV export | low |
| Nick chat → anywhere | Set chat mode manually for this message | high |
| Global → anywhere | Quick-capture keyboard shortcut customization | low |

These are the visible power leaks. Every one of them = "Nour can see
the data but can't act on it" — which is exactly the missing-control
problem the permanent rules call out. Work through them when touching
the relevant surface.

---

## Tier 7 — Infrastructure / boring-but-critical

### 7.1 Automated testing on critical paths
Zero tests currently. Start with:
- Smoke test for `/api/ai/chat` (doesn't crash, returns stream)
- Smoke test for `/api/cron/knowledge-sync` (returns result shape)
- Smoke test for `/api/chat/search` (returns results for known query)
- **Effort:** 1 commit, ~2 hours (Vitest setup + 3 tests)
- **Why:** safety net before the real refactors

### 7.2 Rate limiting on heavy endpoints
`/api/ai/chat` already has it. Add to `/api/knowledge/ingest-files`,
`/api/chat/search`, `/api/brain/*` so a runaway client can't DoS
the lambda.
- **Effort:** 1 commit, ~30 min
- **Why:** hardening

### 7.3 CSRF protection on POST routes
Not all POST routes check origin/referer. Audit + add middleware.
- **Effort:** 1 commit, ~60 min
- **Why:** security hygiene

### 7.4 Sentry / error tracking
Free tier Sentry is enough. Catches client + server errors with
stacktraces. Currently only `console.error` — easy to miss.
- **Effort:** 1 commit, ~45 min
- **Why:** you can't fix what you can't see

### 7.5 Database backup schedule documentation
Neon does automatic backups but the policy isn't documented. Write up
what gets backed up, retention, how to restore.
- **Effort:** 1 commit, ~20 min (docs only)
- **Why:** boring = important

### 7.6 Environment-parity checks
Script that diffs the env vars in Vercel production against a local
`.env.local.example` to catch missing vars before they cause runtime
errors.
- **Effort:** 1 commit, ~30 min
- **Why:** verify-everything principle applied to env

---

## Tier 8 — Outside-the-box clever things

These are the "I didn't think of that" ideas. Highest leverage over
time, highest chance of feeling like science fiction.

### 8.1 Nick learns your voice via transcript fingerprinting
Scan Nour's outgoing Gmail + journal entries + chat messages. Build a
stylometric profile: sentence length, vocab, favorite phrases, tone
markers. Feed into the system prompt so Nick can write in Nour's
actual voice when drafting messages on his behalf.
- **Effort:** 2 commits, ~3 hours
- **Why:** clever beyond reason

### 8.2 Habit-reinforcement game layer
Daily habits become XP. Streaks become multipliers. Weekly boss
battles (hit revenue target, close X estimates). Visible progression
on a "mastery tree". Not for kids — for the ADHD-brain that thrives
on tight feedback loops.
- **Effort:** 5 commits, ~1 day
- **Why:** interesting data + dynamic elements + compound reinforcement

### 8.3 Predictive morning — wake up to the next 4 hours pre-planned
Based on yesterday's data + this week's patterns, pre-generate a
4-hour morning schedule at 6am. Blocks of time assigned to specific
tasks with energy-level matching. Nour wakes up, looks at HQ, sees
"Your next 4 hours: 6-8am workout + Adderall kick-in; 8-10am deep
work on the 3 stale estimates; 10-11am inbox + callbacks; 11-12
admin". Accept / override / regenerate.
- **Effort:** 3 commits, ~5 hours
- **Why:** removes the decision tax first thing in the morning

### 8.4 Friction logger — track every "I wanted to X but couldn't"
Browser extension or PWA hook: Nour hits a friction point, taps a
shortcut, voice-records 5 seconds describing what he wanted + what
blocked him. Nick auto-triages these into "fix this in next session"
items.
- **Effort:** 4 commits, ~1 day
- **Why:** Nour's frustrations become Nick's backlog automatically

### 8.5 Energy state persistence
Track Nour's self-reported energy every hour. Correlate with actual
output (tasks completed, revenue generated). Over time, Nick knows
Nour's energy curve better than Nour does: "You say you're going to
do hard work at 2pm but the data says 2pm is a valley. Move it to
10am or 4pm."
- **Effort:** 2 commits, ~3 hours
- **Why:** beats self-reported planning

### 8.6 "Would past-Nour approve?" reflection checkpoint
When Nour is about to make a significant decision, Nick surfaces:
"90-days-ago-Nour wrote: 'Never take a job under $800 margin.'
Does this pass that test?" Uses the permanent principles + historical
decisions as automatic guardrails.
- **Effort:** 2 commits, ~3 hours
- **Why:** self-overrides the impulsive moments

### 8.7 Competitive mission briefs
Nick runs a "what would DK Tire do" simulation for any strategic
question. Then adds "what would a shop from outside the auto industry
do" (Singer Vehicle Design / Apple ops). Shows both angles so Nour
sees the inside-the-box and outside-the-box options.
- **Effort:** 2 commits, ~3 hours
- **Why:** the outside-the-box ideas the permanent rules ask for

### 8.8 "Devastating lead" weekly scorecard
Every Sunday: compute Nour's lead over the competitive average on
key metrics (reviews, response time, customer LTV, pricing competitiveness,
content output). Plot the gap over time. Aim to widen the gap every week.
- **Effort:** 2 commits, ~4 hours
- **Why:** the devastating lead is measurable — measure it

---

## How to use this file

**When starting a new session**, read:
1. The "✅ Shipped" block to know what exists
2. The current Tier 1 items to see what's next
3. `feedback_work_style_v2.md` for the permanent rules

**When completing an item:**
1. Move it from its tier to the "✅ Shipped" block at the top
2. Add the commit hash + date
3. Note any surprises or gotchas for future sessions

**When discovering a new gap** (missing control, missing feature, idea):
1. Add it to the appropriate tier
2. Estimate effort + priority
3. Don't lose the idea — this file is the memory

**When deploying:**
- Commit atomically
- Push after each commit (checkpoint so another session can pick up)
- Verify in preview before claiming done (per permanent rule #4)
- Update CHANGELOG.md with human-readable summary

---

## Meta — this file is a living artifact

It should grow. It should get denser. Old tier-1 items move to shipped,
new ones move up from tier 2+. The goal is that at any moment, the
"Tier 1" section is the 6-10 highest-leverage things that would most
improve Nour's power + control + leverage this week.

No item should ever be vague. "Improve X" is not a roadmap item.
"Add manual confidence override to /brain memories at tables/brain.tsx
line ~200, with a slider 0-100, stores to BrainMemory.confidence"
IS a roadmap item.

**Nothing here is optional. Every item is a real power move.**

---

## Tier 9 — POST-v10.2 QUALITY AUDIT (do this week before more features)

Six commits landed between 04-15 and 04-20 across the chat route, the
brain system, and the system prompt injection layer. That much
concurrent surface area WILL have rough edges. Every item here is a
real check, not a vibe.

### 9.1 System-prompt token ceiling regression test
The prompt now injects: permanent principles + pinned (5×260 chars)
+ identity (24 rows × 160 chars) + chat pattern + conversation
context + device list + recent syncs + market intel + continuity +
brain state. Risk: sum blows past Venice's 50K ceiling on a heavy day.
- **Action:** Write `scripts/measure-prompt-size.ts` that builds the prompt with a "maxed" fixture (50 pins / identity dense / long chat) and asserts `< 40_000` chars (20% headroom). Add to CI via `npm run prompt:size-check`.
- **Files:** `scripts/measure-prompt-size.ts`, `package.json` script
- **Why:** silent truncation is the worst class of bug — no error, just degraded answers

### 9.2 Pinned-context E2E smoke
Pin → reload chat → send a message → verify the pinned content
appears in the `systemPrompt` the route built. Today that's only
manually testable.
- **Action:** Add `scripts/smoke-pins.ts` that POSTs a pin, calls buildSystemPrompt(), greps for the pin content, then DELETEs.
- **Why:** regression guard before any future prompt-shape refactor breaks pin injection

### 9.3 Suggestion cache hit-rate telemetry
Right now we don't know if the warm actually helps. Add a metric.
- **Action:** Instrument `/api/ai/chat/suggestions` to log `{key, cacheHit: boolean, source: cache|venice|heuristic}` to `AiGeneration` or a dedicated `SuggestionMetric` table. Add panel on `/brain` (or `/admin`) showing 7d cache hit rate + heuristic-vs-venice split.
- **Files:** suggestions route, small panel
- **Why:** you can't optimize what you don't measure

### 9.4 Stream stall detection already exists — add pin-write verification path
`useStallDetection` flags slow streams. Add a symmetric check:
after a pin POST, verify the row appears in a GET within 2s. If not,
toast "pin may have failed — retry?".
- **Files:** extend the long-press handler + the `onPinToMemory` handler
- **Why:** silent failure of a 1-click action is a control hole

### 9.5 Audit: every error path returns a 200 with empty data
Nour-style endpoints already do `status: 500` but some downstream
code treats any non-200 the same. Sweep all new routes:
`/api/brain/pinned`, `/api/ai/chat/suggestions`, `/api/ai/chat/prefetch`.
Confirm 4xx/5xx paths return consistent `{ error, code }` shape, not
`{ pins: [] }` masking the failure.
- **Action:** grep for `NextResponse.json` in those files, ensure every error branch throws or returns non-200 shape
- **Why:** Nour's "never assume" — verify error handling is real

### 9.6 DB index audit on `BrainMemory` for pinned_user queries
The pinned panel GET runs `where: { category: "pinned_user" }` ordered
by `updatedAt desc`. Check the Prisma index: does `(category, updatedAt)`
compound exist? If not, add via `prisma db push` migration.
- **Action:** read `schema.prisma` BrainMemory `@@index`, add `[category, updatedAt]` if missing
- **Why:** pins panel loads on every /brain visit — slow here = slow app

### 9.7 Mobile breakpoint pass on new surfaces
The ModePill, SmartReplies row, and PinnedContextPanel were built
desktop-first. Verify at 375×812 (iPhone SE) that:
- Mode pill doesn't push send off-screen
- SmartReplies chips wrap cleanly (no horizontal overflow)
- Pins panel edit drawer is tappable with one thumb
- Staleness ring is visible through the outer GlassCard border
- **Files:** pure CSS / className pass
- **Why:** Nour's primary device is mobile

### 9.8 Long-press pin — test all message roles
The MessageActionSheet onPin now writes permanent. Verify:
- User messages don't accidentally write to `pinned_user` (they were meant for local-only)
- Assistant messages write correctly
- Very long assistant messages (>1200 chars) get truncated not rejected
- **Action:** role check in the `onPin` handler
- **Why:** scope creep on the permanent pin system

### 9.9 Prefetch endpoint rate-limit audit
`useChatPrefetch` hits every 2s while typing. Check Vercel analytics for
`/api/ai/chat/prefetch` p95 — if > 1s, it's blocking something.
Consider: should prefetch use `unstable_cache` with a shorter TTL?
- **Files:** inspect `/api/ai/chat/prefetch/route.ts` memory use
- **Why:** prefetch should never be a bottleneck

### 9.10 Venice retry path for suggestions endpoint
Today the suggestions route does ONE Venice fetch with 4s timeout.
If Venice is slow, fallback to heuristic. Add: on Venice timeout,
log to error bucket + mark this message's suggestion as "heuristic
only" in response metadata so the client can show a subtle
indicator.
- **Files:** `app/api/ai/chat/suggestions/route.ts`
- **Why:** observability = "I knew this would happen"

### 9.11 Dark-mode state verification on every new component
Pins panel + mode pill + smart replies — force the page with
`document.documentElement.style.background = 'white'` in dev and
verify text is still readable. Dark-mode baked assumptions leak.
- **Action:** eyeball pass
- **Why:** small detail, surprising frequency of regressions

### 9.12 Remove dead pins.pin (local) if unused elsewhere
The local `usePinnedMessages` hook may now be redundant vs the
permanent pins. Grep usages, delete if no consumer. Dead code = debt.
- **Action:** grep `pins\.pin\|usePinnedMessages`, verify, delete
- **Why:** cleanliness = power

---

## Tier 10 — ALIVE-UI — less static, more dynamics (compounds every session)

The pattern: make every element feel like it's reading the moment, not
just rendering props. Small animations, contextual color shifts, live
counters, gentle pulses on fresh signal. Each micro-interaction is
a win — compounding.

### 10.1 Mode pill breathes with Nick's state
When Nick is active (replying / using tools), mode pill pulses subtly
gold. When idle, static. When error, amber. Uses existing `isStreaming`
+ `error` state.
- **Files:** `components/chat/mode-pill.tsx`
- **Why:** the interface shows it's alive even when quiet

### 10.2 Pin ring respiration
Stale pins get a slow 4s red pulse (not jarring — a heartbeat).
Fresh pins stay static gold. Visual anxiety → action.
- **Files:** `components/brain/pinned-context-panel.tsx` + `globals.css` keyframe
- **Why:** urgency that doesn't require reading

### 10.3 Smart replies stagger-fade in
Today all 3 chips appear at once. Stagger 60ms each so they sweep
in left-to-right. Feels like Nick is *thinking of them*.
- **Files:** `components/chat/smart-replies.tsx`
- **Why:** feels alive, costs nothing

### 10.4 Typing cadence mirrors Nour's
Adaptive placeholder already exists. Extend: measure Nour's per-
message typing speed (tracked in `chat_pattern`). When Nick's
streaming, adjust the token-emit pace to roughly match — slower
when Nour's deliberate, faster when he's bursty.
- **Files:** `app/api/ai/chat/route.ts` (stream delay config)
- **Why:** subconscious rapport

### 10.5 NickHeaderV2 lives
Already shows venice health dot. Add: when a tool call fires,
the dot briefly traces a ring (4px expanding → fade). Makes tool
activity visible *even when the tool card hasn't rendered yet*.
- **Files:** `components/chat/nick-header-v2.tsx`, event bus
- **Why:** Nour sees "Nick is doing something" sub-100ms

### 10.6 /command KPI counters count UP on mount, not snap
Revenue today, tasks done, score — they all snap to the final
number. Use `AnimatedCounter` on all of them (exists but not
consistently wired). 600ms ease-out.
- **Files:** sweep `/command` for raw number renders, wrap in `<AnimatedCounter>`
- **Why:** the first impression of every surface should feel alive

### 10.7 Proactive insight card: entrance choreography
Today it slides up, static thereafter. Add: a 1px gold underline
scans left-to-right right before the message renders, tying it
to Nick's "I notice something" moment. One-time per card.
- **Files:** `components/chat/proactive-insight-card.tsx`
- **Why:** draws attention without being loud

### 10.8 Pin hover: preview of where it lands in the prompt
Hover a pin in `/brain`; a ghost outline appears in the top-right
showing "slot 2 of 5 — 18% of block budget" with a mini token bar.
Power-user visibility.
- **Files:** `components/brain/pinned-context-panel.tsx` + floating tooltip component
- **Why:** explicit mental model of the prompt budget

### 10.9 State aura color shifts on trend detection
`state-aura-${currentState}` class already exists. Extend: when drift
score rises 2+ pts in a day, the aura pulses a single amber ring;
when revenue crosses a milestone, a green ring. Subtle, one-shot.
- **Files:** `lib/state/nour-state.ts` (emit trend events), CSS keyframes
- **Why:** the whole page carries signal

### 10.10 SmartReplies chips mutate while reading
If Nour hovers a chip for >500ms without tapping, that chip text
swaps once for an alternative phrasing (Venice precomputes top-6,
returns top-3, caches 3 more for hover-mutate). Playful + useful.
- **Files:** suggestions endpoint returns `alternates`, SmartReplies uses them
- **Why:** feels like the interface is probing what Nour really means

### 10.11 Stream stall: "Nick is thinking deeper" reframe
Today `useStallDetection` shows "Nick seems stuck". Better: after
4s of no tokens, show "Nick is thinking deeper — X tools pending"
with a real count pulled from the stream state. Anxiety → info.
- **Files:** `components/chat/nick-streaming.tsx`
- **Why:** reframes failure-mode as engagement

### 10.12 Ambient background dust (opt-in)
Tiny 1-pixel gold particles drift across the void background at
0.3% opacity. Only when NourState is active (drift low, momentum
up). Off when state is stressed. Opt-in via `/settings` toggle.
- **Files:** `components/ui/ambient-dust.tsx` (new), settings wire
- **Why:** the interface rewards the state

### 10.13 Empty state: typewriter greeting
Today greeting is static "morning, Nour." Type it letter-by-letter
(50ms/char) only on first mount per session. Remember via sessionStorage
so subsequent loads don't repeat.
- **Files:** `components/chat/chat-empty-state.tsx`
- **Why:** the surface greets, doesn't just appear

### 10.14 Tool result cards: expand/collapse with height-auto
Today cards are fixed-height. Make them expandable — click to
see full JSON payload + timing + which tool file ran it. "Peek
under the hood" power.
- **Files:** `components/chat/tool-result-card.tsx`
- **Why:** transparency = trust = control

### 10.15 Pin "reinforce" haptic + ring pulse
When Nour taps reinforce on a pin, the ring pulses green (1s) and
the pin moves to top of list with a 300ms slide. Feedback loop.
- **Files:** `components/brain/pinned-context-panel.tsx`
- **Why:** every action should feel acknowledged

---

## Tier 11 — OUTSIDE-THE-BOX MOAT PLAYS

Things competitors don't have. Each is a 1-2 week lift but builds
a moat.

### 11.1 Pin "bundles" — named constellations Nour switches between
A bundle is a named set of pinned context. E.g. "Battery Contract"
bundle pins 3 memories about the deal; "Family Mode" swaps in 3
relationship-focused ones. Swap with one click. System prompt
reflects the active bundle. Bundles live in `BrainMemory
category=pin_bundle` with a JSON list of member pin IDs.
- **Files:** `/api/brain/pin-bundles/route.ts`, `PinBundleSelector` component
- **Why:** context-switching is the hidden tax on polymaths — remove it

### 11.2 Nick reads Nour's camera (optional + local)
Desktop: grant webcam → MediaPipe FaceLandmarker runs in-browser
→ detects frustration (furrowed brow), attention (eye direction),
fatigue. Feeds `chat_pattern` as `body_signal`. Nick adjusts tone
accordingly. Opt-in, never leaves device.
- **Files:** `hooks/use-face-signal.ts` (new), wire into chat-pattern cron
- **Why:** empathic UX on a moat-grade technical lift

### 11.3 Ambient chat — "think out loud" with voice-first mode
Tap once → Nick listens for 90s without needing sends. Auto-
transcribes, auto-chunks by 3s silence, streams partial reflections
back via TTS. Like dictating to a friend who replies live.
- **Files:** `hooks/use-ambient-voice.ts`, `/api/ai/chat/ambient/route.ts`
- **Why:** car commute = goldmine of thinking; current UI can't capture it

### 11.4 "Nick seed" — shareable clone link
Generate a 7-day read-only link that encodes Nour's persona
(identity axes + pinned context + working principles) as a
portable JSON. Share with another AI tool and get "Nick-informed"
advice. Mental model transport.
- **Files:** `/api/brain/export-seed/route.ts`, signed link
- **Why:** Nour's brain is portable; nothing is locked

### 11.5 Multi-device continuity — Nick sees what's on screen
Phone + desktop + tablet. When Nour switches devices, Nick
auto-loads the last 3 messages + the current draft from the
other device via a small `Handoff` table. Apple Handoff-style.
- **Files:** `Handoff` model + write on blur, read on focus
- **Why:** eliminates "starting over" friction

### 11.6 Mission weaving — Nick connects every turn to a Mission
Every reply quietly logs which Mission it likely advanced.
Post-week summary: "you spent 38% of chat on Battery Contract,
21% on Family, 14% on systems work." Drives attention analytics.
- **Files:** small tagger in the chat route onFinish, summary page
- **Why:** attention IS strategy

### 11.7 Prompt diff mode
Hold Cmd while sending a message → Nick replies normally AND
shows a side-by-side view: "what answer you'd get without pinned
context", "what answer you get with it". Makes the value of pins
empirical.
- **Files:** chat route accepts `body.withDiff`, renders both
- **Why:** prove the value; compound trust

### 11.8 Time-travel — query past self
"Nick, what would I have said about this on Jan 5?" → Nick
builds a snapshot system prompt from pinned + identity as they
were that day (requires snapshot history — store diffs in
`BrainMemorySnapshot` nightly). Then answers.
- **Files:** `BrainMemorySnapshot` model, `/api/brain/time-travel/route.ts`
- **Why:** no one else has this. Literal moat.

---

## Tier 12 — DEVASTATING-LEAD PLAYS (strategic weapons)

These don't ship in a day. They're the moves that, over 6 months,
make the gap uncatchable.

### 12.1 Real-time shop OS mirror
Every customer call, every text, every invoice → streams into
the personal OS within 10s. Uses existing MCP-ish channels plus
a new `ShopEventStream`. Nick is the single source of truth
for the business state in real time.
- **Files:** event stream table + /api/shop-stream route, client subscriber on /command
- **Why:** the personal OS becomes the control tower

### 12.2 Decision journal auto-harvest
Every "I decided X" line in chat → `DecisionEntry` row with
context + predicted outcome + check-in date. Monthly review
auto-grades. Over 12 months, decision-making calibration becomes
measurable.
- **Files:** `DecisionEntry` table, nightly harvester, `/decisions` page
- **Why:** structural self-improvement

### 12.3 Compounding identity — never-forgetting brain
The current brain resets pruned memories. Add a cold archive
that NEVER deletes. Tool access only. `BrainArchive` with
full-text search and date filters. Nick can reach back 10
years and stay accurate.
- **Files:** `BrainArchive` model, archival cron (move from BrainMemory → BrainArchive at 365d)
- **Why:** perfect memory is a superpower

### 12.4 Adversarial Nick — devil's advocate mode
Cmd+Shift+A activates "Contrarian Nick" — same Nick, but
instructed to actively disagree for one turn. Forces Nour
to defend or revise. Drift prevention + confidence calibration.
- **Files:** chat route accepts `body.persona = "contrarian"`, system prompt branch
- **Why:** no one tests Nour's thinking like Nour tests Nour

### 12.5 The 1% rule engine
Every interaction logs a micro-improvement candidate
(wording, tool choice, UX gap). Weekly cron picks the top 3 by
"compound value" and auto-opens a TODO for next session.
Never out of ideas, never stagnant.
- **Files:** `MicroImprovement` table, harvester + ranker
- **Why:** 1% per week × 52 weeks = 68% a year, compounding

---

## How to execute this roadmap

**This week's checkpoint target:** Tier 9 (quality audit) + Tier 1.1–1.4
of the new v10.2 follow-ups. Ship each in its own commit. Push after
each so recovery is cheap.

**Ordering principle:** Every commit leaves the system in a working
state. Nothing half-done at commit boundaries.

**Reinforcement loop:** After each commit, scan the next 3 commits
for any assumption this one invalidated. If found, fix before moving.

**The target is not done — the target is stable.** Stable means we
can ship Tier 11 moats a month from now on top of a code base that
didn't rot in the meantime.
