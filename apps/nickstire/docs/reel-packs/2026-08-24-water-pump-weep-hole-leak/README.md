# Reel pack — water pump weep hole leak (colored drip under the engine)

**Mode:** INTELLIGENCE / SCHEDULED (automated scheduled firing, no live operator present).
**Status:** `READY FOR HUMAN APPROVAL` — text pack only. No render, no publish, no prod DB read,
no paid generation call was made producing this pack. See "Capability check" below for why.

## 1. Capability check (why this is a pack, not a rendered file)

This run had no path to real motion generation or posting:

- No ChatGPT/TTS/CapCut tool is connected to this session — script and captions below are
  hand-authored text, not machine-narrated audio. The connected MCP tool set (Adobe-for-creativity,
  Gamma, Canva, Vercel, huggingface-skills) has image/document generation and video *editing*
  primitives (`video_render`, `video_create_quick_cut`) but no Higgsfield/Seedance-equivalent
  text-to-video route, and none of it is wired into this repo's reel pipeline anyway.
- Higgsfield/Seedance generation and Meta/Instagram posting exist in this repo only behind
  `/api/admin/reel-canary` and `instagramAdmin.publishPost`, both of which spend real money
  and/or post to the live `@nicks_tire_euclid` account. Per the operator skill's hard rule
  ("never run a real generation, spend, or publish action ... without a live, in-the-moment
  operator instruction") and root `AGENTS.md`'s protected-operations list, a scheduled/automated
  firing does **not** satisfy that bar — this task's own instructions echo the same constraint
  ("Do not claim a finished file exists unless you have rendered it") — so those routes were not
  called.
- `getHiggsfieldAccountHealth()`, `REEL_VIDEO_PROVIDER`, `REEL_GENERATION_ENABLED`, and
  `getRecentReelSignals()` were **not read** this run — `env | grep -E "REEL_|ADMIN_API_KEY|
  HIGGSFIELD|DATABASE_URL"` in this session returned nothing (no prod env, no admin key), and the
  fourth is a production-TiDB read, out of scope for an unattended script per `prod-db-guard`.
  Treat all four as `UNKNOWN` for this run, not silently assumed either way.
- Repetition avoidance instead used the two checks the skill actually requires before writing:
  `ls apps/nickstire/docs/reel-packs/` (91 merged topics — coolant color, radiator cap pressure
  test, radiator fan idle overheat, tailpipe condensation vs coolant leak are covered, but none is
  the water-pump weep-hole failure sign specifically) and a GitHub PR search for open `reel pack`
  PRs (5 open drafts as of this run — heater core smell, horn fuse/relay, turbo whistle vs boost
  leak, trunk/hatch gas strut, washer fluid nozzle order — none overlapping this topic).

## 2. Candidate scoring (self-estimated, NOT the server's real `calculateReelQualityScore`)

This is an estimate against the 75-point rubric in `facelessReelStudio.ts`; the real score is
computed server-side at enqueue and was not run here.

| Dimension | Max | Est. | Why |
|---|---|---|---|
| First-frame scroll-stop | 10 | 8 | A colored puddle forming under a parked engine is a visually odd, motion-first cold open |
| Muted-first (captions carry it) | 10 | 10 | Full VO is captioned 1:1 below |
| Beat structure | 5 | 5 | 7 discrete beats, each a distinct camera setup |
| Length (15–60s) | 5 | 5 | 30s + 3s freeze = 33s |
| Loopability | 5 | 3 | Final clean-bay beat could loop into the dripping cold open; not a hard seam match |
| Sourced fact | 10 | 4 | Weep-hole-by-design mechanism is general automotive knowledge, not a `businessFacts`/`EvidenceRecord` citation — see §3 |
| Faceless | 10 | 10 | No people, hands, or faces in any beat |
| Claim safety | 10 | 10 | Only approved soft language used — see §3 |
| Keyword relevance | 5 | 4 | "coolant leak under car", "water pump leak" are searched terms |
| Winning concept (≥57/60) | 5 | — | N/A outside a real concept tournament |
| **Total (excl. tournament line)** | **70** | **59** | Self-estimate, below the 70 floor — flag, don't round up |

**Selected concept:** the water-pump-weep-hole reel above (only candidate generated this run).
**Parked:** none — single-candidate run, not a tournament.

## 3. Claim evidence

No `businessFacts` or `EvidenceRecord` lookups were performed this run (would require a live
prod DB/API read, out of scope for an unattended script). Every claim in the script below is
general, non-shop-specific automotive mechanism knowledge (that water pumps are manufactured with
a weep hole so the shaft seal leaks small amounts before catastrophic failure) — **not** a
quotable sourced fact, so the "sourced fact" score above is capped at partial credit and this pack
does **not** claim `EvidenceRecord`-level backing.

- `UNKNOWN`: any Nick's Tire & Auto—specific price, turnaround time, or availability claim.
  None were used in this script by design.
- `UNKNOWN`: whether `FactChannel` covers "reel" content at all — per the skill, it currently
  only covers `sms | voice | web`, so no fact here is channel-cleared for video regardless.
- Claim-safety wording used throughout: *might not be*, *one clue*, *worth checking*, *stop by
  and we'll take a look* — all on the approved soft-language list in `facelessReelStudio.ts`.
  No price, no guarantee, no fearmongering language.

## 4. Production pack — script (word-for-word, timed)

Total runtime: 33s (7 motion beats @ ~3-5s each + 3s SAVE freeze). 9:16, muted-first with
burned-in captions (see `captions.srt`).

| Beat | Time | Shot (motion-first, faceless) | Higgsfield/Seedance-style prompt | VO (word-for-word) |
|---|---|---|---|---|
| 1 — HOOK | 0:00–0:04 | Macro close-up: a few drops of colored fluid gather and drip from the underside of a parked engine bay onto a clean concrete floor | `macro close up shot of colored coolant fluid dripping slowly from the underside of a car engine bay onto a clean concrete garage floor, shallow depth of field, cinematic lighting, photorealistic` | "A few drops of colored fluid under the front of your engine isn't always the radiator." |
| 2 | 0:04–0:09 | Engine bay wide shot: camera pushes in toward the front-center of the engine where the serpentine belt drives the water pump pulley | `wide shot of a car engine bay pushing in toward the front center pulley and serpentine belt assembly driving a water pump, bright shop lighting, photorealistic, cinematic camera movement` | "Water pumps have a tiny weep hole built in — it's designed to leak a little before it fails." |
| 3 | 0:09–0:14 | Extreme macro: the small weep hole on the water pump housing with a faint drip trail visible | `extreme macro close up of a small drain weep hole on a car water pump housing, a faint colored drip trail visible below it, engine bay detail, photorealistic` | "That hole lets coolant escape early, instead of the seal blowing out with no warning." |
| 4 | 0:14–0:19 | Close-up: coolant overflow reservoir tank, translucent plastic showing colored fluid level and a light residue stain on the outside near the cap | `close up of a translucent car coolant overflow reservoir tank showing colored fluid level inside, a faint dried residue stain around the cap on the outside, engine bay lighting, photorealistic` | "One clue: it's colored and sticky — not clear water like AC condensation." |
| 5 | 0:19–0:24 | Macro: dried, crusty white or colored residue trail built up near a pump housing bolt, no active drip | `macro close up of dried crusty mineral residue buildup trailing down from a car water pump housing bolt, no active dripping, engine bay detail, photorealistic` | "You might also see a dried, crusty residue trail near the pump before a puddle ever shows up." |
| 6 | 0:24–0:27 | Interior dash close-up: temperature gauge needle drifting from normal toward the hot zone | `close up of a car dashboard temperature gauge needle slowly drifting from the normal center position toward the hot zone, dim interior lighting, photorealistic` | "Ignore it long enough and the engine can overheat with no warning." |
| 7 — CTA / SAVE freeze | 0:27–0:30 (+3s freeze to 0:33) | Wide static hold: clean, dry automotive service bay under bright even lighting, no signage/logo visible | `wide static shot of a clean automotive service bay interior, bright even lighting, no visible signage, logos, or text, photorealistic, held static frame` | "Stop by and we'll take a look." |

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

## 5. Credit-risk and fallback routing

No generation call was made, so no real spend occurred this run. For reference against
`generationLedger.ts` if this pack is later approved and rendered:

- If routed through `template_stock` (prod's current pinned `REEL_VIDEO_PROVIDER` per
  `docs/operations/REEL-PIPELINE.md`, **not verified live this run** — flagged `UNKNOWN`):
  estimated cost `$0` (local ffmpeg lane, `COST_ESTIMATES_USD.template_stock_clip`).
- If routed through Higgsfield/Seedance: 7 beats × `$0.25` ASSUMPTION-labeled estimate =
  **~$1.75**, before any paid repair pass. This is an operator-tunable estimate in source,
  not a metered price — do not quote it as exact.
- Today's `autonomy_policy_versions` limits and the day's `RESERVATION_FEED_CAP` /
  `RESERVATION_SPACING` counters were **not read** this run (prod DB) — `UNKNOWN` whether
  today's feed-post cap (2/day) or spacing (3h) has room. Check before enqueueing.

## 6. Audio / music rights

**Real gap, not filled here.** This repo has no music-rights ledger. Recommend a royalty-free
bed (e.g. YouTube Audio Library, Pixabay Music) chosen and license-screenshotted by the human
editor at assembly time — do not treat any specific track as pre-cleared. VO in this pack is
text-only (no TTS was run); if TTS is added later, route through `reelVoice.ts`'s existing
fail-closed contract per `nickstire-verifier-reel-pipeline`, don't hand-generate ad hoc.

## 7. QA matrix

| Gate | Result | Basis |
|---|---|---|
| Render-integrity (duration/frame-count/motion-MD5) | `UNKNOWN` | No file was rendered this run — nothing to ffprobe |
| Rendered QA / vision critic (`renderedQa.ts`) | `UNKNOWN` | No job row exists; nothing to score |
| Consolidated publish gate (`evaluateReelPublishGate`) | `UNKNOWN` | Not invoked — no job to evaluate |
| Repetition ledger (`getRecentReelSignals`) | `UNKNOWN` | Prod DB read skipped this run; substituted with directory + open-PR check (§1) |
| Claim safety (`facelessReelStudio.ts` validators) | `PASS` (manual read, not the real validator function) | Script uses only approved soft-language phrases, no price/guarantee/fear language |
| Motion-first / faceless | `PASS` (manual read) | Every beat prompt is scene-only; standing negative prompt excludes people/text/logos |

## 8. IG/FB copy + hook/CTA variants

**Primary caption:**
> A few drops of colored fluid under the front of your engine isn't always "just the radiator."
> Water pumps are built with a tiny weep hole that leaks a little before the seal fails for good.
> Catch it early and it's a simple fix — ignore it and it can mean overheating on the road. Stop
> by and we'll take a look. 🔧🚗

**Hashtags:** #CarMaintenance #CoolantLeak #WaterPump #CarCare #EuclidOhio #NicksTireAndAuto
#AutoRepair #DIYCarCheck

**Ad-ready variant A (curiosity hook):**
- Hook: "That small puddle under your car might be a built-in warning."
- Caption: "Water pumps have a weep hole on purpose — it drips a little before the seal fails
  completely. Catching it now beats a tow later."
- CTA: "Stop by and we'll take a look — no guessing."

**Ad-ready variant B (relatability hook):**
- Hook: "Colored drops under the engine, not under the AC?"
- Caption: "That's coolant, not condensation — and it's often the first sign a water pump seal is
  wearing out. One clue: it's sticky, not clear."
- CTA: "Worth a quick look — swing by."

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY`: self-estimated quality score (59/70,
excluding the tournament line) is below the 70-point floor the real server-side scorer enforces,
driven mainly by the "sourced fact" dimension having no `EvidenceRecord`/`businessFacts`
citation. A human should either accept the mechanism-only framing as-is or route it through the
real brief-gen/evidence pipeline before this is enqueued, rendered, or published. No render, no
publish, no spend, no prod DB write occurred producing this pack.
