# Reel pack — "Power seat suddenly won't move? Don't assume the motor's dead yet."

Produced by a **scheduled task** firing (2026-09-01), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-09-01 (session clock).
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
  - `ls apps/nickstire/docs/reel-packs/` — **129 merged pack directories** (`2026-08-14` through
    `2026-08-28`), spanning tires, brakes, cooling, electrical, drivetrain, HVAC, exhaust,
    emissions, and body/interior mechanisms. Nearest neighbors in the "power X won't move"
    interior-mechanism family: `power-window-stuck-halfway` (2026-08-21), `power-mirror-wont-move`
    (2026-08-28), `trunk-hatch-gas-strut-sag` (2026-08-23), `door-lock-actuator-stripped-gear`
    (2026-08-23) — none of them is a power seat, and none turns on "fuse vs. motor vs. connector"
    as the diagnostic trigger.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack"
    in:title)` — **3 open reel-pack PRs**: #2044 "seatbelt warning light stays on after buckling"
    (seatbelt sensor, not seat motor), #2041 "car alarm false-trigger (hood latch / fob battery)",
    #2037 "clutch pedal sinking to the floor / hydraulic leak" (plus #2038, a backlog-status PR
    with no new pack). None is about a power seat or seat motor/track.
  - Checked this pack's topic (a power seat that won't move at all, and the fuse-vs-connector-vs-motor
    triage angle) against all 129 merged + 3 open topics — **no overlap found.**

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this series. Scored against the skill's
rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament access this
session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "Power seat suddenly won't move? Don't assume the motor's dead yet." — specific, relatable, contrarian-curiosity hook |
| Distinct symptom cluster | 5/5 | Total loss of seat movement, triaged by fuse/connector/motor — mechanically specific, distinct from every existing "power X" body-mechanism topic |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing 129 merged + 3 open topics | 5/5 | No overlap found (see §1); closest neighbors (power window, power mirror, trunk strut, door lock actuator) are different mechanisms and none uses the fuse-vs-motor triage angle |
| Producibility (faceless, no live footage needed) | 4/5 | All beats are plausible AI-gen or stock B-roll/interior-and-fusebox shots; no dealership-specific footage required |

Selected: **"Power seat suddenly won't move? Don't assume the motor's dead yet."** No runner-up
concept was generated — single-topic run, consistent with sibling packs in this series.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (power-seat
  circuits run through a dedicated fuse, and the seat-track wiring harness routes through a
  flex/hinge point at the seat base that is a common site for a loosened or corroded connector;
  either fault presents identically to a failed seat motor — no movement, and on many circuits no
  audible motor hum — so checking the fuse and connector before condemning the motor is standard
  triage order), not a shop-specific sourced fact. `entailment` status: **`not_evaluated`** — mark
  `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the fuse/connector-before-motor triage claim;
  whether Nick's Tire & Auto's actual customer-facing electrical-diagnostic process specifically
  checks the fuse and connector before quoting a seat-motor replacement (near-certain for any
  general-repair shop, but not confirmed against a live `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Power seat suddenly won't move? Don't assume the motor's dead yet." |
| 0:04–0:09 | SYMPTOM | "No hum, no click, nothing at all when you press the switch — that's the first clue." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: a blown fuse or a corroded connector under the seat can look identical to a dead motor." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "Chase the wrong part first, and you can end up paying for a motor you didn't need." |
| 0:21–0:26 | SAFE ACTION | "Don't guess which one it is before you check." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before you replace the wrong part. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't guess · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines. "You can end up paying for a motor you didn't need" states a
real consequence of mis-diagnosis in general terms, without naming a specific price or shop policy
as fact.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Interior shot of a driver's seat and door panel, static-mounted low-angle camera
   showing the seat track and switch panel on the seat's side, dim garage lighting, slight
   handheld-style micro-shake for tension.
2. **0:04–0:09** — Close-up on a power-seat switch/toggle panel, static hold, subtle push-in; cut
   to the seat sitting motionless in frame.
3. **0:09–0:15** — Macro/cutaway shot: a vehicle fuse box panel open, one blown fuse highlighted
   among a row of intact ones, workbench lighting, slow push-in on the blown fuse.
4. **0:15–0:21** — Macro cutaway shot on a seat-track wiring harness connector with visible
   corrosion/oxidation on the pins, dim shop-bay lighting, static hold, subtle grain to suggest age.
5. **0:21–0:26** — Wide shot of a multimeter clipped onto a wiring harness near the seat track
   (tool visible, mounted/clipped — no hand in frame), shop bay softly blurred behind.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six ~5s
beats as scripted above are too coarse on their own — recommend the assembler split beats 2, 3,
and 4 into two sub-shots each (quick punch-in or angle change) to reach ~10–12 sub-clips at
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

- Platform: Instagram Reels (primary), cross-post to Facebook Reels via the same asset.
- Dimensions: 1080×1920 (9:16), MP4, ≤30s target already met.
- Hashtags: `#CarMaintenance #CarElectrical #PowerSeat #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto #CarProblems`
- Caption (feed): "🔧 Power seat won't budge? Before you assume the motor's dead — check the fuse
  and the connector under the seat first. Don't pay for a motor you didn't need. 🚗"

Ad-ready variant A (hook/caption/CTA): Hook — "Power seat stopped moving — and you're already
dreading a motor replacement?" Caption — "Not so fast. A blown fuse or a corroded connector under
the seat can look exactly like a dead motor." CTA — "Stop by Nick's Tire & Auto — we'll take a
look before you replace anything."

Ad-ready variant B (hook/caption/CTA): Hook — "No hum, no movement, no reason to assume the
worst." Caption — "Power-seat motors get blamed for problems that actually start at a fuse or a
connector. Don't guess which one it is." CTA — "Nick's Tire & Auto — worth checking, no pressure."

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` → **estimated generation cost if run today: $0.00** for
  ~10–12 sub-clips on the free ffmpeg lane. This is a doc-inherited estimate, not a live balance
  read.
- `getHiggsfieldAccountHealth().balanceCredits`: **UNKNOWN** — not called this session (no
  credentials, no server).
- Day's `autonomy_policy_versions.limits.maxGenerationCostPerDayUsd` (documented default $10):
  **not read live this session** — treat as UNKNOWN, not assumed available.
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
| Brief-time quality score (`calculateReelQualityScore`, 70/75 floor) | **UNKNOWN** (self-estimated ~49/75, see §8) | No live scorer run this session — self-scored against the published rubric, not a substitute for the real function |
| Server re-score at enqueue | **BLOCKED** | No `/api/admin/reel-canary {action:"start"}` call made — no credentials/route |
| Render-integrity gate (#800/#801) | **N/A — not rendered** | No MP4 exists this session |
| Rendered QA / vision critic (`renderedQa.ts`) | **N/A — not rendered** | Same |
| Repair routing / 7-way decision | **N/A** | No job exists to route |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED (by absence of a job)** | Cannot evaluate a gate against a nonexistent render — this is the gate's own `unavailable` state, not a silent pass |
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Directory scan (129 merged) + open-PR title search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 7 | "Don't assume the motor's dead yet" is a relatable, curiosity-driven contrarian hook |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 3 | "power seat," "fuse," "motor" present in captions, slightly less keyword-dense than tire/brake topics |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **49/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Power seat suddenly won't move? Don't assume
the motor's dead yet."}` to re-score, render, and move toward publish.
