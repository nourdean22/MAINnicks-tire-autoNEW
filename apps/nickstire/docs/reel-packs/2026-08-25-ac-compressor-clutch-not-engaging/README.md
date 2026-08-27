# Reel pack — AC compressor clutch not engaging (low-pressure cutoff switch)

Produced by a **scheduled** "faceless short-form video workflow" firing. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a scheduled/non-live
firing may never render, spend, or publish — this is a **production-ready pack**,
not a rendered file or a live post. Nothing in this PR touches runtime code.

## 1. Mode, timestamp, capabilities, backlog check

- Mode: `INTELLIGENCE` → `PRODUCTION` pack (no render attempted).
- Timestamp: 2026-08-25 (session clock).
- Capabilities available to this session: none of `HIGGSFIELD_*` / `ADMIN_API_KEY` /
  `REEL_GENERATION_ENABLED` / Meta / Instagram / TTS credentials are present — this
  session has no path to `/api/admin/reel-canary` or any render/publish route.
  `getHiggsfieldAccountHealth()` was **not** called (nothing to call it with).
  Per prod-db-guard and the reel-operator skill's hard rule, real generation, spend,
  or publish is blocked on a scheduled firing regardless of credentials, so the only
  permitted deliverable was always a pack, never a rendered asset.
- Repetition-ledger: `getRecentReelSignals()` (prod TiDB) was **not** queried live —
  that is a production database read and this is a scheduled, non-interactive
  firing (prod-db-guard). Instead, duplication was checked the safe way:
  - `apps/nickstire/docs/reel-packs/` — 108 merged date-slug directories
    (2026-08-14 through 2026-08-25), none on this topic.
  - Open PRs — as of this run, **2 open** touch reel packs: #1842 (a backlog-status
    note, not a pack) and #1835 (`exhaust manifold leak, cold-start tick` — a
    different mechanical system, no overlap).
  - **Note on backlog history:** #1842 (created ~1 hour before this run) reported
    127 open, unreviewed `reel pack` PRs and skipped producing a new pack for that
    reason — the fourth consecutive scheduled firing to flag a stuck review
    backlog since 2026-08-19. A fresh check for this run found only 2 open PRs
    total in the repo touch reel content, so the backlog was resolved (batch
    review or merge) in the ~1 hour between that run and this one. That blocker no
    longer applies, so this run produces a normal pack rather than another
    status-only note. If a future run finds the backlog re-accumulating, the
    open recommendation from #1842 stands: batch-review the queue and consider the
    firing cadence at the trigger level.

## 2. Candidate concepts (scored 0–5 per dimension)

| Concept | Novelty (no dup) | Hook strength | Claim safety | Faceless fit | Total /20 |
|---|---|---|---|---|---|
| **AC compressor clutch never engages — low-pressure cutoff switch** (selected) | 5 | 4 | 5 | 5 | **19** |
| Rear window defroster grid line broken | 5 | 3 | 5 | 5 | 18 |
| AC blows from wrong vents — mode-door actuator stuck on defrost | 4 (adjacent to the 2026-08-25 blend-door pack, different actuator/symptom) | 4 | 5 | 5 | 18 |

Selected: the compressor-clutch concept extends the existing AC diagnostic
mini-series already in this directory (`ac-not-blowing-cold` → `ac-recharge-myth-sealed-system`
→ `ac-blend-door-actuator-hot-cold-split`) with a fourth, mechanically distinct
cause (electrical/pressure-switch, not refrigerant charge or air-path), and tests
well on hook strength: "adding Freon won't fix this" contradicts the viewer's
default assumption in the first beat.

## 3. Claim evidence

- **No pricing, warranty, or timeline claims appear in this script** — checked
  against `businessFacts.ts` `SEED_FACTS` category list (pricing/warranty/policy);
  none apply here and none are used.
- **Mechanical claim** ("a low-pressure cutoff switch can shut the compressor off
  on purpose"): this is general automotive-engineering knowledge (standard on
  R134a/R1234yf systems), not a shop-specific or invoice-sourced claim. No
  `EvidenceRecord` was pulled from `evidenceResolver.ts` / `evidenceRecords.ts` —
  that store requires a prod DB read, which this scheduled run does not perform
  (prod-db-guard). **Entailment status: `not_evaluated` / `UNKNOWN`** — not
  claimed as `supported`. Accordingly every claim-bearing line uses the approved
  hedge bank from `client/src/lib/facelessReelStudio.ts` (*can point to*, *one
  clue*, *worth checking*, *stop by and we'll take a look*) rather than an
  unqualified assertion, per the claim-safety validator's own approved phrasing.
- **No local/weather/event claim** is made (Cleveland's current heat isn't
  invoked as a fact) — labeled unnecessary here rather than `UNKNOWN`, since the
  script never asserts one.

## 4. Production pack

### Script — word-for-word, timed to seconds (43s total: 40s VO + 3s silent freeze)

| Beat | Time | VO (word-for-word) |
|---|---|---|
| 1 | 0:00–0:04 (4s) | "Your AC blows warm. You assume it's just low on Freon." |
| 2 | 0:04–0:11 (7s) | "But if the compressor clutch never engages, adding more refrigerant won't fix a thing." |
| 3 | 0:11–0:19 (8s) | "A low-pressure cutoff switch can shut the compressor off on purpose, to protect it from running dry." |
| 4 | 0:19–0:27 (8s) | "A low gauge reading alone can point to a leak, or a switch doing exactly what it's built to do." |
| 5 | 0:27–0:34 (7s) | "That's one clue worth checking, not a diagnosis you make from the driver's seat." |
| 6 | 0:34–0:40 (6s) | "Stop by and we'll take a look before you add anything to the system." |
| SAVE | 0:40–0:43 (3s) | *(silent, freeze-hold on beat 6's final frame; "Save this" overlay added in post, not in generation)* |

Muted-first: every claim lands in the caption track too (see `captions.srt`) —
the reel works with sound off, per the scoring rubric's muted-first dimension.

### Per-beat visual prompts (faceless — car/parts/environment only, no people)

Standing negative prompt on **every** beat: `faces, hands, human figures,
on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — "Static shot inside a parked car on a hot sunny day, dashboard
   air vents in close-up blasting visible heat-shimmer air, sun glare through the
   windshield, warm color grade, shallow depth of field, cinematic automotive
   macro, 9:16 vertical."
2. **0:04–0:11** — "Close-up macro shot under the hood of a car: serpentine belt
   and AC compressor pulley, the pulley spinning but the center clutch plate not
   engaging, metallic reflections, daylight, shallow depth of field, 9:16
   vertical."
3. **0:11–0:19** — "Extreme macro shot of a small AC low-pressure cutoff switch
   mounted on a refrigerant line under the hood, condensation beads on the metal
   line, cool blue-tinted highlights against a warm engine bay, 9:16 vertical."
4. **0:19–0:27** — "Macro shot of an automotive AC gauge manifold, analog dial
   needles, low-side gauge needle resting near the low end, hoses connected to a
   service port, garage bay lighting, shallow depth of field, 9:16 vertical."
5. **0:27–0:34** — "Wide shot of a car raised on a hydraulic lift inside a clean
   auto repair bay, a diagnostic scan tool cable connected near the dash, bay
   lighting, no people in frame, 9:16 vertical."
6. **0:34–0:40** — "Exterior static shot of a tire and auto repair shop
   storefront in late-afternoon light, signage visible, parked cars in the lot,
   warm inviting color grade, 9:16 vertical."
7. **SAVE freeze (0:40–0:43)** — hold beat 6's last frame; no new generation.

On-screen text/logos/subtitles are deliberately excluded from every generation
prompt (they render as garbled artifacts from image/video models) — the "Save
this" end-card text and burned-in captions are added in the edit step below,
not by the generator.

### Captions — see `captions.srt` (one cue per beat, synced to the table above)

### Assembly / editing instructions

Layer order (bottom to top): **background clip → caption burn-in → end-card
text (SAVE beat only) → audio (VO + music bed, VO ducked 0 dB, music bed −18 dB
under VO, music alone during the freeze)**.

1. Generate/source the 6 beat clips at the timings above (each clip trimmed to
   its exact beat duration — no clip should run long and get cut mid-motion).
2. Hard-cut between beats (no cross-dissolve) — matches the render-integrity
   gate's motion-proof check (`reelAssembly.ts` "#800/#801": ≥3 distinct MD5s
   among 5 sampled frames). A cross-fade over static content risks reading as
   near-duplicate frames; a hard cut does not.
3. Append a 3-second freeze on beat 6's final frame for the SAVE card — this
   matches the pipeline's own storyboard contract (beats + 3s freeze).
4. Burn in captions per `captions.srt`, bottom-third safe area, high-contrast
   white-on-black-outline text, sized for 9:16 mobile viewing.
5. On the freeze frame only, overlay: "Nick's Tire & Auto — Save this for next
   time" in the shop's brand type, centered, safe margins for IG/TikTok UI
   chrome (bottom ~220px, top ~120px keep-clear).
6. Audio: VO track first (drives pacing), a royalty-free ambient/light
   percussion bed underneath (see rights note below), no sound effects that
   could mask the VO.
7. **ffmpeg equivalent** (six pre-trimmed beat clips `b1.mp4`…`b6.mp4`,
   VO `vo.wav`, music `bed.mp3`):
   ```
   ffmpeg -i "concat:b1.mp4|b2.mp4|b3.mp4|b4.mp4|b5.mp4|b6.mp4" \
     -vf "tpad=stop_mode=clone:stop_duration=3,subtitles=captions.srt:force_style='Alignment=2,Outline=2'" \
     -i vo.wav -i bed.mp3 \
     -filter_complex "[1:a]volume=1.0[voA];[2:a]volume=0.15[bedA];[voA][bedA]amix=inputs=2:duration=longest[aout]" \
     -map 0:v -map "[aout]" -r 30 -s 1080x1920 -c:v libx264 -pix_fmt yuv420p -shortest out.mp4
   ```
   (Re-encode each beat to a common 1080x1920/30fps before concat if sources
   differ — `concat` demuxer requires matching codecs/params.)
8. **CapCut equivalent**: import 6 clips to timeline in order → trim each to
   its beat duration → duplicate/freeze last frame of clip 6 for 3s → add VO
   audio track, then music track ducked under it → auto-captions (or import
   `captions.srt`) → style captions bottom-third, white/black-outline → add end
   card text on the freeze segment only → export 1080x1920, 30fps, H.264.

### Render-integrity self-check (for whoever renders this)

Verify before treating the export as finished: container duration ≈43s (±0.75s),
video-stream duration matches (don't trust container duration alone — an audio
track that outlasts a truncated video track hides this), ≥80% of the expected
30fps frame count present, and motion is real (sample 5 frames, expect ≥3
distinct MD5s — a static hold longer than the one intentional 3s freeze fails
this).

## 5. Credit-risk and fallback routing

No generation call was made this run — $0 spent, no `generationLedger.ts`
reservation created. If rendered through the live pipeline:
- Prod-pinned route is `REEL_VIDEO_PROVIDER=template_stock` (per
  `docs/operations/REEL-PIPELINE.md`, verified 2026-08-11) — the free local
  ffmpeg lane, **$0** per `COST_ESTIMATES_USD.template_stock_clip`.
- If ever switched to the paid Higgsfield/Seedance lane: 6 beats ×
  `seedance_clip` ($0.25, labeled an ASSUMPTION in `generationLedger.ts`) ≈
  **$1.50 estimated**, well under the `maxGenerationCostPerDayUsd` ($10) policy
  cap either way.
- `REEL_FALLBACK_TO_TEMPLATE_STOCK` is not relevant here since `template_stock`
  is already the primary pinned route, not a fallback.
- Actual Higgsfield account balance: **UNKNOWN** — `getHiggsfieldAccountHealth()`
  was not called (no credentials in this session); do not treat this pack's
  estimate as a live price quote.

## 6. Audio / music rights — real gap, not papered over

No music-rights ledger exists in this repo (confirmed absence, per the
reel-operator skill). This pack recommends a bed but **does not** assert any
license is cleared. Track selection, license scope, territory, and
organic-vs-ad clearance are **UNKNOWN/BLOCKED** until the operator confirms a
cleared source (e.g., a licensed library the shop already has rights to, or
Meta's own royalty-free audio library at publish time inside Reels/Business
Suite, which carries its own in-platform license).

## 7. QA matrix

No render was produced this run (by design — no live credentials, and a
scheduled firing may not generate/spend/publish per the operator skill's hard
rule regardless of credentials), so every render-side QA gate is **N/A**, not
`PASS`:

| Gate | Status | Basis |
|---|---|---|
| Rendered QA / vision critic (`renderedQa.ts`) | N/A | no render produced |
| Repair routing (`repairRouter.ts`) | N/A | no render produced |
| 7-way automation decision (`qualityAutomation.ts`) | N/A | no render produced |
| Consolidated publish gate (`qualityGate.ts`) | N/A | no enqueue happened |
| Render-integrity gate (duration/frame-count/motion, `reelAssembly.ts`) | N/A | no file exists to probe |
| Brief-time quality score (`calculateReelQualityScore`, min 70/75) | Not run — no live `content.generateReelBrief` call made this session | client/server code path, not executed |

## 8. IG / FB copy + ad-ready variants

**Primary post copy:**
> AC blowing warm doesn't always mean you're out of Freon. Sometimes it means
> the system's built-in safety switch is doing exactly what it's supposed to.
> One clue isn't a diagnosis — stop by and we'll check it under pressure before
> anything gets added. 🔧🚗
> #ClevelandOhio #EuclidOhio #AutoRepair #CarAC #NicksTireAndAuto #CarCareTips

**Ad variant A** — hook: "Adding Freon to a warm AC might not fix anything."
Caption: shortened primary copy above. CTA: "Book a free AC check — link in bio."

**Ad variant B** — hook: "Your AC's 'broken' compressor might just be
protecting itself." Caption: same core message. CTA: "Stop by Nick's Tire &
Auto on Euclid Ave — no guesswork, just gauges."

Platform specs: 1080×1920 (9:16), 43s, MP4/H.264, captions burned in (also
attach `captions.srt` as a native caption file where the platform supports it).

## 9. Final status

**READY FOR HUMAN APPROVAL.** This is a complete script/prompt/caption/assembly/
copy pack, not a rendered file — no render or publish was attempted, per the
operator skill's hard rule for a scheduled, non-live firing. A human must
approve the concept, and someone with live Higgsfield/ffmpeg access and
`ADMIN_API_KEY` must run the actual render before this can move to `DRAFT` QA
or `PUBLISH`.
