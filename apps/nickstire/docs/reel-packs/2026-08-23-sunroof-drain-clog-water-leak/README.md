# Reel pack — sunroof drain clog / interior water leak

**Mode:** INTELLIGENCE / SCHEDULED (automated cron firing, no live operator present).
**Status:** `READY FOR HUMAN APPROVAL` — text pack only. No render, no publish, no prod DB read,
no paid generation call was made producing this pack. See "Capability check" below for why.

## 1. Capability check (why this is a pack, not a rendered file)

This run had no path to real motion generation or posting:

- No ChatGPT/TTS/CapCut tool is connected to this session — script and captions below are
  hand-authored text, not machine-narrated audio.
- Higgsfield/Seedance generation and Meta/Instagram posting exist in this repo only behind
  `/api/admin/reel-canary` and `instagramAdmin.publishPost`, both of which spend real money
  and/or post to the live `@nicks_tire_euclid` account. Per the operator skill's hard rule
  ("never run a real generation, spend, or publish action ... without a live, in-the-moment
  operator instruction") and root `AGENTS.md`'s protected-operations list, a scheduled/cron
  firing does **not** satisfy that bar — so those routes were not called.
- `getHiggsfieldAccountHealth()`, `REEL_VIDEO_PROVIDER`, `REEL_GENERATION_ENABLED`, and
  `getRecentReelSignals()` were **not read** this run (the first three require live process
  env inspection this session doesn't have; the fourth is a production-TiDB read, out of
  scope for an unattended script per `prod-db-guard`). Treat all four as `UNKNOWN` for this
  run, not silently assumed either way.
- Repetition avoidance instead used the two checks the skill actually requires before
  writing: `ls apps/nickstire/docs/reel-packs/` (78 merged topics, none about sunroof
  drains/water leaks) and `gh`-equivalent search for open `reel pack` PRs (9 open drafts —
  fuel pump whine, EGR valve, fuel gauge sender, rough auto shifting, oil pressure light,
  motor mount clunk, exhaust/muffler joint, rich catalytic converter smell, clutch slip —
  none overlapping this topic).

## 2. Candidate scoring (self-estimated, NOT the server's real `calculateReelQualityScore`)

This is an estimate against the 75-point rubric in `facelessReelStudio.ts`; the real score is
computed server-side at enqueue and was not run here.

| Dimension | Max | Est. | Why |
|---|---|---|---|
| First-frame scroll-stop | 10 | 8 | Water dripping onto a car seat is a visually odd, motion-first cold open |
| Muted-first (captions carry it) | 10 | 10 | Full VO is captioned 1:1 below |
| Beat structure | 5 | 5 | 7 discrete beats, each a distinct camera setup |
| Length (15–60s) | 5 | 5 | 30s + 3s freeze = 33s |
| Loopability | 5 | 3 | Clean-drain final beat could loop into the dripping cold open; not a hard seam match |
| Sourced fact | 10 | 4 | Mechanism (drain tubes route water through pillars) is general automotive knowledge, not a `businessFacts`/`EvidenceRecord` citation — see §3 |
| Faceless | 10 | 10 | No people, hands, or faces in any beat |
| Claim safety | 10 | 10 | Only approved soft language used — see §3 |
| Keyword relevance | 5 | 4 | "sunroof leak", "water leak in car" are searched terms |
| Winning concept (≥57/60) | 5 | — | N/A outside a real concept tournament |
| **Total (excl. tournament line)** | **70** | **59** | Self-estimate, below the 70 floor — flag, don't round up |

**Selected concept:** the sunroof-drain-clog reel above (only candidate generated this run).
**Parked:** none — single-candidate run, not a tournament.

## 3. Claim evidence

No `businessFacts` or `EvidenceRecord` lookups were performed this run (would require a live
prod DB/API read, out of scope for an unattended script). Every claim in the script below is
general, non-shop-specific automotive mechanism knowledge (how sunroof drain tubes work) —
**not** a quotable sourced fact, so the "sourced fact" score above is capped at partial credit
and this pack does **not** claim `EvidenceRecord`-level backing.

- `UNKNOWN`: any Nick's Tire & Auto—specific price, turnaround time, or availability claim.
  None were used in this script by design.
- `UNKNOWN`: whether `FactChannel` covers "reel" content at all — per the skill, it currently
  only covers `sms | voice | web`, so no fact here is channel-cleared for video regardless.
- Claim-safety wording used throughout: *might not be*, *worth checking*, *one clue*, *stop by
  and we'll take a look* — all on the approved soft-language list in `facelessReelStudio.ts`.
  No price, no guarantee, no fearmongering language.

## 4. Production pack — script (word-for-word, timed)

Total runtime: 33s (7 motion beats @ ~3-4s each + 3s SAVE freeze). 9:16, muted-first with
burned-in captions (see `captions.srt`).

| Beat | Time | Shot (motion-first, faceless) | Higgsfield/Seedance-style prompt | VO (word-for-word) |
|---|---|---|---|---|
| 1 — HOOK | 0:00–0:04 | Macro slow-motion: a single water droplet forms at a headliner seam above a car seat and falls | `macro slow motion water droplet forming and falling from a car headliner seam onto a fabric car seat, interior car cabin, soft window light, shallow depth of field, cinematic, photorealistic` | "Water dripping from your headliner after it rains? Might not be a roof leak." |
| 2 | 0:04–0:09 | Exterior close-up: rain beading on a closed sunroof glass panel, water running toward the front corner | `close up exterior shot of car sunroof glass panel, rain droplets beading and running toward the front corner drain channel, wet reflective glass, overcast daylight, photorealistic` | "Most sunroofs have four drain tubes that carry rainwater down through the pillars." |
| 3 | 0:09–0:14 | Close-up: a narrow drain tube opening partially blocked with leaf debris, water pooling at the blockage | `extreme close up of a narrow plastic drain tube opening inside a car door pillar, partially clogged with small leaf debris and dirt, water pooling against the blockage, macro detail, photorealistic` | "Leaves and dirt can clog one, so water backs up instead of draining out." |
| 4 | 0:14–0:19 | Interior motion: water beading at a headliner corner and dripping onto a seat, small dark spot spreading on carpet below | `interior car cabin, water beading and dripping from a headliner corner trim piece onto a car seat cushion, a small dark water spot spreading on the carpet below, moody interior lighting, photorealistic` | "That backup finds the easiest way in — usually the headliner or a rear pillar." |
| 5 | 0:19–0:24 | Close-up: gloved-free tool (small flexible pick, no hands visible) clearing debris from a drain tube, water then flowing freely | `close up of a small flexible plastic pick tool clearing leaf debris from a car drain tube opening with no hands or human figures visible, water then flowing freely through the cleared tube, macro detail, photorealistic` | "One clue: it usually only happens after rain or a car wash — not all the time." |
| 6 | 0:24–0:27 | Wide motion: clean dry sunroof track panel and a clear stream of water exiting a drain tube under the rocker panel | `wide shot of a clean dry car sunroof track and headliner interior, cut to water flowing clearly out of a drain tube exit under the vehicle rocker panel onto pavement, photorealistic, cinematic` | "Worth checking before you assume it's a full roof leak." |
| 7 — CTA / SAVE freeze | 0:27–0:30 (+3s freeze to 0:33) | Wide static hold: clean, dry car interior bay under bright shop lighting, no signage/logo visible | `wide static shot of a clean automotive service bay interior, bright even lighting, no visible signage, logos, or text, photorealistic, held static frame` | "Stop by and we'll take a look." |

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
> Water dripping inside your car after it rains? Before you assume it's a roof leak — check
> your sunroof drains. One clogged tube backs water up into the cabin instead of draining it
> out. Stop by and we'll take a look. 🔧🚗

**Hashtags:** #CarMaintenance #SunroofLeak #CarCare #EuclidOhio #NicksTireAndAuto #CarProblems
#AutoRepair #DIYCarCheck

**Ad-ready variant A (curiosity hook):**
- Hook: "That water on your seat isn't from the roof."
- Caption: "It's probably a clogged sunroof drain tube — a 10-minute check before you pay for
  a roof repair you don't need."
- CTA: "Stop by and we'll take a look — no guessing."

**Ad-ready variant B (relatability hook):**
- Hook: "Rained last night? Check your seats before you drive off."
- Caption: "A clogged sunroof drain sends rainwater into the cabin instead of out under the
  car. One clue: it only happens after rain or a wash."
- CTA: "Worth a quick look — swing by."

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY`: self-estimated quality score (59/70,
excluding the tournament line) is below the 70-point floor the real server-side scorer
enforces, driven mainly by the "sourced fact" dimension having no `EvidenceRecord`/
`businessFacts` citation. A human should either accept the mechanism-only framing as-is or
route it through the real brief-gen/evidence pipeline before this is enqueued, rendered, or
published. No render, no publish, no spend, no prod DB write occurred producing this pack.
