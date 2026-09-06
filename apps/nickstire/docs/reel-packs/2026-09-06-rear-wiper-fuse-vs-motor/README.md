# Reel pack — "Rear wiper stopped moving? Don't assume the motor's dead yet."

Produced by a **scheduled task** firing (2026-09-06), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read. This
session made none of those calls. Deliverable is a full production-ready **pack**, not a claimed
render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE`/`PRODUCTION` per the skill's mode table —
  research/score/pack only, no render, no publish).
- Timestamp: 2026-09-06 (session clock).
- Capability check this session: `which ffmpeg` — missing; `which capcut` — missing; `env | grep -iE
  'openai|higgsfield|meta|facebook|instagram|elevenlabs|tts|graph_api|admin_api_key|database_url'` —
  no matches. No ChatGPT, TTS, Higgsfield, Meta-posting, or CapCut tool exists in this session's
  toolset either. Result: **BLOCKED: NO MOTION ROUTE** this session -> full pack produced per the
  skill's explicit fallback, not a downgraded stills-only asset. `getHiggsfieldAccountHealth()` was
  **not called** (no running server, no credentials, no network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — treated as inherited doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the best available offline check instead:
  - `ls apps/nickstire/docs/reel-packs/2026-*/` — **152 existing pack directories**
    (`2026-08-14` through `2026-09-06`, including today's `coolant-reservoir-safe-check` and
    `nitrogen-vs-air-tire-fill`), this pack's own topic checked against all of them.
  - `grep -rli "rear wiper"` across every pack `README.md` — **zero hits.** No existing pack covers
    rear-wiper failure; the closest adjacent topics are `wiper-blade-check` (front blade
    streaking/chatter, a wear-quality issue, not a motor/fuse/linkage failure) and
    `washer-fluid-wont-spray` (pump failure, different subsystem) — neither overlaps this pack's
    fuse/motor/linkage diagnosis angle.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack"
    in:title)` — **1 open PR** at time of this run (#2140, a "backlog status — 0 open PRs, no new
    pack" note, not a content pack). No collision.
  - Still unresolved from prior runs (no DB access this session either): whether migration
    `0112_reel_publish_approvals.sql` has been applied to production TiDB. Treating the publish
    door as still shut absent explicit operator confirmation.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this backlog window. Scored against the
skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "Don't assume the motor's dead" is a save-money/myth-check hook, a proven shape in this backlog (same family as the AC-recharge-myth and nitrogen packs) |
| Distinct symptom cluster | 5/5 | No existing pack covers rear-wiper failure at all (see §1) |
| Claim safety | 5/5 | No price, no guarantee, no invented timeline — soft language only |
| Novelty vs. existing 152 topics | 5/5 | Zero-hit grep confirms no overlap (see §1) |
| Producibility (faceless, no live footage needed) | 5/5 | All beats are static macro/interior shots (fuse box, rear glass, hatch trim); no moving-hand or dealership-specific footage required |

Selected: **"Rear wiper stopped moving? Don't assume the motor's dead yet."** No runner-up concept
was generated — single-topic run.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). The claims below are **general automotive knowledge**, not shop-specific sourced
  facts:
  - "Rear wiper circuits usually run on their own fuse, separate from the front wiper circuit" — a
    standard modern-vehicle wiring convention, not a universal guarantee (stated as "usually," not
    "always").
  - "A motor that hums but doesn't move the arm points to a seized linkage or worn motor gearbox,
    not a dead motor" — a standard mechanical-diagnosis fact (power is reaching the motor if it
    hums; a silent motor with zero fuse issue points elsewhere).
  - `entailment` status for both claims: **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Script deliberately contains **zero** shop-specific
  facts: no price for a fuse swap or wiper-motor repair, no hours, no phone number, no warranty
  claim — sidesteps the documented `FactChannel` gap (no `"reel"`/`"social"` scope exists yet).
- No weather/seasonal/local-event claim made anywhere in this script.
- **UNKNOWN, explicitly:** live entailment status of the two claims above; whether
  `0112_reel_publish_approvals.sql` has been applied to production (see §1, §7).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Rear wiper stopped moving? Don't assume the motor's dead yet." |
| 0:04–0:10 | CONTEXT | "Most rear wiper failures aren't the motor at all — it's a blown fuse, and it usually has its own, separate from the front." |
| 0:10–0:17 | VALUE | "Check the fuse box first. If it's blown, that's a five-minute fix, not a motor replacement." |
| 0:17–0:23 | CAVEAT | "If the fuse is fine but you hear a hum with no movement, that points to the linkage or motor — that one needs a look." |
| 0:23–0:27 | SAFE ACTION / BRANDED CTA | "Worth checking the fuse before you assume the worst. Stop by and we'll take a look." |

Total runtime: 27s (within the 20–35s creative-quality-floor window). Approved soft language used:
*worth checking · stop by and we'll take a look.* No prices, no guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Macro shot of a rear windshield wiper arm resting against dark tinted glass,
   static camera, overcast exterior light, no motion.
2. **0:04–0:10** — Close-up of a vehicle interior fuse box panel (driver-side kick panel style),
   rows of colored fuses in focus, static camera, no hand or arm in frame.
3. **0:10–0:17** — Extreme macro push-in on a single pulled fuse held in a small fixture/clip (not a
   hand), showing the blown metal element inside, soft studio-style side light.
4. **0:17–0:23** — Interior shot looking up into the open rear hatch trim area where a wiper motor
   linkage would sit, dim ambient garage light, static mounted camera, no hand or tool in frame.
5. **0:23–0:27** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md`).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Five ~5s
beats as scripted above are borderline — recommend the assembler split beat 2 (fuse box, 6s) into
two sub-shots (wide panel view, then a push-in on one fuse row) to comfortably clear the
≥4-distinct-clip / motion-cadence requirement before this pack is fed to real generation. Flagging
this explicitly rather than presenting the 5-beat table as render-ready.

### Assembly instructions (ffmpeg/CapCut)

1. Order clips exactly as beats 1→5 above (after the sub-shot split noted above).
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
- Hashtags: `#RearWiper #WiperMotor #CarMaintenance #AutoRepair #FuseCheck #DIYCarCheck #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🌧️ Rear wiper stopped working? Before you assume the motor's dead, check the
  fuse — it's usually separate from the front wiper's. A blown one is a five-minute fix, not a
  motor swap. Hear a hum with no movement instead? That's the linkage or motor. Stop by and we'll
  take a look."

### Two ad-ready hook/caption/CTA variants

**Variant A — myth-check angle**
- Hook: "Rear wiper dead? Check this before you buy a new motor."
- Caption: "Most rear wiper failures are a blown fuse, not the motor. Five-minute fix if that's
  all it is."
- CTA: "Stop by and we'll take a look."

**Variant B — diagnostic-sound angle**
- Hook: "Rear wiper humming but not moving? That's not a fuse problem."
- Caption: "A hum with no movement means the fuse is fine — it's the linkage or motor gearbox
  instead. Worth a proper look."
- CTA: "Worth checking first. Stop by and we'll take a look."

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` -> **estimated generation cost if run today: $0.00** for
  ~6 sub-clips on the free ffmpeg lane. This is a doc-inherited estimate, not a live balance read.
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
| Brief-time quality score (`calculateReelQualityScore`, 70/75 floor) | **UNKNOWN** (self-estimated ~51/75, see §8) | No live scorer run this session — self-scored against the published rubric, not a substitute for the real function |
| Server re-score at enqueue | **BLOCKED** | No `/api/admin/reel-canary {action:"start"}` call made — no credentials/route |
| Render-integrity gate (#800/#801) | **N/A — not rendered** | No MP4 exists this session |
| Rendered QA / vision critic (`renderedQa.ts`) | **N/A — not rendered** | Same |
| Repair routing / 7-way decision | **N/A** | No job exists to route |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED (by absence of a job)** | Cannot evaluate a gate against a nonexistent render — this is the gate's own `unavailable` state, not a silent pass |
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Substituted directory + grep + open-PR search per §1; no live DB read |
| Publish-approvals migration (`0112_reel_publish_approvals.sql`) | **UNKNOWN** | Flagged unresolved by prior runs; no DB access this session either to check |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 6 | Rear-wiper-on-glass hook is clean but quieter than a warning light or failure event |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook -> context -> value -> caveat -> safe action/CTA, all present |
| Length (5) | 5 | 27s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "rear wiper," "fuse," "motor" language present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **51/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete and
internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close. No
render was attempted, no generation spend occurred, no DB was read, and no publish call was made. An
operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Rear wiper stopped moving? Don't assume the
motor's dead yet."}` to re-score, render, and move toward publish — contingent on
`0112_reel_publish_approvals.sql` (§1, §7) actually being applied, which remains unconfirmed.

**Operator note:** only 1 open "reel pack" PR exists at the time of this run (#2140, a status note,
not unmerged content) — the backlog remains clear. No escalation needed this run.
