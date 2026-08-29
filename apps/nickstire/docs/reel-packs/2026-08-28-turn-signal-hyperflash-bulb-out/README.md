# Reel pack — "Your blinker flashing fast? That's your car telling you a bulb is out."

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
  Substituted the best available offline check, per the skill's duplicate-check step (checking
  BOTH the merged directory AND open PRs, since a pack opens as a draft PR before it merges):
  - `ls apps/nickstire/docs/reel-packs/` — **~150 merged pack directories** (`2026-08-14` through
    `2026-08-27`), spanning tires, brakes, cooling, electrical, drivetrain, HVAC, and emissions.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack" in:title)`
    — **15 open PRs** (#1927 through #1962, created 2026-08-27T13:35Z through 2026-08-28T04:31Z).
    A batch merge cleared the prior 23-PR backlog around 2026-08-27T13:00Z (per the u-joint pack's
    operator note), so this is a normal ~15-hour accumulation since the last review sweep, not the
    multi-day, zero-action backlog six prior scheduled runs (#1842 through #1921) had flagged. No
    separate status-only note filed this run — the last status note (`BACKLOG-STATUS-2026-08-27-1130.md`)
    already made that recommendation once; the situation it described has since changed (a batch
    merge occurred), so a fresh content pack is the useful contribution this run, not a repeat
    escalation.
  - A targeted search — `"turn signal" OR blinker OR hyperflash OR "flasher relay" in:title` —
    returned **zero matching pack PRs** (one unrelated hit: #1945 "grinding starter noise," matched
    only by the word "turn" inside "turns"). Live-confirms novelty beyond the directory scan.
  - Checked this pack's topic (rapid/hyper-flashing turn signal indicating a burned-out bulb)
    against all ~150 merged topics and all 15 open PR titles — **no overlap found.** Nearest
    neighbors are `battery-parasitic-drain` (a **drain** symptom, diagnosed with a multimeter over
    time — not a visible flash-rate change) and `dashboard-light-colors` (dash **indicator** colors,
    not exterior bulb/flasher-relay behavior). Both are different symptom clusters and different
    diagnostic paths from a hyperflashing blinker.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this series. Scored against the skill's
rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament access this
session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 5/5 | "Your blinker's flashing fast for a reason" — a symptom nearly every driver has seen, high curiosity pull |
| Distinct symptom cluster | 5/5 | Flash-RATE change (not color, not a dash light) specifically signals a burned-out exterior bulb — mechanically specific, visually demonstrable without dashboard footage |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing ~150 topics + 15 open PRs | 5/5 | No overlap found (see §1); live PR-title search also came back empty |
| Producibility (faceless, no live footage needed) | 5/5 | Every beat is a plausible stock/AI-gen exterior or macro bulb shot; no dealership-specific footage, no dashboard interior shot required |

Selected: **"Your blinker flashing fast? That's your car telling you a bulb is out."** No
runner-up concept was generated — single-topic run, consistent with sibling packs in this series.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-electrical knowledge** (a
  turn-signal flasher relay — thermal or electronic — is calibrated to a normal bulb-circuit
  resistance/current draw; a burned-out exterior bulb drops the circuit's resistance, which the
  relay reads as reduced load and compensates by cycling faster, producing the "hyperflash" a
  driver sees on the dash indicator and hears as a faster click), not a shop-specific sourced fact.
  `entailment` status: **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the hyperflash/bulb-out claim; whether Nick's
  Tire & Auto specifically stocks common exterior bulbs on-site (near-certain for a general repair
  shop, but not confirmed against a live `business_facts` row this session). The script avoids
  asserting same-day stock as fact.

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Your blinker flashing fast? That's your car talking to you." |
| 0:04–0:09 | SYMPTOM | "A sudden double-speed click, or a dash arrow blinking twice as fast as normal." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: a burned-out turn-signal bulb changes the circuit — the relay speeds up to compensate." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "It's easy to miss from the driver's seat — but other drivers can't see your turn at all." |
| 0:21–0:26 | SAFE ACTION | "Don't guess which bulb. A quick check can spot it in minutes." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before it becomes a ticket — or a close call. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't guess · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines. "Before it becomes a ticket — or a close call" states a real,
generic consequence of an inoperative turn signal (a traffic-code equipment violation and a
visibility/safety risk to other drivers) without naming a specific citation amount or jurisdiction
as fact.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Rear three-quarter shot of a sedan at dusk/night, turn signal visibly blinking
   at a noticeably fast rate, static-mounted camera, shallow depth of field, slightly urgent pacing.
2. **0:04–0:09** — Close-up on a dashboard turn-signal indicator arrow blinking rapidly (no other
   dash details in frame, no driver visible); cut to an exterior close-up of the same blinking
   tail-light lens.
3. **0:09–0:15** — Macro/cutaway shot: a removed turn-signal bulb held in a bulb-testing fixture
   (no hand), filament visibly broken/dark next to a working bulb for contrast, slow push-in.
4. **0:15–0:21** — Wide shot from a following vehicle's rough POV at night showing one working
   taillight/blinker and one dark or malfunctioning side, subtle dramatic emphasis via lighting.
5. **0:21–0:26** — Underhood/exterior inspection shot: an inspection light and multimeter probe
   positioned near a tail-light housing (tools visible, mounted/clipped — no hand in frame), shop
   bay softly blurred behind.
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

- Platform: Instagram Reels (primary), cross-post to Facebook Reels via the same asset.
- Dimensions: 1080×1920 (9:16), MP4, ≤30s target already met.
- Hashtags: `#CarMaintenance #TurnSignal #CarTips #AutoRepair #DriveSafe #ClevelandAuto #NicksTireAndAuto #CarElectrical`
- Caption (feed): "🔧 Blinker clicking fast? One clue: a burned-out bulb speeds up the relay — and
  means other drivers can't see your turn. Don't guess which one — stop by and we'll take a look. 🚗"

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
| Brief-time quality score (`calculateReelQualityScore`, 70/75 floor) | **UNKNOWN** (self-estimated ~52/75, see §8) | No live scorer run this session — self-scored against the published rubric, not a substitute for the real function |
| Server re-score at enqueue | **BLOCKED** | No `/api/admin/reel-canary {action:"start"}` call made — no credentials/route |
| Render-integrity gate (#800/#801) | **N/A — not rendered** | No MP4 exists this session |
| Rendered QA / vision critic (`renderedQa.ts`) | **N/A — not rendered** | Same |
| Repair routing / 7-way decision | **N/A** | No job exists to route |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED (by absence of a job)** | Cannot evaluate a gate against a nonexistent render — this is the gate's own `unavailable` state, not a silent pass |
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Directory scan (~150 topics) + live PR-title search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 8 | A visibly rapid-flashing blinker at dusk/night is an immediately legible, relatable hook |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "blinker," "turn signal," "bulb" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **51/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Your blinker flashing fast? That's your car
telling you a bulb is out."}` to re-score, render, and move toward publish.

**Operator note on the PR queue:** 15 reel-pack PRs are currently open (#1927–#1962, accumulated
over ~15 hours since the last batch-review sweep around 2026-08-27T13:00Z). This is a normal
between-review gap, not the multi-day stall six earlier scheduled runs (#1842–#1921) had to
escalate — so this run adds one new, verified-novel content pack rather than filing another
status-only note. If the queue grows past this point without a review, the next scheduled run
should re-flag it per the precedent in `BACKLOG-STATUS-2026-08-27-1130.md`.
