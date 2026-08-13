# nickstire Scan Calibration Ledger

Persistent ledger for ScanFinish-protocol runs scoped to **nickstire** (admin,
Instagram, SMS, booking). The sibling ledger for bdnick/statenour is
`apps/statenour/docs/MISSION-CALIBRATION-LEDGER.md` — do not mix them; they
track different products.

**Next scan: read this file FIRST**, then diff against the trailing 7 days of
`git log`, then `plan-gate` (UPSTREAMS.md · CURRENT-TRUTH.md). The measured base
rate for pasted nickstire/IG plans is **~60-85% already built** (23 gated plans
through 2026-08-12; the IG family alone came back ~85% incumbent five times).

## Calibration rules (inherited from the bdnick ledger, plus two local)

1. `HIGH` conviction requires OBSERVED evidence — a file, a probe, a run.
2. `REPEAT HIT` only if the signal survives a later scan and no kill shot fired.
3. Downgrade any finding whose cheap test fails.
4. Track accepted / rejected / waiting separately; silence is not confirmation.
5. Gate against incumbents BEFORE ranking.
6. Re-measure any number quoted as a thesis. Stale snapshots survive in code
   comments and prior audits long after the state they describe is fixed.
7. **(nickstire-local)** A prod flag read from memory is at most INFERRED —
   `.env` and code comments are not production. Re-read Railway or `cron_log`.
8. **(nickstire-local)** Before calling a module dead or live, grep its
   IMPORTERS. "Built, tested, unwired" has been the dominant defect shape here.

## Run 1 — 2026-08-13 (HEAD `f585dffe2`)

Scope: Instagram abilities in the admin · Nick from the home screen +
check-tasks widget · SMS capability · calendar integration.
Evidence base: this checkout + a local run of `scripts/check-capability-ledger.mjs`.
**No prod probe and no web sweep were run** — every claim depending on a Railway
env var is marked INFERRED for that reason.

### Self-audit of the prior run

| Prior run | Its #1 | Status |
|---|---|---|
| 2026-08-12 nickstire admin trust-ladder (23rd gated plan, ~60% incumbent) | attributed audit ledger + `admin_proposals` approval queue | **ACTED ON** — #1541 merged (`c91238a4c`), 0110/0111 applied to prod, `vapi_action_proposals` flipped ON, follow-ups closed in #1548. One human step still owed: hand-review the first ~10 Nick-originated drafts. |
| 2026-08-11 IG comment webhook | cut comment-reply latency from cron to instant | **ACTED ON** — #1504/#1505 merged, subscription ACTIVATED, endpoint live-verified. Real comment POSTs still unobserved. |

### Findings

| ID | Finding | Window | Conviction | Evidence | Score | Outcome |
|---|---|---|---|---|---|---|
| NT-001 | Reel publish lane has no judge; the image lane's fail-closed judge and the 7-lens `criticPanel` both exist and neither covers reels (`criticPanel.ts` has 1 importer — its own test) | OPEN | HIGH | OBSERVED | 15 | NEW · proposed |
| NT-002 | `getReelGenerationSignal` trains reels on the top-8 posts by engagementRate with no `mediaProductType` filter — carousel/image winners steer reel briefs | OPEN | HIGH | OBSERVED | 14 | **REPEAT HIT ×2** (2026-07-31) · still open |
| NT-003 | Published creative burns `DM "KEYWORD"` into pixels; there is no Instagram DM path anywhere in the repo and the webhook subscribes to `comments` only | OPEN | MED | OBSERVED (code) / INFERRED (token scopes, 2d old) | 13 | NEW · proposed |
| NT-004 | SMS autonomy ladder declares a ceiling per automation; nothing reads declared-ceiling vs live rollout mode. Transfer of the statenour wiring census that found 17 severed rules on its first live run | OPEN | MED | OBSERVED (mechanism) | 12 | NEW · proposed |
| NT-005 | Nick-from-home-screen: deep-link substrate is fully built (`/admin?tab=…`, `?igview=`); manifest shortcuts are 5 customer actions and 0 admin; SW precaches 6 customer routes and 0 admin | OPEN | HIGH | OBSERVED | 11 | NEW · proposed |
| NT-006 | Contrarian trade — daily reel cadence as the growth lever, priced against 6.2% reach-to-base, 0.00 saves, 0.049% ER, and a server-side CAPI path never once observed delivering | OPEN | MED | INFERRED | 10 | NEW · forward trade, falsifiable 2027-02 |
| NT-007 | `reel-pipeline-assembly` is the only `exposure: production` capability and its `verificationExpiresAt` is **2026-08-16** — the ledger gate turns fatal in 3 days. It also still carries a REFUTED blocker ("S3 pending") | CLOSING | HIGH | OBSERVED (script run: exit 0, 4 stale non-load-bearing) | 9 | NEW · dated |
| NT-008 | "Calendar integration" is a premise mismatch — the shop is a walk-in, first-come-first-served, 7-day operation with no slot, bay or capacity model anywhere | DEAD (as slot-booking) | HIGH | OBSERVED | 8 | NEW · REFUTED-PREMISE, redirected |
| NT-009 | `detectNoShows` auto-cancels + texts on `preferredDate < CURDATE()` with no ET conversion, on a 24h tier phased by container boot | OPEN | MED | OBSERVED (code) / INFERRED (session `time_zone`) | 7 | NEW · proposed |

### Cut, noted

- Latent-only: `confirmationCalls` computes tomorrow via `toISOString()` (UTC),
  but self-gates to 15:00-17:59 ET, so the UTC day always matches today. It
  breaks the moment that window moves past 20:00 ET. Not a live defect.
- 13 of 48 capabilities sit `unit_verified @ disabled` — a large built-but-dark
  cohort worth its own census, parked behind NT-004.

## Run 1 build pass — 2026-08-13 (operator: "go on 1..9, do them all")

All nine findings executed same day, one PR. Outcome column updates:

| ID | Outcome |
|---|---|
| NT-001 | **ACTED ON** — shadow judge wired into `dailyReelPost` before the publish claim: log-only, fail-open by design (a judge error must not hold a QA-passed reel), same shadow→gate promotion path the image lane used 08-05→08-07. Input builder pure + pinned (`buildReelShadowJudgeInput`, 3 tests incl. unparseable-payload). Gate flip stays an OPERATOR decision after the disagreement readout accumulates. |
| NT-002 | **ACTED ON** — `getReelGenerationSignal` now REELS-first (`mediaProductType = 'REELS'`, floor `MIN_REEL_SIGNAL_ROWS = 4`) with a DISCLOSED all-media fallback (`signalSource`), surfaced through `contentTopicSignals` provenance. Repeat hit closed on the 2nd sighting. |
| NT-003 | **ACTED ON** as the no-DM-needed variant — `matchCampaignKeyword` (exact-token, lookarounds not `\b`, longest-first, false-positive-pinned) + `collectActiveCampaignKeywords` (reel payloads already in hand + published inventory, degrade-not-fail) + a keyword steer in `draftCommentReply` that hands off to channels that EXIST (call/text line, link in bio) and forbids DM promises. All existing gates untouched: ENABLED/LIVE flags, claim-safety detector, watermark, velocity caps. The cheap test (count keyword comments in prod) remains open — recent posts have ~0 comments. |
| NT-004 | **ACTED ON** — `smsAutonomyCensus` derives lanes from `SMS_AUTOMATION_REGISTRY` (never a hand-list), live-reads each orchestrator lane's rollout mode via the SAME `getRolloutMode` the dispatcher uses, flags ONLY `over_ceiling` as a defect ("off" may be intentional — operator's call), reports unreadable as UNKNOWN, and prints its own blind spots on the panel. Mounted read-only under the Rollout Control Center. **Standing lesson applies: the first PROD render is the real test** — fixture-green ≠ honest reading. |
| NT-005 | **ACTED ON** — 3 admin shortcuts added to the PWA manifest (Approvals / Today / IG Ops via the registry's own `?tab=` ids). iOS ignores manifest shortcuts; the iPhone equivalent is pinned icons per URL — `nickstire.org/admin?tab=approvals` works today, zero code. Deliberately NOT precaching admin routes in the SW (auth surface + the 2026-08-01 stale-shell incident says keep admin network-first). |
| NT-006 | **RECORDED as the standing trade** — reel lane held at $0 spend (already true: template_stock); next build cycles go to AEO/proprietary-data + real-footage lanes. Falsifier unchanged: reel-attributed `customer_events` vs AEO-page-attributed by **2027-02**. No code — this row IS the position; kill it with data, not vibes. |
| NT-007 | **ACTED ON** — `reel-pipeline-assembly` re-verified with the 2026-08-11 live publish (IG `18102584966600206`, first sighted vision-critic pass, `forced:false`), refuted "S3 pending" blocker REMOVED (bucket `nickstire-media-oq6yt1u22`; REEL-PIPELINE.md already flagged the sentence as plan-corrupting), dead-air blocker closed by the same live render. `lastVerifiedAt` 2026-08-11 → expires **2026-09-10**; checker exit 0; REALITY-LEDGER re-rendered from source. The 4 remaining stale entries are non-load-bearing and deliberately untouched ("re-prove when you next touch them"). |
| NT-008 | **ACTED ON as the redirect** (slot-booking premise stays REFUTED) — `ArrivalLoadStrip` on Today: first-ever client consumer of `dispatch.expectedArrivals` (the endpoint had ZERO importers — built-tested-unwired, again) + tomorrow's preferred-date bookings derived from the bundle Today already fetches. Self-suppresses when empty AND healthy; unreadable renders as unknown-not-zero (loud-failure rule). |
| NT-009 | **ACTED ON** — `detectNoShows` now compares against `getBusinessDateKey()` (server twin of the client helper, EST-conservative fallback: late beats wrong) instead of bare `CURDATE()`. DST + evening-boundary pinned by 4 tests. The read-only session-tz probe was NOT run (no prod credentials in this lane) — the fix is correct regardless of what the probe would have said. |

Run-2 self-audit obligations: check the reel shadow-judge disagreement readout
(are verdicts landing in logs?), the census's first PROD reading (fixture-green
proves shape, not reading), and whether any keyword comment has actually
arrived.

### Self-review round (same day, operator: "go back over your work")

Adversarial pass over the run-1 diff itself. Four real defects found in MY OWN
new code, all fixed before this section was written — the standing lesson
holds even when the read model is hours old:

1. **Census lied under DB-down.** `getRolloutMode` falls back to
   `legacy_passthrough` when the DB is unreachable — rendered bare, that reads
   as an operator choice. Now: `dbAvailable` pre-check, per-lane
   "ladder unenforceable" caveat, red panel banner. (Kept same-reader
   semantics on purpose: passthrough IS the dispatcher's true effective state
   in that condition — the caveat, not a different reader, is the fix.)
2. **Strip suppressed its own warning.** Zero arrivals + UNREADABLE bookings
   slice hid the strip entirely — silence exactly when it owed the
   unknown-not-zero line. Extracted `stripHasNothingToSay` (pure, 4 arms
   pinned); trustworthiness is now a render-forcing condition.
3. **Shadow judge was unbounded per job.** The assembled branch is
   deliberately not wall-clock-gated, so a held reel would re-judge on every
   cron tick — N LLM calls/day on the same quota-fragile lane as the #1507
   evening-403 arc. Now a durable per-job KV marks judged; a failed judge
   writes nothing (retries, still log-only).
4. **MODE_RANK was duplicated** in the census — two copies of one policy
   table. `rolloutModeRank()` exported from `smsAutonomy`; census consumes it.

Plus one same-class extension: `confirmationCalls` "tomorrow" was UTC —
correct only by coincidence of its 15-18 ET window; now `getBusinessDateKey`.

**Full serial suite receipt: run 1 caught a 5th defect** — the admin render
matrix (bare-mounts every section) crashed ArrivalLoadStrip on undefined
props. Fixed with honest defaults (`bookings=[]`, `bookingsTrustworthy=false`
— absent data renders as unknown, never a clean zero). Targeted runs alone
would have shipped that crash: the full suite is not optional on new admin
components.

## Run 2 — 2026-08-13 (same day, scope: reel pipeline / "Faceless Reel Studio")

Trigger: an external mega-brief ("FRONTIER-SCAN findings, two runs 2026-08-11
and 2026-08-13") asking for a reel "intelligence studio" — anti-repetition
memory, an originality/QC gate, multi-vendor routing, a local-topic library,
an attention-microstructure logger, multilingual dubs. Gated per `plan-gate`
before any code: read this ledger first (per the header rule), diffed
against `git log`, checked `docs/UPSTREAMS.md`, then dispatched 4 read-only
Explore agents plus a real serial test run (`vitest run` on the 10 reel/
Higgsfield test files: **10 files, 124 tests, 0 failures**).

### Premise check

| Brief claim | Verdict | Evidence |
|---|---|---|
| Branches `feature/nickstire-faceless-reel-intelligence-studio` and `nickstire/higgsfield-live-run` exist | **REFUTED** | `git branch -a` (local+remote) and `git log --all --grep -i "faceless\|higgsfield"` — neither name appears anywhere, ever |
| A "Faceless Reel Studio memory layer" exists | **REFUTED (partial-true premise)** | `facelessReelStudioPrompt.ts` / `facelessReelStudio.ts` are real, live files (the reel gen prompt library) — the NAME is real — but no anti-repetition memory layer exists under it or anywhere else |
| "FRONTIER-SCAN" is this repo's scan protocol | **REFUTED** | 0 hits repo-wide; the actual protocol is `ScanFinish` (this file). Brief is a garbled pointer to real work, not a description of it |
| Sora API sunset (Sept 2026) threatens the pipeline | **MOOT** | Sora is not referenced anywhere in `apps/nickstire` — not a dependency today |

### Findings

| ID | Finding | Conviction | Evidence | Outcome |
|---|---|---|---|---|
| NT-010 | No anti-repetition mechanism for reel topics/hooks. `avoidTopics` (`reelBriefGen.ts:43`) is a pass-through never populated from history; the live cron path `contentManufacturing.ts:1001` doesn't even pass it | HIGH | OBSERVED | ACTED ON (this run) |
| NT-011 | QC/originality gate is real but partial and 100% non-gating: shadow judge is concept-level (not rendered-video), `reviewReplyQa` covers captions but not VO script, no footage-provenance/before-after/exact-length checks exist | MED | OBSERVED | ACTED ON (this run, additive shadow checks only — gate-flip stays an operator decision per NT-001 precedent) |
| NT-012 | No per-reel outcome logger distinct from the topic-selection signal; `instagramAnalytics` captures saves/shares/views but nothing logs hook/beat-structure/CTA per reel for a swipe-file/decay-curve read | MED | OBSERVED | ACTED ON (this run) |
| NT-013 | Vendor fallback is real (Higgsfield/Veo/template_stock, `reelPipeline.ts:102-193`) but one-way: paid→free only, never paid-to-paid. Kling/LTX-2/TikTok Symphony/Sora: zero references anywhere in this repo | MED | OBSERVED | ACTED ON (narrow: ordered paid-to-paid fallback only — no speculative vendor adapters; new-vendor integration is WATCH, not built, pending an actual outage or operator ask) |
| NT-014 | No Local Discovery content library. Topic mining is signal-driven (`contentTopicMiner.ts`, 7 sources) with NHTSA/E-Check explicitly `fetch_blocked` by design | MED | OBSERVED | ACTED ON (this run, curated seed list wired as an 8th topic source — NHTSA/E-Check auto-fetch stays blocked, untouched) |
| NT-014 | **ACTED ON** — new `shared/localDiscoveryLibrary.ts`, 14 curated topic PROMPTS across the brief's 3 categories (tire_symptom, e_check, weather_road). Ohio E-Check facts verified via web search before writing (not assumed): Euclid sits in Cuyahoga County, one of Ohio's 7 E-Check counties (Cuyahoga/Geauga/Lake/Lorain/Medina/Portage/Summit), source Ohio EPA + ohioecheck.info — a real, applicable local topic, not a guess; noted a 2026 legislative repeal effort in flight so topic phrasing stays general rather than asserting a permanent schedule. Wired as a genuinely new `local_discovery` TopicSource into `contentTopicMiner.ts` (weighted below `coverage_gap` — a curated fallback, not a read of the business) and into the live `gatherTopicSignals()` → `dailyReelPost.ts` path, so this is reachable by the autonomous daily cron, not a standalone list. **Side-finding, fixed as a natural byproduct**: `government_feed` was declared in `SOURCE_WEIGHT`/`franchiseForSource` since this file's creation but NO signal field ever fed it — a real "built, never wired" defect (this repo's own dominant defect shape per the ledger header). E-Check topics route through it correctly, preserving the existing government-evidence gate (`echeck_escape_room` requires `government_source`, so E-Check topics are surfaced but marked NOT auto-renderable — an operator must still attach the Ohio EPA record). Metadata tagging for saves/shares/booking-intent measurement: NT-012's swipe-file store already measures saves/shares per reel; `source: "local_discovery"` on the resulting `TopicCandidate` is the durable tag a future analysis groups by — no new schema needed. 7 new tests (`local-discovery-library.test.ts`); the 19 pre-existing `topic-miner-experiments.test.ts` tests stayed green unmodified. `pnpm run check`: 0 errors. |
| NT-015 | No multilingual variant hook. An unused "top performer" signal (`recentWinners`, `instagramAdmin.ts:620-637`) already exists as a ready trigger | MED | OBSERVED | see below |
| NT-016 | This ledger's OPEN/CLOSING/ACTED-ON status is hand-typed, not script-derived — unlike the separate `capability-ledger.json` + `check-capability-ledger.mjs`, which IS script-validated | LOW | OBSERVED | Judged not worth building a parallel automation; the existing discipline (every Outcome cites a real receipt) already satisfies the spirit. NT-012's outcome logger closes the loop specifically for reel findings going forward |

### Run 2 build pass

| ID | Outcome |
|---|---|
| NT-010 | **ACTED ON** — `buildRepetitionChecks` (`facelessReelStudio.ts:1037`) was pure and tested but had zero server callers. New `getRecentReelSignals()` (`services/reelRepetitionHistory.ts`) reads the last 21 days of `reel_jobs` and reduces each payload to topic/keyword/archetype/motionLens/objectCharacter; DB-down or an unparsable row degrades to "no memory" rather than throwing or blanking the window. Wired into `prepareCleanReelBrief` (the autonomous daily-post lane, via `dailyReelPost.ts`) with real enforcement: a repeated topic is treated exactly like an M10 preflight block — reject and regenerate, same proven retry machinery, `PreflightExhaustedError` message widened accordingly. `contentManufacturing.ts:1001` (the human-reviewed draft lane) gets the softer fix — real `avoidTopics` populated, no regenerate-loop added since that path has none for preflight either and a human reviews before publish. 12 new tests (`reelRepetitionHistory.test.ts`, 4; `reelDraftPrep.test.ts`, 4 new + 4 existing updated) prove: real history flows into `avoidTopics`, operator-supplied `avoidTopics` wins over history, a topic repeat forces regeneration even when preflight passes, and DB-down never blocks. `pnpm run check`: 0 errors. Full reel+Higgsfield suite: 15 files, 206 tests, 0 failures. |
| NT-012 | **ACTED ON — mostly ALREADY BUILT, genuinely new part shipped.** Investigation found the "outcome logger" premise substantially wrong: `ig_metric_snapshots` (append-only, `capturedAt`-stamped, migration 0106) + `shared/contentExperiments.ts` (confound detection, `MIN_SAMPLES_PER_ARM`, 24/72/168h decay-curve horizons, cold-start zero-signal refusal) + `shared/hookSignals.ts`/`scripts/analyze-hook-vs-skip.mjs` (beat-1 hook signals vs skip rate, "measure don't judge", `MIN_GROUP_N=4`) is a mature, tested, ALREADY-SHIPPED experiment-tracking system carrying almost exactly the philosophy the brief asked for verbatim (unproven until real data accumulates; a correlation is a candidate to test, not a rule). Genuinely missing and now built: (1) `shared/beatStructureSignals.ts` — beat count/total duration/CTA type, the "beat structure + CTA" half nothing extracted before; (2) `shared/attentionMicrostructure.ts` — generalizes `compareSignals` from skip-rate-only to any metric (proven against `savesPerReach`/`sharesPerReach`, both real `ig_metric_snapshots` columns the existing script never read) and any signal family (hook OR beat-structure); (3) `server/services/attentionMicrostructureStore.ts` — the DB join made a real, tested, callable function instead of a script the operator has to remember exists; (4) `instagramAdmin.getSwipeFileCorrelations` — wired into the admin router (tRPC), closing the "standalone script nobody calls" complaint. `calls`/`booking_actions` are registered metric NAMES in `contentExperiments.ts` with **zero data source** — `ig_metric_snapshots` has no column for either and Instagram's organic Graph API does not attribute a call to a specific post. **REFUTED-PREMISE, WATCH**: needs new paid call-tracking-number infrastructure + an operator funding decision, not a code fix — did not fabricate a column. 23 new tests (`beat-structure-signals.test.ts` 5, `attention-microstructure.test.ts` 6, `attentionMicrostructureStore.test.ts` 6, plus the pre-existing `hook-signals.test.ts` 38 stayed green unmodified). `pnpm run check`: 0 errors. 143-test targeted run: 0 failures. |
| NT-011 | **ACTED ON, shadow/log-only** — new `shared/originalityQcChecklist.ts` gives ONE canonical readout of the brief's 9-item list; most checks reuse existing, previously-scattered mechanisms (`episodeClaims` entailment, `reviewReplyQa` caption claim-safety, the `visibly_animated` disclosure contract, `beatStructureSignals.ts`'s duration from NT-012) rather than duplicating them. One genuinely NEW check: `reviewReplyQa` now also runs against the **voiceover script** (`episodeContract.script.voiceover`) — previously only the caption was checked, so an unsafe VO claim could ship unnoticed. Two criteria are honestly reported "structural" not "pass" (no copied footage / no copyrighted audio — no per-job signal exists, only a pipeline-shape guarantee), and one is honestly "unknown" not a faked pass (no misleading before/after — no check built). Wired into `dailyReelPost.ts` as a second shadow block, same once-per-job KV-marker discipline as NT-001's judge — log everything, gate nothing, same operator-owned promotion path. 11 new tests (`originality-qc-checklist.test.ts`). `pnpm run check`: 0 errors. 219-test targeted run: 0 failures. |
| NT-013 | **ACTED ON (narrow, as gated)** — no Kling/LTX-2/Symphony/Sora adapters built; zero evidence they're needed (repo-wide grep: none referenced anywhere). Real gap fixed instead: Veo had **no fallback of any kind** — a Veo `PAUSE_PROVIDER`/`RECONCILE_BEFORE_RETRY` verdict (`nextStatusFor`) goes terminal on the verdict alone, and only Higgsfield's INLINE per-beat degrade (`shouldDegradeToFreeLane`) ever reached the free lane. Added a job-level escape hatch in `processNextReelJob`'s outer catch (`reelPipeline.ts`): when `nextStatusFor` says a job is genuinely terminal AND `REEL_FALLBACK_TO_TEMPLATE_STOCK=true` AND the failing provider wasn't already `template_stock` (nowhere lower to fall), the job gets ONE more attempt forced onto the free local lane via a new `ReelJobBrief.forceProvider` field (persisted in the job payload, same pattern as `veoOperationName`'s existing resume state) instead of terminal-failing — same opt-in flag, same Telegram same-day alert convention as the existing inline degrade, ledger `fail()` correctly skipped since the job isn't actually done. Did NOT touch the inline Higgsfield per-beat mechanics (Veo resume-vs-resubmit invariant is too load-bearing to risk) — this is a genuinely separate, additive path. 4 new tests (`reelProviderFallbackChain.test.ts`): forces the free lane on a PAUSE_PROVIDER verdict, stays terminal when the flag is off, does not loop when template_stock itself exhausts, and a normal retryable error is untouched. Full existing reel suite (232 tests incl. the 23 source-text-anchored `reelFreeLaneFallback.test.ts` assertions on the untouched inline branch) stayed green throughout. Kling/LTX-2/Symphony/Sora: **WATCH, not built** — revisit only if a real multi-week paid-vendor outage or an explicit operator ask makes cross-vendor (not just paid→free) routing worth the cost/quality tradeoff of switching generators mid-flight. |

Run-2 build pass and self-review continue below as each item lands, same
convention as Run 1.
