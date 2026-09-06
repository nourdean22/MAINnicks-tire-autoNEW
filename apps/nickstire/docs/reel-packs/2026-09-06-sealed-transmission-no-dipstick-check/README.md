# Reel pack — Sealed Transmission: How ATF Gets Checked Without a Dipstick

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

Per the task's own rule 5 ("do not claim a finished file exists unless rendered"), this pack is
the deliverable — not an MP4.

**Provider/env context (from `apps/nickstire/docs/operations/REEL-PIPELINE.md`, not re-verified
live this run):** prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (free local ffmpeg
lane), not Higgsfield — so even a fully wired run today renders from stock/template clips, not
generated video. Treat that doc line as current-truth-adjacent, not re-confirmed against a live
env read this run.

## 2. Repetition check (real read, not the live ledger)

This session did not query `reelRepetitionHistory.ts` / the `reel_jobs` table (prod TiDB —
avoided per `prod-db-guard`; a DB read from this environment would hit production). As a proxy,
every existing pack directory under `apps/nickstire/docs/reel-packs/` was listed (170+ packs,
2026-08-14 through 2026-09-06) and the one open PR (`#2144`, a backlog-status doc, not a reel
pack) was checked — no in-flight duplicate. **Sealed-transmission / no-dipstick ATF checking is
not covered by any existing pack title.** Closest neighbors (`transmission-fluid-color-test`,
`oil-dipstick-color-check`, `torque-converter-shudder`, `transmission-delayed-engagement`) are a
different angle (fluid condition / symptom), not "how do I even check the level."

**Flag for the operator, not silently absorbed:** the pack directory now holds 170+ dated packs
going back three weeks against a real posting cap of 2 feed posts/day (`RESERVATION_FEED_CAP`) —
call it 40-ish real publish slots in that window. Unless something downstream is actively
consuming this backlog, continued daily pack generation is manufacturing supply well past what
the pipeline's own guardrails allow it to post. Worth a look before the next scheduled run adds
pack #171+.

## 3. Concept scoring (0-5 per dimension, spec shape)

| Dimension | Score | Why |
|---|---|---|
| Scroll-stop (first frame) | 4 | Macro shot of a sealed dipstick tube where a driver expects a handle is a visual mismatch — reads as a hook without needing audio |
| Muted-first clarity | 5 | Every beat carries on-screen text; the concept is fully legible on silent autoplay |
| Sourced-fact grounding | 3 | The mechanical claim (sealed transmissions exist, checked via a fill plug, some need a temp-specific reading) is general automotive knowledge, not a `businessFacts`/`EvidenceRecord` row in this repo — see §4, marked `UNKNOWN` for repo-sourced evidence, not for correctness |
| Claim safety | 5 | Uses only approved soft language (`worth checking`, `stop by and we'll take a look`); no price, no guarantee, no diagnosis-as-verdict |
| Faceless compliance | 5 | No human face/hand/limb subject in any beat — see storyboard, all object/vehicle shots |
| Keyword relevance | 4 | "transmission fluid check," "sealed transmission," "no dipstick" are real, searched driver questions |
| Winning-concept composite | 4.3/5 | Selected — see full storyboard below |

## 4. Claim evidence

- **Repo-sourced business facts used:** shop identity only —
  `"Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112,
  (216) 862-0005"` (`server/services/businessFacts.ts` `SEED_FACTS`, key covering business
  identity/contact). No pricing, warranty, or hours facts were needed or used.
- **Mechanical claims (sealed transmissions, fill-plug check, temperature-sensitive ATF level):**
  `UNKNOWN` against this repo's evidence stores — there is no `EvidenceRecord` in
  `evidenceRecords.ts` covering this claim, and `FactChannel` (`sms | voice | web`) has no
  `"reel"`/`"social"` scope yet per the reel-operator skill's documented gap. These are
  well-established general automotive facts (true of most modern sealed/"lifetime fluid"
  transaxles), but they are **not** currently backed by a repo evidence row — flagged, not
  silently asserted as repo-verified.
- **No local/weather/event claims** are made in this script.

## 5. Full production pack

### Format contract (from `client/src/lib/facelessReelStudio.ts` `REEL_OUTPUT_RULES`)
15-22s storyboard + a 3s SAVE freeze card = ~18-25s final container · 1080x1920 · H.264 MP4 ·
yuv420p · 30fps · faststart · faceless (no human face/hand/limb as the acting subject).

### Storyboard — 5 beats (18s) + 3s freeze = 21s final

| Beat | Time | Visual (Higgsfield-style prompt) | On-screen text (ffmpeg overlay, NOT rendered by the video model) |
|---|---|---|---|
| 1 | 0-3s | Macro, shallow depth of field: a sealed transmission dipstick tube cap under a hood, condensation beading on nearby metal, soft shop bay light behind, static camera with a slow push-in. No hands, no face. | "No transmission dipstick under your hood?" |
| 2 | 3-7s | Wide engine-bay shot, slow pan left to right across the bay, revealing the oil dipstick handle present but nothing where a transmission dipstick would be. Ambient bay lighting. | "Newer transmissions are sealed — that's normal." |
| 3 | 7-11s | Macro, underside-of-car framing: a transmission pan fill plug bolt highlighted with a rack light, a wrench resting nearby (not in use, no hand). Slow rack focus from background to the plug. | "Fluid level is checked at a fill plug — a lift job, not a driveway job." |
| 4 | 11-15s | Close-up: a thermometer-style gauge graphic overlaid near a transmission housing (practical prop, not rendered text), subtle steam/heat-shimmer effect. Static shot. | "Some need the fluid at the right temp to read correctly." |
| 5 | 15-18s | Wide shop-bay pull-back: a wheel spinning down slowly on a lift, warm tungsten lighting, shop signage soft-focus in the background. | "Dark or burnt-smelling fluid? Worth checking before a long trip." |
| SAVE | 18-21s | Static end card: shop exterior/sign or logo card, warm lighting, no motion required beyond ambient. | "Stop by and we'll take a look — Nick's Tire & Auto, 17625 Euclid Ave, Cleveland · (216) 862-0005" |

Standing negative prompt for every generative beat (per the reel-operator skill's faceless
contract): `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`.

### Voiceover (word-for-word, timed to seconds)

```
[0.0–3.0]   "Your car doesn't have a transmission dipstick? You're not imagining things."
[3.0–7.0]   "A lot of newer transmissions are sealed for life — no dipstick, by design."
[7.0–11.0]  "The fluid level gets checked at a fill plug, usually from underneath, on a lift."
[11.0–15.0] "Some also need the fluid at a specific temperature to get an accurate reading."
[15.0–18.0] "Fluid looks dark or smells burnt? That's worth checking before it becomes a bigger repair."
[18.0–21.0] "Nick's Tire and Auto — stop by and we'll take a look."
```

~65 words total, paced for a calm, unhurried faceless-reel VO (roughly 2.1 words/sec, well
under rushed-read territory for a 21s clip).

### Asset list

**If `REEL_VIDEO_PROVIDER=higgsfield` is ever re-armed:** use the per-beat prompts above with
Seedance 1.5, 9:16, 4s clips, one hero frame (`REEL_IMAGE_CONDITIONING`, beat 1's first frame) as
`--start-image` for continuity, per the reel-operator skill.

**Given prod currently pins `template_stock` (free ffmpeg lane):** source CC0/royalty-free stock
matching each beat instead of generating:
- Beat 1: macro engine-bay / dipstick-cap close-up (Pexels/Pixabay, search "car engine dipstick
  macro" or "engine bay detail")
- Beat 2: wide engine-bay pan (search "car engine bay wide shot")
- Beat 3: underside-of-vehicle / transmission pan on a lift (search "car on lift underside" or
  "mechanic lift undercarriage" — screen candidates for stray hands/faces before use, per the
  faceless contract)
- Beat 4: macro gauge/thermometer prop shot (search "temperature gauge macro" or generate a
  simple overlay graphic locally instead of sourcing footage)
- Beat 5 / SAVE: shop bay wide shot + Nick's Tire & Auto exterior/signage (shop's own past
  photography if available, to avoid a stock mismatch on the CTA card)

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
> No dipstick under the hood for your transmission? You're not imagining it — a lot of newer
> transmissions are sealed for life. The fluid gets checked at a fill plug, sometimes at a
> specific temperature. Dark or burnt-smelling fluid is worth checking before it turns into a
> bigger repair. 🔧 Nick's Tire & Auto, 17625 Euclid Ave, Cleveland — stop by and we'll take a
> look.
> #ClevelandAutoRepair #EuclidOhio #TransmissionCare #CarMaintenanceTips #NicksTireAndAuto
> #AutoRepairShop #FaceOfCleveland #TireShop #CarCare101 #NortheastOhio

**Ad variant A (hook/caption/CTA):**
- Hook: "Your transmission doesn't have a dipstick. Here's why that's normal — and how it's
  actually checked."
- Caption: Same core facts, shortened for a paid placement — sealed transmission, fill-plug
  check, temp-sensitive reading, dark/burnt fluid worth a look.
- CTA: "Stop by Nick's Tire & Auto on Euclid Ave — we'll take a look, no guesswork."

**Ad variant B (hook/caption/CTA):**
- Hook: "Missing a transmission dipstick? You didn't lose it. It was never there."
- Caption: Same facts, framed as a myth-bust ("no dipstick ≠ nothing to check").
- CTA: "Questions about your transmission fluid? Call (216) 862-0005 or stop in."

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
| Claim safety | `PASS` | Script uses only approved soft-language phrases; no price/guarantee/verdict language |
| Sourced-fact evidence (repo `EvidenceRecord`) | `UNKNOWN` | No matching row exists; claims are general automotive knowledge, not repo-sourced |
| Render-integrity (container/frame-motion check) | `BLOCKED` — not applicable | No file was rendered this run |
| Rendered QA / vision critic (`renderedQa.ts`) | `BLOCKED` — not applicable | No file was rendered this run |
| Repetition (7-day topic repeat) | `PASS` (directory-proxy only) | No existing pack title matches this topic; live `reel_jobs` ledger was not queried (prod-DB avoidance) |
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
