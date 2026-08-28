# Reel pack — "That grinding sound when you turn the key might be a worn starter"

Produced by a **scheduled task** firing (2026-08-27), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-27 (session clock).
- Capability check this session:
  `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|OPENAI|ANTHROPIC|META_|INSTAGRAM|FACEBOOK|TTS|CAPCUT'`
  returned no relevant credential (only unrelated proxy/`ANTHROPIC_BASE_URL` noise) — no Higgsfield
  credential, no `ADMIN_API_KEY`, no `DATABASE_URL`, no TTS provider key, no Meta/Instagram token.
  Also checked local binaries: `ffmpeg` — **missing**, `gh` — **missing** (GitHub access this
  session goes through the connected GitHub MCP tools instead). Result: **BLOCKED: NO MOTION
  ROUTE** this session -> full pack produced per the skill's explicit fallback, not a downgraded
  stills-only asset. `getHiggsfieldAccountHealth()` was **not called** (no running server, no
  credentials, no network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Treat this as inherited
  doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended run per `prod-db-guard`).
  Substituted the best available offline check instead:
  - `ls apps/nickstire/docs/reel-packs/` — **117 merged pack directories** (`2026-08-14` through
    `2026-08-27`), spanning tires, brakes, cooling, electrical, drivetrain, HVAC, and emissions.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack"
    in:title)` — **4 open PRs**: #1942 (synthetic vs. conventional oil), #1932 (engine
    pinging/knocking under acceleration), #1927 (steering wheel vibration at highway speed), #1941
    (grinding brakes on first stop of the day). None overlap this pack's topic.
  - Checked this pack's topic (a worn starter's drive gear/bendix grinding against the flywheel
    ring gear specifically **at key-turn/cranking**, engine otherwise starts fine) against all 117
    merged topics and the 4 open PRs — **no overlap found.** Nearest neighbors are
    `wont-start-battery-starter-alternator` (a **no-start** elimination flow — battery vs. starter
    vs. alternator — not the specific grinding-noise symptom on a car that *does* start),
    `motor-mount-clunk-acceleration` (a clunk under acceleration, unrelated trigger and unrelated
    part), `alternator-bearing-whine-vs-belt-squeal` (a running-engine whine, not a cranking-only
    grind), and `key-fob-dead-battery-no-start` (a fob/immobilizer no-start, no grinding sound at
    all). The script below names the cranking-only trigger and the flywheel/bendix mechanism
    explicitly to keep it distinguishable from all four.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this series. Scored against the skill's
rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament access this
session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "That grinding sound when you turn the key isn't your imagination" — direct, matches this series' proven hook shape |
| Distinct symptom cluster | 5/5 | Grinding specifically **during cranking only**, engine runs fine once started — mechanically specific to a worn starter drive gear/bendix, not a generic no-start topic |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing 117 topics + 4 open PRs | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 4/5 | All beats are plausible AI-gen or stock B-roll/underbody shots; no dealership-specific footage required |

Selected: **"That grinding sound when you turn the key might be a worn starter."** No runner-up
concept was generated — single-topic run, consistent with sibling packs in this series.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (a worn
  starter drive gear — the "bendix" — no longer meshes cleanly with the flywheel's ring gear,
  producing a grinding or screeching sound only during the moment of cranking; the engine, once
  running, is unaffected; left unaddressed, the ring gear teeth themselves can wear and the car can
  eventually fail to start at all), not a shop-specific sourced fact. `entailment` status:
  **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the starter-grinding claim; whether Nick's
  Tire & Auto specifically stocks/services starter replacement (near-certain for a general repair
  shop, but not confirmed against a live `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "That grinding sound when you turn the key isn't your imagination." |
| 0:04–0:09 | SYMPTOM | "It only happens for that one second of cranking — then the engine runs fine." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: a worn starter gear not meshing clean with the flywheel." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "Ignore it, and those flywheel teeth can wear too — then it may not start at all." |
| 0:21–0:26 | SAFE ACTION | "Don't guess. A quick check can catch it before you're stuck." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before one grind turns into a no-start. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't guess · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines. "Then it may not start at all" alludes to a real failure mode
(progressive ring-gear wear -> eventual no-start) without naming a specific outcome or timeline as
fact.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Interior POV shot of a hand-free ignition/key cylinder area (no hand in frame,
   dashboard focus), morning light through a windshield, static-mounted camera.
2. **0:04–0:09** — Cutaway to an engine bay wide shot with a subtle vibration/shudder cue timed to
   an implied grinding sound, then a quick cut to a dashboard tachometer needle settling to a
   smooth idle.
3. **0:09–0:15** — Macro/cutaway shot: a starter motor's drive-gear (bendix) assembly removed and
   resting on a workbench, visible wear on the gear teeth, slow push-in, shop lighting.
4. **0:15–0:21** — Macro shot of a flywheel ring gear with visible worn/chipped teeth on a section,
   static mount, dim shop-bay lighting for emphasis.
5. **0:21–0:26** — Underbody/engine-bay inspection shot: an inspection light or diagnostic tool
   positioned near the starter motor's mounting location (tool visible, mounted/clipped — no hand
   in frame), shop bay softly blurred behind.
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
- Hashtags: `#CarMaintenance #StarterMotor #CarNoises #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto #WontStart`
- Caption (feed): "🔧 Hear a grind right when you turn the key, then it runs fine? One clue
  mechanics check: a worn starter gear not meshing clean with the flywheel. Ignore it and it can
  eventually leave you stuck. Don't guess — stop by and we'll take a look. 🚗"

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` -> **estimated generation cost if run today: $0.00** for
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
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Directory scan (117 topics) + live PR-title search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 6 | Ignition/dashboard hook is relatable but less visceral than a dashboard-warning-light hook |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "grinding," "starter," "flywheel" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **49/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"That grinding sound when you turn the key
might be a worn starter"}` to re-score, render, and move toward publish.
