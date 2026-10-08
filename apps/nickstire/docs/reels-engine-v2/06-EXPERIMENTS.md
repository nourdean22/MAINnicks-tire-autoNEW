# Reels Engine v2 — The five experiments, on the framework that exists

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
