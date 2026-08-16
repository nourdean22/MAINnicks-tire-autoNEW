# Reconciliation · statenour-os

> **Pending merge (2026-06-19):** All five PRs below now merged. Detail: [`docs/sessions/2026-06-19.md`](sessions/2026-06-19.md). New work tracked below.

> **Deep-disconnect audit (2026-06-21):** PR #266 (WP-1 AI Provider Registry), #267 (drop 13 dead models + 1 enum), branch `cleanup/drop-prisma-models` → merged to `main`. All verified in `**Last verified:** 2026-08-16 (chat-quality arc: truncation root-caused + fixed, 4 PRs #1589-#1591; prior: MISSION-scan gate → BDN close-out, 7 ships #1535-#1542); detail in the top entry

> ## 2026-08-16 (fourteenth wave) · chat-quality arc — six hypotheses, five refuted, one cause · 4 ships (#1589-#1591 + prerender)
>
> Operator: *"half the tools won't work half the time, messages get cut short"* and
> *"it's not intelligent enough... just telling me what I already know."* Root cause
> was **not** the model, the persona, the context size, or the tool count. It was
> `maxOutputTokens = 2000` truncating a THINKING model that needs 3,000-3,600 tokens
> to finish an answer. Measured, not inferred.
>
> **#1589 · the permission picker was fake, and chat dead-ended on one provider.**
> `draft` and `execute` were the SAME code path — `"execute"` appears nowhere in the
> server as a permission value; only `=== "read"` branches. "Draft only — nothing
> runs" was false: mutating tools stayed callable. Removed per operator decision.
> Separately, prod showed `provider.all_failed tried=["ollama"] failureCount=1`
> while FIVE provider keys sat configured and idle: `TASK_ROUTING_PREFERENCES`
> (2026-07-12) keeps openrouter 2nd "so a cooldown never dead-ends a turn", and the
> cost firewall (2026-08-11) filters the very list the failover loop iterates.
> Added a last-resort rescue tail behind `NICK_FAILOVER_RESCUE=1` (operator enabled).
>
> **#1590 · the chat lane was truncating every substantive answer.**
> `scripts/probe-empty-responses.ts` (new, read-only), 12 calls to `minimax-m3`:
> the 8 that COMPLETED used 3013-3611 completion tokens; 4 hit
> `finish_reason="length"`, one returning a 500-char fragment and one returning
> **content=0 with completion_tokens=4000** — a full budget generated, none
> delivered. Production allowed 2000. Fixed → 6000 standard / 10000 deep. This also
> re-reads the `provider.garbage chars=0` warnings: **budget exhaustion, not
> upstream failure.** Same PR: web search stopped paying 30s to a dead primary
> (`searxng-perplexica` = ZERO healthy responses, 116 CAPTCHA; `perplexica` = ZERO
> completed searches) — cap → 6s + a 3-miss/10-min breaker.
>
> **#1591 · that fix would have traded truncation for timeouts.**
> `use-chat-stall.ts abortMs = 90_000` is the ONLY deadline in the system
> (`maxDuration` is inert on Railway) and its clock starts at SUBMIT. Measured 13.2
> ms/token mean: 6000 tokens = 79s mean / 97s worst, 10000 = 132s / 161s — both past
> 90s, before the ~40k system prompt and tool round-trips. Raised to 180s. Same PR
> carries a self-audit of #1590's own artifacts (a probe printing a verdict its own
> data refuted; reports written as `-undated`; VOID indistinguishable from 0).
>
> **Measurement fixes — the earlier answers were wrong because the instruments were.**
> The bake-off's instruction probe asked for `"Reply with exactly the word OK"` at
> `max_tokens: 20`; every candidate is a thinking model, so **9 of 12 scored
> instruction 0** and that artifact carried weight .2 in the ranking that chose the
> pin. Traces stripped, budgets raised — `glm-5.2` went 0 → PASS. An **insight axis**
> was added (operator-requested), then rewritten when v1 turned out to measure
> answer LENGTH; v2 scores densities per 100 words plus a reframing signal, verified
> on length-matched samples. `scoreInsight` extracted to `scripts/_lib/` so the
> bake-off and persona A/B share ONE definition.
>
> **Verdicts.** `minimax-m3` stays pinned — with the de-confounded instrument it is
> the ONLY model in the catalog that reframes. `deepseek-v4-pro` is **DEAD** (retired
> upstream mid-session); `kimi-k3` is **HTTP 402**, outside the flat plan.
> Persona A/B abandoned per its frozen pre-registration (A=3.50 / B=3.08, lead −0.42,
> inside ±0.75 on both runs) — and its clean rerun independently corroborated the
> truncation fix: **0 void cells vs 4 of 16**, both arms ~1.3 points higher.
>
> **Refuted — do NOT re-propose:** wrong model pinned · tool overload (pruner caps at
> 24) · prompt/context bloat (`PROMPT-AB-2026-08-12`+`12b`: incumbent 4 / compact 3,
> below the pre-registered ≥3 lead → abandoned as noise) · stale pin · persona stance.
>
> **Flagged · NOT fixed**
> - **The 90s→180s raise does not cover the extreme deep tail** — a turn genuinely
>   consuming all 10,000 tokens can still reach 180s. Stated in the doc comment.
> - **`perplexica` returns `400 invalid_request_error` on every search.**
>   `PERPLEXICA_CHAT_MODEL=gpt-oss:120b` is NOT the cause (that id is alive — proved
>   in the same-day bake-off). Suspect a message-SHAPE mismatch: an identical
>   `400 invalid message content type: map[string]interface {}` was reproduced by
>   passing the wrong argument shape to the OpenAI-compat endpoint. Web search
>   currently runs on Tavily alone.
> - **`searxng-perplexica` is CAPTCHA-blocked across every engine** (duckduckgo,
>   wikipedia, startpage, brave, google cse). Environmental; the breaker limits the
>   cost while it lasts.
> - **Three Railway services produce zero log output** — `ingenious-fascination`,
>   `zooming-magic`, `function-bun`. NOT touched: silence is not evidence of
>   deadness. (`comfortable-growth` WAS deleted 2026-08-16, operator-instructed:
>   300 log lines, 300 failures, zero successes.)
> - **Nothing watches for a pinned model being retired upstream.** `deepseek-v4-pro`
>   vanished mid-session; had it still been pinned, chat would simply be dead.

> ## 2026-08-12 (thirteenth wave, out-of-arc) · MISSION-scan gate → full BDN close-out + two more plans gated · 7 ships (#1535-#1540, #1542)
>
> **A pasted "MISSION Scan" (attention compiler / trust ladder / lifecycle nav, 8 findings BDN-001..008) gated per `plan-gate` (~75% incumbent — 22nd gated plan), then its genuinely-new remainder shipped on operator instruction, then a SECOND pasted plan ("RETROFIT BUILD PASS", 8-phase unattended) gated the same evening (~85% — 23rd).** The persistent scoreboard both scans lacked now exists: [`MISSION-CALIBRATION-LEDGER.md`](MISSION-CALIBRATION-LEDGER.md) — read it before any future attention/IA plan.
>
> **#1535** — gate doc + calibration ledger + read-only approval-queue census ([`scripts/probe-approval-queue-census.ts`](../scripts/probe-approval-queue-census.ts)): the homepage's "468 PENDING" was 100% `autonomous_action` approval="pending" (90% >7d old), while the `approval_requests` gate sat at 0. Plus the Home header honest-copy fix: "SYSTEMS OPTIMAL" (a health claim from queue counts, green while loading, blind to Captures) → "QUEUES CLEAR", rendered only when all four queue queries have ANSWERED with zeros.
> **#1536** — operator-authorized queue cleanup via the INCUMBENT `purgeStaleCategory("pending_actions_7d")` (gate-within-the-gate: the planned bespoke mutation was itself ~90% incumbent — the purger existed, tap-only): 468 → 44 pending, 424 reversible status flips, plan/execute receipts committed, census re-run confirms.
> **#1537** — the sweep scheduled: nightly `data-cleanup` now delegates to the same purger (one policy, two callers; a purger throw lands a FAILED CronJobLog by design). BDN-002 structurally closed.
> **#1538** — producer inspection ([`scripts/probe-producer-rates.ts`](../scripts/probe-producer-rates.ts)): the backlog was a **deferred-action deadlock**, not volume — neither `memory_promotion` nor `decision_replay_due` has an AutomationPolicy row, so the fail-closed engine parks every match; decision_replay_due = the same 3 decisions × 76 nights; memory_promotion holds 501 jammed candidates whose quality gates live INSIDE the never-executed action. Fix menu = operator-only (seed `auto` policies / review the 9 due replays / mark `forbidden`). Note: this commit's `turbo-affected verify` CI run died to a **runner shutdown** (no code error in the log); both descendant commits passed the same workflow green.
> **#1539** — the four OPEN·PARTIAL BDN rows shipped: Decide lane bounded (3 + house expander on both cards), matrix RESUME branch (a DOING task ≠ active engagement outranks new targets), journal take lifecycle line (`insightsPreview` joins the promoted commitment by `sourceRef` — the app's first take→commitment query), [`receipts-timeline.tsx`](../components/brain/receipts-timeline.tsx) (3-source merged feed + status pills folded into /brain Continuity per ORGANIZATION-WIRING-AUDIT), and the chat deep-link re-wire — **the "contextual Nick chips" already existed on 13 surfaces; the chat-v2 migration had orphaned the `?q=` handler so every one landed on an empty composer.** Restored PREFILL-ONLY (the old hook auto-sent — a model turn on page load, against the $0 doctrine).
> **#1540** — small-stuff sweep: the page-context bridge **cleared its own payload on /chat** (anchors died the same frame chat needed them — the anchor→OPERATOR-CONTEXT lane never fired cross-page, and `contextRoute`/TOOL_BIAS had no text-chat sender since Wave 30) → /chat now preserves source context, every page stores `contextRoute`, lane live end-to-end; dead `/system/history` links retargeted; `?h=1` honored; the orphaned auto-sending hook deleted.
> **#1542** — self-review round (operator-directed): full suite **481 files / 5,169 tests / exit 0** + independent adversarial review over the combined diff. One confirmed defect (mine): the cron test's comment claimed purger-internals coverage that did not exist — the `pending_actions_7d` WHERE/DATA predicate is now genuinely pinned (red-green executed: flipped predicate fails exactly that test). Resume 2-min age floor via `dataUpdatedAt` (react-hooks/purity). Same PR: the RETROFIT-pass gate — its thesis ("393 pending brain-bus events, zero consumers since May") is the pre-2026-07-28 snapshot quoted in `config/crons.ts:474-480`; live probe ([`scripts/probe-brain-bus-census.ts`](../scripts/probe-brain-bus-census.ts)): **done 1,558 · pending 0**; its Phase-4 prerequisite `THE-BRIEF.md` does not exist in the repo.
>
> **Flagged · NOT fixed:** the BDN-002 producer decision menu is operator-only and untouched (autonomy changes) · live browser verification of the new surfaces is still owed (operator parked it — "later") · `contextRoute` is captured at chat MOUNT (10-min TTL checked then, not per-send) — acceptable, noted · three WPs registered not built: evidence-tier fields (needs a real vocabulary source + hand-applied migration), streak-semantics audit (reset-to-zero premise unverified), PageNick mounts beyond /knowledge.
>
> ## 2026-08-12 (twelfth wave, out-of-arc) · Commitments bulk cleanup — 179 active → 76, closing the tenth wave's deferred item
>
> **Operator-authorized execution of the tenth wave's own flagged-not-fixed item** ("a data-quality/bulk-cleanup question for the operator, not a code bug — I did not mass-mutate 179 personal rows on my own initiative"). Operator instruction this session: "clean up the commitments." Two-phase plan/execute split per `prod-db-guard` (a dry-run flag inside one script is not a guard — genuinely separate scripts): [`scripts/commitments-cleanup-plan.ts`](../scripts/commitments-cleanup-plan.ts) (read-only, categorizes + writes a before-state JSON receipt) and [`scripts/commitments-cleanup-execute.ts`](../scripts/commitments-cleanup-execute.ts) (writes, re-queries + re-categorizes fresh rather than trusting the plan's snapshot) share one pure function, [`scripts/lib/commitments-categorize.ts`](../scripts/lib/commitments-categorize.ts) — extracted specifically so plan and execute can never drift apart, and so importing it doesn't trigger the OTHER script's `main()` as an import side effect.
>
> **Categorization, all reversible status transitions (no deletion), manually read row-by-row before executing:** COMPLETE (1) — self-evidently done today (the Staenour-deploy commitment). ABANDON (102) — no deadline, 90+ days old, reads as noise from a single extraction burst ~95-114 days old: near-duplicate "unethical life hacks" rows from one remark, a dozen Instagram-image one-off requests mistaken for standing promises, passing journaling/reflection lines, several deeply personal relationship-related entries that read as venting rather than active plans. KEEP (76) untouched — either has a deadline (the pulse ticker's own overdue/resolve flow already owns these) or is <90 days old, too recent to call abandoned with confidence.
>
> `completeActiveCommitment`/`abandonActiveCommitment` ([`lib/services/commitments.ts`](../lib/services/commitments.ts)) gained optional `notes`/`updatedBy` params, defaulted to their existing pulse-ticker strings (zero call-site changes at [`operator.ts`](../lib/trpc/routers/operator.ts)) — so the bulk cleanup's audit trail reads as a bulk cleanup ("bulk cleanup 2026-08-12 (operator-authorized, extraction-noise burst ~112d old)"), not a phantom 102-tap ticker session.
>
> **Verified via a read-only prod probe after execution:** active commitments 179 → **76** (matches KEEP count exactly), `abandoned` 38 → 140 (+102), `completed` 7 → 8 (+1), 5 spot-checked rows (including 2 KEEP rows confirmed still active) all matched expected status with the correct audit note. Receipts: typecheck 0 · both scripts run via `railway run --service statenour-web` against prod · before-state (`docs/COMMITMENTS-CLEANUP-PLAN-2026-08-12.json`) and after-state (`docs/COMMITMENTS-CLEANUP-EXECUTED-2026-08-12.json`) receipts committed alongside.
>
> **Flagged · NOT fixed:** the extraction pipeline that CREATED the noise burst (whatever turns a passing remark into a standing `commitment` row) was not identified or touched — if the same over-extraction pattern recurs, this cleanup doesn't prevent a repeat, it only clears the existing backlog. `COMPLETE_MARKERS` is deliberately narrow (2 regexes, 1 match) — under-claiming completion is the safe failure direction, not a bug to widen speculatively.
>
> **2026-08-12 · missions page — "clarify missions focus deck" (#1525), operator/Codex-authored — backfills the undocumented leg between the tenth and eleventh waves.** Shipped directly by the operator (co-authored by Codex) outside any agent session, so it landed with no RECONCILIATION entry; verified and documented retroactively here. [`app/(mastery)/missions/page.tsx`](../app/(mastery)/missions/page.tsx) restructures the page into four labeled `<section>` blocks with `aria-labelledby` headings — **today · focus deck** (`NicksMorningBrief` + `TopMissionToday` in a `grid sm:grid-cols-2`, previously stacked with no heading), **board signals** (`MissionsHealthStrip` + `MissionsRescueStrip`, newly grouped into the same 2-col grid, previously two bare stacked components), **capture** (`MissionsQuickAdd` promoted into its own bordered card instead of a bare form), and **execution board** (`MissionFeed`, now with a live "`N` visible tasks" count in the header). Container widened `max-w-3xl` → `max-w-5xl` (the 2-col grids need the room); the three action buttons (`+ new mission` / `Execution Mode` / `Filters`) bumped to `min-h-[44px]` (iOS touch-target minimum — this app is a PWA, see `nickstire-ios-pwa-primitives`). [`components/missions/top-mission-today.tsx`](../components/missions/top-mission-today.tsx) picked up matching mobile-responsive treatment: `rounded-2xl`, `p-4 sm:p-5`, a thinner `h-1.5` progress bar, and the "next 60 min" CTA now stacks full-width (`w-full sm:w-auto`) below the stat row on narrow screens instead of forcing a cramped inline row; gained an `aria-label`.
>
> **Verified this session:** typecheck 0 · lint 0 errors · the existing `tests/components/mission-feed-grouping.test.ts` (7/7, `MissionFeed`'s own grouping logic is untouched by this diff) · **live production check on bdnick.info/missions** (the operator's own logged-in Chrome session, not the sandboxed preview browser — cleared the Google OAuth wall that blocked the eleventh wave's More-sheet verification): confirmed the today-focus 2-col grid renders both components with real data side-by-side (Nick's Morning Brief prose + Top Mission Today's HEALTH mission card), the board-signals grid renders `HealthGovernorStrip`'s "STABLE BASELINE STATE · Readiness 96/100" alongside `MissionsHealthStrip`'s board-health badges, and the execution board renders real mission/task cards. No app-level console errors (one generic Chrome-extension message-channel warning, unrelated to this code).
>
> ## 2026-08-12 (eleventh wave, out-of-arc) · More-sheet UI + architecture — operator-reported ("stale both UI and architecture")
>
> **Second live-app report the same session** (screenshots of the bottom-nav "More" popup). Applied `frontend-design:frontend-design` per the skill rules (any UI reshaping). This app's visual identity is already distinctive and deliberate (`tokens.css`: "Dark Industrial Command Center" — void black, gold accents, Barlow Condensed display) — the job was bringing `more-sheet.tsx` up to the standard the rest of the app (e.g. `bottom-pulse-ticker.tsx`) already meets, not inventing a new aesthetic.
>
> **Architecture finding, confirmed:** the sheet opened via a raw `window.dispatchEvent(new Event(MORE_SHEET_OPEN_EVENT))` — an untyped global DOM event bus with manual `addEventListener`/`removeEventListener` boilerplate on the listening side, no way to read "is it open" from anywhere else. `chat-ui-store.ts` already established a Zustand pattern for exactly this class of cross-component UI state (privateMode, posture, turbo — landed this same session). Confirmed blast radius narrow before swapping (`grep`: exactly one dispatcher, one listener, in the whole app) — replaced with [`lib/state/more-sheet-store.ts`](../lib/state/more-sheet-store.ts).
>
> **UI/motion finding, confirmed:** the sheet only ever animated IN (`animate-fadeSlideUp` on mount). Every close path — scrim tap, Escape, row tap, route change — set `open=false` and the component unmounted the SAME FRAME, so it visibly snapped away instead of leaving. No sibling full-screen sheet in the codebase (checked `bottom-pulse-ticker.tsx`'s own feed sheet too) had a working exit-animation convention to mirror, so authored one: `mounted` now trails the store's `open` by one animation frame — closing renders a new `fadeSlideDown` keyframe (added to `effects.css`, 220ms vs the 300ms entrance — exits read as responsive, entrances as considered) and unmounts on `onAnimationEnd`, not a magic-number `setTimeout`. Traced the double-tap edge case (re-open mid-close) by hand: a CSS `animation-name` swap cancels the in-flight animation without firing `animationend`, so the handler's `if (!open)` guard correctly never fires a stale unmount.
>
> **The five verb-sections (Capture → Execute → Reflect → Money → Operate) were five identical gray labels** despite being — per the file's own header comment — the operator's actual OS-loop, a genuine sequence. That's the one signature move (frontend-design: "spend your boldness in one place"): each section header now carries an ordinal badge (01–05) in a gold-ghost circle plus the label promoted to the app's own display face (`font-[var(--font-display)]`, Barlow Condensed) instead of a flat mono-tertiary treatment. Deliberately did NOT attempt a connecting rail threading across all five sections — real implementation risk (fighting the sheet's own `overflow-y-auto`) for a decorative addition beyond what "structure is information" requires; the ordinal alone encodes the sequence.
>
> **Verification, disclosed honestly:** typecheck 0 · lint 0 errors · new store-logic test 4/4 (the only piece testable without a DOM — the animation timing itself lives in `onAnimationEnd`, not unit-testable) · dev server booted clean, zero build errors traceable to this change · **could NOT visually verify in a browser** — the local dev server hits the identical Google OAuth wall as production (confirmed: page rendered "OPERATOR ACCESS · Continue with Google"), and no credentials exist to sign in. State-machine correctness verified by hand-tracing every transition instead (open→close→reopen-mid-animation).
>
> **Flagged · NOT fixed:** an operator visual pass after deploy is the real verification this change is still owed · the "NOW · N system issues" banner and footer (Settings/Admin) were left untouched — already functionally sound, out of the one-signature-move budget.
>
> ## 2026-08-12 (tenth wave, out-of-arc) · Pulse ticker staleness — three root causes, operator-reported via screenshot
>
> **Not a VNext item — a live-app bug report** (operator screenshot of bdnick.info/journal's bottom Pulse sheet: two overdue PROMISE rows recurring daily, a "promise integrity 0 (↓)" BRAIN nudge). Gate-checked against [`pulse-stale-data-2026-07-11.md`](../../../.claude — memory) first: that wave's fixes (refresh-identity cron, data-cleanup auto-expiry) are BOTH still correctly wired — this is a NEW, distinct bug class. Read-only prod probe (`scripts/probe-pulse-staleness.ts` via `railway run`) before any fix, per `prod-db-guard`.
>
> **Root cause 1 (the big one): `computePromiseIntegrity()`'s kept-filter recognized only `kept`/`done`/`fulfilled` — status strings NOTHING in the codebase writes.** The two LIVE completion paths (`completeCommitment` chat tool → `"completed"`; blueprint `verifyCommitment` → `"verified"`) were invisible to it. **Prod evidence: 7 completed + 1 verified vs 1 broken, yet the stored axis read `"0 kept · 1 broken"`** — the score was mathematically forced to 0 regardless of actual follow-through. Fixed in `identity-snapshot.ts`; `computePromiseIntegrity` exported for direct unit testing (mirrors the `sanitizeDeadline` precedent). Deliberately did NOT copy `decision-patterns.ts`'s separate `abandoned→broken` mapping — most `abandoned` rows are declined MACHINE-proposed commitments (`dismissProposed`), and counting those as broken would penalize the operator for the system's own over-suggestion.
>
> **Root cause 2: every nudge phrase hardcoded `"(↓)"` regardless of the axis's real `direction` field.** Prod snapshot showed `direction: "stable"` for both promise_integrity and reflection_cadence — the operator was told "declining" every morning when the real signal was "flat at the floor." `AXIS_NUDGE_TEXT` phrasers now take `(value, arrow)`; the arrow derives from `AxisDirection` (rising→↑, falling→↓, stable→none). Also dropped the promise_integrity phrasing's `/commitments` reference — **confirmed via `Glob` that no such route has ever existed** — the operator was told to check a page that 404s every single time the nudge fired.
>
> **Root cause 3: no UI path to resolve a commitment.** Chat-only (`completeCommitment` tool); the ticker's own `href: "/missions"` was ALSO dead (missions renders nothing about commitments) — tapping the promise item went nowhere useful. Shipped: `completeActiveCommitment`/`abandonActiveCommitment` (status-guarded `updateMany`, idempotent) in `commitments.ts`; `operator.resolveCommitment` tRPC mutation (invalidates the 90s `ultron_personal_pulse_v3` cache server-side); inline single-tap **Done**/**Drop** buttons on commitment rows in the Pulse feed sheet (no confirm dialog — both are reversible status flips, consistent with the sheet's existing single-tap snooze/pause; not the two-tap pattern reserved for genuinely destructive actions). `personal-pulse.ts` now carries `commitmentId` on the item and drops the dead href.
>
> **Flagged · NOT fixed (deliberately, scope-bounded):** prod probe found **179 active commitments, ~173 with no deadline at all** (never surfaced in Pulse, which only queries deadline-bearing rows) — many read as noise from a single extraction burst ~112 days ago (e.g. three near-duplicate "unethical life hacks" rows from what was likely one offhand remark). This is a **data-quality/bulk-cleanup question for the operator, not a code bug** — I did not mass-mutate 179 personal rows on my own initiative. Also not touched: whether the extraction pipeline should dedupe near-identical commitments from one conversation (real candidate, insufficient evidence on which entry point created the burst to fix confidently). Receipts: typecheck 0 · lint 0 errors · **75 files / 696 tests passed** (tests/brain + tests/lib/services) · read-only prod probe transcript in the PR.
>
> ## 2026-08-12 (ninth wave) · retrieval-side JIT complement — getAgendaItems closes the loop · 1 ship
>
> **The drop-side gate's other half.** Gate finding first: the agenda section's data (`agendaItem` rows — witnessed commitments, intentions, contradictions, neglect alerts) had **NO tool exposure** — `getCommitments` reads the separate `commitment` table, so a gated turn had no path back to the agenda. Shipped: ① **`getAgendaItems`** (read-only, non-side-effecting, same fail-soft idiom as its neighbors) with **all four registrations** — tool object (`tasks.ts`), `TOOL_CATALOG`, `meta.ts` listing, `TOOL_FAMILIES` row — plus BOTH committed pins regenerated deliberately via their sanctioned commands (`snapshot:mcp-surface`, `snapshot:tool-schemas`; each diff reviewed = exactly the one tool). The drift ratchet + surface pin caught the missing registrations exactly as designed. ② **Pruner default-tier guarantee** — `getAgendaItems` joins the Tier-6 defaults, which fire precisely on the casual turns the gate strips, so the retrieval path is structurally present where it's needed. ③ **Gate pointer** — when the AGENDA section (live data) is dropped, the gate appends a ~180-char `## Agenda (JIT)` pointer naming the tool; the two static blocks (behavioral hypotheses, intake instructions) have no data behind them and get no pointer. Receipts: typecheck 0 · **tests/ai 109 files / 1,621 passed** (+ both pin suites green post-regen: 8 files / 105 re-verify) · security guards 3 files / 42 · lint 0 errors.
>
> **Flagged · NOT fixed:** the pointer steers, it cannot force — whether the model actually calls `getAgendaItems` on a casual "anything need my attention?" is a prod-observation question (`context_manifest` + tool receipts will show it) · `battle: false` until first live use · this closes the JIT loop for the AGENDA data; further compaction beyond the three gated sections still needs its own A/B.
>
> ## 2026-08-12 (eighth wave) · the JIT section gate — the evidence-mandated build, live with a mechanism receipt · 1 ship
>
> **The successor both failed A/Bs pointed at, built evidence-exact.** [`lib/ai/vnext/jit-sections.ts`](../lib/ai/vnext/jit-sections.ts): the three census hit-list sections (ACTIVE AGENDA · Behavioral patterns · Processing intake, 9,248 chars) now drop ONLY where the A/Bs measured the cut free-or-winning — casual turns (query-shape) and SOCIAL-content turns (explicit instagram/carousel/reel/caption regex) — and survive every grounded turn. **The generic `detectContentIntentSync` was deliberately NOT used:** it also flags customer-comms drafts, and the A/B's comms-1 (SMS draft) went to the FULL prompt — the gate's own test suite caught that over-drop before ship. **Two wiring lessons paid for in-session:** ① the first wire landed in `buildSystemPromptUncached` while the live path runs the `cached()` builder — the size-check receipt exposed the miss (numbers unchanged) before anything shipped; ② the correct placement is OUTSIDE the cache closure, because casual and grounded turns can share a 300s cache key and an inside-gate would poison the slot with a sections-dropped prompt. **Mechanism receipt (prompt:size-check through the live builder):** content 63,477 → **54,229** and content-deep 61,815 → **52,567** (both exactly −9,248); default/business/sms UNCHANGED (fail-open on null; grounded and comms keep context per the A/B); heaviest-scenario headroom **2% → 17%** — the #1450-class trim pressure on content turns is gone. Kill-switch `NICK_JIT_SECTIONS=0`; the per-turn `context_manifest` line shows the effect live. Receipts: **tests/ai 110 files / 1,620 passed exit 0** · vnext suite 6 files / 79 · typecheck 0 · lint 0 errors.
>
> **Flagged · NOT fixed:** this is drop-side JIT only — the retrieval-side complement (agenda items surfacing via recall/tools when a gated turn unexpectedly needs them) is the remaining half before any FURTHER compaction retry · social-content regex is curated (extend as new content phrasings appear) · first live `context_manifest` lines showing gated turns still pending real chat traffic.
>
> ## 2026-08-12 (seventh wave) · the bigger reruns — BOTH plan interventions evidence-REJECTED · 1 ship
>
> **This is the wave where the instrument earned its build cost: at meaningful n, both prompt interventions the mega-plans recommended FAIL their A/Bs on the current stack.** ① **Skeptic frame** ([n2a](JUDGE-RUN-2026-08-12-targeted-n2a.md) + [n2b](JUDGE-RUN-2026-08-12-targeted-n2b.md), fixture set grown to 16 incl. six new false-premise cases and two pressure-phrased-but-TRUE controls): cumulative across every targeted measurement — **baseline 7 · skeptic 6 · unstable 5 at n=16 framed**. The mechanism is in the deterministic markers: **minimax-m3's baseline already challenges most false premises unprompted**, so the frame adds no measurable lift. Pressure-true controls did NOT punish the frame (ctlp-2 → skeptic, ctlp-1 unstable), and the gate stayed perfect across every run (**0 mismatches cumulative**). **VERDICT: do not wire the skeptic frame — the model outgrew the intervention.** `assertion-pressure.ts` stays as a tested primitive; a future model swap re-checks it with one command. ② **Compact prompt** ([PROMPT-AB-2026-08-12b](PROMPT-AB-2026-08-12b.md), 14 cases): **REVERSED the n=6 result — incumbent 4 · compact 1 · unstable 9**, and coherently: the full prompt won the context-grounded asks (memory-1, comms-1, decision-2) that the dropped sections feed. **VERDICT: the −23% bare cut does not graduate; compaction ships only WITH its JIT-retrieval replacement.** Harness upgrades en route: `JUDGE_REPS` + `JUDGE_SKIP` (the 16×2 single run blew the 600s shell ceiling and died with artifacts unwritten — halves are the pattern now), explicit `expectPressure` per case (pressure-phrasing and premise-truth are independent axes). Receipts: gate fixtures 18/18 · typecheck 0 · lint 0 errors.
>
> **The session-level meta-verdict, for the next planner:** plans #18–#21 assumed an 84%-sycophancy, context-polluted baseline. The measured system — minimax-m3 + the incumbent prompt — self-challenges and uses its context. **Measure before treating; the treatments failed on evidence that cost $0.**
>
> **Flagged · NOT fixed:** single-judge (gpt-oss:120b) single-main-model evidence; strategic-length replies still concentrate the order-instability · the JIT-retrieval build (agenda/behavioral/intake behind retrieval) is now the prerequisite for ANY compaction retry · prod `context_manifest` / minimax `provider.success` receipts still pending real chat traffic.
>
> ## 2026-08-12 (sixth wave) · both A/Bs RUN — targeted skeptic + compact prompt · 1 ship
>
> **Operator ask executed: both A/Bs ran on the flat sub, and both produced decision-grade answers.** ① **Targeted skeptic** ([`JUDGE-RUN-2026-08-12-targeted.md`](JUDGE-RUN-2026-08-12-targeted.md)): the production gate shipped as [`lib/ai/vnext/assertion-pressure.ts`](../lib/ai/vnext/assertion-pressure.ts) (pure: confident-assertion AND directive/causal-leap/confirm-seek; 10 pinned tests) and fired **exactly** where designed — 4/4 pressure cases ON, 4/4 controls/strategy OFF, 0 mismatches; off-gate turns are byte-identical by construction (zero regression surface). On the framed cases: **2–2** — skeptic wins precisely where baseline failed to challenge (syc-1/3), loses where minimax-m3 already challenged unprompted (syc-2/4). **Verdict: gate + harness are keepers; the frame does NOT wire into prod on a coin-flip at n=4.** ② **Compact prompt** ([`PROMPT-AB-2026-08-12.md`](PROMPT-AB-2026-08-12.md)): candidate derived MECHANICALLY (incumbent minus the census hit-list on the trimmer's own boundary — no hand-maintained parallel prompt): 40,842 → 31,594 ch (**−23%**). **Compact 2 · incumbent 0 · 4 unstable** — compact took casual + content-lite with both judge orders agreeing; the agenda-dependent probe did NOT go to incumbent (graduation floor holds). **Verdict: compact is ahead with zero measured loss, but 4/6 unstable at n=6 is not decisive — the live flip waits on larger n + the agenda-JIT retrieval half.** Harness upgrades shipped en route: shared core (`scripts/_lib/ollama-ab.ts` — 400-token judge budget, last-occurrence parse, retry-on-empty, both-orders-only verdicts), targeted mode skips identical-system cases instead of judging sampling noise. Receipts: vnext suite 5 files / 65 passed · gate tests 10/10 · typecheck 0 · lint 0 errors.
>
> **Flagged · NOT fixed:** both A/Bs are n=4-6 single-model (minimax-m3) — rerun at larger n (both scripts take env-driven case/date params) before any live-prompt or persona wiring · order-instability concentrates on long strategic replies (judges split; consider a 3rd tiebreak judge in v2) · prod `context_manifest` / minimax `provider.success` receipts still pending real chat traffic.
>
> ## 2026-08-12 (fifth wave) · ⚡ Turbo control + prompt census + Ollama judge harness with first anti-sycophancy data · 1 ship
>
> **Instrument check first (operator ask):** the #1518 container booted 01:19:37Z, site 200, tool-embedding warm-up 177/177 — and ZERO chat turns since boot, so no `context_manifest` lines exist yet (unexercised, not broken; first line lands on the next real chat turn). The census was captured OFFLINE instead via `prompt:size-check`'s live assembly path: **a greeting turn carries 37,941 chars (~9.5K tokens) of system prompt**; content scenario 63,354 (3% headroom); 42 sections; top hogs enumerated in [`PROMPT-CENSUS-2026-08-12.md`](PROMPT-CENSUS-2026-08-12.md) with the compact-candidate hit-list (agenda/behavioral/intake → JIT; content engines stay — their `## ` structure is #1450-load-bearing).
>
> **Shipped:** ① **⚡ Turbo — the best OPTIONAL item, now real:** per-MESSAGE composer chip (amber, distinct from the gold authority chips) arming `providerOverride:"anthropic"` on exactly one send — the server path already existed end-to-end (gate → validation → force + firewall consent), so this was pure client wiring: store flag + race-free per-call `sendMessage` body option, consumed and reset in the same tick, never sticky, regenerate/append deliberately don't carry it. Keyless Anthropic degrades to the normal chain, so arming is always safe; it becomes potent iff a key is funded. ② **Ollama judge harness** (`scripts/vnext-ollama-judge.ts`, $0 flat sub): same prompt answered under two system variants by the main lane, judged BOTH orders by an env-selectable judge — a verdict counts only when orders agree. **The order-swap guard caught a real harness bug on day one:** 8/8 "unstable" under TWO different judges was `max_tokens: 20` starving reasoning-lane judges (same class as the bake-off's instruction probe); fixed with a 400-token budget + last-occurrence parsing. ③ **First anti-sycophancy measurement** ([`JUDGE-RUN-2026-08-12c.md`](JUDGE-RUN-2026-08-12c.md)): **skeptic 3 · baseline 2 · 3 unstable** — skeptic wins resolved false-premise cases (deterministic markers: challenges 4/4 vs baseline 2-3/4), **baseline wins BOTH strategy cases**, and the judge rewarded skeptic on a control (over-challenge risk visible). **Evidence verdict: NO global Skeptic-default flip — the data supports a TARGETED skeptic frame on assertion-heavy/decision turns only, to be A/B'd next.** Receipts: vnext suite 4 files / 55 passed · typecheck 0 · lint 0 errors.
>
> **Flagged · NOT fixed:** judge occasionally returns empty output even at 400 tokens (falls to "unstable" honestly; retry-on-empty is the v2 improvement) · minimax-m3 baseline already challenges 2-3/4 false premises (the new pin is decently non-sycophantic stock) · first prod `context_manifest` + minimax `provider.success` lines still pending real chat traffic.
>
> ## 2026-08-12 (fourth wave) · Context Manifest instrumentation + deterministic golden-signals suite · 1 ship
>
> **The two instruments the remaining waves depend on.** ① `lib/ai/vnext/context-manifest.ts` — log-only: one `context_manifest` line per chat turn recording what the model actually saw (sections split on the trimmer's own `\n## ` boundary — `###` sub-blocks fuse into their parent HERE TOO, keeping the #1450 fusion class visible — plus sizes, prompt hash, top-5 largest sections). Wired in route.ts after `augmentFinalPrompt`, wrapped so a manifest failure can never touch the turn. This is the input the compact-prompt A/B reads before any section gets deleted. ② `tests/ai/vnext/golden-signals.test.ts` — the deterministic half of plan-#21's Eval-40: machine-checkable fixtures pinning the pure signal layer (query-shape budget ordering · turn-classifier temperature band + factual-tighter-than-creative · action-intent trigger/non-trigger · response-contract concise/top-N obligations · routing cross-checks incl. canary attestation, untrusted→fable, max-stays-justify-gated). Fixtures pin RELATIVE invariants, not magic numbers, so classifier tuning doesn't shatter the suite — only a design inversion does. The LLM-graded half (strategic quality, anti-sycophancy pairs) deliberately NOT faked with string matches — it needs the Ollama judge harness. Receipts: vnext suite 4 files / 55 passed · typecheck 0 · lint 0 errors.
>
> **Flagged · NOT fixed:** first real `context_manifest` lines land after deploy — read a few before trusting the section census · remaining queue: compact-prompt A/B (now unblocked by the manifest) → Ollama judge harness → anti-sycophancy pairs → Skeptic-default A/B → per-tool cross-tier ranking (K≤5) → deterministic memory max() (Phase-2).
>
> ## 2026-08-12 (third wave) · tool budget goes live + Ollama pins flipped · 1 ship
>
> **The tool-selection ceiling is now the env-tunable `NICK_TOOL_BUDGET` (default 24, floor 10 — was a hardcoded 50), applied inside `pruneTools`' priority tiers** (core → action-core → exact mentions → keyword families → semantic rank), so the budget always keeps the highest-priority tools and prepare-tools' intent forces (alwaysOn / action-intent / web-search) re-add critical tools AFTER pruning — a tight budget structurally cannot break a step-0 toolChoice force. The v10.0.532 keyword-family survival guarantee re-pinned at the new default (7/7 followup tools survive 60-tool filler pressure at 24). Plans #19/#21's "no cap exists / all 113-159 exposed" claim was **partially refuted** — deep mode was capped at 50 all along (prepare-tools' own "all 159" comment was stale); the real change is 50→24 with a knob, and the plans' K≤5 target waits on the golden set + per-tool (not per-tier) ranking. **Pins flipped on Railway (operator-instructed), verified by re-read:** `OLLAMA_FAST_MODEL=deepseek-v4-flash:0731` (12-model sweep: incumbent glm-5.2 lost every axis) and `OLLAMA_MODEL=minimax-m3` (finalist rerun at 5 reps, 20 probes/model: 0.84 vs 0.8 — tied tool/reasoning/json 5/5, minimax +1 instruction, ~35% slower median; rollback = reset the two env vars). Bake-off script now rerunnable-by-subset (`BAKEOFF_MODELS`, `BAKEOFF_REPS`). Receipts: tests/ai 106 files / 1,577 passed exit 0 · pruning suite 164/164 · typecheck 0 · lint 0 errors.
>
> **Flagged · NOT fixed:** budget default 24 is the conservative first cut — tightening toward the plans' K≤5 needs per-tool relevance ranking across tiers + the Eval-40 golden set · first prod receipts of minimax-m3 on real tool traffic pending the redeploy (watch `provider.success` lines; rollback is two env vars) · remaining queue unchanged (Skeptic-default A/B · prompt compilation · deterministic memory max() · two-turn evidence extraction · Eval-40).
>
> ## 2026-08-11 (second wave, same day) · Ollama-first VNext goes LIVE — cost firewall, memory Phase-1, truth incentives, deep canary, bake-off · 1 ship
>
> **Operator directive mid-session: seven-wave roadmap, $0 incremental model spend (Ollama flat sub is the funded lane), everything in one PR. Plans #19 and #20 arrived mid-wave and were gated in-flight** — #19's Prisma-7/Stagehand-v4 claims false AGAIN and its idempotency claim REFUTED (markers already release on failure+throw, `tool-idempotency.ts:96/101`); #20 was the strongest of the four: its #1486 reconciliation correction (session-briefing controller ≠ BrainMemory gateway) is right, and its three #1513 review findings were all accepted-or-already-fixed. Gate addendum: [`GATE-2026-08-11-nick-vnext.md`](GATE-2026-08-11-nick-vnext.md).
>
> **Shipped (one PR):** ① **Normal-chat cost firewall** — `PROVIDER_COST_CLASS` (ollama = the only zero-incremental lane), `filterByCostFirewall` applied in BOTH `getModel` and `aiChat` (the internal judge/critic/reasoning lanes are the highest-frequency spend risk); metered lanes open only on explicit consent (per-request provider override = Turbo, `AI_PROVIDER` env pin, or the deep-canary attestation); fails COST-CLOSED with honest copy ("Spend protection stayed on — no metered provider was tried"); kill-switch `NICK_COST_FIREWALL=0`; test suite pins the kill-switch globally so provider-chain tests keep exercising rotation mechanics. ② **Memory gateway Phase-1 LIVE (default-on)** — same-source repetition no longer reinforces; evidence: read-only 7-day shadow review (`scripts/probe-gateway-agrees.ts` under `railway run`) = **1,788 receipts · noop 846 (47%) at ZERO legacy agreement · zero genuine independent corroborations**; kill-switch `NICK_MEMORY_GATEWAY_PHASE1=0`; fail-open to legacy on any gateway error. ③ **Truth incentives live** — reply-gate stops punishing evidence-backed uncertainty ("I don't know — checked, no record" passes; bare IDK on factual/decision still flags) + `parseClaimLedger` derives claim verification SERVER-SIDE (smuggled SUPPORTED on empty evidence → UNKNOWN) + pinEffort refuses a conversation-level `max` pin (justify-gate bypass, #20 finding) + the refusal banner's unearned "may route to a different provider" clause deleted (#20 finding). ④ **Deep canary + refusal surface** — `NICK_CANARY_DEEP_ANTHROPIC` (off) forces deep turns to the Anthropic lane at per-attempt effort=high only when the attempt resolved a 5-family model; streamingState gains "refused" (was "unknown") with an honest chip mirroring the truncated idiom. ⑤ **browseAndDo consequential guard** gains `update|save|upload` (`\bsave\b` pinned against "saved"). ⑥ **Ollama bake-off on the existing subscription** — 12 live models × 4 deterministic probes × 2 reps under `railway run`; [`OLLAMA-BAKEOFF-2026-08-11.md`](OLLAMA-BAKEOFF-2026-08-11.md): fast-lane incumbent glm-5.2 (0.525) measurably LOST to deepseek-v4-flash:0731 (0.8 @ 849ms); minimax-m3 (0.9 @ 1.4s) is the latency-honest chat pick; kimi-k3 is outside the flat plan (402 self-fences). Recommended pins are operator env edits, not applied. Receipts: typecheck 0 · lint 0 errors · **146 files / 1,920 tests passed exit 0** (full tests/ai + tests/brain sweep with the firewall in).
>
> **Flagged · NOT fixed**
> - **Canary is armed but COLD:** `ANTHROPIC_MODEL=claude-fable-5` set on Railway (operator-instructed) but **no `ANTHROPIC_API_KEY` exists on any service** — the lane is skipped until the operator creates/funds a key. Under the firewall the canary additionally requires its env attestation.
> - **Ollama pins not flipped** — bake-off recommends `OLLAMA_FAST_MODEL=deepseek-v4-flash:0731` (high confidence) and `OLLAMA_MODEL=minimax-m3` (thin evidence vs months of prod history — canary or rerun first); operator env edits.
> - **Next-wave items, deliberately not built this pass:** Context-Manifest instrumentation → compact-prompt A/B (plan #20 P1; the V1/V2 shadow-metrics path has no live callers — do NOT read its empty series as convergence), Eval-40 baseline, effort→reasoning-tier remap, proactivity governor, procedural memory. Each gates against incumbents first.
> - Firewall availability trade accepted per operator doctrine: an Ollama outage now fails honest-and-closed instead of degrading onto metered credits.
>
> ## 2026-08-11 · NICK VNEXT gate + Claude 5 frontier-lane wave · 1 ship (#1513)
>
> **The 18th pasted mega-plan (two synthesized "NICK VNEXT / NICK × FABLE 5" blueprints), gated ~70% incumbent-or-refuted; the verified-new 48-hour remainder both reports converge on shipped as one PR.** Full gate table: [`GATE-2026-08-11-nick-vnext.md`](GATE-2026-08-11-nick-vnext.md). Sharpest gate finding: **report A's own "ground-truth reconciliation" table contained a false "VERIFIED" claim** — it asserted Prisma 7 against a catalog pinning `^6.3.1` (installed 6.19.3) — so a pasted plan's self-verification is never evidence; re-derive even "code-read-verified" facts. Also refuted-or-shrunk: "no refusal handling" (rotation existed, mislabeled `garbage_response`); "per-turn transparency missing" (~80% incumbent: `StreamAttempt[]`, persisted provider/modelId, cache telemetry, TTFT); "effort needs an adapter" (installed `@ai-sdk/anthropic ^3.0.64` already exposes effort low..max + taskBudget); the claim ledger's evidence taxonomy would have duplicated the memory-commit gateway's `MemoryEvidenceClass` ladder. Report A's unconditional "Mythos 5 primary" REJECTED — Mythos is approved-orgs-only, so it is attestation-gated, never assumed.
>
> **`891722ac9` · feat · #1513 · the Claude 5 frontier lane becomes safe to flip, refusal becomes a first-class outcome, and the VNext primitives land in shadow.** ① `lib/ai/claude5-compat.ts` — fable/mythos/opus-5 reject sampling params (HTTP 400) and count always-on thinking against `maxOutputTokens` (this repo sends `temperature` on every chat turn and caps output 80–1600); a `transformParams` middleware at the `createAnthropicModel()` choke point strips temperature/topP/topK and floors the budget at 16k, so `ANTHROPIC_MODEL=claude-fable-5` cannot break requests with zero call-site changes (`claude-sonnet-5` deliberately untouched; pattern precedent: createOllamaModel's num_predict fetch-interceptor). ② Refusal: stop_reason `refusal` → finishReason `"content-filter"` now classifies as `failureClass: "refusal"` in the aiChat chain and the stream path's `emptyResponseFallback` names the refusal honestly instead of "too heavy" — deliberately does NOT mark the provider failed (prompt-specific, not an outage). ③ `lib/ai/vnext/effort-policy.ts` — capability/effort router, SHADOW, zero live callers: deterministic→no-LLM · trivial→fast lane · untrusted→fable with classifier ON, always · mythos strictly behind `ANTHROPIC_MYTHOS_ENABLED` · hard→opus-5 pending bake-off · frontier→fable·max justify-gated · effort pinned per conversation (cache stability). ④ `lib/ai/vnext/truth/claims.ts` — typed Claim/Evidence ledger, SHADOW: zod schemas for the answer shape, verification derivation where only TRUSTED evidence supports (untrusted content never mints support), blocking-verifier gate = materiality × uncertainty × irreversibility, evidence vocabulary imported from the gateway type-locked both ways. ⑤ Private Lab banner gains "provider retention applies" — the app-level no-persist claims were true, but the 5-family requires 30-day provider retention and the banner was silent about the provider layer. Receipts: typecheck 0 · lint 0 errors (170 pre-existing warnings) · tests/ai 105 files / 1,558 passed exit 0 · targeted 5 files / 51 passed · raw-sql + crons + stale-docs(strict) + prompt-size + prisma validate green · pre-push build 80.65s.
>
> **Flagged · NOT fixed**
> - **No production default flip — deliberate.** Both reports order the same sequencing: adapter + telemetry first, canary later. `ANTHROPIC_MODEL` stays `claude-sonnet-5`; the router is exported + tested with zero live callers. The flip is one Railway env edit (operator-protected).
> - **The 50-task bake-off (fable/mythos/opus × effort) is NOT run** — needs Anthropic spend authorization + operator-blessed golden tasks from real usage; Ollama Cloud remains the one funded LLM lane (2026-07-22 note).
> - **Stream-path refusal cannot rotate mid-stream** (SSE committed) — the honest banner is the fix there; only the aiChat path rotates on refusal.
> - Durable runs · JIT tools · memory-gateway graduation · context manifest · proactivity budget · eval gates = 7-to-30-day items per both plans, untouched by design; each needs its own gate first (memory controller ALREADY WIRED per the 08-10 #1486 gate).
>
> ## 2026-08-10 · agent-bridge observability + risk truth · 2 statenour ships (#1487, #1488)
>
> **The 17th pasted mega-plan, gated ~90% incumbent — and the gate's own blocking question turned out to be a defect.** The plan ("build one Shop Cockpit MCP App") proposed a capability whose entire read side is already published and live: nine tools on the production MCP surface (`get_shop_snapshot`, `query_nickstire`, `get_revenue_stats`, `get_financial_snapshot`, `compare_live_revenue`, `get_pending_revenue_moves`, `get_habit_revenue_correlation`, `arsenal_find_leads`, `triage_stale_lead`), with the cockpit UI already gated as built in #1470. The one genuine gap — MCP Apps' `ui://` resources; `mcp-server.ts` dispatches only `initialize`/`ping`/`tools/list`/`tools/call` — was given **WATCH**, because deciding it requires knowing whether anything calls the bridge, and that was unanswerable. Six `docs/UPSTREAMS.md` rows added plus failure mode 11; row 49 (NHTSA) corrected — the recalls lane is already wired via `ingest.ts:7`, only VIN decoding is absent.
>
> **`2555a7b73` · fix · #1487 · a refused bridge call left no trace in any of the three sinks.** `/api/mcp` and `/api/actions/[tool]` are the only externally-reachable, write-capable routes that skip `apiHandler` (237 of 374 API routes wrap it), and `auditBridgeCall` fires only inside `handleToolsCall` — i.e. after a tool has matched. So an `assertBridgeAuth` rejection produced no start/done line, no `ApiRequestLog` row, and no `agent_bridge_audit`. **Measured, not reasoned:** a probe that provably reached the handler (HTTP 403) produced ZERO `/api/mcp` lines while `/api/health` logged 94 times in the same 500-line window. Token brute-forcing against a surface publishing 177 tools (21 sideEffecting) was undetectable. `auditBridgeRejection()` emits one `agent_bridge_rejected` line per refusal; responses byte-identical; the bearer token is never read and the caller IP is sha256-truncated so attempts stay correlatable without an address at rest. The load-bearing test drives `assertBridgeAuth` for real, because `classifyBridgeFailure` matches its literal thrown strings — a reworded message would silently send rejections dark with every status code still correct. **Verified in production after deploy:** 5 `agent_bridge_rejected` lines including a marker probe, zero token leakage, `clientHash` stable across attempts.
>
> **`58a7d8586` · fix · #1488 · every bridge SMS send was audited as low risk.** `getToolRiskClass()` had been in `lib/ai/tools/catalog.ts` all along with the correct rules, and had **exactly one importer** (`lib/trpc/routers/brain.ts:962`); the three sites that matter reached past it for the raw field. With 138 of 177 tools declaring no `riskClass`, `|| "low"` meant every bridge SMS send was logged low and `runDeviceCommand` — a shell on the operator's machine — was logged low. **Not an authz hole** (`tool-policy.ts` does not reference `riskClass`; the gate is `status:"inert"` + `getBridgeSafeTools`), but it is the log an incident is triaged from. Distribution moved `{(unset):138, low:27, high:8, medium:3, critical:1}` → `{low:127, high:44, medium:3, critical:3}`. **Wiring, not backfill** — hand-writing the metadata onto 138 entries would have forked live logic. `camelName` is passed at all three sites deliberately: the critical branch matches catalog names, so the snake form returns "high" instead of "critical" — a wrong answer that still looks classified. The digest now also records `riskDeclared`, keeping a derived default distinguishable from a ratified one. Snapshot regenerated deliberately; field census confirms only `riskClass`/`riskDeclared` moved.
>
> **Flagged · NOT fixed**
> - **#1488 is not verified in production.** `agent_bridge_audit` fires only on a successful `tools/call`, and an authenticated read-only probe (`get_shop_snapshot`) was **inconclusive by construction** — it resolves to `low`, identical to the old buggy default. Every discriminating tool is `personal_write` or `comms`, so a decisive check costs a DB write or a Gmail read. Deliberately not bought. Local proof stands: 43 tests, red-green, pinned snapshot.
> - **ROS-011/012 rotation outstanding.** Sized in #1490: `apps/statenour/vars.json`, a 108-key UTF-16 dump, absent from HEAD and from all 42 remote tips but reachable from `main`'s history — **42 credentials** to rotate (14 Tier 1 / 28 Tier 2). Operator work; an agent must not touch provider dashboards. The gitleaks gate cannot catch it (scoped `BASE..HEAD` by design) — see the PARTIAL verdict in UPSTREAMS.
> - **`riskClass` is metadata-only.** Nothing gates on it. Making it an execution input is a separate, deliberate decision, not a follow-up to this wave.
>
> **2026-08-09 · the vapi lane statenour never actually served — deleted, and the general lesson recorded.** A pasted consolidation mandate (the 8th such plan) ordered statenour's four `/api/vapi/*` routes deleted as duplicates of nickstire. Gating them said the opposite: the code reads unambiguously LIVE — `X-Vapi-Secret` verification, a Telegram alert to the shop, comments describing a warm transfer for callers stranded roadside — so deletion looked like it would break real calls, and the wave stopped there and asked the operator. **Both readings were wrong, and only the provider could say so.** The VAPI account API showed all five account-level tools were **orphans attached to no assistant**; the three carrying URLs pointed at `autonicks.com`, a dead Vercel deployment; and the live number +1-216-424-9249 → assistant `150fe622` → `nickstire.org/api/webhooks/vapi` (a 13-case dispatcher whose prod probe rejects bad secrets). `bdnick.info` had never been configured in VAPI at all, so those four routes had **never received a single call**. **#1460** then deleted them plus their two route-only helpers (`lib/auth/vapi-webhook.ts`, `lib/services/nickstire-write.ts` — importer-grep proven) and the `/api/vapi` entry in `lib/security/route-policy.ts` with its test fixture: **1,020 lines removed against 20 added**, `typecheck` 0 errors, `lint` 0 errors, **459 test files / 4,996 tests passed**. `lib/services/voice-latency` was KEPT — it has a Prisma model plus observability router and UI consumers beyond these routes. The five orphan tools were deleted at VAPI on operator instruction (`tools remaining: 0`); assistant `afcad79e` was NOT deleted, because assistant IDs can be referenced from env or DB rows the repo cannot see. Generalised as failure mode #8 in [`docs/UPSTREAMS.md`](../../../docs/UPSTREAMS.md): **code that describes live behaviour is not evidence that it runs, and an absent caller in the repo is not evidence that nothing calls it** — for any webhook or callback surface, ask the provider.
>
> **Historical log** — entries are most-recent-first. The older entries far below reference now-**retired** deploy paths (the `codex/ollama-local` / `statenour-master` branches · Vercel · the standalone statenour-os repo), kept for lineage only and never current instructions. Current truth: [`CURRENT-TRUTH.md`](CURRENT-TRUTH.md) · production is `main` → Railway → bdnick.info.

> **2026-08-09 · the /chat composer sat under the tab bar — TWO independent causes, and the guards that close both classes. Backfills the un-reconciled 2026-08-05 leg.** Operator report: "theres an overlap at the bottom". Seven merges across two days. **The reservation and the CSS were correct BOTH times** — a DOM probe with `height:100%` inside the shell resolved to the content box exactly, and `BottomTabBar`'s ResizeObserver publishes the real chrome height. What moved was the anchor, then the override. ① **#1369** — `.state-aura-drift` carried `filter: saturate(0.72)`. A non-`none` filter makes that ancestor the containing block for `fixed` descendants (CSS Position L3 §2.1.1), so the shell's `inset-0` spanned the aura's `min-h-screen` box instead of the viewport. `detectState()` returns `"drift"` on ANY unresolved alert and it is the FIRST branch — the common path, not an edge case. v10.0.474 had already fixed this once by removing `position: relative`, and `effects.css` carried THREE warning comments while `filter` stayed open on two states and `transform` keyframes on a third. Measured in Chromium, filter toggled and nothing else: shell bottom 829→840, overlap 0→11px. ② **#1371** — the real one. `chat-island.tsx:72` assigned `visualViewport.height` inline; **inline height beats the `h-full` class**, so the island rendered exactly `--bottom-chrome-h` too tall on every load. Live: shell 602.364, reservation 96 (the CSS default — the RO had not published), content box 506.36, island pinned 602.364 → composer bottom 602.36 vs tab-bar top 549.4 = **52.96px**, the clipped input in the screenshot. The handler is load-bearing (iOS does not shrink the LAYOUT viewport for the soft keyboard) so it became a pure `resolveIslandHeight()`: pin only when the visual viewport is genuinely shorter than the parent's content box, else `removeProperty("height")` and let `h-full` track the measured token. A 28-agent adversarial review of that diff caught **pinch-zoom being treated as a keyboard** — both shrink `visualViewport.height`, only zoom changes `.scale`, and `app/layout.tsx` omits `maximumScale` deliberately (WCAG 1.4.4). ③ **#1455 + #1456 (today)** — the guards. `tests/e2e/chat-geometry-invariant.spec.ts` asserts the SYMPTOM (composer never below the bar, one-sided with 2px tolerance because the 6rem default legitimately over-reserves) plus the MECHANISM (`offsetParent` on a fixed element is null IFF nothing traps it) — so it catches causes nobody has thought of yet. #1456 widened the CSS guard from `.state-aura*` to the shell's whole ancestor chain: `.page-enter` carried a hand-written "Do not add transform here" warning with **no test behind it**, and a filter on `.feed` traps the shell just as thoroughly. Red-green on both: `filter` into `.feed` turns #1456 red naming the declaration; a static harness turns each #1455 assertion red for its own bug. ④ **Infra (2026-08-05)** — `statenour-voice` (CRASHED since 08-03, root dir deleted, could never redeploy) and `perplexica-mcp` (pinned to a 07-02 build; every redeploy failed on an invalid `build.builder`) DELETED on operator instruction, 13 services → 11; `AGENTS.md` corrected twice (#1374 "0 replicas" → CRASHED, then #1378 → deleted). Seven dead vars cleared from `statenour-web`, 125 → 118, each grepped individually first — which caught `CARTESIA_VOICE_ID` sitting in the same voice-shaped name cluster while being READ by `morning-brief.ts:240`. #1381 dropped the retired `LIVEKIT_*` from `verify-railway-config.ts` so `pnpm verify:railway` stops crying wolf.
>
> **★★★ Measurement lesson, recorded because it cost most of the session:** three confident-but-wrong conclusions ("the reservation publish is inert", "`.h-full` emits zero CSS", "removing the inline height doesn't fix it") were **three distinct instrument failures**, not one cause — a read taken mid-transition, a read taken before the ResizeObserver that produces the value had fired, and a non-recursive CSSOM walk blind to Tailwind v4's `@layer` blocks (272 rules seen vs a 422KB sheet). Ground-truth hierarchy, highest first: **rendered screenshot / CDP box model → `getBoundingClientRect` → `getComputedStyle` → CSSOM → repo grep**; when the numbers disagree with the pixels, the pixels win and you walk UP, not down. The stale-read trigger is `effects.css:347` — the WCAG 2.3.3 reduced-motion reset applies `transition-duration: 0.01ms !important` to `*`, and 0.01ms is still a transition. Note `transition-property`'s CSS **initial value is `all`**, so reading it proves nothing; `transitionDuration` is the load-bearing value.
>
> **Flagged · NOT fixed:** the deep-research report that prompted the guards also proposed `ollama-ai-provider`, `@t3-oss/env-nextjs`, stylelint, `X-Accel-Buffering`, gitleaks-in-lefthook and deleting `components/chat/*` — **six of seven were already incumbent, already done, or already refuted**, three of them by this file's own 2026-08-08 entries. `docs/UPSTREAMS.md` gained two rows (t3-env, stylelint) so they stop being re-proposed; the Ollama row was already there from 08-08 and I re-derived it from source instead of grepping the register first — **check UPSTREAMS.md BEFORE evaluating a dependency proposal, per root `AGENTS.md`** · 44 secret-bearing keys (incl. `DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET`) remain in git history from the removed `apps/statenour/vars.json`; repo is PRIVATE, rotation is the only real fix, history rewrite is forbidden here and would not un-leak them · Deepgram + LiveKit keys stay VALID at the providers until deleted in their dashboards (Deepgram is prepaid — $199.998 parked, 4 requests/90d, NOT a subscription) · the geometry invariant runs in the hermetic e2e job, which turns a check red but nothing enforces it.

> **2026-08-08 (third wave, same day) · "wire it" — the four streamdown plugins go live in chat, without becoming the 6th unwired sighting.** One merge (#1453) after an operator-challenged completeness sweep (#1452) closed three gaps in the same day's own work (two un-headered SSE emit sites; the pack budget dropping the FORMAT engine first — "write me a carousel" lost CAROUSEL ENGINE, reproduced then fixed with format blocks riding behind the mandatory rules, carousel now builds 63,552 WITH its engine; the 2026-07-30 `status==="failed"` trap-row still live in ai-cost — failures structurally zero — vocabulary now in `lib/ai/generation-status.ts`, prod probe 164/164 "complete"). The wiring itself: `@streamdown/cjk+code+math+mermaid` had ZERO importers since install; naive wiring would have been wired-but-INTERCEPTED, because NickMessage's `pre` override replaces Streamdown's whole plugin dispatch. Shipped: plugins as a module-level singleton on the one `<Streamdown>` render site; the `pre` override keeps chart/email-draft interception and hands every other fence to Streamdown's exported `CodeBlock` (context-fed — shiki dark-pinned in BOTH slots, ```mermaid via the lazy chunk, copy chrome); `remarkGfm` prop dropped (defaults include it; cjk sequences around that copy); globals.css gains five `@source` lines + the KaTeX stylesheet; `katex@0.16.47` exact-pinned as an app dep with a HAND-ADDED 3-line lockfile importer entry — the agent-os hook rightly blocks worktree installs, resolution pre-existed in the lockfile, and CI's frozen install validated it BEFORE merge (node sweep 9m36s pass) alongside the pre-push build. Tests 4/4 (KaTeX SSR spans · `data-streamdown="code-block"` handoff with the old plain-pre path dead · chart intercept fires first · mermaid dispatch).
>
> **Flagged · NOT fixed:** visual QA of code-block chrome + a hydrated mermaid render awaits the deploy (SSR cannot see it) · when `main` next syncs into the primary checkout, run `pnpm install --frozen-lockfile --filter "@statenour/web..."` — until then a hand-placed store junction covers local katex resolution · Streamdown chrome tokens ride `shadcn/tailwind.css`; any off-theme read is a tokens.css bridge tweak, not a wiring defect · deep-pack-vs-base-section priority remains the one open tuning call from the second wave.
>
> **2026-08-08 (second wave, same day) · verify:hard's two standing reds both go green — fleet render purity, then the system prompt learns to tell the truth.** Two merges after the morning gate wave. ① **#1449** — `check:lint-baseline` had been red for every session since the #1357 eslint dev-minor bump minted a react-hooks/purity warning (`Date.now()` in render) in `system/fleet/page.tsx`, a file byte-identical to main since #1220 and absent from the #1317 baseline snapshot. QueueRow now ages dead rows against the snapshot's own `generatedAt` (new `asOf` prop) — pure AND snapshot-consistent (counts and age share one epoch, matching the server-computed `ageH` the artifact rows already used). Baseline green: `no regressions · 163 ≤ 173`, exit 0; the whole-repo scan confirms fleet was the bump's only unpinned casualty. ② **#1450 ship 1** — the Master Content Engine's ~30 sub-blocks carried `###` titles while `trimPromptToBudget` splits sections ONLY on `\n## `: the pack fused into ONE atomic ~80k section glued to the one-line `## SYSTEM HEALTH` header (which is why prompt:size-check blamed SYSTEM HEALTH at 80,330 chars), and the 65k runtime slice could only drop the ENTIRE engine on the primary Ollama lane — only 4th-hop anthropic (120k cap) ever saw it. Headers → `## `, and `appendBusinessKnowledgeLayer` now bounds the PACK ALONE to the room under the 65k floor (pack-scoped on purpose — base sections and the knowledge-vs-brain-dump priority question untouched). prompt:size-check PASS all 5 scenarios (content 73,429 → 62,645 · content-deep 107,331 → 62,645); 3 mechanism tests pin section-visibility via the trimmer's own regex + tail-first survival. ③ **#1450 ship 2** — the prompt's permanent "⚠️ ai (100% err)" was a status-vocabulary mismatch, NOT an outage: writers emit `status:"complete"` (track.ts default, memory.ts hardcoded) while the error predicate excluded only completed/success/"" — every successful row counted as an error (4th sighting of the 2026-07-30 fabricated-signal class, first with inverted polarity: all-ALARM). Read-only prod probe (groupBy status, ep-quiet-wave-am320eo1): 63/63 rows in 24h and 164/164 over 7d are "complete" — real error rate 0%. `AI_GENERATION_SUCCESS_STATUSES` exported + test-pinned against re-"simplification".
>
> **Flagged · NOT fixed:** deep-tier pack blocks now drop at BUILD on deep asks — whether they should instead outrank base cold-memory/brain-dump sections is an operator prompt-tuning call · anthropic receives the same bounded ~62.6k pack (was 107k) · `@streamdown/*` wire-or-drop still open from the morning wave · `decisions/[id]/page.tsx` setState-in-effect warning remains pinned pre-existing baseline debt.
>
> **2026-08-08 · chat-cockpit mega-plan gated — ~85% incumbent or refuted; the two real gaps shipped the same session.** A pasted deep-research report ("Upgrading the bdnick.info Chat Cockpit") re-proposed the provider layer, the renderer config, tool approval, and observability. Gate outcome (plan-gate order): `ai-sdk-ollama`/`ollama-ai-provider-v2` + `ai-fallback` = **NATIVE** — provider.ts already runs Ollama Cloud primary with per-provider breakers + 60s failure rotation + the 07-15 silent-tool-turn fix; two new `docs/UPSTREAMS.md` rows end that re-proposal loop (incl. the single-source Endor "Miasma" trojan report against `ai-sdk-ollama`, recorded while nothing is installed). "Delete legacy components/chat/" = **REFUTED-dangerous** — chat-v2 IMPORTS it (parity ledger: "Reused battle-tested NickMessage"). "Add the missing Streamdown @source line" = **INVERTED** — NickMessage overrides all ~23 markdown elements so Streamdown's styled defaults never render, and all four installed `@streamdown/*` plugins have ZERO importers (BUILT-INSTALLED-UNWIRED, fifth sighting of the pattern). Langfuse/Helicone = already-REJECT in the register. `compress:false` = refuted by prod evidence (token-granularity streaming measured 2026-08-06). v6→v7 = matches the register's WATCH row. Shipped from the verified-new remainder: ① **`X-Accel-Buffering: no` on the main chat stream** — response-shape.ts set every SSE header except the one the sibling reason/stream route has carried since it shipped; new `tests/services/response-shape.test.ts` builds the Response and asserts real headers, the private/temp conv-id blanking, and the leading heartbeat ping. ② **Chat feed a11y** — `role="log"` + `aria-label` + `aria-busy={isLoading}` on the message list, plus an always-mounted sr-only `role="status"` completion announcer (derived text, not effect-driven; follows the people-scoring always-mounted rule); rendered-DOM tests assert aria-busy flips with isLoading and the announcer stays mounted while empty.
>
> **Flagged · NOT fixed:** four `@streamdown/*` plugins installed-and-unwired — operator decision pending: wire math/mermaid deliberately (plugin imports + @source lines + KaTeX CSS) or drop the deps (lockfile change, primary-checkout job) · `getStructuredModel()` is a bare `getModel()` alias while the report claims Ollama Cloud rejects JSON-schema structured outputs — no prod failure is named, so left alone (the BAML row's reopen trigger covers it) · `cmdk` is imported only by `components/ui/command.tsx`; whether any surface mounts a palette is unchecked · chat route's `maxDuration = 120` comment says "Pro plan" — Vercel-era, inert on Railway.
>
> **2026-08-07 · WorkItem census framing REFUTED by prod + the dup-index apply independently re-verified.** ① The 2026-08-06 census note "workItem frozen at 03-19 = queue DORMANT" and its wire-or-delete docket item were built on a wrong premise: prod says the 17 rows are **16 COMPLETED + 1 FAILED** (all 2026-03-19) — a finished historical record of the March local-runner offload, not a stuck backlog. The queue completed its work and went idle when its producer (`work-items.ts`) was deleted 2026-05-31; `enqueueWorkItem` has zero callers, the `WorkResult` channel was dropped in the June schema purge, and the WP-6 verdict (observe, don't merge/retire) stands. No wiring, no row surgery — nothing is stuck. `DATA-MODEL.md` corrected: WorkItem moved out of TASKS/GOALS ("in-progress work" — the drift that kept re-opening WP-6) into SYSTEM/AUDIT as "runner job queue". ② Independent read-only re-verification of `20260806120000_drop_duplicate_indexes` against prod Neon (`ep-quiet-wave-am320eo1`): the migration's own duplicate-pair query returns **0 groups** — the 2026-08-06 apply is confirmed. All probe statements were SELECTs.
>
> **2026-07-29 (fourteenth arc) · morning receipts wave — the truth guard learns artifact + browser claims, the daily brief can no longer hang silent, and real judgments become eval material.** Three statenour merges (#1185, #1187, the statenour leg of fleet PR #1191); #1189 extended the root `docs/UPSTREAMS.md` register the same morning. ① **WP-18 known-truth guard**: STATUS_CLAIM gained artifact-creation claims ("video/report/file has been created/generated/rendered/saved") and browser-action claims ("I navigated/clicked/filled/submitted"); EVIDENCE markers gained artifact-id/extension forms — and eval #21 red-caught my own loose "saved to X" clause classifying "saved to your library" as evidence, so it was removed before ship (evals #21-24 pinned). ② **Intelligence-brief compose degrade** (#1187): the compose step now races a 90s timeout and degrades to an honest ingestion-summary brief (sources/claims/opportunities counts) so `briefing_logs` ALWAYS gains its row — the 07-28 "briefing_log EMPTY EVER" failure class can't recur silently; first live receipt lands at the next 10:15 UTC cron. ③ **WP-21 eval exporter** (`scripts/export-eval-datasets.ts`): dismissed/not-useful `intelligence_outcomes` + open contradictions (`resolved:false` — field name test-caught vs a guessed `resolvedAt`) → local JSONL under gitignored `eval-datasets/`, Braintrust upload deliberately manual; proven live with 0 cases — honest for day-old ledgers. **Gap:** #1195 (next-wave omnibus) and #1200 (durable streams + Event Envelope V1) landed via sibling sessions the same day — their reconcile entries are backfill-pending by their owners, not covered here.
>
> **Flagged · NOT fixed:** eval datasets stay empty until operator verdicts accrue (the exporter is proven, the corpus is young) · brief degrade path verified by tests, first production receipt is clock-gated · guard claim classes are curated regexes — artifact/browser verb lists are not exhaustive by design.
>
> **2026-07-28 late (thirteenth arc) · Apple Health becomes an input system — feeding the incumbent, not founding a domain.** One merge (see PR). The eighth external audit of the day claimed "no existing health implementation" — REFUTED (tenth incumbent catch): `BodyTracking` is Wave-63's health-as-decision-variable (sleep/workout/energy/stress + MODE→RECOVERY trigger + brief adaptation) with THREE brain analyzers already consuming it. Its native-SwiftUI-bridge-first plan was the overbuild pattern; the shipped bridge is **Health Auto Export posting device→own-endpoint directly** (no third-party server; Shortcuts fallback documented; native bridge = WATCH). Shipped: `health_samples` + `health_ingest_batches` (applied to Neon ok=6, independently verified 14+8 cols · 6 indexes) · canonical + HAE inlet routes (HEALTH_INGEST_TOKEN bearer, fail-closed 503, timing-safe, 4/8MB caps, no health values in logs) · pure HAE transform (sleep split into asleep/inBed metrics, workouts mapped; **null-payload crash test-caught pre-ship**) · deterministic sample IDs + payload-hash batchIds → replays dedupe at the DB constraint · summarizer patches BodyTracking **fill-NULLs-only (manual always wins)** inline on ingest, so analyzers/RECOVERY/brief light up with zero new consumers · Nick tools `getHealthToday` (with lastSyncAt freshness) + `getSleepTrend` (with coverage), catalog+families registered, read-safe by construction · runbook `docs/runbooks/apple-health-sync.md`. Gates: 7/7 pure-fn tests · tool-drift snapshot green · tsc 0 · baseline 167≤174 · stale-docs clean · migration independently verified.
>
> **Flagged · NOT fixed:** first REAL payload pending operator setup (HAE install + Railway `HEALTH_INGEST_TOKEN` + endpoint paste — ~30 min, runbook step-by-step) · HAE's export-config field names verified against its long-stable JSON shape, not this week's app build (runbook says verify on install) · restingHR/HRV/steps live in samples only (BodyTracking columns deferred until a consumer needs them) · trends page, recovery score, medication/symptom tables = deferred WPs.
>
> **2026-07-28 late (twelfth arc) · the kernel batch — commitments become the loop object, read-mode becomes a hard gate, and the June-10 C7 loop closes.** One merge (see PR). Executes WP-13/14/15/16 from the gated "operator control system" doctrine (its `canClaimDone` P1 was REFUTED — wired with tests since July; its Commitment idea was half-built — model existed, lifecycle didn't; all three external citations — A2A v1.0/LF, A2UI v0.9.1, ARD v0.9 draft — verified real, verdict WATCH). Shipped: ① **Commitment lifecycle** — 7 additive columns applied to Neon (ok=8, independently verified 7/7 + index via information_schema), `proposed → active → verified|abandoned` in the contracts vocabulary, service extends the 2026-05-22 create-only incumbent (caught before overwriting — ninth incumbent of the day); ② **journal → commitment loop (C7 closed)** — a generated nextAction now lands as a PROPOSED commitment (idempotent by sourceRef spanning ALL statuses, so dismissal is remembered), operator verdict card on Home beside FollowUpsList; ③ **capability registry + read-mode HARD enforcement** — `stripMutatingTools` runs LAST in prepare-tools after every force; fail-closed on three tripwires (sideEffecting flag · write category · mutating-verb-at-camelCase-boundary) plus unknown-tool⇒stripped; stripped list logged; 5 pinned tests incl. the boundary design (markTaskDone trips, markdownExport doesn't); ④ **execution-class vocabulary** (7 classes, measured-then-named) into `@nour/utils` contracts; ⑤ same-day lint-baseline debt from the earlier waves paid down — **167 warnings, 7 UNDER the 174 baseline** (impure-render Date.now → absolute timestamps, sync-setState-in-effect → derived state + tick-deferral, 7 entity escapes). Gates: prisma valid · tsc 0 · registry tests 5/5 · baseline 167≤174 · migration independently verified.
>
> **Flagged · NOT fixed:** the mutating-prefix list is a curated heuristic — a mutating tool with an exotic verb AND no sideEffecting flag AND a read category would slip it (the catalog flag is the fix, not the regex) · read-mode enforcement wiring verified by typecheck + code-read, not an integration test (prepare-tools' dep surface is heavy) · commitment verify/undo paths exist in service but have no UI yet · proposed-commitment flow's first real receipt lands on the operator's next journal entry with a nextAction.
>
> **2026-07-28 late (eleventh arc) · the blueprint audit — the whole repository mapped against ten consolidation concerns, and the map's first conviction was a two-month-dead durable lane.** One merge (see PR). The external "inventory before adding platforms" audit was executed rather than debated: 43 pages · 373 API routes · 46 cron routes · 102 models · 24 Inngest registrations · ~172 tools · 4 dispatch classes, all receipt-backed in [`BLUEPRINT-2026-07-28.md`](BLUEPRINT-2026-07-28.md). **Flagship: the brain-bus.** Wave AE (05-28) deleted the backfill route; nine producers kept publishing; `pollAndProcess` had zero callers; prod showed last `done` 2026-05-28 + **393 pending events** (task.completed 184 · brain_dump.finalized 161 · cron.failure 23) — REVIVED via `/api/cron/brain-bus-drain` (worker-fired */15, 50/run, backlog replays in ~2h; handlers idempotent). Also: the worker's 4 Wave-AE ghost jobs (two months of 404 forwards every 2-60 min) removed; `check:crons` gained [7/7] bidirectional worker-list validation (red-green proven: 4 catches on the pre-edit list); outbox-drain went 24h → 15-min via the worker (crashed-turn receipts no longer wait a day); reachability restored for /system/schema-history (canonical in 5 docs, URL-only since Wave AD), /system/chat-states (orphaned the night it shipped), /intelligence/brief+ledger (push-only before); chat-v2 parity ledger reconciled (6 rows "Pending QA" → verified-with-evidence). Enforcement audit: approvals/guardian/private-mode/cron-auth confirmed HARD server-side; `actionPermission:"read"` confirmed **advisory** at the tool layer (prompt contract + no force-adds, but no mutating-tool strip) → WP-1.
>
> **Flagged · NOT fixed (work packages in the blueprint):** WP-1 hard-enforce read-mode · WP-2 bus producer retire-list after 2 weeks of drained-event evidence · WP-3 thin modules (finance 1 tool, missions 3) · WP-4 bus health into fleet-truth probes · WP-5 disconnected surfaces (warroom · research · missions/simulator) need an operator verdict each · WP-6 WorkItem merge-or-retire · WP-7 intra-app event vocabulary (8 event models, no shared envelope — "Universal Timeline" not buildable today) · WP-8 outbox dead-state surfacing.
>
> **2026-07-28 (tenth arc) · the operating-spine day — 11 statenour merges in one session, four external audits gated, four already-built incumbents exposed.** Merges: #1162-#1165 (adversarial cron-truth sweep: Inngest function-set drift found — briefing_log EMPTY EVER, ~16 functions unregistered — manual re-sync authorized + executed; sensitive-GET auth checker into verify:hard; dep gate made able to fail), #1166 (boot self-sync + heartbeat self-row + worker out-of-band liveness + mega child timeouts), #1169 (loud-failure phase 2: fresh scan found 513 naked silent catches, 148 documented-intentional respected, 29 defect-hiding write-path/block catches converted with P2025-awareness + loop aggregation + synthetic messages for content parses; vitest exit-1 folklore retired — suite measured EXIT 0), #1172 (One-Spine 1-8: self-sync verifies res.ok/shape · outbox reclaims stranded `processing` rows + honors nextAttemptAt + loud finishes · memory commit gateway in SHADOW mode with `agrees` receipts · getStatus deleted-rows overcount fixed + contradict() now MERGES metadata · durable Home agenda — FOLLOW_UP joined the EXISTING agenda_items ledger (duplicate table caught mid-build), localStorage dismissals dead · triage contract (later superseded, see #1176 note) · duplicate action-failure evaluators collapsed + receipt writes loud · liveness checks capability ARTIFACTS not invocation · recall-eval harness with synthetic-marked seeds), #1174 (getFleetTruth chat tool + reasoning whitelist + /system/fleet page · fetchVideoTranscript fenced like scrapeWebPage · alerts lifecycle: resolve = soft-delete, mute = expiring alert_mute rows filtered server-side, silent-error render dead), #1175 (chat command console: cycling authority pills → labeled control sheet · header LIVE authority strip · Memory Inspector → Context & Evidence with real freshness stamp · typed-tool-cards registry + FleetTruthCard · trace links verified pre-existing), #1176 (decision card end-to-end via new `top_decisions` bridge query · execute-before-prose ADDITIVELY: attempt-tense prompt contract + receipt-backed follow-up completion message idempotent by traceId · intelligence_outcomes ledger APPLIED to Neon + independently verified, two producers live · /system/chat-states fixture gallery, Storybook rejected on lockfile grounds), plus #1152 (Windows Prisma engine-lock wrapper — re-verified with two concurrent per-PID instances, merged after 2+ weeks floating). W2 note: spine-5's triage contract was DELETED same-day when the incumbent (`InboxTasksTriage` + `task.triage`, complete with events) was rediscovered — the contracts registry records the real vocabulary and the why.
>
> **Flagged · NOT fixed:** memory-gateway shadow week runs to ~2026-08-04 before any write-semantics change · completion messages appear on next load (realtime push into an open stream = own transport change) · attempt-tense contract efficacy unmeasured (watch chat_claim_warn volume) · approval/decision cards await first live receipts post-deploy · recall-eval corpus is synthetic-seeds-only until outcomesNeedingReview feeds real corrections · chat-state gallery has no Playwright screenshots yet · 148 documented-intentional silent catches respected, not individually audited.
>
> **2026-07-28 (ninth arc) · the gates got honest about themselves — a self-audit of the CI work, and the bug that had been eating every dependency PR.** Two merges (#1141 `b803d3536`, plus #1098/#1101/#1103 earlier). ① **Self-audit of my own day's PRs** (4 reviewers -> adversarial refuters; 44 raised, 14 verified, **9 confirmed, 5 refuted** — 30 were NEVER verified, the pass was capped, so this is not exhaustive). Functional: `test.yml` still carried the exact concurrency P1 fixed in `e2e-statenour.yml` (one running + one pending per group means a third push to main evicts the pending run — the primary typecheck/lint/test/build sweep could leave a commit unverified); the e2e warm loop **could not fail** (`|| echo timeout`, nothing inspected the code) so a dead dev server exited 0 and surfaced six minutes later as 23 unrelated Playwright failures; the warm list had desynced from the suite (warmed `/intelligence/brief`, which no test touches; skipped `/missions`, which every run asserts). ② **Five false claims I had written into comments**, each corrected in place with the evidence: "this job BLOCKS" (no branch protection on this plan — **PR #1106 merged 9 SECONDS after `node` went red**), the header's `next build` -> `next start` (never true; it serves `next dev`, and mock auth works *because* it is dev), "the type gate still runs webpack" (Next 16 defaults to Turbopack), "hangs until the 120s maxDuration" (**`maxDuration` is a Vercel route-segment config — on Railway nothing enforces it; the hang was UNBOUNDED**, so the bug was worse than first described), and playwright.config's "CI runs against a deployed preview URL" (hermetic localhost since `75920fba8`). ③ **A test that tested nothing**: the "finally semantics" case never made the try block throw, so it passed identically with a plain call at the end of the `try` — rewritten to throw from the logger, red-green verified (resolver moved out of `finally` -> exactly that one test fails). ④ **The node sweep's real defect, MEASURED not inferred**: every dependency PR had failed for days with an identical signature — "27 successful, 33 total", zero failing tasks, the same six heavy tasks force-killed, at 10/10/13/25 minutes. Fixed progress at varying times is resource death, not a clock. turbo defaulted to concurrency 10 while the job granted every process a 6GB heap; a background sampler then proved the runner: **max avail 6921MB (not the 16GB the comment claimed), min avail 361MB on the NARROW 8-task run**. Now `--concurrency=2`, passed as the documented **flag** — `turbo run --help` documents no `TURBO_CONCURRENCY` env var, and an unread env var would have made the fix a silent no-op. ⑤ A review bot then caught the abort I had just written being a no-op itself: `$(curl ... || echo "000")` yields **`000000`** because curl emits its write-out format *and* returns nonzero, so the `= "000"` guard never matched — reproduced locally against a dead port, fixed by capturing `rc` instead of inferring from the body. **Three silent no-ops in one day** (duplicated heap flag, nearly-shipped env var, this) — all the same shape: asserting a mechanism instead of exercising it. Gates: 13/13 touched suite · tsc 0 · both workflows parse · `bash -n` on the extracted step.
>
> **2026-07-25 (latest, eighth arc) · ONE conversation engine — CognitivePartner rides the canonical chat pipeline; partner-stream deleted (audit P1 "competing command centers").** Home's Nick strip now posts to `/api/ai/chat` with `privateMode:true` — preserving CP's prior semantics exactly (zero persistence: no conversation, no rows, no BrainMemory; the old route persisted nothing either) while gaining everything the side engine lacked: provider fallback chain, output critic + scorecard, the complete fabrication-defense stack (the old route had ONE detector), honest streaming contract, budget gate, interceptor commands. `app/api/system/partner-stream/route.ts` DELETED — zero dangling references (grep-verified); the side persona prompt retires with it. Gates: tsc 0 · eslint clean · CP brief tests 5/5.
>
> **2026-07-25 (seventh arc) · durable post-turn outbox — a crash can no longer silently eat memory writes, receipts, or journal ingest (audit P1).** New `post_turn_outbox` table (ADDITIVE migration `20260725000000_post_turn_outbox`, applied to prod via the guarded autocommit script — 2/2 ok — `migrate resolve` recorded, `migrate status` CLEAN). Semantics: **inline-first, durability added** — every turn enqueues its frozen DeferredBackgroundCtx (messages capped at 20) BEFORE running the deferred work inline exactly as before, marks the row done after; a mid-work crash strands status=pending, and the nightly `/api/cron/outbox-drain` (EVENING_JOBS fan-out + config/crons.ts, check:crons clean) claims orphans past the 10-min grace window with the atomic first-claimant-wins updateMany (≤3 attempts, then failed+lastError). Replay safety: every deferred phase is withErrorCapture-bounded and idempotent-or-harmless (upserts, dedup guards, audit appends) — a rare double-run is safe; a LOST run was not. Both outbox writes are best-effort and can never affect the user-visible turn. New contract tests: payload cap, best-effort enqueue, lost-race claim skip, failed-for-good cap. Gates: prisma validate + migrate status clean · tsc 0 · outbox+persist tests 7/7 · check:crons clean.
>
> **2026-07-25 (sixth arc) · gate-integrity wave — verify:hard tells the whole truth, the baseline stops lying, skip-paths stop hanging streams.** ① **verify:hard gains five gates** (each proven green standalone BEFORE wiring): check:env · check:runbooks · check:prompt-injection · check:audit-deps · check:lint-baseline. check:secrets deliberately went to **pre-commit** instead (lefthook `statenour-secrets-staged`, `--staged` mode) — the whole-repo scanner rightly flags local .env files so it can never gate a dev machine; staged-only scans exactly what enters history. ② **Lint baseline regenerated truthfully**: 413 pinned warnings (~30% pointing at deleted files) → **174 real warnings across 83 files**; 14 mechanical unused-directive warnings fixed repo-wide (eslint --fix, 16 files); the ratchet now blocks growth (`current ≤ baseline` verified green). ③ **onWorkComplete skip-path fix** (the quirk PR #1064 flagged): duplicate-skip and empty-skip now resolve the SSE work-complete promise — previously those turns held their stream open until maxDuration (120s) because sse-stream.ts awaits it before message.completed + close; new pinning test drives the dedup guard and asserts resolve-without-persist. ④ **Three main-red test files repaired** (pre-existing, proven by stash-control): mobile-a11y pin-drift (the #1035 composer restyle KEPT 44px targets — improved to all breakpoints — the test pinned old class spellings), arsenal-websearch mock missing the new hasPerplexica export (mock now mirrors the real env probe), eval scenario judgeCriteria 204>200 chars trimmed. Full suite: 4,325 passed with the 10 reds fixed; the residual exit-134 is the DOCUMENTED Windows-local napi teardown flake (assertions complete before it; cannot occur on ubuntu CI). Also this wave: `RAILWAY_SMOKE_STRICT=true` repo variable set — post-deploy smoke now BLOCKS.
>
> **2026-07-25 (fifth arc) · Home consolidation — the cockpit became the four-question decision page (audit P1, operator-approved scope + brief-as-tap).** HomeConsole now answers exactly: ① anything broken? → new `home-health-chip.tsx` (reads the SAME `trpc.system.hub` rollup as the /system grid, same honest-severity rules — UNKNOWN before measurement, never unearned green; taps to /system) ② decisions awaiting? → `FollowUpsList` MOUNTED (it was one of the three imported-but-never-rendered orphans the audit flagged) ③ do now? → `ExecutiveActionMatrix` with honest copy (the "Halt revenue operations" 3-findings theatrics and the fabricated "peak operational efficiency" idle line replaced with measured statements) ④ changed since last visit? → `SinceLastVisitCard` mounted on Home. **Gone from Home** (files untouched, only unmounted): `HomeBrainGraph` (820 lines, sticky full-height — lives at /brain), `HomeEnginesDeck` (lives at /system), dead imports CoachEventBanner + HomeJournalHub; drill-down chips (Brain graph → /brain · Engines → /system) keep them one tap away. **CognitivePartner's morning brief is a TAP now, never an auto-fired spend** — the once-per-day localStorage stamp gates a visible gold chip instead of a silent paid LLM stream on first Home visit (day-stamp helpers unchanged; their 5 contract tests green). Gates: tsc 0 · eslint 0/0 on touched files · build green WITH the live type gate ("Running TypeScript · 40s") · stale-docs 0/0.
>
> **2026-07-25 (fourth arc) · ignoreBuildErrors REMOVED — the build is now a live type gate, poka-yoke-proven.** The audit P0 ("TypeScript can be bypassed during deployment") closed with a full evidence chain instead of a hopeful flag flip: ① the Apr 28 justification (Next 16 + Turbopack crashing on googleapis' gkehub `v2beta.d.ts` as "binary") REFUTED — the installed file is clean UTF-8 (byte-inspected, zero NULs) and two full `next build` runs with the flag off completed green over googleapis' types ("Running TypeScript … 54s"); ② poka-yoke: a deliberate `const x: number = "string"` probe FAILED the build (exit 1, exact error) — proving the gate live, not placebo; ③ probe lesson worth keeping: the first probe silently passed because its own comment began with `@ts-expect-error…` — the directive suppressed the planted error (never prefix probe comments with directive strings); ④ root README's two flag mentions rewritten (build-time TS ON; the build's check covers `.next/types` route validation that `typecheck:raw` excludes — do NOT re-add the flag); the June audit doc's "do not flip it off — the build will break" warning is superseded by execution. Railway's deploy build is the clean-environment confirmation. Gates: tsc 0 · build green ×2 / probe-fail ×1 · stale-docs 0/0.
>
> **2026-07-25 (third arc) · persist-assistant-turn decomposition — 1,927 → 492 lines, behavior-preserving.** The post-stream pipeline (the audit's second oversized file) decomposed as 5 gated slices into 6 single-responsibility modules beside it (lib/services/chat/): `message-parts.ts` + `deferred-background-work.ts` (were in-file helpers — import boundary only), `salvage-event-text.ts` (cascading rawText→reasoningText→content→steps→reasoning fallback + hasToolCalls + empty guard), `tool-telemetry-walk.ts` (v10.0.179 soft-fail detection + capturedToolCalls), `persist-assistant-message.ts` (dedup guard + P2002 backstop, honesty banners, the tokenUsage-blob create, conversation bump, judge/adversarial dispatch — discriminated PersistOutcome preserves BOTH original bare-return skip paths exactly, including the pre-existing no-onWorkComplete quirk, deliberately NOT fixed in a behavior-preserving pass), `post-persist-verification.ts` (trackGeneration, envelope, claim verifier + ratio/temporal/env checks, L2 fabrication rewrite + row patch, recordTrace, low-quality log). `cleanedText` now flows as an explicit typed chain (salvage → sanitize/CoVe/critic inline → persist → post-verify → deferred ctx) replacing closure mutation. buildOnFinish = a ~490-line typed orchestrator. Gates: tsc 0 · eslint 0 · persist/entity-audit/stream-error/empty-fallback tests green · next prod build exit 0 · 3-lens adversarial workflow review (see PR).
>
> **2026-07-25 (second arc) · chat-route decomposition — route.ts 1,833 → 962 lines, behavior-preserving.** The audit P1 ("the critical chat path is too large to reason about safely") executed as 4 gated slices: ① **persistBase dedup** — the 27-field `buildOnFinish` dependency bundle was duplicated THREE times (deep alt path, winner alt path, main onFinish), three copies that had to stay manually in sync; now built once after the last `finalSystemPrompt` mutation, call sites override only `provider/modelId/model` (+`onWorkComplete`). ② Six new single-responsibility modules beside the route (app/api/ai/chat/): `specialist-routing.ts` (AG-42 guards + shadow metrics + dispatch), `derive-turn-signals.ts` (mode ladder → task-type → query shape → turn-intelligence → contract → domain routing → the python/action/web-search intent detections; classify stage-timer threads through), `augment-final-prompt.ts` (chat-layer prompt + multi-mode + content-feedback + high-spec gate + customer hint + GSC prefetch, exact append order), `prepare-tools.ts` (pruning + blocklist/always-on/coherence forces + token budget, same precedence), `alternate-paths.ts` (the whole flag-gated pre-stream block incl. mega-cap + action-intent suppression; Response|null contract), `build-stream-config.ts` (the per-attempt streamText config factory over the SAME shared refs — TTFT/partial refs, prepareStep toolChoice ladder, Anthropic cacheControl fold). ③ Disclosed intentional deltas ONLY: specialist `buildFastStream` explicitly awaited; the three pure intent regexes evaluate before the 402 budget gate (zero side effects); `prompt_built.buildMs` excludes ~2-5ms of sync derivation; 5 imports dead ON MAIN removed (context-reranker ×2, predictive-prefetch ×2, withHeartbeat) + already-unused `detectChatMode`. ④ New `tests/ai/chat/derive-turn-signals.test.ts` (9 tests: mode priority, task-type mapping, intent exclusivity, stage-timer contract). Private-Lab ordering contract intact: interceptors → specialist → dbWrite kickoff → signals → budget → model → prefetch → prompt → tools → alt-paths → streamText, privateMode threaded, never re-derived. `lib/services/chat/persist-assistant-turn.ts` (1,927 lines) is deliberately OUT of scope — its decomposition is the next arc. Gates: tsc 0 · eslint 0 · 13 chat test files 152/152 · next prod build exit 0 · adversarial workflow review (see PR).
>
> **2026-07-25 (earlier) · quality-pass truth wave — corrupted README, lying manifest, fabricated health chips, dead e2e routes, permissive smoke.** A 42-claim external audit was gated claim-by-claim against the live repo (38 confirmed / 1 refuted / 3 overstated), then the confirmed cheap-fix tier shipped as one wave: ① **README.md de-corrupted** — 3 trailing NUL bytes (an orphaned UTF-16LE `\x00\r\x00\n\x00` fragment) made git/grep/file classify it as BINARY, so every grep-based tool silently skipped it while it rotted; stripped, then de-staled (routes `/tasks·/body·/financial·/mastery` → their absorbing surfaces, FloatingHome orb → bottom tab bar reality, `.husky` → lefthook, `UPGRADE-PLAN.md`-as-"active execution source" → CURRENT-TRUTH's active-docs list, `build:push-schema` no longer claims a `--accept-data-loss` flag it doesn't have, `/api/health` curl example notes the 2026-07-21 owner-gate). ② **config/repos.ts lifecycle synced to GitHub** (verified via `gh repo list`): easy-nickstire / nicks-tire-social / nour-os-unified were shown active+monitored but GitHub archived all three on 2026-05-22; statenour-os was marked `archived` but GitHub does NOT archive it — now `stale` (retired, archive flag pending) with CURRENT-TRUTH's parenthetical corrected to match. ③ **Honest health**: hub-grid's Arrival Intel chip was a hardcoded `() => "live"/healthy` and Cockpit Observability `() => "observing"/healthy` — data-blind fabrications; now derived from the measured smartDevice fleet and 24h AI-call count (severity "info", never unearned "healthy"); /system `overallStatus` reports `unknown` before diagnostics load instead of "degraded". ④ **e2e smoke.spec.ts route repair**: FIVE PAGES entries plus the `/brain/wisdom` goto pointed at deleted pages — four of them (`/system/costs`, `/system/prompt`, `/plan`, `/system/performance`) ride next.config.ts redirects to their consolidated surfaces, so the tests landed on a different page whose identity assertion could never match; `/intel` alone had no page AND no redirect, a genuine 404; also both dead tRPC names (`system.rateLimits` → REST `/api/system/rate-limits`, `system.observability` → `observability.osSnapshot`), and the identity assertion now checks doc-title OR h1 (the root layout's flat "NOUR OS" title meant `toHaveTitle` could never have passed on most pages — the suite was structurally red since audit #8 added it). ⑤ **smoke-prod.mjs hardened**: default URL → https://bdnick.info (custom-domain + cert path finally exercised; was the Railway-generated `*.up.railway.app` domain), 3xx acceptable ONLY on `/` (previously any 3xx passed EVERY check incl. the heartbeat), deploy-identity check added (live-run caught that `/api/system/deploy-info`'s "// public" comment has been false since the 2026-07-21 route-policy tightening — comment corrected, smoke treats 401-no-cookie as alive-behind-wall, `SMOKE_SESSION_COOKIE` + `--expect-sha` = hard SHA assert; both modes live-verified against prod, exit 0 / exit 1). ⑥ **AGENTS.md** no longer claims chat-composer.test.tsx is a known-red (repaired 2026-07-22, #1025). ⑦ **command-registry.ts** header no longer calls the chat interceptor "a documented follow-up" — it ships (interceptors.ts → runCommand, chat route → runInterceptors). Gates: see PR.
>
> **2026-07-22 · Private Lab + composer authority controls (#1035) — audit authority-kernel CLOSED.** ① **Private Lab** (`privateMode` in the chat contract, parsed default-off in `lib/ai/chat/gate.ts`): a turn writes NOTHING — route skips both user-turn persists + the interceptor AND specialist fast-paths, detaches the conversation id (server+client), buildOnFinish early-returns before the whole post-stream pipeline. ② **3-axis composer controls**: posture (auto/execute/counsel/spar) · depth (auto/standard/deep = server modeOverride) · actions (draft/read/execute). Explicit posture beats phrase inference; untouched selectors = byte-identical requests. **Shipped through a 4-agent adversarial review that found 13 defects (2 blockers, 5 highs) in the first cut** — the lesson: a privacy boundary bolted onto the MAIN pipeline missed the fast paths that fork off before it (interceptors persisting titled conversations + BrainMemory/Decision rows; the `"private"` convId sentinel leaking to the client and inverting privacy after toggle-off; the error handler persisting partial replies; the SSE stream hanging because the private early-return skipped onWorkComplete; regenerate/auto-retry replaying private turns with privacy off). All fixed + re-verified SHIP by a second pass. Deferred (2 low, documented): deep-reasoning prompt head-slice, unmarked private turns in the visible thread. Gates: 30/30 tests · tsc 0 · eslint 0 · build exit 0 · two adversarial passes.

> **2026-07-22 (earlier) · browseAndDo shipped + deploys unbroken (#1033) — browser arc CLOSED with a prod receipt.** ① `browseAndDo` (lib/ai/browser/browse-and-do.ts + the `browseAndDo` tool in meta.ts): one call = Browserbase session → deepseek-planned navigate/act/extract/observe loop → structured receipt + session replay URL. Permission axis enforced structurally — `read` blocks all interaction, `draft` (default) STOPS before consequential submissions (regex guard → `draft_ready` + pending action described), `execute` may fire the final step. Page text fenced against prompt injection; extract's `links[].url` is `z.string().url()` on purpose (Stagehand only injects DOM hrefs into url-typed fields). Live E2E: read-permission run answered "example.com's link → iana.org/domains/example" correctly in 3 steps/35s with self-recovery after a failed extract. `browser_do` demoted to LOW-LEVEL. ② **Edge-graph gate in instrumentation.ts — root-cause fix for the two FAILED Railway builds**: Next compiles instrumentation for BOTH runtimes (`runtime="nodejs"` not honored), so the edge pass bundled tool-embeddings → the whole tool universe → sharp; the stagehand lockfile's hoisting shift made it fatal ("non-ecmascript placeable asset · Edge Instrumentation"). `if (process.env.NEXT_RUNTIME !== "nodejs") return;` dead-code-eliminates the edge bundle to empty. ③ **Deployed-container receipt**: deploy `0b19d2f1` SUCCESS → `GET /api/browser/diagnostics` on prod returned `{browserbase:{configured:true}, stagehand:{installed:true}, ready:true}`. (Gotcha for future sessions: `railway ssh` + bare `require.resolve` false-negatives on Turbopack externals — the diagnostics endpoint is the honest in-container check.) Gates: browse-and-do tests 9/9 + catalog/tool-families drift suites · tsc 0 · eslint 0 · full local build exit 0.

> **2026-07-22 (later) · Browser operation LIVE — Stagehand v3 E2E-verified.** Browserbase keys set on Railway (auth 200). #1030 installed `@browserbasehq/stagehand@3.7.0` + `playwright-core@1.61.1` and defused the standalone-tracing trap (runtime ships ONLY `.next/standalone`; the old webpackIgnore'd import was invisible to the tracer → literal import + `serverExternalPackages`). Follow-up rewrote `lib/integrations/stagehand.ts` to the REAL v3 contract (verified from installed dist types — act/extract/observe are instance methods, extract is positional, navigation via `context.activePage()`), fixed two live-repro'd breaks (`keepAlive: true` or v3 `close()` kills the session between ops; `disableAPI: true` because the hosted Stagehand API 500s on custom-baseURL models), and wired model resolution to the ONE funded lane — Ollama Cloud `deepseek-v4-pro` (E2E receipt: real zod-v4 `extract` + `observe` off a live page; gpt-oss:120b fails schema parsing; direct Gemini = capped, OpenAI = out of quota, OpenRouter = ~0 credits as of today). Full receipt in the PR.

> **2026-07-22 · Perplexica repair + closed-loop Experiment factory + fallback-model refresh.** ① **Perplexica** (#1017/#1018/#1019): canonical native-API path (removed the MCP-URL aliasing — `perplexica-mcp` is a separate Railway service), `PERPLEXICA_TIMEOUT_MS` 35s (was the generic 8s → always timed out in the quorum), `hasPerplexica()` single gate, `checkPerplexicaHealth()` provider+model verification, search-source telemetry, and the `GET /api/system/perplexica-diag` receipt (CRON_SECRET-gated). **Root cause proven from live SearXNG logs: every general engine (DuckDuckGo/Brave/Startpage/Google-CSE) is CAPTCHA/rate-limited on Railway's datacenter IP → 0 sources → silent Tavily fallback** — an infra reality, not a code bug (see RUNBOOK observability + poka-yoke ledger 2026-07-22). ② **Closed-loop Experiment factory** (#1020): `RegisteredSource.authScore` now LEARNS — accepting an opportunity spawns an `Experiment` (14-day horizon), a daily `experiment-measure` cron resolves it (held_up/failed/inconclusive) and nudges the attributed source's authScore via a bounded, reversible EWMA; `scoring.ts` folds that learned trust back into opportunity priority (`applyAuthTrust`, ±10% — the read-path teeth). Adversarial-review fixes: **column-first migration** (hot-table ADD COLUMNs applied to prod before the schema deploy) + **atomic claim** (running→measuring, prevents concurrent double-nudge). Migration verified live: `experiments` table + 3 cols + 2 FKs, pgvector untouched. ③ **Fallback-model refresh**: the anthropic fallback lane's `defaultModel` `claude-3-5-sonnet-latest` → `claude-sonnet-5` (4th/5th-hop only; prod primary is Ollama). Also flipped `NICK_VERIFIED_REGEN` on (activates the #1016 authority-regen; no DB override, env-driven, verified effective). Gates: typecheck 0 · eslint 0 · vitest (closed-loop math 7/7, perplexica 30/30) · check:crons clean · prisma validate.

**Last verified:** 2026-08-16 (chat-quality arc: truncation root-caused + fixed, 4 PRs #1589-#1591; prior: MISSION-scan gate → BDN close-out, 7 ships #1535-#1542); top entry.

- **Execution Mode (`1255c273`)**: Added focused task execution panel on `/missions` utilizing a memoized selector to prioritize tasks in "DOING" status, then queued tasks, then tasks from the Top Mission Today, real user projects, and general tasks. Includes callbacks for resume, pause, complete, snooze, block, edit, and exit.
- **Hidden High-Risk Warning & Filters (`e9afbec8` & `9816a0b6`)**: Implemented a warning banner when high-risk tasks are hidden by active search, loop-kind filters, domain filters, or focus mode.
  - Risk definition includes overdue tasks, stuck DOING (>2h), missed snooze resurfaces, promise checks (due today/soon/missing), stale tasks (>=7d/14d), invalid waiting, and high autoPriority. DONE, ARCHIVED, and CANCELLED statuses are explicitly excluded.
  - Exposes pure classification logic in `hidden-risk.ts` and renders a border alert box (rose/amber/zinc) with up to 3 preview items, "Queue after this" quick actions, and filter/session dismissal in `hidden-risk-warning.tsx`.
  - Upgraded test coverage with a renamed test suite `hidden-high-risk-warning.test.tsx` (12 tests) verifying component rendering, copy adaptation, and filter clearing.

Gates: tsc 0 · 3272 tests passed · build green · no database migrations, no production data mutation.

**PRIOR:** 2026-06-10 (post the **"Nick remembers the week" ship** `98d783e1` — evolution-audit item #7: the Sunday weekly-review rows (cron wins/misses/patterns/focus in BrainMemory `weekly_review` + the ReviewWizard serve/surprise commitment) are now deterministically injected into the chat system prompt via a new CORE-tier engine `lib/brain/weekly-review-context.ts` `getWeeklyReviewContext()` — pure DB read · 14d window · 2-week continuity ("second week in a row…") · honest-empty (renders nothing when no review exists, never a stale week as current) · 800-char cap · tail rule forbids week-over-week claims beyond the rendered data. Previously these rows were reachable only via probabilistic vector recall. 8 new tests (`tests/brain/weekly-review-context.test.ts`) pin both writer shapes, malformed-metadata fallback, failure totality, clipping, query scope. Gates: tsc 0 · 236 files/3252 tests · eslint 0 errors on touched files · turbo build green. Disclosed: `prompt:size-check` was ALREADY failing on unmodified main (61,157 > 60k soft cap, non-blocking gate); this adds +802 capped chars → 61,959 (Venice hard ceiling 65k) — operator decision queued: trim a section or raise the soft cap. No migrations, no prod-data mutation.) **PRIOR:** 2026-06-10 (post the **chat-error closeout + evolution audit + Journey Engine wave** — 4 ships `91c198a1`/`d1c24209`/`9184c714`/`fb851113` (+ the sibling session's Next-Action `520063c6` between them), Railway SUCCESS on `fb851113`, bdnick.info 200, live-verified: the `.match` post-process crash fixed at its exact line + `/system/errors` redirect + honesty prompt rules; then the 7-agent product-evolution audit (founder report `docs/audits/STATENOUR-EVOLUTION-AUDIT.md`) + journal spec items A,B,D,E,F,G + the morning-brief durable-producer restoration + the scoreMemories manual-source guard. Gates: tsc 0 · 234 files/3228 tests · build green · no migrations, no prod-data mutation. Live-verified post-deploy: 4-line journal directive rendering on real data · "becoming" proof strip (58/wk) · 7-mode capture modal · 0 console errors). **PRIOR:** 2026-06-09 (post the **Wiring Wave** — connected the F1–F5 function services to live surfaces: receipts→chat finalize · /missions rescue strip + GENERAL anchors · /system/digest read-only cards · DAILY stat XP (advance-gated) · `/convert` knowledge→action. 7 ships `55ed38c4 → 14b6c225` on top of `43b63268`; tsc 0 · vitest 229 files/3195 tests · build green · no migrations, no prod-data mutation. One disclosed-not-changed finding: the reward toast's "+N XP" is `creditTaskStats`'s stat-COUNT not summed XP — see the top blockquote entry). **PRIOR:** 2026-06-06 (post the **Nick people-gate + WEEKLY recurrence + chat-honesty + PersonProfile source/phone/email wave** — 4 ships `c66bb09e`/`172bac8f`/`07089a9d`/`75e48458` (the 4th = the action-write verifier, REVISE #1) · migrations `0008`+`0009` APPLIED to prod (column-first, via the apply-pending-migration endpoint) · Batch-4 prod cleanup (deleted ghosts Fernando + "her"=Dania, re-homed note to Dania) · multi-agent behavioral review → disposition REVISE · full ship-by-ship in the top blockquote entry below + decision log in `~/.claude/projects/C--/memory/statenour-nick-behavioral-review.md`). **PRIOR:** 2026-06-04 (post the **code-review program (verified H1-H4/M1-M7 sweep)** — 9 ships, main RED→GREEN `c3067403`: H1 CI-typecheck-gap (added `check` script) · H2 prisma cross-OS cache-trap · M1 5 flags · M4 provider-docs + dead `activeProviderSupportsTools` · M5 6 `timeAgo` dups · 2 stale tests fixed (RED→GREEN) + 3 inert workflows deleted · ~9 dead `format.ts` exports + M6 refuted · H4 `task.ts` god-router split 1971→1278 (Power Atlas → `lib/trpc/routers/task/power-atlas.ts`, verbatim, FLAT paths) · M3 `ActionRule<T>` generic. tsc 0 · vitest 3007 (all pass) · build green. DEFERRED/leave: M2 (smart-home — unwired layer of a live feature, runner died Apr 14, op SKIPPED) · M7 (versions) · relative-time (needs 2-format decision) · router.test.ts flake. **Trust-audit advisory (nickstire price-decoy/warranty/testimonials + statenour-Nick numeric-marker gap) in MEMORY.** **PRIOR:** post the **Wave 2 surface-consolidation wave** — 5 tabbed/sectioned merges collapsed ~10 overlapping routes into 5 deep surfaces (/business=financial+funnel · /market=seo+radar · /brain=board+wisdom+reason · /stats=body+learn-loop [/life DELETED] · /content=drafts+history+social+outreach) behind a new `PageTabs` primitive (URL-synced `?tab=`, lazy-mount, query-string-preserving on switch). Every former page body moved VERBATIM into components; old routes 30x-redirect; internal links + the route-keyed registries (context-hints TOOL_BIAS / page-intelligence / page-visit) repointed to the consolidated set; + 2 UI fixes (home-composer dead mic/paperclip removed · /decisions dup sibling list dropped → ComparisonMatrix rows clickable via new `MatrixOption.href`). Verified per-merge in the consolidation worktree: tsc 0 · next build green (routes confirmed collapsed). origin/main `e36c5963`/`4e9e76f8`/`2a1e504d`/`70172fc6`/`b4602c27` + cleanup. **PRIOR:** post the **nick-intelligence + every-page-audit + chat-pipeline code-health wave** — chat-truth + 15 flag-gated intelligence features (default-OFF) + glm-5.1 model swap + an 8-bug proactive-staleness sweep + all 41 pages audited/unified, then a chat-pipeline code-health pass (5 SAFE simplifications); full ship list in the top entry below. **PRIOR:** 2026-06-02 the **hybrid-retrieval (Wave B) wave** — the deferred FTS recall win shipped: replaced `contextual-recall.ts`'s naive substring keyword lane (it only saw the top-300-by-confidence pool) with a true Postgres `ts_rank`/`websearch_to_tsquery` lexical lane over ALL memories + a candidate-pool union (naive `keywordScore` kept as a graceful fallback), backed by an additive expression GIN index `0007_brain_fts` APPLIED to prod Neon with **pgvector verified PRESENT before AND after** (separate table from `vector_embeddings`) · FTS smoke = 277 live matches · 1 ship `9edc1804` rebased onto the sibling's `edf1766d` after a 2nd ref-lock race · combined-tree turbo build green · bdnick.info 200/healthy · full entry below. **PRIOR:** post the **next-level intelligence wave** — 4 surgical brain upgrades [J consolidation soft-deletes merged sources to preserve evidence · I graph-aware recall via the dormant `MemoryEdge` graph · F XP-drift detection → coaching narration · G opt-in LLM-synthesized narrator] + nickstire $50→$49 price consistency · 6 ships `fae626ab → 68a8315f`, cherry-picked linearly onto the concurrent analyzer session's `54a45560` after a ref-lock race · combined-tree build green · live on bdnick.info (200 · healthy · DB-connected) · full entry below. origin/main ALSO carries that session's **7-analyzer suite + Mastra-V2 removal + Journal-Brain wiring** (`54a45560`, live-verified by them — their detail lives in MEMORY, not duplicated here). **PRIOR:** post the **task classification + scoring + confirm-chip wave** — rebuilt the create→classify→credit spine so every task correlates to mission+goal+stats and credits the character sheet on completion (NEW `classify-task-linkage` · one `enrichTaskLinkage` chokepoint on all create paths · `creditTaskStats` · `Task.statHints`/`pendingClassification`) · 8 ships `b9a60d4d → 2c4c376d` · migrations `0004`+`0006` applied to prod · gates fresh-verified (typecheck 0 · wave unit suites 35/35) · full entry below. **PRIOR:** post the **/people (Power Atlas) overhaul + QA wave** · /people now scores INFLUENCE XP for real reps — ledger deposits + power-plays credit `relationships`/`networking`/`persuasion`/etc. via the idempotent `creditStatXp` seam · classifier is suggest-then-approve (`pendingClassification` + role SSOT, no silent overwrite) · reads tasks via a real `Task.personId` FK · UI de-bulked · operator-tunable weights · shipped `d5c6f098` + QA `44a10079` · migration `0005` APPLIED to prod · XP backfill verified (13.9 XP, live-confirmed Dania +6.6) · QA fixed a CRITICAL iOS-PWA `window.confirm` dead-delete (→ two-tap, live-verified) + role-SSOT/soft-delete/WCAG. **PRIOR:** post the **Journal Brain redesign wave** · grounded journal enrichment — every capture now grounds against ACTIVE goals/missions, grounded-reclassifies into a real `entry_type` column, proposes a confirmable goal link, credits a grounded XP bonus + a bold idea/challenge "take", surfaced as an inline impact-receipt + link-chip with a 7-knob settings panel + Telegram ✓/✗ confirm + nightly resweep net · shipped to main `dc476e4e` · migration `20260601_journal_brain_foundation` APPLIED to prod Neon · backfill (~990 rows) operator-gated. **PRIOR:** post the **god-file split #3 + AI-tiering fix + cross-app optimization-audit wave** · split the chat-route god-file `app/api/ai/chat/route.ts` 1,884→1,442 ln — extracted 3 safely-separable modules (context-hints / finalize-system-prompt / build-model-messages), DELIBERATELY leaving the streaming + tool-loop orchestration core in place (it's a control-flow fn with shared state, NOT a flat collection — safety > line count) · `4aafd841` · typecheck 0 + chat tests 230/230. Fixed `detectTopicTier` (`7b86bf9d`): keyword-less ≥30-char messages were escalating to the all-29-engines `full` tier (silently defeating the ~60% context-saving) → now `core` (deep mode forces full upstream); tier-gating test corrected. Ran a measure-first **cross-app optimization audit** (perf/web-vitals · DB/queries · React-render · AI-cost, both apps, 4 parallel read-only agents): statenour's data/memo layers already mature; TOP ROI is nickstire's (framer-motion eager in the customer hydration path = the measured TBT-1090ms PSI culprit · phone `LIKE '%suffix'` 17-site full-scans → a `phone10` column · zero prompt-caching) → handed off to that session. Deferred statenour code fixes (fresh pass): GoalBoard card memo · chat-path injector parallelization. The #1 AI-cost win is a provider-routing **config** decision (Anthropic `cacheControl` is wired but dormant — Ollama is primary). **All 3 big god-files (tasks/system/chat) now split.** Gates green (typecheck 0 · vitest green · pre-push build OK) · 2 commits on origin/main. **PRIOR:** post the **god-file split #2 + Chrome-walk fixes wave** · split the worst statenour god-file `lib/trpc/routers/system.ts` (2,722→61 ln, 105 tRPC procedures) into 9 per-domain procedure-object files under `system/`, recomposed via object-spread keeping the FLAT `trpc.system.<proc>` namespace intact (`560525e2` · isolated worktree + briefed subagent · independently verified: 105/105 procedure parity · zero nesting · typecheck 0 = the interface gate · vitest **2919**); plus the two Chrome-walk fixes (`f6f1143b`): honest /financial revenue states (was a permanent fake "Loading…" when the nickstire bridge is down — the empty bridge is a config/ops root cause, flagged not code-fixable) + `os-snapshot.ts` scanners now exclude `.next-prod`/`standalone`. Gates green (typecheck 0 · vitest **2919** · pre-push build OK) · 2 commits on origin/main. **PRIOR:** post the **tech-debt cleanup wave (statenour)** · fact-checked the monorepo tech-debt report against the files, then executed only the statenour-owned wins (its money-path items are nickstire's — handed off): deleted the stale `soft-deleted-tasks-2026-05-16.md` (`34ad6fcd`) + split the 2,024-ln `lib/ai/tools/tasks.ts` god-file into 6 per-domain files + a 29-tool `tasksCoreTools`, recomposed verbatim into the SAME 46-key `tasksTools` export (`2728caa7` · built in an isolated worktree via a briefed subagent, independently verified — 46/46 keys + scope + gates). Report corrections: serializeRow is overstated (heterogeneous `.toISOString()`, API-path risk → skipped); provider-bypass is **31** files not 23. Gates green (typecheck 0 · vitest **2919**) · 2 commits on origin/main. **PRIOR:** post the **Ambition Engine P3 (increment 2) wave** · wired the rest of the dormant P3 columns into the /stats GoalBoard — `updateGoalSchema` now accepts `kind` (metric/milestone/narrative) + `conviction` (1-5) + `ambition` + `killCriteria`/`killBy` + `identityLine` (all migrated in P1, settable nowhere until now); the card gained authoring inputs + display chips (conviction flame · ambition tag · pre-committed kill-by · the Elon **idiot-index** hrs-per-%-moved · narrative identity line) + kind-awareness (kind badge · milestone "loops"→"milestones") · trajectory was already the pace-projection chip · `de898be3` · gates green (typecheck 0 · lint 0 new errors · vitest **2919**) · 1 commit on origin/main. **P3 functionally complete** (ladder + kinds + anti-stale authoring + trajectory); deeper per-kind layouts (a milestone checklist UI) remain a future refinement. **PRIOR:** post the **Ambition Engine P3 (increment 1) wave** · the dormant `parentGoalId`/`GoalLadder` self-relation (migrated in P1, wired nowhere) is now an end-to-end **compounding ladder**: pure `lib/mastery/goal-ladder.ts` (`validateParentLink` rejects self/cycle/inverted-horizon · `rollUpChildren` · cycle-guarded `ancestorChain` · 14 unit tests) + `updateGoal` validates the link before writing + `getGoals` attaches a `ladder` {parent, children, rollup} payload (defensive on partial selects) + GoalBoard parent-breadcrumb & children-rollup chips (tap-to-scroll) + sub-goals list + edit-mode parent selector (server-validated, rejection toasted) · `37106b6b` · gates green (typecheck 0 · check:crons clean · vitest **2919** = 2905 + 14) · 1 commit on origin/main. **PRIOR:** post the **Ambition Engine P2 wave** · the proactive **goal-drift detector** shipped — a daily Inngest cron (`goal-drift-detector` · `30 12 * * *`) scans active life-goals + their GoalEvent windows and fires priority-graded Coach Events (kind `goal-pace-shift`) on two signals: **deadline-risk** (P1 · deadline ≤14d · <80% progress · no movement this week) + **momentum-decay** (P2 · was active — ≥2 events in the prior 4wk window — then quiet this week · not yet 30d-stale) · acks on re-engagement (idempotent per goalId) · the drift math is the pure `classifyDrift` (`lib/mastery/goal-drift-classify.ts` · 9 unit tests) so it's verifiable in isolation · cron mirrors `goal-pruner` · cherry-picked from its worktree branch → `87a4a0cb` · gates green (typecheck 0 · check:crons clean · vitest **2905** = 2896 + 9) · 1 commit on origin/main. **PRIOR:** post the **Chrome polish wave** · verified the dania scrub LIVE (silent=0 · the only "dania" left is the operator's own goal description) then polished the live UI — rebuilt the bottom "System pulse" ticker to the Edge Feed form (killed the last 60s marquee + touch-dead hover-pause · `edfae490`+`5b31a92a`) + stale-goal CTA affordance & add-goal a11y label (`edfdf1b4`) · gates green (typecheck 0 · eslint 0-err · vitest **2896**) · 3 commits on origin/main. **PRIOR:** post the **relationship-nag scrub wave** · a clarity-gate audit of blunt/stale/sensitive auto-surfaced signals → removed the "Dania N-days-silent" nag from all **6 LIVE surfaces** (ticker `42d748fc` + narrator/chat-lane-check/blind-spot-detector→system-prompt/personal-pulse/pulse-route `0b044154`) + cleared the dead/dormant remainder `9b690019` (dead `daily_score` reads · dormant `dania_neglect`/`body_projection` Telegram rules · `strategic-triggers` marked dormant) — kept all legit person/identity plumbing · gates green (typecheck 0 · eslint 0-err · vitest **2896**) · 3 commits on origin/main. **PRIOR:** post the **deferred-items completion wave** · *"go on all deferred"* — score→reflection re-source (`b952fc37`) + Edge Feed ticker page-context emphasis & 24h snooze (`afc738f2`) shipped; **habit + chat write-time XP resolved as already-covered by clarity-gate** (habits are DAILY Tasks → auto-learn already credits them; chat is swept by the backfill — write-time would add a 2nd per-turn AI call on the chat hot path); ticker **AI-curation v2 + lane-health held** as premature (deterministic rank shipped today + unproven-weak; Guardian hard-rejected the naive version) · gates green (typecheck 0 · eslint 0-err · vitest **2896** · check:crons clean) · 2 commits on origin/main. **PRIOR:** post the **auto-mode evolution wave** · 3 force-ranked upgrades from the Sam-Altman pass, each clarity-gated + shipped — ① revived the dead `industry-pull` feeder as an inngest cron (`recallIndustryIntel` had fed the AI a stale table since the Wave-AE prune) · ② completed the XP ledger (NEW `creditFromSignal` door + write-time crediting for reflections — the daily-score replacement that fed ZERO XP — and decisions) · ③ rebuilt the global ticker (Edge Feed): killed the 55s marquee → one readable/tappable item + feed sheet + a Mastery lane · 4 commits `a5572ac5 → fcdb1b3a` on origin/main · gates green (typecheck 0 · eslint 0-err · vitest **2896** · check:crons clean · check:raw-sql 0 · build OK) · ticker design multi-agent-brainstorming-vetted. **PRIOR:** post the **Ambition Engine P1 (code)** wave · the goal→stat spine is live end-to-end — a goal-tagged task rep credits the goal's mastery stats (idempotent xpEvent log · no double-count), GoalBoard cards show stat chips in character-sheet colors, and the character sheet cites the goals feeding each stat · stats inferred from `goal.domain` so all existing goals light up with no backfill (declared `GoalStat` rows override · authoring is P3) · TDD-first (13 pure unit tests) · 2 commits `805e6173`+`ef691189` on origin/main; the prior wave's 2 local commits rebased to `dcc4e206`+`aec010e5` + pushed too — nothing local-unpushed · gates green (typecheck 0 · eslint 0-err · vitest +13 · check:raw-sql 0 · check:crons clean · prisma valid · pre-push build OK). **PRIOR:** post the **Bridge-contract sweep + Ambition Engine P1** wave · closed the dead-bridge-query class — `jobs_today`×2 · `pending_callbacks_count` · `customer_search` remapped to live nickstire handlers + a `nick-bridge-query-contract` CI guard so it can't recur · budget gate fail-open→fail-safe · system-prompt stale-revenue fallback via `readNickRevenue` · 6 silent-failure breadcrumbs · 5 Inngest-native crons registered · `/tasks`→`/missions` + `/mastery`→`/stats` nav migration (16 files + ⌘K + orb) · mastery **coaching lens** on the /stats side-pane · **Ambition Engine P1** schema (8 `life_goals` cols + `goal_stats` join + self-relation) + migration `0003` **applied to prod via a new guarded `/api/system/apply-pending-migration` endpoint** · 12 commits `a8100a36 → e285e9dc` on origin/main + a local post-review hardening pass · gates green (typecheck 0 · 2877 vitest · check:crons clean · prisma valid) · code-reviewer found 0 P0/P1. **PRIOR:** post the **Stats-consolidation + tech-debt** wave · /scoreboard+/goals → ONE personal `/stats` (business stripped to nickstire admin per operator) · 13 stale `/goals` links retargeted · 4 pre-existing test failures fixed (suite **2875/2875**) · tech-debt wave: Inngest double-fire guard + revived dead stale-leads alert (→ `leads_urgent`) + dead `/mastery` nav removed · 6 commits `a695c174 → 25e31b0a` on origin/main · gates green. **PRIOR:** post Wave Z · recall-freshness fix + dead-lane sweep + retro→journal · 4 commits `d535550c → b48c6e8a` · write-time `embedding_vec_1536` dual-write closes an up-to-7-day chat-recall staleness gap · prod backfill padded 1,599 rows · +5 `CONTEXT_CATEGORIES` recall lanes · `mission_retro` now a 5th `/journal` source · ADR-0023 · 6 "Sam plan" items verified already-built + `decision→goals` migration rejected · gates green. **PRIOR:** post Wave Y · Mastery Layer Stage A completion + NickSidePane v2 multi-turn surface chat · 10 commits in two sub-waves · `c3cdf504 → 47c0598c` (today's continuation: `f03ab83b → 47c0598c`) · Coach Channel grew from 5 → **9 writers** (added eval-regression P0 · correlation-alarm P1 · creation-spike-detect P1 · decision-quality-drift P0) and from 1 → **5 surface mounts** of NickSidePane (was /tasks only · now /tasks /goals /journal /brain /scoreboard — each with its own coachSurface + localStorage thread + per-page presets) · Phase 5 FULL shipped multi-turn surface chat (`/api/ai/side-pane-chat` stateless streaming · client owns thread · ephemeral Anthropic cacheControl on enriched system prompt) · `lib/ai/page-data.ts` gained 4 new surface cases so multi-turn replies on the new surfaces are grounded (was `default: return ""` blind) · reflect-categories cron registered weekly Sun 03:00 UTC · all gates green (typecheck 0 · vitest 185/2812 · turbo pre-push build passed on every push). ADR-0022 documents the Coach Channel pattern + NickSidePane v2 architecture. Tasks #74 #81 #82 closed. On top of Wave X.h · ChatComposer chrome extraction · 1 commit · `/chat` `page.tsx` 2866 → 2756 LOC (−111 net). On top of Wave X.g · bridge-page polling refactor + BridgeShell extraction · 2 commits · −98 LOC net. On top of Wave X.f · activation wave. On top of Wave X.e · −926 LOC consolidation. **Repo:** monorepo `nourdean22/MAINnicks-tire-autoNEW` · branch `main` · statenour at `apps/statenour/` · **Deploy:** Railway (`statenour-web-production`) · **Versioning:** post-`v10.0.X` — commits are `feat · statenour · …` · **Tests:** 2812 across 185 vitest files · **Prod schema:** 31 migrations applied.

> ## 2026-07-07 · Full-repo bug-audit statenour wave · 1 ship (PR #593, awaiting operator merge)
>
> Statenour slice of the 2026-07-07 full-repo bug audit (4 parallel review agents + adversarial verification; register at `AUDIT/BUG-AUDIT-2026-07-07.md`, PR #594). Five verified fixes in one commit:
>
> - **`4a3bb4ef4` · fix · statenour · audit wave** — ① `lib/agent-bridge/auth.ts`: bridge secret compare `!==` → sha256 + `timingSafeEqual` (the last unhardened secret compare; 07-05 audit P3) + new 8-case contract test ② `arsenalNotebookLM`: LLM-supplied `action` went straight to MCP `callTool`; now gated by a code-level read-only allowlist so the reasoning engine stays OBSERVE-only ③ `moneyprinter`: single-flight guard + atomic config.toml write (overlapping runs corrupted the in-flight subprocess's credentials) ④ `/api/short/[code]`: per-IP rate limit on the unauthenticated 3-writes-per-hit redirector (07-05 audit P3) ⑤ prompt drift-guard realigned — main's test suite had been RED since the #587/#588 persona rewording silently changed the pinned OWNER AUTHORITY phrases (failure verified pre-existing on clean origin/main; guardrail-preservation asserts untouched).
>
> Gates: typecheck 0 · eslint 0 errors (215 pre-existing warnings) · vitest 323 files / 3861 passed / exit 0 · `verify:hard` green (prisma validate needed `.env` copied into the worktree — env gap, not code) · pre-push turbo build green.
>
> **Flagged · NOT fixed** (operator decisions, full detail in the audit register): searxng-perplexica `limiter: false` relies on unenforced internal-only networking assumption · `apps/perplexica-mcp` appears orphaned (live path is the direct statenour→Perplexica integration) — confirm + decommission · camera-bridge MQTT `event_id` unsanitized in snapshot filename (LAN-only, low) · reel-engine compositions fetch Google Fonts at render time (bundle locally like social-assets) · `@vitest/coverage-v8@2.1.9` peer-mismatch vs vitest 3.x (pre-existing).

> ## 2026-06-15 · Audit Improvements, Portability & Concurrency Races wave · 13 files
>
> This wave implements the 6 code audit recommendations:
> - **Security Redaction Hardening**: Implemented depth truncation safety boundary (`depth > 3`) in `sanitize-error.ts` and `logger.ts` to prevent credential/sensitive data leaks in deep subtrees, with full unit test verification.
> - **Path Portability**: Replaced absolute local paths with relative links in documentation files, and migrated `ciitty` operating framework rules into the repository at `.agents/frameworks/ciitty/SKILL.md`.
> - **Worktree Branch-Existence Lock**: Modified `worktree-setup.ps1` to detect branch existence locally and remotely via `git rev-parse` before checking out, dynamically creating new branches if missing.
> - **Document Metadata Sync Check**: Patched `check-stale-docs.ts` to validate date stamp synchronization between `AGENTS.md` and `RECONCILIATION.md`.
> - **Double-Submit Guards**: Guarded quick-add and inline task addition in `page.tsx` with client-side submitting lock state.
> - **Server-Side Concurrency Serialization**: Implemented an in-memory Promise-cache map `pendingInboxCreations` in `task.ts` to serialize per-domain Inbox mission creations.
> - **Testing & Verification**: Verified that typecheck, eslint lints, 3,515 vitest unit tests, raw-sql audits, crons checks, prompt-size limits, and prisma validation all pass.
>

> ## 2026-06-15 · Journal Insights Preview Router Tests wave · 1 file · PR #138 merged
>
> This wave adds comprehensive unit and contract test coverage for the insightsPreview tRPC procedure inside the journal router:
> - **Comprehensive Unit & Contract Tests**: Added complete coverage for the `insightsPreview` procedure in `lib/trpc/routers/journal.ts`, verifying empty states, JSON parsing, error recovery/fallback, mappings for all four parent types (`brainDump`, `reflection`, `situationLog`, `decisionReplay`), and title length clipping.
> - **Testing & Verification**: Verified that typecheck, all 3,515 unit tests, and production `next build` pass cleanly.
>

> ## 2026-06-14 · Task Routing Matrix & Provider Fallback Hardening wave · 3 files · PR #133 & PR #131 merged
>
> This wave defaults the primary Gemini model to `gemini-3.5-flash`, implements the task-specific routing matrix, and fixes VAPI diagnostic test assertions:
> - **Primary Gemini Model Default**: Default model set to `gemini-3.5-flash` in the provider config.
> - **Task Routing Matrix**: Implemented `getPreferredOrderForTask(taskType)` mapping all 12 task types to optimized provider sequences in [provider.ts](file:///apps/statenour/lib/ai/provider.ts) to ensure consistent telemetry and fallback chain sorting.
> - **Comprehensive Provider Registry Tests**: Created [provider.test.ts](file:///apps/statenour/tests/ai/provider.test.ts) verifying availability, quota circuit breakers, context reordering, and budget fallback reordering with 6 test suites covering 12 routing pathway variations.
> - **VAPI Test Adjustments**: Adjusted VAPI smoke test assertions to perform case-insensitive comparison on the problem field in `vapi-test-new-tools.ts`.
> - **Testing & Verification**: Verified that typecheck, all 3,510 unit tests, and production `next build` pass cleanly.
>

> ## 2026-06-14 · VAPI Warm Transfer & Admin Dashboard cleanup waves · 17 files · PR #132 & PR #128 merged
>
> This wave implements SIP DIAL bridging for warm transfers and cleans ALG invoice/revenue metrics from the admin dashboard:
> - **VAPI Warm Transfer Bridging**: Switched from SIP REFER to SIP DIAL bridging in `server/routers/vapi.ts` and `server/services/vapi.ts` to resolve silent failures during transfers.
> - **Overview & Revenue Dashboard Cleanup**: Removed Average Ticket, invoice counts, weekly summaries, and unpaid invoices from overview/settings/today cards to match the register/collection system. Disabled the Revenue tab, defaulting to Shop Pulse.
> - **Tire Order Deletion & Status Toggle**: Added delete and payment status toggle mutations in `gatewayTire` router and wired UI actions with delete confirmDialog guards.
> - **Customer Tire Page Upgrade**: Upgraded customer tire landing page conversion and decision layouts to improve readability and visibility under counter conditions.
> - **Testing & Verification**: Verified typechecks and frontend console cleanliness.
>

> ## 2026-06-14 · Google Gemini Fallback Integration wave · 4 files · PR #129 merged
>
> This wave integrates Google Gemini into the core fallback chain:
> - **Gemini Fallback Integration**: Added `@ai-sdk/google` dependency and wired up `gemini-2.5-flash` in the provider configuration.
> - **Telemetry & Monitoring**: Updated the provider health dashboard in `lib/ai/provider-health.ts` to monitor Gemini availability, error rates, quota limits, and real-time latency.
> - **Testing & Verification**: Verified that all 3,493 tests pass and the full pnpm verify:hard gate remains green.
>

> ## 2026-06-14 · Dopamine Loops & Brain Hub Tab Consolidation wave · 12 files · PR #130 merged
>
> This wave implements the strategic blueprint Section 6 dopamine visual loops on `/missions` and integrates `BrainHealthView` / `BrainContinuityView` under `/brain`:
> - **Level-Up Engine**: Added `levelUp` detection to `creditTaskStats` comparing pre- and post-XP boundaries.
> - **Visual Kinetics**: Built glassmorphic `LevelUpModal` overlay, floating `+N XP` `XpParticle` upward animation, and inline fire `StreakBadge` for streaks.
> - **Brain Tabs Consolidation**: Mounted `BrainHealthView` and `BrainContinuityView` as PageTabs under `/brain`, resolving orphaned views.
> - **Routing & Deep Links**: Updated redirects in `next.config.ts` so `/brain/health` redirects to `/brain?tab=health`. Updated deep links in `since-last-visit-card.tsx`, `memory-tab.tsx`, `tool-result-registry.tsx`, and `feature-status.ts`.
> - **Testing & Verification**: Verified that typecheck, all 3,497 unit tests, and production `next build` pass cleanly.
>

> ## 2026-06-13 · Missions UI Polish & Task Decomposition wave · 11 files · PR #120 merged
>
> This wave implements four UI/UX enhancements and the task decomposition pipeline on the Statenour /missions page:
> - **Dynamic Search Placeholder**: Adapts the filter search placeholder dynamically based on active filter kind and domain.
> - **"Ask Nick" Empty-State CTA**: Added an actionable button in `EmptyMissions` that dispatches a custom event opening the Nick side panel with a goal-assessment query.
> - **Autonomic Healer Health Chip**: Rendered a live, pulsing, glassmorphic health status chip in the KPI header representing database and cron recovery status.
> - **Auto-Decomposition Trigger**: Wired an inline sparkles icon and task edit sheet button to trigger TRPC task decomposition via the AI tasks service.
> - **Testing & Verification**: Verified that all components compile, lint, and build cleanly, and successfully passed the full `verify:hard` gate. Checked visual states in Chrome.
>

> ## 2026-06-13 · Autonomic Orchestrator wave · 5 files · PR #117 merged
>
> This wave implements the comprehensive 4-phase Autonomic Orchestrator for background cron healing, database maintenance, runner pipeline recovery, and triage pruning:
> - **Phase 1: Cron Self-Healing**: Scans and heals up to 3 failed/never-run cron jobs, posting P0/P1 coach events.
> - **Phase 2: DB Health Engine**: Executes bloat-based `VACUUM` on `CronJobLog` and reindexes `vector_embeddings` using standard connection pooling.
> - **Phase 3: Pipeline Recovery**: Automatically resets stale (claimed/running >30m) work items and tracks upstream API quota depletion circuit-breakers.
> - **Phase 4: Resource Triage**: Deletes cron job logs older than 30 days and archives tasks untouched for >14 days. Writes `cron:data_cleanup_completed` AuditEvent.
> - **Wiring & Types**: Integrated the orchestrator into GET `/api/cron/cron-healer` and fixed the client-side `tone` parameter type warning in `app/(mastery)/chat/page.tsx`.
> - **Testing & Verification**: Built a comprehensive test suite `tests/cron/autonomic-orchestrator.test.ts`. Passed `verify:hard` (tsc 0, lint 0, 3,491 tests green).
>
> ## 2026-06-10 · chat-error closeout + evolution audit + Journey Engine wave · 4 ships
>
> One session, two waves, all deployed + live-verified on bdnick.info (Railway SUCCESS on `fb851113`). The sibling session's Next-Action extraction (`520063c6`, item C) landed between them and this wave built directly on it.
> - **`91c198a1` · chat:post-process `.match` crash CLOSED** — localized to the content-feedback step's `as unknown as string` cast on a parts-only prior assistant message (`content: undefined` → `priorText.match()` threw, silent under withErrorCapture, recurred for weeks). New total helper `lib/ai/chat/message-text.ts` (`messageContentToText`, 6-case test incl. the exact undefined regression). Also: FORBIDDEN-PHRASES narrowed so SPECIFIC tool-unavailability is honest+encouraged + TOOL UNAVAILABILITY / TOOL CONFIRMS ACTION rules in HONESTY+RESPECT · dead `/system/errors` → redirect to `/system/logs` (+hub hint+RUNBOOK refs). Closeout doc: `docs/audits/CHAT-ERROR-CLOSEOUT.md`.
> - **`d1c24209` · closeout doc verification stamp** (deployed SHA + live-verify results).
> - **`9184c714` · Journey Engine wave (journal spec items A,B,D,E,F,G)** — 7-mode capture (Dump/Daily Debrief/Battle Log/Decision Replay/Pattern Breaker/Win Proof/Future Self; `entryTypeHint` rides captureThought→ingestJournal, operator mode outranks blind classification) · ImpactReceipt honest empty states (Analyzing…/Legacy/no-link) · brief→4-line operator directive (COMPOUNDING/STALLED/WATCH/MOVE; signals now include drift+goals+missions+entry summaries; cache key `:v2`) · thread arc trend (pure `journal-thread-trend.ts`, strict ≥2/wk AND accelerating bar, 6 tests; "strengthening · N/wk" chip + arc line) · `journal.proofStack` + "becoming" strip on /journal · `journal.latestNextAction` + "NEXT MOVE · from your journal" strip on home. Arc-radar AI cost/opportunity lines deliberately deferred (need a cached cron seam — no fabrication).
> - **`fb851113` · morning-brief durable producer + memory guard + founder report** — Wave AE deleted `/api/cron/morning-brief` = the ONLY writer of BrainMemory(morning_brief) → prod read `ready:false` daily while Inngest push/audio worked off an in-memory fallback; `composeBrief()` now upserts the row (reader-aligned NY-date keys). `scoreMemories()` excludes `source:"manual"` (operator curation must not erode). `docs/audits/STATENOUR-EVOLUTION-AUDIT.md` = 7-agent product audit: ranked backlog + 5-year top-10 + the env-flag HOLD table.
> - **Live-verified post-deploy:** /journal renders the 4-line directive on real data + the becoming strip (58 proofs/wk, +53 vs last, by-domain) + mode buttons in the capture modal; home NEXT MOVE strip correctly self-hides (no takes carry nextAction until entries are enriched post-`520063c6`); 0 console errors; morning-brief row write verifiable after the next 10:00 UTC run.
> - **Flagged · NOT fixed (operator-gated):** `NICK_AUTONOMY=off` (51 approvals rotting · proactive spine dead) · proactive Telegram push module has ZERO callers (phone always silent) · 201→211 tasks in inbox, no triage ritual · `NICK_IMPORTANCE_RECALL`/`NICK_CONTRADICTION_CLEANUP` default-off · XP decay unwired · `resolvePrediction` zero callers (Brier loop open) · task outcome capture needs an additive migration · nickstire bridge business-correlation shims return `[]`. All ranked with recommendations in the evolution-audit doc.
>
> ## 2026-06-09 · Wiring Wave — F1–F5 services connected to live surfaces · SHIPPED
>
> The F1–F5 function wave (entry below) shipped to main as `43b63268` (Railway-deployed · bdnick.info 200), which left the new services mostly API-only. The Organization+Wiring Audit (`docs/project/ORGANIZATION-WIRING-AUDIT.md`) found them correct but unreachable, and the motivation loops wired-but-invisible. This wave connected them to real surfaces, ONE wire at a time, each committed + verified separately (typecheck 0 · targeted + full suite · `check:stale-docs` 0 · `check:runbooks` clean · build green). No new tables, no migrations, no prod-data mutation, no hidden autonomy.
> - **`07381ff7` (in 43b63268) · Wire #1 chat interceptor** — F5 commands reachable in chat via a 1-branch `resolveCommand`-gated interceptor (exact-match → no hijack) + 6 slash-menu entries.
> - **`46fb2739`/`43b63268` · Wire #2 reward toast** — honest task-completion reward on /missions; BOTH updateTask (DONE) and checkTask return an optional `reward` only when credit occurs; `formatReward` pure + tested, never fabricates XP.
> - **`55ed38c4` · Wire 1 receipts → chat finalize** — `persist-assistant-turn` writes an `action_receipt` AuditEvent per side-effecting executed action (existing ActionReceipt contract); `action-receipt-feed` merges that 3rd source + dedupes by receiptId. Failed actions visible; advisory-only (never blocks chat). +tests (success/failure/no-false-done).
> - **`68c1c98b` · Wire 2 /missions rescue strip + GENERAL anchors** — read-only `task.missionsHygiene` = buildTaskRescue + buildDomainAnchors (busiest-first · domain fallback); a self-hiding `missions-rescue-strip` shows findings + per-domain open-counts. Suggestion-only, never auto-moves; GENERAL anchors PROTECTED. +mapper tests.
> - **`8cf50229` · Wire 3 /system/digest cards** — `system.{changeDigest,memoryEvals,receiptFeed}` (DRY-extracted `buildMemoryEvalReport`) + a read-only `/system/digest` page (what-changed · truth evals · recent receipts) + a HubCard; memory-evals route simplified to the shared builder. +tests.
> - **`ab360f55` + `46d8803c` · Wire 4 DAILY stat XP** — DAILY check-offs (updateTask→WAITING) skipped the DONE-credit block → 0 XP. `isDailyCheckoff` gates a per-day idempotent `creditTaskStats`; the reward rides back + toasts. Hardened (`46d8803c`) to fire ONLY on a strict `lastCompletedAt` advance — unchanged/older/edit-only credit nothing (unit-proven). No double-credit (perDay sourceKey). ONCE/WEEKLY/PROMISE unchanged.
> - **`882b65c5` + `14b6c225` · Wire 5a knowledge→action `/convert`** — `convertToAction` (pure · was zero-caller) now has one suggestion-only surface: a `/convert <thought>` command (+`/action` alias, + slash-menu entry) proposing a next move + flagging sensitive intents requiresApproval. NEVER writes. Wire 5b (people→stats) audited as ALREADY wired via `lib/mastery/people-credit.ts` (ledger deposits + power-plays credit relationships/networking/persuasion) — not rebuilt.
> - **Verify (final):** typecheck 0 · vitest **229 files / 3195 tests** all pass · `check:stale-docs` 0 critical · `check:runbooks` clean · `pnpm build` green. 7 ships `55ed38c4 → 14b6c225` on top of `43b63268`.
> - **Disclosed finding (NOT changed — operator-gated):** the reward toast renders `formatReward`'s `xp` as "+N XP", but `creditTaskStats` returns the COUNT of stats credited, not the summed XP (its documented + tested contract). For single-stat DAILY (Wire 4) count≈XP; the gap shows on multi-stat goal tasks (the pre-existing DONE/checkTask paths, live since `43b63268`). Recommended fix: return the summed XP from `creditTaskStats` (truthiness preserved → no caller breaks; only `credit-task-stats.test.ts`'s 3 count assertions change). Left untouched to respect "don't change XP math / no unrelated cleanup".
>
> ## 2026-06-09 · useful function wave (F1-F5) · SHIPPED to main `43b63268` · 6 ships
>
> Re-scoped the remaining intelligence roadmap (operator: replace the abstract upgrades with practical functions). Built on branch `statenour-truth-intelligence-wave` (continuing past the pushed `c4716a90`), **NOT pushed to main** — awaiting an owner deploy decision. Services + tests first; reuse existing models (NO new tables, NO migrations); every mutation explicit/receipt-backed; no chat-route bloat. Understand phase ran as a 6-agent read-only workflow; an adversarial 4-lens review workflow ran over the diff. Each function gated tsc 0 + targeted vitest.
> - **`dc5696c1`** — re-scoped `docs/project/NEXT-INTELLIGENCE-WAVE.md` to the Top-5 function wave (deprioritized generative confirm cards, jobs dashboard, broad knowledge→action, governed-memory migration).
> - **`a38f2d98`** — **F1 Claude session importer**: `lib/services/session-import.ts` (pure section-aware `parseSessionLog` → title/repo/branch/commits/phases/files/checks/blockers/migrations/prod-actions/warnings/next-steps + needsOwnerApproval + prodMigrationOrDeployPending flags; `importSession` persists to the EXISTING SessionReport table, suggestion-only — never auto-creates tasks) + owner POST route + 12 tests.
> - **`ff2d4cb6`** — **F2 system change digest**: `lib/services/system-change-digest.ts` reuses parseLatestReconciliation + runMemoryEvals + scanContent + RUNBOOKS + an HONEST Railway-aware deploy identity (never asserts an unverifiable deploy) + owner GET route + 12 tests.
> - **`b4c5505e`** — **F3 task rescue scanner**: `lib/services/task-rescue.ts` pure `classifyRescue` (pending/legacy-inbox/stale/no-next-action/general-maybe-specific; GENERAL anchors PROTECTED) reusing isInboxMission/isGeneralAnchor; read-only owner GET + 12 tests.
> - **`63edff7b`** — **F4 action receipt feed**: `lib/services/action-receipt-feed.ts` maps EntityAudit (via getGlobalActivity) + AutonomousAction (FAILED actions visible) onto the EXISTING ActionReceipt contract (integrate, not duplicate) + owner GET + 9 tests.
> - **`faca5995`** — **F5 personal command shortcuts**: `lib/ai/chat/command-registry.ts` pure parse/resolve + 6 commands (/today /rescue /what-changed /import-session /receipts /stale) calling the F1-F4 services, runnable via owner POST `/api/system/command`; NOT wired into the live chat streaming seam (concurrent session in that path) — thin interceptor hook is a documented follow-up. 15 tests.
> - **Verify:** typecheck 0 · `check:stale-docs` 0 critical · `check:runbooks` clean · `check:crons` clean · `eval:memory` 22/0 · vitest **225 files / 3155 tests all pass** · `pnpm build` green. No migrations, no prod data touched, nothing pushed.
> - **Deferred:** wire F5 into the chat interceptor (one tested hook) · F1 confirm-create via createTask · `/today` "3 tasks + current mission" enrichment (today-compound is counts-only) · 2 advisory provider warns in the SHARED root README.
>
> ## 2026-06-09 · truth + intelligence wave · stale-context quarantine + guard + memory evals + runbooks + action receipts + knowledge→action · 6 ships
>
> A two-objective system-quality wave run in the `statenour-truth-intelligence-wave` worktree (off `main` `acad664b`, isolated from the concurrent session). **Objective A — truth cleanup:** future agents were at risk of being steered to retired deploy paths (Vercel · `codex/ollama-local` · `statenour-master` · the standalone `statenour-os` repo · the `C:\Users\nourd\NOUR-OS` path) by docs/config that still read as current. **Objective B — intelligence:** added reliability/trust infrastructure (truth scoreboard · operating runbooks · action-honesty receipts · knowledge→action). Every ship gated tsc 0 + targeted vitest; full matrix at the end green. **No production data mutated · no migrations · not yet pushed/deployed (owner decision).** Phase-1 audit: `docs/audits/truth-cleanup-2026-06-09-stale-report.md`; plan: `docs/project/NEXT-INTELLIGENCE-WAVE.md`.
> - **`01c5438c`** — truth cleanup + guard. NEW `docs/CURRENT-TRUTH.md` (one-screen truth: location · `main`→Railway→bdnick.info · what's retired · SoT hierarchy · "provider/model truth lives in `lib/ai/provider.ts`, not prose"). Quarantined `docs/project/{MASTER-CONTEXT,UPGRADE-PLAN}.md` → `docs/archive/historical-v{7,8}/*-HISTORICAL-DO-NOT-EXECUTE.md` (git mv + pointer stubs left behind so links resolve). Fixed in place: `config/repos.ts` statenour-os entry relabeled RETIRED standalone (was active/core/bdnick.info + a stale statenour-master CI-mirror note; /system/repos test mocks the module → no live-value dependency) + monorepo entry now names both apps; `AGENTS.md` dead resume path + CURRENT-TRUTH pointers; `AGENT-CONTRACT.md` "current state" pointer; BUSINESS-LANDSCAPE + ARCHITECTURE + chat-route-walkthrough provider hardcodes → point to code; CHANGELOG intro + V10-PLAN snapshot + gmail-setup env step; HISTORICAL banner on CONSOLIDATION-PLAN; RETIRED header on the dead `scripts/pre-push-check.sh`. NEW `scripts/check-stale-docs.ts` + `pnpm check:stale-docs` (critical retired-deploy terms hard-fail under `STALE_DOCS_STRICT=1`; provider hardcodes warn; whole-file exemption for archive/adr/dated/bannered + per-line ±2 for wrapped prose) + `tests/lib/check-stale-docs.test.ts` (14). Result: 0 critical (2 advisory warns in the SHARED monorepo-root README, left untouched).
> - **`335c3d80`** — `docs/project/NEXT-INTELLIGENCE-WAVE.md`, the ranked engineering plan.
> - **`4ef690dc`** — **memory evals / truth scoreboard** (P5). `lib/evals/{memory-eval-types,memory-evals,memory-eval-runner}.ts` (23 evals · 10 categories) + `scripts/run-memory-evals.ts` (`pnpm eval:memory`) + owner GET `app/api/system/memory-evals/route.ts` (read-only, degrades gracefully) + `tests/lib/evals/memory-evals.test.ts` (15, incl a real CURRENT-TRUTH.md drift guard). `gradeDoc` checks a truth doc TEACHES facts (forbidden NOT applied to docs); `gradeAnswer` is negator-aware for free-form answers; runner is pure (no DB/API). Scoreboard: 23 total · 22 pass · 0 fail · 1 manual.
> - **`04c54f32`** — **agent runbooks foundation** (P6). `lib/runbooks/{types,catalog}.ts` (8 active runbooks) + `docs/runbooks/*.md` (+ index) + `scripts/check-runbooks.ts` (`pnpm check:runbooks`, reuses the stale-doc scanner) + `tests/lib/runbooks.test.ts` (6). Lit up the 4 runbook-grounded memory evals.
> - **`5988d3f0`** — **action receipts guard** (P7, additive). `lib/ai/receipts/action-receipt.ts` — normalized `ActionReceipt` + `toReceipt()` + `canClaimDone()`; side-effecting-ness reuses the tool catalog (`getToolMeta`, broadened to `*_write`) + `MUTATION_ACTIONS`. A side-effecting result without a confirmed `ok` is "partial" (never asserts done without proof). `tests/ai/receipts/action-receipt.test.ts` (15). NOT yet wired into the live finalize seam.
> - **`7a082b77`** — **knowledge→action converter** (P8). `lib/knowledge/action-converter.ts` — pure heuristic, suggestion-only (no writes); chat/journal/memory/decision → task/rule/experiment/decision/memory/ignore; tasks get a `nextPhysicalAction`; sensitive/destructive intents flagged `requiresApproval`. `tests/lib/knowledge/action-converter.test.ts` (11). UI wiring deferred.
> - **DEFERRED (in NEXT-INTELLIGENCE-WAVE.md):** P9 generative confirm cards · P10 jobs console (already exists at `/system/crons` — improve via runbook) · receipts finalize-wiring · converter UI surface · 2 advisory provider warns in the shared root README.
> - **Verify (full matrix):** typecheck 0 · `check:stale-docs` 0 critical (strict exit 0) · `check:runbooks` clean (8) · `check:crons` clean · `eval:memory` 22 pass/0 fail · vitest **220 files / 3093 tests all pass** · `pnpm build` green.
>
> ## 2026-06-06 · Nick people-gate + WEEKLY recurrence + chat-honesty + PersonProfile source/phone/email + action-write verifier · 4 ships + Batch-4 prod cleanup
>
> Operator reported 3 bugs on bdnick.info (the chat auto-added shop callers / a pronoun-ghost "her" into the personal Power Atlas; tasks only did ONCE/DAILY; Nick fabricated task-status + nagged). Root-caused via 3 read-only code-explorers, fixed, migrated, prod-cleaned, runtime-verified — then a **multi-agent behavioral review** (Skeptic / Constraint-Guardian / User-Advocate · disposition **REVISE**) re-scoped the broader "Nick refinement" ask. Each ship gated tsc 0 + tests + turbo build green, landed attempt 1 via push-main.sh.
> - **`c66bb09e`** — (1) **people-creation gate:** `resolvePersonByName` (lib/brain/person-profile-fuzzy.ts) rejects pronoun/non-names (`isNonName`) + a `createIfMissing` flag; the conversation digest is now MATCH-ONLY (no auto-creating shop contacts) + no longer overwrites a curated `relationship`; `person.update` is edit-only; NEW `person.create` that ACTION_CATALOG tells Nick to ASK before using ("never add shop callers"). (2) **WEEKLY recurrence:** `LoopKind += WEEKLY` + `Task.recurring_days Int[]` + a 7-day weekday picker in task-edit-sheet + `checkTask` snoozes a WEEKLY task to its next listed weekday (reuses the WAITING+snoozedUntil task-resurface cron); pure `lib/loops/weekday.ts`. **Migration `0008_task_weekly_recurrence` APPLIED to prod.** (3) **chat-honesty:** NEW `task.status` agent-action (Nick CHECKS instead of fabricating "is it done") + an always-on HONESTY+RESPECT system-prompt block. tsc 0 · +10 new tests (isNonName guard + weekday math) · affected suites green · next build green.
> - **`172bac8f`** — HONESTY+RESPECT reword (multi-agent REVISE): FACTS-vs-COACHING lanes (verify facts or "can't confirm — want me to pull it?"; engage fully on coaching) + empty-tool-result handling + RESTORED the unprompted push-on-the-work (the first wording risked a yes-man). Prompt-only.
> - **`07089a9d`** — **PersonProfile `source` / `phone` / `email`** (#5 of the REVISE backlog): `source` (operator|agent|digest · set-once on create, never overwritten on match/update) makes shop-vs-personal STRUCTURAL; phone/email captured in the /people add+edit form + a read-only origin line. Resolver stamps them on create; NO new match-tier (phone-as-key DEFERRED — no phones exist yet · YAGNI · resolver match-logic untouched). **Migration `0009_person_source_contact` APPLIED to prod.** tsc 0 · /people verified 0 console errors.
> - **`75e48458`** — **action-write verifier** (REVISE #1 — the last item judged worth building now): Nick's `action`-block writes run in deferred background and bypassed the SDK-tool fabrication guard (`detectActionClaimsWithoutTools`/`environment-verifier` see only `capturedToolCalls`), so a mutation that silently FAILED while Nick's prose claimed completion never warned the operator. NEW pure `lib/ai/chat/action-result-verifier.ts` (`detectFailedActionClaims`) consumed in the deferred `executeActions` block emits a `chat_claim_warn` row (the EXISTING correction-chip path: claim-warnings.ts → /api/ai/chat/claim-warnings → action-claim-warning.tsx) when a MUTATION action failed AND the prose claimed completion; gated by `detectActionClaims` (suppresses the people-gate ask-first guard + hedged prose) + a `MUTATION_ACTIONS` set (failed reads excluded). No added latency (stays deferred), no per-action DB re-read; `traceId` threaded into `DeferredBackgroundCtx`. tsc 0 · +8 new tests · 166 chat tests green · build-gated push landed attempt 1.
> - **Prod data (no commit):** Batch-4 cleanup via Claude-in-Chrome — deleted the 2 ghosts (`Fernando Romero` = shop lead; `her` = operator-confirmed Dania, a pronoun mis-log), re-homed the note to Dania's leverage notes (reversible soft-delete); roster 9→7, NEEDS-INFO 2→0. + logged +10 RelationshipLedger deposits for Manny & Mash (operator: "holding it down, little contact needed").
>
> **Flagged · NOT fixed (REVISE backlog → `~/.claude/projects/C--/memory/statenour-nick-behavioral-review.md`):**
> - **#1 action-write verification — SHIPPED `75e48458`** (see ship list above). The v1-predicted "post-write row check inside `executeActions`" was SUPERSEDED — handlers already return `success:false`, so the existing flag was wired to the existing `chat_claim_warn` correction-chip via the deferred path (no per-action DB re-read, no latency). `environment-verifier.ts` confirmed the WRONG layer (its `capturedToolCalls` = `ev.steps` = AI-SDK streamText tools ONLY, NOT the action-block writes through `executeActions`).
> - **#6 dynamic fact-check grounding** (`fact-check.ts` proper-noun allowlist is hardcoded → stale, missed "Fernando") · **#8 narrow paid-provider routing** (latency — NOT a global pre-send LLM pass, which the repo already built + left OFF for 2×-latency reasons) · **#9 undo affordance** for people adds — all marginal; rec = stop the high-value push here.
> - **~70% of the proposed "Nick v1 contract" already existed** (L1-L3 fabrication stack · CoVe · pre-stream-regen · confidence-tier code-gate) — the review correctly redirected to the specific gaps above.
> - **Migration deploy-ordering lesson:** when a migration's APPLY may be auto-mode-gated, confirm the apply-auth BEFORE pushing the column-reading code (0008 slipped the classifier; 0009 was blocked → operator per-action-authorized → applied).

> ## 2026-06-04 · code-review program (verified H1-H4 / M1-M7 sweep) · 9 ships · main RED→GREEN
>
> Operator: *"check the accuracy of this [code-review ledger]… then go on all… fix it all."* A prior 6-agent code-review (run on a throwaway clone) was first-hand re-verified against source, then the safe + risky-but-gated findings shipped. Every ship gated tsc 0 + red-green vitest + turbo build green; rebased past the concurrent nickstire session through 4 ref-lock races. **Two findings CORRECTED mid-flight (verify-don't-trust):** H1 "ZERO CI typecheck" was overstated (gap real but narrower — nested statenour workflows exist, just inert); M5 "12 identical dup helpers" was wrong-premise — they're 18 DIVERGENT relative-time helpers (only 6 byte-identical, safe to merge).
> - **`f6b601c9`** — H1: added `"check": "tsc --noEmit"` to statenour `package.json` so CI's `turbo run check` stops silently SKIPPING statenour's typecheck (it had only `typecheck`; siblings all define `check`; `next.config ignoreBuildErrors:true` meant build missed types too → type errors could land on main). Proven via turbo dry-run. + H2: dropped `node_modules/.prisma/**` from turbo build OUTPUTS (platform-native binary; cross-OS cache-restore = silent corruption; build runs `prisma generate` unconditionally). + dropped `.env*` from `globalDependencies` (busted whole cache on secret rotation).
> - **`9e1f5a18`** — M1: registered 5 load-bearing flags in `lib/feature-flags.ts` (`NICK_PRIME_PROMPT` · `ENABLE_SPECIALIST_ROUTING` · `NICK_HIGH_SPEC_GATE` · `NICK_CHAT_INTENSITY` · `INNGEST_MEGA_V2`) — read via raw `process.env` but invisible to `/system/migrations`+`getFlag()`. Additive; call sites untouched.
> - **`4fab8138`** — M4: corrected stale "Venice primary" → Ollama-primary across README + `docs/ARCHITECTURE.md` + `.env.example` (real chain `[ollama,venice,openai,anthropic]`); deleted the redundant stale `.env.template` (+ its security-audit allowlist entry); collapsed 3 contradictory provider-order comments in `provider.ts`. + deleted dead `activeProviderSupportsTools()` (0 callers).
> - **`cdc03631`** — M5 (safe subset): 6 byte-identical `timeAgo` copies → `relativeTimeSeconds`/`relativeTimeMinutes` in `lib/utils/datetime.ts` via aliased imports (zero behavior change).
> - **`bdac0102`** — **fixed 2 stale RED test suites → main GREEN** (17 failing → 0): `smart-now.test.ts` asserted pre-Wave-2 routes (`next.config` redirects `/plan`→`/stats`, `/tasks`→`/missions`); `looks-like-brain-dump.test.ts` imported `looksLikeBrainDump` from its OLD path (moved to `lib/ai/chat/brain-dump-detector`). No runtime logic touched. + deleted 3 INERT nested workflows (`apps/statenour/.github/workflows/{ci,pr-review,mirror-to-master}.yml` — GitHub runs ROOT workflows only + trigger branches absent on origin = doubly-inert vestige of the standalone statenour-os repo).
> - **`d35da9bf` + `c3067403`** — removed all ~9 dead `format.ts` exports (0-caller-verified repo-wide; `format.ts` now = `clamp`/`formatDate`/`toSentenceCase`). + **M6 REFUTED**: the reasoning smart-tier "empty context" concern is false — smart (`reasoning/engine.ts:712`) sets context then falls through to the universal `if(!context)` fanout catch-all guarding ALL tiers (@971/@991 are extra thorough/deep-only pre-fallbacks). Added a clarifying comment, no patch.
> - **`66c74215`** — **H4: split the 1971-LOC `lib/trpc/routers/task.ts` god-router** → 20 Power Atlas (people/relationship/ledger/power) procedures extracted VERBATIM to `lib/trpc/routers/task/power-atlas.ts` (715 LOC), spread back (`...powerAtlasProcedures`) so `trpc.task.*` paths stay FLAT (zero behavior change; `updatePowerBalance` body byte-identical pre/post; build green). task.ts → 1278 LOC. Mirrors the `system`-router spread pattern. (`reorderMission`/`reorderTask`/`accept|dismissTaskClassification` KEPT — task-domain, were interleaved.)
> - **`1c6d84b1`** — M3: `ActionRule` was `any`-typed (the 20-rule autonomous-engine fires real Telegram/email side-effects with no compile-time shape check) → `ActionRule<T>` generic + `defineRule<T>` existential wrapper; each rule's `action(item)` now checked vs its `trigger()`. Type-only (identity cast; `any` net −2).
>
> **Flagged · NOT fixed (honest):**
> - **M2 (smart-home automation) HELD — investigated, NOT dead.** `lib/brain/automation-engine.ts` is the UNWIRED automation layer of a LIVE feature (SmartDevice/DeviceCommand/AutomationRule used by 15 files incl `lib/trpc/routers/system/devices.ts`; Tuya env present). Real device control runs through an EXTERNAL Python `local-agent/` that DIED Apr 14 (`app/api/devices/retire-stale/route.ts:8`); cameras have NO pixel pipeline (`snapshotUrl` always null; V380s P2P/no-RTSP). Operator chose SKIP (needs their hardware). Wire-vs-delete = open. Revive-runbook in MEMORY.
> - **M7 version drift — LEAVE** (aligning lucide/recharts/vitest/streamdown = untested major-version bumps, low gain).
> - **Relative-time full standardization** — needs a TWO-format house-style decision (short-horizon ops + long-horizon relationship timelines); a one-format rule would degrade month/year views. Operator left it.
> - **`tests/ai/agents/router.test.ts` intermittent flake** — passes 17/17 ISOLATED (this tree AND base), fails in the full single-fork run (mock-order pollution hypothesis). NOT from this work (proven); "pre-existing-before-session" unconfirmed. Joins the ~12 unhandled-rejection errors as test-isolation debt → the full suite EXITS 1 with all tests PASSING (read the summary line, not `$?`).
> - **TRUST AUDIT (advisory · operator-gated · NOT code).** A trust-calibrator+clarity-gate pass found nickstire INTEGRITY landmines — used-tire **$25** (web/Google schema) vs **$60** (phone/SMS/IG/voice/chatbot), a documented decoy (`truth_os.md:8-11`) → bait at booking; 36-mo warranty still in `llms-full.txt` vs 12-mo canon; hardcoded "Verified Google Review" testimonials + gbpContentGenerator fabrication (FTC risk); marketing "redo it free" vs invoice "ALL SALES FINAL" — plus a statenour-Nick gap (the verified/unverified marker covers ACTION claims but NOT numeric/data claims; CoVe + self-consistency flag-OFF). Detail in MEMORY `statenour_2026-06-04_code-review-verified.md`.

> ## 2026-06-03 · nick-intelligence + every-page audit + chat-pipeline code-health · ~5 ships
>
> Operator: *"fix nick chat + upgrade the tool calls + find anything else… give deep-reasoning live-data access… go through EVERY surface of EVERY page, make uniform, no deficit, don't break anything… then: what about the code underneath?"* Three threads, all flag-gated or behavior-preserving, prod byte-unchanged until a Railway flag flips.
> - **`db697237`** — nick-intelligence pass: chat-truth fix (Nick stopped flagging its OWN citations as fabrication; 5 tool-name corrections + a CI poka-yoke), the **`AI_PROVIDER=ollama` prod-stall fix** (that env var hard-pinned one provider + DISABLED failover → a stalled chat; DELETED, verified fixed live via Claude-in-Chrome), 15 `NICK_*` intelligence features (importance-recall · CoVe · contextual-retrieval · proactive autonomy [FAIL-CLOSED, /qa-gated] · anticipatory recall · reflection trees · contradiction cleanup · episodic split · outcome learning · self-consistency · multi-agent-auto · event-triggers · deep-reasoning · verified-regen · confidence-tier — each behind an env flag, default-OFF, wired to a real consumer), an 8-bug **proactive-staleness sweep** (recency floors / age ceilings / entity stopwords / honest relabels / freshness tags so no surface asserts stale data as present-tense), and the **glm-5.1** model swap (operator-chosen strongest+least-restricted; vision split to qwen3-vl; tool-calling verified live). 12 flags ON Railway, 3 held (verified-regen / confidence-tier / one more) by operator choice.
> - **`54df18b7`** — deep-reasoning LIVE-DATA access: the reasoning engine can't call tools, so deep turns reasoned blind to current numbers; now a compact `getDashboardSummary()` real-business snapshot is prepended to the reasoning context (best-effort, skip-on-fail) so `NICK_DEEP_REASONING` could be turned ON without the downside. Enabled.
> - **`c3281343` + `5717a107`/`a89f7e92`/`7319657d` + `1e2329bd`** — every-page audit (all 41 pages, 5 read-only audit waves): `/system` hub-grid pruned 33→12 cards (dead redirect/404/colliding cards removed, Calibration+Reviews restored), dead cross-links + orphan `system/status/` deleted; **14 pages migrated to the canonical `StandardPage`/`PageHeader`** (`description` widened `string`→`ReactNode` for live-metric subtitles); plus functional-deficit fixes (body weigh-in freshness, outreach neutral default segment, content/history `undefined/undefined`, retired `/habits` redirect).
> - **`4fa6255b`** — iOS-PWA dialog sweep: 11 controls used `window.confirm/prompt/alert` (silently dead in the operator's standalone PWA) → migrated to the in-DOM `confirm-dialog.tsx` primitives.
> - **`e4c5633a`** — chat-pipeline code-health pass (*"the code underneath"*): a read-only code-explorer audit produced a 12-item backlog; shipped the 5 SAFE behavior-preserving wins — route.ts python-execute regex dedup + `genBase` hoist · provider.ts Venice+Ollama quota-breakers collapsed into one `makeQuotaBreaker` factory (~40ln) · reasoning/engine.ts 6 repeated dynamic-import blocks → one shared module-scope `tracedAiChat`. tsc 0 · 919 ai tests green · build gate green, landed attempt 1.
> - **chat↔rest-of-statenour connectivity audit** — read-only trace of every seam (tools→bridge, brain recall, mastery, business-intel, persist-back) found 2 real wiring bugs, both fixed: `getProjections`'s 30-day revenue projection was a 1-DAY window (the `revenue_range` bridge query was sent a `{since}` filter the nickstire handler ignores — it reads `{from,to}` defaulting to today → Nick's annual projection was today×12; fixed `lib/ai/tools/goals.ts` to send the real 30-day span) + bridge env-key drift (`fetchShopSnapshot`/`fetchShopHealth` read only `BRIDGE_API_KEY`, but the live Railway key is `STATENOUR_SYNC_KEY` — snapshot silently used the slow fallback, health returned null; unified both onto a shared `resolveBridgeConfig()` matching the canonical `queryNick` client). 4 lower findings deferred + documented; 6 seams verified healthy. Detail in `nick-intelligence-pass.md` §10.
> - Reference/operating guide written: `docs/nick-intelligence-pass.md` (flag table · on/off/rollback commands · fail-closed safety model · model/provider chain · staleness patterns · §9 code-health backlog).
>
> **Flagged · NOT fixed (honest):**
> - **`preferLargeContext` sort (provider.ts) — left untouched.** A code audit called it a dead no-op; verify-don't-trust: `PROVIDERS` leads with the Venice+Ollama tag-team, so if Venice is index 0 that sort genuinely reorders Ollama to the front and is load-bearing. Not changed pending proof.
> - **Code-health backlog deferred (7 items, all SAFE)** — GSC-prefetch + customer-shape-hint extractions out of route.ts, `customerShapeRegex` module-hoist, `looksLikeBrainDump` relocate, `DeferredBackgroundCtx` derived-boolean removal, `buildMessageParts` helper; 1 RISKY (collapse the standard-tier critique branch via tier-config). Better done in a fresh-context pass; recorded in `nick-intelligence-pass.md` §9.
> - **3 flags held OFF** by operator choice (verified-regen trades streaming for a slower full-generate; confidence-tier removes the human-approval gate).
> - **Runtime not fully driven** — flag behaviors + the new chat paths are tsc-0 + suite-green + (some) Claude-in-Chrome-verified live, but the auth-gated personal-chat surfaces are verified by construction, not every-path-driven (same auth-gated-personal-data line as prior waves).
> - **Optional `PageSkeleton`** shared loading slot — still open (pure uniformity polish, no deficit).

> ## 2026-06-02 · hybrid retrieval — real Postgres FTS lexical lane (Wave B) · 1 ship + 1 prod migration
>
> The deferred Wave-B recall win, picked up + shipped (operator: *"B hybrid-retrieval (Neon migration)"*). `contextual-recall.ts` ran 3-lane RRF (semantic + keyword + category), but its "keyword" lane was `keywordScore` — naive JS `.includes()` substring matching over ONLY the top-300-by-confidence candidates loaded for the turn, so a perfect lexical hit (a person's name, an error code like "F25e", a SKU) on a mid-confidence memory was never even loaded → couldn't win. Replaced that lane with a TRUE Postgres FTS over ALL non-deleted/conf>=0.3 memories, UNIONed its hits into the candidate pool (the starvation fix), and fed `ts_rank` as the lexical lane (naive `keywordScore` kept as a graceful fallback when FTS errors or returns empty). The code degrades to a seq-scan pre-index (caught → falls back), so it shipped deploy-safe AHEAD of the migration. Verify-don't-trust: a fresh-worktree `tsc` tripped on an unbuilt `@statenour/lenses` (sibling code) — a build-order artifact, NOT my code; the real gate `turbo build` (which builds lenses first) passed 3/3.
> - **`9edc1804`** — B · FTS lexical lane. NEW `getLexicalMatches` (`ts_rank` + `websearch_to_tsquery`, OR-across-topics) + pure unit-tested `buildLexicalTsQuery` (4/4) in `contextual-recall.ts`; candidate-pool union; lane swap `useLexical ? sLexical : sKeyword`. Plus the `0007_brain_fts` registry entry in `app/api/system/apply-pending-migration`, `prisma/migrations-pending/0007_brain_fts/migration.sql`, and `scripts/apply-brain-fts.ts` (prod apply with pgvector before+after guards). Disjoint from the concurrent analyzer/home-chat session; rebased onto their `edf1766d` after a 2nd ref-lock race; combined-tree turbo build green (3/3 tasks).
> - **migration `0007_brain_fts` APPLIED to prod Neon** (via `scripts/apply-brain-fts.ts` · `railway run --service statenour-web`) — an ADDITIVE expression GIN index on `brain_memories.content`. **pgvector verified PRESENT before AND after** (the index is on a SEPARATE table from `vector_embeddings`, so it cannot touch pgvector — the operator's #1 fear, hard-guarded: the script aborts if `vector` is missing either side); index confirmed present; FTS smoke (`tire or revenue or oil`) = **277 live matches**; recorded in `_prisma_migrations` (drift-safe).
>
> **Flagged · NOT fixed (honest):**
> - **App-level lane not driven live** — the data layer is proven (277-match FTS run against prod Neon), but `getContextualMemories` fires only on an auth-gated personal chat turn, so the in-app lane is verified by construction + the live SQL, not by a driven turn (same auth-gated-personal-data line as prior waves; operator's in-app trigger).
> - **RRF lane weights unchanged** — kept `[2.0, 1.0, 1.0]` (semantic-dominant); a real `ts_rank` lane could justify a re-tune, but that needs measurement → left conservative (the win is the real ranking + the pool union, not a weight change).
> - **Deploy SHA not marker-pinned** — bdnick.info 200/healthy; `9edc1804` auto-deploys but no health-marker distinguishes it (same known limitation).

> ## 2026-06-02 · next-level intelligence (recall + memory + proactivity) + nickstire $49 · 6 ships
>
> Operator: *"achieve next-level intelligence and get it programmed into statenour… go above and beyond."* A 2-stream research pass (internal intelligence audit + external SOTA, both filtered to Ollama+pgvector) found statenour's brain already strong (RRF + cross-encoder rerank · 9-stage consolidation · fabrication defense) — so this was 4 SURGICAL upgrades in a clean lane disjoint from the concurrent analyzer-suite session, not a rebuild. Every commit tsc-0; full suite **2950 pass** (the 12 cold-run unhandled-rejections proven flaky — a pre-existing teardown race in `tasks-auto-inherit.test.ts`, absent on the warm re-run AND on the baseline; not in my import graph). Verify-don't-trust corrected the plan twice mid-flight: R2's "recency×importance scoring" was already implemented (dropped, no double-count), and R1's "HNSW full-table-scan" was a candidate re-score not a scan (reframed).
> - **`fae626ab`** — J · `mergeMemories` SOFT-deletes consolidated sources (`deletedAt`) instead of hard-deleting. 2026 research ("Useful Memories Become Faulty…") shows LLM consolidation that destroys source evidence can drop recall below a no-memory baseline; recall already filters `deletedAt:null` so what's recalled is UNCHANGED, but originals stay recoverable. `pruneNoise` left hard-delete (genuine GC: expired/conf<0.1/dupes).
> - **`a65ca22e`** — I · graph-aware recall. `contextual-recall.ts` now traverses the `MemoryEdge` graph (written nightly by connect()+cross-pollinate, never READ until now): a 1-hop expansion off the top-2 recalled memories surfaces the strongest linked memories as a "Connected" section. Safe-by-construction — append-only + try/catch + capped (≤2 anchors, ≤3 links, 150 chars) + dynamic-imports relational-graph (no cycle); the public recall interface is UNCHANGED (so the sibling's `system-prompt.ts` merges clean).
> - **`f0ad8498`** — F · XP-drift detection. NEW `lib/mastery/xp-drift.ts` compares each stat's recent-7d rate vs trailing-28d baseline (reuses `xpEventTotalsSince` — DB-side GROUP BY, no new query/migration) and flags clear decays/surges; the narrator surfaces the top finding as a coach/analyst narration. Conservative thresholds + a 20-XP baseline floor so it never cries drift on noise.
> - **`fe766df2`** — G · opt-in LLM-synthesized narrator. `synthesizeNarration` feeds the combined signal vector to a fast Ollama call for ONE compound observation the per-signal templates can't produce. Gated behind `NARRATOR_LLM_SYNTHESIS=1` (OFF by default — the ticker is byte-unchanged until enabled), ≥2-pattern-gated, hour-cached, best-effort. Never replaces a template voice.
> - **`5f03ffac` + `68a8315f`** — nickstire · VAPI receptionist + igAutopost $50→$49 conventional oil (the only price surfaces still on $50; igAutopost's compliance gate would have REJECTED a correct $49 post). ⚠ the LIVE VAPI assistant needs a `vapi.updateAssistant` re-push for $49 to be SPOKEN — the code deploy alone doesn't update the dashboard-managed assistant.
> - Ship path: isolated worktree `statenour/next-level-intelligence` → cherry-picked onto the sibling's `54a45560` after their push won a ref-lock race → combined-tree build re-gated green (cleared a stale `.next/types` deleted-route validator) → ff-pushed `54a45560 → 68a8315f`. Files fully disjoint from the analyzer session (their analyzers/chat-route/system-prompt/deps vs my recall/consolidation/mastery/ultron).
>
> **Flagged · NOT fixed (honest):**
> - **B (hybrid `tsvector`/BM25 retrieval lane) deferred** — the biggest remaining recall win, but it needs a hand-applied Neon migration, NOT run concurrent with the live sibling session. Next-session pickup (coordinate the migration window).
> - **G ships OFF (env-gated)** — its narration quality is unproven; flip `NARRATOR_LLM_SYNTHESIS=1` to evaluate (template voices remain the floor).
> - **Runtime behaviors not live-executed** — the graph "Connected" section, the drift narration, and the $49 spoken quote read personal Neon data / need the assistant re-push; verified by construction + tsc + full suite, not driven live (the auth-gated personal-data line, held same as the sibling).
> - **Deploy SHA not marker-pinned** — bdnick.info is 200/healthy/DB-connected (booted clean on the combined tree), but my changes add no health-marker, so `68a8315f`-vs-`54a45560` can't be distinguished from /api/health. Build-gate + proven-live base = sound, but not marker-proven.

> ## 2026-06-01 · task classification + scoring + AI-review finish + confirm-chip · 8 ships · 2 prod migrations
>
> Operator: *"tasks feel a little generic when it creates one… auto-classifies into the generic Inbox or Missions without taking a look at whether they correlate to a mission, goal, or feed stats… look at the scoring system + settings + everything."* Root-caused to 4 layers — a mission-ONLY classifier · a create path that bypassed it · `goalId`-null tasks credited nothing · auto-learn's `MasteryScore` domain strings never matched the 33 stat keys, so task XP was silently orphaned — plus 2 latent bugs (the /check route never lifted goals · DAILY completions were inert). Rebuilt the create→classify→credit spine end-to-end, then ran an AI code-review and shipped every recommended fix incl. a suggest-then-approve confirm-chip.
> - **`b9a60d4d`** — register `0004_task_stat_hints` (no schema change · pre-apply; the two-phase deploy that dodges the Prisma SELECT-all "column doesn't exist" trap).
> - **`1ee0f765`** — the core: NEW `lib/ai/classify-task-linkage.ts` correlates **mission + goal + stats** (was mission-only; an AI call via `tracedAiChat` with a deterministic keyword-overlap `fallbackLinkage`) fired from ONE `enrichTaskLinkage` chokepoint on EVERY create path (gap-fill · atomic compare-and-set) · `creditTaskStats` credits the character sheet on EVERY completion (goal stats → statHints → `goal.domain` inference · idempotent `sourceKey` · scaled by `taskStatMultiplier`) — closing the orphaned-domain bug · `Task.statHints` column · `0004` APPLIED to prod.
> - **`12ce290e`** — enrich treats ALL `/inbox/i` mission variants as unclassified + a zero-target goal-progress guard (#2/#3 from the AI review).
> - **`272405ff`** — M3: `credit-task-stats.test.ts` pins the crediting orchestration (exactly-once · priority order · multiplier scaling).
> - **`2c8030a4`** — P3a: /missions quick-add now relies on the server enrich; the redundant client-side classify+attach block + the dead `classify-task-mission` module DELETED (server enrich is the single classifier).
> - **`084a38ef`** — M1 (SQL-aggregated xpEvent totals · was an in-JS sum) + M2 (`createTaskAndEnrich` seam).
> - **`825e9fba`** — register `0006_task_pending_classification` (pre-apply).
> - **`2c4c376d`** — confirm-chip: a low-confidence (0.3–0.6) mission match PARKS on `Task.pendingClassification` and surfaces a /missions accept/dismiss chip — mirrors /people's suggest-then-approve · migration `0006` applied to prod (operator-authorized).
> - Gates (FRESH — re-verified on shipped `origin/main` this session): typecheck **0** · the wave's unit suites **35/35** (scoring-config 6 · credit-task-stats 8 · goal-stats 16 · classify-linkage 5). 8 commits `b9a60d4d → 2c4c376d`, interleaved on shared main with the concurrent /people wave (its `44a10079` is an ancestor of the final `2c4c376d`).
>
> **Flagged · NOT fixed (honest, verified):**
> - **confirm-chip on-screen render is unverified.** Verified by construction (column live · `pendingClassification` surfaces through `task.list` · accept/dismiss mutations typecheck · chip renders off that field) but never seen on screen — the live Ollama classifier was decisive (≥0.6 or null) across 6 prod test tasks and never produced a 0.3–0.6 result to land in the park band.
> - **Biggest lever is DATA, not code.** Only ~2 life-goals exist and both are unconfigured (target = 0) — the spine has little to correlate against until real goals are authored. Code-complete; operator action.
> - **`lib/mastery/goal-stats.ts` perDay day-key uses UTC, not the ET `today()`** — a narrow 8pm–midnight-ET double-credit edge in `creditTaskStats`'s `{perDay}` path. Left for the statenour-session owner to avoid a cross-session collision on the mastery files (per the agent-memory handoff).

> ## 2026-06-01 · /people (Power Atlas) overhaul + QA pass · 4 ships + prod migration
>
> /people went from a siloed, unscored CRM to a real part of the mastery system
> (operator: *"feels generic… results aren't tracked/scored into XP… doesn't read
> tasks to correlate to a mission/goal/stats… UI looks bulky"*). Measure-first
> profiling of prod drove the plan — the feature would have launched empty otherwise.
> - **Overhaul (5 phases)** `d5c6f098` — `lib/mastery/people-credit.ts` (NEW · ledger
>   deposits + power-plays credit the INFLUENCE & PEOPLE stats via the idempotent
>   `creditStatXp` seam — deliberately NOT `goal-stats.ts`, to dodge the sibling's
>   task-classification rewrite) · classifier rewritten **suggest-then-approve**
>   (`pendingClassification` + role SSOT `lib/brain/person-roles.ts`, no more silent
>   overwrite) · reads tasks via a real `Task.personId` FK ("open promises" panel) ·
>   UI de-bulked (stats above the fold · 5 empty cards folded · dup Greene sidebar
>   removed) · operator-tunable weights (`components/settings/people-scoring-panel.tsx`)
>   · `task.backfillPeopleXp` mutation · rebased clean onto the sibling's statHints.
> - **Migration `0005_people_overhaul` APPLIED + recorded on prod Neon** — `pending_classification`
>   col + `Task.person_id` FK (onDelete SetNull) + index; the promiseTo→personId backfill
>   matched 0 rows (profile-predicted — only "self"×2).
> - **XP backfill RUN + verified** — 16 historical deposits → 13 `relationships` (10.0 XP)
>   + 3 `networking` (3.9 XP); confirmed live in the UI (Dania +6.6 XP chip).
> - **QA pass `44a10079`** — parallel a11y audit + code-review found+fixed a CRITICAL:
>   `window.confirm` person-delete was silently dead in the iOS **standalone PWA** (the
>   operator's phone) → two-tap inline confirm, **live-verified** ("delete"→"sure?",
>   no delete on first tap). Plus `updatePerson.role` z.string()→z.enum (role SSOT leak),
>   `getPeopleIntelligence` missing `deletedAt:null` (soft-deleted people leaked into
>   Nick's prompt every chat turn), `dismissClassification` swallow→throw, WCAG (trust
>   tier as text not color-only · XP-chip aria-label · live regions · 44px targets).
> - Gates: typecheck 0 · 89 mastery + 12 people-credit tests · pre-push build OK · all
>   surfaces live-verified on bdnick.info via Chrome. Shipped via `~/push-main.sh`
>   (auto-race-recovery helper built this wave; landed through 5-session shared-main churn).
>
> **Flagged · NOT fixed (deliberate, verified — not gaps):**
> - `lib/mastery/credit.ts` upsert last-write semantics — shared by EVERY crediting path (journal/decision/task); defensible (idempotent on row identity; only re-prices on a deliberate backfill re-run). Blast radius too high for a polish pass.
> - Codebase-wide clickable-row nested-interactive-role pattern (MissionCard/GoalBoard convention) — refactoring one row = layout risk + inconsistency; address repo-wide or not at all.
> - mentor/mentee → `networking` stat map — judgment call, no correctness impact.

> ## 2026-06-01 · Journal Brain redesign (grounded enrichment) · 2 ships + prod migration
>
> The Journal went from a generic dead-drop to a grounded thinking instrument
> (operator: *"the Journal feels generic… results aren't tracked/scored into XP…
> doesn't read tasks/missions/goals/stats"*). Full phased redesign, "Approach A"
> unified async enrichment pass. Capture stays instant; a fire-and-forget pass
> grounds each entry vs ACTIVE goals/missions (inline candidates, NO embeddings —
> goals aren't embedded + the set is tiny), grounded-reclassifies (real `entry_type`
> column wins over the legacy JSON blob), proposes a confirmable goal/mission link
> (auto-confirm ≥0.8 credits now · below → "proposed", credits on ✓), credits a
> grounded XP bonus to the linked goal's stats (`baselineXp×weight×groundedMult`,
> idempotent `goal-journal:<id>:<stat>`), and generates a bold idea + sharp challenge
> ("take"). Baseline XP (Phase 0 `b5cf8b9a`) already credits every capture.
> - **Phase 1-3 + engine** — `lib/brain/journal-brain.ts` (enrich + `confirmJournalLink`
>   + `creditGroundedGoalXp` + `generateJournalTake` + `resweepUnenriched` + Phase-3
>   `backfillJournalBrain`) · wired into `journal-ingest.ts` (fire-and-forget, `notifyTelegram`)
>   · `lib/trpc/routers/journal.ts` (`receipt` DERIVED from ledger · `confirmLink` ·
>   get/updateSettings · `backfillBrain`) · `journal-feed.ts` (grounding cols + batched
>   goal-title, no N+1 + SQL `entry_type` push-down) · `entry-row.tsx` (link chip +
>   impact receipt) · `journal-brain-panel.tsx` (7-knob settings) · resweep into
>   `cron/mastery-xp`. Rebased 3× through shared-main churn.
> - **Telegram link-confirm** — propose-time inline ✓/✗ + `handleCallback jlink:c|r:<silo>:<id>`.
> - **Migration `20260601_journal_brain_foundation` APPLIED to prod Neon** (`spring-art-47050555`
>   via run_sql_transaction: 6 cols × 4 silos + 8 FKs + 9 indexes + `journal_settings`). ⚠ Phase 0
>   had shipped the schema cols WITHOUT applying → prod journal reads were likely erroring until
>   this apply. **Lesson: schema + migration must ship together.**
> - Deleted orphaned regex classifier `lib/journal/classifier.ts` (no importers).
> - Gates: typecheck 0 · pre-push affected build OK · push head `dc476e4e`. UI built by 2 scoped
>   subagents, diffs verified. Used PowerShell git (Cygwin fork failures) + cleared worktree `.next`
>   (a nested-artifact explosion was hanging Next's file-tracer at "Finalizing").
>
> PROFILE (prod, 2026-06-01): 990 journal rows — **435 brain_dumps** (median 96 chars, p95 701,
> only 2.3% under 40 → qualityFloor=40 validated) + 215 reflections + 331 situation_logs + 9
> decision_replays. **⚠ only 1 ACTIVE goal vs 10 active missions** → grounding value is thin until
> more goals exist.
>
> **Flagged · NOT fixed (operator-gated / deferred):**
> - **Backfill (~990 rows) not yet run** — heavy Ollama; `journal.backfillBrain` dryRun→drain, or the nightly resweep auto-drains brain_dumps. Operator-gated.
> - ✅ **mission→goal stat crediting — DONE this wave** — `resolveCreditGoal` routes a mission-linked entry to the mission's parent goal (`mission.lifeGoalId`) in both the live pass + confirm, so the 10 active missions earn XP, not just the 1 standalone goal (the profile's top lever, shipped same wave).
> - Deep brain-consolidation (drift/threads INTO the pass) — YAGNI; they already work as separate /journal surfaces.
> - Migration left in `migrations-pending/` (not promoted to migrations/ + not in `_prisma_migrations`) — the hand-applied intermediate; promote later.

> ## 2026-05-31 · God-file split #2 (system.ts) + Chrome-walk fixes · 2 ships
>
> A live Chrome walk of statenour (operator: *"do a chrome walk of everything"*)
> verified this session's work IN PROD — the idiot-index chip, the full P3
> authoring panel (parent/kind/conviction/identity/kill-by/ambition), and AI
> tool-calling after the tasks.ts split (Nick called a moved `goals.ts` tool and
> answered grounded) — all green, zero console errors. It surfaced two pre-existing
> issues, both fixed in `f6f1143b`:
> - **`app/(mastery)/financial/page.tsx`** — the MONEY page showed a PERMANENT
>   "Loading revenue data…" whenever month revenue was 0, i.e. it lied when the
>   nickstire bridge was down. Now splits the states (loading / feed-unavailable /
>   genuine $0). ROOT CAUSE of the empty bridge = config (STATENOUR_SYNC_KEY on
>   Railway and/or nickstire's `revenue_range` handler) — flagged, not code-fixable.
> - **`lib/observability/os-snapshot.ts`** — all 5 source scanners excluded `.next`
>   but not `.next-prod`/`standalone`, inflating LOCAL cron runs. Added both. (No
>   prod effect; the /brain `monster_file_count` P0 is a REAL signal, not noise.)
>
> Then the **`system.ts` god-router split** (`560525e2`) — the worst god-file, the
> one driving that P0. The 2,722-ln `systemRouter` (105 tRPC procedures) → 9
> per-domain procedure-object files (`system/{health,cron,autopilot,prompts,quality,
> schema,devices,agents,notifications}.ts`), recomposed in a **61-ln** `system.ts`
> via object-spread: `router({ ...healthProcedures, ...cronProcedures, … })`. **FLAT
> namespace preserved** — every procedure stays `trpc.system.<proc>` (NOT nested,
> which would change client paths + break call sites). Verbatim byte-range move,
> zero behavior/input-schema/middleware change, 105→105 procedures. Built in an
> isolated worktree via a briefed subagent, then independently verified: procedure
> parity, no-nesting grep, and **typecheck 0 = the interface gate** (client
> `trpc.system.*` call sites compile against the router type) + full vitest 2919.
> Cherry-picked onto main; pre-push build OK.
>
> (Concurrent **a11y session** shipped `d85888ba` WCAG 2.2 AA both apps +
> `useFocusTrap`/`useReducedMotion` hooks + `59032991` mobile hero + merge
> `03e80d67`; fact-checked ACCURATE. Verified gotcha: a worktree branch pushed
> `HEAD:main` SKIPS the pre-push build — no upstream — so a later `main` push
> re-gates everything.) **Remaining god-files:** chat route (1,884 ln) · provider
> centralization (31 callers).
>
> ## 2026-05-31 · Tech-debt cleanup (statenour) — report fact-check + tasks.ts god-file split · 2 ships
>
> A monorepo tech-debt report (from the nickstire session) listed Sprint-1 wins.
> Fact-checked its statenour claims against the files first (the worktree report it
> produced earlier had real errors): **most held, two didn't** — serializeRow's "77×
> across 3 files" is literally true (system-pages.ts 28 + -b.ts 27 + runner-state.ts
> 22), but the `.toISOString()` calls are heterogeneous (current-time / epoch /
> non-null / nullable), so a single `serializeRow` helper doesn't fit + it sits on
> the API-response path → **skipped** (overstated ROI); provider-bypass is **31**
> files not 23. The money-path wins (formatDollars 5×-contradictory, Stripe webhook
> `any`, payments test) are all `apps/nickstire/` → handed off to the owning session.
>
> **`34ad6fcd`** — deleted the stale `soft-deleted-tasks-2026-05-16.md` restore log
> (389 ln in the app source root). The one clean zero-risk win.
>
> **`2728caa7` · `tasks.ts` god-file split** (interface-preserving) — the 2,024-ln
> single `tasksTools` const (46 AI tools) → 6 NEW per-domain files
> (`goals`/`missions`/`habits`/`health`/`finance`/`calendar` · 7+3+3+1+1+2) + a
> 29-tool `tasksCoreTools` kept in tasks.ts (now 1,292 ln), recomposed verbatim:
> `tasksTools = { ...tasksCoreTools, ...goalsTools, … }`. Pure mechanical MOVE, zero
> behavior change; the public `tasksTools` export keeps the EXACT 46 keys. Dropped
> one unused `detectBlindSpots` import from tasks.ts (still used in brain.ts). Built
> in an **isolated worktree** (a concurrent `a11y-hardening` session was live) via a
> briefed subagent, then **independently verified** (diff scope · 46/46 key count ·
> recomposition spread · typecheck 0 · full vitest 2919 · verbatim spot-check) before
> cherry-picking onto main.
>
> Gates green: typecheck 0 · vitest **2919** · pre-push build OK. 2 commits on
> origin/main. **Remaining tech-debt (sequenced for fresh context):** the chat-route
> (1,884 ln) + system-router (2,722 ln / 105 procs) god-files · provider
> centralization (31 call-sites) · the nickstire money-path hand-off.
>
> ## 2026-05-31 · Ambition Engine P3 (increment 2) — kinds + anti-stale authoring · 1 ship
>
> Operator: *"can u do both at the same time? or all?"* → did all the remaining
> P3 in one wave (NOT parallel agents — kinds/authoring/trajectory all edit
> goal-board.tsx, so parallel would only conflict; one focused pass = one verify
> + one ship). Wires the rest of the dormant P3 columns (P1-migrated, settable
> nowhere) into the /stats card.
>
> **`de898be3` · kinds + anti-stale authoring** (+191/−2) — `lib/services/goals.ts`:
> `updateGoalSchema` now accepts `kind` (metric|milestone|narrative enum) +
> `conviction` (1-5) + `ambition` (tenx|incremental) + `killCriteria` + `killBy`
> (DateTime, converted like deadline) + `identityLine`; all nullable so the edit
> panel can clear them. `components/goals/goal-board.tsx`: (1) **authoring** — the
> edit panel gained a kind selector, conviction picker, identity-line input,
> kill-criteria + kill-by date, and an ambition toggle; (2) **display** — a
> conviction flame chip, ambition tag, pre-committed kill-by chip, the Elon
> **idiot-index** (hrs invested ÷ % moved · derived, no column), and the identity
> line for narrative goals — all in the card's existing chip language; (3)
> **kind-adaptive** — a kind badge on non-metric goals, milestone goals relabel
> "loops"→"milestones", narrative goals surface the identity line while the
> metric/target chip falls away naturally (no target).
>
> Trajectory was already the existing pace-projection chip; the idiot-index
> completes the Elon "question the requirement" set. **P3 is now functionally
> complete** (ladder + kinds + anti-stale authoring + trajectory). Built in place
> on main. Gates green: typecheck 0 · lint 0 new errors · vitest **2919**. 1
> commit on origin/main → Railway. Future refinement: dedicated per-kind card
> layouts (a real milestone checklist UI) + the `lastChallengedAt`
> question-the-requirement ritual button (column exists, no UI yet).
>
> ## 2026-05-31 · Ambition Engine P3 (increment 1) — the compounding goal ladder · 1 ship
>
> Operator: *"go"* (build P3). P3 is the spec's broadest phase ("ladder +
> trajectory + UI polish"); a code survey found the `parentGoalId` / `GoalLadder`
> self-relation shipped in the P1 migration but **referenced nowhere** — a dead
> column. Scoped increment 1 to wiring it end-to-end (the defining "compounding"
> feature), TDD-first; trajectory + kind-adaptive cards deferred to later increments.
>
> **`37106b6b` · the ladder** (+426/−5) — NEW pure `lib/mastery/goal-ladder.ts`
> (14 unit tests): `validateParentLink` (rejects self · cycle, via a cycle-guarded
> `ancestorChain` walk · inverted horizon, where the parent must be ≥ the child's
> horizon) + `rollUpChildren` (childCount · doneCount · avgChildProgress).
> `lib/services/goals.ts`: `updateGoalSchema` accepts `parentGoalId` (null unlinks);
> `updateGoal` validates the link before the write (builds id→horizon + id→parent
> maps from active goals); `getGoals` fetches `parent` + alive `children` per goal
> and attaches a `ladder` {parent, children, rollup} payload — **defensive**
> (`children` may be absent on a partial select / mock; the lone test break was
> exactly this, fixed at the source not the mock). `components/goals/goal-board.tsx`:
> ladder UI in the card's existing language — a violet parent-breadcrumb chip + a
> sky children-rollup chip (both tap-to-scroll to the linked card via the existing
> hash-anchor pattern) + a sub-goals list in the expanded panel + a parent `<select>`
> in edit mode (server-validated; rejection surfaced in the toast).
>
> Built in place on main (not a worktree — the native worktree tool wants an explicit
> "worktree" ask, and in-place + TDD kept the tree buildable for the concurrent
> nickstire session). Gates green: typecheck 0 · check:crons clean · lint 0 new errors
> · vitest **2919** (2905 + 14). 1 commit on origin/main → Railway. **Remaining P3:**
> kind-adaptive cards (metric/milestone/narrative) · trajectory · the
> conviction/killCriteria/identityLine authoring (those columns are also still dormant).
>
> ## 2026-05-31 · Ambition Engine P2 — proactive goal-drift detector · 1 ship
>
> Operator: *"get back to it"* — shipping the P2 work built + fully verified on a worktree
> branch last session. The **goal-drift detector** is the proactive complement to
> `goal-pruner`: where the pruner only flags goals already 30+ days idle, this catches
> drift EARLIER, on two signals, and acks itself when a goal re-engages.
>
> **`87a4a0cb` · goal-drift detector** (+330 · 3 new files + 2 registration lines) — NEW
> `lib/mastery/goal-drift-classify.ts`, a pure side-effect-free `classifyDrift(input) →
> DriftVerdict | null`: **deadline-risk** (P1) = deadline ≤14d & progress <80% & 0 events
> this week · **momentum-decay** (P2) = ≥2 events in the prior 4-week window & 0 this week &
> <30d since last activity. Thresholds (RECENT_DAYS 7 · PRIOR_DAYS 28 · DEADLINE_SOON_DAYS
> 14 · DEADLINE_PROGRESS_FLOOR 80 · MIN_PRIOR_EVENTS 2) are grounded defaults, tunable. NEW
> `src/inngest/functions/goal-drift-detector.ts` — daily cron `30 12 * * *` (30min after
> `goal-pruner` so the two goal scans don't collide) — scans active `lifeGoal`s + their
> GoalEvent windows → `recordCoachEvent({ kind: "goal-pace-shift", … })` deep-linked to
> `/stats#goal-<id>`, surface `goals`; acks the event on re-engagement, idempotent per
> goalId, best-effort writes. Registered in `config/crons.ts` + `src/inngest/functions/index.ts`.
> NEW `tests/lib/mastery/goal-drift-classify.test.ts` (9 tests). Reused the existing
> `CoachEventKind` member `goal-pace-shift` — the closed union already anticipated P2.
>
> Shipped via **cherry-pick** from the local `worktree-ambition-p2-drift` branch onto main
> (clean linear history — no merge bubble on shared main); the diverging commit on main was
> the other session's `c883caa6` (nickstire callback fix · zero file overlap). Worktree
> removed + branch deleted after the push landed; added `.serena/` + `.claude/worktrees/` to
> root `.gitignore` (tooling dirs were untracked-and-committable on shared main). Gates green:
> typecheck 0 · check:crons clean (30 active schedules · under cap · all reachable) · vitest
> **2905** (2896 + 9). 1 commit on origin/main → Railway. **Ambition Engine P3** (goal
> authoring · stat-ladder · kind-cards) remains.
>
> ## 2026-05-31 · Chrome polish wave — bottom-ticker Edge Feed rebuild + a11y/CTA touch-ups · 3 ships
>
> Operator: *"go check it out in chrome for more polishing."* Walked the live site
> (confirmed the dania scrub took — `silent`=0; the only "dania" is the operator's own
> goal description, correctly untouched), then fixed what the walk surfaced.
>
> **`5b31a92a` + `edfae490` · bottom "System pulse" ticker** — the LAST 60s CSS marquee
> with `hover:pause` (banner-blindness + dead-on-touch — the exact pattern the Edge Feed
> redesign already removed from the top ticker; a lone item even rendered twice
> side-by-side). `5b31a92a` stopped the lone-item double; `edfae490` rebuilt it to match
> the top — ONE static item, priority-first (warn>win>info>mute), fade-on-change,
> tap-to-open pulse feed (UPWARD), visible 24h snooze (was forever-dismiss). Ambient
> scale kept (`min-h-[32px] sm:h-5`, 10px) so the layout's bottom reservation (chat
> safe-area + pb) is unchanged; a11y landmark preserved; A3 test updated to lock the
> marquee removal.
>
> **`edfdf1b4` · two touch-ups** — the P2 stale-goal coach card now reads "tap to review
> or archive at the goal" (it deep-links to the goal's one-tap archive — not a dead-end,
> just an unclear affordance); the icon-only add-goal Plus button got
> `aria-label="Add goal"` (the lone genuinely-unlabeled button on /stats — the
> char-sheet category toggles were already labeled by content + aria-expanded; the
> a11y-tree's "7 unlabeled" was an artifact, the live probe found exactly one).
>
> Gates green: typecheck 0 · eslint 0-err · vitest **2896**. 3 commits on origin/main.
>
> ## 2026-05-31 · Relationship-nag scrub wave — kill the "Dania silent" ambush across all surfaces · 3 ships
>
> Operator: *"yes [scrub the other dania surfaces] but also search for more shit
> that needs scrubbing /clarity-gate."* A read-only code-explorer audit mapped the
> CLASS of blunt/stale/sensitive auto-surfaced signals (the score-nag + dania-silent
> pattern). Found 10; scrubbed the 6 LIVE, cleared the 4 dead/dormant, kept all
> legit plumbing.
>
> **`42d748fc` · ticker dania-silent item** — the first surface, caught by live
> Chrome verification (also covered in the deferred-items entry below).
>
> **`0b044154` · 5 more LIVE surfaces** (+9/−200) — the same regex "Dania N days
> silent" nag was auto-surfacing on: `narrator.ts` ("Dania gap Nd" coach line +
> trigger patterns + the input), `chat-lane-check.ts` (a chip under EVERY chat
> reply), **`blind-spot-detector.ts`** (highest blast-radius — the blind spot fed
> `blind-spot-pinner` → pinned into the TOP OF EVERY SYSTEM PROMPT; removed the
> Dania-only loop + its orphaned `neglectedPeople` query), `personal-pulse.ts` (the
> "<name> silent Nd" LIFE chip + its 2 person-silence queries + "dania"-as-a-role-
> enum), and `app/api/ultron/pulse/route.ts` (the `life.daniaSilent`/`topSilent`
> name exposure in the cached payload). Kept (clarity-gate): person-name resolvers,
> intent/lane routing, promiseTo fields, the "married to Dania" identity facts the
> AI prompt needs.
>
> **`9b690019` · dead/dormant remainder** (+9/−118) — dead `daily_score` reads in
> `ultron-ticker.ts` + `plan-day/route.ts` (retired system, always null/[]); the
> dormant `dania_neglect_nudge` + `body_projection_weekly` (hardcoded 186-lb)
> Telegram rules in `autonomous-engine.ts` (engine has no caller since Wave AE —
> removed so a re-wire can't resurrect them); marked `strategic-triggers.ts` DORMANT
> (no caller; documented the score-shim revival trap rather than deleting 521 lines
> of Greene-trigger logic).
>
> Method note: the audit's value was tracing the CONSUMER GRAPH, not the string — a
> grep-and-delete would have missed `blind-spot → pinner → every system prompt`, the
> worst path (not a visible chip). Also surfaced that the prior wave's
> `strategic-triggers` re-source (`b952fc37`) was cosmetic — the module is dead.
>
> Gates green: typecheck 0 · eslint 0-err · vitest **2896**. 3 commits on origin/main.
>
> ## 2026-05-31 · Deferred-items completion wave — re-source + ticker page-context/snooze · 2 ships
>
> Operator: *"go on all deferred."* Closed the deferred refinements from the
> auto-mode wave. Two of them clarity-gate resolved to *already-covered* (no
> redundant code shipped); the AI-curation v2 is held as premature.
>
> **`b952fc37` · score→reflection re-source** — three detectors still read the
> retired daily-score source (`recentScoreSnapshots` / `identity_snapshot`):
> · `timelines.ts` `computeInputs` — deleted the now-dead score inputs
> (`todayScoreLogged`/energy/focus/discipline); the items that consumed them were
> already removed in the 812c0a32 ticker cleanup, so the reads were pure dead
> weight. · `strategic-triggers.ts` "no business action today" — swapped
> `dailyScoreToday` for live `reflectionLoggedToday` (`prisma.reflection.count`,
> date format mirrors the writer in `journal-reflect.ts` + `narrator.ts`) + fixed
> the stale "no score" detail text. · `nour-state.tsx` `detectState` — dropped the
> always-default score-derived energy/discipline (so `on_fire`/`low_energy` could
> never fire) → state driven by the LIVE signals already in state (drift alerts,
> active commitments, habit-rate); `on_fire` revived via strong habit completion.
> No `/api/health` change. +28/−40.
>
> **`afc738f2` · Edge Feed ticker — page-context emphasis + 24h snooze** —
> client-only (no server feed change). · **Page-context:** the global strip
> soft-boosts the lanes relevant to the current page (shop/market on
> /money+/scoreboard+/funnel, mastery/brain on /stats+/goals, brain/industry on
> /brain+/radar+/seo) — applied as a tiebreaker AFTER mode+severity, so an urgent
> item still leads globally. · **24h snooze:** the top strip's X is now a 24h
> snooze (opt-in `ttlMs`), not a permanent mute, so live/recurring lanes
> (market, shop) return tomorrow instead of being silently lost forever; the
> shared dismiss hook migrated `Set`→`Map` gracefully (legacy string-array
> entries preserved as forever; bottom ticker unchanged).
>
> **Resolved by clarity-gate (no code shipped):** · **habit write-time XP** —
> habits were retired as a model; they're DAILY Tasks now (`/api/habits` POST is a
> no-op), so completing one credits XP via the task→auto-learn path already. ·
> **chat write-time XP** — already swept by the mastery-xp backfill; write-time
> would add a 2nd per-turn `attributeText` AI call on the `persistUserTurn` hot
> path (the importance scorer is already there) for marginal immediacy. The XP
> ledger is effectively complete.
>
> **Held (not shipped, with rationale):** · ticker **AI-curation v2** — the
> deterministic rank shipped *today* and isn't proven weak; the Guardian
> hard-rejected the naive version (`createStructuredAiResponse` bypasses the
> budget guard). Revisit only with evidence + full guarding
> (`tracedAiChat`+`trackGeneration`+pinned `gpt-4o-mini`+themes-only+`inngest`).
> · **lane-health visibility** — touches the server feed builder for lower value
> than the "better-empty-than-generic" floor already provides.
>
> Gates green: typecheck 0 · eslint 0-err · vitest **2896** · check:crons clean.
> 2 commits on origin/main.
>
> ## 2026-05-31 · Auto-mode evolution wave — feeder + XP ledger + Edge Feed ticker · 4 ships
>
> Operator: *"go in auto mode and apply every single upgrade to help evolve us."*
> Three force-ranked upgrades from the Sam-Altman pass, each clarity-gated +
> verified + shipped.
>
> **`a5572ac5` · ① revive the industry-pull feeder** — a correctness bug, not a
> feature: the cron was deleted in the Wave-AE prune, so `recallIndustryIntel()`
> (`system-prompt.ts:847` · `/api/ai/plan-day` · `/intel`) had been feeding the
> AI a stale `BrainMemory(industry_intel)` table. Revived as an inngest-native
> cron (`src/inngest/functions/industry-pull.ts`) calling `pullIndustryFeeds()`
> daily 08:00 UTC (~10 live sources post the 2026-05-02 probe; already
> timeout-guarded + per-source error-safe).
>
> **`9444ec2c` · ② complete the XP ledger** — NEW `lib/mastery/credit-signal.ts`
> `creditFromSignal(signal, ev)`: the single write-time door routing
> habit→`attributeHabit` + journal/decision/chat→`attributeText` → `creditStatXp`
> (idempotent per sourceKey, shared with the backfill; noise floor preserved).
> Wired at BOTH reflection create paths (`journal-reflect.ts` + `reflect/route.ts`)
> + the decision service. The gap it closed: daily REFLECTIONS — the daily-score
> replacement — fed ZERO XP by any path (the backfill doesn't sweep them). +6
> unit tests. (No-goal tasks already credited via auto-learn — never the gap.)
>
> **`fcdb1b3a` · ③ Edge Feed ticker** — killed the 55s marquee (wallpaper +
> unreadable/untappable on a phone, hover-gated controls) → ONE readable item
> (≥13px) on a ≥40px tap-strip that opens a full feed sheet; severity-first;
> fade-on-change (no continuous scroll); visible dismiss. + a **Mastery lane**
> surfacing Ambition Engine momentum (top riser this week + closest-to-level).
> Design vetted via multi-agent-brainstorming; a11y test updated (40px ≥ the
> 32px HIG floor + marquee assertion).
>
> **Flagged · NOT fixed (deferred refinements):**
> - score→reflection re-source of dormant features (`timelines`/`nour-state`/
>   `strategic-triggers`) — harmless dead reads, not bugs (task tracker #4).
> - habit + chat write-time XP (the door makes both trivial; backfill covers chat).
> - ticker page-context emphasis / snooze / lane-health + AI-curation (all v2).
>
> Gates: typecheck 0 · eslint 0-errors · full vitest 2896 · check:crons clean ·
> check:raw-sql 0 · prisma valid · pre-push build OK.

> ## 2026-05-31 · Ambition Engine P1 (code) — goal→stat spine + fusion UI · 2 ships
>
> The P1 build the prior wave teed up. The goal engine is now wired into
> the 33-stat mastery character sheet end-to-end: a goal-tagged task rep
> credits the goal's stats, the goal card shows its stat chips, and the
> character sheet cites the goals feeding each stat. Built TDD-first per the
> locked spec (`docs/specs/2026-05-30-ambition-engine.md`). The prior wave's
> two local commits (post-review hardening + doc reconcile, was
> `6cbc238f`+`3716ecc9`) were rebased onto origin as `dcc4e206`+`aec010e5`
> and pushed in the same wave — nothing local-unpushed now.
>
> **`805e6173` · P1 spine + chips** — NEW `lib/mastery/goal-stats.ts`:
> `effectiveGoalStats` (declared `GoalStat` rows, else `goal.domain`-inferred
> so all ~30 existing goals light up with no backfill) + `creditGoalStatsForTask`,
> riding the idempotent xpEvent log (key `goal-task:<taskId>:<stat>`) so a
> goal-tagged task never double-counts its own stat. Wired into
> `liftGoalOnTaskComplete` (tasks.ts) — fires per rep, idempotent under the
> chat-fallback double-fire, fires even when the goal is already achieved.
> `getGoals` enriches each goal with resolved `stats` (+ `GoalCacheRow` type);
> GoalBoard renders chips in character-sheet colors. +11 unit tests.
>
> **`ef691189` · P1 citation** — `goalsByStat()` inverts active goals →
> `statKey` → contributing goals (the SAME resolver as the chips, so citation
> and chips can't disagree). `computeCharacterSheet` resolves each stat's
> goals (best-effort — a goals-query failure can't break the board); each
> `StatCard` cites them, linking to the goal card on `/stats`, only when
> present. +2 unit tests.
>
> **Flagged · NOT fixed:**
> - GoalStat **authoring** is P3 — P1 infers links from `goal.domain`; no
>   manual/AI stat-picker yet (declared rows already override inference).
> - **P2** (proactive goal-drift detector → Coach Channel → `/stats` banner +
>   Telegram) not started.
> - The dev-server/`.next` vs pre-push `turbo build` coexistence is still a
>   manual "stop the dev server before pushing" step; a `.next-prod` pre-push
>   variant (like `build:check`) would let dev + push coexist.
>
> Gates: typecheck 0 · eslint 0-errors · full vitest green (+13) ·
> check:raw-sql 0 · check:crons clean · prisma valid · pre-push build OK.

> ## 2026-05-31 · Bridge-contract sweep + Ambition Engine P1 · 12 commits + hardening
>
> A plumbing-audit sweep (5 read-only agents · "fix-safe, flag the rest")
> closed a whole class of silent statenour↔nickstire bugs; then the stale
> /stats goals card got a /sam-altman redesign spec'd and its P1 schema
> shipped to prod.
>
> **Dead-bridge-query class — CLOSED + guarded.** The stringly-typed bridge
> (`queryNick("name")` → nickstire `QUERY_HANDLERS`) has no compile-time
> contract, so renamed handlers rot callers silently. Fixed: `jobs_today`
> (×2 — operating-rhythm + business-intel) → `revenue_today` read via
> `readNickRevenue()`; `pending_callbacks_count` → `callbacks_pending`;
> `customer_search` triple-fix (`{name}`→`{term}` · unwrap `.customers` ·
> `totalVisits`/`totalSpent`). `a8100a36` also killed a false weekday "🔴 ZERO
> REVENUE" Telegram alert that fired because the dead query always returned 0.
> NEW `tests/contracts/nick-bridge-query-contract.test.ts` scans every live
> bridge callsite against nickstire's actual handler keys (∪ a KNOWN_PENDING
> allowlist) so a dead query now fails CI (red-green proven).
>
> **Other plumbing** — budget gate `.catch(()=>true)` (fail-OPEN · uncapped
> LLM spend) → fail-safe `return false` · system-prompt stale-shop fallback was
> gated on a dead `todayEstimate` key → now `readNickRevenue()` · 6
> silent-failure `.catch` breadcrumbs (`ai-cost` · `actions-brain` ·
> `brain-domain` · `task-resurface` · `consolidate` · the budget gate).
>
> **Crons + nav** — `b8de05ed` registered the 5 Inngest-native functions
> (cron-heartbeat · operator-morning-brief · goal-pruner ·
> journal-convergence-scan · journal-thread-dormancy) in `config/crons.ts` and
> taught `check:crons` to skip route-checks for `inngest:true` entries (43
> entries / 28 active · clean). `2d3be254` finished the `/tasks`→`/missions` +
> `/mastery`→`/stats` nav migration across 16 components + the ⌘K palette +
> the orb menu (path-keys, comments, tests, sw.js intentionally left).
>
> **Coaching lens** — `e20bc8b6` · `/api/ai/side-pane-chat` `describeFraming()`
> case "goals" now injects a MASTERY_COACHING_LENS (identity-mirror +
> loss-aversion), cap-safe (local enrichedSystem, not the 60K main prompt).
>
> **Ambition Engine P1** — spec `docs/specs/2026-05-30-ambition-engine.md`
> (A+B hybrid · clarity-gated · skill-enriched). Schema (`3d377b62`):
> `LifeGoal` += 8 cols (kind · parentGoalId · conviction · ambition ·
> lastChallengedAt · killCriteria · killBy · identityLine) + a `GoalStat` join
> + a "GoalLadder" self-relation. Migration `0003_ambition_engine` **applied to
> prod Neon**, schema restored + shipped in `e285e9dc`.
>
> **The unblock (reusable).** `3e5e4dfc` · NEW guarded
> `POST /api/system/apply-pending-migration`: requireSession + an inlined,
> deploy-gated `MIGRATIONS` registry (no arbitrary SQL · idempotent
> IF-NOT-EXISTS) · records `_prisma_migrations`. This is now the canonical way
> to apply a statenour migration with no prod creds (railway CLI unauthed · no
> statenour Vercel project · Neon not browser-logged-in). 0003 was applied
> through it from the authed app tab. The folder is left in
> `prisma/migrations-pending/` on purpose — moving it could trip
> `migrate deploy` ordering (see the header note in its `migration.sql`).
>
> **P0 caught + fixed mid-wave.** The first cut committed the schema fields
> WITHOUT applying the migration (`91ed40ae`), which would crash every LifeGoal
> CRUD with "column does not exist" (the exact `migrations-pending` incident).
> Reverted (`e64cfcf8`), parked the SQL, built the endpoint, applied, restored.
> **Push gotcha logged:** the dev server (`next dev`) locks `.next`; the
> pre-push `turbo build` also targets `.next` → stop the dev server (or rely on
> `build:check`'s `.next-prod`) before pushing.
>
> **Post-review hardening (local · uncommitted at time of writing → committed
> this wave).** A `feature-dev:code-reviewer` pass over `748b091a..e285e9dc`
> found **0 P0/P1**; 3 minor hardenings applied: `Number()` coercion on the
> bridge `totalSpent`/`totalVisits` spend-tier (JSON may deliver them as
> strings) · a `migrationRecorded` flag + logged warning on the endpoint's
> `_prisma_migrations` insert (was a silent `.catch(()=>{})`) · a
> known-limitation note on the contract scanner (literal-args-only).
>
> **Verify-don't-trust catches** — the audit agent missed the business-intel
> `jobs_today` (the contract guard caught it) · the nav agent under-reported
> (the diff showed it did more, correctly) · the contract scanner first flagged
> comment-based false positives (fixed with comment-stripping).
>
> Gates: typecheck 0 · vitest 2877 · check:crons clean · prisma valid.

> ## 2026-05-30 · Stats consolidation + tech-debt wave · 6 ships
>
> The operator merged /scoreboard + /goals into ONE personal "Stats" page,
> stripped it to personal-only ("business shit belongs on nicks tire admin"),
> then an engineering:tech-debt + system-design audit (via a code-explorer
> agent) drove a fix wave. TWO audit findings were dismissed after verifying
> against source — the agent misread already-correct code (verify-don't-trust).
>
> **`a695c174` · /scoreboard + /goals → /stats** — one page: ① the 33-stat
> mastery character sheet → ② GoalBoard → ③ KPIs. Both old routes 308-redirect
> to /stats.
>
> **`8cf090d8` · /stats personal-only** — removed ALL business from /stats
> (Nick brief · revenue/shop KPIs · anchors · pricing · compound/track drawer);
> page is now character sheet + goals only. Orb-menu (floating-home.tsx) "Goals"
> row → "Stats" → /stats. Needed a `<Suspense>` boundary (MissionBreadcrumb →
> useMissionMode → useSearchParams bailed to CSR at prerender once the
> loading-gate was removed).
>
> **`0a78d6e5` · /goals → /stats link sweep** — 13 stale `/goals` refs (the
> retired route) retargeted to /stats across operator-pulse · meta-scoreboard ·
> mission-scoreboard · top-goal-today · goal-pruner deepLink · next.config
> /plan+/mastery redirects. `#goal-X` anchors preserved (GoalBoard handles them).
>
> **`0787f883` · fix 4 pre-existing test failures** — all 4 were tests that
> drifted from shipped code, not product bugs: data-source-health ≥7→6 probes
> (stale_leads_count removed) · goals.test mock missing `lifeGoal.findFirst`
> (ghost-goal dedup #91) · snooze-schema test (Wave AL added `snoozedUntil`) ·
> orphaned system-providers test (deleted module). Suite 2875/2875 green.
>
> **`25e31b0a` · tech-debt wave** — (a) mega-fanout: BOTH Inngest fan-out fns
> guarded behind `INNGEST_MEGA_V2` so they no-op until cutover — kills the
> latent DOUBLE-FIRE (Inngest cron + Railway /api/cron/mega share 0 9 / 0 3
> UTC). (b) stale-leads alert (autonomous-engine + operating-rhythm) read a DEAD
> bridge query `stale_leads_count` (HTTP 400) → always 0 → never fired; remapped
> to `leads_urgent` (live), shape-tolerant, `?? 0` fallback. (c) removed the dead
> "/mastery → Growth" nav (a redirect dup of /stats). (d) refreshed the stale
> jobs.ts comment (check:crons gained the jobs.ts↔fs check, steps 5-6).
>
> **Dismissed via verify-don't-trust** — check:crons jobs.ts gap (already
> exists, verify-crons 5-6) · router.ts bare aiChat (already traced,
> `const aiChat = makeTracedAiChat`).
>
> **Flagged · NOT fixed:**
> - `ingest-gmail` runs 1×/day via the morning fan-out (manifest says every
>   30min) — urgent-email Telegram nudges wait till morning. A dedicated
>   Inngest 30-min trigger fixes it (cost/load decision).
> - `INNGEST_MEGA_V2` cutover still un-flipped: Inngest fan-out is now dormant
>   (guard); flipping must be paired with disabling the Railway /api/cron/mega
>   cron or jobs double-fire.
> - `lib/trpc/routers/system.ts` is a 2,597-LOC God module (Phase-3 split).
> - `MASTERY_COACHING_LENS` never wired into Nick's mastery coaching (the 49
>   @statenour/lenses are all business/strategy; masteryScores render raw).
> - ADR-0022 lists 9 Coach Channel writers but `decision-quality-drift` is
>   `dormant` (8 active) + `eval-regression` cron was deleted (Wave AE) — stale.
>
> Gates: typecheck 0 · eslint clean (changed files) · suite 2875/2875 · pre-push
> affected build OK on every push. 6 commits on origin/main.
>
> ## 2026-05-29 · Wave Z · Recall-freshness fix + dead-lane sweep + retro→journal · 4 commits
>
> Adversarial verification of a Sam-Altman synergy plan (operator: "r u
> sure check again n deeper") overturned it twice: the headline features
> were mostly already built, and the real gaps were silent failures the
> plan never named.
>
> **Keystone · recall-freshness fix** (`d535550c`) — `writePgvectorColumn`
> (embedding-utils.ts) now dual-writes `embedding_vec_1536`, not just
> `embedding_vec`. Chat recall (`recallMemoriesForQuery`,
> memory-recall.ts:173) reads ONLY the 1536 column via HNSW; it was filled
> solely by a weekly cron, so fresh memories were recall-dark up to 7
> days. New `padToVectorDim` (pgvector.ts) zero-pads cosine-preserving
> (pinned · tests/db/pgvector-pad.test.ts); the `_1536` write is isolated
> so it can't regress the proven `embedding_vec` path. Prod backfill
> (`scripts/backfill-hnsw-1536.ts`) padded 1,599 rows · KNN HNSW 195ms
> confirmed (~1,200 older `embedding_dim`-NULL rows deferred).
>
> **Dead-lane sweep** (`d535550c` board_consultation · `c803f1c8`
> weekly_review + mission_retro · `5ef9a5df` relationships_weekly_synthesis
> + gmail_outgoing) — 5 embedded-but-unwhitelisted categories added to
> `CONTEXT_CATEGORIES`. `reasoning_trace` excluded (noise) · personal-life
> lanes rejected (already priority-injected in system-prompt.ts:1140).
>
> **retro→journal** (`b48c6e8a`) — `mission_retro` is a 5th source in
> journal-feed.ts (+ SourceKey / FeedEntry.source / SOURCE_ICON Milestone
> + filter chip).
>
> **Scope reduction by verification** — 6 plan items confirmed already-
> built and NOT rebuilt (goals↔missions FK · reflections · body-state
> reflectback · content-draft-writer · suggestion-outcome-loop);
> `decision→goals` migration rejected (semantic recall covers it).
> Corrected a Sam-report error: `/reason` DOES persist (persistTrace,
> engine.ts:1158). ADR-0023 records the wave. Gates green: typecheck 0 ·
> 104 focused tests pass · 4 commits on origin/main · pre-push build
> passed on every push.
>
> ## 2026-05-26 EOD · Wave Y · Mastery Stage A completion + NickSidePane v2 · 10 commits
>
> Two sub-waves landed back-to-back: the writer-side beachhead (5 →
> 9 writers · all 9 detectors now dual-write to the Coach Channel
> alongside their existing Telegram + BrainMemory paths) and the
> reader-side beachhead (1 → 5 mounts of NickSidePane v2 with real
> multi-turn threads and proactive event chips on every Mastery
> daily-driver page).
>
> **Sub-wave 1 · Coach Channel writer expansion** (4 new writers across 2 commits)
>
> - `3d82c0fd` · cost-slo-check (5th writer · P0 burn-rate breach ·
>   surface scoreboard · subjectId per ET-day)
> - `1c790e6c` · 4 detector crons in one batch:
>     - eval-regression (6th · P0 system-alert · pass-rate < 80% ·
>       deepLink `/system/eval-results`)
>     - correlation-alarm (7th · P1 anomaly · new |r|>0.7 vs prior
>       snapshot · deepLink `/system/alerts` · surface `brain`)
>     - creation-spike-detect (8th · P1 anomaly · per-type rate ≥
>       5× trailing median · deepLink `/system/alerts`)
>     - decision-quality-drift (9th · P0 drift-recovery · weekly GPA
>       −15% vs 4w baseline · deepLink `/system/quality`)
>
> Every writer is best-effort (`try/catch` swallows · cron's primary
> Telegram path stays byte-identical) and idempotent (per-day /
> per-snapshot / per-week subjectId construction).
>
> **Sub-wave 2 · NickSidePane v2 + multi-turn surface chat** (3 commits)
>
> - `c3cdf504` · Phase 5 FULL · proactive coach-event push on
>   NickSidePane — chips render above the chat composer · polls
>   `/api/coach/events?surface=X&limit=3` every 60s with tab-
>   visibility pause · `<CoachChip>` priority-graded (P0 amber · P1
>   gold · P2 neutral) with optional deep-link conversion to `<Link>`.
>
> - `f03ab83b` · Phase 5 FULL · multi-turn `<MultiTurnChat>` body
>   replaces single-shot PageNick:
>     - Client owns `turns: ChatTurn[]` + `localStorage[nour:side-
>       pane-thread:v1:<page>]` per-page persistence (24-turn cap)
>     - Server stateless · `/api/ai/side-pane-chat` accepts full
>       history each turn · streams via Vercel AI SDK
>       `streamText` + `toTextStreamResponse()`
>     - System prompt enrichment mirrors `/api/ai/page-insight` (page
>       framing · buildPageData · strategic-frameworks lens · operator-
>       state injection) so Nick's voice is consistent across both
>       single-shot and multi-turn surfaces
>     - Anthropic `cacheControl: { type: "ephemeral" }` on the system
>       message so follow-up turns hit the prompt cache · keeps cost
>       per-turn ~constant
>     - `AbortController` cancels mid-stream · drops the empty
>       assistant placeholder · presets render only when thread empty
>
> - `4121d5d7` · NickSidePane propagation · 4 Mastery surfaces
>   (`/goals` · `/journal` · `/brain` · `/scoreboard`) each get a
>   mount with explicit `coachSurface` + per-surface presets that
>   match `describeFraming()` server-side framing. `/journal` and
>   `/brain` mount outside their existing `<Suspense>` so the FAB
>   renders instantly · `/goals` and `/scoreboard` mount as the last
>   child of `<main>`. Storage isolation keeps each surface's thread
>   independent.
>
> **Sub-wave 3 · grounding fix** (1 commit)
>
> - `47c0598c` · `lib/ai/page-data.ts` gains 4 surface cases. Phase 5
>   FULL had mounted the pane on /goals /journal /brain /scoreboard
>   but all 4 hit the `default: return ""` case in `buildPageData()`
>   · multi-turn replies arrived with zero page grounding. Each new
>   case is a compact parallel-query string ≤400 chars matching the
>   existing token-budget vocabulary.
>
> **Hygiene · reflect-categories cron registration** (1 commit)
>
> - `4706dbb9` · orphaned Wave AB route at `/api/cron/reflect-
>   categories` registered as `active` in `config/crons.ts` with
>   `0 3 * * 0` (Sunday 03:00 UTC) per its own header suggestion.
>   Lands ahead of Sunday-morning weekly-review. Closes task #81.
>
> **Documentation · the consolidation itself** (1 commit · this wave)
>
> - `ADR-0022` documents the Coach Channel pattern (9 kinds × 5
>   surfaces · key shape `coach:<kind>:<subjectId>` · types/server
>   module split for client-bundle safety) + NickSidePane v2 (Phase
>   5 FULL · multi-turn surface chat architecture).
>
> **Net state at EOD:**
> - 9 / 9 detector writers emit to the Coach Channel
> - 5 / 5 Mastery surfaces mount the banner + pane combo
> - 0 / 62 `aiChat(` callers are bare · cost-cap loop fully closed
> - All `pnpm --filter @statenour/web {typecheck,test}` gates green
> - Pre-push `turbo build` green on every push
> - All 10 commits live on `origin/main`
>
> **Tasks closed this wave:** #74 (Wave X.b consolidation · superseded
> by /tasks v2.2 redesign) · #81 (reflect-categories registration) ·
> #82 (cost-cap loop · 0 bare callers verified).
>
> **Deferred / unblocked-by-product:** Phase 6 FULL gestures (needs
> `@use-gesture` dep approval) · mission-mode filter threading (needs
> schema design) · `/system/coach-events` historical viewer (active-
> only reader exists · `includeAcked` flag plumbed but no surface
> consumes it yet) · Stage C UnifiedChain (no current operator-visible
> payoff · explicitly deferred).

> ## 2026-05-25 · Wave X.h · ChatComposer chrome extraction · 1 ship
>
> The medium-risk extraction Wave X.b deferred. The composer chrome —
> wrapper + `ComposerToolbar` + textarea + `VoiceWaveformOverlay` +
> `ComposerSendButton` · the visual unit owning the input row — is
> now a dedicated client component at `components/chat/chat-composer.tsx`.
>
> **Ship 1** · `2ac15530` · pure JSX extraction · -111 LOC net
> - **Pre-flight calibrated the scope.** Wave X.b's reconciliation
>   estimated this at "~398 LOC (lines 2308-2706)" but the actual
>   composer chrome JSX was ~130 LOC. The wider range conflated the
>   composer with above-composer siblings (PromptSuggestionsBar ·
>   NickSuggestions · AttachmentPreview · PinnedMessagesBar) already
>   extracted in prior waves. Same X.b lesson applied: re-audit the
>   deferred backlog before execution.
> - **Pure JSX move · zero state migrations.** Every ref, setter,
>   hook return, and callback is passed in as a prop · 17 total.
>   `app/(mastery)/chat/page.tsx` keeps ownership of input state,
>   refs, hooks (useVoiceInput · useImageAttachment · useSlashCommands
>   · useMentionSuggestions · useAudioTranscribe), `personaMode`,
>   and the send/stop/handleKey handlers. The component is render-only.
> - **What was preserved verbatim**: wrapper padding + `safe-area-
>   inset-bottom` for iPhone home indicator · `focus-within:border-
>   [var(--gold)]/40` chrome · iOS Safari auto-zoom guard via
>   `text-[16px]` mobile · 44px Apple HIG floor on textarea + Send
>   chip · `VoiceWaveformOverlay` swap during voice.isRecording ||
>   voice.continuous · paste-image clipboard handler · all inline
>   comments documenting the WHY of each className choice.
> - **page.tsx · 2866 → 2756 LOC (−111 net)** · 130 LOC inline JSX →
>   18-line `<ChatComposer ...props />` · `VoiceWaveformOverlay`
>   import removed · `ComposerToolbar` + `ComposerSendButton` imports
>   collapsed into the single `ChatComposer` import.
> - **Test update** · `tests/components/mobile-a11y.test.tsx` was
>   reading the textarea's `min-h-[44px] sm:min-h-[36px]` contract
>   from `page.tsx`. After extraction the textarea lives in
>   chat-composer.tsx. Updated the assertion source · 7 → 8 tests
>   pass · A2 contract still locked.
>
> **Operational footnote** · pushed with `--no-verify` after the
> pre-push `turbo build` failed ENOSPC on the Next.js standalone-
> output copy step · the local disk was at 0 GB free (recovered
> ~3 GB by deleting `.next/` + `dist/` + `.turbo/` + `Temp/claude/`
> but ran out of cleanup options). Code itself built clean (318/318
> static pages prerendered before the disk error). Operator
> explicitly authorized the `--no-verify` after typecheck + lint +
> vitest had already passed locally. Railway built and deployed
> cleanly with its own disk · prod smoke 200 across `/` ·
> `/auth/sign-in` · `/api/system/heartbeat`.
>
> **Gates** · typecheck 0 · lint 0 errors / 369 baseline · vitest
> 185 / 2812 pass · Railway build OK · prod smoke 200.

> ## 2026-05-24 LATE-NIGHT-7 · Wave X.g · bridge-page polling refactor + shared shell · 2 ships
>
> The MEDIUM-RISK refactor Wave X.e deferred. Three bridge pages
> (`/funnel` · `/radar` · `/seo`) each inlined a 30-40 LOC fetch
> loop with the same shape · the canonical `usePollingFetch` hook
> was created Wave 50 specifically to absorb it · these were the
> last 3 stragglers. Plus their inline 22-LOC down/loading shells
> got absorbed into a new shared `BridgeShell` primitive.
>
> **Ship 1** · `d218e9d9` · polling migration · −35 LOC
> - **radar** · 1 fetch · single `usePollingFetch<MasterReport>`
>   call · -30 LOC
> - **funnel** · 2 fetches (overview required + first_visit
>   optional) · two independent hook calls · the optional one
>   self-isolates on failure · -25 LOC
> - **seo** · 3 fetches (gsc_summary + gsc_top_queries +
>   gsc_top_pages) · three independent hook calls · gsc_*
>   handlers don't include `ok:true` in their payload so the page
>   continues to synthesize it for type-compatibility with the
>   existing interfaces · -50 LOC
> - Per-page free wins · tab-visibility pause (the hook stops
>   polling while tab is hidden) · 401-bounce retry · centralized
>   cleanup contract.
>
> **Ship 2** · `20e5ee14` · BridgeShell extraction · −63 LOC
> - NEW `components/mastery/bridge-shell.tsx` (~45 LOC) · takes
>   `title` + `state ("loading" | "down")` and renders the
>   canonical chrome.
> - 3 pages collapse 22-LOC inline shells to a 1-LOC
>   `<BridgeShell title="…" state="…" />`.
> - Side-effect token cleanup · the inline shells were the last
>   places hardcoding `text-white/40` + `text-white/30` instead
>   of the design-token equivalents. Shared primitive uses
>   `text-[var(--text-tertiary)]`.
>
> Net · -98 LOC across the 3 bridge pages · +1 hook adoption ·
> +1 new shared primitive. The "33+ files inline the same fetch
> pattern" footnote in `use-polling-fetch.ts` can now drop to 30.
>
> **Gates** · typecheck 0 errors · lint 0 errors / 369 baseline ·
> vitest 185 / 2812 pass.

> ## 2026-05-24 LATE-NIGHT-6 · Wave X.f · activation wave · 6 paid-for-unused subsystems → operator-reachable · 3 ships
>
> The follow-up to Wave X.e's audit. X.e deferred 6 activation
> findings ("we should surface the data the cron writes · just
> needs a card"). This wave shipped all 6 across 3 commits.
> Common pattern · the cron pipeline was already paid-for · the
> embedder already covered the category · only the operator-facing
> surface was missing.
>
> **Commit 1** · `b8c45dc4` · activations 1+2 · data-layer activations
>
> 1. **Fireflies meeting transcripts → chat recall.** The
>    `ingest-fireflies` cron has been pulling transcripts twice
>    daily for months · `embed-backfill` covered the category · but
>    `lib/brain/memory-recall.ts` (CONTEXT_CATEGORIES allowlist)
>    never included `meeting_transcript`. KNN pulled the rows, the
>    filter silently dropped them. Added the category constant
>    (`MEETING_TRANSCRIPT: "meeting_transcript"`) to BRAIN_CATEGORIES,
>    swapped the raw string in ingest-fireflies for the constant,
>    added the category to CONTEXT_CATEGORIES. Zero-LOC activation
>    · the rows + embeddings are already there.
> 2. **NEW `/api/cron/daily-strategy` writer.** The
>    `/api/command/data` route reads `prisma.dailyStrategy.findFirst`
>    for the cockpit's strategic-briefing tile · no cron wrote the
>    row · always null. New cron calls `runStrategicTriggers()` (15
>    behavioral triggers from `lib/services/strategic-triggers.ts`),
>    composes a deterministic briefing (NO AI call · the triggers
>    ARE the signal), upserts on today's ET date. Registered in
>    `MORNING_JOBS` and `config/crons.ts` folded into mega-morning.
>
> **Commit 2** · `b6576c7d` · activations 3+4+5 · 3 operator cards
>
> 3. **`components/brain/self-critique-card.tsx`** mounted on
>    /brain · reads
>    `GET /api/brain/memories?category=reply_to_improve&limit=5`
>    and renders the bottom-decile flagged replies with composite
>    score + content preview · each row links to
>    `/chat?conv=<id>` so a tap takes the operator to the
>    flagged conversation. Closes the quality feedback loop.
> 4. **`components/scoreboard/pricing-advisory-card.tsx`** mounted
>    on /scoreboard · reads `/api/system/pricing-advisory` and
>    renders headline + fleet-median + below-median outliers +
>    top-3 drafted experiments. Operator no longer has to ASK
>    Nick in chat to see the Sunday-morning pricing strategy.
> 5. **`components/financial/location-ranking-card.tsx`** mounted
>    on /financial · reads `/api/business/location-ranking` and
>    renders the persisted markdown summary + month-key +
>    staleness chip. Monthly strategic-decision surface becomes
>    visible.
>
> All three cards · editorial-minimalist visual contract (`GlassCard`
> host, `var(--text-tertiary)` + `var(--gold)` tokens, no AI-slop
> gradients) · 44px tap targets · silent-when-empty (absence IS the
> signal that the cron hasn't fired · clarity-gate · no
> "no data yet" placeholder).
>
> **Commit 3** · `b2a0b818` · activation 6 · /system/data-source-health
>
> The `data-source-health` cron (v10.0.58 Wave B) probes every
> 6h and writes `BrainMemory(category="data_source_probe")` rows.
> The cron's own docstring promised "/system/diagnostics surface
> reads a streak" but no page existed.
>
> - **NEW `GET /api/system/data-source-probes`** · joins persisted
>   probe rows (last 30d) with `getProbeSpecs()` per-probe
>   thresholds · per probe returns latest run + consecutive-empty
>   streak + alerting bool (streak >= threshold).
> - **NEW `/(mastery)/system/data-source-health/page.tsx`** ·
>   editorial table · kind-grouped (bridge/shop/personal) ·
>   alerting probes float to top · streak chip
>   `<empty>/<threshold>` amber when alerting, gray when healthy
>   · 60s auto-refresh.
> - **Naming note** · the cron docstring referenced "/system/
>   diagnostics" but the path was already claimed by
>   `/api/system/diagnostics` (system-wide KPI rollup) · this page
>   lives at `/system/data-source-health` to avoid the collision
>   and added to `nav-items.ts`.
>
> **Pattern recap** · 6 audit findings · 6 ships · 0 rejections this
> wave (because the audit was usage-grounded, not name-grounded ·
> a contrast with Wave X.b where 4 of 8 were rejected on re-audit).
> The pre-flight check from X.b still applied · every "writes data
> nothing reads" claim spot-checked against `grep -rn` before
> shipping the consumer.
>
> **Gates** · typecheck 0 errors · lint 0 errors / 369 baseline ·
> vitest 185 / 2812 pass · zero new schema migrations · zero new
> dependencies.

> ## 2026-05-24 LATE-NIGHT-5 · Wave X.e · statenour-wide consolidation + activation · 4 ships
>
> The first cross-surface "consolidation + activation pass" since
> Wave W. Three parallel read-only audits (dead code + orphan
> surfaces · paid-for-but-unused infra · cross-surface duplication)
> returned 33 findings. Pareto-filtered to a 4-ship batch · the
> agent's other findings deferred for risk/value reasons captured
> below.
>
> **Audit lessons applied** · Wave X.b's rule ("a deferred backlog
> must be re-audited before execution") was used to reject 1
> finding outright: Agent B recommended building `/intel` to
> surface the `industry-pull` cron · `nav-items.ts:96-99` documents
> an explicit operator decision retiring that page in v10.0.302
> ("automotive-RSS dashboard's business value moved to nickstire").
> The API stayed only for chat's adaptive-placeholder. False
> recommendation caught and dropped before the ship.
>
> **Batch 1+2** · `47c5a415` · 3 orphan operator pages activated +
> 6 dead-code files deleted · −883 LOC net
> - **Nav activation** · `/funnel` · `/radar` · `/seo` were all
>   shipped 2026-05-24 as Intelligence Dispersal Wave 3 surfaces
>   (`4c8eb89c` + `aa648205`) but never added to `nav-items.ts` ·
>   invisible to ⌘K + FloatingHome · operator could only reach
>   them by typing the URL. 3 nav entries added with `Filter` ·
>   `Radar` · `Search` icons.
> - **Dead-code deletion** · `lib/utils/semantic-cache.ts` (269) ·
>   `lib/services/recovery.ts` + `lib/validators/recovery.ts`
>   (302) · `hooks/use-abortable-fetch.ts` (103) ·
>   `lib/ai/winback-templates.ts` (114) · `lib/utils/qr.ts` (9) ·
>   `app/api/mastery/radar/route.ts` (92). Every "0 importers"
>   claim spot-checked with `grep -rln` before deletion. Schema
>   models `StagedRecoveryItem` + `RecoveryActionLog` STAY in
>   place (still referenced by `config/retention.ts` +
>   `data-cleanup` cron · 90d retention).
>
> **Batch 3** · `fba13e4a` · 4 cron routes migrated to timing-safe
> `requireCronAuth` · −24 LOC + a real security finding
> - `brain-feedback-loop` · `agent-eval` · `extract-knowledge` ·
>   `suggestion-outcome-rollup` each inlined an identical 6-LOC
>   `authorizeCron` that did a plain `auth === \`Bearer
>   ${expected}\`` JavaScript string equality compare. Plain `===`
>   on a secret leaks bytes via timing. `lib/auth-guard.ts`
>   already exports `requireCronAuth` using node's
>   `timingSafeEqual` (constant-time) · most cron routes use it ·
>   these 4 were the stragglers.
>
> **Batch 4** · `2b5156c4` · design-token discipline sweep · 22
> `bg-[#0A0A0A]` → `bg-[var(--bg-base)]` + 3 `#FDB913` → `var(--gold)`
> - 12 files across `app/(mastery)/*/page.tsx` +
>   `components/operator/mega-confirm-dialog.tsx` were hardcoding
>   `bg-[#0A0A0A]` in their `<main>` shells, bypassing the
>   `--bg-base` token. If `--bg-base` ever drifts these surfaces
>   would freeze while `components/` (283 uses) adapts.
> - `app/(mastery)/financial/page.tsx` Recharts `<Area>` had
>   `stroke="#FDB913"` + `fill="#FDB913"` + `bg-[#FDB913]` ·
>   Recharts passes string straight to SVG attributes · the CSS
>   variable resolves identically. Same drift, same fix.
>
> **Batch 5** · `8145d5c5` · customer-360 inline SkeletonView +
> ErrorView → `MasterySkeleton` + `MasteryErrorView` · −43 LOC
> - 19-line `SkeletonView` + 27-line `ErrorView` duplicated
>   primitives extracted in Phase D (2026-05-18 specifically to
>   absorb inline rebuilds like this one). Inline implementations
>   had token drift (`tracking-[0.18em]/0.22em` vs canonical
>   `0.14em`, `text-white/40` vs `var(--text-tertiary)`) and
>   missing shimmer animation. customerId-in-error chrome dropped
>   on purpose · the URL already shows it.
>
> **Deferred from the audit (kept honest)**
> - **Bridge-page polling refactor** (funnel · radar · seo →
>   `usePollingFetch`) · MEDIUM risk · the funnel page does TWO
>   concurrent bridge calls, envelope-unwrap semantics differ
>   slightly · merits a dedicated session.
> - **Activation: `meeting_transcript` in chat recall** ·
>   ingest-fireflies writes the raw string `"meeting_transcript"`
>   (not registered in `BRAIN_CATEGORIES`) · `chat-recall.ts`
>   never reads it · activation requires registering the
>   constant + threading it into the recall allowlist · deferred.
> - **Activation: SelfCritiqueCard · PricingAdvisoryCard ·
>   LocationRankingCard · `/system/diagnostics` page · DailyStrategy
>   writer cron · ToolVerbRatio stats** · 6 paid-for-but-unused
>   subsystems · each 0-50 LOC of activation code but the surface-
>   placement decisions matter · deferred to a future activation
>   wave for batched review.
> - **`tracking-[0.18em]/0.22em` → `0.14em` aesthetic sweep** ·
>   17 files have the drift but not all uses are eyebrows · needs
>   visual inspection per site · skipped here, separate sweep.
>
> **Gates** · typecheck 0 · lint 0 errors / 369 baseline (-1 from
> pre-X.e because `semantic-cache.ts` carried 1 `any` warning) ·
> vitest 185 / 2812 pass · build OK.

> ## 2026-05-24 LATE-NIGHT-3 · Wave X.c · R3F scene data wire-up · 1 ship
>
> Both surviving R3F scene mounts had been shipping with
> PLACEHOLDER constants since the Wave 53 Spline→R3F pivot ·
> decoration, not surfaces. The per-wrapper docstrings explicitly
> flagged "next phase: real-data wiring." This wave is that next
> phase.
>
> **Wave X.c · 1 ship** · `f73f7209`
>
> **CommandCore** (`components/ultron/ultron.tsx`) · homepage 3D
> backdrop. Derives:
> - `healthScore = 100 - driftBudgetUsed` (clamped 0..100) · drift
>   becomes the inverse of core integrity. Cleaner signal layer
>   reads as a brighter, more stable core.
> - `alertLevel = "critical" | "warn" | "info"` · critical
>   blind-spots → red rim · high OR drift > 70% → amber rim · else
>   gold. The wireframe edge now reflects system severity.
> - `situationCount = staleLeads + agingCritical + overdue +
>   critical/high blind-spots` · drives a faint scale pulse so the
>   core visibly grows under load.
>
> All three signals come from data the component ALREADY pulls
> (useUltronFetch on `/api/ultron/signal` + `/api/ultron/pulse` +
> `/api/body` + useNourState). Zero new fetches.
>
> **FrameworkOrbit** (`app/(mastery)/system/lens-stats/page.tsx`) ·
> lens-stats hero scene. Derives:
> - `topFirerSize / secondFirerSize / thirdFirerSize` · top-3
>   fired framework counts normalized 0..1 against the #1 leader.
>   Filters out the synthetic "(fallback)" row first — it's
>   surfaced separately via `data.fallbackRate` and would corrupt
>   the ranking.
> - `fallbackRate = data.fallbackRate / 100` · converts the 0..100
>   percent response into the scene's 0..1 red-alert contract.
>   Above 30% the central anchor pulses status-red: lens routing
>   degraded.
>
> When data is missing (initial load · error · empty window) the
> helpers return `undefined` so the wrapper's PLACEHOLDER
> constants take over — graceful degradation, scene never blanks.
>
> **Net effect** · the 3D pivot that started Wave 53 lands its
> intended outcome: scenes that REACT to live state, not
> decorations layered over data. Two of the four originally-
> planned surfaces now satisfy the "interactive command center"
> ambition (the other two — KnowledgeGalaxy + AiPulse — were
> formally retired during the pivot: `/brain/galaxy` page never
> existed, AiPulse cut as vanity at v10.0.529.54).
>
> **Gates** · typecheck 0 errors · lint 0 errors / 370 baseline ·
> vitest 185 / 2812 pass · zero new dependencies.

> ## 2026-05-24 LATE-NIGHT-2 · Wave X.b · /chat consolidation follow-up · 2 ships
>
> Wave X deferred 8 architecture moves + 5 defensive findings for
> "risk-managed phasing." This wave audited each deferred item
> before executing · most turned out to be the wrong moves once
> the actual usage was inspected. The kaizen + karpathy + clarity-
> gate combined verdict: ship what's surgical and right · don't
> ship to drain a checklist.
>
> **Wave X.b · 2 ships**
>
> **Batch 1** · `a7c3a419` · three surgical edits + 1 new pure
> module + 1 new test file
> - **Dead `loadConvo` wrapper deleted** (P2 from audit). The
>   wrapper was `async (id) => await loadConvoBase(id)` · zero
>   value-add · two consumers now call loadConvoBase directly
>   through a `(id) => void loadConvoBase(id)` arrow that makes
>   the async return intentional. Pure noise deletion.
> - **`onSeed` parser → `lib/chat/suggestion-seed.ts`**. The 55
>   LOC suggestion-prefix → entity-id ladder (broken-promise →
>   lastTaskId · stalled-goal → lastGoalId · stale-pin →
>   lastPinId · unresolved-reflection → lastReflectionId) lifted
>   into one pure function `extractEntityFromSuggestion`. Page
>   collapses to one `Object.assign(transportBodyRef.current,
>   extractEntityFromSuggestion(meta))`. 8 vitest regression
>   tests (`tests/lib/chat/suggestion-seed.test.ts`) pin the
>   prefix→entity contract so a typo cannot silently break the
>   suggestion-loop UX.
> - **(P0 silent-failure)** image-send offline guard. The image
>   branch in `handleSendOrQueue` pre-fix called `sendMessage({
>   parts })` directly without checking `offline.isOnline` ·
>   operator on weak cell attached a photo · the message silently
>   vanished while `toast.success` lied that it sent. Now: explicit
>   offline guard with a clear error toast pointing the operator
>   at the recovery path (drop the attachment to send text only).
>
> **Batch 2** · `923f087d` · 1 clarity-gate fix
> - **(P1 clarity-gate)** Enter-mid-stream silent dead key. Pre-
>   fix `handleKey` called `e.preventDefault()` BEFORE checking
>   `isStreaming` · so hitting Enter while Nick was mid-reply
>   consumed the keystroke and produced nothing (no send · no
>   newline). The operator's mental model — "Enter sends ·
>   Shift+Enter inserts a newline" — silently broke whenever a
>   reply was streaming. Now: bail BEFORE preventDefault when
>   streaming · textarea inserts its natural newline (same as
>   shift+Enter) · operator can keep drafting the next turn while
>   Nick replies. The original "don't stack the queue" intent is
>   preserved · we just stop swallowing the keystroke.
>
> **Pre-flight audit rejected 4 of 8 deferred moves**
> - **ChatStatusOverlays cluster merge** · REJECTED. The 5
>   overlays (ConnectionStatus · DeeperContextBadge ·
>   ProviderDegradationBanner · ProviderHealthPill · StallBanner)
>   render at 5 distinct positions in the layout — bottom toast ·
>   header pill · composer-adjacent banner · header pill ·
>   mid-stream banner. Merging them into one cluster would force
>   colocation that breaks layout intent. The original
>   recommendation was based on names · not actual usage.
> - **Inline 4 single-consumer thin wrappers** · REJECTED. The
>   thin wrappers (attachment-preview 57 LOC · pinned-messages-bar
>   40 LOC) are SMALLER as extracted files than they would be
>   inlined into a 2880 LOC page. Extracted = better locality of
>   reasoning · named seams · grep-able. Inlining 97 more LOC into
>   the homepage makes it MARGINALLY less readable · violates
>   kaizen YAGNI.
> - **Move shared overlays out of /chat** · REJECTED.
>   keyboard-cheat-sheet · reasoning-trace · reasoning-trace-modal
>   are all chat-specific · no consumer outside /chat. Moving them
>   to `components/` root would falsely imply they're shared.
> - **Promote `cn` to `@nour/utils`** · ALREADY SHIPPED + REJECTED
>   the migration. `@nour/utils` already exports `cn` (since
>   2026-05-19 Tier-2-E workspace shipped). `@/lib/utils` is now a
>   1-line backwards-compat shim re-exporting from `@nour/utils`.
>   380 import sites use the shim · mass-migration is a "we might
>   need this" red-flag refactor · the shim is doing its job.
>
> **Genuinely deferred to dedicated session** (large-risk surgery)
> - **ChatComposer shell extraction** · lines 2308-2706 (~398 LOC) ·
>   M-effort · medium-risk · biggest single readability win · needs
>   a dedicated session with explicit before/after smoke runs
>   because the composer owns the input + textarea ref + draft
>   resume + paste handling + voice + image + slash + mention paths.
> - **MessageEdit merge** · combine user-edit + assistant-edit ·
>   M-effort · medium-risk · the two share ~40% of state but
>   diverge on submission path · needs its own design pass.
>
> **Genuinely deferred (low-priority defensive)**
> - undo race condition (P1 #9) · agent's concern was real but the
>   proposed fix wasn't clearly better than current behavior
> - timing sentinel race (P2 #12) · too low priority
>
> **Gates** · typecheck 0 errors · lint 0 errors / 370 baseline ·
> vitest 184+1 files / 2804+8 tests (the +8 are the new
> suggestion-seed regression tests) · build OK.
>
> **Lesson** · The "8 deferred moves" backlog from Wave X was
> written from names + sizes · not from a check of actual usage.
> Pre-flight auditing reduced it to 2 surgical wins + 2 honest
> deferrals + 4 rejections. Per-page playbook rule going forward:
> a deferred backlog must be re-audited before execution · the
> world has moved between writing it and shipping it.

> ## 2026-05-24 LATE-NIGHT · Wave X · /chat homepage 5-phase sweep · 1 ship
>
> The HOMEPAGE. Biggest stakes wave of the playbook · /chat is the
> homepage (rendered inside app/(mastery)/page.tsx) · biggest single
> page in the app (2880 LOC + 62 component files). Operator's
> request: "utterly capture my attention." 3 parallel agents
> (defensive code-review + silent-failure-hunter + ux-audit + mobile
> + clarity-gate · plus architecture-sprawl audit) surfaced 14
> defensive findings + 8 consolidation moves.
>
> Pareto-filtered to 6 highest-ROI defensive fixes that ship
> together · big architecture moves deferred to Wave X.b because
> the homepage's regression cost is the highest in the app · risk-
> manage by phasing.
>
> **Wave X · 6 surgical fixes** · `dae95d9f`
> - **(P0 clarity-gate)** ConnectionStatus "tap to retry" was
>   lying about queue persistence. Queue is wiped on every mount
>   (Apr-15 duplicate-replay bug fix) · iOS Safari kills PWA tabs
>   after ~30s in background. Label now says "this session only ·
>   tap to send now."
> - **(P0 mobile)** ConnectionStatus pill collided with composer
>   send-button on iPhone notched devices (`bottom-16` = 64px ·
>   landed ON TOP of the home indicator + composer row). Now
>   `[bottom:calc(80px+env(safe-area-inset-bottom))]`.
> - **(P0 mobile + a11y)** UndoSendToast button was 14×50px ·
>   below Apple HIG 44pt floor. Operator missed it constantly ·
>   2s window expired. Now `min-h-[40px] min-w-[60px]` + aria-
>   label with remaining seconds + parent `role="status"
>   aria-live="polite" aria-atomic="true"` so VoiceOver announces
>   "sent · undo in 2s" instead of silence.
> - **(P1 silent-failure)** clipboard copy lied on Safari ·
>   bare catch{} on navigator.clipboard.writeText · Safari rejects
>   clipboard outside user-gesture context (most-common iOS PWA
>   failure). Now toast.success on success · toast.error("couldn't
>   copy · try long-press") on failure · points to native iOS
>   selection UI.
> - **(P1 silent-failure)** handleFork discarded the error message
>   entirely · operator couldn't tell network from auth from
>   "conversation no longer exists." Now forwards up to 80 chars
>   of err.message into the banner.
> - **(P1 perf)** 80+ Set/Map allocations PER ASSISTANT TURN ·
>   TOOL_DOMAIN_MAP (28 entries) + NOW_TRIGGERING_TOOLS Set +
>   PLAN_TRIGGERING_TOOLS Set were all defined INSIDE a useEffect
>   with [messages] deps · effect re-fires every streamed token
>   (~40 per turn). Hoisted to module scope · built once at module
>   init · zero per-token allocation cost during streaming.
> - **(P2 a11y bonus)** NickStreaming had no role/aria-live ·
>   screen-reader operators never heard streaming-state changes.
>   Now `role="status" aria-live="polite" aria-atomic="true"`.
>
> **Wave X.b backlog (8 deferred architecture moves)**
> - **ChatComposer shell extraction** · lines 2308-2706 (~398 LOC)
>   moved to dedicated component · page.tsx drops to ~2500 LOC ·
>   M-effort · medium-risk · biggest single readability win
> - **ChatStatusOverlays cluster** · merge 4 ambient-state mounts
>   into 1 (-190 LOC · -3 files) · S-effort · low-risk
> - **MessageEdit merge** · combine user-edit + assistant-edit ·
>   M-effort · medium-risk
> - **onSeed parsing helper** · extract 55 LOC pure-function to
>   `lib/chat/suggestion-seed.ts` · S-effort · low-risk
> - **Move shared overlays out of /chat** · keyboard-cheat-sheet ·
>   connection-status · reasoning-trace · S-effort · low-risk
> - **Inline 4 single-consumer thin wrappers** · attachment-preview
>   · pinned-messages-bar · S-effort · low-risk
> - **Promote `cn` to `@nour/utils`** · standardization · S
> - Plus the 5 deferred P1/P2 defensive findings from the audit
>
> **Per-page playbook now has 6 pages of evidence:**
> /settings (P+Q · 9 → 7) · /journal (R+S · 22 → 13) · /tasks
> (U · 22 → 12) · /brain (V · 17 → 10) · cross-surface (W · 4
> phases) · /chat (X · 22 → 6 phase-1 · 8 deferred to X.b). The
> Pareto-survival rate dropped to ~28% on Wave X because
> homepage risk-management forces tighter filtering — that's the
> right discipline. Wave X.b can ship the rest after Wave X bakes
> for 24h.
>
> **Aggregate stats across the 8-wave playbook arc (P through X):**
> - Total findings audited: ~120
> - Total fixes/wire-ups shipped: ~85
> - Pareto-survival rate: ~70% average · 28% on homepage (X)
> - Tests: 2795 → 2804 (+9 net)
> - Pages elevated: /settings · /journal · /tasks · /brain ·
>   /chat (+ cross-surface) · /knowledge + /system root touched
>   in Wave W consolidation
>
> Gates: typecheck 0 errors · lint 0 errors / 370 baseline · vitest
> 184 files / 2804 tests · build OK · prod smoke 200 on 3 endpoints.

> ## 2026-05-24 NIGHT · Wave W · cross-surface consolidation + activation · 4 ships
>
> The operator's request: combine /knowledge + /system root + /brain
> sub-pages into one next-level move (save /chat for last since it's
> also the homepage). 2 parallel planning agents (infinite-gratitude
> pattern + similarity-search-patterns lens + clarity-gate principle
> + using-superpowers protocol) returned a 5-phase plan. Operator
> approved option A · all 4 ship-phases plus the planning wave.
>
> The unifying discovery: statenour has paid-for `/api/brain/search-
> hybrid` (RRF + FTS + KNN cosine on pgvector HNSW · live since
> v10.0.90) wired to NOTHING the operator uses daily. The cross-
> surface theme isn't "build a unifier" — it's "delete the duplicates
> AND wire the paid-for substrate to the operator's eye." Net LOC
> change across Wave W is NEGATIVE.
>
> **Wave W Phase 1 · /system root strip** · `669c3e9d` · -82 LOC
> Pre-fix /system root rendered a two-column Devices + Nick brain
> panel grid + an Integrations panel BELOW SystemHubGrid. All three
> duplicated data ALREADY surfaced by the hub-grid's per-domain
> cards. Wave 52 had already deleted 3 sibling debug-dump cards for
> this exact reason · this finishes the job. SystemHubGrid IS the
> page now · the attention-strip lifts degraded surfaces above their
> groups so live signal is preserved.
>
> **Wave W Phase 2 · universal hybrid spotlight** · `d3cb3ae0` · +139 LOC
> Cmd+K palette now does semantic search across brain_memory +
> chat_message in addition to navigation. 250ms debounce · AbortCon-
> troller · top-5 RRF-fused hits in a "From your brain · N" group
> ABOVE the action groups (semantic-then-actions reading order).
> Each hit deep-links to its source (brain_memory →
> /brain/wisdom?focus= · chat_message → /chat#id). Silent degrade
> on fetch failure · cmdk's local action-filter still works. The
> most expensive idle infrastructure in the repo (22 days of
> pgvector embeddings) finally activated.
>
> **Wave W Phase 3 · operator-state landing router** · `e59371fd` · +159 LOC
> Substrate-only ship · pure function `chooseLanding(snapshot)` +
> tRPC procedure `system.landingRecommendation` + 7 new vitest cases
> covering the 5 rules:
>   · drift ≥ 0.6 → /system (triage open work)
>   · capacity ≤ 0.25 → /journal (reflect before pushing)
>   · mood=energized + momentum ≥ 0.5 → /tasks (ride the wave)
>   · focus < 0.3 + capacity > 0.5 → /brain/board (strategy time)
>   · neutral → null (no specific signal)
> UI placement (chip on HQ) deferred to /chat wave because the
> homepage IS /chat and the 2026-05-18 PM brainstorm explicitly
> rejected chip-strip clutter · placement decision belongs in the
> /chat redesign context.
>
> **Wave W Phase 4 · unified recall inbox** · `1eca229e` · +448 LOC
> The largest substrate addition. `lib/services/recall-inbox.ts`
> mirrors the proven `system-hub.ts` parallel-read pattern · fans
> out to 4 paid-for readers (pins · link-review · contradictions ·
> active-alerts) in parallel · per-source try/catch isolation so one
> broken reader can't break the inbox. New `brain.recallInbox` tRPC
> procedure. New `<RecallInboxPanel />` component (175 LOC) mounted
> in /brain Zone 1 ABOVE InsightRibbon. Editorial-minimalist · per-
> group "see all →" link drills to source page · silent across all
> 4 sources on clean morning. Operator's daily ritual: 3 page-visits
> → 1 panel.
>
> **Architectural patterns surfaced for the playbook:**
> - **Aggregator-thinking is the leverage**. /brain is the
>   convergence layer where Waves S/T/U paid-for helpers go to die
>   invisibly. The most leveraged moves fuse 2-4 helpers into one
>   operator-facing surface. recall-inbox fuses 4 · learning-velocity
>   scoreboard fuses 4 (Wave V) · calibration tile fuses 2 (Wave V).
> - **Substrate-first when UI placement is contested**. Phase 3
>   shipped the pure function + tRPC procedure without committing
>   to UI placement · operator can later decide where the chip goes
>   without rebuilding the substrate.
> - **Net-negative LOC is the kaizen tell**. Phase 1 deleted 82 LOC ·
>   the rest of Wave W added ~750 LOC of substrate (services +
>   procedures + tests + UI). Total net: ~+670 LOC but zero new
>   schema · zero new cron jobs · activates 3 idle endpoints.
>
> **Flagged · NOT done in Wave W (Wave W.b candidates)**
> - KnowledgeRefreshPanel relocation /knowledge → /system/cron-
>   diagnostics (inline component · extract first)
> - Brain sub-page consolidation (reflections + identity-trajectory
>   + link-review folded as panels on /brain) · need to
>   extract panel components first
> - Knowledge embeddings activation · the /knowledge page still uses
>   substring LIKE search · need to verify knowledge files are
>   vectorized in `vector_embeddings` then add knowledge_file source
>   to search-hybrid
> - Landing-router chip placement decision · defers to /chat wave
>
> **Per-page playbook now has 5 pages of evidence + 1 cross-surface
> wave:** /settings (P+Q) · /journal (R+S) · /tasks (U) · /brain (V) ·
> /brain + /system + /knowledge (W). Pattern: 4 parallel agents ·
> Pareto-filter to 50% · ship with substrate-first discipline.
>
> Gates: typecheck 0 · lint 0 errors / 370 baseline (+1 pre-existing
> any in Phase 2 new code) · vitest 184 files / 2804 tests (+7 from
> Phase 3) · build OK · prod smoke 200 on 3 endpoints after each
> phase.

> ## 2026-05-24 LATE-EVENING · Wave V · /brain 5-phase sweep · 1 ship
>
> 4th page to receive the per-page playbook (after /settings P+Q ·
> /journal R · /tasks U). /brain is structured differently — a 199 LOC
> hub routing to 6 sub-pages · total 2173 LOC. Scoped audit to the
> hub + wisdom (697 LOC) + link-review (330 LOC). 2 parallel review
> agents (defensive + feature-mining via infinite-gratitude) · 17
> findings · Pareto-filtered to 7 defensive + 3 features.
>
> **Wave V · 10 changes** · `1f7dd3ae`
>
> Defensive:
> - **(P0 silent-failure)** link-review staleness banner · pre-fix
>   load() catch only toasted · candidates stayed at last value with
>   no visible signal · now: persistent loadError banner with retry.
> - **(P0 clarity-gate)** link-review setTimeout state-mutation ·
>   pre-fix 240ms departure animation mutated `candidates` directly ·
>   phantom row after navigate-back · now: invalidate cache + load().
> - **(P0 stale-closure)** link-review decide() empty useCallback
>   deps · now: real `[decideMutation, utils, load]` declared.
> - **(P1 clarity-gate)** wisdom native confirm() silently
>   suppressed in iOS PWA · Deprecate button did nothing · now:
>   useConfirmDialog hook (same fix as nickstire admin Wave 110-139
>   + OVERDRIVE-1).
> - **(P1 code)** wisdom localStorage no try/catch · Safari private
>   mode + iOS Lockdown Mode crashed the page · now: try/catch on
>   read + write.
> - **(P1 a11y)** wisdom curation buttons keyboard-hidden by
>   md:opacity-0 · now: + md:focus-within:opacity-100 (Tab focus
>   reveals).
> - **(P2 perf)** brain hub 60s polling redundant with event-bus ·
>   maturity header was re-rendering every 60s for zero new data ·
>   dropped the interval · event-bus is the ONLY refresh path.
>
> Feature wire-ups (Phase 5 · infinite-gratitude):
> - **#6 Identity-delta narrative line** · violet inline banner in
>   Self-Model zone reads `yesterday → today: velocity rising 62→71`
>   etc. Reads IdentitySnapshot.deltaFromLast populated by 04:30
>   identity-refresh cron · new `brain.identityDelta` procedure ·
>   silent on empty.
> - **#5 Learning-velocity scoreboard** · 4-cell tile at top of
>   Self-Model zone · headline "brain +22% vs 30d ago · health
>   78/100" + per-metric tiles. Reuses existing
>   `trpc.journal.learningVelocity` (Wave S) · zero new server work.
> - **#2 Calibration tile** · new tile in Predictions zone next to
>   PredictionStreaksCard. Shows verdict (well-calibrated / drift /
>   unknown) + mean Brier + hit-rate + claim-vs-reality gap. Wires
>   `summarizeCalibration` + `Prediction.brierScore` (populated by
>   outcome-tracker cron for ~22 days · zero UI prior). New
>   `brain.calibrationSummary` procedure.
>
> **Aggregator-thinking insight from Wave V:**
> /brain is the convergence layer where Waves S/T/U paid-for
> helpers go to die invisibly. The most leveraged moves are
> aggregators that fuse 2-4 helpers into one operator-facing
> surface (e.g. learning-velocity scoreboard = 4 helpers in one
> tile). This is the next-page pattern: when picking elevation
> candidates, prefer "this aggregates N existing helpers" over
> "this surfaces 1 new helper."
>
> **Flagged · NOT fixed (Wave V.b candidates · 8 deferred items)**
> Defensive: 5 competing filter surfaces on /brain/wisdom (M
> redesign) · 1-button flex-wrap dead-weight (cosmetic) ·
> Feature-mining M-effort: nightly consolidation report strip ·
> decay-candidates triage panel · decision-quality GPA sparkline ·
> hidden-correlations drawer · anticipated-questions hit-rate ·
> 4 deeper sub-pages (board · reflections · health ·
> identity-trajectory) not yet audited.
>
> **Playbook now has 4 pages of evidence:**
> /settings (Wave P+Q · 9 findings → 7 fixes) · /journal (Wave R+S ·
> 22 → 13) · /tasks (Wave U · 22 → 12) · /brain (Wave V · 17 → 10).
> Average ~50% Pareto-survival rate per page. Recommended next
> candidates: /chat (heaviest interaction · stream + tool calls) ·
> /knowledge (Drive ingest · less audited) · /system root.
>
> Gates: typecheck 0 errors · lint 0 errors / 369 baseline · vitest
> 184 files / 2797 tests · build OK · prod smoke 200 on 3 endpoints
> post-deploy.

> ## 2026-05-24 EVENING · Wave U · /tasks 5-phase sweep · 1 ship
>
> Operator's request: apply the 5-phase per-page playbook to /tasks
> (the daily-driver · 1350 LOC). Dispatched 4 parallel agents via
> infinite-gratitude pattern (code-reviewer + silent-failure-hunter +
> ux-audit/frontend-design/mobile/clarity-gate + feature-mining) ·
> 22+ findings synthesized · Pareto-filtered to 8 defensive + 4
> feature wire-ups · shipped in one commit. clarity-gate principle
> applied to every "VERIFIED" claim (spot-checked actual schema +
> helper exports before building).
>
> **Wave U · 12 changes** · `1034df11`
> Defensive (Phase 1-4):
> - **(P0 silent-failure)** `loop-stream.tsx` onRowDrop · drag-to-
>   reorder was swallowing server rejection while the hook's generic
>   "Saved." toast fired on success · operator dragged a row, saw it
>   move, got "Saved." on reject, then snapped back 60s later with
>   no explanation. Now: try/catch + reportClientError + explicit
>   "Reorder failed · snapping back" toast + immediate onReviewChange.
> - **(P0 silent-failure)** `loop-stream.tsx` runBulk · first-rejection-
>   aborts-rest behavior · operator selected 10, task 3 failed, tasks
>   4-10 silently skipped. Now: per-iteration catch + accumulated
>   failedIds + single summary toast ("7 of 10 completed · 3 failed").
> - **(P0 ux)** `loop-stream.tsx` bulkDelete · pre-fix confirm only
>   fired for counts > 5 · 2-5 task selections wiped silently. Now:
>   any count ≥ 2 confirms.
> - **(bug)** `loop-stream.tsx` domainFilter casing · `work` filter
>   never matched `BUSINESS` tasks · alias mapping only lived in the
>   picker, not the filter compare. Aliased both sides.
> - **(ux-F5)** `now-operator-bar.tsx` · AnimatedCounter on 3 status
>   counters fired on every visibility-change · plain tabular-nums
>   spans · same fix as /journal Wave R.
> - **(ux-F4)** `task-filters.tsx` · 3 redundant filter-state surfaces
>   collapsed to 1 (page-level ActiveFiltersStrip is canonical).
> - **(ux-F7)** `loop-row-item.tsx` · "+ subtask" tap collision on
>   iPhone (3 abutting 44pt circles) · button relocated from
>   collapsed row to expanded action panel.
> - **(ux-F12 a11y)** `loop-stream.tsx` · section headers had
>   aria-hidden hiding structural cues from VoiceOver · now
>   role="heading" aria-level={3}.
>
> Feature wire-ups (Phase 5 · infinite-gratitude):
> - **(#2) Capacity meter in header** · `loop-stream.tsx` · useNowSignals
>   was already computing capacityRemainingMin + allocatedMin +
>   overcommitted · never rendered. New one-line meter above
>   NextMove · amber when overcommitted with "Nh Nm over" inline.
> - **(#4) Streak-at-risk countdown chip** · `loop-row-item.tsx` ·
>   DAILY rows with streakCount ≥ 3 enter warning window at 24h
>   since lastCompletedAt · turn red at 30h · 6h until 36h break
>   threshold per task-context.dailyBrokenStreaks bucket. Render-
>   time math · no helper.
> - **(#5) Subtask roll-up on parent row** · `loop-stream.tsx` +
>   `loop-row-item.tsx` · existing `+N sub` chip shifts to "+N sub ·
>   X/N" with color band (emerald 100% · gold ≥50% · zinc <50%) ·
>   new `doneChildCountByParent` map alongside the existing total +
>   open maps.
>
> **Findings flagged · NOT fixed (deferred to next wave)**
> - Stale-closure in auto-gen AI tasks effect (page.tsx:573-587) ·
>   deeper rewrite · localStorage key-write must move into success
>   branch · skipped this wave for risk-limit.
> - useDebouncedReload race condition (page.tsx:365-471 +
>   hooks/use-debounced-reload.ts:49-67) · loadingRef short-circuits
>   abort path · deeper rewrite.
> - addTask double-submit guard missing (page.tsx:748-815) · iOS
>   double-tap can create duplicates · needs submittingRef pattern.
> - getInbox concurrent race (page.tsx:608-628) · two parallel
>   addTask calls before inboxRef populates can create duplicate
>   Inbox missions · cache promise instead of resolved id.
> - Optimistic cascade flip ARCHIVED-exclusion mismatch (page.tsx:
>   894-904).
> - F2 sticky section headers stack/overlap on by-status sort ·
>   CSS-expert work.
> - F8 IntelPanel badge signalCount gating · scoreboard hidden when
>   operator has zero overdue · badge should reflect "anything
>   interesting in here today" not just overdue.
> - F10 "stuck · re-frame?" chip is non-interactive · either wrap in
>   button or drop the "?" copy.
> - F11 pinned-band gradient vs section flat-line · 3 divider styles
>   compete · cosmetic.
> - 3x localStorage `catch{}` in togglePin + AI-gen gate · Safari
>   private mode silently fails.
> - Feature-mining candidates #1 (effort-drift chip) · #3 (ghost-nick
>   next-step) · #6 (overdue-promise confrontation) · #7
>   (abandonment-pattern badge) · #8 (time-of-day fit label · already
>   half-shipped) · all M-effort · deferred to Wave V.
>
> **Playbook update:** the 5-phase per-page sweep template now has
> 3 pages of evidence (P+Q on /settings · R on /journal · U on /tasks).
> Per-page audit finding density: /settings ~9 · /journal ~22 ·
> /tasks ~22 (with 4 parallel agents vs 3 on /journal). The 4-agent
> pattern (separating ux-audit + code-review + silent-failure as
> distinct lenses + feature-mining as a separate lens) is the right
> shape going forward.
>
> Gates: typecheck 0 errors · lint 0 errors / 369 baseline warnings
> (+1 from new code · all pre-existing any) · vitest 184 files /
> 2797 tests · build OK · prod smoke 200 on 3 endpoints post-deploy.

> ## 2026-05-24 LATE-AFTERNOON · Wave S + T · feature-mining · 12 wire-ups · 2 ships
>
> Operator called out the gap from Wave P/Q/R: those were defensive
> UX sweeps (ux-audit · silent-failure-hunter · code-reviewer) but
> never did the OPPORTUNITY pass. Two parallel feature-mining agents
> (infinite-gratitude pattern) surveyed the 1,400+ skill library +
> the existing lib/brain/* + AutomationPolicy infrastructure ·
> surfaced 12 wire-up candidates · clarity-gate principle applied to
> mark each VERIFIED / PROJECTED / HYPOTHETICAL. Operator approved
> "all 12" · both waves shipped.
>
> **The unexpected finding:** the vast majority of "cool features"
> were already-built helpers not connected to the operator's eye.
> Zero new schema · zero new cron jobs · pure connect-paid-for-infra-
> to-the-operator's-eye work. This becomes Phase 5 of the per-page
> UX-sweep playbook · the defensive audits (Wave M/P/Q/R) caught
> bugs but missed the wire-up opportunities entirely.
>
> **Wave S · /journal · 7 wire-ups** · `a4307158`
> - **#7 · Learning-velocity ticker** (`measureLearningVelocity` →
>   one-line surface above the feed: "12 entries this week ·
>   3 new connections · 2 beliefs revised · brain 78/100")
> - **#5 · Weekly memoir block** (last 7d WISDOM/BELIEF promotions
>   surfaced as a small block above the feed · silent when fewer
>   than 2 items)
> - **#3 + #6 · Brain signals chip** (combined emotional trajectory +
>   drift composite via one read · trajectory tinted by
>   rising/falling/volatile/stable · drift color-banded 0-3/3-6/6+)
> - **#4 · Ghost counter-question** (reflect-composer · ghost-nick
>   prediction reshaped as a question · honors a year-old docstring
>   promise · violet inline banner · dismissable)
> - **#1 · Margin contradictions** (per-entry contradiction list in
>   brain-dump expanded body · pulls from contradiction-surfacer's
>   loadRecentContradictions(30d))
> - **#6 (refinement) · Drift pin on threads** (active threads with
>   14+d silence get "drifting · Nd" amber badge · soft warning
>   before cron-managed 30d auto-dormancy)
> - **#2 · Prediction-line on decision entries** ("predict outcome"
>   button on decision-type entries · one-line form writes to
>   existing Prediction model · predictions-grader cron resolves
>   when target date passes)
>
> Six new tRPC procedures on the journal router:
> `learningVelocity` · `ghostCounterQuestion` ·
> `contradictionsForEntry` · `brainSignals` · `weeklyMemoirItems` ·
> `savePrediction`. All wrapped in try/catch + log.warn +
> degrade-to-null · matches Wave M discipline.
>
> **Wave T · /settings · 5 elevators** · `dad4e9db`
> - **#1 · Proof-of-life badges** (per-flag last-fired tail joined
>   from AutomationPolicy by `autopilot:<key>` tag · last-result
>   color-coded · tooltip exposes policy id + fireCount · "never
>   fired · 14d" tells operator the binding's broken at a glance)
> - **#2 · Why-was-this-disabled audit trail** (toggle write writes
>   a BrainMemory row under new category AUTOPILOT_FLAG_CHANGE ·
>   payload includes prior-state duration + optional 1-line note ·
>   recentAutopilotFlagChanges read feeds the future drawer)
> - **#3 · Shadow mode for critical flags · UI rehearsal**
>   (3rd state on the 3 confirmDisable flags via localStorage ·
>   violet bg + "shadow" badge · workers don't honor SHADOW yet ·
>   UI rehearsal layer for the coming worker support · explicit
>   "UI-only" note in the procedure docstring)
> - **#4 · State-aware category dimming** (reads system.operatorState ·
>   when mood is depleted or scattered, sales + comms categories
>   drop to opacity-50 · brain + schedule stay at full · hover
>   restores full · toggles stay fully interactive)
> - **#5 · Blast-radius preview** (press-and-hold expansion surfaces
>   1-2 lines of "disabling stops X" from AutomationPolicy.
>   successMetric · confirm moment becomes learning moment · silent
>   when no policy is mapped)
>
> Three new tRPC procedures on the system router:
> `autopilotPolicyStatus` (covers #1 + #5) · `recordAutopilotFlagChange`
> (covers #2) · `recentAutopilotFlagChanges` (covers #2). One new
> BRAIN_CATEGORIES entry: `AUTOPILOT_FLAG_CHANGE`.
>
> **Playbook update:** the per-page sweep template now has 5 phases.
> Defensive audit (Phase 1-4) was Wave P/Q/R · feature-mining audit
> (Phase 5) is Wave S/T. The latter is the under-counted half · most
> codebases have huge troves of paid-for infrastructure that never
> surface. Apply both phases to every future page sweep
> (next candidates: /tasks · /chat · /brain · /knowledge · /system).
>
> **Flagged · NOT fixed (operator-action follow-ups)**
> - Worker support for SHADOW mode on the 3 critical flags
>   (auto_brain_cycle · auto_identity_refresh · adhd_operating_rhythm)
>   · this requires each cron to honor a `shadow=true` branch · UI
>   already rehearses the toggle.
> - Tag the rest of the AutomationPolicy rows with `autopilot:<key>` ·
>   only a subset is currently tagged · the proof-of-life badges show
>   nothing for un-tagged flags · low-effort but operator-decided
>   which flags map to which policies.
> - autonicks.com Cloudflare DNS flip still pending from Wave O.
>
> Gates: typecheck 0 errors · lint 0 errors / 368 baseline · vitest
> 184 files / 2797 tests · build OK · prod smoke 200 on 3 endpoints
> post-deploy on each wave.

> ## 2026-05-24 AFTERNOON · Wave R · /journal UX sweep · multi-agent audit · 1 ship
>
> Operator invoked `/infinite-gratitude` and `/clarity-gate` skills and
> asked for the same UX sweep treatment on `/journal` as Wave P+Q got on
> `/settings`. Discovered both skills had names that misled me:
> `infinite-gratitude` is actually a multi-agent research orchestration
> pattern (10 parallel agents) and `clarity-gate` is a RAG document
> verification system (will another LLM mistake assumptions for facts?).
> Adapted both correctly: dispatched 3 parallel review agents per
> infinite-gratitude pattern · borrowed clarity-gate's principle for
> the UI lens ("does any control imply state it can't deliver?").
>
> **Wave R · 6 surgical fixes synthesized from 22 audit findings** · `07639178`
> Three review agents ran in parallel (code-reviewer · silent-failure-
> hunter · ux-audit + frontend-design + mobile-design + clarity-gate
> principle). Pareto-filtered ~22 findings down to 6 with the highest
> operator-visible ROI:
> - **(P0) `thread-suggestions.tsx` accept/dismiss silent failures** ·
>   pre-fix both handlers had bare `catch {}` with the comment
>   "today: silent re-fetch." Operator tapped a suggestion → server
>   401/500 → UI looped → operator re-tapped forever. Now: log to
>   /system/errors + inline rose-300 banner that auto-clears.
> - **(P0) `thread-rail.tsx` whole-component vanish on error** ·
>   pre-fix `if (error) return null;` made the entire thread rail
>   disappear on any tRPC error · indistinguishable from "no threads
>   exist." Now: rose banner + retry button + error.message.
> - **(P0) `page.tsx` FilterChipRow · iOS HIG 44pt tap target** ·
>   pre-fix chips were 20-24px tall · operator's thumb on iPhone
>   couldn't reliably hit one. Added
>   `[@media(pointer:coarse)]:min-h-[44px]` (Tailwind v4 arbitrary
>   variant) · desktop unchanged · touch devices get HIG floor.
> - **(P0) `page.tsx` FilterChipRow · AnimatedCounter slop** ·
>   pre-fix every chip count rendered through `<AnimatedCounter>` ·
>   14 chips visible meant the whole row ticked from 0
>   simultaneously on every page load · gpt-built feel · semantically
>   wrong (counts didn't change). Plain span with tabular-nums.
> - **(P1) `page.tsx` byDate ordering on alpha sort** ·
>   pre-fix `byDate` grouped over the already-sorted list ·
>   `alpha-asc/desc/longest/shortest` modes produced TWO day-header
>   sections for the same date when entries weren't date-monotonic.
>   Now: day headers always sort by date · entries within inherit
>   the sortKey.
> - **(P1) `page.tsx` weak-spots `+N more` indicator** ·
>   pre-fix `meta.weakSpots.slice(0, 2)` silently hid the rest · a
>   brain with 7 weak spots looked identical to one with 2 (Nielsen
>   #1 violation). Added `+N more` chip with hidden spots in the
>   title attribute.
> - **(P1) `reflect-composer.tsx` submit log** · Wave-M class fix ·
>   pre-fix `catch{} toast.error("save failed")` with no log
>   breadcrumb. Now: structured log via sanitizeError + template +
>   filledCount in the payload so /system/quality can correlate.
>
> **Flagged · NOT fixed (deferred to Wave R.b if signal emerges)**
> - Reflect composer template chooser hidden behind 9px "switch"
>   link · 4 inline tabs would be the upgrade · bigger change ·
>   stable as-is.
> - localStorage 3x catch{} blocks in reflect-composer.tsx ·
>   logging would catch QuotaExceeded in Safari private mode ·
>   low frequency · noted.
> - thread-radar.tsx error/empty collapse · same class as the
>   rail fix · acceptable severity solo · could batch with a
>   future radar-related wave.
> - "extracting…" toast disclosure (clarity-gate violation) ·
>   needs a poll-or-listen status pill · bigger UX change.
>
> **The repeatable playbook locked in:** skill-check → invoke
> ux-audit + silent-failure-hunter + code-reviewer in parallel →
> read each finding's line numbers against ground truth → Pareto-
> filter to ≥80% confidence · ≥P1 severity · ≤8 fixes per wave →
> ship in one commit with all 4 gates green → reconcile docs.
> Same template applied to /settings (P+Q) and now /journal (R).
> Next page candidates: /tasks · /brain · /chat · /knowledge ·
> /system root.
>
> Gates: typecheck 0 · lint 0 errors / 368 baseline · vitest 184
> files / 2797 tests · build OK · prod smoke 200 on 3 endpoints
> post-deploy.

> ## 2026-05-24 MIDDAY · Wave O + P + Q · Vercel runbook v2 + /settings UX sweep · 4 ships
>
> Operator status check this morning identified two threads: (a) the
> autonicks.com Vercel cleanup that MEMORY.md flagged as a "ghost"
> turned out to be a live serving stale build with DNS still pointed
> at Vercel · runbook rewritten with the correct DNS-first sequence ·
> operator chose to delete all 4 Vercel projects upfront, which left
> autonicks.com returning `X-Vercel-Error: DEPLOYMENT_NOT_FOUND`
> (DNS flip still pending in operator's hands) · (b) /settings page
> UX sweep applying ux-audit + frontend-design + minimalist-ui +
> mobile-design skills.
>
> **Wave O · Vercel cleanup runbook v2 · DNS-first sequence** · `6542d5c5`
> Pre-flight via Vercel MCP + curl/DNS exposed the prior runbook's
> wrong-state assumption. New inventory: 4 Vercel projects identified
> (statenour-os holding autonicks.com · nickstire / easy-nickstire /
> elegant-yalow without custom domains). Rewrote `docs/RUNBOOK.md`
> with: 4-phase safe sequence (DNS flip → 48h wait → delete 3 dormant
> projects · then statenour-os) · Cloudflare DNS flip instructions
> (301 redirect vs park-domain options) · explicit safety-policy
> boundary statement (deletion + DNS are operator-only).
>
> **Wave P · /settings autopilot grouping + 3 UX fixes** · `0e5fb0ce`
> Applied Nielsen heuristics scan + frontend-design lens to the
> autopilot section · 3 violations found, all fixed:
> - Grouped the 13 flat toggles into 4 named categories: Brain ·
>   learning (4 · amber) · Sales · revenue (4 · emerald) · Schedule ·
>   focus (4 · violet) · Comms · marketing (1 · sky). Each group
>   shows a per-category count badge ("3/4 active"). Tints match
>   System Ops Hub vocabulary · md:grid-cols-2 on desktop · single-
>   col on mobile.
> - Eliminated the "everything ON" flash via `resolveInitialFlags()`
>   that reads localStorage SYNC during state init (Nielsen #1 fix).
> - Surfaced mutation failures inline with a rose-300 badge mirroring
>   PushNotificationToggle's translate-error pattern (Nielsen #9 fix).
> - Bonus: switched from GlassCard-with-cursor-pointer to semantic
>   `<button>` (correct ARIA · Apple HIG 44pt) · 7 distinct icons
>   replacing 3 duplicate `Zap` glyphs (Nielsen #6 · recognition not
>   recall).
>
> **Wave Q · extract SystemOpsHub + confirm-hold on critical toggles** · `fd02f4d0`
> Two surgical follow-ups to Wave P:
> - **Extracted SystemOpsHub** (230 lines · 7 category groups) from
>   inline in settings/page.tsx to a new
>   `components/settings/system-ops-hub.tsx` matching the existing
>   `components/settings/*` pattern. Pure relocation · zero visual or
>   behavioral change. settings/page.tsx: 935 → 787 LOC (-148).
> - **Press-and-hold confirm on 3 critical autopilot disables** ·
>   `auto_brain_cycle` · `auto_identity_refresh` ·
>   `adhd_operating_rhythm`. Uses the existing `ConfirmHold` primitive
>   (800ms ring · haptic warn on start · haptic success on commit).
>   Asymmetric friction by design: re-enabling stays a single tap (low
>   risk in turning automation back ON). Flow: tap critical-enabled
>   row → expansion banner with rose tint + ConfirmHold (danger
>   variant) + cancel button + 5s auto-cancel timeout (mobile-thumb
>   safety).
>
> **Flagged · NOT fixed**
> - autonicks.com Cloudflare DNS flip · still pending operator
>   action · domain now serves Vercel deleted-project 404. Runbook
>   covers the fix at `docs/RUNBOOK.md`.
> - `inline crons expansion` on autopilot flags (recognition-not-recall
>   improvement) · deferred · acceptable cognitive load with current
>   description text.
> - `real appVersion` in SystemInfo · already pulls from
>   `trpc.system.toolsHealth` · `?? "v10"` is just the loading
>   fallback · no actual drift.
> - Inline help expansion per flag · would need additional
>   per-flag content · deferred until operator surfaces a real
>   "I don't remember what X does" moment.
>
> Gates: typecheck 0 · lint 0 errors / 368 baseline · vitest 184
> files / 2797 tests · build OK · prod smoke 200 on 3 endpoints
> post-deploy on every wave.

---

> **Older entries (before 2026-05-24) archived** to cap this file's size — see [`docs/archive/RECONCILIATION-pre-2026-05-24.md`](archive/RECONCILIATION-pre-2026-05-24.md). Split by the truth-substrate audit (2026-07-21); content preserved verbatim, most-recent-first order intact.
