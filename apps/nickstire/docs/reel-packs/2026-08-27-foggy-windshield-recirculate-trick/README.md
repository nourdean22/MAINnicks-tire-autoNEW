# Reel pack — foggy windshield, recirculate-button trick

**Mode:** SCHEDULED (this run) — read-only intelligence + production pack only. No live operator
instruction was present for this firing, so nothing was rendered, generated, or published. Per
the hard rule in `.claude/skills/nickstire-reel-operator/SKILL.md`, a scheduled firing is exactly
the case that is blocked from `PUBLISH` and from any real spend/generation call.

**Session capability check (this environment):** no `ADMIN_API_KEY`/admin route reachable, no
`DATABASE_URL` access, `getHiggsfieldAccountHealth()` not callable from this sandbox. Motion
route status = `UNKNOWN` (not probed — no path to call it). Per the skill's "Producing a pack
when the motion route is unavailable" section, this pack is the correct output: a full
production-ready pack, not a downgraded stills asset presented as finished.

**Backlog context (read before merging):** as of this run, `apps/nickstire/docs/reel-packs/`
already has ~128 merged topic packs plus 6 open, unreviewed content-pack PRs from earlier today
(#1927, #1932, #1941, #1942, #1945, #1952) and one open backlog-status PR (#1948). A prior
session's status note (`BACKLOG-STATUS-2026-08-27-1130.md`) already flagged that this scheduled
task fires roughly hourly and outproduces the `RESERVATION_FEED_CAP` (2 posts/day), so the
unreviewed queue grows faster than it can be consumed. This run adds exactly **one** new pack, on
a topic not already covered in the last 7 days, rather than adding to that queue with a
near-duplicate. Recommend batch-reviewing the 6 pending content-pack PRs before merging this one.

---

## 1. Capabilities and context

| Check | Result |
|---|---|
| Mode | SCHEDULED / INTELLIGENCE — no render, no spend, no publish |
| `getHiggsfieldAccountHealth()` | Not callable from this session — `UNKNOWN` |
| `REEL_VIDEO_PROVIDER` | Not readable from this session (no env access to the deployed service) — `UNKNOWN`; per `docs/operations/REEL-PIPELINE.md` prod pins `template_stock` as of last verified read |
| `REEL_GENERATION_ENABLED` | `UNKNOWN` — not readable from this session |
| Repetition ledger (`getRecentReelSignals`) | Not queryable (no DB access from this sandbox) — substituted a directory + open-PR scan (see Backlog context above) as the best available proxy |
| Motion route | `BLOCKED: NO MOTION ROUTE` for this run — see capability check above |

## 2. Candidate topics considered (0–5 scored, informal — no live quality-score call available)

| Candidate | Repeat risk (7-day window) | Notes | Score |
|---|---|---|---|
| Foggy windshield / recirculate-button trick | None found in `docs/reel-packs/` (2026-08-20 through today) or today's open PRs | Safety-relevant, evergreen, zero technical-diagnosis claim needed, one clean visual demo | Selected |
| Power steering fluid leak (vs. whine) | Adjacent to `2026-08-21-power-steering-whine` (noise-only) | Overlapping enough to read as a repeat to a viewer scrolling past both | Parked |
| Tire cupping / scalloped wear from worn shocks | Adjacent to `2026-08-18-uneven-tire-wear-patterns` and `2026-08-17-strut-bounce-test` | Two existing packs already cover both halves of this claim | Parked |
| Rust-glazed rotors after rain sitting | Adjacent to `2026-08-19-warped-rotor-brake-shake` | Different mechanism but same "brake shake first stop" hook already used 2026-08-27 (`grinding-brakes-on-first-stop-of-the-day`, open PR) | Parked |

## 3. Claim evidence

This topic makes **no** dynamic business claim (no price, warranty, hours, or shop-specific
policy) and **no** mechanical-diagnosis claim about a customer's vehicle — it is a general
HVAC-airflow driving-safety tip (recirculate mode traps cabin humidity, which is what fogs glass
faster on the inside; pulling in outside air / running AC dries that humidity out). This is
common automotive-mechanics knowledge, not a business fact or a claim requiring
`evidenceResolver.ts` sourcing, so no `EvidenceRecord` lookup applies. The one claim that
touches the shop (that this is a Nick's Tire & Auto safety tip) is identity, not a fact needing
a source.

No `businessFacts.ts` row was read or needed for this script. **`UNKNOWN`**: whether a `"reel"`
or `"social"` `FactChannel` exists yet for public video use — per the skill's own noted gap, it
does not (`"sms" | "voice" | "web"` only), which is moot here since no business fact is quoted.

## 4. Production pack

### Concept

**Hook:** "Your windshield is fogging up and you just made it worse." A quick-cut demo of the
recirculate button being the wrong move when the windshield is already foggy, and the
defrost/outside-air fix that actually clears it.

**Format:** faceless, hands-and-dashboard only (per standing negative prompt below — no faces,
no on-screen human figures).

**Length:** 24 seconds (within 15–60s spec range).

### Script — word-for-word, timed to seconds

| Time | VO line | On-screen action |
|---|---|---|
| 0:00–0:03 | "If your windshield's fogging up, don't hit this button." | Close-up: finger reaches for the recirculate (looping-arrow) button on the dash |
| 0:03–0:07 | "Recirculate traps the moist air already inside your cabin." | Recirculate button lights up; light fog visibly thickens on glass (time-lapse cut) |
| 0:07–0:11 | "That's the opposite of what you want when the glass is already fogged." | Hand pulls back from the button, shakes head-level camera pan (no face) |
| 0:11–0:16 | "Turn off recirculate, crank the defrost, and add the AC — even in winter." | Fingers press defrost icon, then AC button; vents blow onto windshield |
| 0:16–0:20 | "The AC pulls the humidity out of the air so the fog can't reform." | Fog visibly clearing from glass, outside-air vent icon highlighted |
| 0:20–0:24 | "One clue, one fix — stop by and we'll take a look if it's not clearing." | Static end card: shop name + soft CTA text overlay |

### Per-beat generation prompts (Higgsfield-style, motion-first)

Standing negative prompt for every beat: `faces, hands close enough to show fingerprints or
rings, human figures, on-screen text, logos, watermarks, subtitles`

1. **Beat 1 (0:00–0:03):** "Close-up dashboard shot, driver's hand reaching toward a car's
   recirculate button (looping arrow icon), interior car cabin, natural daylight through
   windshield, shallow depth of field, realistic automotive interior, motion toward the button."
2. **Beat 2 (0:03–0:07):** "Car dashboard recirculate button glowing green/active, time-lapse
   style fog visibly thickening and creeping across the inside of a windshield, cool humid
   morning light, realistic condensation texture forming."
3. **Beat 3 (0:07–0:11):** "Driver's hand pulling back from a car dashboard button, slight
   camera pan across dashboard vents, foggy windshield still visible in background, realistic
   automotive interior lighting."
4. **Beat 4 (0:11–0:16):** "Close-up of fingers pressing a car's defrost button then AC button
   on dashboard, vents visibly blowing air toward windshield, cool blue dashboard lighting,
   realistic automotive interior."
5. **Beat 5 (0:16–0:20):** "Time-lapse of fog clearing from the inside of a car windshield,
   vents blowing steadily, morning light brightening through clearing glass, realistic
   condensation dissipating."
6. **Beat 6 (0:20–0:24, SAVE freeze per render-integrity contract):** static end-card frame,
   clean dashboard/windshield background for text overlay — no motion required, matches the 3s
   freeze the render-integrity gate expects after the last beat.

### Captions — see `captions.srt` in this directory (frame-accurate SRT, one cue per script line)

### Editing / assembly instructions (ffmpeg/CapCut, matches the render-integrity gate)

1. Order clips exactly as beats 1–6 above; no reordering — the VO and captions are timed to this
   sequence.
2. Each beat clip trimmed/looped to its table duration; total run time before the freeze = 21s,
   plus a 3s static SAVE-card freeze on beat 6 = **24s total**, matching the
   `beats + 3s SAVE freeze` contract the render-integrity gate checks (duration within 0.75s,
   frame count ≥80% of expected 30fps, ≥3 distinct MD5s across 5 sampled frames — i.e. do not
   let CapCut export a static freeze for more than the 6th beat).
3. Crossfade or hard cut between beats (hard cut recommended — matches the "quick-cut demo"
   pacing implied by the hook).
4. Voiceover: single continuous VO track per the script table, mixed at -3dB under any music bed.
5. Captions: burn in from `captions.srt`, bottom-third safe area, high-contrast style (white text,
   black outline/box) so it reads muted-first (Reel quality gate requires muted-first
   legibility).
6. End card (0:20–0:24): "Nick's Tire & Auto · 17625 Euclid Ave, Cleveland, OH · stop by and
   we'll take a look" — text overlay only on the static freeze frame, not spoken past 0:24.
7. Export: 1080x1920 (9:16), 30fps, H.264, target file size appropriate for IG/FB Reels upload
   limits.

## 5. Credit-risk and fallback routing

No generation call was made this run (`BLOCKED: NO MOTION ROUTE`, see §1), so no ledger
reservation was created and no cost was incurred. **Estimate only, not a metered read** — per
`server/services/generationLedger.ts` `COST_ESTIMATES_USD`: if routed through
`seedance_clip` at $0.25/clip × 6 beats ≈ **$1.50 estimated**, vs. $0 if
`template_stock_clip` (the currently-pinned prod route per the last verified read of
`REEL_VIDEO_PROVIDER`, itself `UNKNOWN` in this session — see §1). Actual balance against
`autonomy_policy_versions.limits.maxGenerationCostPerDayUsd` is `UNKNOWN` — not queryable from
this session.

## 6. Audio / music rights

**Real gap, not filled here.** No music-rights ledger exists in this repo (per the skill's own
documented gap). This script's VO is spoken narration only; if a music bed is added in CapCut,
its license/source/territory/expiry is `UNKNOWN`/`BLOCKED` until a human selects and records one
— do not treat "royalty-free" library defaults as pre-cleared without a record.

## 7. QA matrix

| Gate | Status | Basis |
|---|---|---|
| Rendered QA / vision critic (`renderedQa.ts`) | `BLOCKED` | No render occurred this run |
| Render-integrity gate (`reelAssembly.ts` #800/#801) | `BLOCKED` | No file exists to check duration/frame-count/motion-proof against |
| Repair routing (`repairRouter.ts`) | `N/A` | No job exists to repair |
| Consolidated publish gate (`qualityGate.ts`) | `BLOCKED` | Cannot evaluate without a real job row |
| Claim-safety wording (pattern bank, `facelessReelStudio.ts`) | `PASS` (manual read) | Script avoids "you need," "this means your X is bad/broken," "definitely needs" per the banned-pattern list at lines 552–561; uses approved soft phrasing "one clue" and "stop by and we'll take a look" (lines 580–585) |
| Repetition/duplicate-topic check | `PASS` (manual) | Cross-checked against all `docs/reel-packs/` folder names 2026-08-20→today and today's 6 open PR titles — no match; see §2 |
| Faceless/no-on-screen-text-in-clip constraint | `PASS` (by construction) | Standing negative prompt applied to all 6 beats |

## 8. IG/FB copy

**Primary caption:**
"Your windshield's fogging up and recirculate just made it worse. 🚗💨 Here's the fix — turn it
off, crank the defrost, add the AC (yes, even in winter). One clue, one fix. Stop by Nick's Tire
& Auto if it's not clearing. #NicksTireAuto #CarCareTips #WindshieldFog #DefrostTrick #EuclidOhio"

**Hashtags:** #NicksTireAuto #CarCareTips #WindshieldFog #DefrostTrick #DriveSafe #ClevelandOhio
#EuclidOhio #WinterDriving

### Ad-ready hook/caption/CTA variants

**Variant A (curiosity hook):**
- Hook: "Stop hitting that button when your windshield fogs up."
- Caption: "Recirculate feels right but it traps the moisture that's fogging your glass. Defrost
  + AC clears it fast — even in winter."
- CTA: "Save this for your next foggy morning. Questions? Stop by and we'll take a look."

**Variant B (direct-tip hook):**
- Hook: "Foggy windshield fix: 10 seconds, no fancy tools."
- Caption: "Turn off recirculate, run the defrost, add the AC. Humidity's the enemy — dry air
  clears the glass."
- CTA: "Bookmark this. And if your defrost isn't keeping up, stop by and we'll take a look."

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — full production pack delivered; no render, generation, spend,
or publish action was taken or attempted, consistent with this being a scheduled firing with no
live operator instruction present.
