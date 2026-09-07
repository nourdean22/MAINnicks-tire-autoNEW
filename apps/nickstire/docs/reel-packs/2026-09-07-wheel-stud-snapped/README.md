# Reel pack — Snapped Wheel Stud: Why "Just a Loose Lug Nut" Might Not Be

Mode: `INTELLIGENCE` (research + score + production-ready pack). No render, no spend, no
publish action was taken — this session has no live operator authorization for those and no
connected render/TTS/publish tool. See "Capability status" below.

## 1. Capability check (what this session actually has)

| Capability | Status | Evidence |
|---|---|---|
| ChatGPT | N/A — this session's own model wrote the script directly | — |
| TTS | Not connected in this session | No TTS tool in the available tool list |
| Higgsfield (render) | Not reachable from this session | No `ADMIN_API_KEY`/route to `/api/admin/reel-canary`; `getHiggsfieldAccountHealth()` was not called — it requires the deployed server process, not available here |
| Meta posting | Not connected, and posting is a protected operation regardless | `AGENTS.md` protected-operations list: social publishing requires explicit live operator instruction, never a scheduled trigger |
| Shell / render (ffmpeg) | Bash is available, but there is no source footage/VO audio to composite — running ffmpeg against placeholder assets would not produce a usable shop asset | — |
| CapCut | Not connected | — |

This is a **scheduled/automated firing** (stored prompt, no live operator watching). Per the
reel-operator skill's hard rule, that alone rules out `PUBLISH` regardless of what else is
connected. Per the task's own rule 5 ("do not claim a finished file exists unless rendered"),
this pack is the deliverable — not an MP4.

**Provider/env context (from `apps/nickstire/docs/operations/REEL-PIPELINE.md`, not re-verified
live this run):** prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (free local ffmpeg
lane), not Higgsfield — so even a fully wired run today renders from stock/template clips, not
generated video. Treat that doc line as current-truth-adjacent, not re-confirmed against a live
env read this run (this session's shell has no `REEL_VIDEO_PROVIDER`/`ADMIN_API_KEY`/
`DATABASE_URL` set at all).

## 2. Repetition check (real read, not the live ledger)

This session did not query `reelRepetitionHistory.ts` / the `reel_jobs` table (prod TiDB —
avoided per `prod-db-guard`; a DB read from this environment would hit production). As a proxy:

- Listed every existing pack directory under `apps/nickstire/docs/reel-packs/` (145+ packs,
  2026-08-14 through 2026-09-06) — no title mentions a wheel stud, sheared/snapped stud, or a
  loose-lug-nut-that-keeps-loosening angle. Closest neighbors (`lug-nut-retorque`,
  `steering-wheel-crooked-after-tires`, `pothole-damage`, `tie-rod-steering-wobble-test`) cover a
  different mechanism (torque spec / alignment / tie-rod play), not a broken stud itself.
- Checked open PRs with `is:pr is:open "reel pack" in:title`: two are in flight from today,
  **#2149** ("TPMS light won't clear after refill") and **#2150** ("steering wheel locked, key
  won't turn") — neither overlaps this topic.

**Flag for the operator, not silently absorbed:** the pack directory now holds 145+ dated packs
going back three-plus weeks against a real posting cap of 2 feed posts/day
(`RESERVATION_FEED_CAP`). Unless something downstream is actively consuming this backlog,
continued daily pack generation is manufacturing supply well past what the pipeline's own
guardrails allow it to post. This is the same flag raised in the 2026-09-06 pack; it still holds.

## 3. Concept scoring (0-5 per dimension, spec shape)

| Dimension | Score | Why |
|---|---|---|
| Scroll-stop (first frame) | 4 | Macro on a wheel with a visibly loose/missing lug nut is a recognizable "something's wrong here" image that reads without audio |
| Muted-first clarity | 5 | Every beat carries on-screen text; fully legible on silent autoplay |
| Sourced-fact grounding | 3 | The mechanical claim (studs shear from age/rust/over-torque, fewer studs = uneven clamping load) is general automotive knowledge, not a `businessFacts`/`EvidenceRecord` row in this repo — see §4, marked `UNKNOWN` for repo-sourced evidence, not for correctness |
| Claim safety | 4 | Uses only approved soft language (`worth checking`, `stop by and we'll take a look`); no price, no guarantee, no diagnosis-as-verdict — scored one point below a 5 because this topic is safety-adjacent (wheel retention) and needs the extra qualifier discipline called out in §4 |
| Faceless compliance | 5 | No human face/hand/limb as the acting subject in any beat — beat 5 frames the press/tool station itself, not a hand operating it |
| Keyword relevance | 4 | "wheel stud broken," "lug nut keeps loosening," "wheel vibration after pothole" are real, searched driver questions |
| Winning-concept composite | 4.2/5 | Selected — see full storyboard below |

## 4. Claim evidence

- **Repo-sourced business facts used:** shop identity only —
  `"Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112,
  (216) 862-0005"` (`server/services/businessFacts.ts` `SEED_FACTS`, `legal.entity` key). No
  pricing, warranty, or hours facts were needed or used.
- **Mechanical claims (studs shear from age/rust/over-torque, potholes accelerate a weak stud,
  fewer studs load the remaining ones unevenly):** `UNKNOWN` against this repo's evidence
  stores — there is no `EvidenceRecord` in `evidenceRecords.ts` covering wheel-stud failure, and
  `FactChannel` (`sms | voice | web`) has no `"reel"`/`"social"` scope yet, per the reel-operator
  skill's documented gap. These are well-established general automotive facts, but they are
  **not** currently backed by a repo evidence row — flagged, not silently asserted as
  repo-verified.
- **Safety framing note:** this topic touches wheel retention, a safety-critical system. The
  script deliberately avoids a specific failure timeline or severity claim ("could come off in
  X miles") and sticks to the approved soft-language pattern bank — informative, not alarmist,
  no fabricated urgency.
- **No local/weather/event claims** are made in this script.

## 5. Full production pack

### Format contract (from `client/src/lib/facelessReelStudio.ts` `REEL_OUTPUT_RULES`)
15-22s storyboard + a 3s SAVE freeze card = ~18-25s final container · 1080x1920 · H.264 MP4 ·
yuv420p · 30fps · faststart · faceless (no human face/hand/limb as the acting subject).

### Storyboard — 5 beats (18s) + 3s freeze = 21s final

| Beat | Time | Visual (Higgsfield-style prompt) | On-screen text (ffmpeg overlay, NOT rendered by the video model) |
|---|---|---|---|
| 1 | 0-3s | Macro, shallow depth of field: a wheel rim close-up where one lug nut is visibly loose or missing from its seat, harsh directional shop light, static camera with a slow push-in. No hands, no face. | "One lug nut keeps coming loose — again?" |
| 2 | 3-7s | Undercarriage/hub macro shot, rack focus pulling from a wheel hub into sharp focus on a sheared stud stub where a lug should thread on. | "It might not be the nut. It might be a broken stud." |
| 3 | 7-11s | Macro of a lug pattern with a torque wrench resting nearby (static prop, not in use), slow pan across the remaining studs to show uneven spacing. | "Studs shear from age, rust, or being over-torqued — a pothole can finish the job." |
| 4 | 11-15s | Wide shot: car on a lift, wheel slowly rotating, a subtle wobble/vibration visual cue on the rim. | "Fewer studs means the wheel isn't clamped evenly anymore." |
| 5 | 15-18s | Macro, static rack-focus shot: a hub-and-stud assembly on a shop press-fit tool station (machine framing only, no hand in frame), warm tungsten light. | "Caught early, it's a quick fix — not a guessing game." |
| SAVE | 18-21s | Static end card: shop exterior/sign or logo card, warm lighting, no motion required beyond ambient. | "Stop by and we'll take a look — Nick's Tire & Auto, 17625 Euclid Ave, Cleveland · (216) 862-0005" |

Standing negative prompt for every generative beat (per the reel-operator skill's faceless
contract): `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`.

### Voiceover (word-for-word, timed to seconds)

```
[0.0–3.0]   "One lug nut keeps loosening up, no matter how many times you tighten it?"
[3.0–7.0]   "Sometimes it's not the nut — it's a wheel stud that's actually snapped."
[7.0–11.0]  "Studs shear from age, rust, or being over-torqued before — and a pothole can finish the job."
[11.0–15.0] "Fewer studs means the wheel isn't clamped evenly, and it can work loose over time."
[15.0–18.0] "Caught early, a snapped stud is a quick fix — worth checking before it gets worse."
[18.0–21.0] "Nick's Tire and Auto — stop by and we'll take a look."
```

~80 words total across 21s (~3.8 words/sec) — brisk but clear for a faceless-reel VO, in line
with prior packs' pacing.

### Asset list

**If `REEL_VIDEO_PROVIDER=higgsfield` is ever re-armed:** use the per-beat prompts above with
Seedance 1.5, 9:16, 4s clips, one hero frame (`REEL_IMAGE_CONDITIONING`, beat 1's first frame) as
`--start-image` for continuity, per the reel-operator skill.

**Given prod currently pins `template_stock` (free ffmpeg lane):** source CC0/royalty-free stock
matching each beat instead of generating:
- Beat 1: macro wheel/rim + lug nut close-up (Pexels/Pixabay, search "car wheel lug nut macro"
  or "alloy wheel close up")
- Beat 2: undercarriage / wheel hub macro (search "car wheel hub close up" or "brake rotor hub
  macro" — screen candidates to make sure no stray hands/faces appear, per the faceless contract)
- Beat 3: lug pattern + torque wrench prop shot (search "torque wrench lug nuts" — static/prop
  framing only)
- Beat 4: wide shot, car on a lift with a wheel off the ground (search "car on lift wheel" or
  "mechanic lift undercarriage")
- Beat 5 / SAVE: shop press-tool station macro + shop bay wide shot + Nick's Tire & Auto
  exterior/signage (shop's own past photography if available, to avoid a stock mismatch on the
  CTA card)

**Music:** no cleared track exists for this pack. Per the reel-operator skill, this repo has **no
music-rights ledger** — do not treat any track as cleared. Options to hand the operator, all
unlicensed pending clearance: a calm, low-key instrumental bed (royalty-free library of the
operator's choice) ducked under VO, or VO-only with light room-tone. **Status: `BLOCKED` pending
an actual licensed asset ID.**

### Caption file

See `captions.srt` in this directory — timed to the VO block above.

### Editing / assembly instructions (ffmpeg, matching the render-integrity contract)

1. Trim/concat the 5 beat clips in order (0-3, 3-7, 7-11, 11-15, 15-18s) with a short
   (~0.25-0.4s) crossfade between adjacent beats — matches the storyboard's `xfade` step in the
   real assembly pipeline (`reelAssembly.ts`).
2. Append the 3s static SAVE/end-card frame after beat 5 (no crossfade needed into a static
   card).
3. Burn in on-screen text per beat (or soft-subtitle via the SRT) — center-safe within the 9:16
   frame, large enough to read at thumbnail size, matching muted-first clarity.
4. Mux VO audio starting at 0.0s; duck any music bed under VO by ~8-10dB during speech.
5. Encode: `ffmpeg -i concat_list.txt -i vo.wav -c:v libx264 -pix_fmt yuv420p -r 30
   -c:a aac -shortest -movflags +faststart out.mp4` (matches `REEL_OUTPUT_RULES`: H.264,
   yuv420p, 30fps, faststart, 1080x1920 — set `-vf scale=1080:1920` if source plates differ).
6. QA before calling it done: confirm container duration ≈21s (±0.75s), video-stream duration
   matches (not just the audio track), and sample 5 frames across the file to confirm real
   motion (not a static loop) — same checks `reelAssembly.ts`'s render-integrity gate runs.

### IG/FB copy + two ad-ready variants

**Primary caption:**
> Lug nut that just won't stay tight, no matter how many times it's torqued? It might not be
> the nut — it could be a wheel stud that's sheared. Fewer studs means the wheel isn't clamped
> evenly, and that's worth catching early, not guessing about. 🔧 Nick's Tire & Auto, 17625
> Euclid Ave, Cleveland — stop by and we'll take a look.
> #ClevelandAutoRepair #EuclidOhio #WheelSafety #CarMaintenanceTips #NicksTireAndAuto
> #AutoRepairShop #FaceOfCleveland #TireShop #CarCare101 #NortheastOhio

**Ad variant A (hook/caption/CTA):**
- Hook: "A lug nut that keeps loosening isn't always the nut's fault."
- Caption: Same core facts, shortened for a paid placement — sheared stud, uneven clamping,
  worth a check before it's a bigger job.
- CTA: "Stop by Nick's Tire & Auto on Euclid Ave — we'll take a look, no guesswork."

**Ad variant B (hook/caption/CTA):**
- Hook: "One missing lug nut. One bigger question underneath it."
- Caption: Same facts, framed as a myth-bust (a loose nut can be a symptom, not the cause).
- CTA: "Questions about a wheel that doesn't feel right? Call (216) 862-0005 or stop in."

## 6. Credit-risk and fallback routing

No `RESERVE`/`SETTLE` ledger entry was created — this run made no generation call, so there is no
`generationLedger.ts` cost to report against `maxGenerationCostPerDayUsd`. If this pack is later
run through the real pipeline: at `template_stock_clip: $0` (free ffmpeg lane, current prod pin)
the estimated cost is **$0.00**; if switched to `seedance_clip` (`$0.25`/clip, ASSUMPTION per the
source comment) for 5 beats, estimated cost is **~$1.25**, well under the $10/day cap — but that
estimate is not a metered price, per the reel-operator skill's documented gap.

## 7. Audio/music rights status

`BLOCKED` — no music-rights ledger exists in this repo (documented gap in
`nickstire-reel-operator`). No track is cleared for this pack; see "Music" above.

## 8. QA matrix

| Gate | Result | Backing |
|---|---|---|
| Beat count (4-6) | `PASS` | 5 beats, matches `REEL_OUTPUT_RULES.minBeats`/`maxBeats` (4/6) |
| Length band (15-22s storyboard) | `PASS` | Storyboard ends at 18s |
| Muted-first clarity | `PASS` | Every beat carries on-screen text |
| Faceless compliance | `PASS` (design-time only) | No face/hand/limb subject in any beat description; **not** verified against a rendered frame — no render occurred |
| Claim safety | `PASS` | Script uses only approved soft-language phrases; no price/guarantee/verdict language; safety-adjacent topic deliberately avoids a fabricated failure timeline |
| Sourced-fact evidence (repo `EvidenceRecord`) | `UNKNOWN` | No matching row exists; claims are general automotive knowledge, not repo-sourced |
| Render-integrity (container/frame-motion check) | `BLOCKED` — not applicable | No file was rendered this run |
| Rendered QA / vision critic (`renderedQa.ts`) | `BLOCKED` — not applicable | No file was rendered this run |
| Repetition (7-day topic repeat) | `PASS` (directory-proxy only) | No existing pack title or open reel-pack PR matches this topic; live `reel_jobs` ledger was not queried (prod-DB avoidance) |
| Publish gate (`evaluateReelPublishGate`) | `BLOCKED` — not applicable | No publish action was attempted or authorized |

## 9. Final status

**READY FOR HUMAN APPROVAL.** This is a complete production-ready pack, not a rendered file — no
render/TTS/Higgsfield/Meta-posting tool was connected in this session, and even if one had been,
this run has no live operator instruction authorizing spend or publish (a scheduled/automated
firing, per the reel-operator skill's hard rule, is explicitly the case that rule blocks from
`PUBLISH`). Manual steps still required, explicitly:
- Render the storyboard (Higgsfield or sourced stock per §5) — "Render in the reel pipeline /
  CapCut."
- Record or generate VO audio — "Needs TTS or a human voiceover pass."
- Clear a music bed — "Needs an actual licensed track; currently `BLOCKED`."
- Human review + `evaluateReelPublishGate` pass before any publish — "Post via the admin Queue
  tab's Approve step, then `instagramAdmin.publishPost` — never automatically."
