# Reel pack — "Parking sensors beeping like something's there — when nothing is?"

Produced by a **scheduled task** firing (2026-09-07), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read. This
session made none of those calls. Deliverable is a full production-ready **pack**, not a claimed
render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE`/`PRODUCTION` per the skill's mode table —
  research/score/pack only, no render, no publish).
- Timestamp: 2026-09-07 (session clock).
- Capability check this session: `which ffmpeg` — missing; `which capcut` — no such tool; `env |
  grep -iE 'HIGGSFIELD|REEL_|ADMIN_API_KEY|DATABASE_URL|OPENAI|ANTHROPIC_API|TTS|META_|FACEBOOK|
  INSTAGRAM'` — no matches; only `apps/nickstire/.env.example` exists on disk, not a real `.env`.
  This session's tool list has no ChatGPT/TTS/Higgsfield/Meta-posting/CapCut connector (an Adobe
  Express/Firefly connector is present but has no TTS/voice-generation primitive and no
  Higgsfield/Meta bridge). Result: **BLOCKED: NO MOTION ROUTE** this session -> full pack produced
  per the skill's explicit fallback, not a downgraded stills-only asset. `getHiggsfieldAccountHealth()`
  was **not called** (no running server, no credentials, no network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — treated as inherited doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the best available offline check instead:
  - `ls apps/nickstire/docs/reel-packs/` — **164 existing pack directories** (`2026-08-14` through
    `2026-09-07`, this pack's own topic checked against every one of them).
  - `mcp__github__list_pull_requests(state:open)` — **1 open PR** at the time of this run (#2156,
    `docs(nickstire): reel-pack backlog status — merged 3 stranded PRs, no new pack`) — a
    backlog-status PR, not an in-flight reel-pack topic. No collision risk from it.
  - Checked this pack's topic (parking-assist sensors false-alarming on dirt/ice/salt buildup)
    against all 164 merged topics — no overlap. The closest existing packs are
    `2026-09-04-backup-camera-black-screen` (a different sensor system — rearview camera, not
    ultrasonic park-assist) and `2026-09-04-blind-spot-sensor-light` (a warning-light-stays-on
    story, not a false-positive-beeping story). Neither covers ultrasonic parking-sensor false
    alarms or the clean-the-sensor fix, which is this pack's distinct angle.
  - Still unresolved from prior runs (no DB access this session either): whether migration
    `0112_reel_publish_approvals.sql` has been applied to production TiDB. Treating the publish
    door as still shut absent explicit operator confirmation.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this backlog window. Scored against the
skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | Direct annoyance hook ("beeping like something's there — when nothing is") targets a common, relatable frustration |
| Distinct symptom cluster | 5/5 | No existing pack covers ultrasonic parking-sensor false alarms (see §1) |
| Claim safety | 5/5 | No price, no guarantee, no invented timeline — soft language only |
| Novelty vs. existing 164 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 5/5 | All beats are static macro/dash/scanner shots; no moving-hand or dealership-specific footage required |

Selected: **"Parking sensors beeping like something's there — when nothing is? Here's the first
thing to check."** No runner-up concept was generated — single-topic run.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). The claims below are **general automotive knowledge**, not shop-specific sourced
  facts:
  - "Ultrasonic parking sensors can misread dirt, ice, road salt, or a stuck-on sticker/wrap as an
    obstruction" — a widely documented behavior of ultrasonic park-assist systems, hedged as "can"
    rather than asserted universally (some false alarms have other causes).
  - "A sensor that still false-alarms after a real cleaning may indicate a sensor or wiring fault,
    not just buildup" — standard diagnostic knowledge, stated with the approved hedge "may
    indicate."
  - `entailment` status for both: **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Script deliberately contains **zero** shop-specific
  facts: no price for a sensor diagnostic/replacement, no hours, no phone number, no warranty claim
  — sidesteps the documented `FactChannel` gap (no `"reel"`/`"social"` scope exists yet).
- No weather/seasonal/local-event claim in this script beyond the generic "ice or road salt" causes,
  which are stated as one possible cause among several (dirt, ice, salt, sticker/wrap), not as a
  claim about current Cleveland conditions.
- **UNKNOWN, explicitly:** live entailment status of the two claims above; whether Nick's Tire &
  Auto specifically offers a parking-sensor diagnostic/cleaning/replacement service (near-certain
  for a full-service shop, but not confirmed against a live `business_facts` row this session — the
  script avoids asserting the shop offers or performs a specific procedure, only that a persistent
  false alarm is worth a look); whether `0112_reel_publish_approvals.sql` has been applied to
  production (see §1).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Parking sensors beeping like something's there — when nothing is?" |
| 0:04–0:10 | CONTEXT | "Usually it's dirt, ice, or road salt covering a sensor, not a wiring fault." |
| 0:10–0:17 | VALUE | "Wipe down each sensor on the bumper — the small round discs, not the badge or the camera — with a soft cloth." |
| 0:17–0:23 | CAVEAT | "Still beeping after a clean bumper? May indicate a sensor or wiring issue, not just buildup." |
| 0:23–0:27 | SAFE ACTION / BRANDED CTA | "Worth checking if it doesn't clear. Stop by and we'll take a look." |

Total runtime: 27s (within the 20–35s creative-quality-floor window). Approved soft language used:
*may indicate · worth checking · stop by and we'll take a look.* No prices, no guarantees, no
invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Macro shot of a rear bumper corner, focus racking onto a small round
   parking-sensor disc embedded in the bumper skin, static camera, overcast daylight, no plate or
   badge in frame.
2. **0:04–0:10** — Interior close-up on a dashboard/infotainment cluster's parking-assist icon
   (the display's own physical/graphic icon, not a generated text overlay) illuminated, static
   mounted camera, dim ambient cabin light.
3. **0:10–0:17** — Cut sequence of two contrasting macro shots: one sensor disc caked with
   road-salt haze/grime, one clean sensor disc, consistent studio-style lighting, static/locked
   camera on each — implies "before/after" without any hand, cloth, or human figure in frame.
4. **0:17–0:23** — Close-up of a handheld diagnostic scanner plugged into an OBD port beneath a
   dash, screen glow visible but soft-focus (no readable digits/text in frame), static camera, no
   hand or arm holding the device (device appears clipped/mounted in frame).
5. **0:23–0:27** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md`).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Beat 3 (the
dirty/clean sensor comparison, 7s) should be shot/cut as at least two visually distinct sub-clips as
written above — confirm the assembler actually cuts between both rather than holding one static
macro for the full 7s, which would fail the motion-cadence check. Flagging this explicitly rather
than presenting the 5-beat table as render-ready.

### Assembly instructions (ffmpeg/CapCut)

1. Order clips exactly as beats 1→5 above (beat 3 cut into its two sub-shots per the note above).
2. Trim each sub-clip to its allotted window; hard-cut or short (≤0.2s) crossfade between beats — no
   `zoompan`/Ken-Burns stills filters (documented cause of the frozen-frame regression in
   `REEL-PIPELINE.md` "Render-integrity gate" section).
3. Burn in captions from `captions.srt` (below), bottom-third safe zone, high-contrast style
   matching the account's existing caption preset.
4. Composite the Nick's Tire & Auto logo and CTA text on beat 5 only, in post (not generated).
5. Mix voiceover (TTS, not produced this session — no TTS credential available) as the primary audio
   layer; add a 3s freeze-frame "SAVE" card after 0:27 per the storyboard contract used by the
   render-integrity gate (container duration = beats + 3s freeze ≈ 30s).
6. Export 9:16, 1080×1920, H.264, target ≥30fps throughout (render-integrity gate requires ≥80% of
   expected 30fps frame count).

### Posting specs

- Platform: Instagram Reels (primary), cross-post to Facebook Reels via the same asset.
- Dimensions: 1080×1920 (9:16), MP4, ≤30s target already met.
- Hashtags: `#ParkingSensors #CarMaintenance #CarTips #AutoRepair #DriverTips #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🚗 Parking sensors going off like something's there when it isn't? Nine times out
  of ten it's dirt, ice, or road salt on a sensor, not a wiring problem. Wipe down the small round
  discs on the bumper. Still beeping after that? Worth a look — stop by and we'll check it out."

### Two ad-ready hook/caption/CTA variants

**Variant A — "false alarm" angle**
- Hook: "Why do my parking sensors keep beeping at nothing?"
- Caption: "Usually it's grime, ice, or road salt on a sensor — not a wiring fault. A quick wipe-down
  clears most of them. Still going off after that? Worth checking."
- CTA: "Stop by and we'll take a look."

**Variant B — "know which disc" angle**
- Hook: "Those little round discs on your bumper aren't decoration."
- Caption: "That's your parking sensor. Dirt, ice, or salt buildup on it is the #1 cause of false
  alarms. Wipe it down first before assuming it's broken."
- CTA: "Still beeping? Stop by and we'll take a look."

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` -> **estimated generation cost if run today: $0.00** for
  ~7 sub-clips on the free ffmpeg lane. This is a doc-inherited estimate, not a live balance read.
- `getHiggsfieldAccountHealth().balanceCredits`: **UNKNOWN** — not called this session (no
  credentials, no server).
- Day's `autonomy_policy_versions.limits.maxGenerationCostPerDayUsd` (documented default $10): **not
  read live this session** — treat as UNKNOWN, not assumed available.
- Fallback routing: `REEL_FALLBACK_TO_TEMPLATE_STOCK` behavior not exercised — no generation was
  attempted.

## 6. Audio/music rights status

**Real gap, not papered over:** no music-rights ledger exists in this repo (documented gap in the
`nickstire-reel-operator` skill). No music bed is assigned to this pack. Voiceover-only audio via
TTS (not produced this session — no TTS credential available in this session's environment) plus
captions is the safe default until a rights-tracked bed exists.

## 7. QA matrix

| Gate | Status | Basis |
|---|---|---|
| Brief-time quality score (`calculateReelQualityScore`, 70/75 floor) | **UNKNOWN** (self-estimated ~50/75, see §8) | No live scorer run this session — self-scored against the published rubric, not a substitute for the real function |
| Server re-score at enqueue | **BLOCKED** | No `/api/admin/reel-canary {action:"start"}` call made — no credentials/route |
| Render-integrity gate (#800/#801) | **N/A — not rendered** | No MP4 exists this session |
| Rendered QA / vision critic (`renderedQa.ts`) | **N/A — not rendered** | Same |
| Repair routing / 7-way decision | **N/A** | No job exists to route |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED (by absence of a job)** | Cannot evaluate a gate against a nonexistent render — this is the gate's own `unavailable` state, not a silent pass |
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Substituted directory + open-PR search per §1; no live DB read |
| Publish-approvals migration (`0112_reel_publish_approvals.sql`) | **UNKNOWN** | Flagged unresolved by prior runs; no DB access this session either to check |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 6 | Bumper macro + relatable annoyance hook is clean but quieter than a dashboard warning light or failure event |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook -> context -> value -> caveat -> safe action/CTA, all present |
| Length (5) | 5 | 27s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "Parking sensors," "beeping," "sensor" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **49/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete and
internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close. No
render was attempted, no generation spend occurred, no DB was read, and no publish call was made. An
operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Parking sensors beeping like something's there
— when nothing is? Here's the first thing to check."}` to re-score, render, and move toward publish
— contingent on `0112_reel_publish_approvals.sql` (§1, §7) actually being applied, which remains
unconfirmed.

**Operator note:** no in-flight reel-pack PR collision this run (0 open topic PRs found — #2156 is
a backlog-status PR only). No escalation needed this run.
