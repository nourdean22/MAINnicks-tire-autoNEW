# ULTRON — the personal OS consciousness

**Status:** SHIPPED · live at `/` since v9.x · evolving via brain-layer
upgrades (Waves 21-29 added auto-learn, Ghost Nick, wisdom citations,
pattern clusters). The original "planning → v1 build in progress"
header from 2026-03 was kept stale through 2026-05 even though the
surface was operator-grade by April · corrected in Wave 56 docs
refresh (v10.0.529.106).
**Owner:** Nour
**Route:** `/` (the homepage)
**Replaces:** `/command` (HQ) + `/strategy` (War Room) + `/brief` + `/causation` + `/drift` + `/projections`
**Code:** `app/page.tsx` · `components/ultron/*` · `app/api/ultron/*` · `lib/ultron/*`

---

## What Ultron is

A single apex surface that:

- Helps Nour **stay on track** with what he actually needs to do (personal execution, not business ops)
- Helps him **stop overthinking** stupid situations (rumination guards, decision forcers)
- Helps him **plan and execute** (simulated timelines, micro-plan compiler)
- Keeps him **informed** without being a distraction (light ticker for markets + macro)
- Provides **quick journal + ask** (omni-capture with prefixes)
- Is **well built and organised** — nothing on it that belongs on a dedicated page
- Is **not over-done** — delegates detail work to dedicated pages

Ultron is explicitly **not** a business war room. Business ops stay at `nickstire.org/admin`. The `bdnick.info` personal OS gives business oversight only (one chip), not operational control.

## Voice / aesthetic

- Dark black base. Blood-red + gold accents (gold for flow, red for threat/drift).
- Minimal typography. Heavy weight display for wordmarks. Lowercase for labels. Monospace for numbers.
- Circular/orbital visual motifs where they fit (mastery radar, pulse rings) — not just rectangles.
- Nick narrates with adaptive persona per MODE.
- When the system speaks, it's measured and authoritative. Never cheerful.

---

## The 5 problems Ultron solves

1. **Scatter** — forcing functions (Today's 3 hard cap, not-doing slot, context-switch tax meter)
2. **Rumination** — intercepts (decision forcer, overthink detection, pre-committed answer vault)
3. **Weak planning** — tooling (simulated timelines, micro-plan compiler, pre-mortems)
4. **Weak calibration** — ritual (bet desk, weekly self-debate, memory calibration)
5. **Out-of-touch with world** — ambient awareness (ticker, macro chip)

---

## V1 feature set (shipping first)

### Top strip — always visible, never scrolls

```
┌─────────────────────────────────────────────────────────────────┐
│ ultron       [ pulse: body · mind · money · life ]   [MODE]    │
│ ◂ S&P ▲ 0.4%  ·  oil $78  ·  Fed holds  ·  tire futures ▼ 2% ▸ │
└─────────────────────────────────────────────────────────────────┘
```

- **ultron wordmark** — glows gold when healthy, dims red when drifting
- **4-stack pulse** — `body · mind · money · life` chips with micro-sparklines and deltas. Click any chip → drills into its dedicated page.
  - body: mastery body score + workout streak
  - mind: mastery mind score + drift budget (e.g. "34/100")
  - money: personal finance net delta this month + savings arrow
  - life: connection signal (Dania/family days silent) + calls pending
- **MODE pill** — auto-classified: `BATTLE` / `SURGICAL` / `RECOVERY` / `SHUTDOWN` / `NORMAL`
- **Ticker** — thin scrolling strip of 6-10 items: markets (S&P, DJI), oil, Fed one-liners, tire/auto industry context, macro one-liners. Learns what Nour clicks vs scrolls, drops boring categories over time.

### Zone 1 — `today`

The "stay on track" surface.

- **Today's 3** — hard cap of 3 slots. Each locks in until done, deferred, or abandoned-with-reason. Slot 4+ = parking lot (invisible).
- **Not doing today** — one thing explicitly chosen NOT to do. Visible all day. Logged.
- **Next-action whisperer** — after any completion, 8-second prompt: "You just did X. Highest-ROI next slot = Y. Start?"
- **Anchor reminder** — surfaces ONLY when scatter is detected (multi-page switch burst, 0 actions logged in 90 min). Your own written anchor ("3 breaths + water + one small task").
- **Micro-plan compiler** — free text → executable steps. "close out the day well" → `[log score] [close 2 threads] [call Dania] [phone away 9:30pm]`. One click each to execute.
- **Context-switch tax meter** — quiet counter: "Switches today: 12 · est. 18 min lost."

### Zone 2 — `signal`

The "inform me what matters" surface.

- **Brain-engines carousel** — cycles every 6s through output from 6 engines: blind-spot-detector, teaching-moments, counter-intuitive, correlation-finder, wisdom-distiller, attention-tracker. Each card is dismissible (per-day).
- **Bet desk** — Nick's active predictions. `Accept` / `Reject` / `Why not` (logs reason for calibration). Countdown to resolution. Outcome feeds Nick's calibration score.
- **Nick's calls scoreboard** — live track: "Last 10 bets: 7 hits, 2 misses, 1 pending." Per-domain calibration if >5 samples.
- **Tomorrow note (auto-draft at 10pm)** — Ultron drafts tomorrow's morning note from today's drift/decisions/journal. "Tomorrow focus on [X]. Avoid [Y]. If you drift, remember [Z]." Edit/approve/ignore.
- **Rumination detector** — flags when same decision/commitment/thought re-opened 3+ times without action. "You've re-opened this 4× in 2 days. Force a call: YES · NO · REVIEW [date]."
- **Priority alerts** — drift triggers fired, overdue commitments, high-severity blindspots — interleave here.

### Zone 3 — `ask`

The "capture + talk to Nick" surface.

- **Omni-capture bar** — one input, 5 prefixes:
  - no prefix → Ultron auto-classifies (journal / task / decision / question)
  - `/ask` → streaming Nick answer inline (like current HQ NickInput, kept as-is)
  - `/decide` → decision log form with YES · NO · LATER + optional "why"
  - `/dump` → brain dump; Nick parses and sorts to journal/tasks/commitments/thoughts automatically
  - `/park` → thought goes to parking lot, reviewed Sunday
  - `/search` → knowledge base search
- **Voice capture** — hold the mic icon → whisper transcribed → same classifier + same destinations. Built for when hands are busy.
- **Daily prompt ladder** — 3 lightweight prompts through the day:
  - 9am: "What's the one thing?"
  - 1pm: "What's nagging you?"
  - 9pm: "What worked / what drained you?"
  Each answerable in 10 seconds. Weekly aggregated self-summary.
- **Pinned response card** — last Nick response stays pinned (localStorage, survives refresh) if marked `pin`.

### MODE classifier rules (v1)

Runs on every Ultron load + every 60s. Inputs: `NourState` + `/api/ultron/signal` counts.

```ts
function classifyMode(s, signal): Mode {
  if (s.currentState === "drift" || (s.habitsDone === 0 && s.timeOfDay !== "morning")) return "RECOVERY";
  if (s.timeOfDay === "evening" && !s.todayScore) return "SHUTDOWN";
  if (signal.counts.blindSpots.critical > 0 || s.overdueCommitments > 2) return "BATTLE";
  if (s.currentState === "on_fire") return "SURGICAL";
  return "NORMAL";
}
```

Each mode mutates:
- Top strip edge color (red/gold/blue/amber)
- Nick's persona prompt system-wide
- Which signal type gets promoted to first in the carousel
- Background aura intensity

### Redirects (v1 ships this too)

| Old route | New home | Reason |
|-----------|----------|--------|
| `/command` | `/` | HQ merged |
| `/strategy` | `/` | War Room merged |
| `/brief` | `/` | Became Tomorrow Note + Morning Orders |
| `/causation` | `/` | Became the 4-stack pulse |
| `/drift` | `/` | Became drift budget chip |
| `/projections` | `/` | Became "where you're heading" chip |

Old `app/page.tsx` redirect → `/command` deleted. `/` IS Ultron.

---

## V2 feature set (layered after v1 ships)

### Cross-page intelligence

- **Causation-aware planning** — hover any Today's 3 task → simulated timeline shows the causation chain effect (body→business, sleep→decisions, etc.)
- **Drift-informed scaling** — if drift score > 40, Ultron auto-scales Today's 3 → Today's 2 with one item forced physical
- **Journal circular loop** — `/dump` action items appear on Ultron, completions update original journal entry, weekly summary shows % of dump-items executed
- **Decision-journal fusion** — opening `/decide` shows 3 most-similar past decisions from journal inline
- **Memory calibration ritual** — weekly, Ultron picks 3 random old brain memories → "still true?" → confidence adjusts
- **Body-business coupling chart** — body trend and revenue trend on same axis, offset, shows the chain dancing
- **Mastery cascade animations** — habit completion → mastery domain ring pulses visibly
- **Knowledge → action conversion** — today's law → "what action does this prompt?" → becomes a task
- **Spending + drift correlation** — spending anomaly fires AND drift high → pattern alert
- **Pending-review avalanche protector** — if >5 pending reviews across journal+decisions+memories, Ultron blocks new captures until 2 cleared

### Anti-overthinking layer

- **Decision deadline stamper** — thoughts >48h unresolved get red dots; weekly sweep forces resolution
- **Pre-committed answer vault** — repeat questions show past-Nour's rule
- **2-option forcer** — when stuck between A and B, hides all else: `[A] [B] [Defer 48h]`
- **Overthink detection** — 3+ page re-opens without action → intercept prompt
- **Confidence check on thoughts** — Ultron mirrors: "This is 80% the same worry as your Apr 9 entry. Park it?"

### Life layer

- **Connection signals** — "6 days since Dania mention. Last time past 7d = rough week. 15 min today?"
- **Anniversary radar** — Dania promotion anniversary, family birthdays, commitments to specific people
- **Sleep debt tracker** — running total with decision-quality research note

### Ambient intelligence

- **Revenue heartbeat (personal variant)** — subtle audio+visual pulse tied to personal flow (streaks, habits) not business
- **Macro chip detail** — click ticker → 3-line "what's going on in the world" summary
- **Today in history** — personal: "Apr 16 '25 you wrote '[x]'. Still true?" Zero effort, builds self-awareness.
- **Regret log** — end of day, 1 question: "Anything you regret doing/not doing?" → pattern surfacing over time
- **Forgotten thread resurrection** — brain dumps >7d with unresolved action items surface once

### Gamification (careful)

- **Bet desk leaderboard** — Nick vs Nour scoreboard across predictions
- **Journal streak** — "5 days running. Break it or hit 7?"

---

## What stays on dedicated pages (unchanged, Ultron only shows headlines)

| Page | Ultron surfaces | Full page for |
|------|-----------------|---------------|
| `/tasks` | Today's 3 + quick-add | Full task list, 5-mode deck, project planning |
| `/journal` | Recent 3 + capture entry + streak | Full feed, filters, inline expand |
| `/decisions` | Pending review queue + /decide shortcut | Full list, dialog, grading |
| `/brain` | Memory count chip + calibration ritual | Full memory browser, patterns, rules |
| `/mastery` | Mini radar + weakest domain pulse | Full radar + goal detail |
| `/body` | Micro-log (1 number) + target countdown | Full charts, entries, progress |
| `/financial` | Monthly money pulse chip + savings | Full net worth tracking, charts |
| `/knowledge` | Today's law + /search entry | Full browse, categories |
| `/admin` | Business-state chip (healthy/alarm) | Bridge to nickstire.org/admin |
| `/chat` | Ask-box seeds here | Full chat, history, personality modes |

---

## Composite APIs (new)

To avoid N fragmented fetches on the homepage, build 2 composite endpoints:

### `GET /api/ultron/pulse`

Cache: 60s (L1) + Redis
Returns:
```ts
{
  data: {
    body:  { score: number, delta: number, spark: number[], streak: number, weightTrend?: number },
    mind:  { score: number, delta: number, spark: number[], driftBudget: { current: number, cap: number } },
    money: { netDelta: number, savingsRate: number, debtChange: number, spark: number[] },
    life:  { daniaSilent: number, familySilent: number, callsPending: number, topConnection: string | null },
    generatedAt: string,
  }
}
```

### `GET /api/ultron/signal`

Cache: 300s (L1) + Redis. Aggregates the 6 brain engines + bet desk + Nick's calls.
Returns:
```ts
{
  data: {
    signals: Signal[],    // carousel items, priority-sorted
    bets: { active: Bet[], calibration: { last10: { hits: number, misses: number, pending: number } } },
    ruminations: { openCount: number, topReopened: ... },
    tomorrowNote: { draft: string | null, generatedAt: string } | null,
    generatedAt: string,
  }
}
```

The existing `/api/brain/hq-signals` (already built earlier this session) becomes the signals source — rename/redirect.

### Reuse existing

- `/api/brain/blind-spots`, `/api/brain/forecast`, `/api/brain/velocity`, `/api/brain/health` — keep, unchanged
- `/api/score-daily` — unchanged
- `/api/tasks`, `/api/commitments`, `/api/open-loops` — unchanged
- `/api/mastery/mood-trend` — unchanged

### News ticker source

- Primary: AP headlines RSS + public markets endpoint (Yahoo Finance, Stooq)
- Personalisation: `/api/ultron/ticker-prefs` — Ultron learns click-through rates per category, stores in `brainMemory`
- No paid feeds in v1

---

## Component / file layout

```
app/
  page.tsx                              ← Ultron homepage (no more redirect)
  (mastery)/
    command/page.tsx                    ← 301 → /
    strategy/page.tsx                   ← 301 → /
    brief/page.tsx                      ← 301 → /
    causation/page.tsx                  ← 301 → /
    drift/page.tsx                      ← 301 → /
    projections/page.tsx                ← 301 → /
  api/
    ultron/
      pulse/route.ts                    ← NEW
      signal/route.ts                   ← NEW  (wraps hq-signals + bet desk + ruminations)
      ticker/route.ts                   ← NEW  (markets + macro headlines)
      ticker-prefs/route.ts             ← NEW  (click-learn pref store)
      tomorrow-note/route.ts            ← NEW  (POST = regenerate, GET = latest)

components/
  ultron/
    ultron.tsx                          ← top-level composition
    top-strip/
      wordmark.tsx                      ← ultron + state aura
      pulse-stack.tsx                   ← 4-stack chips
      mode-pill.tsx                     ← auto-classified mode badge
      ticker.tsx                        ← scrolling strip
    today/
      todays-three.tsx                  ← hard-cap 3 slots
      not-doing.tsx                     ← single explicit no
      next-action-whisperer.tsx         ← post-completion prompt
      anchor-reminder.tsx               ← scatter-triggered
      micro-plan-compiler.tsx           ← free text → steps
      switch-tax-meter.tsx              ← quiet counter
    signal/
      brain-carousel.tsx                ← 6-engine cycling card
      bet-desk.tsx                      ← active predictions
      nick-calls-board.tsx              ← scoreboard
      tomorrow-note.tsx                 ← draft-at-10pm surface
      rumination-detector.tsx           ← re-open intercept
      priority-alerts.tsx               ← drift/overdue/blind interleave
    ask/
      omni-capture.tsx                  ← input with 5 prefixes
      voice-capture.tsx                 ← whisper hold-to-talk
      prompt-ladder.tsx                 ← 3 daily prompts
      nick-stream-card.tsx              ← pinned response (port from nick-input)

lib/
  ultron/
    mode-classifier.ts                  ← classify() returns Mode + persona prompt
    signal-priority.ts                  ← sort + group signals for carousel
    tomorrow-note-composer.ts           ← takes today's state → drafts note
    context-switch-tracker.ts           ← client-side switch counter
    rumination-tracker.ts               ← localStorage + server re-open counter
    omni-capture-router.ts              ← classifier for /prefix intents
    persona-map.ts                      ← MODE → persona prompt fragments
```

---

## Saved for later — nickstire admin upgrade backlog

The aggressive business-war-room ideas from the Ultron brainstorm session get moved to `nickstire.org/admin` upgrades. **Not** on the personal OS.

- Threat radar (concentric rings, live enemy blips) — on nickstire admin
- Kill probability scoring per stale lead/aging quote
- Sniper queue (ranked enemies with exact next action)
- Ghost overlay of past-Nour behavior
- Counter-ops intervention when about to start work with open loops
- Morning orders (executable, not a brief)
- Drift intercepts (screen lock at 11am if BATTLE day unscored)
- Revenue heartbeat (audio+visual pulse on pipeline state)
- Live ticker of micro-events (lead #847 overdue, callback pending)
- Win cascade visualisation on task completion
- Opponent-mode gamification (Ultron vs Nour leaderboard — limited, personal version lives as bet desk)
- Threat-decay visible time-clocks on every aging item

---

## Technical notes

### Envelope refactor synergy

Building Ultron is the forcing function for standardising API envelopes. Every new Ultron endpoint returns `{ data, error? }` strictly. Every Ultron component uses a new `lib/api-client.ts` `apiGet<T>(url, schema)` with Zod at the boundary. This knocks out half the spawned "envelope refactor" task for free.

### Build order (per todo list)

1. Write this vision doc ✓
2. Composite APIs (pulse + signal + ticker)
3. Ultron shell (`app/page.tsx` + top composition)
4. Top strip (wordmark + pulse + mode + ticker)
5. Today zone (Today's 3 + not-doing + next-action + anchor + compiler + switch tax)
6. Signal zone (carousel + bet desk + calls + tomorrow note + rumination + alerts)
7. Ask zone (omni-capture + voice + prompt ladder + Nick stream)
8. MODE classifier (server + client client-state propagation)
9. Redirects (/command /strategy /brief /causation /drift /projections → /)
10. Typecheck + build + commit + push

### Quality gates

- All new fetches use `apiGet` with Zod schemas
- Every zone wraps children in `<ErrorBoundary fallback={<SilentSkeleton/>}>`
- Every data surface shows a tiny freshness indicator ("42s ago")
- Cross-surface event bus (`onDataChanged`) honoured everywhere
- Zero `any` — add eslint-disable only where runtime shape is genuinely loose
- Dark-mode only (existing theme)
- Mobile: 3 zones stack vertically, top strip collapses to compact

### Performance budget

- Ultron first paint < 200ms (render from NourState cache)
- Pulse composite < 600ms p95
- Signal composite < 1.5s p95 (6 brain engines, cached aggressively)
- Ticker first tick < 300ms from cache

---

## Open questions (resolve before v2)

- Ticker source: free-tier news API vs. scraping + AP feed? Revisit at v2.
- Voice capture: Whisper on-device (web) or `/api/voice/transcribe` server round-trip?
- Bet desk resolution: manual only in v1, auto-resolve via outcome detection in v2?
- Tomorrow note: drafted by which AI profile? Probably `venice-smart` (cheap, fast, adequate).
- Rumination detection: client-side localStorage only in v1, server-persisted in v2 for cross-device?

---

**Last updated:** 2026-04-16 · v1 build in progress

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
