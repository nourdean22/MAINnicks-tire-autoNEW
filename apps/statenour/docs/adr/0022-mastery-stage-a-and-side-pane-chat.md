# ADR-0022 · Mastery Layer Stage A · Coach Channel beachhead + NickSidePane v2 (multi-turn surface chat)

**Status:** ACCEPTED · 2026-05-26 EOD
**Companion code:**
- `lib/services/coach-events.ts` + `lib/services/coach-events-types.ts` (split for client-bundle safety)
- 9 writers: `app/api/cron/{cost-anomaly,cost-slo-check,os-snapshot,pricing-advisor,eval-regression,correlation-alarm,creation-spike-detect,decision-quality-drift}/route.ts` + `src/inngest/functions/goal-pruner.ts`
- Reader: `app/api/coach/events/route.ts` + ack: `app/api/coach/events/[eventKey]/ack/route.ts`
- 5 banner mounts + 5 pane mounts: `app/(mastery)/{tasks,goals,journal,brain,scoreboard}/page.tsx`
- `components/mastery/coach-event-banner.tsx`
- `components/mastery/nick-side-pane.tsx` (v1 lite + v2 full)
- `components/mastery/multi-turn-chat.tsx` (Phase 5 FULL)
- `app/api/ai/side-pane-chat/route.ts` (streaming multi-turn endpoint · sibling of page-insight)
- `lib/ai/page-data.ts` (4 surface cases added · goals · journal · brain · scoreboard)
- `config/crons.ts` (reflect-categories registered)
**Tasks:** Coach Channel writers · NickSidePane Phase 5 FULL · #74 · #81 · #82 · all closed

## Context

ADR-0021 (P-wave + extension) shipped the Closed-Loop Calibrated Brain
substrate and the Chrome extension MVP, then deferred two unresolved
threads:

1. **Cross-surface coaching surfaces.** Five Mastery daily-driver pages
   (`/tasks` · `/goals` · `/journal` · `/brain` · `/scoreboard`) each
   had bespoke nudge surfaces — every detector cron emitted its own
   BrainMemory rows with category-specific keys, and every surface
   rendered them with different components. Adding a new detector meant
   editing N consumer surfaces; adding a new surface meant porting N
   detector handlers. Combinatorial coupling.
2. **Per-page Nick chat.** The existing `/chat` page is a system-wide
   thread. Operator-grade asks like "Nick, what should I focus on on
   *this* page?" required navigating away from the surface that
   prompted the question. PageNick (single-shot Q&A) shipped earlier
   but degraded to lossy single-turn flows · the operator could ask
   once and not follow up without losing context.

This ADR records the Mastery Layer Stage A completion that closed both
gaps via one unified channel — a single BrainMemory category that all
9 detectors write to and all 5 surfaces read from — and the NickSidePane
v2 that mounts a persistent per-page Nick presence on every Mastery
surface, with real multi-turn threads + proactive coach-event chips
above the chat composer.

## Decision

### Coach Channel · one event substrate, N writers + N readers

The Coach Channel is `BrainMemory(category = "coach_event")` with a
deterministic key shape:

    coach:<kind>:<subjectId>

Closed kind set (9 values, see `CoachEventKind` in `coach-events-types.ts`):
`pricing-advisory` · `prune-candidate` · `drift-recovery` · `idle-nudge` ·
`goal-pace-shift` · `mission-deadline-check` · `proactive-nick` ·
`anomaly` · `system-alert`. Adding a kind requires updating the union
+ shipping a writer that emits it. Closed set = dashboard / banner /
chip UIs can enumerate at build time without DB round-trips.

Closed surface set (5 values matching the Mastery surfaces):
`tasks` · `goals` · `journal` · `brain` · `scoreboard`.

#### Writers (9 shipped across two sub-waves)

| Writer | Trigger | Kind | Priority | Surfaces |
|---|---|---|---|---|
| goal-pruner | Inngest fn · weekly | `prune-candidate` | P2 | `goals` |
| pricing-advisory cron | weekly | `pricing-advisory` | P1 | `scoreboard` |
| os-snapshot drift detector | hourly | `drift-recovery` | P0/P1 | `scoreboard` |
| cost-anomaly cron | folded · mega-evening | `anomaly` | P1 | `scoreboard` |
| cost-slo-check cron | folded · mega-evening | `system-alert` | P0 | `scoreboard` |
| eval-regression cron | nightly | `system-alert` | P0 | `scoreboard` |
| correlation-alarm cron | every 6h | `anomaly` | P1 | `brain` |
| creation-spike-detect cron | folded · mega-evening | `anomaly` | P1 | `scoreboard` |
| decision-quality-drift cron | weekly · Sunday 11:00 UTC | `drift-recovery` | P0 | `scoreboard` |

Every writer is **best-effort + idempotent**. Per-day / per-week /
per-snapshot subjectId construction collapses retries; try/catch around
`recordCoachEvent` ensures the cron's primary path (Telegram / Brain-
Memory write) is never blocked by a channel emit failure. Existing
notification + alert paths stay byte-identical · the channel is
purely additive display surface.

#### Readers (5 surface mounts · 2 consumer types)

Each surface mounts two consumers of the same channel:
- `<CoachEventBanner surface="X">` — top-of-page editorial-minimalist
  banner with priority-graded tone + ack affordance + deep-link
- `<NickSidePane page="X" coachSurface="X">` — proactive chip stack
  inside the side pane above the multi-turn chat (compact title-only
  variant)

Both use the same `GET /api/coach/events?surface=X&limit=N` endpoint
via `usePollingFetch` with tab-visibility pause. The banner polls at
90s; the pane at 60s (more deliberate operator surface).

#### Client-bundle safety lesson

The first iteration imported `recordCoachEvent` from `coach-events.ts`
into `CoachEventBanner` (client component). That pulled prisma → fs
into the client bundle and broke `next build` at the pre-push gate.
Fix: extract the **types + pure helpers** to a sibling `coach-events-
types.ts` that the banner imports from; server callers continue to
import from `coach-events.ts` which re-exports the types. The pattern
is now the canonical split for any service module a client component
needs to typecheck against.

### NickSidePane v2 · multi-turn surface chat (Phase 5 FULL)

The Phase 5 LITE that shipped first was a shell wrapping the existing
PageNick (single-shot) inside a side-pane FAB. Phase 5 FULL replaces
the body with a real multi-turn thread:

- **Client owns thread state** · `Array<{role, content, ts}>` in a
  `useState` hook · persisted to `localStorage[nour:side-pane-thread:v1:<page>]`
  per-page so each surface has its own thread that survives reload.
- **Server is stateless** · `/api/ai/side-pane-chat` accepts the full
  message history each turn and streams Nick's reply via Vercel AI
  SDK `streamText` + `toTextStreamResponse()`. No conversation table,
  no server-side thread model. Operator who wants cross-device thread
  persistence opens `/chat` instead.
- **Voice consistency** · the new endpoint mirrors `/api/ai/page-insight`'s
  system-prompt enrichment exactly: `buildSystemPrompt()` (cached) +
  page framing via `describeFraming(page)` + `buildPageData(page)` +
  Strategic Frameworks lens block + operator-state injection (when
  confidence > 0). Anthropic `cacheControl: { type: "ephemeral" }` on
  the system message so follow-up turns hit the prompt cache.
- **AbortController** · client cancels mid-stream via the existing
  Loader2 → Send swap; mid-stream cancel drops the empty assistant
  placeholder and persists the prior history.
- **Proactive chips above the chat** · `<CoachChip>` renders the
  pane's `coachEvents` slice with priority-graded tone (P0 amber ·
  P1 gold · P2 neutral). Deep-link chips become `<Link>`s · non-link
  chips render inert.

### buildPageData · 4 new surfaces · multi-turn grounding

When Phase 5 FULL mounted on `/goals` · `/journal` · `/brain` ·
`/scoreboard`, the new chat endpoint fell through to
`buildPageData(page)` for grounding · all 4 surfaces hit the `default:
return ""` case so Nick's replies arrived with zero page context.
Fixed by adding 4 focused builders matching the existing token-budget
style (compact strings, parallel queries, ≤400 chars each):

- `goals` · active LifeGoal count + top by progress with domain/horizon
  + latest mastery axis scores
- `journal` · entries-this-week + active threads with coherence +
  dormant count
- `brain` · BrainMemory touched-this-week + top categories +
  most-recent rows
- `scoreboard` · SystemSnapshot headline + focus + unresolved drift
  alert count + latest mastery axis scores

### reflect-categories cron registration

The orphaned per-category CoALA synthesis route (Wave AB) is now
registered as `active` in `config/crons.ts` with `0 3 * * 0` (Sunday
03:00 UTC) per the route's own documented suggestion. Lands ahead of
Sunday-morning weekly-review.

## Consequences

**Net wins:**
- Adding a new detector = add a writer · zero consumer changes
- Adding a new surface = add the dual mount · zero detector changes
- Operator gets per-page multi-turn Nick without leaving the page
- Cost-cap loop closed end-to-end (0 bare `aiChat(` callers · all 62
  callers go through `tracedAiChat` / `makeTracedAiChat` factory) ·
  task #82 closed

**Deferred (not in this ADR):**
- `/system/coach-events` historical viewer (active-only API exists ·
  `includeAcked` flag exposed in `getActiveCoachEvents` but no surface
  consumes it yet)
- Per-chip "ask Nick about this" affordance (chips deep-link instead
  of converting into a multi-turn query)
- Phase 6 FULL gestures on LoopRowItem (needs `@use-gesture` dep
  approval)
- Stage C UnifiedChain (architectural cleanup with no current
  operator-visible payoff)

**Operating principles applied:**
- *kaizen* — smallest surgical writer migration per cron · each one
  best-effort + idempotent + leaves Telegram path byte-identical
- *karpathy* — server stays stateless · client owns thread state ·
  no schema changes
- *FRONTEND-DESIGN* — coach chips + pane chrome reuse the existing
  editorial-minimalist gold-accent vocabulary · no new tokens · no
  AI-slop

## Verification

- `pnpm --filter @statenour/web typecheck` clean across all 5 ships
- `pnpm --filter @statenour/web test` 185/185 files · 2812 tests pass
- All 5 commits pushed to `origin/main` · `f03ab83b` → `47c0598c`
- Prod build (pre-push turbo) succeeded on all 5 pushes
