# StateNour Page/Surface Inventory — Part B (rest of mastery pages)
Snapshot: git archive of origin/main @ abdd99395 (prod deploy 2026-09-02 13:23Z)
Auditor scope: /brain /pins /people /settings /system(+16 subpages) /content /market /learn /photo-improver /links /intelligence/brief /intelligence/ledger /decisions/[id] /goals /scoreboard /auth/sign-in /not-found + next.config.ts redirects()
Evidence classes: A = verified in code (path:line), H = inference, I = not verified/unknown.
Corpora referenced for "no reader/no writer" claims: app/, lib/, components/, features/, tools/, local-agent/, scripts/, tests/ (all rooted at apps/statenour/ in the snapshot).

STATUS: COMPLETE — all pages in scope covered (/brain, /pins, /people, /settings, /system hub + 16 subpages, /content, /market, /learn, /photo-improver, /links, /intelligence/brief, /intelligence/ledger, /decisions/[id], /goals, /scoreboard, /auth/sign-in, not-found, next.config.ts redirects).

---

## Nav single source of truth (verified)

`components/layout/nav-items.ts` — A. `NAV[]` drives bottom-tab-bar, more-sheet, and command-palette (comment at nav-items.ts:22-30 asserts this; not independently traced to all three renderers in this pass — H for the "all three render from this" claim, A for the array contents themselves).

Bottom tabs (`bottomTab:true`): `/`, `/chat`, `/missions`, `/journal` (nav-items.ts:53-56).
Flat MORE rows (`flatRow:true`): `/stats` (reflect), `/pins` (capture), `/learn`, `/photo-improver`, `/links` (execute) — nav-items.ts:57,60,66-68.
Tabbed hubs (`tabs:[...]`, own in-page tabs): `/content` (drafts/history/publish/outreach, line 63), `/market` (search/radar, line 65), `/brain` (memory/board/wisdom/reason, line 71).
`/people` — flatRow, reflect section (nav-items.ts:72).
`/system` — plain nav entry, section "operate", owns its own hub grid of sub-surfaces NOT listed in NAV (nav-items.ts:80, comment 74-79).
`/settings` — footer:true (nav-items.ts:83).
Hidden/absent from NAV entirely per comment (nav-items.ts:31-33): `/chat` alias routes, `/decisions/[id]`, `/auth/sign-in` (deep-link/system-only), `/goals` and `/scoreboard` (redirect stubs kept for compat).
`/intelligence/brief`, `/intelligence/ledger` are ALSO absent from NAV — not found anywhere in nav-items.ts (grep confirmed zero hits for "intelligence"). Reachability = deep-link/system-hub-link only unless another surface links them (checked per-page below).

## next.config.ts redirects() — full list (A, next.config.ts:170-280)

Non-permanent (308→ well, `permanent:false` = 307) unless noted:
- `/dashboard`, `/habits`, `/tasks` → `/missions`
- `/plan`, `/mastery` → `/stats` (permanent:true)
- `/nick` → `/chat` (permanent:true)
- `/knowledge` → `/brain` (non-permanent, deliberately so a future page can reclaim it)
- `/cockpit`, `/system/cockpit` → `/`
- `/business` → `/stats` (2026-09-02, per audit B-1/plan R7; comment notes a live-probed query-string ride-through bug: `/business?tab=money` → `/stats?tab=money`, tolerated by lib/stats/resolve-tab.ts fallback, not stripped)
- `/brain/health` → `/brain?tab=health`; `/brain/identity-trajectory`, `/brain/link-review`, `/brain/reflections` → `/brain`
- `/system/cron-diagnostics`, `/system/cron-runs` → `/system/crons`
- `/system/chat-health`, `/system/data-source-health` → `/system/health`
- `/system/coverage`, `/system/quality`, `/system/eval-results`, `/system/judge-eval`, `/system/operator-state`, `/system/lens-stats` → `/system/calibration`
- `/system/costs`, `/system/performance` → `/system/ai-cost`
- `/system/agent-traces` → `/system/logs`
- `/system/deployment-truth`, `/system/migrations`, `/system/repos`, `/system/policies`, `/system/skills`, `/system/features`, `/system/api-tokens`, `/system/devices`, `/system/brain-bus`, `/system/history`, `/system/prompt`, `/system/providers`, `/system/power`, `/system/digest`, `/system/reviews` → `/system` (hub)
- `/system/ghost-nour` → `/system/calibration`
- `/system/approvals` → `/system/actions`
- `/system/coach-events` → `/system/alerts`
- `/system/errors` → `/system/logs?view=errors`
- `/reason/history`, `/reason/telemetry`, `/reason` → `/brain?tab=reason`
- `/relationships` → `/people` (permanent:true); `/relationships/:path*` → `/people/:path*` (permanent:true); `/people/network` → `/people`
- `/system/tire-stock-requests` → `https://nickstire.org/admin` (EXTERNAL — boundary flag, see §9)
- `/system/vapi-calls` → `https://nickstire.org/admin` (EXTERNAL — boundary flag)
- `/customer-360/:customerId*` → `https://nickstire.org/admin` (EXTERNAL — boundary flag)
- `/financial`, `/funnel`, `/crm` → `/stats` (comment says crm "folded into /business Clients tab" originally, now `/business` gone so retargeted to `/stats`)
- `/finance` → `/money?tab=finance`; `/wealth` → `/money?tab=wealth` — NOTE: `/money` is not in NAV and not in this agent's scope; per memory MEMORY.md the personal `/money` page "predeceased" business (2026-07-29) — worth flagging: **these two redirects may point at a retired/nonexistent `/money` page** (I — not verified in this pass, out of scope; flagging for cross-check).
- `/seo` → `/market?tab=search`; `/radar` → `/market?tab=radar`
- `/brain/board` → `/brain?tab=board`; `/brain/wisdom` → `/brain?tab=wisdom`
- `/body` → `/stats#body`; `/life` → `/stats`
- `/content/drafts` → `/content?tab=drafts`; `/content/history` → `/content?tab=history`; `/social` → `/content?tab=publish`; `/outreach` → `/content?tab=outreach`

**Boundary flag (repeats in §9):** three redirects explicitly ship the operator OFF statenour to `nickstire.org/admin` — `/system/tire-stock-requests`, `/system/vapi-calls`, `/customer-360/:customerId*`. These are StateNour routes whose content is shop-operational (tire stock, VAPI call logs, customer 360) and the app itself routes them externally rather than rendering shop ops in the personal OS — this is evidence FOR the product boundary doctrine being actively enforced here, not a violation. Inventory note, not a verdict.

---

## /brain — app/(mastery)/brain/page.tsx (92 lines)

**JOB (A, page.tsx:44-49):** "the unified self-model surface" — everything the system knows about the operator: self-model, advisors, wisdom, governed knowledge, live reasoning.

**Nav surface (A):** /brain is in NAV as a tabbed hub, "reflect" section (nav-items.ts:71) — reachable via bottom-tab MORE sheet + Cmd-K. NAV's declared sub-tabs (memory, board, wisdom, reason) are a SUBSET of what the page actually renders (H: NAV's `tabs` field appears to be a curated Cmd-K hint list, not the full tab set).

**Component tree (2 levels, A page.tsx:52-90):**
- StandardPage > PageTabs with 9 tabs (not 4): `graph`(Map) -> HomeBrainGraph variant="full"; `discover` -> DiscoverTab; `review` -> GovernedKnowledgeReview (= ResearchPipelineStatus + KnowledgeActionOutcomes + KnowledgeReviewTab, page.tsx:28-38); `memory` -> MemoryTab; `wisdom` -> WisdomTab; `board` -> BoardTab; `reason` -> ReasonTab; `continuity`(Changed) -> BrainContinuityView; `health` -> BrainHealthView.
- Sibling: NickSidePane (page="brain", coachSurface="brain", 4 preset prompts) — same AI side-pane pattern used elsewhere.
- Comment at page.tsx:57-64 states tab keys (?tab=memory&resolve=, ?tab=reason&q=, ?tab=wisdom&focus=, ?tab=board, ?tab=health, ?tab=continuity) are "live deep-link contracts from Home, the ticker, the command palette and chat tool results" (H — not independently traced to each caller in this pass).

**DATA READS — 49 trpc.brain.*/trpc.system.*/trpc.journal.*/trpc.operator.* useQuery/useMutation calls across the 9 tab components** (A, full list captured; representative, not exhaustive per component):
- active-alerts-card.tsx:87,90,96 — trpc.brain.resolveAlert.useMutation, trpc.brain.muteAlertCategory.useMutation, trpc.brain.activeAlerts.useQuery
- beliefs-panel.tsx:39-41 — trpc.brain.beliefs.useQuery, harvestBeliefs.useMutation, actOnBelief.useMutation
- board-tab.tsx:82,84 — trpc.brain.consultBoard.useMutation, trpc.brain.recentBoardConsultations.useQuery
- brain-maturity-header.tsx:54-55,68 — trpc.brain.maturity.useQuery, trpc.brain.reset.useMutation, utils.brain.exportBrain.fetch() (imperative tRPC fetch, not raw HTTP)
- continuity-view.tsx:92 — trpc.brain.continuityReport.useQuery()
- contradiction-resolution-panel.tsx:58,61 — trpc.brain.contradictions.useQuery, resolveContradiction.useMutation
- discover-tab.tsx:153,157 — trpc.brain.discoveries.useQuery, rateDiscoveryCluster.useMutation
- health-view.tsx:82,92,96 — trpc.brain.memoryHealth.useQuery(), trpc.brain.conversationCompileStatus.useQuery, compileConversations.useMutation
- insight-ribbon.tsx:59 — trpc.brain.insightsRibbon.useQuery()
- judgment-quality-panel.tsx:23-24 — trpc.system.wisdomGateSpc.useQuery + trpc.system.takeCalibration.useQuery (both staleTime: 300_000 = 5min) — cross-domain read (system data shown inside /brain).
- memory-tab.tsx:251,283,374 — trpc.brain.identityDelta.useQuery, trpc.journal.learningVelocity.useQuery (cross-domain), trpc.brain.calibrationSummary.useQuery
- nudge-panel.tsx:62-63 — trpc.brain.nudges.useQuery, dismissNudge.useMutation
- page-tracker.tsx:16 — trpc.brain.pageVisit.useMutation (analytics beacon, fires on mount presumably)
- pattern-card.tsx:45,48 — trpc.brain.patterns.useQuery, regeneratePatterns.useMutation
- pinned-context-panel.tsx:100,104-106 — trpc.operator.commandCenterState.useQuery (cross-domain), trpc.brain.createPin/updatePin/deletePin.useMutation
- prediction-streaks-card.tsx:45 — trpc.brain.predictionStreaks.useQuery
- qualitative-identity-panel.tsx:60,62-63 — trpc.brain.qualitativeIdentity.useQuery, recomputeQualitativeIdentity.useMutation, editQualitativeIdentity.useMutation
- recall-inbox-panel.tsx:131 — trpc.brain.recallInbox.useQuery
- receipts-timeline.tsx:53 — trpc.system.receiptFeed.useQuery({limit}, {staleTime:30_000}) (cross-domain)
- suggestion-telemetry-panel.tsx:40-41 — trpc.brain.suggestionStats.useQuery(undefined, {refetchInterval: 15_000}) — only polling interval found in /brain: 15s
- tool-telemetry-panel.tsx:80 — trpc.brain.toolTelemetry.useQuery
- wisdom-evolution-panel.tsx:80,83-84 — trpc.brain.wisdomEvolution.useQuery, actOnWisdom.useMutation, recordTelemetry.useMutation
- wisdom-tab.tsx:209-210,214 — trpc.brain.updateWisdom.useMutation, actOnWisdom.useMutation, utils.brain.wisdom.fetch()

**Dual data-access (raw fetch alongside tRPC) — FLAG:** components/brain/brain-insights-panel.tsx:60,63,66 calls raw fetch("/api/brain/wisdom/violations?days=7&limit=3", FETCH_OPTIONS), fetch("/api/brain/wisdom/evolution", ...), fetch("/api/brain/improve-agent?days=7", ...) — this component sits on the SAME page as ~20 sibling components that use trpc.brain.*. Confirmed dual-access pattern (A). Also related-wisdom-links.tsx:68 does a raw fetch("/api/brain/telemetry", {...}) (POST, fire-and-forget telemetry, not a read).
Four components (brain-maturity-header.tsx, insight-ribbon.tsx, continuity-view.tsx, health-view.tsx) carry comments stating they were MIGRATED from useAuthedFetch(...) onto tRPC (brain-maturity-header.tsx:16-18, continuity-view.tsx:81-82, health-view.tsx:72-73, insight-ribbon.tsx:52-53) — i.e. the dual-access pattern is a known-and-being-reduced legacy shape, not universal; brain-insights-panel.tsx is the one holdout not yet migrated (H, based on comment pattern applying to siblings but not itself).

**CONTROLS:**
- Destructive: "Reset the ENTIRE brain state" — brain-maturity-header.tsx:79-90+ (resetBrain callback) -> trpc.brain.reset.useMutation(). Uses in-DOM useConfirmDialog (danger tone) THEN usePromptDialog (typed confirmation) — explicit iOS-PWA-safe two-gate pattern, comment cites window.confirm()/prompt() being silently suppressed in standalone mode (A, lines 48-51). This is a well-built destructive-action pattern — the only one directly confirmed in /brain.
- Export (brain-maturity-header.tsx:67-79) — exportBrain() calls utils.brain.exportBrain.fetch(), builds a client-side Blob + <a download>, no server persistence needed (correct pattern, not a no-op).
- Refetch/retry buttons throughout (onClick={() => void xQuery.refetch()}) — real, not no-ops (confirmed pattern in active-alerts-card.tsx:110, prediction-streaks-card.tsx:64, others).
- window.confirm/alert/prompt — NONE found via direct grep in components/brain/*.tsx (both hits at brain-maturity-header.tsx:49 and wisdom-tab.tsx:157 are comments EXPLAINING why the code avoids them, not actual calls) — A, this domain follows the iOS-PWA-safe pattern correctly at the surface level checked.
- Did NOT verify every mutation's button-to-handler wiring individually for all 9 tabs in this pass (time-boxed) — flagged as NOT VERIFIED for tabs beyond maturity-header/reset.

**AI CHROME / pseudo-metrics — brain maturity score (A, formula fully read):**
lib/services/brain-domain.ts:187-284 buildBrainMaturity() — a 0-100 weighted-sum score, NOT ML-derived, NOT calibrated against any ground truth found:
```
pts.skills = min(20, (activeSkills+graduated)*2)
pts.identity_axes = axesFilled * (15/8)
pts.history = min(15, historyDays.length*0.5)
pts.qualitative = min(15, qualitativeEntries*0.75)
pts.beliefs = min(10, activeBeliefs*1)
pts.contradictions = allContradictions.length==0 ? 7 : max(0, resolveRate*10 - min(5,openCount))
pts.ghost = accuracy!=null ? min(10, accuracy*(10/0.6)) : 0
pts.chat_memory = min(5, importanceCount/40)
score = round(sum(pts.*)), clamped [0,100]
```
(brain-domain.ts:255-284). Every upstream loader is wrapped .catch(() => [] / null / 0) (lines 202-229) — a failed subsystem read silently becomes a ZERO input to the score rather than surfacing as unknown, which lowers the displayed maturity score instead of flagging degraded data. This is a genuine UNKNOWN-not-equal-HEALTHY-adjacent violation: a DB hiccup on loadActiveBeliefs() looks identical to "operator truly has zero active beliefs" in the final score. No calibration file, backtest, or defined target found for this score (searched lib/services/brain-domain.ts in full — I: "no definition of what the 0-100 range MEANS" beyond the arithmetic itself).
- Other scored surfaces spotted but not formula-traced in this pass (time-boxed, flagged NOT VERIFIED): ghost accuracy (loadGhostAccuracy), calibration summary (trpc.brain.calibrationSummary), wisdom-gate SPC (trpc.system.wisdomGateSpc) — these feed brain but their formulas live outside brain-domain.ts and were not opened.

**MODALS/SHEETS:** useConfirmDialog + usePromptDialog in-DOM dialogs (brain-maturity-header.tsx) for the reset flow — confirmed. Did not enumerate every modal across all 9 tabs (time-boxed).

**Boundary flag:** none — /brain content is entirely personal-OS self-model data, no shop-operational leakage observed.

**NOT VERIFIED for /brain (time-boxed):** full button-by-button wiring for board-tab, discover-tab, knowledge-review-tab, wisdom-tab, continuity-view, reason-tab (only DATA READS + top-level structure confirmed for these); whether HomeBrainGraph variant="full" duplicates or diverges from the Home page's own graph instance (out of this agent's scope — Home is the other agent's).

---

## /pins — app/(mastery)/pins/page.tsx (437 lines)

**JOB (A, page.tsx:3-16):** management UI for the `pinned_user` brain-memory category; top-5 pins by recency inject into every system prompt, pins beyond #5 are queryable but not auto-loaded.

**Nav surface (A):** flatRow, "capture" section (nav-items.ts:59) — bottom-tab MORE sheet + Cmd-K.

**Component tree (2 levels):** `StandardPage` > inline sections: new-pin form Panel, stats Panel (5 `Stat` tiles), pin-list Panels (map over `data.pins`), error Panel, empty-state Panel, `confirmDialog` mount. No sub-component imports beyond `Panel`, `SortDropdown`, `Stat` (local fn). Self-contained page, not a tab hub.

**DATA READS (A):**
- `trpc.brain.createPin.useMutation()` (page.tsx:112), `trpc.brain.updatePin.useMutation()` (113), `trpc.brain.deletePin.useMutation()` (114), `trpc.system.flushPromptCache.useMutation()` (116, cross-domain — hot-flushes prompt cache after a pin write so the next chat turn sees it without waiting the 45s TTL, page.tsx:203-206).
- Read is an imperative tRPC call, not `useQuery`: `utils.brain.pinned.fetch({ withStats: true })` (page.tsx:121), invoked from a manual `load()` callback on mount (132) and on a data-change bus event `onDataChanged(["brain"], ...)` (141) — so pin list refreshes when chat's `pinMemory` tool fires or the chat swipe-to-pin gesture fires, not via polling.
- No `refetchInterval` / polling found on this page (A — grep clean).

**Dead/stale-comment flag (A, cross-file):** page.tsx:29 comment says "Legacy REST route stays mounted" referring to `app/api/brain/pinned` (route file confirmed present: `app/api/brain/pinned/route.ts`... — directory `app/api/brain/pinned` exists, A). Grepping app/, components/, lib/, features/, tools/, local-agent/, scripts/, tests/ for `api/brain/pinned` string finds only 3 hits outside the route file itself: `components/brain/pinned-context-panel.tsx:20` (a comment claiming "Talks to /api/brain/pinned" that is now STALE — the code below it at lines 100-106 actually calls `trpc.operator.commandCenterState.useQuery` + `trpc.brain.createPin/updatePin/deletePin.useMutation`, not fetch), `lib/services/pins.ts` (likely the route's own service layer — not independently opened this pass), and `scripts/smoke-pins.ts` (a smoke-test script, not app runtime). **Finding: `app/api/brain/pinned` appears to be a dead legacy REST route with no live UI caller** — both surfaces that render pins (`/pins` page and `PinnedContextPanel` embedded in `/brain?tab=memory` via `components/brain/memory-tab.tsx`) have migrated to tRPC. Class H (not proven dead at runtime — could still be hit by an external client, cron, or the local-agent CLI not grepped in this specific check) but the corpus search is complete for app/components/lib/features/tools/local-agent/scripts/tests.

**CONTROLS:**
- **Unpin (destructive, low-severity):** `unpin(id)` (page.tsx:176-190) → in-DOM `confirm({title:"Unpin this?", body:"Removes from system-prompt context.", confirmLabel:"Unpin"})` (real two-tap dialog via `useConfirmDialog`, comment at 84-85 explicitly cites iOS-PWA `window.confirm()` suppression as the reason) → on confirm, `deletePinMutation.mutateAsync({id})` → `load()` → `notifyDataChanged`. Real persistence, not a toast-only action.
- **Create pin:** `createNewPin()` (192-214) → `createPinMutation.mutateAsync` → fire-and-forget `flushPromptCacheMutation.mutate` (comment: "a flush failure must not block the pin create", 205) → reload + bus notify. No confirm needed (non-destructive).
- **Edit pin:** `saveEdit()` (156-174) → `updatePinMutation.mutateAsync` → reload + bus notify. Real persistence.
- All three mutations funnel errors into the page-level `error` state (`setError(e instanceof Error ? e.message : String(e))`), rendered in a dedicated error Panel (238-245) — not swallowed.
- No `window.confirm/alert/prompt` direct calls (A, grep clean; the one hit at line 84 is the explanatory comment).

**STATES (A):**
- Loading: `StandardPage loading={loading && !data}` (235) — dedicated loading prop, not a manual skeleton.
- Error: distinct rose-tinted Panel with `AlertCircle` icon (238-245) — never coerced into 0/empty.
- Empty: `{!loading && data && data.pins.length === 0}` → "No pins yet. Add one above..." (415-420) — correctly distinguished from both loading and error states (three-way branch confirmed, not a single `data?.pins?.length` fallback).

**AI CHROME / pseudo-metrics:**
- **Staleness classification** (page.tsx:66-73, `staleness()`): fresh <7d, warm <14d, stale <30d, very-stale ≥30d — a plain age-bucket function, not a learned/calibrated score. Deterministic and correctly labeled as an age bucket, not dressed up as intelligence.
- **`estimatedPromptTokens`** stat (Stat tile, line 292) — sourced from server `stats.estimatedPromptTokens` (shape only, formula lives server-side in `lib/services/pins.ts` / the `brain.pinned` tRPC procedure — NOT opened in this pass, flagged NOT VERIFIED for the actual token-estimation formula).
- **`injectedIds`** (219-222) — computed client-side via `selectInjectedPinIds()` from `lib/pins/injected.ts`, explicitly using "the SERVER (injection) order, NOT the display sort" (comment 216-218) so the injected badge stays correct under re-sort — a correctness-oriented computation, not a vanity metric.

**MODALS:** one in-DOM confirm dialog (unpin). No sheets/drawers/popovers found on this page.

**SETTINGS relevance:** `sortKey` (5 modes: default/freshest/stalest/alpha/longest) persists to `window.localStorage["pins:sortKey"]` (page.tsx:96-104) — pure client-side view preference, not a server setting; has a reader (the same key is read back on mount, line 98-100) — functioning localStorage round-trip, correctly scoped to a display preference.

**Boundary flag:** none — pins are personal-OS memory content.

---

## /people — app/(mastery)/people/page.tsx (1016 lines)

**JOB (A, page.tsx:2-20):** "Power Atlas" — a sorted person list (trust/leverage roll-up) anchoring a selectable detail panel: dossier, ledger, Greene-law tags, power balance, log/blow-up actions. File-header comment still calls it "/relationships" (page.tsx:4) though the route and NAV label are "/people" (renamed 2026-05-28 per next.config.ts redirect comment) — stale doc-comment, not a functional bug.

**Nav surface (A):** flatRow, "reflect" section (nav-items.ts:72) — bottom-tab MORE sheet + Cmd-K. Also deep-link-reachable via `#person-<id>` hash anchor (page.tsx:206-226, e.g. from the watchlist or any cross-page CTA — opens the browse `<details>`, selects, and scrolls).

**Component tree (2 levels, A imports at page.tsx:35-63):** `StandardPage` > `NicksRelationshipsBrief`, `TodaysPicks`, `RelationshipsWatchlist`, `ContextualGreeneSidebar`, `PersonEditDrawer`, person-list rows, `DetailPanel` (wrapped in local `DetailPanelErrorBoundary`, page.tsx:941-975 — a React class-component error boundary scoped to just the detail panel "so the people-list above stays interactive even if the detail panel errors", 938-940) containing: `DossierEditor`, `LedgerTimeline`, `PowerBalanceGauge`, `BlowUpModal`, `LogLedgerModal`, `AlphaMoments`, `ArcProjection`, `PowerPlaysModal`, `SocialProof`, `ReciprocityCard`, `ToneShiftCard`, `TopicGoalOverlapCard`, `PowerPlaysHistory`, `PendingClassificationBanner`/`RelationshipXpChip`/`OpenPromisesPanel` (from `PersonInsights`).

**DATA READS — confirmed DUAL data-access (A):**
- `usePollingFetch<PeopleResponse>("/api/people?sort=${sortKey}&limit=100", {intervalMs: 5*60_000})` (page.tsx:201-204) — **polling interval: 5 minutes**, comment "people change slowly".
- `rawFetch<{items:WatchlistItem[]}>("/api/relationships/watchlist", {...})` (page.tsx:188) — raw REST, separate from the tRPC calls below, on the SAME page.
- `trpc.task.personProfile.useQuery({personId}, {enabled: !!selectedPersonId})` (page.tsx:243-246) — detail fetch, fires on selection.
- `trpc.task.softDeletePerson.useMutation()` (254), `trpc.task.updatePowerBalance.useMutation()` (760).
- `components/relationships/todays-picks.tsx:235` — raw `fetch("/api/relationships/log-outreach", {...})` — a THIRD distinct raw-fetch call on this page's component tree.
- `components/relationships/person-edit-drawer.tsx:95-97,111` — `trpc.task.createPerson/updatePerson/softDeletePerson.useMutation`, `trpc.task.personProfile.useQuery`.
- Power-atlas sub-components add 13 more tRPC calls, all `trpc.task.*`: `AlphaMoments.tsx:26` (listAlphaMoments query), `ArcProjection.tsx:45` (projectArc mutation), `BlowUpModal.tsx:47` (flipPersonStatus mutation), `DossierEditor.tsx:37` (updateDossier mutation), `LedgerTimeline.tsx:73,172,181` (markAlphaMoment mutation, listAlphaMoments query, deleteLedger mutation), `LogLedgerModal.tsx:87` (logLedger mutation), `PersonInsights.tsx:51,57` (acceptClassification/dismissClassification mutations), `PowerPlaysHistory.tsx:120` (markPlayOutcome mutation), `PowerPlaysModal.tsx:226` (runPowerPlay mutation), `SocialProof.tsx:27` (socialProofFor query).
- **Net: this single page mixes one polling-REST list fetch, two more one-off raw `fetch()` calls, and 17 tRPC hooks** — the widest dual-access spread found in this agent's scope. `ReciprocityCard`, `ToneShiftCard`, `TopicGoalOverlapCard`, `RelationshipsWatchlist`, `ContextualGreeneSidebar`, `NicksRelationshipsBrief` carry NO data calls of their own (grep clean) — purely presentational, fed by parent props (A).

**CONTROLS:**
- **Inline delete (destructive, real 2-tap, NOT `window.confirm`):** `handleRowDelete()` (page.tsx:261-281) — first tap arms `confirmDeleteId`, auto-disarms after 4000ms via `window.setTimeout` (266-269), second tap within the window calls `softDeleteFromRow.mutate({personId})`. Soft-delete (`deletedAt`, ledger preserved, revivable per comment 250-253) — genuinely reversible destructive action with a receipt.
- **BlowUpModal (destructive, typed-reason gate):** `components/power-atlas/BlowUpModal.tsx:1-12,34-50` — requires a reason ≥5 chars before `trpc.task.flipPersonStatus.useMutation()` sets `status="blown_up"`; reason persists forever on `PersonProfile.blowUpReason`, revealed on any future revival attempt (comment 6-8) — real Dialog primitive (in-DOM), not `window.confirm`.
- **PowerBalanceGauge slider:** `components/power-atlas/PowerBalanceGauge.tsx:19-31` — Phase-2 manual slider (-1..1, step 0.05); its `onUpdate` callback (wired in `DetailPanel`, page.tsx:760-764: `trpc.task.updatePowerBalance.useMutation`) ALSO sets `powerBalanceManualLock=true` server-side so the auto-compute engine (below) permanently skips this profile once the operator manually rates it — confirmed real persistence, not a local-state-only slider.
- No `window.confirm/alert/prompt` found anywhere in `app/(mastery)/people/page.tsx`, `components/power-atlas/*.tsx`, or `components/relationships/*.tsx` (A, full grep clean across all three) — this domain fully follows the iOS-PWA-safe in-DOM pattern.

**STATES (A):**
- Loading: `StandardPage loading={loading && !data}` (people list); `personDetail` has its own loading state (not traced in detail).
- Error: list-level `{error && !data && (...)}` (619) rendered distinctly; detail-level `{personDetail.error && (...)}` (633-636) rendered distinctly; PLUS a dedicated React error boundary (`DetailPanelErrorBoundary`, 941-975) around the whole detail panel specifically because (comment 933-935) "operator clicking rows with no panel and no console errors" was an observed silent-failure mode — this is a directly-cited past incident being defended against, not speculative hardening.
- Empty: `{data && data.people.length === 0 && !loading && (...)}` (417-420) — "No people profiles yet · the people-intelligence engine builds these" — correctly distinct from loading/error.

**AI CHROME / pseudo-metrics:**
- **`trustScore`** (0-1, `PersonRow.trustScore`, page.tsx:22-30) — a stored `PersonProfile.trustScore` DB column (`app/api/people/route.ts:31,66,89`), read directly, not recomputed at render. One concrete write path found: `lib/brain/conversation-memory.ts:416` — a background conversation-digest process passes `trustScore: sentiment==="positive"?0.7:sentiment==="negative"?0.3:0.5` as a CREATE-default candidate into `resolvePersonByName(...)` with `createIfMissing:false` (comment 415-420: enrichment-only, never auto-creates a profile from a name scraped out of chat). This is a coarse 3-bucket sentiment mapping, not a calibrated trust model — I: no broader trust-score recompute/decay job found in the time budgeted for this page (NOT VERIFIED beyond this one write site).
- **`powerBalance`** (-1..1) — genuinely auto-computed: `lib/brain/power-balance-engine.ts:1-95` `computePowerBalance()`, a 3-signal weighted heuristic (reciprocity asymmetry 90d + role-based prior + last-10-ledger-entry trend, file header 1-19), explicitly checks and RESPECTS `powerBalanceManualLock` (returns `null` when locked, lines 27-46). Confirmed callers: `app/api/cron/dossier-autodraft/route.ts:19,85` (cron `name:"dossier-autodraft"`, `config/crons.ts:809-822`, `mode:"active"`, weekly Monday-UTC self-gated cadence via the mega-morning fan-out) and `lib/ai/tools/brain.ts:1555,1569` (an AI-agent tool path, wrapped `.catch(()=>null)`). **Doc-drift flag:** the engine file's own header (power-balance-engine.ts:14-16) says "the reciprocity-tracker-update cron is the sole writer", but no cron named `reciprocity-tracker-update` exists in `config/crons.ts` (grep clean) — the actual sole scheduled writer is `dossier-autodraft`. Also `PowerBalanceGauge.tsx:14` still says "Phase 3 will auto-derive this" in future tense though Phase 3 (`power-balance-engine.ts`) is already shipped and wired — stale comment, functionally harmless.
- **`RelationshipXpChip`** ("+N XP", `components/power-atlas/PersonInsights.tsx:135-150`) — pure display component; the `xp:{total,count,byStat}` value is passed down from `DetailPanelData.xp` (page.tsx:738), itself part of the `trpc.task.personProfile` query payload. **Formula not traced in this pass — server procedure not opened. NOT VERIFIED / "no definition found" at the depth checked** (would live in `lib/trpc/routers/task.ts` or `lib/mastery/people-credit.ts`, the latter found via grep but not opened).
- **`SocialProof`** (`trpc.task.socialProofFor.useQuery`) and **`AlphaMoments`**/**`ArcProjection`** formulas — not traced (time-boxed, NOT VERIFIED).

**MODALS/SHEETS:** `BlowUpModal` (Dialog), `LogLedgerModal` (deposit/withdraw ledger entry, triggered via `onOpenLog` from DetailPanel), `PowerPlaysModal` (`runPowerPlay` mutation), `PersonEditDrawer` (create/edit person, opened via the page's top-right "add" Button and per-row Edit).

**Boundary flag:** none — /people is personal-relationship content (family/friends/advisors framing per "Greene laws", "power atlas" language), no shop-operational leakage observed. Worth noting the domain vocabulary (leverage, power plays, blow-up) is unusually adversarial/strategic for a "people" page — an inventory observation, not a verdict, per the audit's product-boundary doctrine (this is a different axis than the nickstire-boundary question).

---

## /settings — app/(mastery)/settings/page.tsx (28 lines) + components/settings/* (15 files, 3792 lines)

**JOB (A, page.tsx:3-8):** "the operator's live ops console" — a 2026-07-02 redesign that replaced one long vertical stack with a 4-domain split-pane console.

**Nav surface (A):** footer:true (nav-items.ts:83) — MORE-sheet footer row, always reachable.

**Component tree (2 levels, A, settings-console.tsx full read):** `StandardPage` > `SettingsConsole(pulse)` > 4-domain tab switcher:
- **Identity & Behavior:** `IdentityPanel`, `JournalBrainPanel`, `PeopleScoringPanel`, `SkillLibraryPanel`.
- **Cognitive Engine:** `AiSettingsPanel`, `IntelligenceFlagsPanel`, `OperatingRhythmToggle`.
- **Automations:** `CronControlPanel`, `PushNotificationToggle`, `TickerDismissalReset`.
- **System Diagnostics:** `SystemOpsHub` (a live-badge NAV GRID to `/system/*` subpages, not itself a settings surface — sourced from `useSystemPulse`, settings-console.tsx comment 5-22), `HQErrorsCard`, `SystemHealthCard`, `SystemDataCards`, `DeployChip`, `CommandSpinePulse`, `SystemInfoCard` — these six are read-only diagnostic displays, covered briefly here since they're mounted in Settings but substantively belong to the System domain (the other agent's /system pages likely reuse or duplicate several of them — cross-check flagged, NOT VERIFIED which is canonical).

### §7 SETTINGS ENUMERATION — every setting/toggle/field found, with storage + reader

**1. Feature flags (`IntelligenceFlagsPanel`, A)** — `trpc.operator.featureFlags.useQuery()` (intelligence-flags-panel.tsx:36) reads `FLAG_REGISTRY` (`lib/feature-flags.ts:73-...`), **37 flags total** (`grep -c '^\s*key: "'` = 37), of which **14 are `readOnly: true`** (env-controlled, display-only): `AUTH_ALLOW_MOCK_IN_PROD, LOCAL_DEV_BYPASS_AUTH, AI_PROVIDER, QUIET_DB_LOG, BRAINTRUST_API_KEY, BGE_RERANK, REPLICATE_FLUX, NICK_MEMORY_GATEWAY_PHASE1, NICK_MEMORY_GATEWAY_PHASE2, NICK_SPAR_VS, NICK_PRIME_PROMPT, NICK_HIGH_SPEC_GATE, NICK_CHAT_INTENSITY, INNGEST_MEGA_V2`. The mutation itself enforces this server-side, not just in the UI: `trpc.operator.setFeatureFlagOverride` (operator.ts:502-523) looks up the flag spec and `throw`s `BAD_REQUEST` ("...is environment-controlled and cannot be overridden from the settings board") if `spec.readOnly` — genuine defense-in-depth, not merely a disabled UI element. The remaining **23 flags are DB-override-capable**: stored in `UserPreference` (`category: "feature_flags"`, one row per key), and every flip writes an `AuditEvent` row FIRST (`eventType: "feature_flag_override"`, old→new value, operator.ts:532-544) — "best-effort: an audit failure never blocks the flip, but it is logged loudly" (comment 527-531). The panel visually distinguishes read-only flags (`isReadOnly` branch, intelligence-flags-panel.tsx:162).

**2. AI config (`AiSettingsPanel`, A) — a documented dead-control cleanup, directly on-topic:**
The panel's own comment (ai-settings-panel.tsx:320-327) states: *"Reasoning Effort, AI Web Search and Semantic Tool Pruning were REMOVED — each wrote a config field with ZERO runtime readers (provider/temperature/effort/search are decided per turn by classifyTurn + the provider chain; pruneTools never consulted toolEmbeddingsEnabled). A control that writes to nothing is a lie with a nice label. Wire a reader before resurfacing any of them. Survivors below are the fields the runtime actually reads: defaultMode (derive-turn-signals) + disabledTools (prepare-tools)."*
Corroborated server-side at `lib/settings/ai-config.ts:29-36`, dated **"ACCEPTED-LEGACY, NO RUNTIME READER (2026-09-01 settings audit)"**: `defaultProvider`, `temperature`, `reasoningEffort`, `webSearch`, `toolEmbeddingsEnabled` plus the DB halves of `hapticFeedback`/`showSpeedRibbon` are still accepted by `aiConfigPatchSchema` (so old stored rows stay valid) but nothing reads them at runtime; their Settings controls were removed the same day. **Currently live AI-settings controls (A, grep of actual `<Row>`/`<Toggle>`/`<input>` elements, ai-settings-panel.tsx):**
  - **Default Mode** (SegmentedSelect: auto/standard/deep) → `patch({defaultMode})` → `trpc.operator.updateAiConfig.useMutation()` → `AiConfig.defaultMode` (Prisma-backed singleton via `updateAiConfig()`, `lib/settings/ai-config.ts:142-157`) — has a real reader (`derive-turn-signals`, per comment).
  - **Haptic Feedback** toggle → `localStorage["nour:haptic-enabled"]` ONLY (ai-settings-panel.tsx:96,343-350) — comment: *"the old dual DB write had no reader and made a second device's switch lie"* (339-340) — a directly-documented past no-op/inconsistency bug, now fixed by dropping the DB write entirely. Real reader: `lib/ui/haptic.ts:21-29` `isEnabled()` reads the same localStorage key.
  - **Speed Ribbon** toggle → `localStorage["nour:chat:speed-ribbon"]` ONLY (104,354-362) — same fix pattern.
  - **Tool Blocklist** (`disabledTools: string[]`, free-text add/remove, 375-400) → `patch({disabledTools})` → `AiConfig.disabledTools` — real reader per comment ("prepare-tools").
  - **Reset to Nick's tuning** button → `trpc.operator.resetAiConfig.useMutation()` (operator.ts:488-490) — resets the whole `AiConfig` row to defaults; no confirm dialog observed in the grep (time-boxed, NOT independently verified whether this has a confirm gate).
  - **Sync Drive** → `trpc.operator.syncDrive.useMutation()` (ai-settings-panel.tsx:139) — purpose not traced this pass (NOT VERIFIED).

**3. Journal/Brain settings (`JournalBrainPanel`, A)** — `trpc.journal.getSettings`/`updateSettings` (journal-brain-panel.tsx:56,63) → `JournalSettings` Prisma singleton (`id:"singleton"`, `journal.ts:736-752`), 7 fields: `baselineXp` (0.1-5), `baselineEnabled` (bool), `qualityFloorChars` (0-2000 int), `groundedXpMultiplier` (1-5), `autoConfirmThreshold` (0-1), `challengeCadence` (every/daily/off), `creativeIntensity` (bold/balanced/off). All server-validated via zod at the procedure boundary (journal.ts:738-746).

**4. People-credit XP weights (`PeopleScoringPanel`, A)** — comment (people-scoring-panel.tsx:6-11): *"Operator control for the people-credit XP weights ... Reads/writes via trpc.task.get/setPeopleXpConfig (UserPreference key `people_credit.weights`). Blank/invalid values fall back to the engine defaults, so this can never zero out scoring by typo."* 5 fields: `depositBase` (0-5), `depositPerAmount` (0-1), `depositMax` (0-10), `reconnectBonus` (0-5), `play` (0-10) — this IS the formula backing the `/people` page's `RelationshipXpChip` "+N XP" display (cross-reference to the /people section above, which flagged the XP formula as not-traced — the WEIGHTS are here; the full computation combining weights+events was not opened).

**5. Skill library curation (`SkillLibraryPanel`, A)** — comment (skill-library-panel.tsx:3-17): 3 tabs (Candidates/Active/Graduated) over `BrainMemory` rows (`category:"skill"`/`"skill_pending"`, "so there's no schema"), all writes via `trpc.operator.curateSkill.useMutation()` (line 111). Promote/drop/graduate actions on auto-extracted behavioral skills.

**6. Identity axes (`IdentityPanel`, A)** — 8-axis self-model, each a 0-100 bar with a pin/override control: `trpc.operator.identity.useQuery` (117), `trpc.operator.recomputeIdentity.useMutation` (132), `trpc.operator.pinIdentityAxis.useMutation` (133). Comment (3-10): "Pinned values win over computed values everywhere Nick reads the snapshot." Storage backing not traced past the tRPC boundary this pass (NOT VERIFIED which table — likely `IdentitySnapshot`/`IdentityAxis`, referenced also by `/brain` maturity's `axesFilled` computation, brain-domain.ts:233-238).

**7. Autopilot / operating rhythm (`OperatingRhythmToggle`, A) — a second, larger documented dead-UI cleanup:**
Comment (operating-rhythm-toggle.tsx:3-23): *"The ONLY autopilot flag a worker actually reads: `adhd_operating_rhythm` (lib/brain/operating-rhythm.ts:141 — the 5x-daily Telegram checkpoint cron disables itself when this flag is explicitly false). The prior 13-toggle AutoPilotControls grid carried 12 other flags + shadow-mode + mood-dimming + proof-of-life badges that NO worker consumed (grep-verified) — pure dead UI. This replaces that ~610-line section with the single real control."*
Storage: `UserPreference` key `"autopilot_flags"`, JSON blob (`lib/services/autopilot-flags.ts:1-66`), `AUTOPILOT_DEFAULTS` still defines **9 keys** (`auto_morning_autopilot, auto_morning_brief, auto_stale_lead_alert, auto_commitment_check, auto_brain_cycle, auto_drift_escalation, auto_followup_quotes, auto_weekly_targets, auto_revenue_alerts`) plus the one now-real `adhd_operating_rhythm` — **the current settings UI renders a control for only ONE of these ~10 stored keys**; the other 8-9 persist in the same JSON blob with no Settings-page control (H: they may still be read by other crons directly rather than via the Settings UI — not traced whether e.g. `auto_morning_brief` gates a real job elsewhere; flagged NOT VERIFIED whether the other 8 keys are dead-in-full or just UI-less). Toggle uses `ConfirmHold` (press-and-hold) gate for the disable direction only — "a stray mobile tap shouldn't kill it... Re-enabling is a single tap" (20-23) — an asymmetric-friction destructive-action pattern, distinct from but equivalent in intent to the two-tap confirm used elsewhere.

**8. Cron kill switches (`CronControlPanel`, A)** — `trpc.systemAutomation.cronCatalog.useQuery` (104), `setCronEnabled.useMutation` (119, job-name-keyed), `triggerCron.useMutation` (120, path-keyed manual fire). **A live-documented bug fix in the same file** (cron-control-panel.tsx:114-118): *"2026-09-01 audit fix: this wrote `utils.SYSTEM.cronCatalog` — a valid (procedures are spread into both routers) but UNRENDERED key, so the switch never moved until a manual refresh. The query above is `systemAutomation.cronCatalog`; patch THAT cache."* — confirms this repo's cache-key mismatch class of bug and that it was caught/fixed same-day as the audit referenced in this task's brief. This panel duplicates functionality also reachable at `/system/crons` (redirect-consolidated per next.config.ts) — NOT VERIFIED whether the two surfaces read the identical procedure or have drifted.

**9. Push notifications (`PushNotificationToggle`, A)** — real browser Push API subscribe/unsubscribe via `usePushNotifications()` hook; "Self-hides when the browser doesn't support push" (push-notification-toggle.tsx:7-8); surfaces specific error strings for `vapid_public_key_missing` (env misconfig) and `permission_denied` (browser-level block) — genuine per-state error messaging, not a generic failure toast.

**10. Ticker dismissal reset (`TickerDismissalReset`, A)** — `useDismissedTicker()` hook, `localStorage`-backed dismissed-ticker-ID set; one-tap `clearAll()`, non-destructive (just un-hides previously-acknowledged ticker items), correctly shows a distinct "No items dismissed yet" state at count 0 (ticker-dismissal-card.tsx:21-33) rather than hiding the whole card.

**Settings NOT backed by any table (pure client-side, correctly so):** `pins:sortKey` (see /pins section), `nour:haptic-enabled`, `nour:chat:speed-ribbon`, dismissed-ticker-ID set — all confirmed to have a matching reader at the same key (no orphaned localStorage writes found in this domain).

**CONTROLS / destructive-action summary for /settings:**
- No `window.confirm/alert/prompt` anywhere in `components/settings/*.tsx` (A, full-directory grep clean).
- `resetAiConfig` ("Reset to Nick's tuning") — mutation exists; confirm-gate presence NOT VERIFIED in this pass.
- `OperatingRhythmToggle` disable path — `ConfirmHold` press-and-hold gate (real, in-DOM).
- Feature-flag overrides and cron kill-switches are non-destructive toggles (reversible), but carry audit trails (`AuditEvent` for flags) — good practice, not a gap.

**AI CHROME / pseudo-metrics visible on Settings:** none native to Settings itself beyond the identity axes' 0-100 bars (formula traced to `/brain` maturity's `axesFilled` computation, not independently re-derived here) and the people-credit XP weights (raw config numbers, not a displayed score). `SystemOpsHub`'s live badge counts (errors24h, cronFails24h, actionsPending) source from `useSystemPulse` — formula/source not opened in this Settings pass (belongs more properly to the System section below).

**Boundary flag:** none — all settings are personal-OS operator preferences, no shop-operational content.

---

## /system (hub) — app/(mastery)/system/page.tsx (572 lines) + components/system/hub-grid.tsx + 12 more components/system/*.tsx (2546 lines total in components/system/)

**JOB (A, page.tsx:3-16):** operator system surface — status-first layout (Wave 52, 2026-05-20): overall status + KPIs above a 16-tile navigation grid (`SystemHubGrid`), then device/brain/integration detail below.

**Nav surface (A):** plain NAV entry, "operate" section (nav-items.ts:80) — MORE sheet + Cmd-K; owns its own hub grid to the 16 sub-surfaces (not listed individually in NAV, per comment nav-items.ts:74-79).

**DATA READS (A, page.tsx:104-123) — all polling, no manual-refresh-only reads:**
`trpc.system.diagnostics` (60s), `trpc.brain.status` (60s), `trpc.system.healthSummary` (60s), `trpc.system.changeDigest` (60s), `trpc.system.memoryEvals` (60s), `trpc.system.receiptFeed` (60s), `trpc.system.agendaItems` (30s). Comment (37-42) confirms these replaced three legacy `authedFetch` reads + a client `setInterval` — now each query's own `refetchInterval` drives polling, and pull-to-refresh/manual Refresh refetch all three-plus.

**§8 SYSTEM — hub tile enumeration (A, components/system/hub-grid.tsx, full CARD array read):** 16 tiles across 4 groups (`GROUP_ORDER`, lines 404-408: Health & Jobs / Governance / AI & Brain / Data & Logs). Each tile's `chip()` function computes its own status label + severity from the SAME `HubPayload` (`trpc.system.diagnostics`-shaped) rather than a separate fetch per tile — single source, matches this task brief's `lib/services/system-hub.ts` finding below.
| Tile | href | Chip logic (source: HubPayload) |
|---|---|---|
| Fleet Truth | /system/fleet | static `{label:"both apps", severity:"unknown"}` (125) — **always unknown, never resolves to healthy/degraded** — see NOT VERIFIED below |
| Diagnostics | /system/health | degraded/healthy from `d` fields (142-148); `!d` -> `"—"`/unknown (142) |
| Arrival Intel | /system/camera | device online/total counts (167-174); `total===0` -> `"no devices"`/unknown (171) — **device tile explicitly distinguishes "no devices" from "0 offline"** |
| Cron Deck | /system/crons | `killed` count (warning) or `declared` total (healthy) (184-188) |
| Errors | /system/logs?view=errors | fatal24h (critical) / count24h (warning) / count24h (healthy) tiering (205-211) |
| Alerts Inspector | /system/alerts | static `{label:"browse", severity:"info"}` (220) — no live count |
| Autonomous Actions | /system/actions | static `{label:"audit", severity:"info"}` (228) — no live pending-count badge despite being the approvals surface (see below) |
| Tools Registry | /system/tools | static `{label:"inspect", severity:"info"}` (236) |
| AI Cost | /system/ai-cost | `$X 7d` from `d.ai` (245-249), severity always "info" (not tiered by budget threshold) |
| Brain Categories | (no page in my scope — anchors within /system) | memory row count (262-265) |
| Logs | /system/logs | static "view"/info (276) |
| Schema History | /system/schema-history | static "audit trail"/info (288) |
| Chat States | /system/chat-states | static "gallery"/info (298) |
| Intelligence | (brief link) | static "briefs"/info (309) |
| Calibration | /system/calibration | static "eval"/info (320) |
| Proactive Preview | /system/proactive-preview | static "preview"/info (328) |
| Cockpit Observability | /system/cockpit-observability | `calls24h`/info (340-342) |
| Memory Inbox | /system/inbox | static "review"/info (354) |

**Static-string chip flag (§8 explicit ask — "any panel whose source is a static string"):** 9 of 18 tiles (Alerts Inspector, Autonomous Actions, Tools Registry, Logs, Schema History, Chat States, Intelligence, Calibration, Proactive Preview) render a fixed label ("browse"/"audit"/"inspect"/"view"/etc.) regardless of what's actually behind the link — these are navigational, not status, by design (H — plausibly intentional since these surfaces are inherently list/browse pages without one meaningful roll-up number, not a bug). **Fleet Truth is the one exception worth flagging as a real gap:** its chip is hardcoded `severity:"unknown"` unconditionally (line 125, no `d`-dependent branch at all, unlike every other tile) — i.e. it can NEVER show healthy/degraded even when data is fine, which is either an intentional "cross-app truth can't be summarized in one chip" stance or an unfinished tile (NOT VERIFIED which).

**UNKNOWN≠HEALTHY discipline — verified GOOD, with full formula (directly answers the LIVE OBSERVATION task):**
`lib/home/health-state.ts` (full file read, 65 lines) — `homeHealthState()` is the exact function producing the Home page's degraded string. Header comment (1-17) documents the doctrine explicitly: *"when the server marks any of them unmeasured (`measured === false`...) the answer is unknown, never green... the chip was the SECOND consumer of the fabricated-zero payload the 2026-08-04 false-green sweep registered (hub-grid was the first)."* Logic (line-verified):
```
if (!d) return unknown
if errors.measured===false || crons.measured===false || devices.measured===false -> "unknown", detail "sections unmeasured — db quota or scan failure"
if errors.fatal24h >= 40 -> "broken"
if crons.silent > 0 || devices.offline > 0 -> "degraded", detail = "<N> silent cron(s) · <M> device(s) offline"
else -> "healthy"
```
This is the EXACT template that produced the observed "System degraded — 17 silent crons · 20 devices offline" string (health-state.ts:49-58). The `measured===false` short-circuit fires BEFORE the degraded/healthy branches — a confirmed-correct UNKNOWN-before-HEALTHY implementation, and hub-grid.tsx independently repeats the same discipline per-tile (`!d -> "—"/unknown`, hub-grid.tsx:142,167,184,205).

**What "silent" and "offline" actually count (A, full trace):**
- `crons.silent` <- `lib/services/system-hub.ts:169` <- `cronReport.summary.silentDeclaredCrons` <- `lib/system/cron-diagnostics.ts:391-416` `scanCronHealth()`: a cron (from `CRONS.filter(c => c.mode==="active")`, i.e. `config/crons.ts` manifest) counts as silent when it has **zero `CronJobLog` rows in the last 48h AND** either never logged (past 1.5x-its-cadence grace period since `addedAt`) **or** its last success is older than `max(48h, 1.5 × the cron's own schedule gap)` — a genuinely schedule-aware threshold, NOT a flat 48h window. Comment (28-37, 375-382) documents the PRE-FIX bug this replaced: *"Pre-fix: silent was binary 'no log in last 48h'. 5 of 6 false [positives]"* — weekly/biweekly crons were wrongly flagged silent before firing on their actual cadence. This is a real, previously-buggy, now-fixed metric.
- `devices.offline` <- `system-hub.ts:100-101` <- `prisma.smartDevice.findMany({select:{status:true}})`, counting rows where `status === "OFFLINE"` — a **stored column**, not a live ping. A device is set `status:"ONLINE"` only when it POSTs to `app/api/devices/[id]/events/route.ts:73` (`lastSeenAt: new Date(), status:"ONLINE"`) — i.e. offline is "has not checked in," not independently verified as unreachable via an active poll. **Root cause of the observed 20-offline figure is a standing, ~5-month-old condition, not a fresh incident:** `lib/inngest/functions/automation-engine.ts:14-17` (dated context inside a comment) states *"20 of 22 devices have been OFFLINE since 2026-04-06..14"* and *"ten cameras dead since April"* — an almost-exact match to the live-observed count, strongly suggesting the device fleet has been in this degraded state since April 2026 with no resolution, and the automation engine was deliberately built to fire once per state-change (fingerprint-suppressed) rather than nag daily about it (comment 13-17). This is a genuine standing-incident finding, not a measurement bug — the health chip is accurately reporting a real, long-unaddressed hardware/connectivity gap.

**Kill switch — orphaned, high-severity finding:** `pauseAllCrons` is a global kill switch ("`pauseAllCrons` pseudo-setting also fans out to every active cron's kill-switch," `lib/trpc/routers/system/autopilot.ts:362-364`) exposed via `trpc.system.setPowerSetting` (6-key enum: `quietMode, providerPin, strictMode, dailyCostCapCents, pauseAllCrons, shadowMode`, autopilot.ts:373-380) and the legacy `POST /api/system/power` (route file confirmed present: `app/api/system/power/route.ts`). **Grepping `app/` and `components/` for `PowerPanel`, `setPowerSetting`, and `powerSettings` returns ZERO UI callers anywhere** — there is no discoverable operator-facing control for this switch in the current build. The only in-code pointer to it is a diagnostic fix-message: `lib/system/cron-diagnostics.ts:198` — *"Go to /system/power → toggle 'Pause all crons' off. Or POST /api/system/power..."* — but `next.config.ts`'s redirects (captured above) permanently route `/system/power` -> `/system` (the hub, non-permanent redirect). **If `pauseAllCrons` is ever set true (e.g. by a script, an agent, or a since-removed UI), an operator following the system's own diagnostic guidance would be redirected away from the only page that could ever have un-set it, and no other page offers this control** — a real orphaned-kill-switch gap, not merely a stale comment (class A: both the redirect and the zero-caller grep are independently verified).

**Boundary flag:** none on the hub itself; `/system/tire-stock-requests` and `/system/vapi-calls` (both routed OFF-app to nickstire.org/admin per next.config.ts, already covered in the redirects section) would be shop-operational if they existed as pages — they don't; they're pure external redirects, which is the CORRECT boundary behavior, not a violation.

**NOT VERIFIED for /system hub:** `changeDigest`, `memoryEvals`, `receiptFeed`, `agendaItems` query payloads and consumers not traced (time-boxed); whether "Fleet Truth"'s permanent-unknown chip is intentional; `WiringCensusPanel`, `TrustLadderPanel`, `HomeDecisionPanel`, `ToolUsageCensusPanel`, `ObservabilityStatusPanel` (5 more components mounted below the grid per page.tsx imports) not individually opened this pass.

---

## /system/actions — app/(mastery)/system/actions/page.tsx (617 lines)

**JOB (A, page.tsx:3-19):** "Nick's autonomous action audit trail" — every `AutonomousAction` row, a rule leaderboard, filters (window/approval/rule), PLUS a separate "pending action queue" section for tool-call approvals.

**Nav surface (A):** reached via the System hub grid tile "Autonomous Actions" (hub-grid.tsx:223-228, static "audit"/info chip — no live pending-count badge on the tile itself, see hub section above) and the redirect `/system/approvals -> /system/actions` (next.config.ts).

**DATA READS (A):** `trpc.system.autonomousActions.useQuery` (audit-trail feed, window/rule/approval-filtered, 30s poll per header comment 33), `trpc.systemAutomation.getPendingApprovals.useQuery` (page.tsx:145), `trpc.system.approveApprovalRequest.useMutation` (152), `trpc.system.rejectApprovalRequest.useMutation` (176).

### §8 explicit question — which table(s) does the Pending tab decide, and does decideApproval have a UI caller now

**Answer, fully traced (A): the Pending tab on /system/actions decides `ApprovalRequest` rows ONLY — never `AutonomousAction` — and the `decideApproval` procedure (which DOES operate on `AutonomousAction`) has ZERO UI callers anywhere in the app.** Two structurally distinct approval systems coexist:

**System 1 — `ApprovalRequest` + guardian (the one actually wired to this page, a real pre-execution gate):**
- `lib/trpc/routers/system/actions.ts:16-94` — `getPendingApprovals` reads `prisma.approvalRequest.findMany({where:{status:"pending_approval"}})` (17-20); `approveApprovalRequest` (23-79) enforces an owner-role gate for `riskClass==="critical"|"high"` or `actionType==="require_owner"` (43-51, comment 37-42 notes a documented PRE-FIX bug: "only the critical branch was enforced and a require_owner decision executed on any operator approval" — already fixed), then `prisma.approvalRequest.update({status:"approved",...})` (70-73) and **`void executeApprovedToolAsync(input.id)`** (76) — approval here genuinely triggers real tool execution that was WAITING on it. `rejectApprovalRequest` (81-94) sets `status:"rejected"`.
- This is the section literally rendered as "pending action queue" on the page (page.tsx:482, "requires owner/operator approval" subheading 483), with per-request risk-class coloring (critical = rose + `animate-pulse`, page.tsx:492-499) and an owner-only disable gate on the Approve button when `isCritical && userRole !== "owner"` (`cannotApprove`, 490,531).
- **No confirm step on Approve/Reject** — both are single-tap buttons (`onClick={() => approveMutation.mutate({id:req.id})}`, 528-535) with no `useConfirmDialog`/two-tap gate found in this section (A, grep of the file found no `window.confirm` and no `confirm(` call around these buttons) — notable because Approve can immediately fire a real tool execution; the only friction is the owner-role check for critical/high risk, not a confirmation step for any risk tier.

**System 2 — `AutonomousAction.approval` + `lib/automation/approval-queue.ts` (orphaned, and even when reachable, was documented as a non-gating no-op):**
- `lib/automation/approval-queue.ts:1-20` header comment, self-described: *"Operator-facing layer over AutonomousAction rows where approval='pending'. Provides the read/write spine for the /system/actions surface... Important caveat (intentional, documented): The autonomous-engine currently fires `rule.action(item)` for every triggered row regardless of `approval` value — pending is metadata, not a gate. So approving here is an audit/sign-off action, not an 'execute now' action... operator approval = 'I reviewed this, it's intentional' and operator reject = 'I reviewed this, mark for postmortem.'"* — i.e. by the module's own design, even a fully-wired decide-UI here would NOT gate anything; the rule already ran.
- Exposed as `systemAutomation.approvals` (read, `autopilot.ts:425-431`, calls `listPendingActions()` + `summarizeQueue()`) and `systemAutomation.decideApproval` (write, `autopilot.ts:444-471`, calls `decidePendingAction(id, decision, "nour", notes)` — comment 433-441 explicitly: "decide one pending AutonomousAction row").
- **`grep -rln "decideApproval" app/ components/` returns ZERO matches** — no button, page, or hook anywhere calls this mutation. **`/system/actions/page.tsx` itself does not call `systemAutomation.approvals` or `decideApproval` at all** — confirmed by grep of the page file's trpc calls (listed above; neither name appears).
- **`systemAutomation.approvals` (the READ side) DOES have exactly one caller: `components/hud/app-badge.tsx:32`** — a PWA home-screen icon badge (`navigator.setAppBadge`) that **sums** `pendingQ.data.length` (ApprovalRequest count) **+** `approvalsQ.data.rows.length` (AutonomousAction count) into one number (app-badge.tsx:35-36), with a header comment confirming this is deliberate: *"the count matches the header pill (home-identity-header.tsx:32: ApprovalRequest pending + AutonomousAction queue rows)."*

**Net finding (A, fully code-verified; runtime prevalence NOT VERIFIED per audit evidence rules):** the operator-facing badge count (home-screen PWA icon + presumably the home header pill, not independently opened this pass) can include AutonomousAction-pending rows that **no page in the app can currently decide** — /system/actions only resolves the ApprovalRequest half of that sum. If `AutonomousAction` rows with `approval:"pending"` exist at any given moment, the badge would over-count relative to what /system/actions's "pending action queue" section can actually clear — a real, structurally-confirmed dead-end, though this pass did not query the live database to confirm whether such pending rows are currently non-zero (code existence is not runtime proof, per the audit's own evidence rule). Even if decideApproval WERE wired up, deciding those rows would still not gate any execution (per the approval-queue.ts caveat above) — so the two "approval" concepts are not just differently-wired but semantically different (pre-execution gate vs. after-the-fact sign-off), sharing only a UI vocabulary ("pending," "approve," "reject") and a combined badge count.

**CONTROLS (rest of page, A):** window pills (24h/7d/30d), approval-status filter chips (auto/pending/approved/rejected, page.tsx:279-286), rule-row click-to-filter, sort dropdown (5 modes incl. "approval · pending first" / "errors-first"), expand-to-see-payload on each audit row. All read-only/filter controls, no additional mutations found in the audit-trail half of the page.

**STATES (A):** `loading = actionsQuery.isPending || actionsQuery.isFetching || approvalsQuery.isPending || approvalsQuery.isFetching` (185) — combined loading flag across both queries; empty-pending state distinctly worded "no pending tool approvals" vs "loading approvals…" (486-488) — correctly distinguished, not coerced to a blank list.

**Boundary flag:** none — audit trail is personal-OS automation governance.

---

## /system/health — app/(mastery)/system/health/page.tsx (711 lines)

**JOB (A):** the deepest system-diagnostics surface — errors, cron health, backlog, "operational status" (eval pass-rate + data-source probes). Reached from hub tile "Diagnostics" (hub-grid.tsx:128-148) and redirects `/system/chat-health`, `/system/data-source-health` (next.config.ts).

**DATA READS:** `trpc.system.healthReport.useQuery({range})` (page.tsx:54), single query driving the whole page.

**STATES — a genuine, precisely-located UNKNOWN-to-HEALTHY violation, still live (A, quoted code):**
The page mixes two different disciplines in the SAME file. The `OperationalStatus` component (function header comment 465-470) is a model example: *"Green now requires a live instrument that actually reported. Anything unproven degrades to amber rather than passing as healthy"* — citing two named past bugs it fixed (a permanently-null eval treated as inert-not-unknown; `ds.total===0` rendering "no probes yet" while `failing>0` stayed false, "no probes read as all-clear"). Its `dsUnknown = ds === null || ds.total === 0` (480-482) and rendered string `ds === null ? "probe read failed — unknown" : ...` (605) are correct.
But `knownBacklog` (98-99), used for the page's headline `TrendCounter` (206-220), computes `data.backlog.inboxTasks + activeCommitments + activeCaptures + (data.backlog.unackedDriftAlerts ?? 0)` — **the exact fabricated-zero pattern the rest of the page was built to avoid.** The code says so itself, in a comment immediately above the JSX (211-214): *"`unackedDriftAlerts ?? 0` folded a FAILED READ into the sum as zero — re-committing in the headline the exact fabricated all-clear that `system-health.ts:161-163` refuses to produce and that the detail row below renders honestly as '?'."* Traced to source: `lib/services/system-health.ts:234` (`.catch(() => null)`, comment 233-234: *"null = read failed — '0 unacked drift alerts' on a DB error is a fabricated all-clear (2026-07-30 sweep)"*) — the SERVICE layer correctly preserves null: the PAGE'S headline aggregate silently discards that signal. The detail `KVRow` 130 lines below (348, `v={data.backlog.unackedDriftAlerts ?? "?"}`) gets it right. **This is a live, self-documented, unresolved defect** — not a hypothetical: the comment explaining the bug sits directly above the buggy line, evidently written during a review that flagged it without fixing it.

**AI CHROME / pseudo-metrics:** eval pass-rate (`ev.passRate`), data-source probe failing/stale counts — both gated by the `Unknown` variants above; no separate calibration claimed for these beyond the "green requires proof" doctrine.

**Boundary flag:** none.

---

## /system/crons — app/(mastery)/system/crons/page.tsx (607 lines)

**JOB (A, comment 44):** the per-cron kill-switch deck — reads `trpc.systemAutomation.cronDeck.useQuery`, kill-switch via `setCronEnabled`, manual fire via `runManifestCron`. Absorbs the redirects `/system/cron-diagnostics`, `/system/cron-runs`.

**CONTROLS:** per-row kill toggle (`toggle(jobName, nextEnabled)`, 293-301) — single tap, no confirm dialog, optimistic UI (`pendingToggle` Set) + toast ("X killed"/"X enabled") + cache invalidate. Reversible (re-enable is one tap back), consistent with the identical pattern already found in Settings' `CronControlPanel` (§7) — **this is likely the SAME underlying tRPC procedures as the Settings automations-tab panel** (`trpc.systemAutomation.setCronEnabled`), so the two surfaces should never drift, though this pass did not confirm the read query (`cronDeck` here vs `cronCatalog` in Settings) returns identical rows — NOT VERIFIED whether the two lists can disagree.
Summary line: `${active} active · ${disabled} killed · ${folded} folded · ${runs24h} runs/24h · ${failures24h} failures/24h · ${drifted} drifted` (340) — a real rollup, not decorative.
**Global kill switch (`pauseAllCrons`) is NOT surfaced on this page** (grep clean for "pause"/"Pause"/"kill all") — corroborates the orphaned-kill-switch finding in the hub section: the per-cron toggles exist and work; the all-crons switch referenced by `cron-diagnostics.ts`'s own fix-message has no home anywhere, including here, the most likely place for it.

**Boundary flag:** none (automation infrastructure, not shop content).

---

## /system/alerts — app/(mastery)/system/alerts/page.tsx (366 lines)

**JOB (A, header comment 4-19):** cross-category alerts inspector — full-window filter/sort/drill-down complement to the HQ `ActiveAlertsCard` (which only shows most-recent-per-category). Explicitly **NOT a "clear" mechanic** by design: *"alerts auto-collapse via per-hour idempotency keys at the source crons. Adding a manual 'dismiss' surface here would compete with that and silently bias future runs."* — a deliberate absence of a control, documented as intentional rather than an oversight. Reads `GET /api/brain/active-alerts` per the header comment, but the ACTUAL runtime call is `trpc.brain.activeAlerts.useQuery` (page.tsx:127, comment 28 confirms this replaced the authedFetch) — **shares the identical procedure with `components/brain/active-alerts-card.tsx` used on `/brain`** (already documented in the /brain section above), so /system/alerts and /brain both surface the same underlying alert rows through different lenses (one full-history/filterable, one recent-N/actionable with resolve+mute mutations). Drill-down goes to `/system/history` — **not in this agent's scope list and not confirmed to exist as a live route** (NOT VERIFIED — could be a stale link if `/system/history` was one of the many redirect-consolidated paths; next.config.ts DOES list `{source:"/system/history", destination:"/system"}` among the redirects captured earlier, confirming this in-page drill-down link points at a now-redirected path).

**Boundary flag:** none.

---

## /system/calibration — app/(mastery)/system/calibration/page.tsx (511 lines)

**JOB (A, header comment 4-20):** "Closed-Loop Calibrated Brain" — a mood × suggestion-kind grid, each cell showing acted/total suggestions color-graded by hit rate. Absorbs 6 redirects (`/system/coverage`, `/quality`, `/eval-results`, `/judge-eval`, `/operator-state`, `/lens-stats`, `/ghost-nour`).

**DATA READS:** `trpc.system.stateCalibration.useQuery` (106), `trpc.system.judgeEvalCalibration.useQuery` (116) — two distinct calibration datasets on one page.

**AI CHROME / pseudo-metric — explicitly self-labeled uncertain data, a GOOD pattern:** *"Pre-Wave-H rows show as `unstamped` count · they predate the state snapshot capture and can't be classified by mood"* (17-19) — old rows are visibly bucketed as unclassifiable rather than silently dropped or guessed into a mood bucket. This is the calibration surface the audit brief's §5 asks about by name ("judgeEvalCalibration" / "wisdomGateSpc" were referenced from `/brain`'s `judgment-quality-panel.tsx`, cross-domain) — the underlying formula for hit-rate-by-mood was not opened this pass (NOT VERIFIED beyond the page-level "acted/total, color-graded" description).

**Boundary flag:** none.

---

## /system/camera — app/(mastery)/system/camera/page.tsx (466 lines) — BOUNDARY FLAG (significant)

**JOB (A):** vehicle-arrival detection + automated license-plate recognition. Page chrome (175-177): `eyebrow="NICK'S TIRE & AUTO"`, `title="Arrival Intelligence"`, `description="Real-time vehicle detection and automated license plate recognition fleet cockpit."` A metric hint reads *"Operational cameras on shop WiFi"* (207).

**§9 Boundary flag — inventory, not verdict:** this page is explicitly, visibly shop-operational: the eyebrow literally says "NICK'S TIRE & AUTO," the cameras are described as being "on shop WiFi," and the feature (arriving-vehicle detection + plate recognition) is a shop-floor/front-desk operational tool, not a personal-OS concern. Per this task's product-boundary doctrine (StateNour = personal OS; ordinary shop operations belong in nickstire.org/admin), this is one of the clearest candidates in this agent's scope for "why does this live here rather than in the nickstire admin." `/system/fleet` (below) is a DIFFERENT, non-violating case — cross-app infra-health monitoring, not shop business content — worth not conflating the two.

**DATA READS:** `trpc.system.cameraArrivals.useQuery` (37), `trpc.system.testVehicleAlert.useMutation` (41, a manual test-fire control), `trpc.system.updateArrivalStatus.useMutation` (51, marks an event edited/false-positive).

**CONTROLS:** edit plate, mark false positive, test alert — all direct single-mutation actions, no confirm gates observed (low-stakes data-correction actions, not deletions).

---

## /system/fleet — app/(mastery)/system/fleet/page.tsx (299 lines)

**JOB (A, header comment 3-10):** "the one-screen cross-app liveness answer" — statenour capability probes + nickstire health/db/schema-guard/self-healing "in the shared vocabulary." Explicitly: *"Honest states everywhere: loading is a skeleton, failure renders as FAILURE, unknown is never painted green"* — this is the "fleet-truth pattern" the `/system/health` page's own comments cite as their model (`dsUnknown` check, "fleet-truth pattern, 2026-07-30 sweep") — i.e. /system/fleet is the ORIGIN of the good UNKNOWN-handling convention, not a copy.

**DATA READS:** `trpc.system.outboxRedrive.useMutation` (151, a retry-failed-outbound-delivery control), `trpc.system.deliveryStats.useQuery({windowDays:7})` (152).

**CONTROLS:** two-tap in-DOM confirm confirmed present (page.tsx:68 comment: "Two-tap in-DOM confirm — window.confirm is suppressed in the iOS PWA") — presumably gating the `outboxRedrive` retry action; not independently re-verified against the specific button wiring this pass.

**Boundary flag:** none — this is cross-app infrastructure monitoring (both apps' health), not shop business content; distinguish from /system/camera above.

---

## /system/ai-cost — app/(mastery)/system/ai-cost/page.tsx (299 lines)

**JOB (A, header comment):** AI spend dashboard — animated cost count-up, 14-day trend bar chart, burn-rate indicator, error-rate pulse >5%, 60s auto-refresh. `trpc.system.aiCost.useQuery` (122).

**Corroborating finding (ties to the orphaned power-settings kill switch in the hub section):** the page's own header comment labels *"daily cost cap (writes OperatorPreference), provider override pin, strict mode (refuse calls > $X estimate)"* as **"Future knobs (W11)"** — i.e. explicitly not-yet-built, by the page author's own admission. This independently corroborates the hub-section finding that `dailyCostCapCents`/`providerPin`/`strictMode` (all present in the `setPowerSetting` 6-key enum, `autopilot.ts:373-380`) have no live UI anywhere: here the comment says so directly (planned, not shipped), while the hub-grid/PowerPanel trail shows the backend plumbing exists with zero callers — two independent pieces of evidence converging on the same gap.

**Boundary flag:** none.

---

## /system/inbox — app/(mastery)/system/inbox/page.tsx (337 lines) "Memory Inbox"

**JOB (A):** the governed-knowledge quarantine queue — `trpc.system.getQuarantinedItems.useQuery` (5s poll — the fastest polling interval found anywhere in this agent's scope), `trpc.system.resolveInboxItem.useMutation`. Backing table: `prisma.memoryInboxItem` (`lib/trpc/routers/system/inbox.ts:9-10`).

**Confirms this task's REPO CONTEXT claim, with a precise citation:** `lib/tools/guardian.ts:474-483` — comment dated *"P-1 (2026-09-01) · ingestion goes through this branch too now (lib/brain/external-memory-intake.ts). It labels the row with its own sourceType and passes the memory it WOULD have written as `memoryTarget`, so the inbox commit path can land the reviewed memory in exactly that category/key/source instead of a generic 'belief'. AI tool calls carry neither and keep the old shape."* Default `sourceType` for the OTHER path is `"agent_tool"` (482) — confirming `memoryInboxItem` rows come from at least two producers: AI tool calls flagged for review, and the external-memory-intake path (gmail per the brief's framing) added in the 2026-09-01 audit. `prisma.memoryInboxItem.create` has exactly one call site in the whole corpus (`lib/tools/guardian.ts`, grep-verified) — a single, shared chokepoint, not scattered producers.

**Boundary flag:** none.

---

## /system/logs — app/(mastery)/system/logs/page.tsx (445 lines)

**JOB (A, header comment 4-20):** canonical "what happened" retrospective log explorer — merges `ErrorLog + CronJobLog + SystemMetric + AutonomousAction + ApiRequestLog` (4xx/5xx only) into one chronological stream, two view modes (STREAM default, GROUPED ERRORS via the absorbed `/system/errors`, now `?view=errors`). `trpc.system.systemLogs.useQuery` (154). Absorbs redirect `/system/agent-traces`.

**Boundary flag:** none.

---

## /system/schema-history — app/(mastery)/system/schema-history/page.tsx (373 lines)

**JOB (A, header comment 4-9):** audit trail of DB schema changes/migrations, reads `SchemaChangeLedger` via `trpc.system.schemaHistory.useQuery` (68). Read-only audit surface, no mutations found.

**Boundary flag:** none.

---

## /system/tools — app/(mastery)/system/tools/page.tsx (255 lines) "Tools Registry"

**JOB (A):** the live agent-tools catalog — `trpc.system.getTools.useQuery` (25). This is the page the 2026-06-18 IA-reorg redirect comment (next.config.ts, captured in the redirects section) explicitly UN-shadowed: *"the live agent-tools registry page... was being bounced to /system by this redirect = dead surface. Now reachable."* Confirms the page is genuinely live now, not merely present-but-unreachable.

**Boundary flag:** none.

---

## /system/chat-states — app/(mastery)/system/chat-states/page.tsx (177 lines) "chat-state gallery"

**JOB (A, header comment 4-15):** a no-new-dependency Storybook substitute — real chat components rendered against fixtures, one labeled section per state, inside the authed app shell. Explicitly: *"only components that take plain props render here — nothing is mocked at module level, so what you see is the shipping code."* No trpc/fetch calls on the page itself (confirmed via grep) — `MemoryInspectorSidebar` (its one custom import) is also grep-confirmed data-call-free — this is a pure fixture/demo page, not a live-data surface, by design.

**Boundary flag:** none.

---

## /system/cockpit-observability — app/(mastery)/system/cockpit-observability/page.tsx (18 lines, thin wrapper) + components/system/cockpit-observability-view.tsx

**JOB (A, page.tsx:10-11):** "Live metrics, execution traces, semantic memory decay, and prompt versioning manager for the Nick agent." The page itself is an 18-line `StandardPage` shell; all logic lives in `CockpitObservabilityView`: `trpc.system.cockpitStats.useQuery` + `trpc.system.setActivePromptVersion.useMutation` (component lines 33,38) — a real control (activating a specific system-prompt version), not read-only.

**Boundary flag:** none.

---

## /system/proactive-preview — app/(mastery)/system/proactive-preview/page.tsx (456 lines)

**JOB (H, inferred from the fetch target and next.config.ts's 2026-06-18 redirect comment, which independently describes it as *"the live proactive-push dry-run page"*):** lets the operator preview what a proactive push notification would contain for a given time slot, optionally with a mocked "now" timestamp (`datetime-local` input, page.tsx:88-93).

**DATA READS — the only page in this agent's ENTIRE scope using raw `fetch()` as its sole data mechanism, zero tRPC (A, full-file grep confirmed no `trpc.` calls):** `fetch(`/api/system/proactive-preview?slot=${slot}${mockTime ? "&now=..." : ""}`, {credentials:"same-origin"})` (page.tsx:95) — manually parses `{ok, data, error}` envelope (98-99) and throws on non-2xx (96-97). This is a legacy-REST holdout distinct from every other /system/* page in scope (all of which use tRPC either exclusively or alongside a documented migration comment) — NOT flagged as broken, just the one un-migrated page found in the /system/* sweep.

**Boundary flag:** none.

---

## /content — app/(mastery)/content/page.tsx (53 lines, tabbed hub)

**JOB (A, header comment 3-16):** unified content + outreach pipeline — 4 former standalone pages consolidated into one tabbed surface (redirects, not deletes, per next.config.ts): Drafts (default), History, Publish, Outreach. **A 5th tab, "AI Assistant" (`AssistantTab`), is NOT in the header comment's stated 4-tab list and not in NAV's `tabs` hint array** (nav-items.ts:63 lists only drafts/history/publish/outreach) — a real, mounted tab the nav metadata doesn't know about (H: cosmetic drift in the Cmd-K hint list, not a functional bug — the tab renders and works).

**Nav surface (A):** tabbed hub, "execute" section (nav-items.ts:63).

**DATA READS (A):** `trpc.operator.getMarketingPersonas.useQuery` + `generateMarketingContent.useMutation` (assistant-tab.tsx:17-18); `trpc.operator.actOnDraft.useMutation` (drafts-tab.tsx:94); `trpc.operator.contentHistory.useQuery` (history-tab.tsx:105); `trpc.operator.socialSchedule.useQuery`, `socialRecentImages.useQuery`, `socialPublish.useMutation`, `scheduleSocialPost.useMutation` (publish-tab.tsx:94,100,113,114); raw `fetch("/api/outreach/propose", {...})` (outreach-tab.tsx:78) — **dual data-access**: 4 of 5 tabs use tRPC, the Outreach tab uses raw REST, all under one page.

**CONTROLS — real customer-facing publish, correctly gated:** `publish-tab.tsx:138-149` — before `publishMutation.mutateAsync`, an in-DOM danger-tone confirm fires: *"Publish to `<platforms>`? This is irreversible."* (135-142, confirmed via `useConfirmDialog`, comment 63 cites iOS-PWA `window.confirm()` suppression as the reason for the in-DOM approach) — a genuinely consequential action (live Instagram/Facebook posting) with an appropriate confirmation gate, not a bare button.

**Boundary flag:** this whole page is the shop's marketing/outreach pipeline (draft social copy, publish to Instagram/Facebook, bulk-SMS outreach propose→approve) — squarely shop-business content living in the personal OS. Distinguish from /system/camera's live operational tooling: this is a content-creation/approval workflow (the operator reviewing and approving AI-drafted marketing before it goes out), which is closer to "personal-OS-appropriate oversight of AI work product" than "shop-floor operations" — flagged per instructions as an inventory item, not a verdict.

---

## /market — app/(mastery)/market/page.tsx (37 lines, tabbed hub)

**JOB (A, header comment 3-13):** former /seo + /radar merged — Search (GSC performance) + Radar (brand/competitive signal) tabs, both explicitly labeled *"nickstire-bridge projections"* by the page's own comment.

**Nav surface (A):** tabbed hub, "execute" section (nav-items.ts:65).

**DATA READS (A) — confirmed cross-app bridge, NOT tRPC:** both tabs use `usePollingFetch` against `/api/nickstire/query?q=<report-name>` — `search-tab.tsx:90-99`: `gsc_summary`, `gsc_top_queries&limit=10`, `gsc_top_pages&limit=10`, all at **15-minute** polling (`intervalMs:900_000`); `radar-tab.tsx:78-81`: `master_report` at **5-minute** polling (`intervalMs:300_000`, comment 77 notes this "matches /scoreboard NickHealthSection cadence" — i.e. deliberately synced to another page's cadence, itself now a redirect stub into /stats, out of this agent's scope). Shared `BridgeShell` component (`components/mastery/bridge-shell.tsx`) provides the loading/down chrome common to this and the former /funnel page — comment there explicitly frames these as "bridge" pages, i.e. StateNour is a read-only display layer over nickstire-origin business data here, not a source of truth.

**Boundary flag:** the underlying DATA (GSC search performance for nickstire.org, competitive/brand radar) is unambiguously shop-marketing business intelligence, bridged read-only into the personal OS. Lower-severity than /system/camera (no operational controls here, pure reporting) — flagged as inventory: is strategic marketing-intelligence review the operator's personal-OS job, or should this dashboard live in nickstire.org/admin alongside the business it measures? Not a verdict.

---

## /learn — app/(mastery)/learn/page.tsx (296 lines) — SERVER component, zero data fetching

**JOB (A, header comment 1-9):** "Build Your Own X" curated tutorial catalog browser — a static local reference (`lib/learn/build-your-own-x`), not a DB or API-backed feature. Companion: the chat tool `searchBuildYourOwnX` can answer the same catalog inline in chat.

**Nav surface (A):** flatRow, "execute" section (nav-items.ts:66).

**DATA READS:** none — server-rendered from a bundled TS module. `export const dynamic = "force-dynamic"` (page.tsx:23) exists ONLY because the page previously used `force-static` and broke under the CSP nonce/`strict-dynamic` header once the parent `(mastery)` layout went force-dynamic (comment 18-22: "a statically prerendered page ships no CSP nonce... blocks all its scripts (blank page)") — i.e. still logically static content, just re-rendered per-request now for CSP compliance, a real production bug fix, not a behavior change. Sort/search happen client-side via native URL params.

**Boundary flag:** none — pure reference/educational content.

---

## /photo-improver — app/(mastery)/photo-improver/page.tsx (397 lines)

**JOB (A, header comment 3-15):** "storefront/car/shop photo improver" — upload -> vision-model scorecard + improvements -> recraft-v4 re-render as a "Nick's Tire branded variant" -> hand off to /content?tab=publish or /chat for captioning. Explicitly: *"Closes the loop between 'phone photo' and 'shippable marketing asset' without leaving Nour's chat OS."*

**Nav surface (A):** flatRow, "execute" section (nav-items.ts:67).

**DATA READS (A):** `trpc.operator.improvePhoto.useMutation()` (page.tsx:118) — the sole tRPC call found; presumably parameterized differently for the analyze vs. rebrand steps (not independently confirmed which input shape maps to which UI step — NOT VERIFIED at that level of detail).

**Boundary flag:** explicitly and unambiguously shop-marketing tooling ("Nick's Tire branded variant" in the page's own header comment) — a creative-asset pipeline for the tire shop, hosted in the personal OS. Same category as /content: an AI-assisted creative tool the operator drives personally, rather than a shop-floor operational control — flagged as inventory per instructions.

---

## /links — app/(mastery)/links/page.tsx (323 lines) "Short Links"

**JOB (H, inferred from route + fields):** UTM-tagged short-link creation + click-count dashboard (`ShortLink{url,source,medium,campaign,clickCount}`).

**Nav surface (A):** flatRow, "execute" section (nav-items.ts:68).

**DATA READS — 100% raw REST, ZERO tRPC (A, full-file grep confirmed):** `fetch("/api/short")` (GET list, line 43), `fetch("/api/short", {POST...})` (create, line 66), `fetch("/api/short?code=...", {method:"DELETE"})` (delete, line 102). One of three fully-un-migrated-to-tRPC pages found in this agent's scope (with `/system/proactive-preview` and `/intelligence/brief` — see cross-page note below).

**CONTROLS:** delete uses a real two-tap arm/disarm (`handleDelete`, 96-107: first tap sets `confirmDelete=linkCode`, second tap on the SAME code actually deletes) — but **unlike the equivalent pattern on /people (4000ms auto-disarm timeout) and /pins (dedicated modal), this arm state has no auto-disarm timer found** (grep of the surrounding function shows no `setTimeout` clearing `confirmDelete`) — a stray arm could persist until the operator deletes a DIFFERENT link or navigates away, at which point it's simply abandoned in component state (not a security issue, but a minor UX inconsistency versus the pattern's other two implementations in this agent's scope — NOT VERIFIED whether a blur/outside-click handler exists elsewhere in the file to reset it).
Error handling: `window.alert` explicitly avoided with a comment (89: "window.alert is suppressed in the iOS PWA shell — surface in-DOM") — consistent with the app-wide iOS-PWA-safe discipline.

**Boundary flag:** none — UTM link tooling could serve either personal or shop marketing use; not exclusively shop-branded like /photo-improver or /content.

---

## /intelligence/brief — app/(mastery)/intelligence/brief/page.tsx (242 lines) "Daily Brief"

**JOB (A):** the daily executive brief reader + on-demand regenerate.

**Nav surface (A):** NOT in NAV at all (confirmed absent from nav-items.ts by grep). Reachable via the System hub grid "Intelligence" tile (`hub-grid.tsx:304-309`, href `/intelligence/brief`) — **and the tile's own comment is a directly relevant reachability history note: *"the daily 10:15 brief push was the ONLY path to /intelligence/brief — miss the push, lose the surface"*** before this hub card was added (2026-07-28 per the comment). So current reachability = hub tile + the push notification's deep link; prior to the hub tile, push-only.

**DATA READS — 100% raw REST, zero tRPC:** `fetch("/api/intelligence/briefs/today")` (30), `fetch("/api/intelligence/briefs/generate", {...})` (62, the manual regenerate action).

**STATES — an excellent, precisely-reasoned three-way empty/error split (A, quoted code, page.tsx:16-22):** *"Why not just null-vs-set: 'no brief today' and 'no brief EVER' need different operator actions — the first means the scheduled job stopped, the second means it has never once completed. The old empty state conflated them."* Paired with: *"A failed REQUEST is not evidence about the historical record. Without this, a 500 or dropped connection rendered 'No Briefing Has Ever Been Generated'."* Three independent states are tracked: `brief` (have one), `emptyState{lastBriefAt,message}` (confirmed none, with context), `errored` (don't know — the request itself failed) — this is a textbook-correct implementation of the audit's UNKNOWN≠HEALTHY/EMPTY doctrine, applied to the empty-vs-error axis specifically (dated, self-aware, citing the exact prior bug it fixed).

**Boundary flag:** none — personal-OS daily intelligence digest.

---

## /intelligence/ledger — app/(mastery)/intelligence/ledger/page.tsx (139 lines) "Decision Ledger"

**JOB (A):** accept/decline queue for AI-surfaced "opportunities," tabbed by status (pending/accepted/declined/all).

**Nav surface (A):** NOT in NAV, NOT on the System hub grid directly — reached only via an in-page link FROM `/intelligence/brief` (`href="/intelligence/ledger"`, brief/page.tsx:189, matching the hub tile's own comment: "the ledger (outcome tracking) hangs off the brief page") — **the deepest-nested reachability path found in this agent's scope: bottom-tab/MORE-sheet -> (none) -> hub tile -> brief page -> in-page link.** Functionally deep-link/two-hop-only.

**DATA READS — raw REST:** `fetch("/api/intelligence/opportunities?status=${status}")` (19). **A precisely-dated, cross-referenced bug-fix citation (A, quoted code, lines 21-23):** *"apiHandler wraps plain-object returns as `{ok,data,meta}` (lib/utils/http.ts:93,:278). Reading `body.status` made this ALWAYS false, so the queue rendered empty regardless of what the route returned. Same defect as intelligence/brief/page.tsx, fixed 2026-08-21."* — confirms a shared response-envelope-unwrapping bug class hit BOTH intelligence pages, fixed same-day; the queue's own current unwrap is `body?.data ?? body` (23) then checks `payload?.status === "success"` — verified correct-looking now, matching the fix description.

**CONTROLS (via `components/intelligence/OpportunityCard.tsx`):** `handleAction("accepted"|"declined"|"resolved")` (29) -> `apiFetch("/api/intelligence/decisions/log", {...})` (37) — real persistence, three possible decisions per card, no confirm gate found (accept/decline of a suggested opportunity is a lower-stakes action than delete/publish, so the absence is plausibly appropriate — not flagged as a gap).

**Boundary flag:** none — the specific opportunities shown are not independently confirmed to be shop-business vs. personal (NOT VERIFIED — `Opportunity` shape not opened this pass).

---

## /decisions/[id] — app/(mastery)/decisions/[id]/page.tsx (632 lines) "single-decision detail"

**JOB (A, header comment 3-21):** showcase/detail view for one journaled decision — prediction<->outcome spread with a letter grade, anti-pattern hints from matching-domain lessons, sibling decisions (last 5 same-domain), and an edit panel (grade form, review date).

**Nav surface (A):** explicitly listed as an intentionally-hidden route in nav-items.ts's own comment (line 32: "/decisions/[id]" grouped with /chat-alias and /auth/sign-in as deep-link-only) — reached from wherever a decision list/card links to it (e.g. /stats's decision surfaces, out of this agent's scope, or the sibling-decisions links on this page itself).

**DATA READS (A):** `trpc.operator.decisionDetail.useQuery` (124), `trpc.operator.gradeDecision.useMutation` (153) — clean tRPC, no dual-access.

**AI CHROME / pseudo-metric — the "grade":** a letter grade (A-F presumably, `gradeToNumeric`/`gradeTone` helpers at 92-100 are pure display-mapping functions, not statistical formulas) that can be set by EITHER the operator via the edit-panel form OR by Nick via a chat tool call (`reviewDecisionReplay`, comment 143-148: *"when Nick grades or reviews this decision via chat... this page refreshes instantly. Pre-Wave-33 the operator could see Nick's grade in the chat transcript while this page still showed the old grade — jarring."*) — both authors converge on the same `gradeDecision` mutation/field via the `onDataChanged(["journal"], ...)` bus (149-150), a genuinely synced dual-author field, not a source-of-truth conflict.

**CONTROLS:** grade-save (`save()`, via `gradeDecision.mutateAsync`) — no delete/destructive action found on this page (view + grade only).

**Boundary flag:** none — personal decision-journaling content.

---

## /goals — app/(mastery)/goals/page.tsx (19 lines) — pure redirect stub

**A, full file read:** server-side `redirect("/stats#goals")` (Next.js `redirect()`, not a client bounce). Header comment (3-13) confirms this is a 2026-05-30 consolidation into /stats, kept alive specifically so "old links, bookmarks, and the components that reference /goals keep working" — lands on the goals anchor specifically, "so a 'Goals' mental model arrives at goals" rather than the top of /stats. No data reads, no controls — genuinely just a redirect, matches this task's REPO CONTEXT description exactly ("redirect stubs (keep)").

## /scoreboard — app/(mastery)/scoreboard/page.tsx (13 lines) — pure redirect stub

**A, full file read:** server-side `redirect("/stats")` (root, no anchor). Comment (3-8): merged into /stats "who you are -> where you're going -> what's happening now," kept for "~20 components that reference /scoreboard." No data reads, no controls.

## /auth/sign-in — app/auth/sign-in/page.tsx (65 lines)

**JOB (A):** single-operator Google OAuth gate. Server component (`async function`), reads `getOperatorSession()` + `getAuthRuntimeMode()`, auto-redirects if already signed in with the allow-listed email (`operator.email === process.env.AUTH_ALLOWED_EMAIL`). **Open-redirect guard confirmed correct (A, lines 18-21):** `callbackUrl` is only honored if it `startsWith("/")` AND does NOT `startsWith("//")` (blocking protocol-relative external redirects like `//evil.com`) — falls back to `NEXT_PUBLIC_APP_URL` or `/chat` otherwise. Two runtime modes rendered distinctly: `"google"` (real "Continue with Google" server-action form) vs. local/unconfigured (plain-text instructions listing the 4 required env vars) — no silent fallback to a fake-authenticated state.

**Boundary flag:** none.

## app/not-found.tsx (24 lines)

**A, full file read:** standard 404 — `PageHeader` ("That screen does not exist") + one CTA `Link` back to `/`. No data reads, no client logic (not even `"use client"` — pure server component). No findings.

---

## Cross-page note: tRPC-migration completeness

Of the ~30 pages/tab-components read across this agent's full scope, **exactly three pages remain 100% raw-REST with zero tRPC**: `/links`, `/system/proactive-preview`, `/intelligence/brief` (and by extension `/intelligence/ledger`, which shares the same un-migrated `/api/intelligence/*` family). Every other page/tab either uses tRPC exclusively or carries an explicit dated comment marking a specific remaining raw-fetch call as a known, intentional holdout (e.g. `brain-insights-panel.tsx`, `todays-picks.tsx`). The three fully-raw pages carry NO such "not yet migrated" comment — they simply predate or fell outside the tRPC migration wave that touched everything else in scope. Not a bug (the REST routes work), but a real, evidenced inconsistency in the codebase's stated migration direction, worth a line in any follow-up cleanup pass.

---

## Consolidated NOT VERIFIED list (this agent's scope only)

Time-boxed omissions, explicitly flagged rather than silently assumed:

- **/brain:** button-by-button wiring for board-tab, discover-tab, knowledge-review-tab, wisdom-tab, continuity-view, reason-tab beyond DATA READS + structure; formulas for ghost accuracy, calibration summary, wisdom-gate SPC; whether `HomeBrainGraph variant="full"` diverges from Home's own graph instance.
- **/pins:** whether `app/api/brain/pinned` (legacy REST route) is truly dead at runtime vs. hit by an external client/cron/local-agent not covered by the app/components/lib/features/tools/local-agent/scripts/tests grep.
- **/people:** `RelationshipXpChip`'s full XP formula (weights found in Settings' `PeopleScoringPanel`, the combining computation not opened); `SocialProof`, `AlphaMoments`, `ArcProjection` formulas; broader `trustScore` recompute/decay job beyond the one write site found.
- **/settings:** `resetAiConfig`'s confirm-gate presence; `syncDrive` mutation purpose; Identity-axis storage table; whether the 8 non-`adhd_operating_rhythm` autopilot flag keys are read by any cron directly (vs. genuinely dead); whether `/settings`' `CronControlPanel` and `/system/crons` read the identical procedure/rows.
- **/system hub:** `changeDigest`, `memoryEvals`, `receiptFeed`, `agendaItems` payloads/consumers; whether "Fleet Truth"'s permanent-unknown chip is intentional; 5 mounted components below the grid not individually opened.
- **/system/actions:** runtime prevalence of pending `AutonomousAction` rows (the orphaned-`decideApproval` finding is code-certain; whether it currently matters in production was not queried).
- **/system/crons vs Settings CronControlPanel:** whether the two cron lists can disagree.
- **/system/alerts:** whether `/system/history` (drill-down target) still resolves to a real page or is itself redirect-consolidated (next.config.ts lists it among the hub-bound redirects, suggesting the in-page link may be stale — not independently loaded).
- **/photo-improver:** which input shape maps to the "analyze" vs. "rebrand" step of the single `improvePhoto` mutation.
- **/links:** whether an outside-click/blur handler resets the delete arm state (no auto-disarm timer found in the function itself).
- **/intelligence/ledger:** whether the `Opportunity` content is shop-business or personal (shape not opened).
- **General:** live database state for every count cited (silent-cron count, offline-device count, pending-approval count, etc.) — all formulas and code paths are class A verified; the CURRENT live numbers were not independently re-queried by this agent (the task's own LIVE OBSERVATION note supplies the one live data point actually available: "17 silent crons · 20 devices offline," which this audit traced to source and partially root-caused via a dated code comment, not a fresh DB query).

## Positive controls used in this pass

- **Nav-surface claims:** cross-checked every page's reachability claim against the single source (`components/layout/nav-items.ts`, fully read) plus `next.config.ts` `redirects()` (fully read) plus, for hub-only pages, `components/system/hub-grid.tsx`'s CARD array (fully read) — three independent, mutually-consistent sources rather than one grep.
- **"No UI caller" claims** (`pauseAllCrons`/`PowerPanel`, `decideApproval`) were confirmed via `grep -rln` across BOTH `app/` and `components/` (the two corpora that can contain a React caller), not a single-directory grep, and cross-corroborated by a second, independent piece of evidence in each case (the ai-cost page's own "Future knobs" comment for the power-settings gap; the app-badge.tsx sum-of-two-queries behavior for the decideApproval gap) rather than resting on one grep alone.
- **"Fabricated zero" claims** (`/system/health`'s `unackedDriftAlerts ?? 0`) were traced from the JSX rendering the number, back through the exact variable, to the service-layer `.catch(() => null)` that produces the null in the first place — a full call-chain read, not a pattern-match on `?? 0` in isolation (which appears elsewhere in the codebase in contexts that are NOT bugs, e.g. legitimate default values).
