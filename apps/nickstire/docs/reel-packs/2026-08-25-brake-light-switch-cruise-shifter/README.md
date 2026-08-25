# Reel pack — "A worn brake light switch can quietly disable cruise control and shift-lock release"

Produced by a **scheduled task** firing (2026-08-25), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-25, ~19:30 session clock.
- Capability check this session: `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL'`
  returned **nothing** — no Higgsfield credential, no `ADMIN_API_KEY`, no `DATABASE_URL`.
  `which ffmpeg gh` — both **missing**; `node`/`pnpm`/`curl` present but unused (no endpoint to
  call, no server running). Result: **BLOCKED: NO MOTION ROUTE** this session →
  full pack produced per the skill's explicit fallback, not a downgraded stills-only asset.
  `getHiggsfieldAccountHealth()` was **not called** — no credentials, no running server.
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (free local-ffmpeg lane),
  not Higgsfield/Seedance. Inherited doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the best available offline check:
  - `ls apps/nickstire/docs/reel-packs/` — **~103 merged pack directories** (`2026-08-14` through
    today), topics spanning tires, brakes, cooling, electrical, drivetrain, HVAC, and emissions.
    No existing directory covers a brake-light-switch / cruise-control / shift-lock topic.
  - `search_pull_requests` + `list_pull_requests(state=open)` — **only 4 open PRs currently match
    "reel pack" in the title**: #1835 (exhaust manifold leak, cold-start tick), #1842 (a prior
    run's backlog-status note, which reported **127 open PRs** at 16:29 today), #1857 (AC
    compressor clutch), #1865 (rear defroster). **That is a striking drop from the 127 PR #1842
    reported roughly 3 hours ago** — the most plausible read is the operator acted on #1842's
    recommendation and batch-reviewed/merged the backlog in the interim (consistent with ~103
    merged directories now on disk, up from the 92 a prior run counted on 2026-08-24). Not
    independently confirmed via merge-commit history this session — flagging the inference rather
    than asserting it as fact.
  - Checked this pack's topic against every merged/open topic title — no overlap. Nearest
    neighbors are `brake-fluid-moisture-test`, `spongy-brake-pedal`, `warped-rotor-brake-shake`,
    `brake-pedal-sinks-overnight`, `caliper-sticking-hot-wheel`, and `squealing-vs-grinding-brakes`
    — all are hydraulic/friction-side brake symptoms. This topic is the electrical brake-light
    **switch** signal path (cruise-control inhibit, shift-lock release) — a different failure mode
    entirely, deliberately named as such in the script to keep it distinguishable from the
    existing brake-symptom cluster.
  - **Cadence note, not escalated to a status-only PR:** the open-PR backlog is healthy (3 actual
    pack PRs, not 127), so this run proceeds with a real pack rather than a fourth "no new pack"
    status note. Still worth surfacing: #1835, #1857, and #1865 were all opened *after* #1842's
    16:29 stand-down request (15:32, 17:34, 18:36 — three more scheduled firings within the same
    ~3-hour window the operator was presumably batch-reviewing the prior 127). If the firing
    interval is close to hourly, the backlog observed in #1842 will very likely reform even after
    today's cleanup. The standing recommendation from the 2026-08-20/21/25 status notes — reduce
    or pause this task's cadence at the account/trigger level, or add a lightweight auto-merge/
    auto-close step so packs don't require full manual review — remains open. Not re-escalating to
    a fifth status-only report since the backlog itself is currently fine.

## 2. Candidate scores and selected concept

Single-concept run (topic backlog is not the binding constraint this run — see §1). Scored
against the skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no
DB/tournament access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "Your cruise control stopped working — and it might not be the cruise system" is a curiosity/misdirection hook |
| Distinct symptom cluster | 5/5 | Cruise-control inhibit + shift-lock release from a worn brake-light switch is mechanically specific and not covered by any existing brake pack |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing ~103 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 4/5 | All beats are plausible AI-gen or stock B-roll; no dealership-specific footage required |

Selected: **"A worn brake light switch can quietly disable cruise control and shift-lock
release."** No runner-up concept generated — single-topic run, consistent with sibling packs in
this backlog window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). The underlying claim — the brake pedal switch supplies the "brake applied" signal
  used to permit cruise-control engagement and to release the automatic-transmission shift-lock
  solenoid, and a worn/misadjusted switch can silently drop that signal without necessarily
  killing the brake lights themselves — is **general automotive-electrical knowledge**, not a
  shop-specific sourced fact. `entailment` status: **`not_evaluated`** — mark `UNKNOWN`, not
  `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel`
  has no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is
  cleared for this script regardless — the script deliberately contains **zero** shop-specific
  facts: no price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the brake-switch/cruise/shift-lock claim;
  whether Nick's Tire & Auto specifically stocks a replacement brake-light switch on hand (near-
  certain for a general repair shop, but not confirmed against a live `business_facts` row this
  session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Your cruise control stopped working — and it might not be the cruise system at all." |
| 0:04–0:09 | SYMPTOM | "Shifter feels stuck in park too. Brake lights still look fine when you check them." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: a worn brake light switch. It tells the computer the pedal was pressed." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "If that signal doesn't get through, cruise control and shift-lock release can both stay off." |
| 0:21–0:26 | SAFE ACTION | "Don't guess which module is bad. The switch is a simple, common check first." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before you chase the wrong part. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language
used: *one clue · can · worth checking · don't guess · stop by and we'll take a look.* No prices,
no guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Close-up on a steering-wheel cruise-control button/indicator, dashboard cruise
   light staying dark when pressed, dim interior lighting, static-mounted camera.
2. **0:04–0:09** — Close-up on a shifter in PARK with a brief resistance to movement; cut to a
   rear three-quarter shot of the vehicle's brake lights illuminated normally in a dim garage.
   `renderIntegrityNote`: split into two ~2.5s sub-shots before real generation.
3. **0:09–0:15** — Macro/cutaway shot: a brake-pedal switch/plunger assembly mounted near the
   pedal arm under the dash, visible wear on the plastic housing, slow push-in.
   `renderIntegrityNote`: split into wide + macro push-in sub-shots.
4. **0:15–0:21** — Close-up on an OBD-II style scan-tool screen showing a brake-switch/cruise-
   inhibit signal status, screen glow in a dim shop bay, tool mounted/clipped in frame.
5. **0:21–0:26** — Scan tool connected via cable under the dash, data scrolling on-screen, shop
   bay softly blurred in the background. `renderIntegrityNote`: split into two sub-shots.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six ~5s
beats as scripted above are too coarse on their own — recommend the assembler split beats 2, 3,
and 5 into two sub-shots each (as noted per-beat) to reach ~10–12 sub-clips at ~2.5–3s apiece
before this pack is fed to real generation. Flagging this explicitly rather than presenting the
6-beat table as render-ready.

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
6. Export 9:16, 1080×1920, H.264, target ≥30fps throughout (render-integrity gate requires ≥80%
   of expected 30fps frame count).

### Posting specs

- Platform: Instagram Reels (primary), cross-post to Facebook Reels via the same asset.
- Dimensions: 1080×1920 (9:16), MP4, ≤30s target already met.
- Hashtags: `#CarMaintenance #CruiseControl #CarElectrical #CheckEngine #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🚗 Cruise control quit and the shifter feels stuck? One clue mechanics check
  first: the brake light switch. It tells your car's computer the pedal was pressed — miss that
  signal and both features can go dark, even with working brake lights. Don't guess. Stop by and
  we'll take a look. 🔧"

### Ad-ready hook/caption/CTA variants

1. **Hook:** "Cruise control just stopped working — for a reason you wouldn't expect."
   **Caption:** "A worn brake light switch can silently block the signal your cruise control and
   shifter need. Worth checking before you chase the wrong repair."
   **CTA:** "Stop by and we'll take a look."
2. **Hook:** "Shifter feels stuck in park? Check this before anything else."
   **Caption:** "One clue mechanics check first: the brake light switch. A simple, common part —
   don't guess at bigger repairs before it's ruled out."
   **CTA:** "Bring it in — we'll check it."

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
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Substituted directory + open-PR search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 8 | Cruise-light-stays-dark close-up hook |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` row read this session — see §3 |
| Faceless (10) | 10 | No faces/hands anywhere in the script or prompts |
| Claim safety (10) | 9 | Approved soft language throughout; no prices/guarantees |
| Keyword (5) | 3 | "cruise control", "brake light switch", "shift-lock" present but not dense |
| Winning-concept floor (5, requires ≥57/60 elsewhere) | 0 | No live critic-panel/tournament score exists this session |
| **Total** | **~50/75** | **Below the 70/75 floor — self-estimate only, not a pass/fail verdict** |

## 9. Final status

**READY FOR HUMAN APPROVAL** — not `PRODUCTION-READY`: the self-estimated quality score is below
the real gate's 70/75 floor (driven mainly by the unscored `sourcedFact` and `winningConceptFloor`
dimensions, both of which require a live evidence/tournament read this session could not make),
and no live render, QA, or publish gate has run. This is a full, human-reviewable production
pack — script, prompts, captions, assembly, posting specs — not a rendered file. **No MP4 exists.
Nothing was posted to Instagram, Facebook, or any other channel.**
