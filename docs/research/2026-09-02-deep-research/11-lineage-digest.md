# StateNour Lineage Digest — prior decisions, refuted ideas, shipped waves

**Purpose:** dated evidence register so a fresh architecture audit of bdnick.info does not
re-propose what was already built, measured, or explicitly rejected.

**Method note (class D evidence):** everything below is drawn from first-party dated docs inside
the snapshot — it is DOCUMENT evidence, not re-verified code or a live production check. Every row
carries a file:line citation. A doc's own "verified live" language is quoted, never asserted as
still true today. No confidence percentages are used anywhere in this digest, per instructions.

**Source snapshot:** `origin/main @ abdd99395` (2026-09-02), read from
`C:\Users\nourd\AppData\Local\Temp\claude\C--\a2f6988a-8f6b-463b-a858-39bfbee811de\scratchpad\main2`.
App root `apps/statenour/`; docs root `apps/statenour/docs/` (230 files). Nothing in the snapshot
was executed; this is a read-only research pass (kaizen + karpathy-guidelines discipline applied —
smallest-correct-claim per row, no speculative scope, plan gated before writing). The skill named
`plan-gate` in the dispatch brief is not present in this session's available-skill list (confirmed
absent, not merely unused) — its discipline (don't act past what's actually planned/gated) is
applied by hand instead: this digest reports only what the docs say, not what a fresh audit should
do about it.

**Today:** 2026-09-02.

---

## 1. Wave timeline, 2026-07-20 -> 2026-09-02

Source: `apps/statenour/docs/RECONCILIATION.md` (newest wave on top; rows below run oldest to
newest for readability). file:line cites the `> ## ` blockquote header the wave starts at, in
RECONCILIATION.md unless noted. Doc dates are the wave's own dated header, not a re-verification.

**Known gap:** RECONCILIATION.md and the whole 230-doc corpus (`grep -rl "2026-08-29\|2026-08-30\|
2026-08-31"`) contain ZERO entries for 2026-08-29 through 2026-08-31 - no wave header, no dated
doc of any kind. Several PR numbers named in this task's brief do not appear anywhere in the docs
by exact search (word-boundary "#NNNN" and bare-number both empty): #2019, #2021, #2028, #2029,
#2030, #2032, #2053, #2055, #2071. Where the brief's description matches a documented mechanism
under a different number, that mapping is stated with a caveat; where nothing matches, the row
says so rather than inventing content.

| Date | PR(s) | Surface | Shipped | Measured | Refuted / rejected | Open items | file:line |
|---|---|---|---|---|---|---|---|
| 2026-08-16 | #1605 (checkout catch-up); the archive mechanism carries no PR number in-doc | Brain / ops | `scripts/export-brain-archive.ts`: full NDJSON export (memories + orphaned embeddings), atomic `.partial`-then-rename write, Task Scheduler daily 03:00 wrapper (`run-brain-archive.ps1`, self-updates via ff-only merge, exits non-zero + logs FATAL on failure) | Obsidian-vault export reaches only 2,822/18,027 live memories (15.7 pct) via its 100-per-category cap; full archive first run = 28,108 memories (18,027 live + 10,081 soft-deleted), 180 categories, 76.5 MB; 2,158 orphaned embedding rows (1.5M chars, incl. 123 gmail_thread) invisible to any memory-row export | n/a | Does not protect against loss since the last run (snapshot not replication); orphans archived-not-restored | `docs/runbooks/brain-archive.md:1-146` -- closest documented match to the brief's "brain archive failure-safe #2029"; no doc uses that number |
| 2026-08-25 | #1836, #1843, #1846, #1848, #1849 | Chat stack | "measure first, then 5 ships" -- full wave detail below the table (Section 1a) | -- | -- | -- | `RECONCILIATION.md:939` |
| 2026-08-26 | #1881, #1882, #1883, #1886, #1889, #1891, #1894, #1897, #1898 | Cross-surface | Interaction-audit wave, 9 ships incl. Home redesign (#1897) -- detail below | -- | -- | -- | `RECONCILIATION.md:866` |
| 2026-08-26 | #1837, #1838, #1840, #1844, #1856, #1859, #1860, #1866, #1870, #1888, #1890, #1892, #1895, #1896, #1899, #1901, #1902, #1911, #1913, #1915, #1923, #1926 | Cross-surface | Surface-honesty wave, 22 ships -- envelope/provenance/clock-frame honesty, stop-hook loud fail-open, automation engine rewritten + armed at 4 rules -- detail below | -- | -- | -- | `RECONCILIATION.md:663` |
| 2026-08-27 | #1930 | Chat | Streaming TTS chat read-aloud: segmenter -> markdown sanitizer -> NarrationController (generation-counter stop) -> SpeechEngine; composer chip + action-sheet replay; UPSTREAMS rows added per engine evaluated | TTFA 788ms edge lane on live authed smoke; 45 tests exit 0 | `@bestcodes/edge-tts` DEAD (DRM 403 measured live) | **Found live in this wave: prod `OPENAI_API_KEY` is revoked** (`/api/ai/transcribe` -> 502 "whisper 401"); mitigated same hour via `TTS_ENGINE=edge`; rotation still operator-only/pending | `RECONCILIATION.md:630-662` |
| 2026-08-27 | none (docs+process) | Cross-repo | Run-to-empty batch: 6 audit findings closed in one merge; camera-intelligence denominator fixes (UTC->ET, clamped); attention-helpers deleted (last zero-consumer module) | CI concurrency-group cancellation measured 22/45 (48.9 pct) Agent-policy runs cancelled same day; hour-frame key census: 218 live UTC-keyed rows vs 6 live ET-keyed (111 soft-deleted counted separately) | 3 of 6 audit findings dissolved on re-measurement before any edit | Hour-frame remediation: 3 options laid out, no decision -- operator's call | `RECONCILIATION.md:601-629` |
| 2026-08-27 | #1946 | Home / Now-card | `NOW_WEIGHTS` real-terms ranking (roi demoted 0.35->0.15; due 0.25; staleness 0.15; dollar-from-title 0.15 armed-but-mute; mission 0.15; friction 0.10; energy 0.05); `HABIT_CLASS_MULTIPLIER 0.5` | roiScore had been hand-picked constants (open set of 11 -> `25:1 50:5 55:1 70:4`, 1.68 bits); old top-4 = four DAILY habits at constant 70; new top pick = untouched-42-day task over every habit | "six overdue invoices" audit claim refuted live: 0 open overdue tasks / 0 dollar-titles in this DB (that data belongs to nickstire/ALG) | Revenue items still never enter the candidate set (invoice->task bridge not built); `check:policy-coverage` red resolved same day via `scripts/seed-policies.ts` (102/102 upserted against prod) | `RECONCILIATION.md:538-575` |
| 2026-08-27 | #1947 | Brain / retrieval | First recall metric: 28-case labelled corpus from real operator chat queries run through real prod functions read-only; durable categories admitted to memory-recall whitelist; deterministic `deriveFastTopics`; true-KNN top-50 unioned into candidate pool | Baseline hit@5 = 0/28 on live chat lane pre-fix; after fix hit@5 0pct->50pct, MRR 0->0.448 (beats raw dense 39pct); topic-extraction stage measured p50 4,183ms/p90 11,294ms (blowing the 3s race, 0/118 turns fired pre-fix); post-fix topics p50 4,183ms->0ms | Naive RRF(A+B) fusion scored 43pct hit@5, below the fixed lane's 50pct -- not built; weighted fusion parked (corpus n=28, need >=50) | Identity-slice queries ("how old am i") 0/4 on every lane; lexical FTS spikes 1.6-1.9s on some queries, still busts the 3s race | `RECONCILIATION.md:502-537` |
| 2026-08-27 | #1929, #1935 | CI / adoption gates | External deep-research audit plan-gated against `docs/UPSTREAMS.md`: 4 survivor proposals registered (#1929) then built same day (#1935) -- ast-grep `no-native-dialogs` gate both PWAs, dependency-cruiser layer rules, knip advisory census, MCP route-rejection canary | Both audit P0s REFUTED by code already in its own pinned baseline (bridge-rejection logging closed by #1487; media evidence wired by #1581); ~20/24 proposals mapped to existing register rows; knip census 341 unused files in this app alone; dependency-cruiser first real scan caught 1 dead dynamic import, then 1857 modules/6819 deps clean | ~20 of 24 external audit proposals already covered | 341-file knip census became the wire-or-delete backlog (closed same day, next row); prod OpenAI key rotation still pending | `RECONCILIATION.md:475-501` |
| 2026-08-27 | #1949 | Brain / retrieval | Retrieval lever wave: durable-slice KNN (exact MATERIALIZED-CTE scan over ~122-row personal partition, deliberately not HNSW) RRF-fused (k=60) into memory-recall; lexical `statement_timeout` 900ms; rerank call-site bound 1,500ms | hit@5 50pct->86pct, hit@10 ->96pct, MRR 0.72, identity slice 0/4->4/4, p50 138ms; lexical timeout cut max 2.9s->~1.1s | Measured + REJECTED: ef_search 200/iterative_scan (+21pp raw-pool containment but flat on endpoint hit@10, 96.4pct either way); topic caps flat; episodic split +1 case on n=28 only | Post-deploy behavioral confirmation pending (0 real turns at probe time); durable-vs-ephemera RRF weight parked until corpus >=50 pairs | `RECONCILIATION.md:448-474` |
| 2026-08-27 | none (classify-then-act wave) | Cross-repo | Wire-or-delete wave: 341-file knip census resolved to 0; 172/341 reclassified as false positives (declared as knip entries: scripts, seeds, `public/sw.js`); 126 verified-dead files deleted (~27k lines); knip gate flipped advisory -> BLOCKING with a deny-canary | Census 341 -> 0 after 3-pass check (import graph, stem grep, path-fragment grep); full gate after: verify:hard exit 0, 599/599 test files | n/a | `taskClass` still has no producer; 3 stale-doc WARNs surfaced (non-blocking) | `RECONCILIATION.md:424-447` |
| 2026-08-27 | none | Chat / voice | Dead-key blast radius + free STT chain: `lib/ai/stt.ts` free-first chain groq(dormant)->hf(live)->openai(self-heals); response carries `source`+`degraded` | hf lane LIVE-PROVEN: perfect transcript of known sample in 1,323ms; embeddings confirmed HEALTHY (Cohere absorbed load: 216 rows/day, baseline 175-280/day, total 92,441) despite dead OpenAI key | Rejected alternatives (measured): Gemini lane (429 spend-cap), browser SpeechRecognition (dead in installed iOS PWA), Deepgram (not free-forever), whisper.cpp (dominated on every axis) | Realtime voice overlay stays dead (OpenAI-only session mint); nearest free path = Gemini Live rebuild, WATCH; GROQ_API_KEY not yet set | `RECONCILIATION.md:576-600` |
| 2026-08-28 | #1967 | Missions / Home | Collect lane (b): follow-up-writer `roiScore` hand-blessed constant 70 -> default 50; writer always sets real dueDate | Prod TiDB read-only probe: ~2,900 shopdriver-sourced rows, 0 non-paid ever survived to data; non-paid>3d pool = 8 hand-entered rows (2 self-billed by operator's own number, 3 test fixtures, 3 unverifiable); scale check 2,959 paid rows / 1.43M dollars | An earlier "nothing writes pending" review claim corrected -- code does have a pending-write branch, it just never survives (0 observed) | `invoices.paymentStatus` stays structurally unreliable pending a separate register feed, out of repo control; 3 possibly-real candidates deliberately not seeded as tasks | `RECONCILIATION.md:359-392` |
| 2026-08-28 | #1968 | Brain / discover | Learning-loops wave, operator directive literally "close the learning loops" -- closest documented match to the brief's "close-the-loops #2028"; no doc uses that number. Stable content-identity hashing for counter_intuitive rows; live-surface verdict filter; corpus rider fixing eval cases structurally unable to fail | Prod: ALL 485 decided autonomous_actions rows all-time were decided by auto-purge, zero by the operator; 2/14 currently-detected blind spots are operator-judged, now suppressed; noise verdicts -> label-bearing eval cases 0->6 | Census REFUTED the wave's own briefing premise: known-suppression had largely already shipped in #1787; real gaps were elsewhere | Trust Ladder = REPORT ONLY pending operator sign-off; default Discover feed shows 0 engine cards (pre-existing) | `RECONCILIATION.md:328-358` |
| 2026-08-28 | #1983 | Chat / agent | escalate-on-ask: Ollama Cloud stays base lane; explicit depth marker only escalates to metered Anthropic; agent follow-ups on existing PostTurnOutbox (kind=agent-followup), 3 independent off-switches, fails CLOSED | prod: p50 user message 64 chars, 371/655 turns under 80 chars | Length-sensitive turn-hardness classifier BUILT, MEASURED, REJECTED (under-escalates short high-stakes asks) | mission promotion + Inngest Realtime streaming: substrate verified, build not started; dedupeKey TOCTOU bounded not eliminated | `RECONCILIATION.md:290-327` |
| 2026-08-28 | #1977 (commit labeled WP2) | Chat | Durable resume: Postgres-registry poll-based partial-reply tail (deliberately not the AI-SDK-documented `resumable-stream`+Redis pattern); GET route returns 204 unless `status==="complete"` | Rule-7 retroactive doc check: AI SDK's docs prescribe `resumable-stream`+Redis for resumable streams, and Redis (`REDIS_URL`) is already live in prod with real consumers (`lib/utils/redis.ts`, `cache.ts`) -- so the divergence is a deliberate choice, not a forced one; corrected in the same doc rather than left standing | The WP2 commit's own claim that the SDK pattern was "FALSE for this system's shape" was overstated -- self-corrected in the same audit doc | Flagged, not adopted: switching to `resumable-stream`+Redis would delete the ~80-line tail loop but needs a new UPSTREAMS row and explicit operator go | `docs/audits/CHAT-COMPLETION-PHASE0-2026-08-28.md:142-160` |
| 2026-09-01 | #2047, #2048 | Home | "Command Surface": all reasoning moved out of React into `lib/home/operator-brief.ts` (`buildOperatorBrief`+`buildBriefChanges`); 6 fixed client sections; attention budget <=7 actionable objects enforced in the builder; #2047 deletes 12 orphaned home components; #2048 drops the whole money-nav section (`/business` hub entry) on operator verdict "they both dont do shit" | verify:hard caught the wave's own defect pair pre-push (2 a11y source-guards reading deleted components); 620 files/6,682 tests in the red run, post-fix mobile-a11y 24/24, tsc exit 0; deploy verified live same day via `/api/version` commit match | Research thread's premise "Nick's Tire content on /" measured FALSE before acting on it; no fabricated confidence pct in the brief (uses the real scorer's explanation strings) | Prod `OPENAI_API_KEY` still dead (mic/realtime/TTS-primary down); several tRPC/REST endpoints orphaned by the rebuild, pending next knip census; machine incident (C: hit 0 bytes free mid-wave) | `RECONCILIATION.md:247-289` |
| 2026-09-01 | referenced as "Missions #2052" in the same-day Journal+Settings entry; the Execution Deck wave's own header carries no PR number | Missions | "/missions rebuilt as the Execution Deck": one read model `lib/missions/deck.ts` (`task.deck`); scorer v2 continuous 21-day due ramp replacing a staircase, new `active`/energy-fit terms, `BLOCKED x0.35` + `SHOP x0.7` multipliers; triage airlock; park/resume (`parkTask`+`task.park`); due-time push via Inngest sleeper (only reliable reminder path on an iOS PWA, no Background Sync in WebKit) | Input-scale bugs found and fixed: crm-followups wrote roiScore on a 0-100 scale into what should be 4/2; chat-created missions wrote priority 1-100 into a 1-10 world; brain-graph driftRisk threshold >70 days never fired, now >5 | n/a | WorkItem AI queue still has zero producers; 6 knip-allowlisted loop-stream orphans untouched; invoice import stays operator-gated | `RECONCILIATION.md:201-246` |
| 2026-09-01 | committed, push held for operator | Journal / Settings | Truth wave inside operator-approved compositions, no recomposition (BDN-005 lesson: "reshuffling approved layouts is how plans get refuted"). Settings: 5 writer-with-no-reader AI controls dropped; 12/37 feature flags marked `readOnly:true` in FLAG_REGISTRY (their Force ON/OFF buttons flipped a dot while changing nothing); cron kill-switch dead cache-key bug fixed. Journal: insights preview capped to 1 primary take + disclosure (was 6 standing decisions on one screen); `FeedEntry` stopped shipping the entire Prisma row (`raw`) to the client; 4 zero-caller tRPC procedures deleted | Every mobile-a11y source pin preserved (4 files, 70 tests green) | n/a | Double-accept ontology unresolved (a journal nextAction is both a Home judgment-queue commitment and a /journal accept->task, same source, two object types) -- named as a design decision, not a wave fix | `RECONCILIATION.md:154-200` |
| 2026-09-01 | #2057, #2058, #2059, N-1 follow-up (#2060); further follow-ups #2062, #2064, #2065 same day | Cross-surface / security | Read-only forensic audit + master research brief + a ranked decision doc, then every VERIFIED defect fixed test-first. #2058 (P0): `middleware.ts` treated any dotted non-API path as a static file BEFORE the session check -- `/decisions/1.2` etc. were live-200 unauthenticated across three deploys; fixed both the `includes(".")` half and a second matcher-skip half the reviewer found. #2059: memory quarantine (P-1) had zero production writers of `containsExternalContent`, now wired so inbound gmail goes through a real guardian into `/system/inbox`; prompt-fencing (S-1) for tool_data memory blocks | #2058 verified on prod `1bc3d43` at 2026-09-02 00:13Z: all 5 bypass shapes now 307; #2062/#2064/#2065 follow-up found S-1 had fenced only 1 of 5 memory-rendering prompt blocks, now all 5 fenced with a mutation-canary gate; full suite 627 files/6,732 passed with #2059 in the tree | n/a (this is itself the register that refutes the audit's own P0s in other waves) | Explicitly listed "not investigated at all" (audit section 19): webhook signature verification for stripe/make/nickstire/inbound-crm, SSRF via URL tools, uploads, token rotation, CSRF, rate limits, audit-log integrity, backups -- no authenticated control was ever exercised end to end. S-1 end-to-end attack (crafted email -> recall -> steered reasoning) remains a HYPOTHESIS, never executed | `RECONCILIATION.md:57-153` |
| 2026-09-02 | operator verdict on plan R7 (deletion itself carries no PR number in-doc; reviewed under #2069) | Home / nav | `/business` deleted: page + Money/Funnel/Clients tabs + orphaned location-ranking card removed; route redirects to `/stats`; context-hints, tool-result links, brain-graph anchors, page-visit list, `f` shortcut repointed or dropped. APIs it read (`/api/financial`, `/api/crm`, `/api/customer-360`, `/api/business/location-ranking`, `/api/analytics/revenue`) stay, auth-gated, for other consumers | #2069 review found 4 more consumers of the old route not caught in the first pass (a duplicate important-pages list, the chat lane-check map, scoreboard/ticker links, `?tab=` riding the redirect into a blank `/stats`) plus 2 pre-existing dead targets nobody had noticed (`/strategy`, `/inventory`); `tests/repo/retired-routes-gate.test.ts` added | n/a | The coaching CRM (former Clients tab) has no navigable home now -- named explicitly as "the cost of delete" and accepted by the operator | `RECONCILIATION.md:118-129` |
| 2026-09-02 | #2068 | Home / nickstire bridge | Cross-app contract fix: nickstire's revenue push can now say `available:false` with a reason instead of silently defaulting to 0; this app's `app/api/command/data` stopped doing `revenue.todayEstimate ?? ... ?? 0`; new derivation in `lib/nickstire/shop-revenue.ts` returns `number \| null` + `revenueAvailable` + `revenueReason` | 8 new tests incl. an `available:false` fixture and a `{todayEstimate:0}` positive control (a counted zero must still render as 0) | The defect nickstire's own audit traced to this consumer ("the $0 crossed the boundary") is fixed at the read site, not just the push site | Verification disclosure: this machine had no statenour toolchain in any worktree at ship time, so the commit was pushed from a hookless scratch clone with CI as the only gate | `RECONCILIATION.md:40-55` |
| 2026-09-02 | #2073 | Observability | Langfuse: `lib/observability/langfuse.ts` exports `langfuseTelemetry()`; every one of 22 AI SDK call sites now builds its telemetry block through it (was 1 of 22, `nick-chat` only) | Gate `tests/observability/ai-sdk-telemetry-gate.test.ts`: mutation canary positive control was 20 bare call sites before the fix; 59 test files/754 passed on the affected set post-fix; offline pipeline probe 7/7 | Plan R8 said tracing was "off" because 2 Railway keys are unset -- reading the code found a SECOND, more serious reason (21/22 call sites untraced even with keys) that the plan had missed | Three env values (Railway secrets) remain operator-only; verification loop lives in `docs/integrations/langfuse-observability.md` | `RECONCILIATION.md:20-38` |
| 2026-09-02 | #2073, #2074 | Observability | Production closeout: Langfuse (#2073) + Sentry client/server/edge hooks (#2074) merged; Railway deploy `bc0a81be-491d-4d88-99de-87a0ffa3d23a` succeeded | Live unauthenticated `GET /api/version` read-back: `status:ok`, commit matches merge SHA, `environment:production`, **"langfuse: true", "sentry: true"** (quoted exactly as the doc states it, dated 2026-09-02) | n/a | Authenticated Langfuse API check returned ZERO traces at check time -- trace landing and a real Sentry event remain explicitly unmeasured until a real non-private model call and error read-back run | `RECONCILIATION.md:3-18` |
| 2026-08-25 | #1836, #1843, #1846, #1848, #1849 (+ same-day follow-up #1862) | Chat / observability | The real doc-titled "chat-stack wave" (distinct from the brief's own "#1977/#2032/#2019-2030" grouping, see gap note above). Phase-0 verdicts: 181 tools are in-process AI SDK functions, NOT MCP (ToolHive premise ruled inapplicable); pruned tool layer ~10-13pct of a request, NOT the cost problem; prompt is the cost center. #1843 wired Langfuse at boot + the one streamText choke point, **dormant until Railway keys** (this is the state #2073 later closed on 2026-09-02). #1846 removed VideoDB (zero successful uses ever: $0 account, empty collection, 0 sessions, 0 metrics). #1848 made dormant observability visible on /system; deleted a 3-month-dormant braintrust-wrap with zero call sites | #1849: built prompt 12,336 tok live, 72pct dynamic; ROOT CAUSE = agenda query with no cap rendering all 71 active items into every turn (2,646 tok, 21pct of prompt); #1862 same-day fix cut default prompt 49,344->41,448 chars (~-1,974 tok/turn) | ToolHive's premise "does not apply" (181 tools are 1 in-process MCP client, not many); Anthropic `defer_loading` ruled inapplicable (chat runs Ollama/minimax-m3, not Anthropic) | Broad catalog prune still gated on surfaced-data accrual; prompt levers 2/3 need an operator-picked A/B; `BRAINTRUST_API_KEY` still set in Railway, unused | `RECONCILIATION.md:939-1004` |
| 2026-08-26 | #1881, #1882, #1883, #1886, #1889, #1891, #1894, #1897, #1898 | Cross-surface / CI | Interaction-audit wave: audited a ~30-PR six-session day as interactions, not individual defects. Verdict: production was sound, the GATE LAYER was not. #1881 `check-gate-reachability` (every check/lint must be CI-invoked); #1883 found the anti-slop canary read its own SCRIPT SOURCE rather than running it, and its Inter-font regex had operands in the wrong order so the canonical import never matched; #1897 Home redesign fixed 6 issues on the page that later became the Command Surface (decide-arm the design promised but never coded, tap targets 36->44px) | Orphan-module ratio in the clock fix measured 26.9pct vs 6.7pct repo-wide base rate; 4 of the session's own first-draft canaries were WRONG, caught by the mutation step; 3 of 4 "fix these" items handed to the session dissolved under measurement | Refuted its own earlier findings: TTL working as designed, nickstire:booking wired but never emitted, a bridge 401 that was the session's own stale worktree key | 170 no-expiry emotional_state rows left as-is (operator: leave, they are the mood archive); nickstire booking events still dispatch no `booking_created` (6 blind consumers incl. manager-on-duty SMS) | `RECONCILIATION.md:866-938` |
| 2026-08-26 | #1837, #1838, #1840, #1844, #1856, #1859, #1860, #1866, #1870, #1888, #1890, #1892, #1895, #1896, #1899, #1901, #1902, #1911, #1913, #1915, #1923, #1926 | Cross-surface | Surface-honesty wave, 22 ships, one theme: "a surface that cannot say I do not know will say something false instead." Standouts: #1840 killed two live false-all-clears (a panel rendering a FAILED read as green "all subsystems stable"); `tone="positive"` now type-gated to `provenance="ZERO"`. #1899 action-executor rewrite: 20/22 devices had been OFFLINE since April, level-triggered evaluation was sending 24 messages/day about a 4-month-old fact. #1913 found 691/719 page_visit rows in 30d carried a UTC hour against an ET timestamp (a clean +4h bug from commit `1202bdd0f`). #1923 found `energy-router`'s "no data" diagnosis was itself wrong -- one bad filter (`actualMinutes>0` on a column nothing writes) discarded 124 real completions | Measurement reversed the wave's own plan 4 times: 18 remaining envelope casts were all correct (base rate predicted ~7 of 11 broken, observed 0); an ET-weekday residual carried for sessions was refuted at 11,616 checks (0 mismatches) | `automation-engine` reported broken twice by the session, wrongly, before a third measurement held; an "intermittent ~50pct CI failure" claim retracted -- inferred from PRs that never ran the suite | turbo-affected verify cancels on main ~17pct of the time, UNDIAGNOSED (24 success/5 failure over 29 runs, smells like host memory contention, unconfirmed); task-timer duration capture is effectively unused (0 of 268 rows above zero minutes -- an adoption gap, not a plumbing one) | `RECONCILIATION.md:663-865` |
| 2026-08-20 | #1735 | Cron / infra | The cron storm (matches operator memory topic `statenour-cron-storm-2026-08-20.md`). `mega-fanout` writes `status:"partial"` on partial child failure (2,536 prod rows) but the 14-day tallies bucketed only success/failed, so the healer classified a job running every few minutes as NEVER RUN and healed it via `/api/cron/mega?slot=evening` -- whose own EVENING_JOBS list contains cron-healer. Parent healed its own child, child re-triggered parent | `mega-evening` ran 1,237 times between 03:04:37Z and 08:38:28Z with zero successes; both prime suspects (undeployed #1703, unhealthy Ollama) were cleared with receipts -- #1703 WAS deployed and Ollama probed 200 throughout, its liveness probe only failed DURING the storm as a symptom | Ollama Cloud was NOT the cause (a symptom -- its probe failed only during the storm and cleared the moment it stopped) | Follow-up in flight at ship time: `diagnose-cron-failure` needed chronic-partial detection (it only read `status:"failed"`, filing zero diagnoses across 29 partial nights) | `RECONCILIATION.md:1103-1136` |
| 2026-08-20 | 1 PR (memory-loop wave) | Brain | Compiler resurrection: audit asked "why did 282 conversations produce only 14 summaries" -- probe found 283 conversations -> 15 LIVE rows vs 158 SOFT-DELETED; the nightly consolidation grinder had been eating the compiler's own prose output. Also: memory receipts (turn-time recall persisted, not reconstructed at read time), Backfill Studio, temporal evals | `messageCount` counter measured lying low on 5 rows (worst counter=1 vs real=15); prod backfill corrected 45 drifted rows, re-probe found 0 liars | n/a | Fan-out rows (`decision_log`/`insight`) get no `expiresAt` -- declared TTLs never apply to direct upserts | `RECONCILIATION.md:1137-1186` |
| 2026-08-19 | 1 PR (outcome-loop wave) | Brain / missions | `recordOutcome` had ZERO callers since 2026-07-28; `Task.outcomeRating`/`outcomeLesson` consumed by nothing; reasoning conclusions never re-entered recall. Built, then a 3-lens adversarial review found the first cut was ITSELF built-tested-unwired (both new engines consumed columns no surface wrote) -- fixed with real producers on /missions completion + rateDiscovery | A same-day round-3 operator-ordered full re-audit found a SECOND built-tested-unwired defect: the title-hash bridge had zero matching producers, so `recordOutcomeByContent` returned false on 100pct of invocations -- 3rd strike of the pattern in one wave | First producer had been wired into `today-zone.tsx`, which is UNMOUNTED dead code -- caught by post-merge zero-write prod verification | Nothing automated reads `outcomeUseful` -- harvest/eval-export/odometer are manual scripts, no cron; the loop currently terminates in the operator | `RECONCILIATION.md:1187-1257` |
| 2026-08-19 | 1 PR, 10 commits | Cross-surface | Architecture-reimagine wave. Canonical record: `REIMAGINE-VERDICT-2026-08-19.md`. Six parallel read-only audits gated against the 07-28 blueprint, then a pre-merge adversarial fleet (6 hostile finders + 12 refuters + 2 web researchers -> 55 deduped findings, **12 CONFIRMED, 0 refuted**). autoPriority polarity CANONICALIZED to one scale (0-100, higher=more urgent) -- the column had carried two opposite conventions with ~27 readers split down the middle, meaning the 8am MIT picker, daily scheduler, mission cards and Nick's own task list were structurally surfacing LEAST-urgent-first. "Unknown != zero" doctrine applied across Home/missions/system surfaces (TanStack v5 isError-vs-no-data rendered explicitly, never a calm 0) | 5 writers + ~26 readers of autoPriority aligned in one pass; BDN-310 supersession lane completed (9 reader source-pins) | n/a | Legacy `manualPriorityOverride` rows sticky-inverted until operator authorizes a remap via a read-only census script; WP-5 (warroom/research/simulator reachability) and WP-9 (Money tabs) remain operator decisions | `RECONCILIATION.md:1258-1317` |
| 2026-08-19 | #1697 (fix); landmine shipped in #1598 on 2026-08-16 | Cross-repo / CI | `apiHandler`'s success-path telemetry sampler (`duration_ms>1000 \|\| Math.random()<0.01`) called `prisma.apiRequestLog.create(...).catch(...)` -- the `.catch()` covers the promise, not a synchronous dereference throwing before a promise exists; when that threw, the same dereference repeated inside apiHandler's own catch block and threw again uncaught, so ~1pct of successful requests randomly REJECTED instead of returning their envelope | A 1pct coin-flip reddened CI intermittently and buried real 500s under the same signature for 3 days before root-caused | n/a | n/a (fixed same entry) | `RECONCILIATION.md:1318-1370` |
| 2026-08-19 | #1696, #1698 (2 PRs) | Infra / DB | Neon compute + cron-truth pass. Root cause of 64 hard cron failures was `ingest-reviews` missing `GOOGLE_PLACE_ID`/`GOOGLE_PLACES_API_KEY` on **statenour-web**, not nickstire (both were already set there). Bigger finding: **the DB was quota-locked read-only** (`default_transaction_read_only=on`), so the now-"passing" cron was writing nothing (`newCount:0` was a silent zero) | Burn: worker polled `/api/sync/queue/render` every 2 min while Neon suspends idle compute after 5 min, so it never scaled to zero -- `active_time` 443.7h of ~456h elapsed (97pct awake), 222.6 CU-h by day 19 of a 300 CU-h allowance | n/a | ⚠ Doc explicitly SUPERSEDED 2026-08-20 in its own text: the read-only lock lifted early (probed `off` at 11:55Z) -- kept as history of what the 08-19 session measured, not current state | `RECONCILIATION.md:1371-1435` |
| 2026-08-19 | 1 PR (Brain wave 2) | Brain | "The honesty pass": everything wave-1 flagged NOT built, built. Headline finding: **the research pipeline is structurally dead-ended and the UI was hiding it** -- the plan to merge Discover + Review + the orphaned `research_claim_candidate` queue was reframed after this measurement | All claims measured against prod read-only before implementing | n/a | See full entry for dead-code removal list | `RECONCILIATION.md:1436-1539` |
| 2026-08-19 | PR #1716 (Memory truth wave) | Brain | Follow-through on a 50-conversation forensic audit (282 conversations, 4,190 messages, 19,088 live memories, all read-only) AND a plan-gate over an operator-pasted "epistemic OS" architecture plan | 2 of the audit's own claims died under re-measurement before any code was written | n/a | n/a | `RECONCILIATION.md:1540-1599` |
| 2026-08-19 | 1 PR (Brain truth pass) | Brain | `/brain` infinite-spinner root cause proven: every layer of the request path could wait forever -- `lib/prisma.ts` built `PrismaNeon` with no `connectionTimeoutMillis`/`query_timeout`, vendored Neon driver defaults to `max:10` with an UNTIMED checkout queue and `connect_timeout=0` | n/a | n/a | n/a | `RECONCILIATION.md:1600-1703` |
| 2026-08-19 | 1 PR (OS-Health truth pass) | System | Operator asked "what are all these failures" on /system/health (5,486 cron ops, 2pct fail, 1,423 errors, a green ALL CLEAR banner above both numbers). Four parallel read-only audits traced every number to source | Findings were measurement defects and fail-open instruments, not an actual outage | The dashboard's own "ALL CLEAR" claim refuted by its own underlying numbers | n/a | `RECONCILIATION.md:1704-1836` |
| 2026-08-18 | 13 PRs | Chat / persona | Persona measurement arc, GATE-2026-08-14 fully executed. Canonical record `PERSONA-MEASUREMENT-ARC-2026-08-18.md`. "The operator's persona ask (maximally truth-seeking / obedient / non-sycophantic / calibrated) went from ~80pct-in-the-prompt-but-measured-nowhere to enforced-by-code-or-measured-by-instrument, in one day" | Summarized further in Section 2 (persona/prompt A-B register) | n/a | n/a | `RECONCILIATION.md:1837-1892` |
| 2026-08-16 | 1 PR (15th wave) | Brain / intelligence | Independent review of the Knowledge/Intelligence layer: "almost nothing missing, three things disconnected." Backend assessed stronger than the operator-visible experience: 8-class evidence ladder, deterministic commit gateway, RRF+cross-encoder rerank over pgvector, contradiction detection injected per chat turn already existed | n/a | The review itself refutes a rebuild premise -- most of the layer already existed, just disconnected from the surface | n/a | `RECONCILIATION.md:1893-2066` |
| 2026-08-16 | #1589-#1591 + prerender fix (4 ships) | Chat | Chat-quality arc: operator reported "half the tools won't work half the time, messages get cut short" and "it's not intelligent enough." Root cause was NOT the model, persona, context size, or tool count -- it was `maxOutputTokens=2000` truncating a thinking model that needs 3,000-3,600 tokens to finish an answer | 6 hypotheses tested, 5 refuted, 1 confirmed cause | Model/persona/context-size/tool-count all refuted as the cause before the real one was found | n/a | `RECONCILIATION.md:2067-2153` |
| 2026-08-12 | #1535-#1540, #1542 (7 ships) | Missions / attention | MISSION-scan gate: a pasted "MISSION Scan" plan gated at ~75pct incumbent (22nd gated plan of the project), then a second pasted "RETROFIT BUILD PASS" plan gated the same evening at ~85pct (23rd). Ships: Home's "468 PENDING" was 100pct `autonomous_action` approval="pending" (90pct >7d old) while the real `approval_requests` gate sat at 0; purged via the INCUMBENT `purgeStaleCategory` (not a new mutation) 468->44 | `MISSION-CALIBRATION-LEDGER.md` created as the persistent scoreboard both scans lacked -- summarized further in Section 2 | Both pasted plans measured largely incumbent (75pct, 85pct) before any new code | n/a | `RECONCILIATION.md:2154-2167` |
| 2026-08-12 | 12th wave, out-of-arc | Missions | Commitments bulk cleanup: 179 active -> 76, closing the tenth wave's deferred item | -- | -- | -- | `RECONCILIATION.md:2168-2183` |
| 2026-08-12 | 11th wave, out-of-arc | UI | More-sheet UI + architecture fix, operator-reported ("stale both UI and architecture") | -- | -- | -- | `RECONCILIATION.md:2184-2197` |
| 2026-08-12 | 10th wave, out-of-arc | Home | Pulse ticker staleness -- three root causes, operator-reported via screenshot | -- | -- | -- | `RECONCILIATION.md:2198-2209` |
| 2026-08-12 | 9th wave, 1 ship | Missions | Retrieval-side JIT complement -- `getAgendaItems` closes the loop | -- | -- | -- | `RECONCILIATION.md:2210-2215` |
| 2026-08-12 | 8th wave, 1 ship | Chat | The JIT section gate -- "the evidence-mandated build," shipped live with a mechanism receipt | -- | -- | -- | `RECONCILIATION.md:2216-2221` |
| 2026-08-12 | 7th wave, 1 ship | Chat / prompt | "The bigger reruns" -- BOTH pasted plan interventions put to a rerun and evidence-REJECTED | Both interventions tested, neither adopted | Two plan interventions REJECTED on rerun evidence (see Section 2) | -- | `RECONCILIATION.md:2222-2229` |
| 2026-08-12 | 6th wave, 1 ship | Chat / prompt | Both A/Bs RUN -- targeted-skeptic frame vs baseline, and a compact-prompt variant | -- | -- | -- | `RECONCILIATION.md:2230-2235` |
| 2026-08-12 | 5th wave, 1 ship | Chat / prompt | Turbo control (per-message composer chip arming `providerOverride:"anthropic"`) + prompt census + Ollama judge harness -- first anti-sycophancy data | **First anti-sycophancy measurement:** skeptic 3 wins / baseline 2 wins / 3 unstable; skeptic resolved false-premise cases (4/4 vs baseline 2-3/4) but baseline won BOTH strategy cases, and the judge rewarded skeptic on a control case (over-challenge risk visible) | **Evidence verdict: NO global Skeptic-default flip** -- data supports only a targeted skeptic frame on assertion-heavy/decision turns, to be A/B'd separately | -- | `RECONCILIATION.md:2236-2243` |
| 2026-08-12 | 4th wave, 1 ship | Chat | Context Manifest instrumentation + deterministic golden-signals suite | -- | -- | -- | `RECONCILIATION.md:2244-2249` |
| 2026-08-12 | 3rd wave, 1 ship | Chat | Tool budget goes live + Ollama pins flipped | -- | -- | -- | `RECONCILIATION.md:2250-2255` |
| 2026-08-11 | 2nd wave, same day, 1 ship | Chat / cost | Ollama-first VNext goes LIVE: cost firewall, memory Phase-1, truth incentives, deep canary, bake-off | -- | -- | -- | `RECONCILIATION.md:2256-2267` |
| 2026-08-11 | #1513 | Chat | NICK VNEXT gate + Claude 5 frontier-lane wave | -- | -- | -- | `RECONCILIATION.md:2268-2279` |
| 2026-08-10 | #1487, #1488 | Agent bridge / security | 17th pasted mega-plan gated ~90pct incumbent. #1487: a refused bridge call left no trace in any of 3 sinks (`/api/mcp` and `/api/actions/[tool]` skip `apiHandler`); `auditBridgeRejection()` now emits one line per refusal. #1488: `getToolRiskClass()` existed correctly but had exactly one importer -- 138 of 177 tools declaring no riskClass defaulted `\|\|"low"`, so every bridge SMS send and `runDeviceCommand` (a shell on the operator's machine) logged as low risk | Probe: a provable 403 produced ZERO `/api/mcp` log lines while `/api/health` logged 94x in the same window -- token brute-forcing an 177-tool surface was undetectable pre-fix; risk distribution moved `{(unset):138,low:27,high:8,medium:3,critical:1}` -> `{low:127,high:44,medium:3,critical:3}` | MCP Apps `ui://` resources gap given WATCH, not built (unanswerable whether anything calls the bridge) | #1488 not verified in production (every discriminating tool needs a DB write or Gmail read to prove); 42 credentials in `vars.json` git history still need rotation (Operator-only, 14 Tier-1/28 Tier-2) | `RECONCILIATION.md:2280-2291` |
| 2026-08-09 | #1460 | Voice / cleanup | The 8th pasted consolidation mandate ordered 4 `/api/vapi/*` routes deleted as nickstire duplicates; gating found code reading as unambiguously LIVE, so the session stopped and asked the operator rather than trusting either reading -- the VAPI provider account was the only authority that could resolve it | VAPI account API showed all 5 account-level tools were orphans attached to no assistant; `bdnick.info` had never been configured in VAPI at all -- the 4 routes had never received a single call | Both the "definitely dead" and "definitely live" readings from code alone were wrong; only the provider could say so | Generalized as UPSTREAMS failure mode #8: code describing live behavior is not evidence it runs, and an absent caller in the repo is not evidence nothing calls it | `RECONCILIATION.md:2293` |
| 2026-08-09 | #1369, #1371, #1455, #1456 (+ infra deletions) | Chat UI | `/chat` composer sat under the tab bar, two independent CSS causes: a `filter` on an ancestor became the containing block for `fixed` descendants (CSS Position L3), and an inline `visualViewport.height` beat the `h-full` class. Same-day infra: `statenour-voice` (crashed since 08-03) and `perplexica-mcp` (broken build pin) deleted, 13 Railway services -> 11 | Measured: shell bottom 829->840px, overlap 0->11px on the filter bug alone; 52.96px composer-under-bar gap measured live before the viewport-height fix | "Three confident-but-wrong conclusions" flagged explicitly as 3 distinct instrument failures, not 1 cause (mid-transition read, pre-ResizeObserver read, non-recursive CSSOM walk blind to Tailwind v4 @layer) | 44 secret-bearing keys (incl. DATABASE_URL, AUTH_SECRET, CRON_SECRET) remain in git history from a removed `vars.json` -- rotation is the only real fix, history rewrite forbidden | `RECONCILIATION.md:2297` |
| 2026-08-08 | #1453 (+ #1452 same day) | Chat | 4 streamdown plugins (`@streamdown/cjk+code+math+mermaid`) had ZERO importers since install; naive wiring would have been wired-but-intercepted because NickMessage's `pre` override replaced Streamdown's whole plugin dispatch | katex@0.16.47 exact-pinned; carousel format-pack budget bug fixed (a "write me a carousel" request had been losing its CAROUSEL ENGINE to the pack budget) | n/a | Visual QA of code-block chrome + hydrated mermaid render awaited the next deploy (SSR cannot see it) | `RECONCILIATION.md:2303` |
| 2026-08-08 | #1449, #1450 (2nd wave same day) | CI / chat | `check:lint-baseline` had been red since an eslint dev-minor bump minted a purity warning against a byte-identical-to-main file, absent from the baseline snapshot. Prompt bug: `trimPromptToBudget` splits only on `\n## ` headers, so ~30 sub-blocks titled `###` fused into ONE 80k atomic section that could only be dropped whole on the primary Ollama lane | prompt:size-check PASS all 5 scenarios after fix (content 73,429 -> 62,645 chars; content-deep 107,331 -> 62,645) | The permanent "AI 100pct err" banner was a status-vocabulary mismatch, not an outage -- prod probe found 63/63 rows in 24h and 164/164 over 7d were "complete", real error rate 0pct (4th sighting of this fabricated-signal class) | Deep-tier pack blocks still drop at build on deep asks -- operator prompt-tuning call whether they should outrank base sections | `RECONCILIATION.md:2307` |
| 2026-08-08 | none (gate only) | Chat | Chat-cockpit mega-plan gated ~85pct incumbent-or-refuted. "Delete legacy components/chat/" ruled REFUTED-dangerous (chat-v2 imports it); "Add missing Streamdown @source line" ruled INVERTED (NickMessage overrides all ~23 markdown elements so Streamdown defaults never render) | Two real gaps shipped same session: `X-Accel-Buffering: no` header on the main chat stream, and chat-feed a11y (`role="log"`, `aria-busy`, sr-only completion announcer) | ai-sdk-ollama/ollama-ai-provider-v2/ai-fallback ruled NATIVE (already implemented); Langfuse/Helicone already REJECT in the register; `compress:false` refuted by prod token-granularity-streaming evidence | 4 streamdown plugins flagged operator-decision-pending at this point (wired the next day, see above) | `RECONCILIATION.md:2311` |
| 2026-08-07 | none | Data model | WorkItem census framing REFUTED by prod: an earlier note called the queue "frozen = DORMANT"; prod showed the 17 rows are 16 COMPLETED + 1 FAILED, all dated 2026-03-19 -- a finished historical record, not a stuck backlog. `DATA-MODEL.md` corrected: WorkItem moved from TASKS/GOALS into SYSTEM/AUDIT | Independent re-verification of a duplicate-index migration against prod Neon: 0 groups remaining, confirming the earlier apply | An operator-facing "stuck backlog" framing refuted -- the queue completed and went idle when its producer was deleted 2026-05-31 | n/a | `RECONCILIATION.md:2315` |
| 2026-07-29 | #1185, #1187, #1189 | Brain / intelligence | 14th arc, morning receipts wave. WP-18 truth guard gained artifact-creation and browser-action claim classes (and an eval red-caught the wave's OWN loose "saved to X" clause misclassifying "saved to your library" as evidence -- removed before ship). Intelligence-brief compose now races a 90s timeout and degrades to an honest ingestion-summary so `briefing_logs` always gets a row (closes the "EMPTY EVER" failure class from 07-28) | WP-21 eval exporter proven live with 0 cases -- correctly honest for day-old ledgers | n/a | Eval datasets stay empty until operator verdicts accrue; brief degrade path verified by tests but first production receipt is clock-gated | `RECONCILIATION.md:2317` |
| 2026-07-28 late | 13th arc, 1 merge | Brain / health | Apple Health becomes an input system. An external audit's "no existing health implementation" claim REFUTED (10th incumbent catch that day) -- `BodyTracking` already existed with 3 brain analyzers consuming it. Shipped bridge = Health Auto Export posting device to own endpoint directly (native SwiftUI bridge marked WATCH, not built) | `health_samples`+`health_ingest_batches` applied to Neon, independently verified 14+8 cols, 6 indexes | The audit's core claim ("no existing implementation") was wrong -- the incumbent just wasn't reachable from the health-input angle the audit searched | n/a | `RECONCILIATION.md:2321` |
| 2026-07-28 late | 12th arc, 1 merge | Missions / brain | The kernel batch: commitments become the loop object (`proposed->active->verified\|abandoned`), read-mode becomes a HARD gate (`stripMutatingTools` runs last in prepare-tools, fail-closed on 3 tripwires), closing a loop first opened 2026-06-10 | 167 lint warnings, 7 under the 174 baseline | An external "operator control system" doctrine's `canClaimDone` P1 REFUTED -- already wired with tests since July | Mutating-prefix list is a curated heuristic, not exhaustive; read-mode enforcement verified by typecheck+code-read, not an integration test | `RECONCILIATION.md:2325` |
| 2026-07-28 late | 11th arc, 1 merge | Cross-repo | The blueprint audit -- whole repo mapped against ten consolidation concerns (43 pages, 373 API routes, 46 cron routes, 102 models, 24 Inngest registrations, ~172 tools), receipt-backed in `BLUEPRINT-2026-07-28.md`. Flagship finding: the brain-bus had been dead since Wave AE (2026-05-28) -- 9 producers kept publishing into a consumer with zero callers, 393 pending events backlogged (task.completed 184, brain_dump.finalized 161, cron.failure 23) | Revived via a new drain cron; backlog replayed in ~2h | n/a | 8 work packages opened (WP-1 through WP-8), several explicitly deferred to operator verdict (WP-5 disconnected surfaces, WP-6 WorkItem merge-or-retire) -- see Section 2 for closure status | `RECONCILIATION.md:2329` |
| 2026-07-28 | 10th arc, 11 merges | Cross-repo | The operating-spine day: 11 statenour merges in one session, 4 external audits gated, 4 already-built incumbents exposed. Found ~16 Inngest functions unregistered (briefing_log EMPTY EVER); 513 naked silent catches scanned, 148 documented-intentional, 29 converted; a triage contract was BUILT then DELETED same-day when its own incumbent (`InboxTasksTriage`) was rediscovered mid-wave | vitest "exit-1 folklore" retired -- suite measured actual EXIT 0 | Self-built triage contract found to duplicate an existing incumbent within the same session, deleted before merge | Memory-gateway SHADOW mode runs to ~08-04 before any write-semantics change; approval/decision cards awaited first live receipts | `RECONCILIATION.md:2333` |
| 2026-07-28 | 9th arc, 2 merges | CI | Self-audit of the day's own CI work: 4 reviewers -> adversarial refuters, 44 issues raised, 9 confirmed / 5 refuted / 30 never verified (pass capped, not exhaustive). Found the node-sweep's real defect: turbo defaulted to concurrency 10 while the job granted every process a 6GB heap -- sampler proved max avail 6921MB (not the 16GB a comment claimed), min avail 361MB | "Three silent no-ops in one day," same shape each time (asserting a mechanism instead of exercising it): a duplicated heap flag, a near-miss env var, and a curl abort-check that could never match (`$(curl \|\| echo "000")` yields `000000`) | 5 false claims the session itself had written into comments, each corrected with the evidence (incl. "this job BLOCKS" -- no branch protection exists on this plan) | n/a | `RECONCILIATION.md:2337` |
| 2026-07-25 | 8th arc (latest), 1 merge | Chat | ONE conversation engine: Home's CognitivePartner strip now posts to the canonical `/api/ai/chat` with `privateMode:true` instead of running a separate side pipeline; `app/api/system/partner-stream/route.ts` DELETED (zero dangling refs) -- closes audit finding P1 "competing command centers" | n/a | n/a | n/a | `RECONCILIATION.md:2339` |
| 2026-07-25 | 7th arc, 1 merge | Chat / reliability | Durable post-turn outbox: new `post_turn_outbox` table, inline-first-durability-added semantics -- every turn enqueues its frozen deferred-work context BEFORE running it inline, so a mid-work crash strands a row instead of silently losing memory writes/receipts/journal ingest; nightly drain claims orphans past a 10-min grace window | n/a | n/a | n/a | `RECONCILIATION.md:2341` |
| 2026-07-25 | 6th arc, several merges | CI | Gate-integrity wave: verify:hard gains 5 real gates (check:env/runbooks/prompt-injection/audit-deps/lint-baseline); lint baseline regenerated truthfully (413 pinned warnings, ~30pct pointing at DELETED files, corrected to 174 real warnings across 83 files); `onWorkComplete` skip-path fix closed streams that had been holding open until the 120s maxDuration | Full suite 4,325 passed with 10 pre-existing reds fixed | n/a | Residual exit-134 is a documented Windows-local napi teardown flake, cannot occur on CI | `RECONCILIATION.md:2343` |
| 2026-07-25 | 5th arc, 1 merge | Home | **Origin of the "four questions" doctrine.** Home consolidation, audit P1, operator-approved scope + "brief-as-tap." HomeConsole redefined to answer EXACTLY four questions: (1) anything broken? -- `home-health-chip.tsx`, same honest-severity rollup as /system, UNKNOWN before measurement, never unearned green; (2) decisions awaiting? -- `FollowUpsList` mounted (had been imported-but-never-rendered); (3) do now? -- `ExecutiveActionMatrix` with honest copy (fabricated "peak operational efficiency" idle line and theatrical "Halt revenue operations" framing removed); (4) changed since last visit? -- `SinceLastVisitCard` mounted | n/a | n/a | `HomeBrainGraph` (820 lines) and `HomeEnginesDeck` unmounted from Home (files kept, live at /brain and /system respectively) -- this is the layout the later Command Surface wave (#2047, 2026-09-01) rebuilt on top of, not from scratch | `RECONCILIATION.md:2345` -- **see Section 3 for the doctrine's full current wording** |
| 2026-07-25 | 4th arc, 1 merge | Build / CI | `ignoreBuildErrors` REMOVED from next.config -- the build became a live TypeScript gate, poka-yoke-proven with a deliberate `const x:number="string"` probe that failed the build (exit 1) before ship | Two full `next build` runs completed green with the flag off over the exact dependency (`googleapis`) blamed for the original Apr-28 flag addition | The Apr-28 justification for the flag (Turbopack crashing on a "binary" .d.ts file) REFUTED -- the file was clean UTF-8, byte-inspected, zero NULs | n/a | `RECONCILIATION.md:2347` |
| 2026-07-25 | 3rd + 2nd arc, 2 merges | Chat | God-file decomposition, behavior-preserving: `persist-assistant-turn.ts` 1,927->492 lines (6 new single-responsibility modules); `route.ts` 1,833->962 lines (found a 27-field dependency bundle duplicated THREE times across code paths, now built once) | tsc 0, eslint 0, 13 chat test files 152/152, both passes had 3-lens/2-pass adversarial review | n/a | n/a | `RECONCILIATION.md:2349, 2351` |
| 2026-07-25 | earlier, quality-pass | Cross-repo | Truth wave against a 42-claim external audit (38 confirmed/1 refuted/3 overstated): README.md had 3 trailing NUL bytes making git/grep classify it as BINARY (every grep-based tool had been silently skipping it while it rotted with stale claims); two hardcoded-fake health chips (`() => "live"` always) replaced with measured status; e2e smoke tested 5 deleted-page routes | Suite had been structurally red since an audit added a doc-title assertion the root layout's flat "NOUR OS" title could never pass on most pages | n/a | n/a | `RECONCILIATION.md:2353` |
| 2026-07-22 | #1035 | Chat | Private Lab + composer authority controls, closing the "authority-kernel" audit. `privateMode` turn writes NOTHING (skips persists, detaches conversation id). First cut shipped through a 4-agent adversarial review that found **13 defects (2 blockers, 5 highs)** -- interceptors were still persisting titled conversations even in private mode, and the `"private"` convId sentinel leaked to the client, inverting privacy after toggle-off | 30/30 tests, 2 adversarial passes | n/a | 2 low-severity items deferred (deep-reasoning prompt head-slice, unmarked private turns in the visible thread) | `RECONCILIATION.md:2355` |
| 2026-07-22 | #1033 | Browser automation | browseAndDo shipped + closed 2 FAILED Railway builds. Root cause: Next compiles `instrumentation.ts` for BOTH runtimes regardless of a `runtime="nodejs"` declaration, so the edge pass bundled the whole tool universe (incl. `sharp`) and a lockfile hoisting shift made it fatal | Live E2E: read-permission browser run answered a real navigation question correctly in 3 steps/35s with self-recovery after a failed extract; deployed-container receipt confirmed `stagehand:{installed:true}` in prod | n/a | n/a | `RECONCILIATION.md:2357` |
| 2026-07-22 | #1030 | Browser automation | Browser operation LIVE, Stagehand v3 E2E-verified. Model resolution wired to the one funded lane, Ollama Cloud `deepseek-v4-pro` | E2E receipt: real zod-v4 extract+observe off a live page; gpt-oss:120b failed schema parsing, Gemini capped, OpenAI out of quota, OpenRouter ~0 credits that day | 3 alternative model lanes measured and rejected same day | n/a | `RECONCILIATION.md:2359` |
| 2026-07-22 | #1017, #1018, #1019, #1020 | Search / brain | Earliest wave inside the requested range. Perplexica repair + closed-loop Experiment factory + fallback-model refresh. Root cause of search quality proven from live SearXNG logs: every general engine (DuckDuckGo/Brave/Startpage/Google-CSE) is CAPTCHA/rate-limited on Railway's datacenter IP -> 0 sources -> silent Tavily fallback -- an infra reality, not a code bug. #1020: `RegisteredSource.authScore` now LEARNS via a 14-day Experiment horizon resolved by a daily cron, nudging trust via a bounded reversible EWMA | Migration verified live: `experiments` table + 3 cols + 2 FKs, pgvector untouched; closed-loop math tests 7/7, perplexica tests 30/30 | The search-quality problem was explicitly ruled an infra reality (datacenter-IP CAPTCHA blocking), not a code defect -- so no code-side "fix" for it was attempted beyond the timeout/health-gate work | n/a | `RECONCILIATION.md:2361` |

**End of table.** No RECONCILIATION.md entries exist between 2026-07-20 and 2026-07-22 (the file's next
older header after this row is 2026-07-07, outside the requested range). This table is exhaustive for
every `> ## ` and chained `> **DATE**` wave entry the file contains in the 2026-07-20 -> 2026-09-02
window -- nothing in range was skipped, though rows for waves not on the brief's explicit "cover in
detail" list are deliberately compressed to conserve the digest's word budget.

## 2. Refuted / rejected / do-not-re-propose register

### 2a. `docs/UPSTREAMS.md` (monorepo root) -- every disposition row

This is the project's own "check here before proposing" register, purpose-built for exactly this
digest's job (its own header: *"Nine external audits in two days re-proposed platforms this
monorepo had already adopted, already rejected with receipts, or already built natively... check
here before proposing"*). 95 data rows, file:line below is the exact source line in
`docs/UPSTREAMS.md`. Verdict vocabulary is the doc's own: ADOPTED / NATIVE / PATTERN / WATCH /
REJECT / DEAD (plus doc-local variants PARTIAL, DEFER, ADOPT-CANDIDATE, ADOPT-AS-CHECKLIST,
RESOLVED, REGISTERED, used verbatim below). Verdict counts (this session's tally, header pattern
match): **WATCH 24 -- REJECT 19-21 (2 rows carry a compound REJECT+other verdict) -- ADOPTED 14 --
NATIVE 10 -- PATTERN 8 -- DEAD 7-8 -- PARTIAL 4 -- ADOPT-CANDIDATE ~5 -- 1 each DEFER /
RESOLVED / REGISTERED / ADOPT-AS-CHECKLIST / ADOPT-AS-BENCHMARK.**

| Idea / upstream | Verdict | Note / trigger | file:line |
|---|---|---|---|
| `resumable-stream`+Redis (AI SDK v6 documented resume transport) | REJECT, keep Postgres tail | Redis IS live in prod (not the blocker it looked like); reopen if the Postgres tail shows a measured failure (duplicated bubbles, missed bytes) | `docs/UPSTREAMS.md:24` |
| Inngest mission promotion (long chat turns -> durable jobs) | DEFER | Need is MEASURED: prod 30d, 5/1,014 turns exceed Railway's 300s wall and can never finish; blocked purely on 2 UI files held dirty by a concurrent session | `docs/UPSTREAMS.md:25` |
| Higgsfield MCP (hosted, OAuth-only) | REJECT for app runtime; ADOPT-CANDIDATE dev-only | Cannot authenticate inside a headless Railway cron; incumbent REST client (`higgsfieldApiClient.ts`) already covers production. Addendum 2026-08-29: prediction held -- interactive path up, headless cron down for 5 days same week | `docs/UPSTREAMS.md:26` |
| Health Auto Export | ADOPTED (2026-07-28) | On-device exporter, no third-party server | `docs/UPSTREAMS.md:27` |
| yt-dlp | ADOPTED (2026-07-28) | Policy-guarded, fenced like firecrawl | `docs/UPSTREAMS.md:28` |
| Inngest (core) | ADOPTED, long-standing | 24 registered functions | `docs/UPSTREAMS.md:29` |
| Stagehand / Browserbase | ADOPTED (2026-07-22) | Live, Ollama Cloud lane | `docs/UPSTREAMS.md:30` |
| Camoufox | REJECT, duplicate | Stagehand lane already live; reopen if Browserbase cost bites -- and even then add as a second provider behind existing tool names, never new tool sprawl | `docs/UPSTREAMS.md:31` |
| Open WebUI | REJECT, duplicate | Its own guidance says "don't replace an existing chat app"; all 4 porting targets already exist here | `docs/UPSTREAMS.md:32` |
| HyperFrames | REJECT, duplicate | `@nour/reel-engine`+`@nour/social-assets` already produce autonomous reels | `docs/UPSTREAMS.md:33` |
| Outlines / vLLM | REJECT, wrong layer (2026-08-11) | Hosted Anthropic already takes native strict tool schemas; a second serving stack adds failure modes with zero benefit | `docs/UPSTREAMS.md:34` |
| Claude Ads | PATTERN, already native | Read-only default / manifests / deterministic audits doctrine already shipped | `docs/UPSTREAMS.md:35` |
| assistant-ui | PATTERN (2026-07-28) | Typed renderer registry built natively | `docs/UPSTREAMS.md:36` |
| Unsloth / Axolotl | WATCH, prereq: training data | Reopen when `outcomesNeedingReview` has ~200+ real correction cases AND recall-eval shows prompt-tuning plateaued | `docs/UPSTREAMS.md:37` |
| AutoTrain Advanced | DEAD | Upstream declares itself unmaintained | `docs/UPSTREAMS.md:38` |
| Vibe-Trading / Fincept Terminal | REJECT, wrong for this system | Personal-finance tab retired pending WP-9; Fincept also AGPL-licensed | `docs/UPSTREAMS.md:39` |
| "Nano Banana" / Open-Gen-AI | DEAD, unverifiable | Proposing audit could not pin the repo, neither could this session | `docs/UPSTREAMS.md:40` |
| Langfuse | ADOPTED, SDK wired dormant until keys (2026-08-25, #1837) | Supersedes a 2026-07-28 REJECT whose premise fell (no working observability existed). Fully activated 2026-09-02 (#2073/#2074, see Section 1) | `docs/UPSTREAMS.md:41` |
| BLS / BEA / Census (public data) | ADOPTED (2026-08-25) | A single-credential (FRED) macro outage on 2026-08-12 proved the need for 4 independent free sources | `docs/UPSTREAMS.md:42` |
| Trigger.dev / n8n as runtime | REJECT (2026-07-28) | 5 dispatch classes already run, census-guarded | `docs/UPSTREAMS.md:43` |
| A2A (Agent2Agent) | WATCH | Reopen if a second genuinely independent agent exists (voice loop is the only candidate) | `docs/UPSTREAMS.md:44` |
| A2UI | PATTERN -> WATCH | "UI as data" shape already matches the renderer registry | `docs/UPSTREAMS.md:45` |
| ARD (Agentic Resource Discovery) | WATCH | Internal concept already shipped as the capability registry | `docs/UPSTREAMS.md:46` |
| Plausible / PostHog | WATCH (2026-07-28) | Reopen when outcome-ledger + fleet metrics outgrow first-party receipts | `docs/UPSTREAMS.md:47` |
| Cal.com | WATCH | No booking-volume evidence yet | `docs/UPSTREAMS.md:48` |
| LangGraph | REJECT | Even the proposing 2026-07-29 audit's own conclusion was "formalize what's already present," done via `@nour/utils` contracts | `docs/UPSTREAMS.md:49` |
| OTel GenAI semconv | ADOPTED (2026-08-03) | Mapper + NDJSON export lane both live, zero new deps/ports/daemons | `docs/UPSTREAMS.md:50` |
| Braintrust | PARTIAL, eval-datasets only -- "wrap live" claim was FALSE (corrected 2026-08-25) | `wrapWithBraintrust` had ZERO callers since 2026-05-17 while the API key sat set in Railway; verified by file-existence, not caller graph | `docs/UPSTREAMS.md:51` |
| Phoenix (Arize) | WATCH | Same class as Langfuse but OSS/local; reopen only if AgentTrace + /system/ai-cost prove insufficient | `docs/UPSTREAMS.md:52` |
| GBP Performance API | ADOPTED, runtime gated by Google (#1193) | Read-only shipped; live blocked on Google quota=0 approval | `docs/UPSTREAMS.md:53` |
| NHTSA vPIC + recalls | PARTIAL-INCUMBENT (corrected from ADOPT-CANDIDATE, row 102) | Recalls lane already wired via `ingest.ts`; only VIN decoding absent | `docs/UPSTREAMS.md:54, 102` |
| GA4 Data API | PARTIAL-INCUMBENT | Already wired; the delta is a GSC x GA4 x leads JOIN, not the API | `docs/UPSTREAMS.md:55` |
| Lighthouse CI + CrUX | ADOPT-CANDIDATE | WP-22 companion | `docs/UPSTREAMS.md:56` |
| ActivityWatch | WATCH, personal-OS lane | Aggregates-only ingest after the health-lane pattern proves out | `docs/UPSTREAMS.md:57` |
| Home Assistant | WATCH | camera-bridge + SmartDevice are the incumbents | `docs/UPSTREAMS.md:58` |
| Actual Budget | REGISTERED as the WP-9 answer | If Money tabs return, IMPORT summaries -- never rebuild a finance app in-repo | `docs/UPSTREAMS.md:59` |
| AI SDK 7 | WATCH, one blocker cleared, trigger unchanged (updated 2026-08-03) | Node-24 floor is no longer the obstacle; still blocked on a patched `ai@6.0.162` dep + no NAMED v7 feature need -- explicit: "do not read the Node upgrade as permission" | `docs/UPSTREAMS.md:60` |
| OWASP LLM Top-10 / NIST AI RMF / MITRE ATLAS / CSA | ADOPT-AS-CHECKLIST | Threat-model reference for existing gates, not a dependency | `docs/UPSTREAMS.md:61` |
| OpenBB | REJECT-for-now | Same verdict class as Fincept/Vibe | `docs/UPSTREAMS.md:62` |
| Promptfoo | WATCH -- trigger TESTED, incumbent won (2026-08-03) | -- | `docs/UPSTREAMS.md:63` |
| `@openrouter/ai-sdk-provider` | WATCH (audit-13) | -- | `docs/UPSTREAMS.md:64` |
| BAML | WATCH (audit-13) | -- | `docs/UPSTREAMS.md:65` |
| Ax (DSPy-for-TS) | WATCH, same prereq as Unsloth/Axolotl (audit-13) | -- | `docs/UPSTREAMS.md:66` |
| MarkItDown | WATCH (audit-13) | -- | `docs/UPSTREAMS.md:67` |
| Docling | ADOPT-CANDIDATE, sidecar (audit-13) | -- | `docs/UPSTREAMS.md:68` |
| Crawl4AI | WATCH (audit-13) | -- | `docs/UPSTREAMS.md:69` |
| Graphiti | PATTERN (audit-13) | -- | `docs/UPSTREAMS.md:70` |
| mem0 `memory-benchmarks` | ADOPT-AS-BENCHMARK (audit-13) | -- | `docs/UPSTREAMS.md:71` |
| GraphRAG / LightRAG | WATCH (audit-13) | -- | `docs/UPSTREAMS.md:72` |
| mcp-scan | PATTERN, mechanism taken, dependency REJECTED (2026-08-03) | -- | `docs/UPSTREAMS.md:73` |
| OpenAI Agents JS | REJECT, duplicate (audit-13) | -- | `docs/UPSTREAMS.md:74` |
| LiveKit Agents | **WAS ADOPTED -> now RETIRED** (corrected 2026-08-03) | Explicit reversal of an earlier adoption -- flag this for any audit assuming LiveKit is still live | `docs/UPSTREAMS.md:75` |
| Pipecat | WATCH (audit-13) | -- | `docs/UPSTREAMS.md:76` |
| Claudegram | NATIVE, duplicate (2026-08-03) | -- | `docs/UPSTREAMS.md:77` |
| GramAddict | REJECT, no-evasion rule (2026-08-03) | -- | `docs/UPSTREAMS.md:78` |
| InstaPy | DEAD + REJECT (2026-08-03) | -- | `docs/UPSTREAMS.md:79` |
| instagrapi / instagram_private_api / InstaLooter / instagram-scraper / InstaTouch | REJECT, no-evasion rule, all four (2026-08-18) | -- | `docs/UPSTREAMS.md:80` |
| `ai-sdk-ollama` / `ollama-ai-provider-v2` | NATIVE (2026-08-08) | provider.ts already runs Ollama Cloud primary with per-provider breakers | `docs/UPSTREAMS.md:81` |
| `ai-fallback` / `ai-retry` | NATIVE (2026-08-08) | -- | `docs/UPSTREAMS.md:82` |
| `@t3-oss/env-nextjs` | NATIVE (2026-08-09) | -- | `docs/UPSTREAMS.md:83` |
| stylelint + declaration-property-value-disallowed-list | NATIVE (2026-08-09) | -- | `docs/UPSTREAMS.md:84` |
| Temporal (workflow engine) | REJECT, duplicate (2026-08-09) | -- | `docs/UPSTREAMS.md:86` |
| Debezium / log-based CDC | REJECT, over-provisioned (2026-08-09) | -- | `docs/UPSTREAMS.md:87` |
| Transactional outbox (pattern) | PATTERN, adopt WITH the write path not before (2026-08-09) | Realized 2026-07-25 as the durable post-turn outbox (Section 1) | `docs/UPSTREAMS.md:88` |
| gitleaks | PARTIAL (2026-08-10, corrected same day) | Scoped BASE..HEAD by design -- cannot catch pre-existing leaked secrets in history (see ROS-011/012 rotation item, Section 5) | `docs/UPSTREAMS.md:89` |
| FAQPage / HowTo rich results | DEAD upstream -- but LEAVE THE MARKUP (2026-08-09) | -- | `docs/UPSTREAMS.md:91` |
| AEO/GEO "special schema + 40-60 word answer blocks" | REJECT, contradicted by the vendor (2026-08-09) | -- | `docs/UPSTREAMS.md:92` |
| `AutoRepair` + LocalBusiness schema suite | NATIVE (2026-08-09) | -- | `docs/UPSTREAMS.md:93` |
| Ahrefs (MCP/API) | DEAD, entitlement not merit (2026-08-09) | Units=0, needs top-up (see Section 5 pending items) | `docs/UPSTREAMS.md:94` |
| Supermetrics (MCP) | DEAD, entitlement (2026-08-09) | -- | `docs/UPSTREAMS.md:95` |
| Search Console ingest (first-party) | NATIVE (2026-08-09) | -- | `docs/UPSTREAMS.md:96` |
| `modelcontextprotocol/ext-apps` (MCP Apps) | WATCH -- protocol gap real, capability gap is not (2026-08-10) | The one genuine gap flagged in the #1487/#1488 agent-bridge wave (Section 1) | `docs/UPSTREAMS.md:98` |
| Bridge request logging (first-party gap) | DEFECT, found while gating the 17th plan (2026-08-10) | Fixed same day as #1487 (Section 1) | `docs/UPSTREAMS.md:99` |
| `microsoft/playwright-cli` + Skills | ADOPT-CANDIDATE, dev environment only (2026-08-10) | -- | `docs/UPSTREAMS.md:100` |
| WebMCP (`document.modelContext.registerTool`) | WATCH (2026-08-10) | -- | `docs/UPSTREAMS.md:101` |
| "Capability compiler" (one spec -> many surfaces) | NATIVE (concept), WATCH (formalization) (2026-08-10) | -- | `docs/UPSTREAMS.md:103` |
| in-toto / SLSA / Sigstore | WATCH (2026-08-10) | -- | `docs/UPSTREAMS.md:105` |
| Pact | WATCH (2026-08-10) | -- | `docs/UPSTREAMS.md:106` |
| Argo Rollouts / Flagger / Argo CD / Flux | REJECT, not applicable (2026-08-10) | -- | `docs/UPSTREAMS.md:107` |
| Bazel / Nx | NATIVE (2026-08-10) | Turborepo already fills this role | `docs/UPSTREAMS.md:108` |
| OpenSEO | REJECT as an application -- does not solve the real gap (2026-08-15) | -- | `docs/UPSTREAMS.md:109` |
| Postiz | REJECT, duplicate + safety regression (2026-08-15) | -- | `docs/UPSTREAMS.md:110` |
| Auto-Editor | WATCH -- real value, prerequisite genuinely absent (2026-08-15) | -- | `docs/UPSTREAMS.md:111` |
| Open SaaS | REJECT, wrong lifecycle stage (2026-08-15) | -- | `docs/UPSTREAMS.md:112` |
| Ax / DSPy corpus re-check | WATCH unchanged -- prerequisite may be closer than earlier row assumed (2026-08-15) | -- | `docs/UPSTREAMS.md:113` |
| edge-tts-universal | ADOPTED, fallback lane only (2026-08-27) | Powers the #1930 chat-read-aloud TTS_ENGINE=edge mitigation (Section 1) | `docs/UPSTREAMS.md:114` |
| `@bestcodes/edge-tts` | DEAD (2026-08-27) | DRM 403 measured live | `docs/UPSTREAMS.md:115` |
| Kokoro (kokoro-js) / Piper (piper-tts-web) | WATCH (2026-08-27) | -- | `docs/UPSTREAMS.md:116` |
| sherpa-onnx (WASM TTS runtime) | PATTERN (2026-08-27) | -- | `docs/UPSTREAMS.md:117` |
| knip | ADOPTED, BLOCKING CI gate (advisory 2026-08-27 AM -> blocking same day) | Census 341 -> 0 same day (Section 1 wire-or-delete wave) | `docs/UPSTREAMS.md:119` |
| dependency-cruiser | ADOPTED, blocking CI gate (2026-08-27) | Pinned dlx v18.2.0; first real scan caught 1 dead dynamic import | `docs/UPSTREAMS.md:120` |
| ast-grep | ADOPTED, blocking CI gate (2026-08-27) | Pinned dlx v0.45.2; `no-native-dialogs` rule over both PWAs' client trees | `docs/UPSTREAMS.md:121` |
| MCP Inspector | RESOLVED -- canary shipped, the dependency proved unnecessary (2026-08-27) | Register wanted the CANARY (a route-rejection test), not the tool itself | `docs/UPSTREAMS.md:122` |

**Reading this register for a fresh audit:** any proposal matching a row above should cite the row,
not re-litigate it. The doc's own posted rule (`docs/UPSTREAMS.md:124-138`, paraphrased): the live
repo is `C:\Users\nourd\NOURCITY` (a prior audit read a stale OneDrive copy and reported
months-old tool counts as current); `apps/statenour` is not the whole system (`packages/*` +
`apps/nickstire` hold half the incumbents audits propose rebuilding); prose tool-counts are banned
(pinned bidirectionally by a catalog-integrity test); and a `status:"inert"` field is a HARD
EXECUTION GATE, not a stale-registry bug to "fix" by flipping it active.

### 2b. `CURRENT-TRUTH.md` (root) -- header dated 2026-09-02, "last verified" line matches today

This is the app's designated single-screen truth file ("if any other doc contradicts this file as
a present-tense instruction, this file and live code win"). Its own explicit **"REFUTED, do not
re-propose"** list (`CURRENT-TRUTH.md:127-131`) for the 2026-08-16 chat-quality question: wrong
model pinned; tool overload (pruner already caps exposure at 24, `NICK_TOOL_BUDGET`); prompt/context
bloat (`PROMPT-AB-2026-08-12`+`12b`: incumbent scored 4 vs compact 3, below the PRE-REGISTERED >=3
lead threshold, abandoned as noise); stale pin; persona stance (`PERSONA-AB-2026-08-16-clean`:
A=3.50 vs B=3.08, lead -0.42, inside the frozen +/-0.75 pre-registered band on both runs, abandoned).

Other durable facts an audit should not re-derive: model catalog dead ends -- `deepseek-v4-pro`
retired upstream mid-session, `kimi-k3` returns HTTP 402 (outside the flat plan), `deepseek-
v3.1:671b` returns 410 gone -- **"do not recommend it"** is the doc's own wording for all three;
current pin `minimax-m3` is the only catalog model that "reframes," per the de-confounded bake-off.
`/knowledge` is RETIRED and redirects to `/brain` (its loader resolved a NOUR-OS vault path that
stopped existing at the monorepo import -- rendered zero files, always, silently). VideoDB fully
removed 2026-08-25 (corroborates Section 1's chat-stack-wave row). The chat permission picker's
"draft only, nothing runs" copy was FALSE -- draft and execute were the same code path; removed.
Tailwind v4 gotcha: a `:root` custom property is not a class until bridged in `@theme inline`
(`app/styles/tokens.css`) -- an un-bridged token silently emits zero CSS, no error; this shipped
once and produced a dead weekday-picker selected-state (#972/#973, 2026-07-20).

file:line `apps/statenour/docs/CURRENT-TRUTH.md:1-202` (read in full).

### 2c. `REIMAGINE-VERDICT-2026-08-19.md` -- the architecture-reimagine wave's canonical record

Six parallel read-only audits, gated against the 2026-07-28 blueprint so nothing incumbent got
re-proposed. Core product verdict, quoted: **"StateNOUR should be run as a truth instrument first,
advisor second, archive last."** System characterized as "structurally rich and epistemically
leaky" -- the disease is "information that dies at a seam," not missing capability. "Strongest
parts (protect these)" the doc explicitly warns not to rebuild: the write-governance stack
(remember() gateway Phase-1/2, wisdom gate, Review queue), the cron/fleet truth machinery post-
#1691, nav-chrome discipline (nav-items.ts feeding tabs/MORE/Cmd-K), and the chat-quality
instrumentation (8-axis judge, persona golden set). Biggest problems ranked -- 1 (autoPriority
dual-scale) and 2 (unknown-rendered-as-zero) and 4 (supersession no writer/reader) marked FIXED
same wave; 3 (broken learning loops) marked "partially addressed, rest is the next wave's spine"
(closed across the 2026-08-19/20 outcome-loop and memory-loop waves, Section 1); 5-7 (competing
status/staleness vocab, Home's client-side-read physics, "confidence theater" -- a re-sighting
count rendered as a fake percentage) explicitly left OPEN, ranked but not closed as of this doc's
date. External prior-art citations given for the fixes: unknown-is-not-zero matches Nagios
UNKNOWN/Grafana no-data/SRE fail-safe-aggregation doctrine; supersession matches Zep/Graphiti's
bi-temporal model + SQL:2011 closed-open boundaries. One operator action still open at doc date:
remap legacy `manualPriorityOverride` rows via a named read-only census script before authorizing
a bulk fix (also carried in Section 1's row for this wave).

file:line `apps/statenour/docs/REIMAGINE-VERDICT-2026-08-19.md:1-95` (biggest-problems list),
`:220-248` (closure notes + operator action).

### 2d. ULTRON-VISION.md, KNOWLEDGE-ENGINES.md, MCP-PLAN.md

**ULTRON-VISION.md -- is Ultron retired? No doc declares it retired outright, but the vision doc
itself is badly stale and should not be trusted.** Header claims "Status: SHIPPED, live at `/`
since v9.x," but its own two date markers are `Last updated: 2026-04-16` and `Reconciled at
v10.0.484 - 2026-05-08 EOD` (`ULTRON-VISION.md:388,392`) -- both **4 months before today** and
using a `v10.0.NNN` build-number scheme this project abandoned for commit-message versioning
sometime around Wave X (mid-2026, per RECONCILIATION's own "post-v10.0.X" note). The described
aesthetic (dark-black base, blood-red + gold accents, orbital visual motifs, "apex surface"
framing) matches NOTHING in the Command Surface rebuild that actually shipped 2026-09-01
(#2047/#2048, Section 1) -- that entry describes 6 plain client sections and explicit truth
discipline against "the design thread's own mockups," not an Ultron-styled cockpit. Concrete
dismantling evidence: `lib/services/ultron-ticker.ts` was flagged 2026-08-27 for a dead unused
dynamic import (adoption-gates wave, Section 1); an "ultron/ask omni-capture duplicate" component
was deleted as superseded on 2026-09-02 (#2060, Section 1). **Reading: Ultron-as-branding is being
dismantled piecemeal alongside the Command Surface rebuild, without any single doc updating this
one to say so** -- flag `ULTRON-VISION.md` for the operator rather than trusting its "SHIPPED" line.

**KNOWLEDGE-ENGINES.md** -- no in-document date found. Describes a currently-coherent-reading
"hub and spoke" contract: BrainMemory (Neon) is the one canonical online memory; Obsidian is a
local capture mirror; NotebookLM is external research; Graphify is dev-only; auto-learn writes
bounded outcome events. This is architecture, not the `/knowledge` PAGE that `CURRENT-TRUTH.md`
says is retired (2026-08-16) -- the two are easily conflated by a fresh reader; they are different
things (backend contract vs. a since-deleted page).

**MCP-PLAN.md** -- no in-document date found; describes a "Tier 1 Read-Only Spyglass" v1 plan for
a ChatGPT-facing MCP bridge (`getTasks`/`getMissions`/etc.), with local ngrok-tunnel test
instructions referencing a `.worktrees\mcp-bridge` path. Section 1/2a's agent-bridge material
(#1487/#1488, 2026-08-10) describes a PRODUCTION MCP surface already live with **177 tools**
across multiple risk classes -- far beyond a read-only spyglass. Whether MCP-PLAN.md is superseded-
by or is a subset-of that production surface is **not resolved by the docs read for this digest**;
flagged as needing a direct code check, not asserted either way.

### 2e. `BLUEPRINT-2026-07-28.md` -- work packages and closure status

Its own "build-vs-buy" table (`BLUEPRINT-2026-07-28.md:228-243`) graduated wholesale into
`docs/UPSTREAMS.md` on 2026-07-29 -- treat UPSTREAMS as the live continuation, this doc as the
origin. Work package closure, per the doc's own strikethrough/DONE markers plus later
corroboration:
- **WP-1 (hard-enforce read-mode): DONE same night, 2026-07-28.**
- **WP-6 (WorkItem merge-or-retire): CLOSED 2026-07-29 -- premise was WRONG.** WorkItem is a
  durable AI-job queue, not a competing task container; neither "merge" nor "retire" applied, it
  was reclassified into the queue family (matches the 2026-08-07 WorkItem-census-refuted row,
  Section 1 -- same finding re-confirmed twice, a month apart).
- **WP-2 (bus producer retire-list), WP-3 (thin-module tools: money=1 tool, missions=3), WP-4
  (bus health into fleet-truth), WP-7 (event vocabulary), WP-8 (outbox dead-state):** open at doc
  date, no later doc read for this digest confirms closure.
- **WP-5 (disconnected surfaces: warroom/research/missions-simulator):** explicitly still "remain
  operator decisions" as of the 2026-08-19 architecture-reimagine wave (Section 1) -- three weeks
  later, still unresolved. Any fresh audit proposing to "wire up" these surfaces should know this
  is a **standing operator-decision gap**, not an oversight.

file:line `apps/statenour/docs/BLUEPRINT-2026-07-28.md:188-227`.

### 2f. `NEXT-WAVE-2026-07-29.md` and `CONSOLIDATION-PLAN-2026-05-16.md`

**CONSOLIDATION-PLAN-2026-05-16.md self-discloses its own staleness** -- header: "**HISTORICAL
(superseded 2026-06-09).**" Kept for lineage only; do not treat as current (`:1-5`). Notable: its
own Wave 56 entry (2026-05-08-ish) already flagged "ULTRON-VISION stale header" as a to-fix item
-- the fix evidently only partially landed, since ULTRON-VISION.md's date markers are still
2026-04-16/2026-05-08 today (Section 2d).

**NEXT-WAVE-2026-07-29.md**, dated the day after the blueprint, records "Waves 0-8 shipped in one
branch, one commit per wave," with operator decisions applied same day: **"WP-5 DELETE (warroom -
research page - missions simulator gone...)"** and **"WP-9 DELETE (money tabs + nav entry +
`/api/finance/sync` corpse gone)"** (`NEXT-WAVE-2026-07-29.md:1-15`).

**CONTRADICTION FLAGGED.** This 2026-07-29 "DELETE" claim for WP-5/WP-9 conflicts with two later,
independently-dated sources: (1) the 2026-08-19 architecture-reimagine wave's own closing note
says **"WP-5 (warroom/research/simulator reachability) + WP-9 (Money tabs) remain operator
decisions"** (Section 1/REIMAGINE-VERDICT, three weeks after the claimed delete); (2) the
2026-09-02 `/business` deletion wave (Section 1) had to delete "the page, its Money/Funnel/Clients
tabs" as if for the first time, five weeks after NEXT-WAVE's claimed WP-9 delete. This digest does
not resolve which account is right -- possibilities include a narrower original deletion (e.g. one
route, not the whole surface), a re-added nav entry, or an overstated same-day claim -- but a fresh
audit should NOT assume WP-5/WP-9 were closed on 2026-07-29 just because that doc says so; the
2026-09-02 wave is the newest evidence and it found live surfaces to delete.

Also recorded same day: XP decay WIRED (negative-event rows, reversible); AI-flag rollout order
confirmed (`NICK_IMPORTANCE_RECALL` -> `NICK_CONTRADICTION_CLEANUP` -> verification stack ->
`NICK_AUTONOMY` last, one per week); fine-tune reopen trigger reaffirmed as ~200 real correction
cases AND a measured plateau (matches the UPSTREAMS Unsloth/Axolotl row, Section 2a) -- "500 just
delays the same decision."

file:line `apps/statenour/docs/NEXT-WAVE-2026-07-29.md:1-30`, `apps/statenour/docs/
CONSOLIDATION-PLAN-2026-05-16.md:1-30`.

### 2g. `MISSION-CALIBRATION-LEDGER.md` -- verdicts summarized (5 scan runs, 2026-08-12 to 08-14)

Persistent scoreboard created 2026-08-12 specifically because "no prior persistent calibration
ledger was found" for pasted MISSION-scan plans (Section 1's MISSION-scan-gate row). Five scan
runs logged: (1) 2026-08-12 first-run baseline, BDN-001..008; (2) 2026-08-12 evening "RETROFIT
BUILD PASS," BDN-1xx; (3) 2026-08-12 night UI/structure re-scan, BDN-101..106; (4) 2026-08-13 web
sweep, five parallel research lanes; (5) 2026-08-14 Nick-chat content/persona scan (two merged
runs) plus a later 2026-08-14 media-workspace/VideoDB arc (BDN-309..321, corroborates Section 1's
CURRENT-TRUTH VideoDB findings). Pattern across BDN-001..008 (the first run, read in full for this
digest): **6 of 8 SHIPPED same day**, 1 CLOSED (one real defect fixed, rest already incumbent), 1
REFUTED-IN-PART (BDN-005, "navigation needs one lifecycle vocabulary" -- nav was already
single-source lifecycle-sectioned; demoting the Money nav entry as proposed would have
contradicted the operator's real usage loop -- downgraded to WATCH-only). The ledger's own
"calibration rules for the next scan" (`:400-418`) are worth carrying into any fresh audit
verbatim: promote a finding to HIGH only after observing behavior/an artifact, never because a
comparable product announced a feature; gate against UPSTREAMS+CURRENT-TRUTH+trailing-week-git-log
+this-ledger BEFORE ranking; and **"a number quoted as the plan's thesis... must be re-measured
live before any phase is built on it -- this failure shape has now recurred in three plans."**

file:line `apps/statenour/docs/MISSION-CALIBRATION-LEDGER.md:1-43` (BDN-001..008 full),
`:400-418` (calibration rules).

### 2h. Persona A/B, prompt A/B, prompt census, Ollama bake-offs -- REFUTED-BY-MEASUREMENT

**Persona stance A/B (2 pre-registered runs, `PERSONA-AB-2026-08-15.md` + `-08-16-clean.md`):**
tested incumbent `identityBlock()` (A) vs. a "thinking-partner" stance (B) on a frozen decision
rule -- B graduates only if it leads mean insight points by >=0.75 AND doesn't raise the
sycophantic-opener rate. Run 1: A=2.25, B=1.75, lead=-0.50. Run 2: A=3.50, B=3.08, lead=-0.42. Both
runs' own futility-stop clause fired ("if after 2 full runs neither arm leads by >=0.75, the
persona is NOT the cause -- abandon this lever"). **REFUTED-BY-MEASUREMENT: persona-stance wording
is not the chat-quality lever** (do not re-propose a persona-copy rewrite as a quality fix without
new evidence).

**Compact-prompt A/B (2 runs, `PROMPT-AB-2026-08-12.md` + `-12b.md`):** incumbent (40,842 ch) vs. a
compact variant (31,594 ch, -23%, dropping Processing-intake/Behavioral-patterns/Active-agenda
sections). Run a: incumbent 0 wins, compact 2, unstable 4. Run b (more cases): incumbent 4,
compact 1, unstable 9. Graduation rule: compact may replace incumbent only if it wins-or-ties
overall AND never loses the agenda-dependent case. **Verdict: compact did not graduate** --
matches `CURRENT-TRUTH.md`'s "abandoned as noise" framing (Section 2b).

**Prompt census (`PROMPT-CENSUS-2026-08-12.md`):** measured via the real prompt-assembly path.
Headline: **a plain greeting pays ~9,485 tokens (37,941 chars) of system prompt**; the heaviest
scenario (content/carousel) runs 63,354 chars, 3pct under the then-65K cap. Top single section:
"CONTENT GENERATION MODE" at 7,027 chars / 11pct.

**Ollama Cloud bake-offs (3 runs, 2026-08-11/12/15):** deterministic weighted probes (tool/
reasoning/instruction/json, no LLM judge, no new spend). Run 1 (12 models) picked `nemotron-3-
ultra` top by score (0.9) but its median latency was **28,351ms** -- unusable despite the top score,
illustrating why the metric alone was insufficient. Run 2 narrowed to 2 finalists and picked
`minimax-m3` (0.84). Run 3 (de-confounded, added an insight-proxy metric) shows a 5-way tie at
score 1.0 (`glm-5.2`, `glm-5.1`, `nemotron-3-ultra`, `minimax-m3`, `gpt-oss:20b`) and the doc's own
stated pick is `glm-5.2`, fastest among the tied leaders at 1,308ms. **Note for a fresh audit:**
this table's own printed pick (`glm-5.2`) does not literally match `CURRENT-TRUTH.md`'s claim that
the currently-pinned `minimax-m3` is "the only model that reframes" -- the two documents use
different criteria (raw tied score vs. a qualitative reframing read done separately), not a
contradiction this digest can resolve from the docs alone. Confirmed dead across runs: `kimi-k3`
(HTTP 402 outside plan), `deepseek-v4-pro` (retired upstream between runs 1/2 and run 3).

file:line `apps/statenour/docs/PERSONA-AB-2026-08-15.md:1-30`, `PERSONA-AB-2026-08-16-clean.md:
1-35`, `PROMPT-AB-2026-08-12.md:1-17`, `PROMPT-AB-2026-08-12b.md:1-25`, `PROMPT-CENSUS-2026-08-12.md
:1-30`, `OLLAMA-BAKEOFF-2026-08-11.md:1-25`, `OLLAMA-BAKEOFF-2026-08-12-finalists.md:1-13`,
`OLLAMA-BAKEOFF-2026-08-15-deconfounded.md:1-27`.

### 2i. `RETRIEVAL-BASELINE-2026-08-27.md` and `CHAT-PIPELINE-STUDY-2026-08-27.md`

These are the two SOURCE documents behind Section 1's #1947 (retrieval-quality) and #1949
(retrieval-lever) wave rows -- the hit@5 0pct->50pct->86pct numbers originate here, not
independently re-derived; see those rows rather than duplicating. Their shared framing, worth
keeping: "the brain's retrieval had no recall metric anywhere -- every ranking multiplier is a
stated prior" before this pair of studies. `CHAT-PIPELINE-STUDY` additionally documents the full
chat-to-brain data flow as an architecture map (`:9-25`): chat route -> action parsing -> fabrication
guards L1-L5 -> persist -> background distillers (journal_brain_take / conversation_summary /
insight / decision_log / emotional_state / WITNESSED_COMMITMENT) -> `brain_memories` +
`vector_embeddings` (1024-dim Cohere, zero-padded into a 1536-dim column, symmetric query/doc side
so no ranking skew) -> nightly consolidation (~03:00-04:15Z) -> 3-lane RRF recall -> prompt. Useful
as a current architecture reference for a fresh audit, independent of its measured findings.

file:line `apps/statenour/docs/RETRIEVAL-BASELINE-2026-08-27.md:1-20`, `CHAT-PIPELINE-STUDY-
2026-08-27.md:1-25`.

### 2j. `docs/audits/*` -- title, date, one-line take (24 files, headers/first-lines only)

| File | Date | One-line take |
|---|---|---|
| 2026-07-28-cron-truth.md | 2026-07-28 | Adversarial cron-truth sweep, dimension 1; epistemic-key discipline (VERIFIED-runtime/code vs INFERRED) |
| ANTIGRAVITY-REPAIR-PLAN-2026-06-20.md | 2026-06-20 | External deep-research report verified against live code before any repair work |
| AUDIT-2026-05-05-deep-honesty.md | 2026-05-05 | "No more unknown issues before I close the laptop" -- 9 forensic probes vs live DB + provider APIs |
| CHAT-COMPLETION-PHASE0-2026-08-28.md | 2026-08-28 | Covered in full in Sections 1/2 (durable resume, chat-completion gate) |
| CHAT-ERROR-CLOSEOUT.md | 2026-06-10 | `.match` post-process crash fix + honesty hardening |
| CHAT-TRANSCRIPT-ERROR-AUDIT.md | 2026-06-10 | Companion transcript/error audit, same day |
| FRONTEND-DASHBOARD-AUDIT.md | 2026-04-30 | v10 Track B.1 |
| IA-REORG-CONTEXT.md | 2026-06-18 | Understanding-phase enrichment for an IA reorg (kaizen+karpathy+brainstorming stance), explicitly not implementation |
| IA-REORG-DESIGN.md | (undated header, "Status: DESIGN") | Read-only design doc, awaiting operator approval, no code changed at write time |
| JOURNAL-ADVANCEMENT-SESSION.md | 2026-06-10 | Journey Engine "Act" (next-action extraction) shipped on top of the Journal Brain foundation |
| PROMPT-COST-MEASUREMENT-2026-08-25.md | 2026-08-25 | Phase 4 of the chat-stack wave -- source doc for #1849's prompt-cost numbers (Section 1) |
| STATENOUR-ARCHITECTURE-INTELLIGENCE-REPORT.md | 2026-06-10 | Architecture map + best-in-class benchmark + transformation-priority roadmap |
| STATENOUR-EVOLUTION-AUDIT.md | 2026-06-10 | 7-lane parallel founder-report audit, ~925k tokens analyzed, product-evolution focus (reliability closed prior session) |
| TEST-COVERAGE-GAPS.md | 2026-06-29 | Track B.3 |
| WP1-FRONTIER-COST-MODEL-2026-08-28.md | 2026-08-28 | **"DECIDED 2026-08-28: (c) STAY ON OLLAMA. WP1 is CLOSED, not deferred"** -- directly underlies the escalate-on-ask wave #1983 (Section 1) |
| a11y-motion-perf-mobile-2026-05-12.md | 2026-05-12 | Read-only a11y+motion-perf audit of /chat |
| api-readiness-2026-05-12.md | 2026-05-12 | Static-analysis agent-readiness pass, "directional, not proof" |
| db-cost-access-patterns-2026-05-12.md | 2026-05-12 | Read-only Neon/pgvector cost+access audit |
| hour-frame-key-census-2026-08-27.md | 2026-08-27 | Source doc for the run-to-empty-batch wave's hour-frame numbers (Section 1) |
| mobile-a11y-audit-2026-05-12.md | 2026-05-12 | Spot-audit of two mastery surfaces |
| security-stride-owasp-2026-05-12.md | 2026-05-12 | STRIDE+OWASP forensic pass, CVSS-3 scored, single-tenant context noted but kept in scope |
| silent-failure-sweep-v515-v524-2026-05-12.md | 2026-05-12 | 7-commit/36-file range sweep for silent failures |
| slow-paths-audit-2026-05-12.md | 2026-05-12 | 3 flagged slow paths from v10.0.499 preview |
| truth-cleanup-2026-06-09-stale-report.md | 2026-06-09 | Stale-info forensic report, truth+intelligence wave |
| voice-latency-tune-2026-05-12.md | 2026-05-12 | Sub-500ms speech-to-speech target vs ~800ms estimated baseline |

Most of this folder predates 2026-08-01 by design -- these are dated point-in-time audits, not
living docs, so age alone is not a staleness defect for them (unlike Section 4's active-doc list).

### 2k. `docs/adr/*` -- 24 ADRs, titles only (bodies not opened for this digest)

0001 AI provider chain -- 0002 CoALA three-lane recall -- 0003 v1/v2 prompt-builder split -- 0004
withGuardian failure categories -- 0005 Anthropic ephemeral cache -- 0006 pgvector on Neon -- 0007
skill semantic recall -- 0008 glitch-taxonomy prevention -- 0009 multi-agent parallel subagents --
0010 editorial-minimalism StandardPage -- 0011 axis-specific regen gate (chat vagueness) -- 0012
error-message sanitization -- 0013 per-tool daily quota -- 0014 tool-result data fencing (directly
relevant to the 2026-09-01 audit wave's S-1/#2062/#2065 fencing fixes, Section 1) -- 0015 decision
replay coach -- 0016 merge brain/life-ops IA -- 0017 task/subtasks semantics -- 0018 multi-advisor
board pattern -- 0019 explicit operator state model -- 0020 closed-loop calibrated brain -- 0021
P-wave and extension -- 0022 mastery Stage-A + side-pane chat (cited directly in RECONCILIATION's
Wave-Y entry, Section 1) -- 0023 recall freshness + dead-lane sweep (cited in Wave-Z, Section 1) --
0024 hidden high-risk warning (cited in the 2026-08-26 interaction-audit wave, Section 1).

**Titles only were read for this digest** (`apps/statenour/docs/adr/*.md`, 24 files) -- a fresh
audit relying on ADR RATIONALE (not just the decision) should open the individual files.

## 3. Design doctrine as documented

**The Home "four questions" doctrine (origin: 2026-07-25, Section 1) is the load-bearing IA
decision for the whole app's main surface, and it survived two later rebuilds.** Original wording
(`RECONCILIATION.md:2345`): HomeConsole answers exactly (1) anything broken? (2) decisions
awaiting? (3) do now? (4) changed since last visit? This shape was iterated, not replaced, by
#1897's 2026-08-26 home redesign and then by the 2026-09-01 Command Surface rebuild (#2047/#2048)
-- the Command Surface's six client sections (state line, brief lead, Nick command line, judgment
queue, horizon, change line) map onto the same four questions with an added command line and a
"horizon" forward-look. A fresh audit proposing a Home redesign should treat the four-questions
frame as settled doctrine, not open ground.

**Attention / notification doctrine -- bell retired in favor of tickers.** Confirmed in
`apps/statenour/docs/project/UI-UX-QUALITY-AUDIT.md:293` (2026-06-09 audit): *"Two persistent
tickers replace the retired bell."* Corroborated as still current by the 2026-09-01 audit wave
(Section 1), which treats `BottomPulseTicker` as a live component needing its own a11y test
(W-3) and corrects a stale comment about where priority alerts render (W-1) -- the ticker
architecture, not a bell/badge, is still the notification surface as of the newest wave read.

**Boundary doctrine -- personal OS vs. business ring, stated in three independent places.**
`ARCHITECTURE.md:118-120` (last verified 2026-05-21): *"Strictly separated. Nour's personal OS
never holds business ops state; the business admin never holds Nour's private brain. The bridge is
a thin sync + oversight channel."* `ULTRON-VISION.md` (stale but consistent on this point):
"Ultron is explicitly not a business war room. Business ops stay at nickstire.org/admin; the
bdnick.info personal OS gives business oversight only (one chip), not operational control." The
2026-09-01 Execution Deck wave applied this as a live scoring rule: `SHOP x0.7` multiplier
"boundary §3 -- BUSINESS-domain dampened on the personal OS unless the due ramp is hot"
(`RECONCILIATION.md:229`). Net: this is a three-times-independently-stated, currently-enforced-in-
code doctrine -- a fresh audit should not propose merging business operational control into
bdnick.info.

**DESIGN.md + aesthetic-principles.md** (design-system layer; both last touched pre-Aug-1, see
Section 4). Durable rules likely still enforced by CI gates (the anti-slop checklist references a
pre-push gate for two of its items): no purple gradients, no Inter/Roboto Google-Fonts imports, no
decimal-opacity Tailwind utilities (use `color-mix(in oklab, ...)`), three gold token variants
only (not a 50-900 scale), asymmetric layout preferred over `grid-cols-3`, DFII score >=8. Banned
copy: "Elevate/Seamless/Unleash/Next-Gen/Game-changer/Delve." Enforcement rule, quoted: **"delete
decoration, keep meaning."**

**AGENT-CONTRACT.md's "design philosophy" section quotes `UPGRADE-PLAN.md` verbatim** (`AGENT-
CONTRACT.md:214-233`: every page needs a knob/freshness-chip/provenance/drillable-log/etc.) --
**this is itself a live contradiction**: `CURRENT-TRUTH.md` (Section 2b) explicitly lists
`docs/project/UPGRADE-PLAN.md` as "v8.x, quarantined" historical material, "never paste as
current." AGENT-CONTRACT.md quotes it as active philosophy without that caveat. Flagged, not
resolved -- a fresh audit should decide whether the quoted knob/freshness/provenance rules still
apply as doctrine (many of them clearly DO still hold, e.g. freshness+provenance chips recur
throughout Section 1's honesty-wave fixes) independent of the quarantined source document.

**AGENT-CONTRACT.md's "5 lies you might tell yourself"** (`:134-145`) is worth carrying forward
verbatim as it is exactly the failure-mode list this whole digest exists to prevent: "it probably
works, I don't need to test" / "the orphan-detection script said this is dead" (a false positive
happened once, will again) / "this warning doesn't matter" / "I'll fix this one thing before the
plan" (leapfrogging breaks agent handoff) / "Nour won't care about this detail" (he will).

**OPERATOR-BIOGRAPHY.md, product-relevant excerpt only** (`:87-100`, "Instructions/System Rules"
section -- role and stated preferences, no sensitive personal detail): the Nick persona's
instructed advisory style is "brutal honesty, warm but uncompromising, accuracy-first adversarial
advisory," structured as chief-of-staff mode with a 7-part response shape (Bottom Line / What's
Really Going On / Strategic View / Tactical Plan / Psychological Read / Brutal Truth / Recommended
Move) for meaningful advisory requests. Business-copy tone is separately specified as "direct,
calm, confident... avoid hype, gimmicks, slang, emojis." One dietary constraint noted (no pork).
This is the STATED target persona the 2026-08-18 persona-measurement arc (Section 1) and the two
persona A/B tests (Section 2h) were built to move the system toward and then measure against.

file:line `apps/statenour/docs/DESIGN.md:184-220`, `aesthetic-principles.md:53-76,135-154`,
`AGENT-CONTRACT.md:134-148,214-246`, `ARCHITECTURE.md:1-10,118-120`, `OPERATOR-BIOGRAPHY.md:87-100`,
`ULTRON-VISION.md` (aesthetic section, Section 2d), `RECONCILIATION.md:2345` (four questions),
`docs/project/UI-UX-QUALITY-AUDIT.md:293` (bell/ticker). `NICK-AGENT-CONTEXT.md` structure noted
(`:1-179`, C4 system-context doc: personas, features, user journeys, external deps) but not read
in full for this digest -- flagged in the closing "docs not reached" list.

## 4. Stale-doc ledger

**`CURRENT-TRUTH.md` is NOT stale** -- header "Last verified 2026-09-02," matching today and the
2026-09-02 Langfuse/Sentry closeout wave (Section 1). This is the one doc in the corpus explicitly
kept in lockstep with the newest wave; treat it as the anchor for everything below.

**`.remember/now.md` is current** -- "Updated: 2026-09-01," content matches the 2026-09-01 audit
wave exactly (#2057-#2060). Not stale.

| Doc | Header/footer date found | Present-tense claim likely stale |
|---|---|---|
| `ULTRON-VISION.md` | `Last updated: 2026-04-16` / `Reconciled at v10.0.484 - 2026-05-08` (`:388,392`) | "Status: SHIPPED - live at `/`" and the whole blood-red/gold/orbital aesthetic description -- Home has been rebuilt at least 3 times since (2026-07-25, 08-26, 09-01); see Section 2d |
| `aesthetic-principles.md` | `Reconciled at v10.0.484 - 2026-05-08 EOD` (`:154`) | Color-token and layout rules likely still enforced by CI (durable), but the reconciliation date itself is 4 months stale -- unclear if it has been checked against anything shipped since May |
| `ARCHITECTURE.md` | `Last verified 2026-05-21` (`:3`) | The BUSINESS RING diagram and internal-layers diagram predate the `/business` page's full deletion (2026-09-02, Section 1) and the Command Surface rebuild; the "v8.x infrastructure highlights (Apr 29 mega-overhaul)" section (`:393-420`) is explicitly historical framing kept for lineage, which is fine, but the "last verified" line covers the WHOLE file including current-tense sections |
| `DATA-MODEL.md` | "model count last verified 2026-05-21" (`:3`) | Given the volume of schema changes documented in Section 1 alone since then (BDN-310 supersession columns, `health_samples`/`health_ingest_batches`, `post_turn_outbox`, commitment-lifecycle columns, `agenda_items`, dozens more) the model count is almost certainly wrong today |
| `SECURITY.md` | Body has a correction dated `2026-08-23` (`:253`), but its own closing reconciliation line still reads `Reconciled at v10.0.484 - 2026-05-08 EOD` (`:285`) | **The doc's own dating mechanism is internally inconsistent** -- the footer under-states how current the body actually is; a reader trusting only the footer would wrongly treat 2026-08-23 content as unverified |
| `OBSERVABILITY.md` | Self-flagged: "v10.0.529.106 Wave 75 status update... table below is partially [stale]" (`:3-6`) | Partially self-aware, but that self-correction is itself old (v10.0.529.106 era); does not yet reflect Langfuse/Sentry going live 2026-09-02 (Section 1) -- almost certainly needs another pass |
| `RUNBOOK.md` | No single header date; append-only dated-row table (rows from 2026-05-04 onward) | Format is lower-risk (each row self-dates), but no doc-level "last verified" line was found to confirm the whole file was swept recently |
| `AGENT-CONTRACT.md` | "Post-v11.1 status (updated 2026-04-22)" section header (`:246`) | That section specifically; the rest of the file (design philosophy, 5 lies, branch discipline) reads as evergreen operating doctrine and is lower staleness risk, but quotes the quarantined `UPGRADE-PLAN.md` as live philosophy (Section 3 contradiction) |
| `CONSOLIDATION-PLAN-2026-05-16.md` | Self-discloses "HISTORICAL (superseded 2026-06-09)" | None -- this is a GOOD example, not a defect: it discloses its own staleness rather than making silent present-tense claims |

**Reading:** the pattern across DESIGN.md/aesthetic-principles.md/SECURITY.md is a shared
boilerplate reconciliation footer ("Reconciled at v10.0.484 - 2026-05-08 EOD... if a claim
contradicts code reality, the code wins") that appears to have been stamped once and never
refreshed, even where a doc's BODY was later hand-edited (SECURITY.md's 2026-08-23 correction).
A fresh audit should not trust these footers as evidence of recency.

## 5. Open backlog (as documented)

### 5a. `RECONCILIATION.md`'s own "Open backlog" section (`:4368-4382`)

Moved out of the always-loaded `AGENTS.md` on 2026-08-21 specifically because dated content there
"goes stale silently and bills tokens every session." **Stamped 2026-07-28 and, by its own header,
"never auto-refreshed" -- treat each line as a lead to re-verify, not as truth**, though at least
two lines (below) show later hand-updates, so the list is not uniformly frozen either.

1. Scheduled-cycle proof (first real briefing_log row + heartbeat + worker artifact-liveness) --
   status not re-confirmed by this digest.
2. Memory write governance -- Phase-1 SHIPPED 2026-08-11 (default-on), Phase-2 SHIPPED 2026-08-16
   but OPT-IN and scoped (only `update` + `review_required`-for-`weaker_evidence`); the larger
   `unknown_category` slice (349/wk) still deliberately falls through. Next step named: a shadow
   review before any default flip, then wiring a reader for the applied-but-unread
   `validFrom`/`validUntil`/`supersededById` columns (partially closed later by the 2026-08-19
   architecture-reimagine wave's supersession lane, Section 1 -- re-verify current state).
3. Triage adoption -- code complete, adoption is operator behavior not a code gap.
4. Realtime completion-message push -- still a future transport change, not started.
5. Recall-eval corpus growth -- UNBLOCKED 2026-08-16 (writers exist now), **not yet populated as
   of this list's stamp** -- grows only as the operator judges; gate before retuning RRF/persona
   weights on it.
6. Chat-state visual regression -- Playwright screenshots of `/system/chat-states`, not built.
7. Approval/decision card runtime receipts -- first live renders were pending as of doc date.
8. **P9 confirm-cards / judge-eval calibration verdict, needs n>=30 -- "low priority."** Directly
   matches `CALIBRATION_TODO.md` (processed 2026-06-11, same n>=30/agreement>=70pct threshold) --
   two independently-dated sources agree this has been open since June and is still open.

### 5b. The 2026-09-01 audit's own "not investigated" list

Already captured in Section 1's 2026-09-01 Audit-wave row -- repeated here for completeness since
it is the newest and most consequential open-items list in the corpus: webhook signature
verification for stripe/make/nickstire/inbound-crm, SSRF via URL tools, uploads, token rotation,
CSRF, rate limits, audit-log integrity, backups -- **"no authenticated control was ever exercised
end to end"** (`RECONCILIATION.md:129`). This is the single most decision-relevant open list for a
fresh security-flavored audit to pick up first, since it is both newest and explicitly disclosed
as unexamined rather than merely unmentioned.

### 5c. Recurring "operator decision pending" items collected from Section 1/2 (cross-referenced, not re-derived)

| Item | Standing since | Pointer |
|---|---|---|
| Prod `OPENAI_API_KEY` revoked -- mic/Realtime voice/TTS-primary down | 2026-08-27, still open through 2026-09-01 | Section 1, #1930 + #2047 rows |
| WP-5 disconnected surfaces (warroom/research/missions-simulator) -- nav entry vs. URL-only vs. delete | 2026-07-28 blueprint, still "remain operator decisions" as of 2026-08-19 | Section 2e |
| WP-9 Money tabs -- delete-vs-keep, and a contradiction about whether it was already done 2026-07-29 | See Section 2f's flagged contradiction | Section 2f |
| `manualPriorityOverride` legacy rows -- sticky-inverted, need operator-authorized remap via a named read-only census script | 2026-08-19 | Section 1, architecture-reimagine row |
| ROS-011/012 credential rotation -- 42 credentials (14 Tier-1/28 Tier-2) in `vars.json` git history | 2026-08-10 | Section 1, agent-bridge row |
| `GROQ_API_KEY` not set (free no-card signup) -- STT chain currently on hf as primary, not groq | 2026-08-27 | Section 1, dead-key/STT row |
| 13 remaining PARKED components -- re-mount vs. delete | 2026-09-01/02 | Section 1, N-1 follow-up row |
| `/business`'s former coaching-CRM (Clients tab) has no navigable home -- named cost of the 2026-09-02 delete, accepted, not resolved | 2026-09-02 | Section 1 |
| langfuse:false / sentry:false window -- both flipped true 2026-09-02 but zero traces confirmed yet | 2026-09-02 | Section 1 |
| Ahrefs API units = 0 (needs top-up); GCP Places key REQUEST_DENIED | Pre-existing, carried in operator memory index (`nourcity-adoption-gates`, `frontier-scan` topics) -- not independently re-verified by this digest | out of scope for statenour docs, cross-app |

file:line `apps/statenour/docs/RECONCILIATION.md:4368-4382`, `apps/statenour/docs/CALIBRATION_TODO
.md:1-30`.

## 6. Master research brief's external-world claims -- for re-verification, not trust

Source: `apps/statenour/docs/research/2026-09-01-master-research-brief.md`, Section B
(`:164-280`), dated 2026-09-01, its own stated access date for every row **2026-09-01**. This
document is itself Class-D (a research brief, not verified code) and, per its own §B.8, discloses
which of its OWN claims it did NOT verify -- listed at the bottom of this table. An external-
research phase should re-check every row below against a live primary source, not this digest.

| Claim | Stated source | Note |
|---|---|---|
| AI SDK: repo pinned `ai@6.0.162` (2026-04-15) vs. current `7.0.89` (v7.0.0 shipped 2026-06-25) -- a full major behind; `@ai-sdk/openai`/`@ai-sdk/anthropic` pinned `^3.0.x` vs current `4.0.x` | Package registry version/date check, no named URL | Matches the UPSTREAMS.md "AI SDK 7" WATCH row (Section 2a) -- two independent docs agree on the gap |
| Structured output: Anthropic reached GA 2026-01-29 (`output_config.format`, strict tools); OpenAI Assistants API shut down 2026-08-26 | Not URL-cited in the excerpt read | "Will it return valid JSON" no longer a research question per the brief |
| Evals: OpenAI deprecating its Evals platform (announced 2026-06-03, read-only 2026-10-31, shutdown 2026-11-30); OTel GenAI semconv "NOT stable" -- deprecated out of `open-telemetry/semantic-conventions` v1.42.0 (2026-06-12) into a new repo with **zero releases** and "Schema URL: TODO" | `open-telemetry/semantic-conventions` repo + `semantic-conventions-genai` repo (named, no URL given) | Directly relevant: UPSTREAMS.md's OTel GenAI semconv row (Section 2a) says "ADOPTED 2026-08-03" -- a fresh audit should re-check whether that adoption still makes sense against an unstable, zero-release upstream spec |
| Agent benchmarks contested as capability proxies | arXiv 2507.02825 (validity failures in 7/10 widely-used benchmarks), arXiv 2606.19544 (judge reliability without validity, ~541k judgments), arXiv 2607.22368 (reward-hacking in ~2/3 of tested traces) | Named arXiv IDs -- directly re-checkable |
| Eval methodology frame: separate trajectory from outcome, calibrate judges against humans, use pass^k (a 75%-per-trial agent passes 3 consecutive trials ~42% of the time) | Anthropic, "Demystifying evals for AI agents" (2026-01-09) | -- |
| Retrieval defaults are backwards: BM25 beat dense retrieval on T2-RAGBench (Recall@5 0.644 BM25 vs 0.587 `text-embedding-3-large`; hybrid+rerank led at 0.816; HyDE underperformed at 0.544) | arXiv 2604.01733 (2026-04-02) | Directly relevant to this app's own RETRIEVAL-BASELINE-2026-08-27.md work (Section 2i), which independently found a similar durable-lexical-lane win |
| "When More Documents Hurt RAG": 54-1,128 docs dropped accuracy 75%->under 40%; fix was metadata-scoped routing, not a bigger index | arXiv 2606.11350 (2026-06-09) | -- |
| "Vector search not worth it below ~1,000 docs" | **No primary source found -- every instance traces to SEO blogs** | The brief's own explicit debunk of a commonly-repeated claim |
| pgvector is at 0.8.6 (2026-07-29), no 0.9 exists; `hnsw.iterative_scan` is a filtered-query index-scan feature, NOT an iterative-retrieval loop | Not URL-cited in excerpt | Corrects a claim "a prior StateNour session already refuted with numbers" -- internal cross-check |
| MTEB maintainers removed the private RTEB column 2026-01-14 over a vendor conflict of interest -- leaderboard position is not evidence | Not URL-cited in excerpt | -- |
| Agent-memory benchmarks contested: Zep disputes Mem0's LoCoMo results; Mem0's 92.5 is vendor-published with no baselines shown | Named parties, no URL given | A June 2026 survey of 435 works found forgetting addressed in 66, rollback in 27, poisoning in 25 -- source not further cited |
| **WCAG citation:** 2.2 AA remains correct target -- W3C Recommendation dated 12 Dec 2024 (republication of 2023-10-05 original), errata through 2026-08-17, became ISO/IEC 40500:2025 on 2025-10-21; SC 4.1.1 Parsing is obsolete/removed. Do NOT target WCAG 3.0 (a 2026-03-03 Working Draft whose own status section says not to cite it as more than in-progress) | W3C Recommendation + ISO/IEC 40500:2025 (named, no URL given) | -- |
| "Automated tools catch 57pct of accessibility issues" is vendor self-study folklore | Deque testing axe-core against Deque's own audit data (2021-03-10); contrast alone was 30pct of that sample; the criteria-based figure from the SAME report is actually 16 of 50 AA success criteria | The brief explicitly separates the popular quote from what the source report actually measured |
| **iOS/PWA constraints:** Background Sync, Periodic Background Sync, File System Access, and Speculation Rules are unsupported on Safari/iOS; Web Push works only for Home-Screen web apps | Not URL-cited in excerpt | Matches this operator's own standing memory note on iOS-PWA `confirm/alert/prompt` suppression -- consistent pattern, independently sourced |
| Core Web Vitals unchanged (LCP 2.5s / INP 200ms / CLS 0.1); CrUX release notes through 2026-07 show no new Vital, no INP methodology change | CrUX release notes (named, no URL given) | Explicitly "contradicting a wave of SEO blogs" |
| Newly usable since a 2025-vintage brief: anchor positioning + scroll-driven animations in Safari 26 (2025-09-15); Popover in iOS 18.3; OPFS/storage-persistence/`:has()`/container-queries widely available; Safari 26 removed installability requirements entirely | Not URL-cited in excerpt | -- |

**The brief's own "verification failures, stated" list (§B.8) -- explicitly NOT verified,
carried forward as-is so a re-check phase knows exactly where to start:** Stately's funding or bus
factor; ship dates for XState v6 or Yjs v14; Cohere Rerank 4's release date (the brief found
**three irreconcilable dates**) or its benchmarks; primary-source guidance on embedding-migration
cost; the Matryoshka "5-10pct loss at 512 dims" figure; live MTEB/RTEB ordering; whether Safari's
`storage.persist()` actually grants persistence.

file:line `apps/statenour/docs/research/2026-09-01-master-research-brief.md:164-280`.

---

## Coverage note

This digest prioritized every doc named explicitly in the dispatch brief; all were opened at least
partially and the highest-signal sections read in full (see file:line citations throughout). Not
opened at all: the ~190 other files under `apps/statenour/docs/` not named in the brief, including
entire subdirectories (`docs/agent/`, `docs/agents/`, `docs/bridge/`, `docs/business/`, `docs/
clarity-gate/`, `docs/integrations/`, `docs/migrations/`, `docs/people-tasks-fix/`, `docs/project/`
beyond the one UI-UX audit cited, `docs/runbooks/` beyond `brain-archive.md`, `docs/specs/`, `docs/
superpowers/`, `docs/tool-access/`, `docs/sessions/`, `docs/vapi-kb/`) and dozens of individually-
named top-level docs (GATE-2026-08-*.md x4, JUDGE-RUN-2026-08-12*.md x6, LEARNING-LOOPS-2026-08-28
.md, NICKSTIRE-QUERY-CONTRACT.md, REPO-MAP.md, and the ~30 older cohort/session/schema-audit docs
from April-June). Partially read, header/structure-only or a single section: `NICK-AGENT-CONTEXT
.md`, `KNOWLEDGE-ENGINES.md`, `MCP-PLAN.md`, `RUNBOOK.md`, `SECURITY.md`, `DATA-MODEL.md`,
`OBSERVABILITY.md`, `ARCHITECTURE.md`, `CALIBRATION_TODO.md`, `NEXT-WAVE-2026-07-29.md`,
`CONSOLIDATION-PLAN-2026-05-16.md`, all 24 `docs/adr/*` bodies, and Sections A/C/D/E (the actual
replacement prompt text, critique, and rival-rewrite comparison) of the master research brief --
only its Section B (external-world claims) was read for this digest, per the task's specific ask.

