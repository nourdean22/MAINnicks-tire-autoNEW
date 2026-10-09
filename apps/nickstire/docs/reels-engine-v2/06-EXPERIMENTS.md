# Reels Engine v2 — The five experiments, on the framework that exists

## What the lane can actually vary (2026-10-08, after #2932)

**The daily lane publishes approved packs verbatim.** `resolveApprovedPackSelection` returns a library
pack every day (or holds on a broken slate or cursor), and `dailyReelPost` builds the Reel from the
pack's reviewed brief without regenerating it. The two "wired" presets apply their arm only while a
brief is being WRITTEN: `hook_style_v1` in the daily lane's AI-brief branch (unreachable while the
library has packs), `duration_v1` in `reelBriefGen` (Studio). Until this change every enqueued Reel
was still recorded in both, so a started hook test would have compared identical pack Reels under two
arm names. Pack Reels are no longer recorded in `hook_style` / `length_band` experiments
(`contentExperimentStore.assignEpisodeToActiveExperiment`); those two collect only AI-written briefs.

**So most of the five below cannot be wired by a generation switch.** Three of them (#1 opening
mechanism, #2 opening asset, #4 payoff structure) change reviewed content. #3 turned out not to: a
pack's lens is chosen when the pack is BUILT, not authored, so `visual_direction_v1` is wired for
pack Reels (2026-10-08, table below). It is the one experiment the pack lane can run today.

**Pack-variant arms — built 2026-10-08 (operator-approved design), inert until a pair is approved:**

1. An arm is a reviewed VARIANT of an approved pack, at `docs/reel-packs/<slug>/variants/<armId>/brief.json`
   (`loadApprovedProductionPack(slug, armId)`; the pack id stays the slug, the source path and digest are
   the variant's). The approval is the `APPROVED_PACK_VARIANTS` list in `approvedReelPackRotation.ts`,
   keyed experiment id -> pack slug -> arm ids, never the folder. It ships empty.
2. A pack joins an experiment only when EVERY arm has an approved variant that loads, builds and clears
   what enqueue would refuse from the brief alone (`approvedVariantSnapshot`, `reelEnqueueRefusals`);
   otherwise the base pack is built and nothing is recorded. If one arm's variant were refused at
   enqueue, the lane would skip the pack on the days that arm was drawn, and the drawn arm would decide
   which packs aired. The episode contract's claim checks are not pre-checked.
3. `dailyReelPost` resolves the arm (`packVariantForEpisode(briefId)`) before the build, builds the drawn
   arm's variant, and stamps the arms it applied on the brief (`appliedPackArms`). Enqueue records a
   pack-build arm only when the stamped arm is the one the job's key draws: a regenerate re-keys the
   brief and a seeded pack is built with no arm, so the key alone would file a Reel under an arm its
   content never got. The camera-direction arm (#3) follows the same rule. Cost: a regenerated Reel is
   recorded only when its new key draws the same arm (about half the time); the rest are not measured,
   whichever arm they had.
4. #1 has a preset: `opening_mechanism_v1` (`open-reveal` vs `open-question`, `shares_per_reach`). #4
   uses the same mechanism and gets its own preset when its variants are written. Only one
   `pack_variant` experiment applies at a time (a Reel is built from one brief; the oldest running wins).
5. Its arm is drawn with a bit-mixed hash on experiment + key (`MIXED_HASH_VARIABLES`). The plain hash
   gives two 2-arm experiments the same split on every key (measured: 120 of 120 daily keys), so
   variant and camera arms would have measured each other; mixed, they agree on 58 of 120.
6. `startContentExperiment` refuses a `pack_variant` preset with no eligible pair on a rotation pack
   (`PRECONDITION_FAILED`).
   To approve a pair: write both variants (same beat timings as the base; a test runs every approved
   variant through the builder, preflight and the truth-claim scan), then list both arm ids under the
   pack. Pick packs the rotation has not reached yet (the cursor read 32 of 99); a pack joins the day
   the rotation reaches it.
7. Cost: one extra authored brief per pack per arm, and the wait — at one Reel a day across two arms
   the first decision look (12 per arm) is about 24 posting days away, and only Reels from packs with
   an approved pair count.
8. #5 (native presentation) needs no variant: it is a publish-time switch, but it changes the publish
   path, so it is its own decision.
9. #2 (opening asset) also waits on the real-evidence publish route: the generator refuses a beat
   declared real, and the stock guard refuses a locally hosted clip.

Sequencing still follows the audit: measure production first, experiment after stable publication.


Rules (all enforced in code since PR #2923): a preset starts only if its treatment changes
generation (`isUnwiredExperimentId` → `startContentExperiment` refuses `PRECONDITION_FAILED`);
verdicts only at the decision looks (12 / 24 / 48 / 96 reported posts per arm), 0.0125 per look,
tie only from 48; the resolver reports a running unwired experiment instead of judging it; the
operator stops one with `contentAdmin.stopContentExperiment`. Small samples keep collecting —
nothing invents significance.

| # | Mission experiment | Existing preset | Treatment wired today? | What wiring needs | Metric (spec) |
|---|---|---|---|---|---|
| 1 | Opening mechanism: visual reveal vs customer question | `opening_mechanism_v1` (`pack_variant`: `open-reveal` vs `open-question`) — **wired 2026-10-08, pack Reels only; no approved pairs** (`hook_style_v1` stays the AI-brief hook test) | yes, once a pair is approved | approved variants: beat 1 rewritten as the reveal and as the question for each pack, listed in `APPROVED_PACK_VARIANTS` (above). `reelHookGrammar` already classifies question shapes, so a reviewer can check the arm landed | `shares_per_reach` (COUNT_PER_REACH) |
| 2 | Creative source: real shop footage vs illustrative AI | `opening_asset_v1` (`content_origin`: `ai_generated` vs `real_shop`) — **exposed only** | no | the opening beat must honour the arm: `real_shop` → `realAssetFirst` match required (skip assignment when the pool is empty, never silently fall back); `ai_generated` → provider lane. `StoryboardBeat.source` now exists (this branch); the provider pick reading it is doctrine §8 item 6 | `skip_rate` (RAW_AVERAGE, lower wins) |
| 3 | Visual direction: documentary vs cinematic | `visual_direction_v1` (`visual_direction`: `documentary` vs `cinematic`) — **wired 2026-10-08, pack Reels only** | yes | done: `dailyReelPost` resolves the arm (`visualDirectionForEpisode(briefId)`) before the pack is built, and `buildBriefFromApprovedProductionPack` picks the lens from the arm's family only (`VISUAL_DIRECTION_LENSES`: documentary = extreme-macro push-in, forensic evidence scan; cinematic = hyperreal cinematic, product-ad macro; both photographic, the stylised lenses in neither). Enqueue records pack Reels only. Not started: start it with `contentAdmin.startContentExperiment({ preset: "visual_direction_v1" })` once posting is stable (no phone button exists for any preset) | `avg_watch_time` (WEIGHTED_AVERAGE) |
| 4 | Payoff structure: immediate vs progressive reveal | none (the `pack_variant` mechanism exists; `structurePatternId` + `reelStructureFingerprint` exist) | no | approved variants per pack (payoff in beat 2 vs the last beat) and a preset on `pack_variant`; the fingerprint proves the treatment landed | `avg_watch_time` |
| 5 | Native platform presentation vs generic cross-post | `fb_format_v1` (`image_crosspost` vs `album`) — **exposed only** | no | `REEL_FB_CROSSPOST_ENABLED` is a live variable; the arm must select the FB format at publish | `reach` (RAW_TOTAL) |

Order of wiring (smallest change first): **2** (it is the doctrine's own per-shot source field and
the capture checklist feeds it), then **1** (a prompt fragment), then **4** (a structure arm the
fingerprint can verify), then **3**, then **5**. Each wiring lands with the wiring-gate test
pattern from PR #2923: a mutation that un-wires the treatment must turn the test red.

What not to do: start `audio-style-v1` (`vo_foley` has no foley lane), declare a winner from the
8-Reel pilot (it measures production acceptance, not creative laws), or compare posts published
under different distribution conditions without naming it.

Power, from the calibrated simulation (`contentExperimentsValidity.test.ts`, 2026-10-08): a
doubled share rate is found 99.8% of the time with a mean first verdict at 27.5 posts per arm; a
1.5× rate 85% by 100 per arm. At one Reel a day across two arms, **the first look (12 per arm)
arrives after ~24 posting days**; plan the calendar on that, not on hope.
