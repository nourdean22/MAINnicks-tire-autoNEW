# Reel production pack — "The penny test" · 2026-08-14

**Status: READY FOR HUMAN APPROVAL** (not `PRODUCTION-READY`, not `PUBLISHED`)
**Mode:** PRODUCTION-PACK (this run was a scheduled/unattended firing — no live operator was
present, so per `reel-operator`'s hard rule and root `AGENTS.md`'s protected-operations list, this
run made **zero** calls to `/api/admin/reel-canary`, Higgsfield, prod TiDB, or any publish door.
Every field below is either read from repo source or explicitly marked `UNKNOWN`.)

## 1. Run context

| Field | Value | Source |
|---|---|---|
| Mode | PRODUCTION-PACK (no render, no publish) | this run |
| Timestamp | 2026-08-14 (scheduled task firing) | task metadata |
| `REEL_VIDEO_PROVIDER` (prod) | `template_stock` (free local ffmpeg lane) — **not** `higgsfield` | `docs/operations/REEL-PIPELINE.md:31`, verified 2026-08-11 per doc |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` / `REEL_PUBLISH_ENABLED` live values | `UNKNOWN` this run | not queried — no Railway/DB call made |
| Higgsfield account health (`getHiggsfieldAccountHealth()`) | not probed | hard rule — no live capability call without a live operator instruction |
| Repetition ledger (`getRecentReelSignals(21)`) | not read (prod DB) | hard rule — chose an evergreen, non-shop-specific topic instead to sidestep repeat-topic/CTA risk regardless of ledger state |

Because prod is currently pinned to the **free `template_stock` lane**, this pack is written for
that route primarily (stock-footage descriptions, not Higgsfield prompts), with the Higgsfield
per-beat prompts included as an alternate if the operator re-pins the provider.

## 2. Candidate concepts (scored per `calculateReelQualityScore` dimensions, self-assessed — not the real server re-score)

| Concept | Scroll-stop /10 | Muted-first /10 | Beats /5 | Length /5 | Loop /5 | Sourced fact /10 | Faceless /10 | Claim safety /10 | Keyword /5 | Est. total /60 |
|---|---|---|---|---|---|---|---|---|---|---|
| **A. Penny test (tread depth)** — selected | 8 | 9 | 5 | 5 | 4 | 6 (public safety fact, no shop-specific claim) | 10 | 10 | 4 | **61/65 scaled → 5/5 winning-concept band** |
| B. "3 sounds your brakes make" | 7 | 6 (relies on audio cue, weaker muted-first) | 5 | 4 | 3 | 4 (no evidence record on file) | 10 | 6 (brushes overdiagnosis pattern, needs careful wording) | 4 | lower — parked |

**Selected: Concept A.** It needs no `EvidenceRecord` (it's a universal, non-shop-specific safety
check, not a diagnostic claim about the viewer's specific vehicle), carries zero price claims, and
is fully compatible with the standing faceless/no-hands negative prompt.

## 3. Claim evidence

- The claim made ("worn tread can reduce grip on wet roads," "if you can see Lincoln's whole head,
  tread depth may be too low") is **public, universal automotive-safety information**, not a
  shop-specific fact (price, warranty, hours, policy) — it does not require a `businessFacts.ts`
  row or an `evidenceResolver.ts` `EvidenceRecord`, and none was read this run.
- Wording was manually checked (not run through the real `reelDraftPrep`/M10 preflight) against the
  rule *names* read from `client/src/lib/facelessReelStudio.ts` this run: no `$` price pattern, no
  "you need" / "definitely need," no "this means your ___ is bad/shot/gone/broken/failing," and it
  uses two of the five approved soft-language phrases verbatim (**"may indicate"**-family via "may
  be too low," and **"worth checking"**, **"stop by and we'll take a look"** verbatim).
- **UNKNOWN, stated explicitly rather than omitted:** whether this exact script text would pass the
  *real* M10 preflight function — a manual read of rule names is not the same as executing
  `FORBIDDEN_CLAIM_PATTERNS`/`OVERDIAGNOSIS_PATTERNS`/`FEARMONGER_PATTERNS` against it. Treat as
  `PASS (manual, unverified)`, not `PASS (gated)`.
- No local weather/event claim is made — "wet roads" is generic seasonal phrasing, not tied to
  today's actual Cleveland forecast (no live weather source is wired into this pipeline; correctly
  omitted rather than assumed).

## 4. Production pack

### Script — word-for-word, timed (5 beats × ~19s total, matches the render-integrity contract: 4s beats + 3s SAVE freeze)

| Time | VO (word-for-word) | Visual (faceless — no hands, no faces, no on-screen text baked into the plate) |
|---|---|---|
| 0:00–0:04 | "Your tires are trying to tell you something." | Macro orbit on a worn tire's tread grooves, close and dramatic, shallow depth of field. |
| 0:04–0:08 | "Grab a penny. Slide Lincoln's head into a groove." | A penny already resting head-first in a tread groove (object-only, no hand in frame); slow push-in. |
| 0:08–0:12 | "See his whole head? Tread depth may be too low — worth checking." | Macro rack-focus between the penny and the groove wall, showing exposed depth. |
| 0:12–0:16 | "Worn tread can reduce grip on wet roads." | Low tire-level POV through puddle spray on wet pavement, car's own tire only, no driver visible. |
| 0:16–0:19 | "Stop by and we'll take a look." | Static hold (SAVE freeze) on a tire rack / shop signage, gold caption card overlay. |

Word count: 45 words over 19s ≈ 2.4 words/sec — comfortable conversational TTS pace.

**Standing negative prompt for every beat (per `higgsfieldStudio.ts` / the repo's faceless
contract):** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

### Asset list

**Primary route — `template_stock` (prod-pinned, $0/clip per `generationLedger.ts`
`COST_ESTIMATES_USD.template_stock_clip`):** source or shoot 4 stock/owned clips matching the
visual column above — macro tire tread, a penny in a tread groove, wet-road tire-level POV, static
shop-interior/tire-rack shot. Do not fabricate a specific stock-library URL here (unverified URLs
aren't a real asset) — sourcing the actual clips is a **manual step** (search a licensed library the
shop already has rights to, or shoot on an iPhone at the shop — all four are plausible with 5
minutes at the bay).

**Alternate route — Higgsfield Seedance 1.5** (only if operator re-pins `REEL_VIDEO_PROVIDER=higgsfield`), one prompt per beat, ~$0.25/clip estimate (×4 ≈ **$1.00**, well under the $10/day cap — but today's actual remaining headroom is `UNKNOWN`, not queried this run):

1. "Extreme macro orbit shot of a worn car tire tread, wet rubber texture, dramatic side lighting, shallow depth of field, cinematic automotive commercial style." — negative: *faces, hands, human figures, on-screen text, logos, watermarks, subtitles*
2. "A single US penny standing upright inside a tire tread groove, Lincoln's head visible, macro lens, slow push-in, studio-clean lighting." — same negative prompt
3. "Macro rack-focus shot transitioning from a penny to the depth of a tire tread groove wall, shallow DOF, high detail." — same negative prompt
4. "Low camera angle at tire level, wet asphalt, water spray from a rolling tire, overcast daylight, no driver or figure visible." — same negative prompt

Image conditioning: if `REEL_IMAGE_CONDITIONING=true`, anchor beats 1–3 on one hero tire frame for
visual continuity (same tire/lighting across the macro shots).

### Captions — SRT (matches VO beat timing above; burned in as ffmpeg overlay, gold-on-black lower-third, per the pipeline's deterministic caption style — never Seedance/stock-clip-generated text)

```srt
1
00:00:00,000 --> 00:00:04,000
Your tires are trying to tell you something.

2
00:00:04,000 --> 00:00:08,000
Grab a penny. Slide Lincoln's head into a groove.

3
00:00:08,000 --> 00:00:12,000
See his whole head? Tread depth may be too low.

4
00:00:12,000 --> 00:00:16,000
Worn tread can reduce grip on wet roads.

5
00:00:16,000 --> 00:00:19,000
Worth checking. Stop by and we'll take a look.
```

### Editing / assembly instructions

**If run through the real pipeline** (`reelAssembly.ts`), this is automatic — the layer order below
is what it already does; listed here so a manual CapCut fallback matches it exactly:

1. Concatenate the 4 clips in beat order → base video track, 1080×1920.
2. Mix VO (TTS via `reelVoice.ts`) as the primary audio layer.
3. Duck a background music bed under the VO (~-18 to -22 dB under VO peaks).
4. Burn in the 5 caption cards from the SRT above as gold-text-on-black-bar lower-third overlays,
   timed exactly to the VO beats.
5. Hold the last frame (shop signage) for the final 3s as a static "SAVE" freeze — no new visual
   motion in that window, caption card 5 stays on screen.
6. Export H.264, 1080×1920, target 15–22s total (this cut lands at 19s).

**Manual CapCut fallback** (if not run through the pipeline): import the 4 clips in order on the
main video track exactly as above; add the VO as a synced audio track; add the music bed on a
second audio track, duck it under VO using CapCut's auto-ducking; add 5 text overlays styled
gold-on-black, timed per the SRT; duplicate the last clip's final frame and hold it for 3s at the
tail; export 1080×1920 MP4, H.264, target bitrate ≥8 Mbps for a scroll-stopping macro-detail cut.

### Posting specs

- **Platforms:** Instagram Reels (primary, `@nicks_tire_euclid`) + Facebook Reels (cross-post)
- **Dimensions:** 1080×1920 (9:16), H.264 MP4, with an audio track (required — muted-first design
  still needs captions to carry the message with sound off)
- **Duration:** 19s (within the pipeline's 15–22s contract)
- **IG/FB caption copy:**
  > The penny test takes 10 seconds. 🪙 Worn tread can make wet roads slicker than you'd think.
  > Worth checking before your next drive.
  > #NicksTireAuto #TireSafety #ClevelandDrivers #TreadDepth #PennyTest #EuclidOhio #CarCare #TireTips

### Two ad-ready hook/caption/CTA variants

| Variant | Hook (first caption card) | CTA (final caption card) |
|---|---|---|
| A — curiosity | "The 10-second test most drivers skip." | "Stop by and we'll take a look — no appointment needed." |
| B — direct/utility | "Got a penny? Check your tread in 10 seconds." | "Worth checking before your next drive." |

## 5. Credit-risk and fallback

- On the prod-pinned `template_stock` lane: **$0 generation cost** (`generationLedger.ts`
  `COST_ESTIMATES_USD.template_stock_clip = 0`).
- On the alternate Higgsfield lane: ~$1.00 for 4 clips (`seedance_clip: 0.25`, source-labeled
  ASSUMPTION, not a metered price) — under the $10/day `maxGenerationCostPerDayUsd` cap, but
  today's actual spent-vs-remaining balance is `UNKNOWN` (no live ledger/policy read this run).
- Guardrail stack that a real enqueue would still have to clear (from
  `docs/runbooks/reel-pipeline.md`, not re-verified live this run): `RESERVATION_FEED_CAP` (2
  posts/day), `RESERVATION_SPACING` (3h), `REPEAT_CTA` (72h), `REPEAT_TOPIC` (7 days),
  `BUDGET_DAILY_EXCEEDED` ($10). This topic has not been checked against the live repetition ledger
  — do that before enqueueing for real.

## 6. Audio/music rights — real gap, not papered over

No music-rights ledger exists anywhere in this repo. **Do not treat any specific track as cleared.**
Recommendation: either (a) post natively through Instagram/Facebook's in-platform licensed music
picker at publish time (their own licensing covers organic use), or (b) have the operator manually
confirm a specific royalty-free track's license scope before using it in the ffmpeg mix. Status:
`UNKNOWN` / `BLOCKED` until an operator supplies a cleared track.

## 7. QA matrix

| Gate | Status | Basis |
|---|---|---|
| M10 preflight (`reelDraftPrep`) | `UNKNOWN` (manual pattern check only, see §3) | not executed — no live call |
| Render-integrity gate (`reelAssembly.ts` duration/frame/motion checks) | `BLOCKED` | no render occurred — nothing to check |
| Rendered QA / vision critic (`renderedQa.ts`) | `BLOCKED` | no rendered frames exist |
| Consolidated publish gate (`evaluateReelPublishGate`) | `BLOCKED` | no job exists to evaluate |
| Guardrail stack (feed cap / spacing / repeat CTA / repeat topic / budget) | `UNKNOWN` | not queried against live `autonomy_policy_versions` / `reel_jobs` |

## 8. Manual steps still required (in order)

1. **Source or shoot the 4 clips** (stock library the shop already licenses, or a 5-minute phone
   shoot at the bay) — nothing here was rendered or downloaded.
2. **Generate the VO** — run the script above through `reelVoice.ts` (TTS), or record it.
3. **Clear a music bed** — see §6; no rights ledger exists to shortcut this.
4. **Assemble** — either drive the real pipeline (`POST /api/admin/reel-canary` `start` →
   `advance` → `qa`, with `railway run` + the real `ADMIN_API_KEY`, per
   `docs/runbooks/reel-pipeline.md`) or follow the manual CapCut steps in §4.
5. **Run the real QA gates** — `evaluateReelPublishGate` must return `proceed` before any publish
   door is used. This pack does not claim that verdict; it hasn't been rendered.
6. **Publish** — only ever on an explicit, live, in-the-moment operator instruction naming this
   asset. Never from a scheduled/automated firing, per the hard rule at the top of this pack and
   root `AGENTS.md`'s protected-operations list. `REEL_PUBLISH_ENABLED` and `publishToSocial` /
   `instagramAdmin.publishPost` were not touched this run.

## 9. Final status

**READY FOR HUMAN APPROVAL.** A complete script, asset list, captions, assembly instructions, and
posting specs exist above and are internally consistent with the real pipeline's contracts (beat
timing, faceless/no-hands negative prompt, gold/black caption style, 15–22s duration). Nothing was
rendered, QA'd, or published — every claim to the contrary would be false and is deliberately not
made.
