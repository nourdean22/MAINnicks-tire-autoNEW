> Archived 2026-10-23 from the manager session 0900c49a research lane (brain-map-2026-10-23.md), verbatim except the production database host name, which is omitted because this repo is public. Numbers are prod reads of 2026-10-23 02:19Z-02:40Z.

# Brain map + duplicate spec (2026-10-23)

Job 2026-10-23-brain-hygiene-and-map. Lane: research, read-only. Code read at origin/main e2b690baa (deployed build 9f9fbc0, curl /api/version 2026-10-23).
Prod DB: Neon pooler host (Neon pooler host omitted: public repo) (printed first by every script). SELECT only. Counts, ids, dates only; no row text.
Window "14d" = 2026-10-09T02:19Z to 2026-10-23T02:19Z (now() at first query 02:19:04Z). Days are ET. The first ET day (10-08) is partial.
Labels: FACT = I ran the query or grep this session (scripts in the scratchpad q/ folder); INFERRED = follows from named facts; NOT CHECKED = said why.

## Answer first

1. The site records page OPENS (one row per route change) and little else: 196 opens in 14d, 57 sessions. The UI talks tRPC and tRPC calls are not logged anywhere, so per-procedure usage is "no data in window", not zero. FACT.
2. Nour uses two pages: Home (69 opens, 35%) and Chat (59, 30%), 128 of 196 (65%). Home starts 36 of 57 sessions (63%); its top exit is Chat (30 of 69 home opens). 6 of 16 page files had 0 opens. FACT.
3. Pain 1 (writer, no reader): the nightly thinking engine wrote 52 new "he said X, the record shows Y" rows in 14d (635 ever, 80 open). He resolved 0; the 30-day auto-expiry closed 555 of 555. The pages meant to show them read a different store that has 0 rows ever. /brain, where engine output lives, got 4 opens in 14d (2%). FACT.
4. Pain 2 (blind instrument): no dwell or leave event, the tab-view event has 0 rows ever, default tabs never log, tRPC unlogged. A page-level redesign can use the numbers below; anything finer cannot be measured yet. FACT.
5. Duplicates: contradictions = delete the BrainMemory path after repointing its 10 readers to the table; attention surfaces = one orphan stack to delete (1,877 lines, 0 hits); "four nightly LLM miners" is wrong, only wisdom-distiller calls an LLM, the other three run SQL and statistics. FACT (grep).
6. Hygiene counts for the backup-first PR (B4): blind_spot 223 live, 207 have a twin under 0.05 (24 clusters, 183 removable); replays 28 of 29 overdue; decay population 27,260 (was 26,718); telemetry 25,858 of 43,711 live (59.2%).

---------------------------------------------------------------------------------------------------

## A. Usage map (bdnick.info, last 14 days)

### A0. What the app keeps (source inventory)

| Source | What it records | 14d rows | Verdict as a usage source |
|---|---|---|---|
| "AuditEvent" eventType page_visit (writer: components/brain/page-tracker.tsx -> trpc.brain.pageVisit -> lib/services/brain-domain.ts recordPageVisit; mounted app/(mastery)/layout.tsx:73) | one row per pathname change: path, referrer, ET hour. No device, no dwell, no leave | 196 (2,039 ever, since 2026-07-24) | GOOD for page opens. Undercounts time on a page: 50 chat messages on 10-20 made 2 chat opens |
| "AuditEvent" eventType page_tab_visit (writer: brain.pageTabVisit, added 2026-10-19) | ?tab= views of /brain and /stats | 0 (0 ever) | NO DATA. Writer unproven: /brain was opened once since (10-19 19:22Z) and default tabs carry no ?tab=, so they never log |
| api_request_logs (writer: lib/utils/http.ts apiHandler) | REST routes only. Success rows SAMPLED (every call over 1 s, else 10%); failures 100% | 5,452 (12,904 since 2026-09-22; 30d retention) | WEAK. 99.5% of desktop-UA rows are /api/habits + /api/health polling; /api/sync/* is machine traffic |
| tRPC app/api/trpc/[trpc]/route.ts, lib/trpc/trpc.ts, context.ts | nothing: route.ts read in full, trpc.ts and context.ts grepped for prisma, log, telemetry, record (only comments and the ctx.db wiring) | n/a | NO DATA for per-procedure use |
| chat_messages / chat_conversations | every turn | 138 user msgs, 18 conversations active | GOOD for Chat depth |
| "AuditEvent" ticker_acknowledged (app/api/ultron/ticker/ack/route.ts:41) | each ack of a ticker item | 161 on 9 of 14 days | GOOD for the ticker |
| intelligence_outcomes | surface, shown, decision | 14 source/surface pairs (A5) | GOOD only where a decision is written |
| system_metrics brain_feedback.* | see-also / chip clicks | 0 | NO DATA |
| tool_telemetry | per-tool counters | 4 tools called in 14d | NOT a usage source: chat uses more tools than that. Cause NOT CHECKED |

There is no page-view table by that name; page_visit rows in "AuditEvent" are the page-view record. Mobile vs desktop per page: NO DATA (page_visit has no user agent). Only the sampled REST log has a UA (A4).

### A1. Routes by 14d opens (q1.cjs c_path_14d, g_quick_leave; FACT; denominator 196 opens)

| Route | Opens | Share | Days with an open (of 14) | Last open (ET) | Next open under 10 s | Note |
|---|---|---|---|---|---|---|
| / (Home) | 69 | 35.2% | 14 | 10-22 22:13 | 30 (43%) | nav Home. 25 went to another page, 5 re-opened / |
| /chat | 59 | 30.1% | 14 | 10-22 22:13 | 8 (14%) | nav Chat |
| /missions | 24 | 12.2% | 10 | 10-20 16:31 | 9 (38%) | nav Missions |
| /journal | 11 | 5.6% | 6 | 10-19 21:30 | 3 (27%) | nav Journal |
| /proof | 6 | 3.1% | 3 | 10-19 13:39 | 1 | no page file; next.config.ts:371 redirects to /system |
| /system | 6 | 3.1% | 4 | 10-19 13:38 | 1 | nav System |
| /system/actions | 6 | 3.1% | 4 | 10-19 11:39 | 1 | |
| /content | 4 | 2.0% | 2 | 10-13 11:22 | 2 | cut 2026-10-18 (next.config.ts:341-345, redirects to /) |
| /brain | 4 | 2.0% | 2 | 10-19 19:22 | 0 | nav Brain (3 tabs: Memory, Review, Health) |
| /stats | 3 | 1.5% | 2 | 10-18 17:40 | 0 | nav Stats |
| /settings | 2 | 1.0% | 2 | 10-11 06:33 | 0 | nav footer |
| /system/crons | 2 | 1.0% | 1 | 10-10 18:12 | 0 | |
| Total | 196 | 100% | | | | 12 distinct paths; sums to 196 |

"Next open under 10 s" = the next page_visit row (any path) came under 10 s later. It is a navigation proxy, NOT a bounce: nothing records leaving, so a reader who stays and closes the app is invisible. INFERRED.

### A2. Hits per day, top routes (q1.cjs d_day_total, d2_path_day; FACT)

| ET day | Home | Chat | Missions | Journal | Other | Total |
|---|---|---|---|---|---|---|
| 10-08 (partial) | 0 | 0 | 2 | 0 | 0 | 2 |
| 10-09 | 3 | 3 | 0 | 1 | 2 | 9 |
| 10-10 | 6 | 6 | 0 | 0 | 9 | 21 |
| 10-11 | 10 | 9 | 0 | 0 | 3 | 22 |
| 10-12 | 7 | 10 | 4 | 1 | 1 | 23 |
| 10-13 | 4 | 5 | 1 | 1 | 4 | 15 |
| 10-14 | 2 | 2 | 2 | 0 | 1 | 7 |
| 10-15 | 5 | 5 | 5 | 4 | 4 | 23 |
| 10-16 | 2 | 4 | 2 | 0 | 0 | 8 |
| 10-17 | 4 | 1 | 2 | 0 | 0 | 7 |
| 10-18 | 9 | 6 | 2 | 1 | 3 | 21 |
| 10-19 | 11 | 4 | 3 | 3 | 6 | 27 |
| 10-20 | 4 | 2 | 1 | 0 | 0 | 7 |
| 10-21 | 1 | 1 | 0 | 0 | 0 | 2 |
| 10-22 (to 22:13) | 1 | 1 | 0 | 0 | 0 | 2 |

Do NOT read 10-20 to 10-22 as a collapse. Chat user messages per ET day (q3.cjs b_chat_day): 10-09 7, 10-10 16, 10-11 2, 10-12 11, 10-13 3, 10-14 3, 10-15 6, 10-16 11, 10-17 7, 10-18 8, 10-19 6, 10-20 50, 10-21 7, 10-22 1 (total 138). 10-20 was the biggest chat day of the window with 7 opens. Route-change opens measure moves, not time. The counts are FACT; the reading is INFERRED.

More (FACT, q1/q4): opens by ET hour: 11h 34, 10h 24, 8h 16, 16h 16, 7h 15, 23h 15, 18h 13, 17h 11, 9h 10; after 11pm 15 of 196 (7.7%), none 00h-04h. Sessions (30-minute gap rule, INFERRED definition): 57, 3.4 opens each; first page of a session: Home 36 (63%), Chat 10, Missions 3, others 8.
Top moves within 30 minutes (q4 a_transitions): Home to Chat 30 (mean gap 99 s), Chat to Home 13, Home to Home 13, Chat to Missions 9, Home to Missions 7, Missions to Chat 7, Chat to Chat 5, Missions to Journal 4, Home to System 4.
Referrer (q4 c_referrer_class, of 196): none 152, same-site 27, external 17.

### A3. Pages with 0 opens in 14d (16 page files under app/(mastery) on origin/main, compared with A1; FACT)

6 of 16: /people (in nav), /photo-improver (in nav), /decisions/[id], /system/alerts, /system/inbox, /system/ui-lab.
PageTracker is mounted in the (mastery) layout, so all six would have logged: "0 opens" is a real 0 for this window. 14 days is one sample, and alerts, inbox and decisions/[id] are deep-link pages. The other 10 pages have 2 to 69 opens.

### A4. REST error rate and device (q2.cjs, q3.cjs; FACT unless marked)

| Item | Value | Denominator / caveat |
|---|---|---|
| api_request_logs rows 14d | 5,452 (cron 1,031; other 4,421) | success rows are sampled at 10%, so volume is NOT hits |
| error rows | 23 (22 non-cron, 1 cron), all status 401 | errors log at 100%, so the raw share 23/5,452 = 0.42% is biased UP. Sample-corrected non-cron estimate 22 / (22 + 119 slow + 4,280 fast x 10) = 0.05%, INFERRED (assumes the 10% sample holds) |
| 401 groups | /api/sync/events 9, /api/sync/queue 5 (last 10-11), /api/brain/not-seeing 3, /api/sync/business 3, /api/brain/nudges 1, /api/brain/insights 1, /api/cron/autonomous-engine 1 | no 5xx anywhere. The three /api/brain/* 401s (10-22 05:29Z and 12:05Z, two in the same second) came from a caller with no session. Caller NOT CHECKED (error rows store no user agent) |
| UA class, non-cron, UA present (sampled) | desktop 1,188; mobile 98; other (node, bridges) 3,113 | desktop = /api/habits 604 + /api/health 578 + /api/version 6 (polling). Mobile = health 41, habits 39, ticker/ack 12, coach/events 5, brain/graph 1 |
| Human actions with a UA | /api/ultron/ticker/ack: 12 of 12 sampled rows are mobile | INFERRED: Nour acts on the phone PWA. Page-level device split is NOT measurable |

No route has a high error rate. The data does not support an "errors" pain.
Per non-cron REST path, 14d logged rows / of which errors / last logged (q2 d_noncron_paths; success rows sampled): /api/sync/nour-os 2,325 / 0 / 10-23 02:18Z; /api/habits 643 / 0 / 10-21 22:07Z; /api/health 619 / 0 / 10-20 16:57Z; /api/sync/events 235 / 9; /api/sync/business 158 / 3; /api/sync/queue/render 141 / 0; /api/devices 122 / 0; /api/version 71 / 0; /api/system/heartbeat 52 / 0; /api/sync/evidence 18 / 0; /api/ultron/ticker/ack 12 / 0 / 10-21 22:07Z; /api/devices/v380-shopsign/events 6 / 0; /api/coach/events 5 / 0 / 10-17; /api/sync/queue 5 / 5; /api/sync/backup 3 / 0; /api/brain/not-seeing 3 / 3; /api/brain/graph 1 / 0 / 10-19; /api/brain/insights 1 / 1; /api/brain/nudges 1 / 1. Page routes (A1) carry no status code, and tRPC is unlogged, so error rate per page route is NO DATA.

### A5. Feature use signals (q3.cjs; FACT)

| Surface | 14d signal | Reading |
|---|---|---|
| Chat | 138 user msgs, 18 conversations (369 ever), 14 chat_renamed, 2 chat_feedback (10-20) | the core product |
| Ticker | 161 acks on 9 days (10-09 24, 10-12 37, 10-15 17, 10-16 14, 10-17 12, 10-18 13, 10-19 15, 10-20 17, 10-21 12) | most-acted-on item on the site, phone only (A4). An ack may be a bulk action; NOT CHECKED |
| Home operator brief | operator-brief:decide shown 11, accepted 3, dismissed 0; operator-brief:hygiene shown 1, accepted 1 | the ONLY on-site surface whose decisions are recorded |
| Missions deck | missions-deck:start shown 12, decided 0 | shown, no decision recorded |
| /brain Memory nudges | nudge:identity 3 shown, nudge:ghost 1 shown, decided 0 | 7 of 11 nudge sources have no live input (audit) |
| Discover verdicts | 8 verdicts EVER, last 2026-08-30; 0 in 14d | the feedback loop of the engines is idle |
| Briefings | briefing_logs daily 12 (last 10-19), weekly 2 (last 10-18) | scheduled briefs stopped 2026-10-18 by decision (audit row 11) |
| Telegram proactive | morning 12, afternoon 14, evening 14 shown, decided 0 | off-site channel |
| Journal | 58 brain_dumps in 14d (1,652 ever); 58 journal_ingested events | /journal had 11 opens for 58 dumps, so most entries arrive by ingest. INFERRED |
| Tasks | 17 new, 134 touched in 14d; missions touched 1 | |

### A6. The two biggest pains from data

PAIN 1: engine output has a writer and no reader he visits (numbers FACT, link INFERRED)
- Thinking engine, 14d: 52 new contradictions, 80 open now, 635 ever. 555 of 555 resolved rows carry the auto-expiry text from lib/brain/memory-consolidation.ts:687 ("Auto-resolved after 30 days without action"). 0 were resolved by a person (q5b E_contradictions, q7 auto_resolved_exact).
- The surfaces meant to show them (Home brief lib/home/operator-brief.ts:273, ticker lib/services/ultron-ticker.ts:420, narrator, journal router, situation) read BrainMemory category "contradiction": 0 rows ever.
- /brain (Memory, Review incl. Discover, Health) = 4 opens in 14d (2.0% of 196) on 2 days. Discover: 0 verdicts in 14d.
- Contrast: the operator brief on Home, the one surface with a decision loop, records 3 accepts of 11 shown.

PAIN 2: the site cannot see itself below page level (FACT)
- tRPC: no log. Tab views: 0 rows ever. Dwell/leave: no event. Device per page: none. 6 of 16 pages show 0 opens but nothing says "never wanted" versus "reached another way".
- Consequence: a redesign may use A1-A3 (page shares, the Home-to-Chat spine, pages nobody opens). It may NOT claim tab-level or widget-level conclusions yet. Cheapest fix is C4.

## B. Duplicate spec

Corrections to the 2026-10-22 audit (FACT, re-measured or grepped at e2b690baa):
- "Four nightly LLM miners": only lib/brain/wisdom-distiller.ts calls an LLM (aiChat at :321, import :22). counter-intuitive.ts, correlation-finder.ts and teaching-moments.ts import no lib/ai module (grep count 0); they run SQL and statistics over scores, habits, shop invoices and leads (lib/brain/legacy-shims.ts). Removing a miner saves no LLM spend, only code and cron seconds.
- "The contradictions table is read by nothing": no longer true since 258854db9 (merged 2026-10-22 04:37Z, inside deployed 9f9fbc0): findRelevantClaimGap (contradiction-injector.ts:343) reads it into chat behind NICK_CLAIM_GAP (default on, feature-flags.ts:230-245). Since the merge there has been 1 user chat turn (q8) and 0 contradiction_injection_log rows: NO DATA, not "never fires".
- The telemetry denylist has 18 categories now (audit said 17): contradiction_injection_log was added.
- /brain is 3 tabs (Memory, Review, Health); Discover moved into Review. lib/brain/insight-meta.ts is gone (git ls-tree origin/main: 0 hits). trpc.brain.insights is now brain.insightsRibbon (routers/brain.ts:1781).
- Counts moved: contradictions 635 ever / 80 open (was 631/76); blind_spot 223 live (was 224); decay 27,260 (was 26,718); live rows 43,711 (was 43,806).

### B1. Contradictions, three ways (plus satellites)

| # | Implementation | Writer / caller | 14d output | Reader / page | Verdict | Blast radius if removed |
|---|---|---|---|---|---|---|
| 1 | thinking-engine L7 -> table contradictions (lib/brain/thinking-engine.ts:94-105) | app/api/cron/think (14 success in 14d) | 52 new; 80 open (identity 24, habit 21, commitment 19, business 9, health 7); 635 ever | chat claim-gap (brain-context.ts:532), learning-velocity.ts:204, pipeline-controller.ts:578, memory-consolidation.ts:600. No page lists them; no UI resolves them | KEEP. Canonical store | n/a |
| 2 | contradiction-surfacer -> BrainMemory category contradiction (lib/brain/contradiction-surfacer.ts, 609 lines) | importance-scorer.ts:311, services/brain/save.ts:383 (surfaceNearDuplicate), memory-contradiction-shadow.ts | 0 new, 0 ever | 10 readers of the empty set: operator-brief.ts:273 (Home), ultron-ticker.ts:420, narrator.ts:477, routers/journal.ts:429, ultron-situation.ts:282, cross-system-nudge.ts:26, recall-inbox.ts:144, services/contradictions.ts:30 (+ brain-domain.ts:60), brain.resolveContradiction -> contradiction-resolution-panel.tsx:62, chat tool resolveContradiction (tools/brain.ts:1181) | MERGE INTO #1 in two PRs: (a) repoint the readers and the resolve path to the table; (b) remove the writer and detection | (a) 10 files + tests/brain/ contradiction-counts, contradiction-resolution-supersedes, nudge-cache, nudge-correlation-suppression, nudge-trend-arrow. (b) importance-scorer.ts:311 branch, save.ts:383, memory-contradiction-shadow.ts (+ test), contradiction-surfacer-recall.test.ts, brain-save-dedupe.test.ts. Flag NICK_CONTRADICTION_CLEANUP (feature-flags.ts:461; contradiction-cleanup.ts, 239 lines, owns the loser soft-delete after an operator verdict). Cron manifest rows: none |
| 3 | wisdom_contradiction via validateWisdom (wisdom-distiller.ts:414-511) | NO caller anywhere (whole-tree grep app/lib/config/scripts: the definition only); only tests/lib/brain-engines-smoke.test.ts:119 calls it | 0 rows ever (q7: categories wisdom_contradiction + contradiction = 0) | none | DELETE | wisdom-distiller.ts :414-511 (about 98 lines), brain-engines-smoke.test.ts:119-125, category entries categories.ts:81 and :899, bdi.ts:36, coala.ts:51. No cron row, no flag |
| 4 | chat injector over BrainMemory (contradiction-injector.ts findRelevantContradictions :93, buildContradictionAlertBlock :274) | brain-context.ts about :515-530 on every turn (3 s budget), correction-boost flag | returns nothing: input set empty | the CONTRADICTION ALERT block (never rendered, 0 rows) | DELETE after B1-#2(a); keep the claim-gap half (:311-500) | contradiction-injector.ts first half (about 210 lines), the brain-context.ts call, tests/brain/contradiction-injector.test.ts, brain-context-timeouts.test.ts, renderer-fencing.test.ts, prompt-block-fencing-gate.test.ts. Flag NICK_CORRECTION_THRESHOLD_BOOST (feature-flags.ts:254) loses its brain-context.ts consumer (query-plan.ts mention NOT CHECKED) |
| 5 | ContradictionsCard (components/ultron/contradictions-card.tsx, 580 lines) | none: no importer (grep app/components/lib) | n/a | rendered by no page | DELETE | the file + app/styles/effects.css:767 comment. trpc systemBrain.resolveContradiction stays; whether anything else calls it is NOT CHECKED |
| 6 | auto-expiry (memory-consolidation.ts:687, 30 days) | consolidate: 13 success, 1 interrupted (10-21) | closed 555 of 555 | invisible | KEEP, but note it is the only thing that ever resolves them: that is the finding | n/a |

New-reader caution (INFERRED from #1 counts): pointing Home and the ticker at 80 open rows would flood both. The claim-gap rule is the model: one per day, no repeated topic within a week (contradiction-injector.ts:311-500); on Home cap at 1 per day, on the ticker show a count chip only.
Races (claim-before-act): the existing dedupe in semantic-dedup.ts updates the winner by id with no compare-and-swap, then hard-deletes the losers in one transaction, so two overlapping runs could pick one winner twice. Its scope list (:47-54) excludes blind_spot, so it cannot touch those rows. The repoint and the resolve path write no shared marker except the injection-log row, which claimClaimGapDay (contradiction-injector.ts:432) already claims.

### B2. "What needs attention", seven surfaces

| # | Surface | File / caller | 14d output | Reader / page and use | Verdict | Blast radius |
|---|---|---|---|---|---|---|
| 1 | Blind spots | lib/brain/blind-spot-detector.ts detectBlindSpots :85 + blind-spot-identity.ts; cron brain-intelligence:189 (14 success); tool getBlindSpots (tools/brain.ts); chat-lane-check.ts:113 | 7 new, 223 live (207 twins, B4) | /brain Review > Discover; recall whitelist memory-recall.ts:103; /brain 4 opens; 0 verdicts in 14d | KEEP, after the B4 dedupe | n/a. blind-spot-detector.ts:200 counts overdue replays as a blind spot |
| 2 | Nudges | lib/brain/cross-system-nudge.ts (421 lines); computed on read | 4 shown (identity 3, ghost 1), 0 decided | /brain Memory NudgePanel (memory-tab.tsx:181), chat nudges block (brain-context.ts:289), ticker (ultron-ticker.ts:409), narrator:461 | MERGE: prune the 7 dead sources (audit), keep identity and ghost | cross-system-nudge.ts, 3 nudge tests, dismiss-nudge-reason.test.ts |
| 3 | Situation synthesizer | lib/ultron/situation-synthesizer.ts (308), lib/services/ultron-situation.ts (695), routers/operator.ts:687, app/api/ultron/situation/route.ts (57), components/ultron/signal/situation-card.tsx (535) | on read only; /api/ultron/situation absent from api_request_logs 14d | SituationCard has no importer (grep app/components/lib/config): no page renders it | DELETE | 5 files = 1,595 lines + tests/lib/situation-synthesizer.test.ts (282) = 1,877; removes 1 reader of the empty contradiction set; scripts/contract-pre-flight.ts:85 names HQ SituationCard as the shop_pulse consumer (edit); persona-drift comments; no flag, no cron |
| 4 | Discoveries | lib/brain/discoveries.ts + components/brain/discover-tab.tsx; reader only | 8 verdicts ever, 0 in 14d | /brain Review (page: 4 opens) | KEEP: the one feedback loop of the engines | n/a |
| 5 | Pulse digest | lib/services/pulse-digest.ts:115; routers/brain.ts:1540; app/api/ultron/pulse-digest/route.ts | on read | command palette item power-pulse-digest (command-palette.tsx:405) | KEEP; use UNKNOWN (tRPC unlogged) | n/a |
| 6 | Brain insights ribbon | lib/services/brain-insights.ts:58; brain.insightsRibbon (routers/brain.ts:1781); /api/brain/insights | on read; 1 REST call in 14d, a 401 | InsightRibbon in Memory tab (memory-tab.tsx:148); the REST route has no client caller | KEEP the ribbon; DELETE the REST route app/api/brain/insights/route.ts | route + any test (NOT CHECKED) |
| 7 | Operator brief | lib/home/operator-brief.ts (buildOperatorBrief, routers/operator.ts:38); Home | outcomes: decide 11 shown / 3 accepted; hygiene 1 / 1 | Home: 69 opens | KEEP. Canonical "what needs attention" | gains contradiction rows after B1-#2(a) |

Also read: compose-daily-brief (briefing_logs daily 12, last 10-19; on demand only). Not duplicated.

### B3. Four nightly miners over one window

| # | Miner | File (lines) | Caller | LLM? | 14d new / live / ever | Verdicts ever | Verdict | Blast radius |
|---|---|---|---|---|---|---|---|---|
| 1 | counter-intuitive | lib/brain/counter-intuitive.ts (536) | brain-intelligence/route.ts:16,173 | no | 0 / 3 / 69; last 2026-09-26 | 1 (noise) | DELETE | importer: route.ts only. Tests: counter-intuitive-identity (112), brain-engines-smoke, brain-enrichments, brain-intelligence-windowed-predictions. Category readers stay harmless: memory-recall.ts:109, discoveries.ts:43, graph and memory-of-the-day routes, wisdom-distiller.ts:239,467 (input), learning-journal.ts:135 (count). The 3 live rows remain |
| 2 | teaching-moments | lib/brain/teaching-moments.ts (509) | route.ts:25 | no | 1 / 1 / 3; last 2026-10-19 | 1 (noise) | DELETE | importer: route.ts only. Tests: brain-engines-smoke, brain-intelligence-windowed-predictions. discoveries.ts:46 and mode-classifier.ts signal lists keep working |
| 3 | correlation-finder | lib/brain/correlation-finder.ts (549) | route.ts:24 and lib/brain/correlation-alarm.ts:24 (cron correlation-alarm, config/crons.ts:862) | no | 2 / 2 / 16 (hidden_correlation); correlation_alert 3 ever, last 2026-07-27 | 1 (investigate) | KEEP (second caller; the one miner with a positive verdict) | n/a |
| 4 | wisdom-distiller | lib/brain/wisdom-distiller.ts (511) | route.ts:21; tutor-pack.ts:36 and wisdom-violations.ts:25 import helpers | YES, 1 aiChat call a night (:321) | 52 / 283 / 904 | 3 (investigate, known, noise) | KEEP | n/a. It reads counter_intuitive rows as input; with miner 1 gone that input is 3 static rows |

Cron manifest: one row, config/crons.ts:363 brain-intelligence (14 success in 14d; q5b G_crons). Removing miners 1 and 2 edits the route and that row description, not the schedule. think = 14 success; consolidate = 13 success + 1 interrupted.
Verdict samples are n = 1 to 3 per category, so "noise" is weak evidence; the stronger evidence is yield (0 and 1 new rows in 14d) and the 69-ever / 3-live shape of counter-intuitive. INFERRED. Cheapest check before deleting: ask Nour once; it is his Review tab.

### B4. Hygiene counts for the backup-first PR (all FACT, q5b.cjs / q6.cjs, 2026-10-23 02:2xZ)

Live definition (same as the audit): deleted_at IS NULL AND (expires_at IS NULL OR expires_at > now()) AND superseded_by_id IS NULL. Table brain_memories (@@map, schema.prisma:1774 block). Vectors live in vector_embeddings ("sourceType" = brain_memory, column embedding_vec_1536; 37,468 of 37,483 brain_memory vector rows have it).

| Count | Value | Denominator | Query |
|---|---|---|---|
| All brain_memories rows | 62,750 | | q5b A_totals |
| Live rows | 43,711 | 62,750 | same |
| Live rows in the telemetry denylist (18 categories, embedding-policy.ts) | 25,858 = 59.2% | 43,711 live | same (the 17-category list gives the same 25,858) |
| Live non-telemetry ("memory") rows | 17,853 | 43,711 | A2_live_memory |
| ...seen_count <= 1 (never seen again) | 14,408 = 80.7% | 17,853 | same (audit: 13,516 = 76%; the audit also required last_seen at creation, mine does not) |
| ...last_seen over 30 days ago | 15,301 = 85.7% | 17,853 | same |
| blind_spot rows, all-time / live | 270 / 223 | | D_cats |
| ...live with a 1536 vector | 223 of 223 | | q6 |
| ...live with a twin at cosine distance < 0.05 (same category, all live pairs) | 207 = 92.8% | 223 live | q6 |
| ...pairs under 0.05 / under 0.10 | 1,589 / 1,647 | | q6 |
| ...clusters (connected components) | 24; largest 30, 28, 24, 18, 16, 12, 10, 10 | | q6 |
| ...removable, keeping 1 per cluster | 183 (leaves 24 + 16 non-twin = 40 live) | | q6 |
| ...the 207 twins created 2026-08-16 | 207 of 207 | | q6 |
| ...key shape blindspot_domain_epochms (pre-08-22 clock keys) | 207 of 207 | | q6 |
| ...discovery_verdict set | 0 of 207 (all 5 rated blind_spot rows ever are already soft-deleted) | | q6, q7 |
| ...seen_count > 1 | 0 of 207; seen in the last 30 d: 3 | | q6 |
| Decision replays total / reviewed / unreviewed | 29 / 0 / 29 | | q5b C_replays |
| ...unreviewed AND reviewAt <= now() | 28 = 96.6% of 29; oldest due 2026-04-25 | 29 | same |
| ...not due yet | 1; last created 2026-09-28; created in 14d: 0 | | same |
| decision_log live / with metadata key reviewAt | 229 / 0 | | C2_decision_log (key name is a guess; INFERRED "no review date") |
| Decay dry-run population (buildDecayWhere, memory-decay.ts:25-37) | 27,260 (claimed 26,718 on 10-17) = 62.4% of 43,711 live | | B_decay_total |
| ...semantic_edge | 17,672 = 64.8% | 27,260 | B_decay_by_cat |
| ...telemetry categories (all) | 21,786 = 79.9% | 27,260 | B_decay_tele_split |
| ...industry_intel | 3,376 = 12.4% (archive_document is NOT in the population) | 27,260 | same |
| ...other (real memory) | 2,098 = 7.7%: journal_brain_take 1,345, nick_advice 303, tool_embedding 98, chat_summary 97, rest | 27,260 | same |

Exact SELECTs. Parameter $1 = exempt list = DURABLE_PERSONAL_CATEGORIES (memory-recall.ts) + the additions in hard-delete-guard.ts:47-100 + pinned_user, 42 names, copied in q5b.cjs as EXEMPT.
- Decay: SELECT COUNT(*) FROM brain_memories WHERE last_seen < now() - interval '30 days' AND confidence > 0.1 AND expires_at IS NULL AND deleted_at IS NULL AND category <> ALL($1::text[]) AND COALESCE(created_by,'') <> 'user' AND COALESCE(source,'') <> 'manual'
- Live and telemetry: SELECT COUNT(*) FILTER (WHERE live), COUNT(*) FILTER (WHERE live AND category = ANY($2::text[])) FROM brain_memories m, with live as above and $2 = the 18 names in embedding-policy.ts:26 onward.
- Replays: SELECT COUNT(*) FILTER (WHERE NOT reviewed AND "reviewAt" <= now()) FROM decision_replays
- Twins: WITH v AS (SELECT DISTINCT ON ("sourceId") "sourceId", embedding_vec_1536 AS e FROM vector_embeddings WHERE "sourceType"='brain_memory' AND embedding_vec_1536 IS NOT NULL ORDER BY "sourceId"), bs AS (SELECT m.id, v.e FROM brain_memories m JOIN v ON v."sourceId" = m.id WHERE m.category = 'blind_spot' AND (live)) SELECT a.id, b.id FROM bs a JOIN bs b ON a.id < b.id AND (a.e <=> b.e) < 0.05 -- then connected components in code.

Notes for the PR author (INFERRED from the facts above):
- Decay must NOT run as written. 80% of what it would touch is telemetry and 65% is graph edges, but it also reaches tool_embedding (98 rows; embedding-policy.ts says tool search reads those) and 1,345 journal_brain_take rows. Exempt tool_embedding, or apply it to the telemetry categories only. That is a production write and needs Nour approval.
- Blind-spot dedupe: supersede or soft-delete, never a hard delete (blind_spot is in NEVER_HARD_DELETE_CATEGORIES, hard-delete-guard.ts:51). Backup table per house pattern _bak_brain_memories_blindspot_dedup_20261023 plus the matching vector_embeddings rows; compare COUNT source vs backup before any change. Compare-and-swap each loser update (WHERE id = $1 AND deleted_at IS NULL AND superseded_by_id IS NULL, check the affected rows). Run outside the 03:00-03:20Z mega-evening window (brain-intelligence 03:02, consolidate and dedup 03:17). The 207 rows have clock keys that persistBlindSpot never regenerates (it keys on a hashed identity, blind-spot-identity.ts:117), so the nightly run will not revive them; its tombstone-revive path (:309) matters only for identity keys.
- Replays: the 28 overdue unreviewed replays feed two readers: autonomous-engine.ts:218 (rule decision_replay_due sends a Telegram "Decision Review Due" for 3 of them whenever it fires) and blind-spot-detector.ts:200 (counts them as a blind spot). Closing them needs an outcome from Nour per decision (markReplayed, decision-replay-coach.ts:530); a bulk flag flip would silence both readers and record outcomes he never gave. No new replay since 09-28.

## C. Ranked recommendations (top 5)

1. Repoint the contradiction readers to the contradictions table, cap them, and give them a resolve path.
   Evidence: 52 new / 80 open / 635 ever, 0 resolved by a person, 555 of 555 auto-expired (q5b, q7); the 10 readers in B1-#2 read 0 rows ever; Home starts 63% of sessions (36 of 57) and gets 35% of opens; claim-gap in chat has had 1 turn to fire.
   Effort: 5-6 hours (loadRecentContradictions, countUnresolved and resolve over the table; 1-a-day cap on Home; ticker count chip; tests).
   Deletes: nothing yet; it frees item 2.
2. Delete the orphan attention and contradiction code: situation stack (1,877 lines incl. test), ContradictionsCard (580), validateWisdom (about 98); then, after item 1, the BrainMemory contradiction chat injector (about 210) and the surfacer writer.
   Evidence: SituationCard and ContradictionsCard have no importer; /api/ultron/situation has 0 logged hits; validateWisdom has no caller and wisdom_contradiction has 0 rows ever; the surfacer wrote 0 rows ever.
   Effort: 2 hours for the orphans now; 3 hours for the surfacer and injector after item 1.
   Deletes: about 2,600 lines now and about 800 later, about 10 test files touched or removed, 1 flag (NICK_CORRECTION_THRESHOLD_BOOST) loses its brain-context consumer.
3. Blind-spot dedupe, backup first, supersede not hard delete.
   Evidence: 207 of 223 live (92.8%) have a twin under 0.05; 24 clusters; 183 removable; all 207 are 2026-08-16 clock-key copies with 0 verdicts and 0 re-sightings (q6).
   Effort: 2.5 hours (dry-run SELECT, backup table plus vector rows, compare-and-swap supersede, count check, rollback script). It writes prod, so it needs Nour approval.
   Deletes: 183 rows from the live recall pool (reversible); no code.
4. Instrument before any redesign: a leave/dwell event, default-tab views, and a tRPC procedure name + duration counter.
   Evidence: page_visit is the only usage signal; page_tab_visit 0 rows ever; tRPC unlogged; 10-20 shows 50 chat messages with 2 opens. 6 of 16 pages show 0 opens.
   Effort: 3 hours, then 2 weeks of data before deciding on /people, /photo-improver, /system/alerts, /system/inbox.
   Deletes: nothing. Design guidance now (A1, A2): Home and Chat are the product (65% of opens) and Home to Chat is the top move (30 of 69 Home opens); do not redesign the /brain tabs or /stats blind (4 and 3 opens).
5. Cut the two quiet statistical miners (counter-intuitive, teaching-moments) and prune the 7 dead nudge sources.
   Evidence: 0 and 1 new rows in 14d, 3 and 1 live rows, 1 "noise" verdict each (small n); neither uses an LLM, so no spend is saved, only 1,045 lines and two branches of the cron route; 7 of 11 nudge sources have no live input.
   Effort: 2 hours. Ask Nour first (his Review tab; B3 note).
   Deletes: about 1,045 lines of miners, their tests (counter-intuitive-identity alone is 112 lines, plus shared smoke cases), up to 7 nudge branches.

Not in the top 5 but owed: close the 28 overdue replays one by one with Nour (10 minutes of his time, no code); apply decay only after exempting tool_embedding (production write, his approval).

## D. Receipts

Every prod read: cd apps/statenour, then the Railway run helper (service statenour-web) with pnpm exec tsx on <scratchpad>/q/<script>.cjs. Scripts contain SELECT/WITH only (the helper _db.cjs refuses any other first keyword), print the host first, print no row text.

| Script | Content | Rows / ms |
|---|---|---|
| q0 | connectivity; now_utc 2026-10-23T02:19:04Z; AuditEvent 42,748 rows | 1 / 2,182 |
| q1 | a eventTypes 30/356; b span 1/94; c path 12/67; d day 15/55; d2 path-day 64/49; e hour 19/50; f tabs 0/50; f2 0 ever; g quick-leave 12/51; h sessions 1/48 | rows/ms |
| q2 | a span 1/338; b class 6/54; c ua 6/65; d paths 19/60; e cron 15/49; f errors 7/58; g day 15/57 | rows/ms |
| q3 | a ua-path 18/326; b chat day 14/54; b2 1/60; b3 1/56; c audit actions 40/59; d outcomes 14/49; e briefings 2/59; f metrics 0/174; g verdicts 8/85; h journal 1/59; i tasks 1/57; j tool 1/109 | rows/ms |
| q4 | a transitions 14/324; b session-first 7/45; c referrer 3/49 | rows/ms |
| q5a | vector column names (information_schema) 7/388; vector counts 8/85 | rows/ms |
| q5b | A totals 1/478; A2 1/95; decay total 1/79, by-cat 10/98, split 3/98; replays 1/53; decision_log 1/53; cats 7/57; contradictions 1/50, resolved_how 1/50, by-cat 9/50; injection log 1/49; crons 4/59 | rows/ms |
| q6 | blind_spot live rows 223; vectors 223; pairs 1,589 and 1,647; components in code | ids only, not printed |
| q7 | auto-resolved exact 555 of 555; wisdom_contradiction + contradiction rows 0; blind_spot by verdict 3 rows | 4 queries |
| q8 | user chat turns since 2026-10-22T04:37:11Z: 1 | 1 / 316 |

Greps (git grep on origin/main e2b690baa, comments filtered with the five-form regex from assert-the-consumer): readers of prisma.contradiction (12 hits, B1); callers of findRelevantClaimGap (brain-context.ts:532 only); validateWisdom (definition plus one smoke test); SituationCard (definition only); insightsRibbon (insight-ribbon.tsx:59); miner importers (B3); page_visit writer and readers (A0). Path existence confirmed first with git ls-tree for lib/brain/insight-meta.ts (absent) and for each file whose line count is quoted. curl https://bdnick.info/api/version: commit 9f9fbc020a69, started 2026-10-23T01:52Z; git merge-base --is-ancestor 258854db9 9f9fbc020: yes.

Positive control for the usage queries: the last page_visit row (02:13:36Z) is the 22:13 ET open of Home and Chat that also tops d_day_total for 10-22, so the instrument reads known recent rows.
NOT CHECKED: who sent the 401s to /api/brain/*; whether ticker acks are bulk; per-procedure tRPC use (no data); mobile vs desktop per page (no data); whether any test imports the REST insights route; whether systemBrain.resolveContradiction has another caller; why tool_telemetry shows only 4 tools.
