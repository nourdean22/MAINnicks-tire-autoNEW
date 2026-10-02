# Outcome-ledger coverage census - 2026-10-02

Read-only census of the `IntelligenceOutcome` recommendation-learning loop (model `prisma/schema.prisma:3584-3609`,
service `lib/services/outcome-ledger.ts`, cron `app/api/cron/outcome-harvest/route.ts`). Checkout: branch
`statenour/full-circle-a-exception-coverage`, SHA `2805ac23`. Every file:line below was opened in this session;
every NO cites the grep that produced it. No file other than this one was modified; nothing was installed, built or run.
Prod numbers quoted here are HISTORICAL (dated, from code comments/docs) - section 7 names the queries that would make
them current.

## Summary

1. 9 `recordShown(` call sites in 7 files (+1 `setShownSurface`), writing all 5 declared kinds (`daily_brief` x3 sites,
   `suggestion` x3, `proactive_push` x1, `decision_surface` x1, `prediction` x1).
2. 2 decision call sites total (`recordDecision` x1, `recordDecisionByContent` x1). Values ever written: `accepted`,
   `ignored`, `dismissed`. `edited` has zero writers. `ignored` is written ONLY by a Discover `known` verdict; the schema's
   "set by sweep after TTL" sweep does not exist.
3. 4 outcome call sites (`recordOutcome` x3, `recordOutcomeByContent` x1). All four are operator-triggered (button, verdict,
   task rating). Zero cron/harvest/system closers: the `outcome-harvest` cron only READS.
4. 7 live read sites (2 cron, 2 tRPC, 1 corpus builder, 2 scripts), 1 UI consumer (`/system/fleet`). `outcomesNeedingReview()`
   has ZERO runtime callers despite being named as "the harvester" in 8 non-test comments (10 incl. tests); all four real
   harvesters re-implement its predicate inline.
5. Of 12 recommendation surfaces, exactly ONE (Brain Discover) has shown + decision + outcome. Home `operator.brief` lead,
   Missions deck pick, and Journal `nextAction` are 0/3 - the three highest-frequency surfaces in the product record nothing.
6. The daily brief is ratable ONLY on its failure path: rating buttons live on `sendBriefPush`, which runs solely from the
   35-minute combine backstop; the normal combined push (`intelligence-brief` step 5) carries no `ledgerId` and no actions.
7. Proactive-push and daily-brief ratings write `outcomeUseful`, never `decision`, so every one of those rows is
   "undecided" forever by construction; `undecided %` is not `unlabelled %` and must be reported per kind.
8. The harvest's output (`eval_run:corpus-odometer` BrainMemory row) has no reader that keys on it; the only EVAL_RUN reader
   (`/api/system/cockpit`) filters `createdAt >= 24h` and JSON-parses for `passed`, which the prose row never satisfies.
9. 42 files send Telegram (5 of them with inline buttons); 1 (`proactive-pushes.ts`, 3 of its 5 send paths) ledgers.
   Weekly-digest `prediction` rows and chat `decision_surface` rows have no decision or outcome path at all.
10. Highest-leverage missing joins: (a) `ledgerId` + actions on the combined daily-brief push, (b) `recordShown` + decision
    on Home lead / Missions deck with `resultRef = task:<id>` closure, (c) write `decision` alongside `outcomeUseful` on
    the two rating endpoints (or define the semantic contract that keeps them separate).

## 1. PRODUCERS - `recordShown(` call sites

| # | file:line | kind | sourceEngine | shownSurface | call style | notes |
|---|---|---|---|---|---|---|
| P1 | `lib/inngest/functions/intelligence-brief.ts:348` | daily_brief | `intelligence-brief` | `push+briefing_log` | awaited inside `step.run("save-brief-log")` (:341-352); return id DISCARDED | summary = first non-empty line of `combinedText` (<=500). Different hash from P2/P3's `brief.text`, so the "daily brief" is two rows on a normal day. |
| P2 | `lib/inngest/functions/morning-brief.ts:168` | daily_brief | `morning-brief` | `web-push+home` or `home` (:167) | awaited in `step.run("outcome-ledger")` (:537) via `recordBriefShown` | surface derives from `push.sent`, but post-combine `push` is the synthetic `{sent:1}` from `handOffForCombine` (:290-308), so it is ALWAYS `web-push+home`; `setShownSurface` at :179 then overwrites P3's guess with this synthetic value. |
| P3 | `lib/inngest/functions/morning-brief.ts:225` | daily_brief | `morning-brief` | `web-push` (pre-send guess) | awaited inside try, ledger-first | inside `sendBriefPush` (:204), whose ONLY caller is `sendStandaloneIfUnconsumed` (:333) - the backstop that fires when the combine did NOT happen. Same summary as P2 -> 24h dedup -> same row. |
| P4 | `lib/brain/proactive-pushes.ts:66` | proactive_push | `proactive-${slot}` | `telegram` | awaited inside try, ledger-first; fail-soft to plain `sendTelegram` (:78) | `sendRatablePush` (:62) called from morning :356, afternoon :475, evening :583. `approvals_nudge` (:759) and `fireDueReminders` (:821) send WITHOUT ledgering. Buttons carry the id: `oc:u|n:<ledgerId>` (:88-89). |
| P5 | `lib/trpc/routers/brain.ts:680` | suggestion | `discovery:${d.category}` | `brain-discover` | fire-and-forget `void (async ...)()` (:677-688), loop over unjudged items only | `discoveries` query (:658). Dedup within 24h keeps re-mounts from inflating the denominator. |
| P6 | `lib/brain/discoveries.ts:698` | suggestion | `discovery:${row.category}` | `brain-discover` | awaited inside try (:693-725) | re-ledger at rating time so a row exists to decide on; idempotent on hash. |
| P7 | `lib/trpc/routers/brain.ts:847` | suggestion | `nudge:${n.source}` | `brain-nudge-panel` | fire-and-forget loop (:845-855) | `nudges` query (:833). |
| P8 | `lib/ai/tools/system.ts:1316` | decision_surface | `getTopDecisions` | `chat-tool` | fire-and-forget `void (async ...)().catch(() => {})` (:1314-1322) | summary = top `recommendedAction` (<=300) or "decision inbox surfaced (empty top slot)". The decision itself happens in nickstire's admin Decision Inbox - different app, different DB. |
| P9 | `app/api/cron/weekly-digest/route.ts:81` | prediction | `cashflow-forecast` | `weekly-digest` | awaited inside try/catch (warn) | comment at :72 promises "the resolution loop can score it against actuals". No such loop exists for this table (see 3, 6). |
| P+ | `lib/inngest/functions/morning-brief.ts:179` | - | - | `setShownSurface(id, surface)` | awaited | service :98-109. Only caller. |

Service facts (`lib/services/outcome-ledger.ts`): `recordShown` dedups on `contentHash` within 24h and RETURNS the existing
id without updating (:54-82); `summary` is truncated to 2000 chars (:68); all writes catch and `logError(..., "warn")`.

## 2. DECIDERS - `recordDecision` / `recordDecisionByContent` call sites

| # | file:line | function | decision values emitted | trigger (UI control -> tRPC -> service) | call style |
|---|---|---|---|---|---|
| D1 | `lib/brain/discoveries.ts:705` | `recordDecision({ id, decision, resultRef: "discovery_verdict:<verdict>" })` | `accepted` (investigate), `ignored` (known), `dismissed` (noise) via `VERDICT_TO_DECISION` :97-101 | `components/brain/discover-tab.tsx:226` -> `brain.rateDiscoveryCluster` (`lib/trpc/routers/brain.ts:716`, :724) -> `rateDiscoveryCluster` (`discoveries.ts:792`) -> `rateDiscovery` (:874) | awaited inside try (:693-725); ledger failure logged, verdict already persisted on the BrainMemory row |
| D2 | `lib/trpc/routers/brain.ts:889` | `recordDecisionByContent(input.text, "dismissed", "nudge:<source>")` | `dismissed` only | `components/brain/nudge-panel.tsx:63` -> `brain.dismissNudge` (:869) | fire-and-forget `void (async ...)()` (:888-892) |

- `recordDecision` is a CAS: `updateMany where { id, decision: null }` (:118-125). `recordDecisionByContent` joins by hash,
  30-day window, newest-first, `decision: null` (:152-173).
- `ignored`: written by exactly one path (D1, `known`). Schema doc-comment `prisma/schema.prisma:3597` says
  "ignored (set by sweep after TTL)"; grep `sweep.*ignored|ignored.*sweep|undecided.*sweep|mark.*ignored` over
  `lib/services lib/brain lib/inngest app/api/cron config scripts` -> 0 hits. The sweep is documentation only.
- `edited`: grep `decision.*"edited"|"edited".*decision|: "edited"` over `lib app components` -> 0 hits. Never written.
- `accepted`: only D1 (`investigate`). Acting on a nudge, a brief, a push, a lead or a deck pick writes no `accepted`.

## 3. OUTCOME CLOSERS - `recordOutcome` / `recordOutcomeByContent` call sites

| # | file:line | function | what sets `outcomeUseful` | who calls it | call style |
|---|---|---|---|---|---|
| O1 | `lib/brain/discoveries.ts:718` | `recordOutcome({ id, useful: false, resultRef: "discovery_verdict:noise" })` | operator verdict `noise` only (:717). `known` and `investigate` leave outcome open on purpose (:710-716) | user action (Discover tab) | awaited inside try |
| O2 | `app/api/telegram/webhook/route.ts:249` | `recordOutcome({ id, useful, resultRef: "telegram:rating" })` | Telegram inline button `oc:u|n:<ledgerId>` (:235-237); return value drives the toast ("Already rated." on CAS miss, :253-259) | user action (Telegram) | awaited, errors answered to the operator (:261-269) |
| O3 | `app/api/outcomes/rate/route.ts:46` | `recordOutcome({ id, useful })` | web-push action button; `public/sw.js:144-156` posts `{ id: data.ledgerId, useful }` and deliberately does NOT navigate | user action (notification button). Session-gated (:25). Only `sendBriefPush` sets `data.ledgerId` + `oc_*` actions (`morning-brief.ts:254-258`) | awaited; `{ recorded, alreadyRated }` |
| O4 | `lib/services/task-actions.ts:560` | `recordOutcomeByContent(task.title, ratingUseful, "task:<id>")` | task completion rating: `OUTSTANDING|SATISFACTORY` -> true, else false (:555-557); fires only when `outcomeRating != null` (:554) | user action (task check with rating) | fire-and-forget `void (async ...)()` (:558-564) |

- O4 matches only when a task title equals a ledgered summary byte-for-byte after normalisation. The code's own census
  (:539-553) and `discoveries.ts:745-751` (`createTask({ title: row.content, originSource: "discovery:investigate" })`)
  agree: exactly ONE path creates such a task, so O4 is a documented no-op for every other task.
- `recordOutcome` is a CAS on `outcomeAt: null` (:229-236): first write wins; a second tap returns false.
- No cron, Inngest function, harvest or system process closes an outcome. Grep `recordOutcome\(|recordOutcomeByContent\(`
  over the app excluding tests -> the four sites above plus the service.
- `prediction` rows (P9): grep `kind: "prediction"|resolvePrediction|forecast.*actual` -> `resolvePrediction` exists in
  `lib/ai/outcome-calibration.ts:126` but operates on `brain_memory category="prediction"` (:132), never on
  `intelligenceOutcome`. The weekly forecast is written, never scored.

## 4. READERS - who reads `IntelligenceOutcome` rows

| # | file:line | read | what it does with the data | live consumer |
|---|---|---|---|---|
| R1 | `app/api/cron/outcome-harvest/route.ts:44` | `count where OR[decision=dismissed, outcomeUseful=false]` (all-time) | "corrections" numerator vs `TRIGGER = 200` (:38); `triggerMet` sentence | upserted into BrainMemory `eval_run` / `eval_run:corpus-odometer` (:39, :121-140) |
| R2 | `app/api/cron/outcome-harvest/route.ts:90` | `outcomeStats(30)` | 30d shown/decided/useful flow into the same odometer row (`ledger30d`, :115) | same row |
| R3 | `lib/trpc/routers/system/health.ts:78` | `outcomeStats(windowDays)` | `system.deliveryStats` (:70) | `app/(mastery)/system/fleet/page.tsx:152`, rendered :257-276 (shown / decided / accepted / dismissed / undecided + producers) |
| R4 | `lib/trpc/routers/system/health.ts:79` | `groupBy sourceEngine, kind where shownAt >= since` | producer census for the same panel | same page |
| R5 | `lib/brain/recall-corpus-builder.ts:550` | `findMany where OR[dismissed, outcomeUseful=false]`, take 25 (`MAX_PER_SOURCE`, :40) | one abstention eval case per row, provenance `intelligence_outcomes:<id>`; read failure is REPORTED, not swallowed (:528-546) | `buildRealRecallCases` is called only by `scripts/harvest-eval-corpus.ts:155` (operator-run). `countLabeledEvalCases` (harvest :84) counts noise-verdict Discover rows, not this table. |
| R6 | `scripts/export-eval-datasets.ts:35` | same predicate, take 500 | JSONL eval cases under `eval-datasets/` (gitignored, no-send) | operator-run |
| R7 | `scripts/corpus-odometer.ts:32` | same count as R1 | console odometer (mirrors R1) | operator-run |
| R8 | `lib/services/outcome-ledger.ts:276` | `outcomesNeedingReview(limit)` | correction candidates | ZERO callers. Grep `outcomesNeedingReview` -> definition + 10 comment mentions (`outcome-ledger.ts:11`, `brain.ts:837,885`, `discoveries.ts:67,639`, `recall-corpus-builder.ts:11`, `export-eval-datasets.ts:8`, `corpus-odometer.ts:5`, two tests). Every real harvester inlines the predicate instead (R1, R5, R6, R7). |
| R9 | `scripts/data-census.ts:33` | annotation only | "the UPSTREAMS fine-tune trigger counts THIS table's corrections: 0/200 (prod-verified)" | HISTORICAL note, no read |

Readers of the harvest OUTPUT (`eval_run:corpus-odometer`): grep `corpus-odometer|ODOMETER_KEY|EVAL_RUN\b` over
`lib app components config scripts` -> harvest route, `lib/brain/categories.ts:85,832-836` (registry), and
`app/api/system/cockpit/route.ts:64-72`. The cockpit read filters `createdAt >= since24h` (:68) and parses each row for
`{ passed }` (:117-121). The odometer row is upserted on a STABLE key (createdAt fixed at first run) with prose content, so
it is outside the window after day one and never parses. Net: the harvest writes a row nobody reads.

## 5. JOINS - per recommendation surface

YES = receipt; NO = grep that returned nothing; PARTIAL/CONDITIONAL = explained in the cell.

| Surface | (a) records shown | (b) can record decision | (c) can record outcome |
|---|---|---|---|
| Daily brief - combined push (`intelligence-brief`, the designed normal path) | YES `intelligence-brief.ts:348` (P1) | NO - grep `recordDecision\(|recordDecisionByContent\(` -> only D1, D2 | NO - `sendPush` at `intelligence-brief.ts:360` passes title/body/level/url/tag only; grep `ledgerId|actions|data:` over :355-380 -> 0. Telegram fallback (`sendTelegram`, no buttons). `/intelligence/brief` page: grep `rate|useful|ledger|outcome` in `app/(mastery)/intelligence/brief/page.tsx` -> 0 (its only link is `/intelligence/ledger`, which reads `/api/intelligence/opportunities`, :19). |
| Daily brief - morning backstop (`morning-brief` standalone) | YES `morning-brief.ts:168`, `:225` (P2, P3) | NO (same grep) | CONDITIONAL YES - `morning-brief.ts:254-258` -> `sw.js:144-156` -> O3. Reached only via `sendStandaloneIfUnconsumed` (:320-339), i.e. when the combine failed. |
| Home `operator.brief` lead + alternatives | NO - `lib/home/operator-brief.ts` (`buildOperatorBrief` :204, `alternatives` :91) has no `outcome-ledger` import (importer grep over `lib app`); grep `recordShown|outcome-ledger|intelligenceOutcome` in file -> 0 | NO - `components/home/brief-lead.tsx`: CTA is a `Link` (:81), "Why this?" and "Different move" are local `useState` toggles (:112, :126), inspector open (:98); grep `useMutation|dismiss` -> 0 | NO - never ledgered, so O4's title-hash bridge cannot match (`task-actions.ts:539-553`) |
| Missions deck pick (`deck.nextMove`) | NO - `lib/missions/deck.ts`: grep `recordShown|outcome-ledger|intelligenceOutcome` -> 0; not an importer | NO (ledger) - `deckStartMove` / `deckPickDifferent` go to client telemetry only (`app/(mastery)/missions/page.tsx:130,140` -> `lib/telemetry/mission-surface.ts:14-17`: batched to `/api/system/mission-surface-stats`, 2-week retention, "no operator UI yet") | NO - same bridge reasoning as Home |
| Chat suggestions (NickSuggestions chips) | NO in this ledger - `lib/services/nick-suggestions.ts` not an importer. PARALLEL ledger: BrainMemory `suggestion_loop` (`lib/brain/suggestion-loop.ts:1-33`) | PARALLEL - `components/chat/nick-suggestions.tsx:161-183` (`acted`, `dismissed`) -> `brain.recordSuggestionSignal` (`brain.ts:1314-1365`) -> `trackSuggestionAction` (`suggestion-loop.ts:197`). Harvest counts these as "supplementary" (`outcome-harvest/route.ts:49-60`) - count-level join, no row-level join | PARALLEL, UNWIRED - `recordSuggestionOutcome` (`suggestion-loop.ts:253`) exists; grep `type: "outcome"` over `app components lib` (excluding the router) -> 0 UI callers |
| Chat decision surface (`getTopDecisions` tool) | YES `lib/ai/tools/system.ts:1316` (P8) | NO - decisions are made in nickstire's Decision Inbox (other app/DB); no join; grep (same as above) | NO |
| Journal `nextAction` (take -> promote) | NO - grep `recordShown|recordDecision|recordOutcome|outcome-ledger` over `lib/services/journal-promote.ts lib/trpc/routers/journal.ts lib/brain/journal-brain.ts lib/brain/journal-ingest.ts` -> 0 | NO (ledger) - promotion stamps `nextActionPromoted = true` on the take row (`journal-promote.ts:139`): a de-facto `accepted` with no ledger row | NO |
| Proactive push - morning/afternoon/evening (Telegram) | YES `proactive-pushes.ts:66` via :356/:475/:583 (P4) | NO - buttons write OUTCOME, not decision; rows stay `decision = null` | YES `telegram/webhook/route.ts:249` (O2) |
| Proactive push - `approvals_nudge`, `fireDueReminders` | NO - plain `sendTelegram` at `proactive-pushes.ts:759`, `:821` | NO | NO |
| Telegram - every other sender | NO - 42 files call `sendTelegram(|sendTelegramWithButtons(` (grep over `lib app`, excluding the service); only `proactive-pushes.ts` imports the ledger (importer grep) | NO (ledger). Button-bearing senders with their OWN callbacks, none ledgered: `lib/ai/tools/social.ts:210,314`, `lib/services/vehicle-detection.ts:301`, `lib/brain/journal-brain.ts:342` (goal-link `jlink:c|r`, handled by the `jlink` branch of `app/api/telegram/webhook/route.ts`, read :200-290) | NO. `revenue-decision-channel.ts:1-40` keeps its own `revenue_move` status receipts (`/approve_N`) - excluded from this ledger BY DESIGN (`outcome-ledger.ts:5-7`); the three button senders above are approval/confirm flows of the same class. |
| Brain Discover feed | YES `brain.ts:680`, `discoveries.ts:698` (P5, P6) | YES `discoveries.ts:705` (D1) - all three values | PARTIAL - `noise` -> O1; `investigate` -> task titled verbatim (:747) -> completion rating -> O4; `known` -> open by design |
| Brain nudge panel | YES `brain.ts:847` (P7) | PARTIAL - `dismissed` only (D2). Acting on a nudge writes nothing | NO - grep for any nudge outcome path -> 0 (only D2 touches nudges) |
| Weekly digest `prediction` | YES `weekly-digest/route.ts:81` (P9) | NO | NO - no resolver for this table (section 3) |

## 6. DEAD ENDS

| # | finding | evidence | consequence |
|---|---|---|---|
| E1 | Daily brief ratable only on the failure path | `sendBriefPush` (buttons, `morning-brief.ts:254-258`) has one caller, `:333`, inside the 35-min backstop (:552). The combined push (`intelligence-brief.ts:360`) carries no `ledgerId`/actions; P1's `recordShown` return value is discarded (:348) | daily_brief rows (~90 HISTORICAL, `outcomes/rate/route.ts:9`) remain structurally unratable on a normal day, the exact defect the 2026-09-18 wave believed it fixed |
| E2 | `shownSurface` on P2 is synthetic | `morning-brief.ts:167` derives from `push.sent`; `push` is `{sent:1}` from `handOffForCombine` (:290-308) after 2026-08-21; `:179` then overwrites P3's `web-push` with it | the field the 2026-09-18 comment (:170-176) says is "finally known" is a constant |
| E3 | `outcomesNeedingReview()` has zero callers | section 4 R8 | 8 non-test comments (10 incl. tests) cite it as the harvester; the predicate is duplicated 4x and can drift |
| E4 | Harvest output has no consumer | section 4, `cockpit/route.ts:68, 117-121` | the "automated reader" (`outcome-harvest/route.ts:8-15`) terminates in a row nobody reads - the hop it was built to close |
| E5 | `prediction` rows never resolve | P9; section 3 last bullet | one new permanently-undecided, outcome-null row per week inflates `undecided` in R2/R3 |
| E6 | `decision_surface` rows never decide | P8; decision lives in nickstire | same inflation; `chat-tool` producer reads as 0% decided forever |
| E7 | Ratings write outcome, not decision | O2, O3 set only `outcomeUseful`/`outcomeAt`; `outcomeStats` (`outcome-ledger.ts:245-273`) counts `undecided = decision == null` | proactive_push + daily_brief are 100% "undecided" even when rated; `/system/fleet` shows this as a flow number without the caveat |
| E8 | Nudge `accepted` never written | D2 is dismiss-only | accepted:dismissed for `nudge:*` is 0:N by construction; any ratio over it is an artefact |
| E9 | `edited` never written; `ignored` sweep does not exist | section 2 bullets; `schema.prisma:3597` | stale doc-comment invites a reader to assume a TTL labeller exists |
| E10 | Home lead, Missions deck, Journal nextAction record nothing | section 5 rows 3, 4, 7 | the three most-viewed recommendations have no learning signal; deck telemetry (`mission-surface.ts:14-17`) is a 2-week sink with no UI |
| E11 | Chat-suggestion outcome signal is unwired | `recordSuggestionOutcome` has 0 UI callers (section 5) | the parallel ledger has the same writer-without-closer shape this table had on 2026-09-18 |
| E12 | Two ledgers for one brief | P1 (first line of combined text) and P2/P3 (`brief.text`) hash differently | one morning = 2 `daily_brief` rows with different `sourceEngine`; per-day coverage must dedupe by date, not by row |

Not dead ends, recorded to stop re-investigation: `lib/brain/outcome-tracker.ts` (Prediction table, Brier lane, called from
`app/api/cron/brain-intelligence/route.ts:15`) is a different concept, not a duplicate of this ledger.
`revenue-decision-channel` approvals are excluded by the ledger's own design note.

## 7. Production percentages - queries to run (DO NOT run from this session)

Needs `DATABASE_URL`; all read-only. Report overall AND per `kind`; the per-kind split is mandatory because E7 makes
`undecided %` meaningless for `proactive_push` and `daily_brief` (base-rate rule). Report `labelled` (decision OR outcome)
beside `undecided` so the two defect shapes are not conflated.

```ts
// A. totals (all-time)
prisma.intelligenceOutcome.count()
prisma.intelligenceOutcome.count({ where: { decision: null } })                     // undecided
prisma.intelligenceOutcome.count({ where: { outcomeAt: { not: null } } })           // outcome coverage numerator
prisma.intelligenceOutcome.count({ where: { OR: [{ decision: { not: null } }, { outcomeAt: { not: null } }] } }) // labelled

// B. per kind
prisma.intelligenceOutcome.groupBy({ by: ["kind"], _count: { _all: true } })
prisma.intelligenceOutcome.groupBy({ by: ["kind"], where: { decision: null }, _count: { _all: true } })
prisma.intelligenceOutcome.groupBy({ by: ["kind"], where: { outcomeAt: { not: null } }, _count: { _all: true } })
prisma.intelligenceOutcome.groupBy({ by: ["kind", "outcomeUseful"], _count: { _all: true } })

// C. which decision values actually exist (proves E9: expect no "edited"; "ignored" only with resultRef discovery_verdict:known)
prisma.intelligenceOutcome.groupBy({ by: ["decision"], _count: { _all: true } })
prisma.intelligenceOutcome.groupBy({ by: ["decision", "resultRef"], where: { decision: { not: null } }, _count: { _all: true } })

// D. producers and surfaces (confirms E2: expect shownSurface "web-push+home" on every morning-brief row; and E12)
prisma.intelligenceOutcome.groupBy({ by: ["sourceEngine", "kind"], _count: { _all: true } })
prisma.intelligenceOutcome.groupBy({ by: ["shownSurface"], _count: { _all: true } })

// E. which closer wrote each outcome (telegram:rating | discovery_verdict:* | task:* | null = web-push button, which sets no resultRef)
prisma.$queryRaw`SELECT split_part(result_ref, ':', 1) AS closer, count(*) FROM intelligence_outcomes
                 WHERE outcome_at IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`

// F. 30-day window (what /system/fleet and the odometer row show) - same as A/B with
//    where: { shownAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }

// G. the harvest metric itself, and whether the harvest ever ran / is read
prisma.intelligenceOutcome.count({ where: { OR: [{ decision: "dismissed" }, { outcomeUseful: false }] } })
prisma.brainMemory.findUnique({ where: { category_key: { category: "eval_run", key: "eval_run:corpus-odometer" } },
  select: { createdAt: true, lastSeen: true, seenCount: true, content: true, metadata: true } })

// H. E1 check: did any daily_brief row ever receive a web-push rating? (web-push ratings carry resultRef = null)
prisma.intelligenceOutcome.count({ where: { kind: "daily_brief", outcomeAt: { not: null } } })
prisma.intelligenceOutcome.count({ where: { kind: "daily_brief", outcomeAt: { not: null }, resultRef: null } })
```

Percentages: `undecided % = A2 / A1`, `outcome coverage % = A3 / A1`, `labelled % = A4 / A1`, each repeated per kind from B.
Compare against HISTORICAL: 293 rows / 6 labels, newest label 2026-08-31, ~214 proactive_push + daily_brief rows
(`tests/brain/proactive-push-rating.test.ts:4-9`, `lib/brain/proactive-pushes.ts:40-46`); corrections 3/200 and labelled eval
cases 6/30 on 2026-08-28 (`docs/LEARNING-LOOPS-2026-08-28.md:45,127`); 0/200 on 2026-08-06 (`scripts/data-census.ts:33`).

## Dispositions

- FIX NOW (E1): capture P1's `recordShown` id in `lib/inngest/functions/intelligence-brief.ts:348` and pass `data: { ledgerId }`
  + `oc_useful`/`oc_not_useful` actions on the `sendPush` at :360; mirror the buttons into the Telegram fallback via
  `sendTelegramWithButtons` with `oc:u|n:<id>`. The service worker and `/api/outcomes/rate` already handle both.
- FIX NOW (E2): in `lib/inngest/functions/morning-brief.ts:162-181` stop deriving `shownSurface` from the synthetic
  hand-off result; record `handed-off` (or the backstop's real surface) and let the backstop's `setShownSurface` win.
- FIX NOW (E7): in `app/api/telegram/webhook/route.ts:249` and `app/api/outcomes/rate/route.ts:46` also call
  `recordDecision({ id, decision: useful ? "accepted" : "dismissed", resultRef })`, OR write the semantic contract
  (decision = acted-on, outcome = helped) into `lib/services/outcome-ledger.ts` and make `outcomeStats` report
  `unlabelled` (both null) instead of `undecided`. Pick one; today the panel number is ambiguous.
- IMPLEMENT (E10 Home): `recordShown({ kind: "suggestion", sourceEngine: "operator-brief:<lead.kind>", summary: lead.headline,
  shownSurface: "home" })` in `lib/home/operator-brief.ts` (lead assembly ~:367-440); decision from `components/home/brief-lead.tsx`
  CTA click (`accepted`, resultRef `task:<taskId>`) and "Different move" (`dismissed`); close by `resultRef` from
  `lib/services/task-actions.ts:554-564` (add `recordOutcomeByResultRef` beside the content join - the lead headline is not the
  task title, so the existing hash bridge cannot match).
- IMPLEMENT (E10 Missions): same shape for `deck.nextMove` in `lib/missions/deck.ts`; wire `deckStartMove`/`deckPickDifferent`
  (`app/(mastery)/missions/page.tsx:130,140`) to a tRPC decision call instead of telemetry-only.
- IMPLEMENT (E10 Journal): ledger the `nextAction` when the take renders (`lib/trpc/routers/journal.ts:564-582`) and write
  `accepted` with `resultRef task:<id>` from `lib/services/journal-promote.ts:138-140`.
- IMPLEMENT (E8): write `accepted` via `recordDecisionByContent(n.text, "accepted", "nudge:<source>")` wherever the nudge
  panel navigates/acts (`components/brain/nudge-panel.tsx`), so nudges are not dismiss-only.
- IMPLEMENT (E4): render the odometer row on `app/(mastery)/system/fleet/page.tsx` beside `deliveryStats` (read
  `eval_run:corpus-odometer` by key, no createdAt filter), or append its sentence to `weekly-digest`. The cockpit's
  `createdAt >= 24h` + `passed` parse (`app/api/system/cockpit/route.ts:64-72, 117-121`) will never surface it.
- MEASURE (section 7): run A-H once with `DATABASE_URL`; publish per-kind undecided / outcome-coverage / labelled; H decides
  whether E1 is already costing labels.
- MERGE (E3): export `CORRECTION_WHERE = { OR: [{ decision: "dismissed" }, { outcomeUseful: false }] }` from
  `lib/services/outcome-ledger.ts` and use it in `outcome-harvest/route.ts:45`, `recall-corpus-builder.ts:551`,
  `export-eval-datasets.ts:36`, `corpus-odometer.ts:33`; have `outcomesNeedingReview` use it too.
- DELETE (E3): if no caller is added in the same slice, delete `outcomesNeedingReview` (`outcome-ledger.ts:275-283`) and fix the
  8 comments that name it.
- DELETE (E9): `"edited"` from `OutcomeDecision` (`outcome-ledger.ts:27`) and the "set by sweep after TTL" clause at
  `prisma/schema.prisma:3597` (comment-only change, no migration), unless the sweep is built.
- DEFER (E5): resolve `prediction` rows against actuals - needs the nickstire revenue read that `cashflow-forecast.ts` already
  pulls; a 1-week-later Inngest step calling `recordOutcome` by stored id. Defer until A-H show the row count matters.
- DEFER (E6): `decision_surface` cannot be decided in this app; either drop P8 or add a nickstire -> statenour webhook when
  an inbox decision lands. Operator call.
- DEFER (E11): wire `recordSuggestionOutcome` from a real signal (task created from a chip -> completion), or fold
  `suggestion_loop` into this ledger. Not before E10, which gives the chips a row to join on.
- NO ACTION: `outcome-tracker.ts` (different concept); `revenue-decision-channel` receipts (excluded by design);
  `approvals_nudge`/`fireDueReminders` (reminders, not recommendations).

## Not established

- Live counts: every percentage in this doc is HISTORICAL or structural; nothing was run against prod.
- Whether `sendStandaloneIfUnconsumed` ever fires in prod (i.e. whether ANY daily_brief row has a web-push rating) - query H.
- Whether `combineBriefText` puts the morning highlight first (affects which line P1 hashes); function at
  `intelligence-brief.ts:175`, body not read.
- `intelligence-brief`'s Telegram fallback and `briefTelegramFallback` are button-less: both call `sendTelegram(` (read at
  `intelligence-brief.ts:~383-396`, `morning-brief.ts:185-199`). `sendTelegramWithButtons(` has 5 callers (grep over
  `lib app`): `proactive-pushes.ts:86` plus the four approval-flow sites named in section 5; only the first ledgers. A first
  draft of this doc claimed "nowhere outside proactive-pushes" - corrected on self-audit.
- Whether nickstire exposes a decision-landed event that could close E6 - not searched outside `apps/statenour`.
- The `.next/standalone` copy of these files matched the source at every grep hit; not diffed line-by-line.

## Applied · full-circle wave 2 (2026-10-02, branch `statenour/full-circle-c-settings-system`)

- **Finding 6 fixed — the daily brief is rateable on its normal path.** `intelligence-brief.ts` step `save-brief-log` now returns
  the `recordShown` id (it was discarded); step `dispatch-push` spreads `ratingPushActions(ledgerId)` (`data.ledgerId` +
  `oc_useful` / `oc_not_useful`, the shape `public/sw.js` already routes to `POST /api/outcomes/rate`); step `telegram-fallback`
  sends `ratingTelegramButtons(ledgerId)` (`oc:u:<id>` / `oc:n:<id>`, the shape the webhook already parses) and falls back to a
  plain send when there is no row. The next 10:15 UTC brief is the first live receipt: a `daily_brief` row from `intelligence-brief`
  whose `outcomeAt` can be set from the push the operator actually receives.
- **One owner for the affordance.** `lib/services/outcome-rating-affordance.ts` replaces the hand-built copies in
  `morning-brief.ts` (push actions) and `proactive-pushes.ts` (Telegram buttons); `tests/inngest/intelligence-brief-ratable.test.ts`
  pins the shapes against their two consumers and asserts no hand-built copy survives.
- **Finding 7 (ratings write `outcomeUseful`, never `decision`) is NOT changed.** It is a semantic-contract question
  (does a 👍 mean "accepted"?), so it is recorded for the operator rather than guessed at in code. `/system/fleet`'s undecided
  count still reads those rows as undecided.
- Findings 1-5, 8-9 and E1-E12 remain as listed; the FIX NOW on Home lead / Missions deck recording (finding 5) is the next
  Lane D slice and needs its own design (what a Home "decision" is when the CTA is a Link).
