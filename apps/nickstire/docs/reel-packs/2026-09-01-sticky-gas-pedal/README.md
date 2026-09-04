# Reel pack — "Your gas pedal feels heavy or slow to bounce back? Here's what that means."

Produced by a **scheduled task** firing (2026-09-01), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call, a live production-DB read, or any
Meta/Instagram post. This session made none of those calls. Deliverable is a full production-ready
**pack**, not a claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-09-01 (session clock).
- Capability check this session:
  `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|OPENAI|ANTHROPIC|META_|INSTAGRAM|FACEBOOK|TTS|CAPCUT'`
  returned only this session's own Claude Code / proxy plumbing (`ANTHROPIC_BASE_URL`, `NO_PROXY`
  lists containing the substring "anthropic.com", `JAVA_TOOL_OPTIONS`) — **no** Higgsfield
  credential, no `ADMIN_API_KEY`, no `DATABASE_URL`, no TTS provider key, no Meta/Instagram/Facebook
  token. Also checked local binaries: `ffmpeg` — **missing** (exit 1), `gh` — **missing** (exit 1;
  GitHub access this session goes through the connected GitHub MCP tools instead). Result:
  **BLOCKED: NO MOTION ROUTE** this session → full pack produced per the skill's explicit fallback,
  not a downgraded stills-only asset. `getHiggsfieldAccountHealth()` was **not called** (no running
  server, no credentials, no network path to it). Per the task instructions' own decision tree
  ("if tools are missing, produce a production-ready pack") this is the correct branch, and the
  scheduled prompt's step 5 ("do not claim a finished file exists unless rendered") is honored below.
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Inherited doc-truth, not a live
  read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended run per `prod-db-guard`).
  Substituted the best available offline check, per the skill's duplicate-check step (checking BOTH
  the merged directory AND open PRs — a pack opens as a draft PR before it merges):
  - `ls apps/nickstire/docs/reel-packs/` — **~135 merged pack directories** (`2026-08-14` through
    `2026-08-28`), spanning tires, brakes, cooling, electrical, drivetrain, HVAC, and emissions. No
    directory mentions a gas pedal, throttle, or accelerator symptom.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack"
    in:title)` — **5 open PRs today** (#2037, #2038, #2041, #2044, #2045, all created 2026-09-01).
    #2038 is a status-only note ("1 open pack PR, no new pack this run") filed earlier today before
    #2041/#2044/#2045 opened — stale relative to the current queue, not evidence the queue is
    stalled. The 4 content PRs cover: clutch pedal sinking to the floor (#2037), car alarm
    false-trigger (#2041), seatbelt warning light after buckling (#2044), power seat won't move
    (#2045). This is a normal same-day accumulation (4 packs), not the 15+-PR backlog that triggered
    a status-only note in an earlier run — so a fresh content pack is the useful contribution here,
    not another status note.
  - A targeted search — `search_pull_requests("gas pedal" OR "throttle" OR "accelerator"
    in:title)` — returned **zero matching PRs**. Live-confirms novelty beyond the directory scan.
  - Checked this pack's topic (a gas pedal that feels heavy, slow to return, or sticks) against all
    ~135 merged topics and all 5 open PR titles — **no overlap found.** Nearest neighbors are
    `clutch-slipping-rpm-flare` (08-22, a **clutch** engagement fault, different pedal and different
    mechanism) and `hesitation-acceleration-maf-sensor` (08-26, an **engine sensor** fault causing
    hesitation, not a mechanically sticking pedal). Both are different symptom clusters and
    different diagnostic paths from a physically heavy/slow/sticking gas pedal.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this series. Scored against the skill's rubric
out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament access this
session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 5/5 | "Your gas pedal feels heavy or slow to bounce back" — a physical sensation many drivers have felt and dismissed, strong curiosity + mild alarm pull |
| Distinct symptom cluster | 5/5 | A mechanically sticking/slow-return pedal is a distinct fault (carbon buildup on the throttle body, or a binding cable/pedal-position sensor) from an engine-sensor hesitation or a clutch-engagement fault — visually demonstrable without dashboard footage |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing ~135 topics + 5 open PRs | 5/5 | No overlap found (see §1); live PR-title search also came back empty |
| Producibility (faceless, no live footage needed) | 5/5 | Every beat is a plausible stock/AI-gen macro/engine-bay/road shot; no dealership-specific footage, no interior driver shot required |

Selected: **"Your gas pedal feels heavy or slow to bounce back? Here's what that means."** No
runner-up concept was generated — single-topic run, consistent with sibling packs in this series.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive knowledge** (a throttle body
  regulates airflow into the engine via a mechanically or electronically actuated plate; carbon and
  oil-vapor residue from the PCV/EGR system can build up on that plate and its bore over time,
  making the pedal feel heavier or slower to spring back; a binding accelerator cable or a failing
  electronic throttle/pedal-position sensor produces a similar symptom through a different, less
  routine-maintenance mechanism), not a shop-specific sourced fact. `entailment` status:
  **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the throttle-body/carbon-buildup claim; whether
  a sticking pedal is *more often* the cheap carbon-buildup cause vs. the cable/sensor cause in this
  shop's actual repair-order history (near-certain the cheap cause is more common industry-wide, but
  not confirmed against a live data row this session). The script deliberately states both
  possibilities as open, not ranked, to avoid asserting an unconfirmed probability as fact.

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Your gas pedal feels heavy, or slow to bounce back when you let off?" |
| 0:04–0:09 | SYMPTOM | "Not dramatic — just... sluggish. Like it's fighting you a little." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: buildup on the throttle body can make the pedal feel stiff — a cheap fix." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "But a pedal that sticks — not just feels heavy — can point to a cable or sensor problem instead." |
| 0:21–0:26 | SAFE ACTION | "Don't guess which one you've got. That's not something to wait on." |
| 0:26–0:30 | BRANDED CTA | "Worth checking either way. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't guess · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines. "That's not something to wait on" states a real, generic safety
consequence of an unpredictable throttle response without naming a specific failure rate or
timeline as fact.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Close macro shot of a gas pedal at rest in a car's footwell, warm interior
   lighting, static-mounted camera, shallow depth of field, slightly slow push-in to build tension.
2. **0:04–0:09** — Cutaway to an engine-bay shot: a throttle body assembly in soft focus, visible
   grime/residue on the intake-side edge (no hand, no tool in frame yet), subtle steam/heat shimmer.
3. **0:09–0:15** — Macro/cutaway shot: an inspection light angled onto the throttle-body bore,
   revealing carbon buildup texture in contrast light; slow rack focus from clean edge to buildup.
4. **0:15–0:21** — Wide shot from a driver's-eye POV (no driver, dash and windshield only) on an
   open road, subtle camera shake suggesting an unpredictable, uneven acceleration feel.
5. **0:21–0:26** — Diagnostic-scanner close-up: a handheld OBD-II scan tool mounted/clipped near the
   dash port, screen showing generic gauge graphics (no readable DTC codes, no logos), shop bay
   softly blurred behind.
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
- Hashtags: `#CarMaintenance #ThrottleBody #CarTips #AutoRepair #DriveSafe #ClevelandAuto #NicksTireAndAuto #CarSafety`
- Caption (feed): "🔧 Gas pedal feel heavy or slow to bounce back? One clue: throttle-body buildup —
  cheap fix. But an actual stick can point to a cable or sensor issue instead. Don't guess which one
  — stop by and we'll take a look. 🚗"

#### Two ad-ready hook/caption/CTA variants

| Variant | Hook | Caption | CTA |
|---|---|---|---|
| A (curiosity) | "Your gas pedal feels heavy? Here's the cheap fix vs. the one that isn't." | "Two totally different causes, one shared symptom. Worth knowing which you've got before it gets worse." | "Stop by and we'll take a look — Nick's Tire & Auto, Euclid." |
| B (safety) | "A sticking gas pedal isn't just annoying — it's a safety issue." | "Sluggish return, stiff feel, or an actual stick — none of these are something to wait on." | "Don't guess. Stop by and we'll take a look — Nick's Tire & Auto." |

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
| Brief-time quality score (`calculateReelQualityScore`, 70/75 floor) | **UNKNOWN** (self-estimated ~51/75, see §8) | No live scorer run this session — self-scored against the published rubric, not a substitute for the real function |
| Server re-score at enqueue | **BLOCKED** | No `/api/admin/reel-canary {action:"start"}` call made — no credentials/route |
| Render-integrity gate (#800/#801) | **N/A — not rendered** | No MP4 exists this session |
| Rendered QA / vision critic (`renderedQa.ts`) | **N/A — not rendered** | Same |
| Repair routing / 7-way decision | **N/A** | No job exists to route |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED (by absence of a job)** | Cannot evaluate a gate against a nonexistent render — this is the gate's own `unavailable` state, not a silent pass |
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Directory scan (~135 topics) + live PR-title search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 8 | A close macro of a heavy/sticky pedal is an immediately legible, relatable hook |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "gas pedal," "throttle body," "sluggish" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **51/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete and
internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close. No
render was attempted, no generation spend occurred, no DB was read, and no publish call was made. An
operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Your gas pedal feels heavy or slow to bounce
back? Here's what that means."}` to re-score, render, and move toward publish.

**Operator note on the PR queue:** 5 reel-pack PRs are currently open (#2037, #2038, #2041, #2044,
#2045, all opened 2026-09-01). #2038 is a stale status-only note from earlier today; the 4 content
PRs are a normal same-day accumulation, not a multi-day stall — no separate status note filed this
run.
