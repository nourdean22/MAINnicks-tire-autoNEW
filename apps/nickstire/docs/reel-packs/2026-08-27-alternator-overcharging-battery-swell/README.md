# Reel pack — "Your alternator can overcharge a battery — and it looks nothing like a dead one"

Produced by a **scheduled task** firing (2026-08-27), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read. This
session made none of those calls. Deliverable is a full production-ready **pack**, not a claimed
render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-27 (session clock).
- Capability check this session:
  `env | grep -ioE '^[A-Z_]+' | grep -iE 'higgsfield|reel|admin_api|instagram|meta|database_url|openai|anthropic'`
  returned only `ANTHROPIC_BASE_URL` — no Higgsfield credential, no `ADMIN_API_KEY`, no
  `DATABASE_URL`, no TTS provider key, no Meta/Instagram token. Also checked local binaries:
  `ffmpeg` — **missing**, `hf`/`higgsfield` CLI — **missing**. Result: **BLOCKED: NO MOTION ROUTE**
  this session -> full pack produced per the skill's explicit fallback, not a downgraded stills-only
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
  - `ls apps/nickstire/docs/reel-packs/` — **~99 merged pack directories** (`2026-08-14` through
    `2026-08-25`), topics spanning tires, brakes, cooling, electrical, drivetrain, HVAC, and
    emissions.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack" in:title)`
    — **19 open, unreviewed draft PRs** at time of this run, newest #1917 (idle air control valve,
    created 2026-08-27T03:31Z, ~hours before this run). Backlog history from prior status-only PRs:
    132 open (2026-08-25 15:32) -> 12 (2026-08-26 06:47) -> 19 now. The crisis-level spike was
    already cleared; 19 sits inside the normal range those same notes treated as non-blocking
    (12–17), not the 132-level crisis that justified a status-only run instead of a new pack.
  - Checked this pack's topic (alternator **overcharging** — excess voltage, swollen/hot battery
    case, headlights brighter than normal) against all ~118 merged-or-pending topics — **no direct
    overlap found.** Nearest neighbors are `wont-start-battery-starter-alternator` (a **no-charge**
    /no-start diagnosis, the opposite electrical fault), `alternator-bearing-whine-vs-belt-squeal`
    (a **mechanical noise** symptom, not a voltage-output symptom), and `battery-terminal-corrosion`
    /`battery-parasitic-drain` (battery-side causes unrelated to the alternator's output voltage).
    This script deliberately names "overcharging" and "swollen case" to keep it distinguishable from
    all three.
  - **Backlog note, not escalated to a status-only PR:** 19 open reel-pack PRs is above the
    5-PR skip threshold from the 2026-08-20/21 notes but within the 12–17 "non-blocking, keeps
    landing at a manageable pace" range those same notes described after the 132-PR crisis was
    cleared. Flagging it for the operator; not blocking this run on it.

## 2. Candidate scores and selected concept

Single-concept run (topic backlog is not the binding constraint this run — see §1). Scored against
the skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "Too-bright headlights at night" is a visually concrete, curiosity-driving hook |
| Distinct symptom cluster | 5/5 | Overcharging (too much voltage) is mechanically the inverse of the already-covered no-charge/no-start topic — a genuinely separate failure mode |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing ~118 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 4/5 | All beats are plausible AI-gen or stock B-roll; no dealership-specific footage required |

Selected: **"Your alternator can overcharge a battery — and it looks nothing like a dead one."** No
runner-up concept was generated — single-topic run, consistent with sibling packs in this backlog
window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (a failed
  voltage regulator inside or attached to the alternator can push charging voltage well above the
  normal ~13.5–14.5V range; sustained overcharging can heat and off-gas a lead-acid battery enough
  to swell or distort its case, and can make headlights/dash lighting appear visibly brighter than
  normal), not a shop-specific sourced fact. `entailment` status: **`not_evaluated`** — mark
  `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the overcharging/battery-swell claim; whether
  Nick's Tire & Auto specifically stocks/services alternator and charging-system diagnosis (near-
  certain for a general repair shop, but not confirmed against a live `business_facts` row this
  session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Your headlights look brighter than usual at night. That's not always a good sign." |
| 0:04–0:09 | SYMPTOM | "Dash lights flicker or seem too bright. The battery case looks a little swollen." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: the alternator can overcharge the battery — pushing more voltage than it should." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "That extra voltage can cook a battery from the inside — long before it ever looks dead." |
| 0:21–0:26 | SAFE ACTION | "Don't guess at the voltage. A quick test can show what the charging system is actually doing." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before it costs you a battery. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't guess · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Night exterior shot: a car's headlights glowing unusually bright/white against a
   dark driveway or street, static-mounted camera, shallow depth of field.
2. **0:04–0:09** — Close-up on a dashboard cluster with lighting flickering slightly; cut to a
   macro shot of a car battery case with a visibly bulged/rounded top (not flat), dim garage
   lighting.
3. **0:09–0:15** — Macro/cutaway shot: an alternator on a workbench or still mounted in an engine
   bay, slow push-in, no hands or tools visible in frame.
4. **0:15–0:21** — Close-up on a multimeter display showing a voltage reading, needle/digits
   trending above a normal reference band, screen glow in a dim shop bay, meter mounted/clipped in
   frame (no hand holding it).
5. **0:21–0:26** — Multimeter probes resting clipped onto battery terminals under the hood, cable
   leads visible, shop bay softly blurred in the background.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six ~5s
beats as scripted above are too coarse on their own — recommend the assembler split beats 2, 3, and
5 into two sub-shots each (quick punch-in or angle change) to reach ~10–12 sub-clips at ~2.5–3s
apiece before this pack is fed to real generation. Flagging this explicitly rather than presenting
the 6-beat table as render-ready.

### Assembly instructions (ffmpeg/CapCut)

1. Order clips exactly as beats 1→6 above (after the sub-shot split noted above).
2. Trim each sub-clip to its allotted window; hard-cut or short (≤0.2s) crossfade between beats — no
   `zoompan`/Ken-Burns stills filters (documented cause of the frozen-frame regression in
   `REEL-PIPELINE.md` §"Render-integrity gate").
3. Burn in captions from `captions.srt` (below), bottom-third safe zone, high-contrast style
   matching the account's existing caption preset.
4. Composite the Nick's Tire & Auto logo and CTA text on beat 6 only, in post (not generated).
5. Mix voiceover (TTS, not produced this session — no TTS credential available) as the primary audio
   layer; add a 3s freeze-frame "SAVE" card after 0:30 per the storyboard contract used by the
   render-integrity gate (container duration = beats + 3s freeze ≈ 33s).
6. Export 9:16, 1080×1920, H.264, target ≥30fps throughout (render-integrity gate requires ≥80% of
   expected 30fps frame count).

### Posting specs

- Platform: Instagram Reels (primary), cross-post to Facebook Reels via the same asset.
- Dimensions: 1080×1920 (9:16), MP4, ≤30s target already met.
- Hashtags: `#CarMaintenance #AlternatorProblems #CarBattery #ElectricalSystem #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🔋 Headlights looking brighter than usual at night? One clue mechanics check: an
  alternator that's overcharging the battery — it can cook a battery long before it ever looks dead.
  Don't guess at the voltage. Stop by and we'll take a look. 🔧"

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` -> **estimated generation cost if run today: $0.00** for
  ~10–12 sub-clips on the free ffmpeg lane. This is a doc-inherited estimate, not a live balance
  read.
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
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Substituted directory + open-PR search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 8 | Unusually-bright-headlights-at-night close-up hook |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook -> symptom -> explanation -> consequence -> safe action -> CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "alternator," "overcharging," "battery," "voltage" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **51/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete and
internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close. No
render was attempted, no generation spend occurred, no DB was read, and no publish call was made. An
operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Your alternator can overcharge a battery — and
it looks nothing like a dead one"}` to re-score, render, and move toward publish.

**Operator note:** 19 open, unreviewed `reel pack` draft PRs exist at time of this run (newest
#1917). Backlog peaked at 132 on 2026-08-25 and was cleared to 12 by 2026-08-26; it has since grown
back to 19 — inside the previously-non-blocking 12–17 range but worth a batch-review pass before it
trends back toward the earlier crisis level.
