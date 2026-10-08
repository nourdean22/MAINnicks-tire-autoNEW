# Nick's Creative Intelligence OS — blueprint, ground truth and execution queue

**Date:** 2026-10-01 · **Branch:** `claude/epic-pascal-i34a9l` · **Status of this doc:** rank-7 planning
artifact (dated, supersedable). The code shipped with it is rank 2. Re-verify any "LIVE" claim
against Railway before acting on it after 2026-10-15.

Companions: [`RESEARCH-EVIDENCE-BOOK.md`](./RESEARCH-EVIDENCE-BOOK.md) (platform, studies, models,
creators — sourced and dated) · [`PROMPT-PACK.md`](./PROMPT-PACK.md) (16 production prompt contracts) ·
[`EXAMPLE-OUTPUTS.md`](./EXAMPLE-OUTPUTS.md) (what the upgraded system produces).

---

## A. Executive diagnosis — what stops "10/10" today, by expected impact

The brain is ahead of the pixels. Concept Tournament, Creative Genome, Pattern Lab, rendered QA,
the independent judge, originality checks, content-run lineage and metric snapshots all exist and
most are wired. What is NOT there is the connective tissue between them and the thing a human
actually sees. Ranked:

| # | Blocker | Evidence (verified 2026-10-01) | Status after this PR |
|---|---|---|---|
| 1 | **An unscored AI image could publish live.** `evalImage` skipped without `REPLICATE_API_KEY`; `combineScores` set `imagePass = true` on skip ("dryrun review is the gate") on the LIVE lane. | Railway: `12:17:20 image-eval skipped` → `12:17:51 Instagram image published: 18101960009368023`; same on 09-26, 09-27, 09-28, 09-29, 09-30. `igAutopost.ts:1445` (pre-fix). | **FIXED** — `igVisualQaGate` (UNKNOWN holds live, poster exempt, kill switch `IG_VISUAL_QA_GATE=false`); critic now falls to Gemini vision when Replicate is unkeyed. |
| 2 | **Three dead image-provider hops on every static post.** Higgsfield `not_enough_credits` → OpenRouter `402` → HF FLUX `410 Gone` → Gemini. No memory between posts. | Railway, 11 identical sequences 09-29 → 10-01. `igAutopost.ts:1107-1220` (pre-fix). | **FIXED** — `imageProviderCircuit` (credits 6 h, retired 24 h, transient 0); HF FLUX route deleted. |
| 3 | **Paid-ad copy carried a warranty the shop does not honor.** "12-month / 12,000-mile" in the ads package prompt, preset and fallback; SSOT retired it 2026-07-21 (parts 1-yr / labor 90-day, no mileage). Package cannot import the SSOT; admin form sent the right value and the system prompt contradicted it. | `packages/meta-ads-architect/src/generator/prompts.ts:12`, `presets/nicks-tire.ts:22`, `generator/index.ts:320`; `shared/business.ts:128-146`. Plus "Spanish", "Yelp", "tows", "5-star rated", "Top Rated". | **FIXED** — `brandTruth.ts` compiler; router overrides fact fields server-side; package renders facts only from input; drift canary over 10 creative sources (positive control: 3 hits on main). |
| 4 | **Articles were told to invent numbers and to hit a word count.** "at least one number anchor (cost range, time, miles)", "4-6 sections… 80-200 words", "service routes like /brake-repair-cleveland" (a 301); hours typed by hand. The weekly cron generated an article and **never saved it** while telling Telegram "Review in Drafts". | `content-generator.ts:150,207,208`; `crudAutomation.ts:494-518`. | **FIXED** — no word count, numbers only from SSOT/named source, topic words → `resolveRelatedServiceRoutes` against `ALL_ROUTES` + `isRedirectedPath`, facts from `renderBrandTruthBlock`, cron persists the draft. |
| 5 | **Film-language sameness.** 32/32 approved packs = 20 s, 5 beats; ~10 visual descriptions, 7 motion descriptions, 3 audio cues, 2 loop shapes across 160 beats. Repetition ledger tracks topic/keyword/archetype/motionLens/object — **not hook, structure, CTA, or frame look**. Music = 5 local loops, **no SFX**. | Sep-27 pack audit; `reelRepetitionHistory.ts:19-22`; `reelDraftPrep.ts:71-74`; `reelAssembly.ts:795`. | **SHIPPED (Wave B)** — repetition ledger +hookGrammar/structurePatternId/ctaFamily/durationBuckets; `duration_v1` wired end-to-end; grammar fingerprints in `shared/visualLanguage.ts`. Still open: the distinctiveness *penalty* for the three new dims (insertion point `facelessReelStudio.ts distinctPart()`), and Foley/SFX. |
| 6 | **Real-shop media is a capability, not a supply.** Only Studio V2 Create reads the `real_shop` pool; uploads record filename + source only; Reels, territory carousels, Ad Studio, autopost and contentManufacturing never query it; nothing asks "do we own a real asset stronger than synthetic?". | `routers/instagramStudio.ts:293-335`; `instagramAdminStrategy.ts:523`; audit §4. | **SHIPPED (Wave B)** — upload records width/height + fire-and-forget vision enrichment into `generation_params_json.enrichment`; `realAssetFirst.findRealAssetFor` consulted by igAutopost (kind `real`, gate-exempt with the asset named), reelDraftPrep (`payload.realAsset`), carouselDirector; `getCaptureOpportunities` on Today. Supply itself is still an operator action. |
| 7 | **Autonomous posts use one poster template.** `igAutopost` default provider `adrender` → the Ad Studio "garage poster"; neither the 3 static families nor the 13 carousel territories nor any real photo reaches an autonomous post. 6 renderers, 3 colour vocabularies, 1 dead (`carouselStudio/carouselRender.ts`). | `igAutopost.ts:1078-1096`; `contentManufacturing.ts:1063`; audit §2. | **PARTIAL (Wave B)** — `shared/visualLanguage.ts` (16 grammars, pairwise-distinct, NOIR tokens) with every family/territory mapped and renders pinned byte-identical by `visualLanguageParity.test.ts`; dead `carouselStudio/carouselRender.ts` deleted. Not yet: moving family/territory CSS onto the tokens, or autonomous lanes choosing a grammar (poster stays default). |
| 8 | **Customer language is never mined.** `TopicSignals.customerQuestions` has a slot and no producer; call turns, SMS bodies, lead notes feed nothing creative. GSC only seeds one LLM prompt (`explodeTopic`). | `contentTopicMiner.ts:51,300`; `contentManufacturing.ts:131-165`. | **SHIPPED (Wave C)** — `customerLanguageMiner` (calls, SMS, reviews, lead notes; PII scrubbed before extraction, phrases from a fixed bank only) fills `customerQuestions` + counts; `getRisingQueries` fills `gscRising`; both boost the miner (capped below declined-work); `shared/topicGraph.ts` 78 nodes / 161 edges. |
| 9 | **Facebook is a cross-post.** Same JPEG + caption; video never passed to FB (a "both" reel likely becomes a text-only FB post). Zero FB insights pulled. | `igAutopost.ts:1835-1841`; `socialPublish.ts:248-254`; `metaSocial.ts:457-471`. | **SHIPPED (Wave C, LIVE+UNPROVEN)** — reels now reach the Page as video (Reels Publishing 3-step, behind `REEL_PUBLISH_ENABLED` + claim check), with an FB-native caption (`facebookVariant`); FB post insights pulled into `ig_metric_snapshots` under the `fb:` prefix (IG readers filter it). igAutopost's static cross-post is unchanged. **Armed 2026-10-01 on operator instruction:** the nightly reel cron (`dailyReelPost.ts`) now sends `["instagram", "facebook"]` when `REEL_FB_CROSSPOST_ENABLED=true` (set in Railway production); Instagram stays the authority, an FB failure only logs, and FB-live-but-IG-refused parks the job as `publish_ambiguous` instead of retrying. |
| 10 | **Learning never sees quality evidence.** `renderedQa` findings and the observed bible are never joined to `ig_metric_snapshots`; judge is shadow on reels; craft codes are warn-only; attribution is UTM-on-Studio-captions only. | audit §1 gap 5; `dailyReelPost.ts:1077-1092`. | **PARTIAL (Wave B/C)** — craft score + `escalate` + `visionCalls` persisted on every rendered verdict (`payload.renderedQa`); Pattern Lab `scoreForObjective` (blended default byte-identical); experiment arm-key mismatch fixed (recorded arm now == generated arm). Not yet: the QA-findings × snapshots join in the learner. |
| 11 | **`shared/internalLinks.ts` is dead code**; two disagreeing service graphs; "rotation" sorts by first letter; DB articles never get inbound related links; no GSC in links. | audit §2 (zero importers). | **SHIPPED (Wave C)** — `internalLinks.ts` wired (RelatedServices reads it; BlogPost chips validated + related posts ranked by `linkGraph`); `linkRecommender` + `seoTools.linkRecommendations` (admin, read-only, GSC/cannibalization aware, rendered-HTML check advisory). Found: `/general-repair` is a 301 that 57 articles and three components linked — canonicalised. |
| 12 | **Specialist critic panel is dormant** (7 lenses, 0 callers) and no $0 pixel checks run before the vision call. | `criticPanel.ts:16-33`; `renderedQa.ts:146`. | **SHIPPED (Wave B)** — `renderedPixelStats` ($0: sharpness, dup, black, caption-box) feeds the critic; one specialist lens escalates behind `RENDERED_QA_SPECIALIST=true` (default off; ≤2 vision calls/reel, counted). |

## A2. What this branch shipped beyond Wave A (2026-10-01, same PR, batched)

Verified on the combined tree: `pnpm run check` 0 errors · lint/lint:source/brand-voice/pii/curdate/validate:routes exit 0 · knip orphan gate 0 NEW · prerender:check + semantic OK · targeted vitest 38 files / 350 tests + 21 (review fixes) green; CI full suite on the merged head 10,768 passed. **Merged 2026-10-01 as PR #2865 → `54a36662`**; Railway deployment `015c1e73` (status at doc time: **SUCCESS** at 17:48:57Z — container logged `[server:ready]` 17:48:52Z, `Schema guard: all critical tables present` (6 checked), `Tiered scheduler started: 5 tiers, 126 jobs`; `/api/health` at 17:50:31Z reported `status: healthy`, `deploy.commit 54a366629ba89867dcd5dbc916e37bee88f8e645`, `deploymentId 015c1e73…`, database up (6 ms), AI gateway up, self-healing score 100). Everything below is BUILT+WIRED and, once that deployment is SUCCESS, LIVE+UNPROVEN until the §V receipts appear.

| Slice | Entry point | State |
|---|---|---|
| Customer-language miner → topic signals → miner weights | `customerLanguageMiner.ts`, `contentTopicSignals.ts`, `shared/contentTopicMiner.ts` | wired into the daily reel topic choice and the Creative Assistant |
| GSC rising queries | `gsc-data.getRisingQueries` (Eastern-cut windows, throws on no-db) | wired |
| Topic graph | `shared/topicGraph.ts` | consumed by the miner, realAssetFirst, trend intel |
| Real-asset-first + enrichment + capture card | `realAssetFirst.ts`, `mediaEnrichment.ts`, `instagramAdmin.getCaptureOpportunities` | wired; enrichment needs `GEMINI_API_KEY` (prod has it) |
| Creative Assistant (up to 6 cards, "why" lines) | `creativeAssistant.ts`, Today tab | wired, deterministic, no LLM; `quality` card and real-evidence share since 2026-10-08 |
| Experiments: 6 presets | `shared/contentExperiments.buildExperimentPreset` | `hook_style_v1`, `duration_v1` **wired**; `opening_asset_v1`, `carousel_cover_v1`, `audio_v1`, `fb_format_v1` **exposed only** — defined, but refused at start, not judged and not assigned until a generator reads the arm (2026-10-08) |
| Repetition ledger +4 dims · Pattern Lab objective scores | `reelRepetitionHistory.ts`, `shared/reelStructureLearning.ts` | wired; production ranking unchanged until an objective is passed |
| $0 pixel checks + craft score + adaptive specialist | `renderedPixelStats.ts`, `renderedQa.ts`, `criticPanel.ts` | wired; specialist behind `RENDERED_QA_SPECIALIST` |
| Visual language (16 grammars) | `shared/visualLanguage.ts` | mapping only; renders byte-identical (parity test) |
| Link graph + recommender + curated wiring | `shared/linkGraph.ts`, `linkRecommender.ts`, `seoTools.linkRecommendations` | public pages wired; recommender admin-only |
| Facebook branch (video reels, caption variant, insights) | `metaSocial.ts`, `socialPublish.ts`, `instagram-data.ts`, `dailyReelPost.ts` | LIVE+UNPROVEN — Graph shapes from docs read 2026-10-01; cron cross-post ARMED (`REEL_FB_CROSSPOST_ENABLED=true` in prod, operator instruction) |
| Organic→paid evidence · atomizer · pattern miner · trend intel | `creativeOs` router | wired (generation only) |

**Defects found and fixed along the way:** `analyzePhoto` fails closed on the SMS-MMS flag `photo_assess_enabled` (default OFF) even for internal callers with an explicit provider — the old igAutopost comment said the opposite; left alone, Wave A's gate would have HELD every autonomous static post in a prod where that flag is off (internal callers now bypass the MMS flag) · experiment arm recorded under `reel_job_<id>` but generated under the brief id (≈half of episodes mis-recorded) · an all-ambiguous publish was written as `failed` and would be retried (now parked `published_partial`) · `/general-repair` 301 linked from `InternalLinks.tsx`, `RelatedServices`, 57 article chips · `fb:` snapshot rows could enter two IG aggregates (filtered).

**Known limits stated by the agents (not hidden):** the 30–40 / 45–60 duration lanes collapse to 30–35 under `REEL_OUTPUT_RULES` (maxSeconds 35, render cap 6 beats × 4 s = 24 s) — the lane is logged as `capped`; raising the ceiling is a deliberate format-contract change in `facelessReelStudio.ts` + `reelAssembly.ts`. 3-s skip / watch-duration are not gatherable by the experiment resolver yet (`skipRate` is read as null). `routes.ts:1459`'s "12 indexed / 59 noindex" neighbourhood comment is stale (all 102 are indexed). The `vapi_call_logs.metadata.customerSpeech.turns` JSON shape and `getRisingQueries` SQL have not run against TiDB.

## B. Current-state reality map (verified against code + Railway, 2026-10-01)

Prod head `10edbbbd…` (#2857); repo head `664c6ffc…` is StateNour-only, Nick's build correctly
SKIPPED. IG publishing is LIVE: Reels at ~04:10 UTC daily, images at 12:17 / 17:15 / 00:11 UTC.

| Capability | Status | Where | Note |
|---|---|---|---|
| Concept Tournament (4 directors, anonymised judge, 100-pt rubric, 5 hard rejects) | BUILT + WIRED (admin lane) · judge LIVE gate on image lane · SHADOW on reel lane | `conceptTournament.ts`; `igAutopost.ts:1653`; `dailyReelPost.ts:1077` | judge is text-only, never sees frames |
| Creative Genome / creativeMemory fingerprints (territory, moment, metaphor, action) | WIRED, admin lane only | `creativeMemory.ts`, `genomeGen.ts` | not consulted by the daily reel cron |
| Pattern Lab (`social_reel_patterns`, rotation → prior after maturity; 3-post / 2-pattern / 12-post floors; 1-in-4 exploration) | LIVE | `reelStructurePrior.ts`, `shared/reelStructureLearning.ts` | no UI; `PatternLab.tsx` is hand-captured structures |
| hookPerformance (skip-rate scoreboard into the brief after 6 samples) | LIVE (prompt steer) | `hookPerformance.ts` → `reelBriefGen.ts:1008` | — |
| Rendered QA (18 codes; Gemini vision, 1 call + 1 observed-bible call) | LIVE (`RENDERED_QA_ENABLED=true` per docs) | `renderedQa.ts`, `visualBibleObserved.ts` | PLASTIC_AI_LOOK / GENERIC_STOCK / IMPOSSIBLE_PHYSICALITY are warn-only; craft repairs declined by `clampVerdict` |
| criticPanel (7 lenses) | DESIGNED / DORMANT | `criticPanel.ts` | 0 production callers (its own header says so) |
| repairRouter / selectiveRepair / postQaOrchestrator | WIRED, policy-gated | `dailyReelPost.ts:1020-1037` | — |
| Reel originality (Jaccard on on-screen text + caption, block ≥0.5) · repetition ledger (5 dims, 21 d) | LIVE, fails open | `reelOriginality.ts`, `reelRepetitionHistory.ts` | no hook / structure / CTA / pHash |
| Trial Reels | WIRED, manual (`graduationStrategy: MANUAL`, metrics hand-entered) | `instagramAdmin.ts:1653,1971`; `ReelQueue.tsx` | not used by the cron |
| content_runs lineage | LIVE | `contentRun.ts`, `schema.ts:4585` | no genome / pattern / hook / lead FKs |
| ig_metric_snapshots (reach, saved, views, shares, avg_watch_time_ms, skip_rate) | LIVE, 8 h cadence, posts ≤14 d | `pipelines/instagram-data.ts:171-222`; `metaSocial.ts:1104` | no profile visits / follows / reposts; **zero Facebook insights** |
| Experiments (`content_experiments`, hook arm drives generation, resolve cron) | LIVE, one preset (`hook_style_v1`), no UI | `contentExperimentStore.ts`; `dailyReelPost.ts:773` | — |
| Static visual families | 3 (`mechanic_evidence`, `seasonal_offer`, `road_hazard`) | `visualFamily.ts:73-125` | reached only by Studio V2 render |
| Carousel territories | 13 | `igCarouselStudio.ts:105-177` ↔ `carouselSlideRenderer.ts:56-117` | manual Draft Board only; `carouselStudio/carouselRender.ts` DEAD; `generateCarouselBrief` proc has no client caller |
| Ad Studio poster (5 roles × 3 angles) | LIVE — the **only** autonomous visual | `adStudio/adRender.ts:91` | — |
| Brand bible ("Cleveland Mechanical Noir") | used by reels only | `shared/brandBible.ts` | no static/carousel renderer reads it |
| Real-shop media (`media_assets.rights_status = real_shop`) | LIVE capability, thin supply, no metadata | `routers/instagramStudio.ts:293-335` | capture loops exist only for GBP |
| Reel provider | Higgsfield CLI `seedance1_5` 9:16 4 s 1080p (docs say prod pins `higgsfield`); Veo alternate; DoP API lane unfunded; image conditioning OFF by default | `reelPipeline.ts:104-137`; `higgsfieldStudio.ts:499-511` | — |
| Static image provider | Higgsfield ❌ credits → OpenRouter ❌ 402 → ~~HF FLUX ❌ 410~~ → **Gemini 3.1 Flash Image ✅** | `igAutopost.ts` | now circuit-broken |
| Article engine | LIVE draft-only; weekly cron **was not saving** | `content-generator.ts`; `crudAutomation.ts:494` | fixed this PR |
| Internal links | `shared/internalLinks.ts` DEAD (0 importers); `RelatedServices.tsx` DEFAULT_RELATED is the live graph; `InternalLinks.tsx` fixed list | audit §2 | — |
| GSC pipeline (`search_performance`, CTR/cannibalization/seasonal detectors) | LIVE | `pipelines/gsc-data.ts` | consumed by admin audit + 1 LLM seed only |
| Meta Ads Architect | LIVE at `/admin/ad-studio` | `routers/metaAdsArchitect.ts` | facts now compiled server-side |
| FB publishing | cross-post of IG asset; video never passed | `socialPublish.ts:248-254` | — |
| Customer-language mining | MISSING (slot exists, no producer) | `contentTopicMiner.ts:51` | — |

## C–E. Research, creator matrix, Creative DNA taxonomy

See [`RESEARCH-EVIDENCE-BOOK.md`](./RESEARCH-EVIDENCE-BOOK.md) §A–§E. The taxonomy below is the
abstraction layer that research feeds; it is what Pattern Lab 2.0 stores. **Primitives, never
posts.** A record is `pattern_id`, not `copy_creator_post_127`.

| Primitive | Values (initial vocabulary) |
|---|---|
| `hook_grammar` | symptom_question · myth_confront · forensic_object · customer_quote · cost_math · stop_doing · false_choice · nobody_tells_you · local_moment · silent_visual |
| `knowledge_gap` | symptom≠cause · part_invisible · two_lookalikes · cost_hidden · timing_hidden · safety_misjudged |
| `story_shape` | clue→cause→consequence→action · belief→contradiction→truth · evidence→investigation→root · outside→inside→mechanism · wrong→right_side_by_side · 3_clue_countdown · failure_chain · test→result→meaning |
| `visual_family` (static/carousel) | forensic_macro · mechanic_annotation · split_diagnosis · decision_tree · blueprint · cutaway · evidence_board · checklist · myth_reality · cleveland_alert · receipt_proof · question_card · industrial_editorial · clean_catalog · before_after · shop_documentary |
| `motion_family` (reel) | progressive_push_in · locked_macro · orbit_reveal · match_cut · freeze_punch_in · pov_mechanic · pov_object · handheld_phone · split_wipe · silent_hold |
| `evidence_type` | real_shop_photo · real_shop_video · alignment_printout · scan_readout · nhtsa_stat · ssot_fact · customer_phrase · measured_test |
| `asset_origin` | real · ai · hybrid · deterministic |
| `narration_style` | calm_explainer · counter_voice · text_only · customer_reenactment |
| `cta_family` | send_to_someone · save_for_later · ask_in_comments · walk_in · call · none |
| `emotional_turn` | anxiety→understanding · curiosity→payoff · suspicion→trust · relief |
| `local_lens` | salt · pothole · freeze_thaw · e_check · lake_effect · euclid_ave · none |
| `audio_style` | vo+bed · vo+foley · foley_only · silent · music_only |
| `duration_lane` | 18-24 · 30-40 · 45-60 |

**Transformation rule (hard gate, `originalityGate` in Wave B):** a concept must combine ≥1
external structural insight + ≥1 different execution insight + ≥1 Nick's first-party signal
(customer phrase, repair-mix fact, GSC query, real asset) + ≥1 Cleveland truth, and must fail the
*anti-generic test* ("could Midas post this unchanged?") — operationalised as: no real asset, no
customer phrase, no local lens, no SSOT fact ⇒ reject. External similarity: Jaccard on hook text
vs the mined pattern's `source_examples` ≥0.5 ⇒ reject (reuses `shared/reelOriginality.ts`).

## F. First-party data advantage map

| Signal | Where it lives today | Reaches content? | Wave |
|---|---|---|---|
| Customer call turns (symptom language) | `vapi_call_logs.metadata` via `customerTurns.ts` | No | C — `customerLanguageMiner` → `TopicSignals.customerQuestions` |
| SMS bodies / lead notes | `communication_log`, `leads` | DM-keyword attribution only | C |
| Reviews text | `customer_testimonials` → 120-char "themes" | Partly | C — full phrase extraction |
| Declined work | `alg_estimates` mirror (matcher ran once, 2026-05-07) | Yes (highest miner weight) | — (refresh matcher is an ops task) |
| Repair / invoice mix | `invoices`, `customerIntelligence.ts` | No | C — service-demand weight in opportunity score |
| GSC queries/pages | `search_performance` | 1 LLM seed | C — miner + planner + links |
| Weather / NWS | `weatherIntelligence.ts` | Yes (GBP draft, shadow planner) | — |
| NHTSA stats | blocked from the miner by design | No | keep blocked for *topics*; allow as *proof* in articles (§O) |
| Real shop photos/video | `media_assets` (real_shop) | Studio V2 picker only | B |
| IG metrics (reach, saves, shares, watch, skip) | `ig_metric_snapshots` | Pattern Lab, hook scoreboard | C — join with QA findings |
| Trial Reel results | hand-entered JSON | No | C |
| Facebook metrics | **nowhere** | No | C — `/insights` pull |

## G. Format strategy (objective-led, platform-branched)

One **Creative Thesis** (mechanic truth + customer tension + evidence) branches into format-native
outputs; nothing is cropped-and-reposted (Meta A1/A2).

| Format | Objective | Primary metric | Nick's lane |
|---|---|---|---|
| IG Reel 18–24 s | discovery, sends | 3-s survival, watch/duration, sends/reach | AI cinematic or real-shop UGC |
| IG Reel 30–60 s (experiment) | explanation, sends, follows | same + follows | forensic / cutaway |
| IG Carousel | saves, teaching | saves, shares, profile actions | deterministic territories, real cover |
| IG Static | proof, one striking fact | reach, saves | real evidence first; poster only when no evidence |
| IG Story | freshness, interaction | replies, taps, poll votes | phone-native, today-at-shop |
| FB Album | local visual story | shares, comments | 4–6 real photos + explanation |
| FB Status (no link) | conversation | comments, comment depth | local question |
| FB Reel | engagement (Q2-26 lead) | watch, shares | same reel, FB caption variant, **video actually passed** |
| Article | search authority | impressions, clicks, position | evidence-pack driven, draft-only |
| Meta Ad | conversion | calls, directions, leads/CPL | organic-validated tension → DR derivative; facts from BrandTruth |

## H. Quality rubrics — four separate scores, never averaged

**H1 Reel pre-production (100 pts; judge sees text only)** — thumb-stop/opening 14 · mechanic truth 13 ·
usefulness 11 · visual idea 10 · share motivation 10 · Nick ownership 9 · originality 9 · local
relevance 7 · story progression 6 · production feasibility 5 · emotional/curiosity payoff 4 · CTA fit 2.
Hard gates (any ⇒ reject): unsupported claim · unsafe diagnosis · fabricated stat · price/guarantee ·
similarity ≥0.5 · infeasible in stack · AI-lettering dependency · fails anti-generic test.
*Implementation:* extend `conceptTournament.ts` rubric constants (currently 8 dims) — same judge,
new weights, feasibility stays.

**H2 Rendered Reel craft (100 pts; vision sees pixels)** — opening composition 12 · mechanical accuracy 12 ·
subject realism 10 · physical plausibility 8 · continuity 8 · cinematography 8 · pacing 8 · motion 7 ·
typography/caption 7 · audio/sound design 7 · brand recognizability 5 · non-genericness 4 · no AI artifacts 4.
Existing block codes stay blocks. *Implementation:* `renderedQa.ts` already emits per-code findings;
add `craftScore()` as a pure fold over findings + the deterministic pixel stats (§L) and persist it
on `reel_jobs.payload.craftScore`.

**H3 Carousel** — cover thumb-stop · immediate promise · progression · teachability · swipe
motivation · density · scan speed · variety · readability · save value · forward value · ownership ·
local usefulness · CTA. Deterministic parts (clipping, safe zone, first-slide contract) are already
tested; add a 1-call vision pass on the *cover only*.

**H4 Static** — one-glance comprehension · hierarchy · distinctive subject · composition · trigger ·
local relevance · shareability · evidence · brand recognisability · feed differentiation. Rename
Studio `visual_readiness` → `layout_feasibility` (it scores "text fits"); aesthetics come from §L's
single critic.

**H5 Outcome** — objective-dependent, see §N. Persist `planned_score`, `render_score`, publish metrics,
business metrics per content_run so the judge's calibration is measurable (false positives/negatives).

## I. Nick's UGC system (faceless, Meta-native)

Voice: conversational · specific · phone-native · slightly imperfect when useful · no agency jargon ·
no forced slang · no fake youth · no corporate CTA · no fake urgency. Voice is chosen per
audience/problem, not per post. Five production lanes with separate constraints:

| Lane | Constraint set | Hands/text allowed? |
|---|---|---|
| Real-shop UGC | phone footage, natural light, real object | yes (naturally captured) |
| Mechanic POV | camera = mechanic's eyes; no face | hands yes |
| Evidence + VO | real asset + narration + deterministic callouts | text via our renderer |
| AI cinematic | faceless, wordless, no dashboards/labels; brand bible | **no** (generated hands/labels defect) |
| Deterministic explainer | typography/diagram renderer only | yes |

Twelve grammars (customer question · phone-on-counter · mechanic POV · object POV · myth→evidence ·
text reenactment · nobody-tells-you · before-you-spend · useful absurdity · mini forensic · local
moment · shop proof) are specified as prompt contracts in `PROMPT-PACK.md` §3.

## J. Visual-system upgrade (Wave B)

Unify three vocabularies into one **Creative Visual Language** of 14–16 composition grammars (the
primitive list in §C–E), each with: suitable/unsuitable content, subject requirement, grid,
hierarchy, type scale, copy budget, image treatment, accent, safe zones, CTA behaviour, slide
progression, motion adaptation, originality fingerprint.
- Canonical home: `shared/visualLanguage.ts` (new; pure data) consumed by `visualFamily.ts`,
  `carouselSlideRenderer.ts` and `adStudio/adTemplate.ts` — the 3 families become aliases into it,
  the 13 territories map 1:1, the poster becomes `industrial_editorial`.
- Delete `carouselStudio/carouselRender.ts` (dead) and the orphan `generateCarouselBrief` proc.
- Brand tokens from `shared/brandBible.ts` NOIR_PALETTE; no family carries its own colours.
- Autonomous lanes pick a family via `familyFromArtDirection` + real-asset availability instead of
  always rendering the poster.
- Test: every family renders at 1080×1350 and 1080×1920 with a fixture brief; pHash of the 16
  renders pairwise ≥ a distance floor (so 16 families are not 16 skins).

## K. Real-shop media flywheel (Wave B)

1. **Capture**: a one-tap "Capture for Content" card on the mobile admin (reuse the evidence upload
   proc `uploadEvidencePhoto`) that records time, orientation, device, service category, rights
   `real_shop`, season, and a 1-call vision enrichment (subject, failure mode, visible evidence,
   safe claims, content opportunities) into `media_assets.generation_params_json` — **no schema
   change**: the column exists; add a typed `enrichment` key.
2. **Registry**: `listReusableRealShopMedia` gains topic filters (subject, service, season).
3. **Retrieval**: `realAssetFirst(brief)` helper asked by `reelDraftPrep`, `carouselDirector`,
   `igAutopost` and `contentManufacturing`: "do we own a real asset stronger than synthetic?" — a
   match sets `asset_origin = real|hybrid` and the family to `shop_documentary` /
   `mechanic_annotation`.
4. **Opportunity**: Today card "Capture opportunity" when an upcoming concept's subject has no real
   asset (§M).
5. **Measurement**: `asset_origin` becomes a Pattern Lab dimension so real-vs-AI outcome is learned,
   not assumed.

## L. Reel production upgrade (Wave B)

Cheapest changes with the largest perceived-craft gain, in order:
1. **$0 deterministic pixel checks before the vision call** on the frames `extractReelFrames`
   already pulls: ffmpeg `blurdetect` (plastic-look proxy), `freezedetect` / near-duplicate frames,
   black frames, caption-box vs subject overlap. Pre-flag beats; feed the flags into the single
   critic prompt.
2. **Adaptive specialist escalation**: run the existing `criticPanel` lens (reuse `mergePanel`)
   only when the general critic emits a craft/WEAK_COMPOSITION warn or the hero beat is uncertain —
   geometry → automotive, opening → editorial, text → typography, plastic/generic → brand. ~1.2
   calls/reel instead of 7. Flag `RENDERED_QA_SPECIALIST=true`.
3. **Craft score + 2-of-3 candidate pick** for the hero beat where cost allows, instead of repairing
   one mediocre clip.
4. **Duration lanes** 18–24 / 30–40 / 45–60 s as a `content_experiments` preset (`duration_v1`);
   hold concept family constant; primary metrics 3-s skip, watch/duration, sends/reach.
5. **Sound**: add a Foley/SFX bank (impact, ratchet, air, tire-on-asphalt) and music ducking under
   VO in `reelAssembly.ts`; silence as a deliberate beat.
6. **Grammar diversity** fingerprinted: `structurePatternId` + hook grammar + motion family + CTA +
   first-frame pHash added to the repetition ledger (5 → 9 dims).
7. **Image conditioning ON for real-asset reels** (`REEL_IMAGE_CONDITIONING`) once the Higgsfield
   plan is funded; Seedance 2.5 reference-to-video bakeoff scored on automotive continuity (§Research D).

## M. Creative Assistant ("what should we make today?")

Not a chat over dashboards — a ranked opportunity list with evidence. Lives on the Today tab.
- **Input**: topic graph (§O), `search_performance` deltas, `customerQuestions`, repetition ledger,
  Pattern Lab verdicts, real-asset inventory, weather, active experiments.
- **Score** (calibrated, not hardcoded): `opportunity = demand × freshness × evidence × share_potential
  × usefulness × visual_potential × local × feasibility × business − fatigue − duplication −
  weak_evidence − untruth_risk − genericness − production_risk`. Start as weighted log-sum; fit weights
  to historical `content_runs` × metrics after 30 days.
- **Output**: five cards — strongest opportunity · capture opportunity · fatigue warning · experiment
  due · article↔social reuse — each with a **"Why this?"** list of the exact signals (query +
  impressions, call count, days since topic, saves rate, asset id). Reuses
  `instagramAdminStrategy.reasons[]` and `shadowPlanner.reasoningCodes` surfaces, promoted from
  Autonomy Control to Today.

## N. Pattern Lab 2.0

Keep the floors (3 posts / 2 patterns / 12 posts; 1-in-4 exploration). Change:
- **Objective-dependent score**: discovery (3-s survival, watch ratio, sends, non-follower reach,
  follows) · reference (saves, shares) · conversation (comments, depth, shares) · conversion
  (profile/site/call/directions/booking). Replace the single saves 45 / shares 35 / retention 20.
- **Hierarchical dimensions**: broad pattern → hook family → visual family → execution combo; a
  narrower level unlocks only when its parent has the floor sample.
- **Quality evidence joined**: `renderedQa` codes + craft score + judge score per run next to
  snapshots — so "judge loved it, audience skipped it" is a query, not a feeling.
- **Negative evidence**: failure classes persisted (strong concept/bad render, high reach/low action,
  high saves/low shares, strong IG/weak FB, good click/no conversion).
- **Trial Reels as the exploration lane**: higher-risk hypotheses route to trial; results pulled
  from the API (not hand-typed) and graduated by rule.

## O. Content automation + topic graph (Wave C)

`topicGraph` (pure data + derived view): symptom ↔ part ↔ service ↔ system ↔ season ↔ Cleveland
condition ↔ customer question ↔ article ↔ service page ↔ recent post ↔ real asset. Powers article
suggestions, internal-link candidates, carousel sequences, reel follow-ups, FAQs.

**Atomizer** (`contentAtomizer.ts`): one evidence pack → format-native derivatives via the existing
directors (`reelDirector`, `carouselDirector`, article generator, FB variants, ad brief). Each output
is rewritten for its grammar; lineage via `content_runs.thesisId`.

**Article EvidencePack**: customer question · search intent · first-party observations · real photo
ids · BrandTruth · public mechanic sources · NHTSA (as proof) · related service pages · similar
articles (cannibalization check via `detectCannibalization`) · GSC queries. Topic selection is
demand-driven (GSC + calls + SMS + declined work + season + gap), seasonal list only as fallback.

## P. Semantic internal-linking system (Wave C)

Keep `shared/internalLinks.ts` as the **curated prior** — but wire it (it has zero importers today):
`RelatedServices.tsx` reads `SERVICE_RELATIONSHIPS`; `BlogPost.tsx` reads `BLOG_TAG_TO_SERVICES`;
city strip reads `SERVICE_TO_CITIES`. Then a recommendation layer (`linkRecommender.ts`, pure):

score = 25 semantic topic match (Jaccard on title+H1+headings+tags; reuse `jaccardSimilarity`; embeddings
only if the `embed` task in `ai-gateway.ts` gets a caller and a measurable lift) + 20 search-intent
match + 20 curated relationship + 10 contextual insertion quality + 10 GSC opportunity (impressions
high, CTR low or position 8–20) + 10 destination business value + 5 graph need (orphans, depth)
− cannibalization (from `detectCannibalization`) − over-linked target − anchor repetition − thin
destination − geo mismatch. Weights are hypotheses; calibrate against GSC position deltas.

Output per recommendation: source, target, score, why, insertion location, 3 natural anchors,
surrounding sentence, role (hub→spoke, spoke→hub, service→local, article→service, …). Validation
before save and before render: route in `ALL_ROUTES`, not `isRedirectedPath`, target indexable
(sitemap/noindex), anchor present in **prerendered HTML** (`prerendered/`), no orphan money page,
no link loops.

## Q. Organic → paid (Wave C)

`metaAdsArchitect.generatePlan` gains an `organicEvidence` input: top theses by sends/saves from
`content_runs` × snapshots, winning hook grammars, customer phrases, proof assets. Ads derive from a
validated tension when one exists, test directly when not; facts always from BrandTruth (shipped).
Outcome: CPL/calls/directions written back to the thesis so organic↔paid evidence stays distinct.

## R. Experimentation plan (next 90 days)

| # | Hypothesis | Variable | Control | Treatment | Primary metric | Preset |
|---|---|---|---|---|---|---|
| 1 | 30–40 s explainers hold ≥ the 20-s 3-s survival with higher sends | duration | 18–24 s | 30–40 s, then 45–60 s | 3-s skip, watch/duration, sends/reach | `duration_v1` |
| 2 | Real-shop opening frame beats AI opening frame on 3-s survival | asset_origin of beat 1 | AI | real | 3-s skip, non-follower reach | `opening_asset_v1` |
| 3 | Customer-quote hook grammar outperforms symptom-question | hook_grammar | symptom_question | customer_quote | sends/reach, comments | extend `hook_style_v1` |
| 4 | Carousel with real cover photo gets more saves than deterministic cover | cover origin | deterministic | real | saves/reach | `carousel_cover_v1` |
| 5 | FB album vs FB cross-posted image on local reach/comments | FB format | image cross-post | album (4–6 photos) | reach, comments | `fb_format_v1` |
| 6 | Foley+VO vs music-bed+VO on completion | audio_style | vo+bed | vo+foley | completion, replays | `audio_v1` |
| 7 | Trial Reel exploration lane: higher-risk grammars via trial first | distribution | normal | trial | non-follower reach, follows | manual → API |

One variable per experiment; Pattern Lab floors apply before any verdict.

## S. Admin UX plan

| Tab | Question | Change |
|---|---|---|
| Today | What should we make? | Creative Assistant cards (§M) with "Why this?"; miner's actual pick shown |
| Create | What are we making? | real-asset-first picker default; family choice shows the grammar, not a colour |
| Queue | What needs approval or repair? | visual-QA hold state surfaced (`visual-qa-unknown`), circuit snapshot in pipeline health |
| Learn | What worked? | objective-dependent scoreboards; failure-class list; judge calibration |
| Strategy | What should change? | experiment board (start/stop presets), fatigue warnings |

No new dashboards; five cards and three lists.

## T. Data model — no new tables in Waves A–B

Everything above fits existing storage: `media_assets.generation_params_json` (enrichment),
`reel_jobs.payload` (craft score, grammar fingerprint), `content_runs.evidenceJson` (thesis id,
planned/render scores), `social_reel_patterns` (new dimension keys), `content_experiments` (new
presets). Wave C may need **one** table for mined external patterns (`creative_patterns`: pattern_id,
primitives, source_examples, provenance, usage_count, outcome evidence) — justify with the
prior-art grep at that point; `social_reel_patterns` is the first candidate to extend instead.

## U. File-level engineering plan

**Wave A — shipped on this branch (truth + production safety):**
| Change | Files | Tests |
|---|---|---|
| BrandTruth compiler + ads router override + package fact-sourcing + preset fix + drift canary | `server/services/brandTruth.ts` (new) · `server/routers/metaAdsArchitect.ts` · `packages/meta-ads-architect/src/{schemas/input,generator/prompts,generator/index,presets/nicks-tire,compliance/scanner}.ts` · `client/src/lib/{igCarouselStudio,facelessReelStudio}.ts` | `server/brandTruth.test.ts` (6) · `packages/meta-ads-architect/tests/architect.test.ts` (+3) |
| Visual-QA publish gate + Gemini critic fallback | `server/services/igVisualQaGate.ts` (new) · `server/services/igAutopost.ts` | `server/services/igVisualQaGate.test.ts` (9, incl. wiring) |
| Provider circuit breaker + HF FLUX removal | `server/services/imageProviderCircuit.ts` (new) · `server/services/igAutopost.ts` | `server/services/imageProviderCircuit.test.ts` (9) · `server/igAutopost.providerCircuit.test.ts` (3) |
| Article contract + route resolver + cron save + eval criteria | `server/content-generator.ts` · `server/cron/jobs/crudAutomation.ts` · `server/lib/ai/evals/blog-seeder/criteria.ts` | `server/contentGeneratorContract.test.ts` (3) · `cronRethrow2026.test.ts` (mock widened) |

**Wave B — creative quality:** `shared/visualLanguage.ts` (new) · `visualFamily.ts` · `carouselSlideRenderer.ts` ·
`adStudio/adTemplate.ts` · delete `carouselStudio/carouselRender.ts` · `renderedQa.ts` (+pixel stats,
+craftScore) · `criticPanel.ts` (escalation caller) · `reelRepetitionHistory.ts` (+4 dims) ·
`reelAssembly.ts` (foley, ducking) · `contentExperimentStore.ts` (+presets) · `mediaRegistry.ts` /
`routers/instagramStudio.ts` (capture + enrichment) · `reelDraftPrep.ts`, `carouselDirector.ts`,
`igAutopost.ts`, `contentManufacturing.ts` (`realAssetFirst`).

**Wave C — intelligence + distribution:** `contentTopicSignals.ts` (customer-language producer) ·
`shared/topicGraph.ts` (new) · `creativeAssistant.ts` (new service + Today cards) · `linkRecommender.ts`
(new) + wire `shared/internalLinks.ts` · `socialPublish.ts` / `metaSocial.ts` (FB video + variants +
insights) · `metaAdsArchitect.ts` (organic evidence) · Pattern Lab objective scores ·
`contentAtomizer.ts` (new).

## V. Verification plan

Wave A receipts are in the PR body. Standing rules: a new test fails on the unfixed code first
(positive control recorded in each file header); behaviour, not source strings, except where the
subject is a wiring order (then both). Live receipts after deploy:
1. Railway log shows `skipping higgsfield image provider — circuit open` on the second static slot
   of the day and **no** `Hugging Face` line.
2. `ig-autopost eval` log shows `imageSkipped: false` with a Gemini verdict, or a Telegram
   `HELD BY VISUAL QA` message and an `ig_autopost_log` row with `visual-qa-unknown`.
3. `/admin/ad-studio` plan export contains "90-day labor" and no mileage warranty.
4. Wednesday 2026-10-07: `dynamic_articles` gains a `status='draft', generatedBy='ai'` row and the
   Telegram line carries `(draft #id)`.
5. First reel tick after deploy (~04:00Z): `Facebook reel cross-post published {fbPostId}` in the
   `cron:daily-reel-post` log, then an `fb:`-prefixed row in `ig_metric_snapshots` within 8 h. A
   `Facebook reel cross-post did not publish` warning with the job still `posted` is the designed
   failure shape (IG authority); `publish PARTIAL` means FB live + IG refused, parked, reconcile by hand.

## W. Deployment / rollback

All Wave A changes are env-reversible without redeploy: `IG_VISUAL_QA_GATE=false` restores the old
publish behaviour; the circuit breaker is in-memory (restart clears it); the ads override is a pure
function (revert the router line). Article prompt changes affect drafts only (never auto-publish).
No migration, no schema change, no flag flip required. Deploy = merge to `main`. Waves B/C add two more
env-reversible switches: `RENDERED_QA_SPECIALIST` unset = old call count; `REEL_FB_CROSSPOST_ENABLED` unset or
`false` = Instagram-only reels again, no redeploy of code.

## X. Prioritised execution queue

| P | Item | Why | Effect | Effort | Risk | Depends on | Verify |
|---|---|---|---|---|---|---|---|
| **P0** | Visual-QA gate + Gemini critic (shipped) | unscored AI pixels published live | no unverified AI image publishes unattended | S | hold rate if Gemini vision fails — Telegram alerts | — | §V.2 |
| **P0** | Provider circuit + HF removal (shipped) | 3 dead hops per post | −3 error logs, −~10 s latency per post | S | none | — | §V.1 |
| **P0** | BrandTruth for ads (shipped) | wrong warranty in paid copy | every ad fact = SSOT | S | none | — | §V.3 |
| **P0** | Article contract + cron save (shipped) | invented numbers; drafts dropped | truthful drafts actually exist | S | none | — | §V.4 |
| **P1** | Real-asset-first + capture card (§K) | supply, not software, is the moat | real evidence in reels/carousels/autopost | M | staff adoption | — | asset count/week, `asset_origin` share |
| **P1** | Visual language unification (§J) | 1 poster autonomously; 3 vocabularies | 14–16 grammars reachable autonomously | M | render regressions — pHash + fixture tests | — | pairwise pHash floor |
| **P1** | $0 pixel checks + adaptive specialist (§L.1–2) | craft is warn-only | craft blocks without 7× spend | M | spend creep — cap at 2 calls | — | calls/reel ≤2 avg |
| **P1** | Duration + opening-asset experiments (§R.1–2) | 20-s monoculture | learned Nick's duration | S | none | experiments store | floors reached |
| **P1** | Customer-language miner (§F) | slot has no producer | hooks in driver language | M | PII — redact at source | — | `customerQuestions.length>0` in miner |
| **P1** | FB branch: video passed, variants, insights (§G) | FB is a cross-post with no measurement | FB evaluated on its own data | M | Graph permissions | — | FB `/insights` rows |
| **P2** | Creative Assistant cards (§M) | recommendations hidden in Autonomy Control | one screen answers "what should we make" | M | dashboard creep — 5 cards max | miner, graph | operator uses it ≥3×/wk |
| **P2** | Pattern Lab 2.0 objective scores + QA join (§N) | one universal score | learning keeps intent | M | sample-size explosion — hierarchy | snapshots | verdicts per objective |
| **P2** | Link recommender + wire internalLinks.ts (§P) | dead SSOT, no scoring | contextual, validated links | M | scaled-content risk — no auto-publish | GSC | rendered-HTML anchor check |
| **P2** | Image/video bakeoff (§Research D) | current = configured, not chosen | per-task model choice | M | spend — 30 prompts cap | funding | blind scores |
| **P3** | Atomizer, organic→paid, trend layer | leverage after the above | — | L | complexity | B+C | — |

## Y. Blind-spot review (attacking this plan)

- **Are we building too much?** Wave A is four defects and zero new tables. B and C are listed as
  extensions of named files; every "new" module replaces a dead one or fills an empty slot.
- **Is something already present?** Yes, repeatedly — tournament, genome, Pattern Lab, experiments,
  QA, lineage. This plan extends each rather than adding a parallel system; the audit found the
  pasted plan's claims accurate on these points.
- **Are we optimising a proxy?** Objective-dependent scoring (§N) and business-outcome persistence
  (§H5) exist precisely so saves/sends never stand in for cars through the shop. Attribution is weak
  (UTM on Studio captions only) and this doc says so; it does not pretend otherwise.
- **Copying creators?** Primitives only; external similarity gate; Meta A1/A2 encoded.
- **Unverifiable metrics?** Profile visits, follows-from-post, reposts and all FB metrics are
  currently unmeasured — marked UNKNOWN, with the pull listed in Wave C, not assumed.
- **Is real-media scarcity the real bottleneck?** Probably the biggest one for visuals — hence P1,
  and the Today "capture opportunity" card so scarcity becomes a visible queue.
- **Too much spent on critics?** Escalation capped at ~2 calls/reel; static critic is one call;
  the gate holds rather than regenerates on UNKNOWN.
- **Overfitting short-term algorithm behaviour?** Every platform finding is dated and tagged; the
  code stores dimensions, not today's winners; exploration share is preserved.
- **Could the system publish unsupported content?** Less than yesterday: facts compile from one
  SSOT, articles cannot invent numbers, AI images need a verdict. Carousels/reels keep their existing
  claim gates.
- **Scaled-content SEO risk?** Articles stay draft-only; topic selection becomes demand-driven; no
  per-size/per-neighbourhood generation is proposed.
- **Could learning lock onto a temporary winner?** Floors + 1-in-4 exploration + Trial Reels lane.
- **Could cross-platform reuse reduce originality?** Thesis branches; nothing is cropped-and-reposted.
- **Too complicated to operate?** Admin changes are five cards and three lists; Wave A adds two env
  switches and one Telegram message type.
- **Stale business fact?** The canary now fails CI on the known-retired ones; `BUSINESS.financing.display`
  still says "financing" against the house rule — compiled wording says "payment programs"; the SSOT
  string itself is an operator decision.
- **Known open operational facts (not code):** Higgsfield and OpenRouter credits are exhausted;
  `REPLICATE_API_KEY` is unset in prod; Facebook has zero insights; the declined-work matcher last
  ran 2026-05-07.

## Z. Control gates — disposition of the 2026-10-08 blind-spot review

An external "Creative Intelligence OS 3.0" review (2026-10-08) argued that the remaining quality gaps
are the controls AROUND generation, not more models or agents. Checked against this repo and Railway
the same day. Status words follow the ladder: built / wired / tested / deployed / live.

| # | Review item | Verdict | Where / what |
|---|---|---|---|
| 1 | Previs (storyboard + timed animatic) before paid generation | BUILT + TESTED | Approved packs are human-reviewed beats before render; dynamic briefs pass the M10 preflight, the claim bank and, since 2026-10-08, the readability gate (`validateOnScreenReadability`: > 4 words/s blocks) before any paid clip. No animatic: the dynamic lane has no human gate before generation, so a timed preview would have no viewer; the timing rule is what a viewer would have caught. |
| 2 | Pairwise blind human preference | BUILT + WIRED + TESTED | Today tab "Which post is better?" (`services/pairwiseReview.ts`): two judged photo posts, no scores, sides by hash; picks in `audit_log` (`content.pairwise_pick`) with judge totals snapshotted; operator-vs-judge agreement shown. Cross-app taste store stays statenour `POST /api/proof/taste`. Protocol below still governs how to read it. |
| 3 | QA on the platform-delivered copy | BUILT + TESTED; unverified live | `services/deliveredReelQa.ts` in the 8-hourly Instagram pipeline: Graph `media_url` → ffprobe master + delivered → flash scan → `payload.deliveredQa`; morning-brief line. Needs a live `META_PAGE_ACCESS_TOKEN` run to prove it against Instagram. |
| 4 | Mechanical truth packets | BUILT + WIRED + TESTED | `shared/mechanicalTruth.ts`; refused at the Reel publish door (`reelClaimAudit.condemnedContentProblem`), given to the brief generator up front. Technician sign-off: none yet. |
| 5 | Experiment validity (A/A, power, SRM, stopping) | BUILT + TESTED (content); EXISTED (web) | Content experiments: permutation gate at planned looks only (12/24/48/96 per arm, 5% split across looks, tie only from 48, reach-weighted for weighted metrics). Walked daily in simulation: A/A 85.8% → 3.8% false winners across all looks; a doubled rate found 99.8% (mean 27.5 posts/arm), 1.5x 85.0%, never the wrong arm. Web: `shared/experimentKernel.ts` already had mSPRT, SRM and a calibration harness. |
| 6 | Unbranded recognition test with Cleveland drivers | PROTOCOL — operator | People, not code. Below. |
| 7 | Calibrated real-shop capture | PROTOCOL — operator | Below. The DVI photo pairs (migration 0143) are the first capture stream to calibrate. |
| 8 | Agent and upload threat model | BUILT (uploads); EXISTS (agents) | Evaluator separation + Night Shift identity boundary (`docs/DREAM-TO-PROOF.md`), AI disclosure gate (`shared/reelDisclosure.ts`), external-content fencing (statenour). Uploads: the bytes decide (`server/lib/imageSignature.ts`) on all three routes; non-images refused, HEIC/HEIF accepted. Size limits were already zod-bounded. |
| 9 | Provider drift canaries | BUILT + TESTED ($0) | `shared/clipDrift.ts`: assembly probes every clip it downloads; a provider whose clips drift from its own modal shape/length (≥ 2 in 7 d) is named in the morning brief. No fixed-brief paid canary — the clips already paid for are the canary. |
| 10 | Content incident response | PROTOCOL below | Lineage exists: `content_runs`, `reel_jobs.igPostId`, `ig_metric_snapshots`. |
| 11 | Shop adoption loop | MEASURED + PROTOCOL | The fourth number below is now read live: Creative Assistant `inputs.realEvidence` and the capture card carry "N/M published pieces in 30d carried real shop evidence". The rest is the protocol below. |
| 12 | Accessibility beyond captions | BUILT (flash); EXISTED (caption obstruction) | `server/services/flashRisk.ts` → `PHOTOSENSITIVE_FLASH` block; `CAPTION_OBSTRUCTION` + pixel `CAPTION_BOX_BUSY` already ran. Not measured: localized or red flashes, caption contrast ratio. |

**Also found and fixed in the same wave:** the nightly Reel had not posted since 10-04 (approved queue
drained, nothing told the operator — the morning brief now does), and `content-auto-gen` had failed on
every observed run (budget + diagnostics; cause unconfirmed until the next run).

### Pairwise review protocol (item 2)
1. Pairs, never 1–10 scores, for the decision. Hide provider, prompt, price and which is old/new.
2. Show every pair twice, once in each order (AB and BA); add 1 repeated pair per 10 to measure each reviewer's consistency.
3. One question per pass: stops the scroll · believable · clear what to do · feels like Nick's · visible defect.
4. Ties are allowed and recorded. A reviewer below 70% self-agreement on repeated pairs is reported, not silently averaged.
5. A candidate "wins" only through a paired test over the frozen briefs (the `promptEvolutionGate.ts` rule), and a single reliably-broken brief vetoes it.

### Capture kit and weekly loop (items 7, 11)
- Kit: one phone with locked exposure / white balance / 30 fps, a clamp or small tripod, a diffused inspection light, a grey card shot whenever the light changes.
- Shot set per job (under a minute): wide of the car, the defect in macro, the measurement (tread gauge, DVI reading), the part out, the part in, the finished state from the same angle as the wide.
- Weekly: the service lead names three real customer questions; whoever is on the floor captures; someone strips plates, faces and names and confirms consent; a technician checks the claim against the truth packet; one item goes to production.
- Track only four numbers: approved captures per week, % usable, median minutes per capture, % of published pieces with real Nick's evidence.

### Incident runbook (item 10)
1. **Stop the lane:** Reels — set `REEL_PUBLISH_ENABLED=false` (Railway, operator); static posts — `IG_AUTOPOST_DRYRUN=true`. A wrong approval — set `revoked_at` on its `reel_publish_approvals` row (the drain then skips it).
2. **Take it down:** this codebase has no delete-from-Instagram path; remove the post in the Instagram app and note the media id.
3. **Trace it:** `reel_jobs.igPostId` → the job's payload (brief, QA verdict, approval) → `content_runs`.
4. **Fix the class:** add the failure as a fixture — a truth-packet example, a condemned phrase in `reelClaimAudit.ts`, or a QA test — before re-enabling.

### Recognition test (item 6)
Debranded cues (palette, type, the gold scan light, sound, voice, shop imagery) shown to 30+ Cleveland
drivers next to local competitors and national chains, with "another shop" and "don't know" as
options. Keep a cue only if it is linked to Nick's more often than to anyone else. Expect "black and
gold, premium automotive" to be category-generic — that is the point of testing it.
