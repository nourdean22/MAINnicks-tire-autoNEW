# Reel pack — "EGR valve clogged: the rough idle that isn't a spark plug"

Produced by a **scheduled task** firing (2026-08-23), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-23 (session clock).
- Capability check this session: `env | grep -Ei 'REEL|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|OPENAI|ELEVEN|TTS'`
  returned **nothing** — no `HIGGSFIELD_CREDENTIALS_JSON`, no `ADMIN_API_KEY`, no `DATABASE_URL`,
  no TTS provider key. `getHiggsfieldAccountHealth()` was **not called** (no path to reach it — no
  running server, no credentials). Result: **BLOCKED: NO MOTION ROUTE** this session → full pack
  produced per the skill's explicit fallback, not a downgraded stills-only asset.
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Treat this as inherited
  doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the best available offline check instead:
  - `ls apps/nickstire/docs/reel-packs/` — 82 merged pack directories, topics spanning tires,
    brakes, cooling, electrical, drivetrain, HVAC, emissions.
  - `search_pull_requests(is:open "reel pack" in:title)` — **4 open, unreviewed draft PRs**
    already exist: #1782 (worn motor mount clunk), #1783 (rotten egg exhaust smell / rich
    catalytic converter), #1785 (oil pressure light flicker at idle), #1788 (clutch slipping /
    RPM flare). Oldest is ~19h old with zero review activity.
  - Checked this pack's topic (EGR valve, carbon-clogged, rough idle + P0401) against all 86
    merged-or-pending topics — no overlap. Nearest neighbors are `gas-cap-check-engine-light`
    (different root cause: loose cap, not carbon buildup), `pcv-valve-oil-consumption` (different
    valve, different symptom — oil consumption, not idle/hesitation), and
    `echeck-readiness-monitors` (readiness-monitor reset, not a specific failed component).
  - **Flag for the operator, not silently absorbed:** 4 open reel-pack PRs are sitting unreviewed.
    This is the same backlog-pileup failure mode the skill file documents from 2026-08-14/15
    (eight packs, eight directories) recurring in a new shape — now it's unreviewed PRs, not
    scattered directories, because every run correctly uses the shared directory convention but
    nothing merges them. Recommend a batch review pass before the queue grows further.

## 2. Candidate scores and selected concept

Single-concept run (topic backlog is not the constraint this run — see §1). Scored against the
skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | Dashboard warning light + audible rough-idle framing is a proven hook shape in this pack series |
| Distinct symptom cluster | 5/5 | Hesitation-on-accel + idle shake + P0401 is mechanically specific, not generic "check engine light" |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing 86 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 4/5 | All beats are plausible AI-gen or stock B-roll; no dealership-specific footage required |

Selected: **"EGR valve clogged: the rough idle that isn't a spark plug."** No runner-up concept
was generated — single-topic run, consistent with sibling packs in this backlog window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (EGR valve
  carbon fouling causing rough idle/hesitation, OBD-II code P0401 as the associated DTC), not a
  shop-specific sourced fact. `entailment` status: **`not_evaluated`** — mark `UNKNOWN`, not
  `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts:
  no price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the P0401/EGR claim; whether Nick's Tire &
  Auto's shop specifically stocks/services EGR valve diagnosis (near-certain for a general repair
  shop, but not confirmed against a live `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Your check engine light is on. Idle feels rough." |
| 0:04–0:09 | SYMPTOM | "Engine hesitates when you accelerate. Idle dips or shakes at a stop." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: a clogged EGR valve. Carbon buildup can block it from closing right." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "That can trip a P0401 code — and it may not clear on its own." |
| 0:21–0:26 | SAFE ACTION | "Don't guess which part it is. A scan tool narrows it down fast." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before it fails an emissions test. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · may · worth checking · don't guess · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Close-up dashboard instrument cluster, check-engine light illuminated amber,
   subtle vibration blur on the tachometer needle at idle, dim interior lighting, shallow depth of
   field, static-mounted camera (no hand holding a phone).
2. **0:04–0:09** — Low-angle shot of an idling engine bay under the hood, visible micro-vibration
   at idle; cut to exterior tailpipe with faint irregular exhaust puffs.
3. **0:09–0:15** — Macro/cutaway shot: an EGR valve removed and resting on a workbench, visible
   dark carbonized soot buildup inside the valve passage, slow push-in.
4. **0:15–0:21** — Close-up on an OBD-II scan-tool screen displaying a trouble-code readout
   (P0401), screen glow in a dim shop bay, tool mounted/clipped in frame (no hand in shot).
5. **0:21–0:26** — Scan tool connected via cable under the dash, data scrolling on-screen, shop bay
   softly blurred in the background.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six
~5s beats as scripted above are too coarse on their own — recommend the assembler split beats
2, 3, and 5 into two sub-shots each (quick punch-in or angle change) to reach ~10–12 sub-clips
at ~2.5–3s apiece before this pack is fed to real generation. Flagging this explicitly rather than
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
- Hashtags: `#CarMaintenance #CheckEngineLight #EGRValve #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🔧 Rough idle + check engine light? One clue mechanics check: a clogged EGR
  valve. Carbon buildup can trip a P0401 code — don't guess, get it scanned. Worth checking before
  it fails an emissions test. Stop by and we'll take a look. 🛠️"

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
| First-frame scroll-stop (10) | 8 | Dashboard warning-light close-up hook |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "check engine light," "rough idle," "EGR valve," "P0401" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **51/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"EGR valve clogged: the rough idle that isn't
a spark plug"}` to re-score, render, and move toward publish.

**Operator note:** 4 open, unreviewed `reel pack` draft PRs already exist (#1782, #1783, #1785,
#1788) — worth a batch review pass before the queue grows further.
