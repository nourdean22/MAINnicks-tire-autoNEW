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

**So the five below cannot be wired by a generation switch.** Three of them (#1 opening mechanism,
#2 opening asset, #4 payoff structure) change reviewed content, and #3 changes authored prompts.

**Design to approve before anything is built — pack-variant arms:**

1. An arm is a reviewed VARIANT of an approved pack (`docs/reel-packs/<slug>/variants/<arm>/brief.json`),
   approved like any pack; a pack without a variant for the running experiment is simply not in it.
2. At selection, the pack branch asks the store for this episode's arm (deterministic on the brief id,
   as today) and builds from that variant; assignment records the arm only when a variant was used.
3. Cost: one extra authored brief per pack per arm, and the wait — at one Reel a day across two arms
   the first decision look (12 per arm) is about 24 posting days away.
4. #5 (native presentation) needs no variant: it is a publish-time switch, but it changes the publish
   path, so it is its own decision.
5. #2 (opening asset) also waits on the real-evidence publish route: the generator refuses a beat
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
| 1 | Opening mechanism: visual reveal vs customer question | `hook_style_v1` (`hook-control` baseline vs `hook-direct`) — **wired** (`dailyReelPost` reads the hook arm) | yes, for *baseline vs direct* | a new arm pair `reveal` vs `question` on the same variable = a brief-generator fragment that constrains beat-1 grammar (`reelHookGrammar` already classifies `number_lead`, `command`, question shapes) | `shares_per_reach` (COUNT_PER_REACH) |
| 2 | Creative source: real shop footage vs illustrative AI | `opening_asset_v1` (`content_origin`: `ai_generated` vs `real_shop`) — **exposed only** | no | the opening beat must honour the arm: `real_shop` → `realAssetFirst` match required (skip assignment when the pool is empty, never silently fall back); `ai_generated` → provider lane. `StoryboardBeat.source` now exists (this branch); the provider pick reading it is doctrine §8 item 6 | `skip_rate` (RAW_AVERAGE, lower wins) |
| 3 | Visual direction: documentary vs cinematic | none | no | a `motionLens` family arm: documentary lenses vs cinematic lenses (the generator already receives the lens; `LENS_PALETTES` grades palette per lens) | `avg_watch_time` (WEIGHTED_AVERAGE) |
| 4 | Payoff structure: immediate vs progressive reveal | none (but `structurePatternId` + `reelStructureFingerprint` exist) | no | an arm on the structure pattern: payoff in beat 2 vs payoff in the last beat; the fingerprint proves the treatment landed | `avg_watch_time` |
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
