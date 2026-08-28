# Reel pack — "That pop from your exhaust when you let off the gas isn't just loud"

Produced by a **scheduled task** firing (2026-08-28), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-28 03:31 UTC (session clock).
- Capability check this session: `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL'`
  returned **nothing** — no Higgsfield credential, no `ADMIN_API_KEY`, no `DATABASE_URL`. Local
  binaries checked: `ffmpeg` — **missing**, `gh` — **missing** (GitHub access this session goes
  through the connected GitHub MCP tools instead). Result: **BLOCKED: NO MOTION ROUTE** this
  session → full pack produced per the skill's explicit fallback, not a downgraded stills-only
  asset. `getHiggsfieldAccountHealth()` was **not called** (no running server, no credentials, no
  network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — inherited doc-truth, not a live read this session.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended run per `prod-db-guard`).
  Substituted the best available offline + live checks instead:
  - `git ls-tree`/`ls apps/nickstire/docs/reel-packs/` — **129 merged pack directories**
    (`2026-08-14` through `2026-08-27`), spanning tires, brakes, cooling, electrical, drivetrain,
    HVAC, and emissions.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew "reel pack" in:title)` —
    **13 open PRs**, most opened within the last ~14 hours (up through 2026-08-28T02:31Z), **94
    merged** historically, last merge 2026-08-27T13:12Z. This is a normal in-flight backlog
    awaiting operator batch review, not a stuck queue — no escalation warranted this run (contrast
    with the 2026-08-23–27 status notes in this same directory, which correctly flagged a stalled
    22-open backlog at the time; that backlog has since cleared to 13).
  - A targeted novelty search — `search_pull_requests("backfire OR \"pop and bang\" OR \"popping
    sound\" in:title")` — returned **zero results**, live-confirming novelty for this specific
    symptom beyond the directory scan.
  - Checked this pack's topic (a pop/bang from the tailpipe specifically **on deceleration**, when
    lifting off the throttle) against all 129 merged topics plus the 13 open PR titles — **no
    overlap found.** Nearest neighbors are `rotten-egg-exhaust-smell-catalytic-converter-running-rich`
    (a **sulfur smell** from a rich mixture cooking the converter, not an audible pop on
    deceleration), `exhaust-suddenly-loud-rusted-muffler` (constant baseline **loudness** from a
    rusted-through muffler, not an intermittent decel pop), `turbo-whistle-vs-boost-leak`
    (a boost-related **whistle**, unrelated symptom and trigger), and `misfire-shudder-coil-vs-plug`
    (a **shudder under load**, not specifically a tailpipe pop when lifting off the gas). The
    script below names the deceleration trigger and the tailpipe location explicitly to keep it
    distinguishable from all four.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this series. Scored against the skill's
rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament access this
session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "That pop when you let off the gas isn't just loud" — curiosity-driven, names a sound most drivers have heard and dismissed |
| Distinct symptom cluster | 5/5 | Pop/bang specifically **on deceleration**, at the tailpipe — mechanically specific (unburned fuel igniting late in the exhaust), not a generic "exhaust noise" topic |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing 129 merged + 13 open topics | 5/5 | No overlap found (see §1); live PR-title search for "backfire"/"pop" also came back empty |
| Producibility (faceless, no live footage needed) | 4/5 | All beats are plausible AI-gen or stock B-roll/underbody/engine-bay shots; no dealership-specific footage required, no flame/fire depicted (heat-shimmer cue only, platform-safe) |

Selected: **"That pop from your exhaust when you let off the gas isn't just loud."** No runner-up
concept was generated — single-topic run, consistent with sibling packs in this series.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (a pop or
  bang from the tailpipe on deceleration is commonly caused by unburned fuel igniting late, inside
  the exhaust rather than the cylinder — associated with a vacuum leak, an ignition misfire, or a
  fuel mixture running rich), not a shop-specific sourced fact. `entailment` status:
  **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the decel-pop/vacuum-leak/misfire/rich-mixture
  claim; whether Nick's Tire & Auto specifically offers OBD-II scan diagnostics and vacuum-leak
  inspection (near-certain for a general repair shop, but not confirmed against a live
  `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "That pop from your exhaust when you let off the gas isn't just loud." |
| 0:04–0:09 | SYMPTOM | "A bang or backfire on deceleration — not every time, but enough to notice." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: unburned fuel igniting late, in the exhaust instead of the cylinder." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "That can point to a vacuum leak, a misfire, or a mixture running rich." |
| 0:21–0:26 | SAFE ACTION | "Don't guess which one. A scan and a listen can narrow it down fast." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before a pop becomes a bigger exhaust or engine repair. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can point to · worth checking · don't guess · stop by and we'll take a look.* No
prices, no guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles, flame, fire`

1. **0:00–0:04** — Rear three-quarter shot of a sedan or hatchback decelerating on a quiet
   residential street at dusk, static-mounted low camera near the tailpipe, brake-light glow
   implying the driver has lifted off the throttle.
2. **0:04–0:09** — Close-up on the exhaust tip with a subtle heat-shimmer/vapor puff timed to an
   implied pop (no flame, no visible ignition — heat distortion only, platform-safe), static mount.
3. **0:09–0:15** — Macro cutaway shot of an engine-bay vacuum hose with a visible hairline crack,
   slow push-in, dim under-hood lighting, static mount.
4. **0:15–0:21** — Wide underbody shot of the exhaust system's midpipe with a faint tailpipe
   vapor wisp, cut to a spark plug resting on a workbench showing carbon fouling.
5. **0:21–0:26** — Engine-bay inspection shot: a diagnostic scan-tool cable connected to an OBD-II
   port under the dash, indicator LED glow, cable self-supporting/clipped in frame — no hand visible.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Beats 2,
3, 4, and 5 (5–6s each) are too coarse on their own — recommend the assembler split each into two
sub-shots (quick punch-in or angle change) to reach ~10–12 sub-clips at ~2.5–3s apiece before this
pack is fed to real generation. Flagging this explicitly rather than presenting the 6-beat table as
render-ready.

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
- Hashtags: `#CarMaintenance #ExhaustSystem #CarBackfire #CarNoises #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🔧 Hear a pop or bang from your exhaust when you let off the gas? One clue: fuel
  igniting late, in the exhaust instead of the cylinder — can point to a vacuum leak, a misfire, or
  a mixture running rich. Don't guess — stop by and we'll take a look. 🚗"

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
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Directory scan (129 topics) + live PR-title search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 7 | Decel-pop hook is relatable and slightly novel (drivers hear it, rarely think about why) |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "backfire," "vacuum leak," "misfire" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **50/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"That pop from your exhaust when you let off
the gas isn't just loud"}` to re-score, render, and move toward publish.

**Operator note on the PR queue:** 13 reel-pack PRs are currently open (94 already merged), a
normal in-flight state awaiting batch review — no stuck-backlog escalation needed this run. If the
queue grows past ~25–30 open again without a merge, the next scheduled run should revert to a
backlog-status note instead of adding another content pack, per the precedent set by the
2026-08-23–27 status notes in this same directory.
