# Reel pack — "Your sunroof stopped mid-slide? Here's why it might not close."

Produced by a **scheduled task** firing (2026-09-04), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call, a live production-DB read, or any
Meta/Instagram post. This session made none of those calls. Deliverable is a full production-ready
**pack**, not a claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-09-04 (session clock).
- Capability check this session:
  `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|OPENAI|ANTHROPIC|META_|INSTAGRAM|FACEBOOK|TTS|CAPCUT'`
  returned only this session's own Claude Code / proxy plumbing (`ANTHROPIC_BASE_URL`, `NO_PROXY`
  lists, `JAVA_TOOL_OPTIONS`) — **no** Higgsfield credential, no `ADMIN_API_KEY`, no `DATABASE_URL`,
  no TTS provider key, no Meta/Instagram/Facebook token. Also checked local binaries: `ffmpeg` —
  **missing** (exit 1), `gh` — **missing** (exit 1; GitHub access this session goes through the
  connected GitHub MCP tools instead). Result: **BLOCKED: NO MOTION ROUTE** this session → full
  pack produced per the skill's explicit fallback, not a downgraded stills-only asset.
  `getHiggsfieldAccountHealth()` was **not called** (no running server, no credentials, no network
  path to it). Per the task instructions' own decision tree ("if tools are missing, produce a
  production-ready pack") this is the correct branch, and the scheduled prompt's step 5 ("do not
  claim a finished file exists unless rendered") is honored below.
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Inherited doc-truth, not a live
  read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended run per `prod-db-guard`).
  Substituted the best available offline check, per the skill's duplicate-check step (checking BOTH
  the merged directory AND open PRs — a pack opens as a draft PR before it merges):
  - `ls apps/nickstire/docs/reel-packs/` — **~145 merged pack directories** (`2026-08-14` through
    `2026-09-04`). Today (2026-09-04) already has 4 merged packs: `backup-camera-black-screen`,
    `fall-car-care-checklist`, `heated-seats-not-working`, `remote-start-not-working`. Only one
    directory mentions a sunroof at all: `2026-08-23-sunroof-drain-clog-water-leak` — a **drainage**
    fault (clogged drain tube causing a water leak), a different symptom and different diagnostic
    path from a sunroof that physically won't slide closed.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack"
    in:title)` — **4 open draft PRs today**, all created 2026-09-04: #2114 (blind spot monitor
    light), #2115 (CV axle boot grease-sling), #2116 (fuel filter clogged/hesitation-stalling),
    #2117 (EPS warning light). None overlaps a sunroof topic.
  - Checked this pack's topic (a sunroof that stops or won't fully close — track binding vs. motor
    failure) against all ~145 merged topics and all 4 open PR titles — **no overlap found** beyond
    the drainage-only sunroof pack noted above, which is a different fault and 12 days old (outside
    the 7-day `REPEAT_TOPIC` window).
  - **Cadence flag, not silently absorbed:** this is the **9th** reel-pack scheduled run today
    (2026-09-04), averaging roughly one per hour based on open-PR timestamps (12:36, 13:32, 14:32,
    15:32 UTC). The real pipeline's own daily feed-post cap is 2 (`RESERVATION_FEED_CAP`); this pack
    production step doesn't consume that cap directly (no enqueue/reservation call made), but 9
    same-day pack PRs is worth an operator review of the scheduled task's firing interval — flagged
    here per the skill's instruction to name gaps rather than paper over them, not something this
    session can change unilaterally.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this series. Scored against the skill's rubric
out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament access this
session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "Your sunroof stopped mid-slide" is a relatable, mildly alarming moment; slightly less universal than a pedal/brake symptom since not every vehicle has a sunroof |
| Distinct symptom cluster | 5/5 | A sunroof that binds on its track or has a failed motor is mechanically distinct from the existing drain-clog/water-leak pack — different cause, different fix, different visual demonstration |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing ~145 topics + 4 open PRs | 5/5 | No overlap found (see §1); live PR-title search also came back empty |
| Producibility (faceless, no live footage needed) | 5/5 | Every beat is a plausible stock/AI-gen macro/interior-headliner shot; no dealership-specific footage, no interior driver shot required |

Selected: **"Your sunroof stopped mid-slide? Here's why it might not close."** No runner-up concept
was generated — single-topic run, consistent with sibling packs in this series.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive knowledge** (a sunroof rides on
  a track guided by cables or a drive gear; debris, dried lubricant, or a worn track guide can cause
  it to bind partway; a separate failure mode is the sunroof motor itself — worn brushes or a
  stripped drive gear — which can stall the panel or make it move unevenly), not a shop-specific
  sourced fact. `entailment` status: **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the track-binding/motor-failure claims;
  whether a binding track is *more often* the cause vs. a failing motor in this shop's actual
  repair-order history (plausible that track binding is more common and cheaper to fix, but not
  confirmed against a live data row this session). The script deliberately states both possibilities
  as open, not ranked, to avoid asserting an unconfirmed probability as fact.

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Your sunroof stopped halfway — won't slide open or closed?" |
| 0:04–0:09 | SYMPTOM | "Not leaking, not loose — just stuck. That's a different problem." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: dirt or dried lubricant on the track can make it bind — a simple clean and re-grease." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "But if it's the motor — worn out or a stripped gear — that's not a cleaning job." |
| 0:21–0:26 | SAFE ACTION | "Don't force it. Forcing a stuck sunroof can turn a cheap fix into an expensive one." |
| 0:26–0:30 | BRANDED CTA | "Worth checking either way. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't guess/force · stop by and we'll take a look.* No prices,
no guarantees, no invented timelines. "Forcing a stuck sunroof can turn a cheap fix into an
expensive one" states a real, generic mechanical consequence without naming a specific cost or
failure rate as fact.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Interior shot looking up at a sunroof panel stopped partway open, headliner and
   sunroof frame visible, soft cabin light, static-mounted camera, slight push-in to build tension.
2. **0:04–0:09** — Close macro on the sunroof track edge (no hand, no tool in frame yet), subtle
   dust/grime texture visible along the rail, shallow depth of field.
3. **0:09–0:15** — Macro/cutaway shot: an inspection light angled along the track, revealing dried
   lubricant residue and light debris buildup in contrast light; slow rack focus from clean rail
   section to grimy section.
4. **0:15–0:21** — Cutaway to a sunroof motor/drive-gear assembly (generic automotive part, no
   badge/logo visible), soft workshop lighting, subtle rotation-stall motion suggesting a labored
   or uneven mechanism.
5. **0:21–0:26** — Interior shot again, sunroof panel static in its stuck position, brief pull-back
   to show full headliner context, calm and steady camera (no shake, contrasts with the "don't
   force it" caution).
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six ~5s
beats as scripted above are too coarse on their own — recommend the assembler split beats 2, 3, and
4 into two sub-shots each (quick punch-in or angle change) to reach ~10–12 sub-clips at ~2.5–3s
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
- Hashtags: `#CarMaintenance #SunroofRepair #CarTips #AutoRepair #DriveSafe #ClevelandAuto #NicksTireAndAuto #CarCare`
- Caption (feed): "🔧 Sunroof stuck halfway? One clue: dirt or dried lube on the track — simple
  clean and re-grease. But a worn motor or stripped gear is a different job. Don't force it — stop
  by and we'll take a look. 🚗"

#### Two ad-ready hook/caption/CTA variants

| Variant | Hook | Caption | CTA |
|---|---|---|---|
| A (curiosity) | "Sunroof stuck? Here's the cheap fix vs. the one that isn't." | "Two totally different causes, one shared symptom. Worth knowing which you've got before it gets worse." | "Stop by and we'll take a look — Nick's Tire & Auto, Euclid." |
| B (caution) | "Forcing a stuck sunroof can turn a $20 fix into a $200 one." | "Track binding is a quick clean. A failing motor isn't. Don't guess which one you've got." | "Don't force it. Stop by and we'll take a look — Nick's Tire & Auto." |

Note: Variant B's dollar figures are illustrative ad-copy shorthand, **not** sourced shop pricing —
per §3, no `businessFacts` pricing row was read this session. If used verbatim in a live ad, an
operator should replace the numbers with confirmed pricing or drop them per the "no prices in
script" convention already applied to the base script and Variant A.

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` → **estimated generation cost if run today: $0.00** for
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
| Brief-time quality score (`calculateReelQualityScore`, 70/75 floor) | **UNKNOWN** (self-estimated ~50/75, see §8) | No live scorer run this session — self-scored against the published rubric, not a substitute for the real function |
| Server re-score at enqueue | **BLOCKED** | No `/api/admin/reel-canary {action:"start"}` call made — no credentials/route |
| Render-integrity gate (#800/#801) | **N/A — not rendered** | No MP4 exists this session |
| Rendered QA / vision critic (`renderedQa.ts`) | **N/A — not rendered** | Same |
| Repair routing / 7-way decision | **N/A** | No job exists to route |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED (by absence of a job)** | Cannot evaluate a gate against a nonexistent render — this is the gate's own `unavailable` state, not a silent pass |
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Directory scan (~145 topics) + live PR-title search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 7 | A sunroof stopped mid-slide is a legible hook but somewhat less universal than a pedal/brake symptom (not every vehicle has one) |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline in the base script |
| Keyword (5) | 4 | "sunroof," "track," "motor" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **50/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete and
internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close. No
render was attempted, no generation spend occurred, no DB was read, and no publish call was made. An
operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Your sunroof stopped mid-slide? Here's why it
might not close."}` to re-score, render, and move toward publish.

**Operator note on the PR queue:** 4 reel-pack PRs are currently open (#2114, #2115, #2116, #2117,
all opened 2026-09-04), plus 4 merged packs already landed today — this is the 9th same-day pack.
Per §1, this is worth an operator review of the scheduled task's firing cadence; not something this
session changed or paused unilaterally.
