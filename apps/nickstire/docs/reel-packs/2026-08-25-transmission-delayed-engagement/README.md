# Reel pack — "That clunk into gear after your car's been sitting"

Produced by a **scheduled task** firing (2026-08-25), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-25 (session clock).
- Capability check this session:
  `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|OPENAI|ANTHROPIC_API|META_|INSTAGRAM|FACEBOOK|^TTS|CAPCUT'`
  returned **nothing** — no Higgsfield credential, no `ADMIN_API_KEY`, no `DATABASE_URL`, no TTS
  provider key, no Meta/Instagram token. Local binaries: `ffmpeg` — **missing**, `gh` — **missing**
  (this session uses the GitHub MCP server instead). Result: **BLOCKED: NO MOTION ROUTE** this
  session → full pack produced per the skill's explicit fallback, not a downgraded stills-only
  asset. `getHiggsfieldAccountHealth()` was **not called** (no running server, no credentials, no
  network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Treat this as inherited
  doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the best available offline check instead:
  - `ls apps/nickstire/docs/reel-packs/` on `origin/main` — **95+ merged pack directories**
    (`2026-08-14` through `2026-08-25`), spanning tires, brakes, cooling, electrical, drivetrain,
    HVAC, and emissions topics.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack"
    in:title)` — **8 open PRs**, none touching transmission engagement behavior: #1875 (torque
    converter shudder 40-45mph — a highway-speed vibration symptom, not a cold/delayed-engagement
    one), #1873 (4WD/AWD driveline bind in tight turns), #1867 (brake light switch/cruise/shift-
    lock), #1865 (rear defroster), #1857 (AC compressor clutch), #1835 (exhaust manifold leak), plus
    two `BACKLOG-STATUS-*` meta-PRs (#1842, #1874) recommending a pause when the queue got large
    (127–132 open PRs at the time). Total open-PR count for the whole repo right now is **9** —
    the backlog those notes flagged has since been worked down, so this run is not blocked on it.
  - Checked this pack's topic (automatic transmission delayed engagement / clunk into gear after
    the vehicle has been parked) against all 100+ merged-or-pending topics — **no overlap found.**
    Nearest neighbors are `rough-shifting-check-fluid-first` (general shifting complaint, not
    specifically the cold-start delayed-engage symptom), `clutch-slipping-rpm-flare` (manual
    transmission, RPM flare under load — a different mechanism from an automatic's delayed
    engagement), and `torque-converter-shudder-40-45mph` (open PR #1875 — a highway-speed vibration,
    not a parked-then-shift symptom). The script below names "delayed engagement" and "after
    sitting" explicitly to keep this topic distinguishable from those three.

## 2. Candidate scores and selected concept

Single-concept run. Scored against the skill's rubric out of 5 per dimension, self-estimated (no
live critic panel — no DB/tournament access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "You shift into Drive — and there's a delay" is a relatable, specific moment, not a generic "check your car" hook |
| Distinct symptom cluster | 5/5 | Delayed engagement + clunk, specifically after the car has been parked, is mechanically specific — not the same as general rough shifting or RPM flare |
| Claim safety | 5/5 | No price, no guarantee, no invented timeline — soft language only |
| Novelty vs. existing 100+ topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 4/5 | All beats are plausible AI-gen or stock B-roll; no dealership-specific footage required |

Selected: **"That clunk into gear after your car's been sitting."** No runner-up concept was
generated — single-topic run, consistent with sibling packs in this backlog window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). The claim below is **general automotive-repair knowledge** (low or degraded automatic
  transmission fluid reduces hydraulic pressure to the clutch packs, which can show up as a
  delayed or harsh engagement into gear — most noticeable on a cold start or after the car has sat
  and fluid has drained back into the pan), not a shop-specific sourced fact. `entailment` status:
  **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the fluid-level/delayed-engagement claim;
  whether Nick's Tire & Auto specifically stocks/services automatic transmission fluid checks and
  service (near-certain for a general repair shop, but not confirmed against a live `business_facts`
  row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "You shift into Drive — and there's a delay. Then a clunk." |
| 0:04–0:09 | SYMPTOM | "It's worse first thing in the morning, or after the car's been parked a while." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: low or worn transmission fluid can cause that delayed engagement." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "Ignore it long enough, and that hesitation can turn into real wear on the internal clutches." |
| 0:21–0:26 | SAFE ACTION | "Don't guess what's causing it. A fluid level and condition check can help narrow it down." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before it gets worse. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't guess · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Static close-up on an instrument-cluster gear-position indicator in dim early-
   morning garage light; the indicator shifts from "P" to "D" with a visible half-second pause
   before it settles, static-mounted camera (no hand on the shifter).
2. **0:04–0:09** — Wide shot of a car sitting in a driveway or garage at dawn, light frost or dew
   on the windshield implying an overnight park; cut to exhaust vapor rising from the tailpipe at
   idle in cool air.
3. **0:09–0:15** — Macro cutaway: a transmission dipstick held against a bright shop light, fluid
   level sitting below the "full" mark, fluid tinted slightly reddish-brown, slow push-in on the
   dipstick tip.
4. **0:15–0:21** — Slow-motion macro of transmission fluid drops falling from the dipstick tip onto
   a white paper towel, showing color and clarity, shallow depth of field, shop-bay ambient light.
5. **0:21–0:26** — Underside/lift-bay shot: a vehicle raised on a lift, transmission pan visible
   from below, a shop light illuminating the pan bolts, static hold.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six ~5s
beats as scripted above are too coarse on their own — recommend the assembler split beats 2, 3,
and 5 into two sub-shots each (quick punch-in or angle change) to reach ~10–12 sub-clips at
~2.5–3s apiece before this pack is fed to real generation. Flagging this explicitly rather than
presenting the 6-beat table as render-ready.

### Assembly instructions (ffmpeg/CapCut)

1. Order clips exactly as beats 1→6 above (after the sub-shot split noted above).
2. Trim each sub-clip to its allotted window; hard-cut or short (≤0.2s) crossfade between beats —
   no `zoompan`/Ken-Burns stills filters (documented cause of the frozen-frame regression in
   `REEL-PIPELINE.md` §"Render-integrity gate").
3. Burn in captions from `captions.srt` (below), bottom-third safe zone, high-contrast style
   matching the account's existing caption preset.
4. Composite the Nick's Tire & Auto logo and CTA text on beat 6 only, in post (not generated).
5. Mix voiceover (TTS, not produced this session — no TTS credential available) as the primary
   audio layer; add a 3s freeze-frame "SAVE" card after 0:30 per the storyboard contract used by
   the render-integrity gate (container duration = beats + 3s freeze ≈ 33s).
6. Export 9:16, 1080×1920, H.264, target ≥30fps throughout (render-integrity gate requires ≥80% of
   expected 30fps frame count).

### Posting specs

- Platform: Instagram Reels + Facebook Reels (cross-post), per the existing account routing.
- Dimensions: 1080×1920 (9:16), H.264, AAC audio.
- Primary caption: "That clunk when you shift into Drive after your car's been sitting? One clue:
  transmission fluid level. Worth a check before it gets worse. 🔧 #NicksTireAndAuto"
- Hashtags: `#CarMaintenance #TransmissionFluid #CarCare #AutoRepair #ClevelandOhio #NicksTireAndAuto`
- Alt-text (accessibility): "Video explaining why an automatic transmission may delay engaging gear
  after a car has been parked, and how a fluid check can help identify the cause."

### Ad-ready variants (hook / caption / CTA)

**Variant A**
- Hook: "You shift into Drive — and nothing happens for a second. Then a clunk."
- Caption: "That delay before your car engages gear isn't nothing. One clue: transmission fluid
  level. Stop by and we'll take a look."
- CTA: "Stop by and we'll take a look."

**Variant B**
- Hook: "Worse in the morning. Worse after it's been parked. Here's one clue why."
- Caption: "A delayed clunk into gear can point to low or worn transmission fluid. Worth checking
  before it turns into real wear."
- CTA: "Worth checking before it gets worse."

## 5. Credit-risk and fallback routing

- No live read of `getHiggsfieldAccountHealth()` or `autonomy_policy_versions.limits` this session
  (no DB/API access). Per `generationLedger.ts`'s documented estimates: `seedance_clip` ≈
  $0.25/clip (labeled ASSUMPTION in source), `template_stock_clip` = $0 (free local ffmpeg lane),
  `veo_second_720p` ≈ $0.10/sec (Google-published). At ~10–12 sub-clips after the render-integrity
  split, a Seedance-routed render would estimate **~$2.50–$3.00**; the `template_stock` lane
  (currently pinned in prod per `REEL-PIPELINE.md`, unverified live) would estimate **$0**.
- `maxGenerationCostPerDayUsd` and today's spend against it: **UNKNOWN** — no live
  `autonomy_policy_versions` read this session.
- Fallback routing: `REEL_FALLBACK_TO_TEMPLATE_STOCK` governs degrade-not-dark behavior if a paid
  provider hits a terminal verdict — this pack does not depend on knowing that flag's live value
  since no real generation call is made here.

## 6. Audio and music rights

**Real gap, not filled here.** No music-rights ledger exists in this repo (per the skill's
documented gap). This pack specifies voiceover only (TTS, not produced this session — no
credential available); no music bed is proposed. If a music bed is added downstream, its asset ID,
source, license scope, territory, expiry, and organic/ad clearance status are **UNKNOWN/BLOCKED**
until a rights record is created — do not treat silence on this point as clearance.

## 7. QA matrix

| Gate | Status | Basis |
|---|---|---|
| Brief-time quality score (`calculateReelQualityScore`) | `UNKNOWN` | Not run — no live client/server code path invoked this session; self-scored informally in §2 instead |
| Server re-score at enqueue | `UNKNOWN` | No `enqueueReelJob` call made — no DB access |
| Render-integrity gate (#800/#801) | `BLOCKED` | No render exists; nothing to measure duration/frame-count/motion-MD5 against |
| Rendered QA / vision critic (`renderedQa.ts`) | `BLOCKED` | No rendered frames exist |
| Repair routing (`repairRouter.ts`) | `N/A` | Not applicable — no job was ever created |
| Consolidated publish gate (`evaluateReelPublishGate`) | `BLOCKED` | Cannot evaluate without a job row; per the gate's own contract, absence of evidence is not evidence of quality — this is reported as `BLOCKED`, not a silent pass |
| Claim-safety wording check | `PASS` | Manually verified against the approved soft-language list in `client/src/lib/facelessReelStudio.ts` — script uses only *one clue · can · worth checking · don't guess · stop by and we'll take a look*; no price, guarantee, or fearmongering language present |
| Repetition/topic-novelty check | `PASS` | Checked against 100+ merged/open topics offline (§1); no overlap found. Not a substitute for the live `REPEAT_TOPIC` (7-day) DB check, which was not run |

## 8. IG/FB copy + ad variants

See "Posting specs" and "Ad-ready variants" under §4 above.

## 9. Final status

**READY FOR HUMAN APPROVAL.** No MP4 exists. No `/api/admin/reel-canary` call, no DB read, and no
publish action was made this session — consistent with the skill's hard rule that a scheduled
firing never authorizes a real generation, spend, or publish action. This pack is ready for a human
operator to review, approve, and feed into a live `PRODUCTION`/`DRAFT` run with an actual operator
instruction, or to hand-produce via CapCut using the script, prompts, and captions above.
