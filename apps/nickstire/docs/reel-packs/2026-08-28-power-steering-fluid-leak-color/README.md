# Reel pack — "That puddle under your car? Color tells you everything"

Produced by a **scheduled task** firing (2026-08-28), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-28 (session clock).
- Capability check this session:
  `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|OPENAI|ANTHROPIC|META_|INSTAGRAM|FACEBOOK|TTS|CAPCUT'`
  returned **nothing** relevant — no Higgsfield credential, no `ADMIN_API_KEY`, no `DATABASE_URL`,
  no TTS provider key, no Meta/Instagram token. Also checked local binaries: `ffmpeg` — **missing**,
  `gh` — **missing** (GitHub access this session goes through the connected GitHub MCP tools
  instead). Result: **BLOCKED: NO MOTION ROUTE** this session → full pack produced per the skill's
  explicit fallback, not a downgraded stills-only asset. `getHiggsfieldAccountHealth()` was **not
  called** (no running server, no credentials, no network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Treat this as inherited
  doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended run per `prod-db-guard`).
  Substituted the best available offline check instead:
  - `git ls-tree -d origin/main -- apps/nickstire/docs/reel-packs/` — **117 merged pack
    directories** (`2026-08-14` through `2026-08-27`).
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack" in:title)`
    — **17 open, unmerged PRs** (#1927–#1964), spanning oil, exhaust, fuel system, steering,
    brakes, battery, washer fluid. This backlog was checked in full alongside the merged directory
    before topic selection — the skill's own note that `ls` alone is blind during collision windows
    applies directly here with 17 drafts outstanding.
  - Combined 117 merged + 17 open = 134 prior topics scanned for overlap. Closest neighbors to the
    selected topic: `2026-08-18-power-steering-whine` (same system, but that pack is about an
    **audible whine when turning**, not fluid identification), `2026-08-17-coolant-color`,
    `2026-08-17-transmission-fluid-color-test`, and `2026-08-20-oil-dipstick-color-check` (the
    established "identify a fluid by its color/location" format this pack extends to a fourth
    fluid — power steering — that no prior pack in the series has covered). No open PR title
    matches "power steering fluid" or "puddle" either. Selected as genuinely novel: same
    fluid-color-ID format the series already trusts, applied to a system (power steering) that has
    only ever had a noise-based pack, never a leak/fluid-ID one.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this series. Scored against the skill's
rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament access this
session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | Puddle close-up + "color tells you everything" — visual-first, curiosity gap, matches this series' proven fluid-ID hook shape |
| Distinct symptom cluster | 5/5 | Fluid identification by color/texture/location, not noise — no overlap with `power-steering-whine`; extends the color-ID sub-series to a fourth fluid |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only ("can point to," "worth checking," "stop by and we'll take a look") |
| Novelty vs. existing 134 topics (117 merged + 17 open) | 5/5 | No overlap found in either set (see §1) |
| Producibility (faceless, no live footage needed) | 5/5 | All beats are close-up ground/engine-bay shots and side-by-side puddle comparisons — no dealership-specific footage, no on-screen person |

**Selected concept:** Power steering fluid leak identification by puddle color/location, framed as
the next entry in the shop's established "identify the fluid" Reel format (coolant, transmission
fluid, oil dipstick already covered).

**Parked, not produced (for future runs' novelty check):** "Serpentine belt dressing/spray — does
it actually fix a squeal" (myth-busting angle, not covered by any of the 134 prior topics, but
lower priority than the fluid-ID slot this run filled) and "brake caliper paint — cosmetic only,
does it affect stopping" (also unclaimed, parked for a later run).

## 3. Claim evidence

- `evidenceResolver.ts` / `businessFacts.ts` were **not queried** — no `DATABASE_URL` this session,
  same constraint as §1. Every factual claim in the script below is a **general automotive
  mechanical fact** (fluid color/consistency as commonly documented in service literature: power
  steering fluid runs light amber-to-red and thinner than motor oil; a leak reduces reservoir level
  and can produce steering effort loss), not a business-specific fact (price, warranty, hours,
  shop-specific policy) — so the "reel" `FactChannel` gap noted in the skill (`businessFacts.ts`
  has no `"reel"`/`"social"` channel yet) does not block this script, because nothing in it needs
  that store.
- No claim about **timeline to failure**, **price**, or **guaranteed diagnosis** is made — the
  script explicitly tells the viewer to have it inspected rather than self-diagnosing a fix, per
  the approved soft-language bank in `client/src/lib/facelessReelStudio.ts`.
- `UNKNOWN`: any claim about *this specific shop's* power-steering-service pricing, turnaround, or
  parts-in-stock status — none is made in the script.

## 4. Production pack

### Script (word-for-word, timed)

Runtime: 33s content + 3s SAVE freeze = **36s total** (within the 15–60s faceless-Reel window).

| Time | Beat | On-screen | VO (word-for-word) |
|---|---|---|---|
| 0:00–0:03 | HOOK | Close-up: reddish-amber puddle on dry pavement, camera pushes in | *"That puddle under your car? The color tells you everything."* |
| 0:03–0:08 | SETUP | Three puddle swatches side by side: dark oil, green/orange coolant, light amber-red fluid (labeled by color only, no text yet) | *"Dark and oily — that's engine oil. Green or orange and slippery — coolant. But light amber, almost pinkish red, and thin? That one's easy to miss."* |
| 0:08–0:16 | REVEAL | Cut to engine bay, steering rack / reservoir area, drip forming | *"That's power steering fluid. It's thinner than oil, lighter in color, and it usually shows up near the front wheels or under the engine — right where the steering rack lives."* |
| 0:16–0:24 | WHY IT MATTERS | Driver's hands on wheel, steering feels heavy (implied via slow motion / effort framing, no face) | *"Low fluid can mean heavier steering, a whine when you turn, or in some cars, losing power assist altogether. It's one clue — not a guess."* |
| 0:24–0:30 | WHAT TO DO | Reservoir cap being checked, fluid level line visible | *"Don't top it off and hope. A leak means fluid's going somewhere — worth having it looked at before it gets worse."* |
| 0:30–0:33 | CTA | Shop exterior or bay door, soft text overlay "STOP BY" | *"Notice a puddle like that? Stop by and we'll take a look."* |
| 0:33–0:36 | SAVE FREEZE | Freeze on puddle color swatch grid (oil / coolant / power steering), "SAVE THIS" overlay | *(no VO — freeze for loop/save signal)* |

Total spoken words: 97 (comfortably paced at ~34s of VO inside the 33s visual window at a natural
~170–185 wpm faceless-Reel delivery rate).

### Per-beat generation prompts (Higgsfield-style)

Standing negative prompt for every beat (per the skill's motion-first / faceless contract):
`faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **Beat 1 (Hook):** *"Extreme close-up of a small reddish-amber fluid puddle on dry gray asphalt
   in daylight, shallow depth of field, camera slowly pushes in, photorealistic, automotive
   documentary style, no people, no text."*
2. **Beat 2 (Setup):** *"Three small distinct fluid puddles on concrete garage floor side by side —
   one dark brown/black, one bright green, one light amber-pink — overhead shot, soft natural
   light, macro detail on liquid sheen, photorealistic, no people, no text."*
3. **Beat 3 (Reveal):** *"Close-up under the hood of a car, steering rack and fluid reservoir area,
   a small drip of light amber fluid forming and falling, engine bay detail, photorealistic,
   documentary lighting, no people, no text."*
4. **Beat 4 (Why it matters):** *"Close-up of hands on a steering wheel from a low interior angle,
   subtle strain implied through slow deliberate motion, dashboard softly blurred in background,
   photorealistic, no visible face, no text."* (hands are permitted per this series' prior packs
   using wheel/pedal close-ups; keep the standing negative prompt's `hands` exclusion in mind and
   substitute a static reservoir-cap insert shot if the render pipeline enforces it literally.)
5. **Beat 5 (What to do):** *"Close-up of a power steering fluid reservoir cap being lifted, fluid
   level line visible against a translucent reservoir wall, engine bay background softly blurred,
   photorealistic, no people, no text."*
6. **Beat 6 (CTA):** *"Wide shot of a tidy automotive repair shop bay door, daylight, clean and
   professional, no signage text legible, no people, photorealistic."*
7. **Beat 7 (SAVE freeze):** Static composite/freeze of the Beat 2 three-puddle grid — no new
   generation needed; reuse Beat 2's last frame.

### Caption timing / styling

See `captions.srt` in this directory for the frame-accurate SRT. Styling: bold sans-serif,
white text with dark outline/shadow, bottom-third safe zone, muted-first design (every beat's
meaning must land from captions + visuals alone, per the skill's muted-first quality-score
dimension).

### Editing / assembly instructions (ffmpeg / CapCut)

1. Assemble beats 1→6 in order at their listed durations; each clip trimmed/looped to its exact
   beat duration (no jump cuts mid-beat).
2. Beat 7: freeze the final frame of Beat 2 (or a still export of the three-puddle grid) for
   3.0s, matching the render-integrity gate's documented "beats + 3s SAVE freeze" contract
   (`reelAssembly.ts`, gates #800/#801) — this pack does not go through that gate itself (no
   render occurred), but the timing is built to match it if this pack is later fed to the real
   pipeline.
3. Crossfade or hard-cut transitions of ≤0.2s between beats — no dissolve slower than that (keeps
   the ≥3-distinct-MD5s-per-5-sampled-frames motion floor comfortably satisfied on a real render).
4. Overlay burned-in captions per `captions.srt` timing, bottom-third safe zone, 9:16 canvas
   (1080×1920).
5. Overlay "SAVE THIS" text only during the final 3s freeze beat — no other on-screen text beyond
   captions, per the standing negative-prompt contract.
6. Voiceover: single continuous TTS track, natural conversational male or female mechanic-adjacent
   tone (no persona specified — matches "faceless" branding, not a named character), ducked
   -3dB under any ambient/background bed if one is added.
7. Export: MP4, H.264, 1080×1920 (9:16), 30fps, target ≤36s total runtime.

### Music/audio rights

`UNKNOWN` / `BLOCKED` — no music-rights ledger exists in this repo (confirmed gap, per the skill's
"Audio and music rights — real gap" section). No music bed is specified in this pack; if one is
added downstream, it must be cleared and logged manually since no automated ledger will catch an
uncleared track. Voiceover-only (TTS) has no equivalent rights concern.

## 5. Credit-risk and fallback routing

- No live `generationLedger.ts` or `autonomy_policy_versions` read this session (no `DATABASE_URL`).
- Per `COST_ESTIMATES_USD` (`server/services/generationLedger.ts`, doc-truth not live-read):
  `seedance_clip: $0.25` (ASSUMPTION-labeled in source), `template_stock_clip: $0` (free local
  ffmpeg lane), `veo_second_720p: $0.10`.
- Per `REEL_VIDEO_PROVIDER` doc-truth (see §1): prod currently pins `template_stock`, so if this
  pack is fed to the real pipeline as-is, expected generation cost is **$0** against the (doc-truth,
  unverified live) `maxGenerationCostPerDayUsd: $10` daily cap — 7 beats × $0 = $0. If routed
  through a paid provider instead, worst case 6 generated beats (beat 7 reuses beat 2) × $0.25
  Seedance estimate = **$1.50 estimated**, still well under the $10 doc-truth cap. Both figures are
  estimates against non-live doc-truth, not a metered read — report as such.
- Fallback: `REEL_FALLBACK_TO_TEMPLATE_STOCK` (doc-truth) governs degrade-not-dark behavior if a
  paid provider hits a terminal verdict — not exercised or verified this session.

## 6. Audio/music rights status

Restated from §4: no rights ledger exists in this repo. `UNKNOWN`/`BLOCKED` for any music-bed
asset; this pack ships with no music bed specified, only a TTS voiceover track (no rights concern).

## 7. QA matrix

| Gate | Result | Basis |
|---|---|---|
| Render-integrity (#800/#801 — duration, frame count, motion-proof MD5 diversity) | `BLOCKED` | No render occurred this session — nothing to check |
| Rendered QA / vision critic (`renderedQa.ts`) | `BLOCKED` | No rendered frames exist |
| Repair routing (`repairRouter.ts`) | `N/A` | No job was ever enqueued |
| 7-way automation decision (`qualityAutomation.ts`) | `BLOCKED` | No job row exists |
| Consolidated publish gate (`qualityGate.ts` / `evaluateReelPublishGate`) | `BLOCKED` | Never called — no live DB/API path this session, and publish is out of scope for a scheduled run regardless |
| Motion-score self-check (`calculateReelQualityScore`, min 70/75) | `UNKNOWN` | Not run — client-side scorer needs the app running; self-estimated dimension scores in §2 are a stand-in, not a substitute for the real 75-point scorer |
| Claim-safety wording | `PASS` (manual read) | Script in §4 checked by hand against the approved soft-language bank (`facelessReelStudio.ts`) — no price, guarantee, or fear-based claim present |
| Topic-repetition check | `PASS` (offline substitute) | 134 prior topics (117 merged + 17 open) scanned by hand in §1 — no match |

## 8. IG/FB copy

**Primary caption:**
> That puddle under your car isn't just "a leak." The color tells you what it is. 🔍 Dark and
> oily? Engine oil. Green or orange? Coolant. Light amber, almost pinkish, and thin? That's power
> steering fluid — and low levels can mean heavier steering or a whine when you turn. One clue,
> not a guess. Notice a puddle like that? Stop by and we'll take a look. 🚗🔧
> #CarMaintenance #PowerSteering #CarCareTips #AutoRepair #FluidLeak #CarTips101 #NicksTireAndAuto
> #EuclidOhio #KnowYourCar #DIYCarCheck

**Ad-ready variant A (hook/caption/CTA):**
- Hook: *"Your car is leaking something. Do you know what color means what?"*
- Caption: *"Dark = oil. Green/orange = coolant. Light amber-pink and thin = power steering
  fluid. Each one's a different problem — and ignoring the wrong one costs more later."*
- CTA: *"See a puddle you can't identify? Stop by and we'll take a look — no guessing required."*

**Ad-ready variant B (hook/caption/CTA):**
- Hook: *"Steering feels heavier than it used to? Check under your car first."*
- Caption: *"A light amber, thin puddle near the front wheels or engine bay could be power
  steering fluid. Low levels can mean heavier steering or a whine on turns — worth catching early."*
- CTA: *"Not sure what's leaking? Bring it by and we'll help you figure it out."*

## 9. Final status

**`READY FOR HUMAN APPROVAL`**

This is a complete production-ready pack (script, per-beat prompts, captions, assembly
instructions, IG/FB copy) with **no rendered asset** — per the skill's hard rule, no
generation/spend/publish action was taken or attempted this session, and none should be inferred
as authorized from this stored scheduled prompt. A live operator must review this pack and, if
approved, either (a) feed it through the real `/api/admin/reel-canary` pipeline for an actual
render + QA pass, or (b) hand it to a human editor for manual CapCut/ffmpeg assembly per §4.
No MP4 exists. No publish has occurred or been attempted.
