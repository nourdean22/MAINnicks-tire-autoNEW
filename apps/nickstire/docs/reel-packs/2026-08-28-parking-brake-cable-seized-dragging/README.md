# Reel pack — "Parking brake wouldn't release after a cold night? Here's one clue why."

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
  no TTS provider key, no Meta/Instagram token. Also checked local binaries: `ffmpeg` — **missing**
  (`which ffmpeg` exit 1), `gh` — **missing** (`which gh` exit 1; GitHub access this session goes
  through the connected GitHub MCP tools instead). Result: **BLOCKED: NO MOTION ROUTE** this
  session → full pack produced per the skill's explicit fallback, not a downgraded stills-only
  asset. `getHiggsfieldAccountHealth()` was **not called** (no running server, no credentials, no
  network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Treat this as inherited
  doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended run per `prod-db-guard`).
  Substituted the best available offline check instead:
  - `git ls-tree -d origin/main -- apps/nickstire/docs/reel-packs/` — **118 merged pack
    directories** (`2026-08-14` through `2026-08-27`), spanning tires, brakes, cooling, electrical,
    drivetrain, HVAC, and emissions.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack"
    in:title)` — **11 open reel-pack PRs** at run start (#1927, #1932, #1941, #1942, #1945, #1948
    [a backlog-status doc, not a pack], #1952, #1953, #1954, #1955, #1956, #1957), covering:
    synthetic vs. conventional oil, fuel injector tick, foggy-windshield recirculate trick, engine
    pinging/knocking, grinding starter, steering-wheel vibration, brake dust, battery-fine-till-cold,
    grinding brakes on first stop, new-brakes squeak, washer fluid freezing. This is a real backlog
    signal — 11 packs awaiting merge/review is worth operator attention — but this session was not
    given a live instruction to merge them, so none were merged or touched; only a new pack was
    added, consistent with this run's scope.
  - A second targeted search — `"parking brake" OR "e-brake" OR "emergency brake" in:title` — **0
    open or closed matches**, live-confirming novelty for this specific topic across all PR history,
    not just the open queue.
  - Checked this pack's topic (a seized/rusted parking-brake cable dragging one rear wheel) against
    all 118 merged topics and all 11 open PR topics — **no overlap found.** Nearest neighbors are
    `road-salt-brake-lines` (corrosion on hydraulic brake **lines**, not the mechanical parking-brake
    **cable**), `brake-pedal-sinks-overnight` (a hydraulic **pedal** fault, unrelated to the separate
    cable-actuated parking brake), `caliper-sticking-hot-wheel` (a hydraulic caliper piston sticking
    from heat, not a cable seizing from cold/rust), and `squealing-vs-grinding-brakes` (a wear-noise
    topic, not a stuck-actuation topic). The script below names the parking-brake **cable** and the
    **cold/rust-seizure** trigger explicitly to keep it distinguishable from all four.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this series. Scored against the skill's
rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament access this
session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "Parking brake wouldn't release after a cold night?" — a relatable, specific seasonal moment, matches this series' proven hook shape |
| Distinct symptom cluster | 5/5 | Cable seizure from cold/rust causing partial drag on ONE wheel — mechanically specific, not a generic "brake noise" topic |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing 118 merged + 11 open topics | 5/5 | No overlap found (see §1); live PR-title search across all history also came back empty |
| Producibility (faceless, no live footage needed) | 4/5 | All beats are plausible AI-gen or stock B-roll/underbody shots; no dealership-specific footage required |

Selected: **"Parking brake wouldn't release after a cold night? Here's one clue why."** No
runner-up concept was generated — single-topic run, consistent with sibling packs in this series.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (a
  cable-actuated parking brake can develop surface rust or ice inside its housing or at the
  equalizer, especially after cold, wet, or salted-road exposure, which can keep the cable from
  fully retracting and leave a shoe or caliper partially engaged on one wheel — producing drag,
  uneven heat, a burning smell, or a pull), not a shop-specific sourced fact. `entailment` status:
  **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made as fact — the script frames "a cold night" as a scenario
  cue in the hook, not an assertion about current Cleveland weather.
- **UNKNOWN, explicitly:** live entailment status of the cable-seizure/wheel-drag claim; whether
  Nick's Tire & Auto specifically services parking-brake cables (near-certain for a general repair
  shop, but not confirmed against a live `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Parking brake wouldn't release after a cold night?" |
| 0:04–0:09 | SYMPTOM | "One rear wheel dragging, a burning smell, or the car pulling after you release it." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: the parking brake cable, rusted or frozen inside its housing." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "A stuck cable can keep that wheel partly engaged — wearing the brake and tire faster." |
| 0:21–0:26 | SAFE ACTION | "Don't guess — a quick check can free the cable or catch it early." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before one dragging wheel becomes a bigger repair. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't guess · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Exterior wide shot of a car parked in a driveway on a frosty winter morning,
   static-mounted camera, pale cold morning light, light frost visible on the windshield and hood.
2. **0:04–0:09** — Close-up on a rear wheel with a faint heat-haze shimmer near the wheel well
   implying drag, slow push-in; cut to a dashboard parking-brake indicator light glowing amber.
3. **0:09–0:15** — Macro/cutaway shot: a parking brake cable and its housing on a workbench,
   visible surface rust and ice crystals at the cable sheath and equalizer, slow push-in.
4. **0:15–0:21** — Close-up on a rear brake caliper or drum-shoe assembly with a subtle red-tinted
   heat-glow overlay suggesting excess friction/wear, static mount, dim shop-bay lighting.
5. **0:21–0:26** — Underbody inspection shot: an inspection light and a cable-release tool
   positioned near the parking-brake mechanism (tool visible, mounted/clipped — no hand in frame),
   shop bay softly blurred behind.
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
- Hashtags: `#CarMaintenance #ParkingBrake #WinterCarCare #CarNoises #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🅿️🔧 Parking brake stuck after a cold night? One clue mechanics check: a rusted
  or frozen cable that keeps one wheel partly engaged. Left alone, that drag can wear the brake and
  tire faster. Don't guess — stop by and we'll take a look. 🚗"

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
| Brief-time quality score (`calculateReelQualityScore`, 70/75 floor) | **UNKNOWN** (self-estimated ~50/75, see §8) | No live scorer run this session — self-scored against the published rubric, not a substitute for the real function |
| Server re-score at enqueue | **BLOCKED** | No `/api/admin/reel-canary {action:"start"}` call made — no credentials/route |
| Render-integrity gate (#800/#801) | **N/A — not rendered** | No MP4 exists this session |
| Rendered QA / vision critic (`renderedQa.ts`) | **N/A — not rendered** | Same |
| Repair routing / 7-way decision | **N/A** | No job exists to route |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED (by absence of a job)** | Cannot evaluate a gate against a nonexistent render — this is the gate's own `unavailable` state, not a silent pass |
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Directory scan (118 merged) + all-history PR-title search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 7 | Frosty-morning hook is relatable and seasonal but slightly less visceral than a dashboard-warning hook |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "parking brake," "cable," "dragging" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **50/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Parking brake wouldn't release after a cold
night? Here's one clue why."}` to re-score, render, and move toward publish.

**Operator note:** at run start, 11 reel-pack PRs were already open and unmerged (#1927 through
#1957, listed in §1) — a real backlog signal. This session was not given a live instruction to
review or merge them, so it did not touch them; it only filed this one new pack, consistent with
its own scope. Flagging the backlog here rather than silently adding to it unremarked.
