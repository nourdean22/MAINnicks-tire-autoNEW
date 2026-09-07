# Reel pack — "Automatic headlights don't turn on at dusk — here's what's actually failing"

Produced by a **scheduled task** firing (2026-09-07), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read. This
pack is the deliverable — not an MP4.

## 1. Capability check (what this session actually has)

| Capability | Status | Evidence |
|---|---|---|
| ChatGPT | N/A — this session's own model wrote the script directly | — |
| TTS | Not connected in this session | No TTS tool in the available tool list |
| Higgsfield (render) | Not reachable from this session | `env \| grep -iE "REEL_\|HIGGSFIELD\|ADMIN_API_KEY\|DATABASE_URL"` returned nothing — no route to `/api/admin/reel-canary`, `getHiggsfieldAccountHealth()` requires the deployed server process |
| Meta posting | Not connected, and posting is a protected operation regardless | root `AGENTS.md` protected-operations list: social publishing requires an explicit live operator instruction, never a scheduled trigger |
| Shell / render (ffmpeg) | Bash is available, but there is no source footage/VO audio to composite | — |
| CapCut | Not connected | — |

Per the reel-operator skill's "Producing a pack when the motion route is unavailable" section, the
correct output here is a full production-ready pack, not a silently-downgraded stills asset.

**Provider/env context (from `apps/nickstire/docs/operations/REEL-PIPELINE.md`, not re-verified
live this run):** prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (free local ffmpeg
lane), not Higgsfield.

## 2. Repetition check (real read, not the live ledger)

This session did not query `reelRepetitionHistory.ts` / the `reel_jobs` table (prod TiDB — avoided
per `prod-db-guard`). As a proxy:

- Listed every pack directory under `apps/nickstire/docs/reel-packs/` (150+ packs, 2026-08-14
  through 2026-09-07). No title covers automatic-headlight sensor/relay failure. The closest
  neighbor, `2026-08-20-cloudy-headlights`, covers lens haze/oxidation — a cosmetic-visibility
  topic, not why the lights fail to switch on at all. Different failure mechanism, different
  driver question.
- Checked open PRs with `is:pr is:open "reel pack" in:title`: only #2153, a backlog-status doc PR
  with no new pack attached — no collision.
- Three other packs were already produced today (2026-09-07): `steering-wheel-locked-key-wont-turn`,
  `tpms-light-wont-clear-after-refill`, `wheel-stud-snapped`. None overlaps this topic.

**Flag for the operator, not silently absorbed:** this is now the **fourth** pack generated today
and the **151st+** overall against a real posting cap of 2 feed posts/day
(`RESERVATION_FEED_CAP`). The 2026-09-06 and 2026-09-07 (wheel-stud) packs already raised this same
flag with no visible response in the repo. Continued scheduled firing is manufacturing supply far
past what the pipeline's own guardrails allow it to post — worth the operator either pausing the
schedule, widening the daily feed cap, or pointing a downstream process at this backlog. Producing
this pack anyway, per the scheduled task's own instructions, but the flag stands and is now
repeated for a third consecutive day.

## 3. Concept scoring (0-5 per dimension, spec shape)

| Dimension | Score | Why |
|---|---|---|
| Scroll-stop (first frame) | 4 | Dusk-lit parking lot, a car with dark headlights next to one with lights on — a visibly "wrong" image that reads without audio |
| Muted-first clarity | 5 | Every beat carries on-screen text; fully legible on silent autoplay |
| Sourced-fact grounding | 3 | The mechanical claim (photocell/light sensor, ambient-light relay, and auto-headlight module are the real failure points, not the bulb itself) is general automotive knowledge, not a `businessFacts`/`EvidenceRecord` row in this repo — see §4, `UNKNOWN` for repo-sourced evidence, not for correctness |
| Claim safety | 4 | Uses only approved soft language (`worth checking`, `stop by and we'll take a look`); no price, no guarantee, no diagnosis-as-verdict |
| Faceless compliance | 5 | No human face/hand/limb as the acting subject in any beat |
| Keyword relevance | 4 | "automatic headlights not turning on," "headlights won't come on at night," "auto headlight sensor" are real, searched driver questions |
| Winning-concept composite | 4.2/5 | Selected — see full storyboard below |

## 4. Claim evidence

- **Repo-sourced business facts used:** shop identity only —
  `"Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112,
  (216) 862-0005"` (`server/services/businessFacts.ts` `SEED_FACTS`, `legal.entity` key). No
  pricing, warranty, or hours facts were needed or used.
- **Mechanical claims (a dead ambient-light sensor/photocell, a stuck auto-headlight relay, or a
  failed body-control-module input can all leave headlights dark even with good bulbs; manually
  toggling the switch to "on" instead of "auto" is the fastest way to confirm it's not the bulb):**
  `UNKNOWN` against this repo's evidence stores — there is no `EvidenceRecord` in
  `evidenceRecords.ts` covering automatic-headlight sensor failure, and `FactChannel`
  (`sms | voice | web`) has no `"reel"`/`"social"` scope yet, per the reel-operator skill's
  documented gap. These are well-established general automotive facts, not currently backed by a
  repo evidence row — flagged, not silently asserted as repo-verified.
- **Safety framing note:** this topic touches nighttime visibility, a safety-relevant system. The
  script explicitly tells the viewer the fastest safe workaround (manual "on" instead of "auto")
  before framing it as a shop visit, and avoids any fabricated failure timeline or severity claim.
- **No local/weather/event claims** are made in this script.

## 5. Full production pack

### Format contract (from `client/src/lib/facelessReelStudio.ts` `REEL_OUTPUT_RULES`)
15-22s storyboard + a 3s SAVE freeze card = ~18-25s final container · 1080x1920 · H.264 MP4 ·
yuv420p · 30fps · faststart · faceless (no human face/hand/limb as the acting subject).

### Storyboard — 5 beats (18s) + 3s freeze = 21s final

| Beat | Time | Visual (Higgsfield-style prompt) | On-screen text (ffmpeg overlay, NOT rendered by the video model) |
|---|---|---|---|
| 1 | 0-3s | Dusk parking lot, static wide shot: two cars parked side by side, one with headlights lit, one completely dark, ambient blue-hour light falling fast. No hands, no face. | "Your headlights are set to 'auto' — and they're still not turning on?" |
| 2 | 3-7s | Macro, rack focus: a dashboard headlight switch dial resting on the "AUTO" position, soft interior glow, static camera. | "Before you blame the bulb — 'auto' relies on a light sensor, not the bulb itself." |
| 3 | 7-11s | Macro on a small sensor housing near the base of the windshield/dash top, shallow depth of field, slow push-in. | "That sensor (or a stuck relay behind it) is what tells the car it's dark out." |
| 4 | 11-15s | Interior macro, rack focus from the headlight switch dial turning past "AUTO" toward "ON," static camera, no hand visible — dial framed alone. | "Fastest safe check: switch to 'ON' manually. Lights work? It's the sensor, not the bulb." |
| 5 | 15-18s | Wide shot: car exterior at dusk, headlights now lit, engine bay hood open in the background at a shop bay (prop framing only, no hand in frame). | "A dead sensor or relay is a quick diagnosis — not a guessing game." |
| SAVE | 18-21s | Static end card: shop exterior/sign or logo card, warm lighting, no motion required beyond ambient. | "Stop by and we'll take a look — Nick's Tire & Auto, 17625 Euclid Ave, Cleveland · (216) 862-0005" |

Standing negative prompt for every generative beat (per the reel-operator skill's faceless
contract): `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`.

### Voiceover (word-for-word, timed to seconds)

```
[0.0–3.0]   "Headlights set to 'auto,' and they're still not coming on at dusk?"
[3.0–7.0]   "Before you blame the bulb — 'auto' mode runs off a light sensor, not the bulb itself."
[7.0–11.0]  "A dead sensor, or a stuck relay behind it, is what tells your car it's dark outside."
[11.0–15.0] "Fastest safe check: flip the switch to 'ON' manually. If they light up, it's the sensor — not the bulb."
[15.0–18.0] "A dead sensor or relay is a quick diagnosis — not a guessing game."
[18.0–21.0] "Nick's Tire and Auto — stop by and we'll take a look."
```

~85 words total across 21s (~4.0 words/sec) — brisk but clear for a faceless-reel VO, in line with
prior packs' pacing.

### Asset list

**If `REEL_VIDEO_PROVIDER=higgsfield` is ever re-armed:** use the per-beat prompts above with
Seedance 1.5, 9:16, 4s clips, one hero frame (`REEL_IMAGE_CONDITIONING`, beat 1's first frame) as
`--start-image` for continuity, per the reel-operator skill.

**Given prod currently pins `template_stock` (free ffmpeg lane):** source CC0/royalty-free stock
matching each beat instead of generating:
- Beat 1: dusk parking lot, two cars, one lit one dark (Pexels/Pixabay, search "car headlights dusk
  parking lot" or "twilight parked cars")
- Beat 2: dashboard headlight switch macro (search "car headlight switch dial" or "dashboard auto
  headlight control")
- Beat 3: windshield-base sensor macro (search "car light sensor windshield" or "auto headlight
  sensor dash" — screen candidates to confirm no stray hands/faces, per the faceless contract)
- Beat 4: same dashboard switch dial, different angle/rack-focus (reuse or re-shoot beat 2's prop
  setup)
- Beat 5: wide dusk exterior shot, headlights lit, shop bay in background (shop's own past
  photography if available, to avoid a stock mismatch on the CTA card)
- SAVE: shop press-tool station macro / shop bay wide shot + Nick's Tire & Auto exterior/signage

**Music:** no cleared track exists for this pack. Per the reel-operator skill, this repo has **no
music-rights ledger** — do not treat any track as cleared. Options to hand the operator, all
unlicensed pending clearance: a calm, low-key instrumental bed (royalty-free library of the
operator's choice) ducked under VO, or VO-only with light room-tone. **Status: `BLOCKED` pending an
actual licensed asset ID.**

### Caption file

See `captions.srt` in this directory — timed to the VO block above.

### Editing / assembly instructions (ffmpeg, matching the render-integrity contract)

1. Trim/concat the 5 beat clips in order (0-3, 3-7, 7-11, 11-15, 15-18s) with a short
   (~0.25-0.4s) crossfade between adjacent beats — matches the storyboard's `xfade` step in the real
   assembly pipeline (`reelAssembly.ts`).
2. Append the 3s static SAVE/end-card frame after beat 5 (no crossfade needed into a static card).
3. Burn in on-screen text per beat (or soft-subtitle via the SRT) — center-safe within the 9:16
   frame, large enough to read at thumbnail size, matching muted-first clarity.
4. Mux VO audio starting at 0.0s; duck any music bed under VO by ~8-10dB during speech.
5. Encode: `ffmpeg -i concat_list.txt -i vo.wav -c:v libx264 -pix_fmt yuv420p -r 30
   -c:a aac -shortest -movflags +faststart out.mp4` (matches `REEL_OUTPUT_RULES`: H.264, yuv420p,
   30fps, faststart, 1080x1920 — set `-vf scale=1080:1920` if source plates differ).
6. QA before calling it done: confirm container duration ≈21s (±0.75s), video-stream duration
   matches (not just the audio track), and sample 5 frames across the file to confirm real motion
   (not a static loop) — same checks `reelAssembly.ts`'s render-integrity gate runs.

### IG/FB copy + two ad-ready variants

**Primary caption:**
> Headlights set to "auto" and they're still dark at dusk? It's usually not the bulb — it's the
> light sensor or the relay behind it that tells your car it's dark out. Fastest safe check: flip
> the switch to "ON" manually. If they light up, that confirms it. 🔧 Nick's Tire & Auto, 17625
> Euclid Ave, Cleveland — stop by and we'll take a look.
> #ClevelandAutoRepair #EuclidOhio #CarMaintenanceTips #NicksTireAndAuto #AutoRepairShop
> #FaceOfCleveland #TireShop #CarCare101 #NortheastOhio #NightDriving

**Ad variant A (hook/caption/CTA):**
- Hook: "Your headlights aren't broken — your sensor might be."
- Caption: Same core facts, shortened for a paid placement — auto mode relies on a sensor/relay,
  not the bulb; manual "ON" is the fastest safe check.
- CTA: "Stop by Nick's Tire & Auto on Euclid Ave — we'll take a look, no guesswork."

**Ad variant B (hook/caption/CTA):**
- Hook: "Before you buy new bulbs, try this one switch."
- Caption: Same facts, framed as a quick DIY test that saves an unnecessary bulb purchase, with a
  shop visit offered if the manual switch doesn't fix it.
- CTA: "Still dark after the manual switch? Call (216) 862-0005 or stop in."

## 6. Credit-risk and fallback routing

No `RESERVE`/`SETTLE` ledger entry was created — this run made no generation call, so there is no
`generationLedger.ts` cost to report against `maxGenerationCostPerDayUsd`. If this pack is later run
through the real pipeline: at `template_stock_clip: $0` (free ffmpeg lane, current prod pin) the
estimated cost is **$0.00**; if switched to `seedance_clip` (`$0.25`/clip, ASSUMPTION per the source
comment) for 5 beats, estimated cost is **~$1.25**, well under the $10/day cap — but that estimate
is not a metered price, per the reel-operator skill's documented gap.

## 7. Audio/music rights status

`BLOCKED` — no music-rights ledger exists in this repo (documented gap in `nickstire-reel-operator`).
No track is cleared for this pack; see "Music" above.

## 8. QA matrix

| Gate | Result | Backing |
|---|---|---|
| Beat count (4-6) | `PASS` | 5 beats, matches `REEL_OUTPUT_RULES.minBeats`/`maxBeats` (4/6) |
| Length band (15-22s storyboard) | `PASS` | Storyboard ends at 18s |
| Muted-first clarity | `PASS` | Every beat carries on-screen text |
| Faceless compliance | `PASS` (design-time only) | No face/hand/limb subject in any beat description; **not** verified against a rendered frame — no render occurred |
| Claim safety | `PASS` | Script uses only approved soft-language phrases; no price/guarantee/verdict language; includes a safe manual-check step before framing a shop visit |
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

**Operator note (repeated flag, third consecutive day):** the pack backlog has grown to 150+
directories against a 2-posts/day cap. Consider pausing or slowing the schedule that fires this
skill, or wiring a process to consume the backlog, before more supply accumulates unused.
