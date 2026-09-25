# Creative-quality long haul — current state

Updated with midday Reel reconciliation: 2026-09-25T11:44Z · PR #2656 rebased on main `3909f7c5b`; 133/133 production preflight locally. The older long-haul milestones below retain their historical verification context; this update does not re-certify every July claim.

## 2026-09-25 · midday rotation reconciliation

- **Rotation candidate:** 122 -> **133** approved packs, append-only; persisted cursor semantics are unchanged.
- **Midday census:** 27 source concepts -> **11 distinct additions + 16 already-covered concepts** after reconciling against #2655's newer evening import. Map: `docs/reel-packs/MIDDAY-IMPORT-2026-09-25.json`.
- **Pre-spend gate:** ratchet raised to `PREFLIGHT_PASSING_FLOOR = 133`; direct execution of the real builder + `runReelPreflight` returned **133 checked / 0 failures** locally.
- **Useful failure caught:** UTQG social copy initially used the existing hard-block terms “warranty” / “guarantee.” Copy was changed to manufacturer tread-life coverage / mileage promise; the gate stayed intact.
- **Deduping mattered:** rotor rust, oil-life/oil-pressure, ABS, XL, TPMS flash/steady, bead/rim slow leak, puncture repair zone, impact-vs-torque, two-new-tires rear, battery-light charging system, and directional/asymmetric mounting were already covered on current `main` and were not added again.
- **Not claimed:** no live render/publish, production DB/env mutation, ad action, or Railway deployment receipt. Full GitHub CI remains the merge authority.

## 2026-09-25 · approved-pack rotation expansion

- **Rotation:** 99 -> **122** approved packs, append-only; persisted cursor semantics are unchanged.
- **Batch reconciliation:** 33 candidate lessons -> **23 new distinct packs + 10 already-covered concepts**. Audit: `docs/reel-packs/EVENING-IMPORT-2026-09-25.json`.
- **Pre-spend gate:** `PREFLIGHT_PASSING_FLOOR = 122`; final #2655 CI proves all 122 rotating packs clear the production `runReelPreflight` path.
- **Useful failure caught before merge:** the first run measured 99/122 because all 23 new packs shared a beat visual containing `generated readout`, which correctly violated `IN_FRAME_TEXT_PATTERN`. The wording was recast as wordless physical evidence in all 23; the gate was not weakened and the floor was not lowered.
- **CI receipt:** affected check/lint/test/build **7/7 Turbo tasks green**, plus Completion Authority, Agent policy, Adoption gates, Admin diagnostic/typecheck, and Secret Scanning.
- **Not claimed:** no live render/publish, no production DB/env mutation, no ad action, and no post-merge deployment receipt for this batch. Preflight-clean means eligible to enter the generation pipeline, not production-proven creative quality.

## FINAL-COMMAND scoreboard (honest)

| # | Item | State |
|---|---|---|
| 1 | Baseline + benchmarks | **done** (measured; QUALITY-BASELINE.json) |
| 2 | Media registry | **live** — 0088 APPLIED to prod (32/5 cols); 20 rows; ORGANIC producer-seam row captured (ma_5453daac from job 660002); dupes surfaced |
| 3 | Drive vault | **live** — consent granted (drive.file, nourdean22); root `17SCNTPnvjEgwz3ii9o2YNbWdT0SfaOJC`; 19 backfilled + 660002 master archived (fileId `1wjuYbzxURcrfFrfdNSr2o0mnwustqFnQ`); reconcile 20/20. Remaining: auto-archival wiring (no production caller of archiveRegisteredAsset yet), full folder taxonomy, scheduled reconciliation |
| 4 | Real trajectory | **~70%** — 660002 ASSEMBLED (24s stereo, **0 silence events** vs 68% baseline dead air; per-line captions verified in frames; real vision QA verdict approve/8 frames after #833's fixes). Remaining: repair leg (parked on #834's P1 deploy) → reassembly → 2nd verdict → campaign manifest → forensic doc |
| 5-17 | Visual Bible → acceptance campaigns | partial substrates only (gated-assessment percentages accepted as fair) |

## Standing corrections (supersede anything older elsewhere)
- 0088 is APPLIED (no tap pending). Vault is LIVE (not unit_verified). #828–#833 all MERGED. Active trajectory = **660002** (660001 failed on Higgsfield 502 outage; its orphaned governor slot was released by hand — failed jobs never release creation reservations: open defect).
- LLM: **AI_FORCE_GEMINI=true live on prod** — free Gemini carries tournament/brief-gen/QA critic (OpenRouter dry; reversible by unsetting the flag).
- QA hook had NEVER run on prod (data/ path-prefix bug since #819) — fixed in #833. Critic calibration gap: approved frames with visible text artifacts (beats 1-2) — §62 calibration owed, first calibration asset in hand.
- First prod creative_genomes rows exist (4; tournament auto-persist + saveGenome dupe noted).
- **Reel 690001 defect fix (post-acceptance, #855 + #856 MERGED):** the operator-override publish (reel/Da6DDnzlelQ) shipped garbled invented text, a "Nixs" logo, and gloved hands. Root cause = Seedance has no negative-prompt param, so naming text/logo inside a compiled "DO NOT INCLUDE" clause *activated* them (pink-elephant), AND the brief layer freely designed text-dependent beats. Fix = #855 (compiler: positive clean-scene directive, drop backfiring tokens) + #856 (3 tiers — brief system-prompt hard `# IN-FRAME TEXT & BRANDING` rules, `IN_FRAME_TEXT_PATTERN` hard gate + faceless limbs, visualWorld positive framePrompt, lens-aware directive). 83/83 tests, typecheck 0. **Durable rule: for a model with no true negative conditioning, describe the desired ABSENCE positively — never name a banned concept in a DO-NOT clause.**

## Fix queue — ALL DRAINED (main e379f0e4f, 2026-07-17)
1. ~~P1 repair inventory demotion~~ → #834 MERGED
2. ~~P1 scheduling can outlive approval expiry~~ → #837 MERGED
3. ~~P2 repair-claim race (affected-rows)~~ → #838 MERGED
4. ~~P2 review gate COMMENTED overwrites CHANGES_REQUESTED~~ → #838 MERGED
5. ~~P2 evidenceRecords stripped by router zod~~ → #838 MERGED
6. ~~P2 evidence snapshots serialized~~ → #838 MERGED
7. ~~Auto-archival wiring for new renders~~ → #839 MERGED (archiveRegisteredAsset now has its production caller in reelAssembly)
8. ~~Critic calibration (§62)~~ → #841 MERGED (before/after proof on 660002 v1: approve/0 → repair with blocking artifact findings)
9. ~~Failed jobs release creation reservations~~ → #840 MERGED (all 4 failure sites + reelReservationRelease.test.ts)

Every confirmed defect from the gated assessment (2 P1s + 6 P2s) plus auto-archival and calibration are on main. The production spine is now self-maintaining: renders register → auto-archive → self-document (observed bible) → calibrated-critic judge → repair-without-overwrite → release-slot-on-failure.

## Milestone map (directive FINAL COMMAND) — remaining
5 ✅ image-derived Visual Bible (core #835 + wiring #836; remaining leg: feed forbiddenChanges INTO the next brief's prompt — belongs with milestone 6)
6 ✅ image conditioning wiring (#842, flag-gated, live-render unproven)
7 ✅ source-clip analysis core (#843)
8 ✅ deterministic audio QA (#844, voice-naturalness listening pass = named gap)
6b · true image conditioning + provider routing (Higgsfield image-to-video verification, ProviderCapability registry, quality scorecard)
7 · professional edit planner (ReelEditPlan: source-clip analysis, hook variants, transitions, grade, pacing)
8 · Audio Director (voice profiles, pronunciation lexicon, music strategy, mix/master, audio QA, LISTENING pass)
9 · specialist critic panel (split the single vision critic into visual/automotive/editorial/typography/audio/brand/strategic)
10 · expand selective repair to audio/subtitle/transition/carousel-slide/story-frame units
11 · Story + Photo directors; carousel QA 2.0 (contact sheet, deck judge)
12 · Planner 2.0 (CampaignProductionPlan, weekly portfolio, learning from operator decisions)
13 · media intelligence + reuse (MediaIntelligenceProfile, similarity/dupe, reuse decision engine)
14 · unified campaign workspace UI
15 · quality-driven automation (PROCEED/REPAIR/PAUSE decision engine)
16 · three acceptance campaigns (A trust/education, B cinematic, C local personality)
17 · measured baseline-vs-final report
