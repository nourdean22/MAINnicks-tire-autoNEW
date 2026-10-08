# Reels Engine v2 — Production doctrine (reconciled with the repo)

Written 2026-10-08 against branch `claude/peaceful-pascal-988w9o` (PR #2923 + the gate repair). It
synthesises three inputs — the "Reels Engine v2" mission, the "Generation and Production Audit",
and the repo as it actually is — and keeps the audit's correction: **prove production before
scaling inventory.** Every mechanism below is marked by reality state (`AGENTS.md` vocabulary);
anything not marked EXISTS is a gap, and a gap is a design item, not a promise.

Sequence this doctrine commits to: **3 finished Reels → 8-Reel pilot → 14–21-day rendered buffer →
30 validated briefs → 90-day strategic inventory.** The inventory can be *prepared* earlier (it is
free); it is not *rendered* earlier.

## 1. Real-evidence-first hybrid production

| Layer | Default method | In the repo today | State |
|---|---|---|---|
| Mechanical evidence | Real shop footage or photography | `mediaAssets.rightsStatus = "real_shop"` pool; `realAssetFirst.ts` matches one asset to a brief (`pool_empty` / `pool_unenriched` are named states); `payload.realAsset` | BUILT + WIRED for **one** asset per Reel (the hero still) — not per shot |
| Measurements and labels | Deterministic graphics | Caption overlay in `reelAssembly.ts` (`drawtext` from a textfile, `CAPTION_SAFE`, `CAPTION_BEAT_Y_FRAC = 0.62`); **no diagram/measurement-card renderer** | caption layer EXISTS · diagram cards MISSING |
| Before/after | Real matched shots | nothing enforces a matched pair | MISSING (capture rule, §6) |
| Explanatory motion | 2D/2.5D animation, crops, masks, callouts | `templateStockStudio.ts`: six deterministic camera moves on a still, animated gradient without one, 1080×1920@30, **no text in the clip by design** | EXISTS as a *backdrop* lane; crops/masks/callouts MISSING |
| Atmosphere and metaphor | AI image or video, clearly illustrative | Providers `veo`, `higgsfield` (seedance 1.5), `self_hosted` (Video Forge; BUILT, never run on a GPU, not deployed) via `reelPipeline.ts`; `REEL_IMAGE_CONDITIONING=true` conditions the hero frame | EXISTS; per-shot routing MISSING (one provider per Reel) |
| Camera movement on stills | Deterministic push/parallax or image-to-video | `templateStockStudio.ts` (deterministic); I2V through Veo / Video Forge profiles (`shared/mediaModelRegistry.ts` capability flags) | EXISTS |
| Text and captions | Deterministic renderer | `reelAssembly.ts` burns `onScreenText` per beat; packs carry `captions.srt` | EXISTS |
| Voiceover | Controlled TTS | `reelVoice.ts`: Google Neural2-J, or ElevenLabs with timestamps when its key is present | EXISTS |
| Sound design | Licensed music + real shop sounds | assembly ducks music under VO (sidechaincompress); no natural-sound library | music bed EXISTS · natural sound MISSING |
| Final assembly | Deterministic timeline renderer | `reelAssembly.ts` (ffmpeg; clip download → VO/music → caption burn → `libx264`, `aac` 192k) | EXISTS |

**Consequence for the $0 lane.** `templateStockStudio` output is stored under `reels/template-stock/…`
and `qualityGate.reelClipsIncludeStock` refuses to publish anything carrying that path (the silent
stock fallback of 2026-08-20 published seven indistinguishable Reels). A deliberate
real-evidence + deterministic Reel therefore **cannot publish through the $0 lane today**. The honest
options, for the operator to choose (publish policy, not an agent call):

1. A distinct storage prefix (e.g. `reels/real-evidence/…`) written only when the still is a
   `real_shop` registry asset, with the guard allowing that prefix and `reelPublishAuthority`
   requiring the asset id on the payload. Smallest change; keeps the fallback dead.
2. Keep the guard as is and route the proof Reels through a paid lane once authorised.

Until that decision, the proof Reels render as **animatics for review** (this session) and as
unpublishable $0 renders; nothing posts.

## 2. Shot router (seven steps) — as a decision table over beat facts

Applied **per shot**, never per Reel. The inputs are facts a brief can carry per beat (proposed
`StoryboardBeat.source`, §8): what the shot claims, whether it explains a mechanism, whether an
approved still exists, and whether a generation defect would damage trust.

| # | Question | Route | Repo mechanism |
|---|---|---|---|
| 1 | Claims to show Nick's, a customer vehicle, damage, a measurement or repair work? | **real** | `real_shop` asset + capture checklist (§6); never synthetic |
| 2 | Explains geometry, flow, force, sequence, or a decision boundary? | **deterministic** | caption card today; diagram card renderer = gap |
| 3 | Generic atmosphere, metaphor, impossible camera move, visual surprise? | **ai_illustrative** (labelled or contextually obvious) | provider lane; judge/critic codes `GENERIC_STOCK_LOOK`, `PLASTIC_AI_LOOK` price it |
| 4 | An approved still already fixes object + composition? | **still_motion** (deterministic move) before I2V, before T2V | `templateStockStudio` moves; `REEL_IMAGE_CONDITIONING` for I2V |
| 5 | Would a generation defect harm mechanical trust? | do not generate | `MECHANICAL_MISREPRESENTATION`, `BEAT_SEMANTIC_MISMATCH` are BLOCK codes already |
| 6 | Can an existing shot solve it honestly? | reuse | `reelOriginality.originalityProblem` + registry provenance decide |
| 7 | Can the Reel work without the shot? | delete | editorial: fewer shots that advance the explanation |

## 3. Model routing — no universal provider

| Need | Preferred route | Repo fact |
|---|---|---|
| Approved still, mild motion | deterministic push/parallax first | `templateStockStudio` (six moves) |
| Native 9:16 atmospheric clip | Veo (9:16, reference inputs, native audio) | `REEL_VEO_MODEL`, `REEL_VEO_AUDIO_DISABLED` are live variables |
| Precise first/last frame | Video Forge `ltx-2.5-*` profiles (`firstLastFrame: true`) once a GPU run exists; Veo | `shared/mediaModelRegistry.ts:120-170`; `wan2.2-*` lack first/last |
| Directed cinematic camera move | Higgsfield (DOP) | credentials rotate via `app_secret_kv`; payment pending — **no spend until authorised** |
| Mechanically authoritative action | real capture | no model can be ranked into correctness |
| Accurate text, gauges, labels | deterministic renderer | assembly captions; diagram cards = gap |
| Long coherent Reel | several approved shots + deterministic assembly | clip cap `MAX_CLIP_SECONDS` per beat; 5–6 beats |

Cost accounting already separates **policy from amount** (`generationLedger.reelClipCostPolicy`:
`LOCAL_FREE` for template_stock, metered for veo/higgsfield, compute estimate for self_hosted,
`requiresSpendApproval` for paid lanes) and reserves before spend / settles after. What it does not
yet record is **accepted vs rejected per shot** — the audit's cost-per-accepted-shot needs that
(§7, metrics). Runway's list price ($0.12/generated second) is not in the registry; it is a
reference point, not a route.

## 4. Editorial contract (deterministic rules a renderer can execute)

| Rule | Value | Repo state |
|---|---|---|
| Canvas | 9:16, working master 1080×1920 | `reelAssembly.ts:329` scale/crop; `templateStockStudio` FRAME_W/H |
| Delivery | H.264 MP4 + AAC, 30 fps | `libx264`, `aac` 192k; assembly refuses a master without ~30 fps worth of frames |
| Safe composition | no essential info in top 14%, bottom 35%, outer 6% (Meta ad guide) | Width: `CAPTION_SAFE.maxWidthFrac = 0.82` (9% margins) ✓. **Vertical: beat captions anchor at `y = 0.62h`; a two-line caption at the common font sizes ends near 66% of frame height, ~1% inside Meta's bottom reserve.** Hook caption is centred ✓. Decision for the operator: lower `CAPTION_BEAT_Y_FRAC` to ≈ 0.56 (one constant; `renderedPixelStats` reads the same band; tests pin it). Not changed in this PR. |
| Opening | evidence / transformation / symptom / question visible on frame one; logo never opens | `validateMutedFirstClarity` requires text on every beat; `checkEditorialContract` now WARNS on a logo/plate or generic opening (this branch) |
| Text | one idea per card; rendered separately from generative plates | captions burned by assembly ✓; readability gate (> 4 words/s block, > 3 warn) ✓ |
| Captions | deterministic, timed from the final voice track | `reelVoice` ElevenLabs path returns alignment; packs ship `captions.srt` ✓ |
| Voiceover | factual spine; music never masks it | sidechain ducking ✓ |
| Natural sound | tire machine, ratchet, impact, gauge click | MISSING (library + capture) |
| CTA | one action | `ctaType` single on a brief ✓; `CAMPAIGN_KEYWORDS` list ✓ |
| End card | ≤ 2 s unless the closing visual carries the CTA | the lane's SAVE freeze is ~3 s — review against this rule |

## 5. QA — rejection classes mapped to the critic registry

| Class | Audit rule | Registry code (exists) | Gap |
|---|---|---|---|
| Mechanical | wrong part / impossible geometry / tool not touching / measurement changes / lug count mutates / unsafe procedure / synthetic posing as real | `MECHANICAL_MISREPRESENTATION` (block), `BEAT_SEMANTIC_MISMATCH` (block), identity drift, `MALFORMED_GEOMETRY`, `IMPOSSIBLE_PHYSICALITY` | "synthetic scene documents real work" needs provenance (per-shot `source`), not pixels |
| Visual | first frame lacks subject / text in unsafe zone / captions cover evidence / generated text / warping / before-after incomparable / cinematic-only shot | `GENERATED_TEXT_ARTIFACT`, pixel pre-flags (black opening frame, duplicate beats), `PLASTIC_AI_LOOK`, `GENERIC_STOCK_LOOK`, `PHOTOSENSITIVE_FLASH` | safe-zone check vs Meta reserve = gap (§4); matched-pair check = gap |
| Audio | unintelligible on a phone speaker / music competes / loudness jumps / incomprehensible muted | audio QA verdict is REQUIRED by the gate (`AUDIO_QA_ENABLED` policy); muted-first text on every beat | loudness measurement = UNKNOWN (not read) |
| Trust | diagnosis without evidence / fear / unsourced price / privacy / undeliverable CTA | `mechanicalTruth` packets at the publish door (10 prohibited claims), claim audit, brand-voice lint, consent rules | "price lacks a current source" = not a code |

Rendered QA runs only with `RENDERED_QA_ENABLED=true` — **which production has set** (the 2040001
hold is unreachable otherwise). The gate now re-runs a persisted non-evaluation (≤ 3 runs, 30 min
apart); the operator's re-run button remains the manual lever.

## 6. Revision loop and the production manifest

Shot-level revision exists for the generative case: `selectiveRepair.requestBeatRepair` re-renders
ONE beat (stable key per logical repair, repair cap `maxRepairAttemptsPerAsset`, spend boundary),
assembly re-runs, rendered QA re-verdicts, and `staleAfterRepair` keeps the old verdict from
authorising the new file. What the audit asks for beyond that:

| Manifest field | Exists on `reel_jobs.payload` / tables | Gap |
|---|---|---|
| Reel id, angle id, family, objective | job id; `topic`, `archetype`, `structurePatternId`, `approvedPackSlug` | `angleId`, `family` fields (§8) |
| Approved script version | `voiceoverScript`; approval hashes the brief + bytes (`verifyApprovalRecord`) | — |
| Shot list, purpose, runtime | `storyboardBeats[]` (purpose, start/end) | per-shot **source class** |
| Source asset id per shot | `realAsset` (one per Reel), `clipUrls`, `clipProbes` (provider per beat) | asset id per beat |
| Asset origin per shot | provider on `clipProbes`; `real_shop` on the registry | explicit `real / licensed / deterministic / ai_image / ai_video` |
| Provider, model, settings, seed, cost | generation ledger rows (provider, model, cost, `isEstimate`) | seed/settings per shot |
| Accepted / rejected attempts | `repairQueue` length; ledger rows | accepted-vs-rejected per shot |
| Timeline version | `version` on the inventory row | — |
| VO / music licenses | VO provider recorded; music source | licence fields |
| Caption file | `captions.srt` in packs; ASS file at assembly | persisted per job |
| Final MP4 hash | approval record hashes bytes | — |
| QA findings + resolution | `renderedQa`, `audioQa`, `deliveredQa`, `repairQueue` | — |
| Operator revision notes | approval notes | free-text revision log |

## 7. Metrics that matter first (production, before audience)

See `07-PRODUCTION-METRICS.md` — each metric mapped to a source table or marked MISSING.

## 8. Code slices this doctrine implies (smallest first) — state after this branch

1. **BUILT + WIRED.** `StoryboardBeat.source?: "real" | "deterministic" | "still_motion" | "ai_illustrative"`
   on the brief type; `shared/shotRouter.ts`: `declaredBeatSource` (the field, else the leading
   REAL / DETERMINISTIC / STILL / AI tag; never a guess) and `shotRouteProblems` (a declared source that
   contradicts the beat's claim) wired into `runReelPreflight` as **production warnings**, silent on
   the undeclared beats of the 196 older packs. `routeShot` (the seven-step table) is pure and tested
   and has **no runtime consumer**: the provider pick honouring `source` is item 6 below.
2. **BUILT + WIRED.** `shared/editorialContract.ts` in `runReelPreflight` as **structural warnings**:
   logo/plate never opens, generic opening has no subject, one idea per card (> 9 words and ≥ 2
   sentences), one CTA and it comes last, end card ≤ 2 s. The three proof packs clear it (test).
3. **BUILT.** The capture card asks for the six-shot set (stills first — the pool the lane reads is
   image-only; a 5–8 s clip when easy).
4. Publish-policy decision (operator): the real-evidence prefix vs the stock guard (§1). NOT STARTED.
5. Diagram/measurement card renderer (deterministic) — only after two proof Reels need the same card.
   NOT STARTED.
6. The pipeline honouring `source` when it picks a provider (a REAL beat never goes to a generator;
   a `still_motion` beat goes to `templateStockStudio`). A change to the live lane: presented here,
   not made without sign-off.

Items 4–6 are the multi-workflow changes; `09-90-DAY-MODEL.md` carries them in the operator handoff.
